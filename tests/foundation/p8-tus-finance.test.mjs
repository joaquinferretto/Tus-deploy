import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

function commitment(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    commitmentId: 'commitment-finance-1',
    cartId: 'cart-finance-1',
    tenantId: 'tenant-a',
    merchantId: 'merchant-a',
    context: 'service',
    amount: 2500,
    currency: 'ARS',
    status: 'pending',
    lineIds: ['line-1'],
    createdAt: '2026-08-26T12:00:00.000Z',
    ...overrides,
  }
}

function assertHeld(result, reason) {
  assert.equal(result.status, 'held')
  assert.equal(result.reason, reason)
}

test('WU4 keeps Mercado Pago behind a validated provider intent port without accepting credentials', () => {
  const result = runTypeScriptScenario(`
    const { MercadoPagoPaymentIntentAdapter } = (await import('./apps/api/src/providers/mercado-pago/index.ts')).default
    const calls = []
    const adapter = new MercadoPagoPaymentIntentAdapter({ createPaymentIntent: async (input) => { calls.push(input); return { providerReference: 'mp-boundary-1', status: 'pending' } } })
    const created = await adapter.createPaymentIntent({ tenantId: 'tenant-a', commitmentId: 'commitment-finance-1', amount: 2500, currency: 'ARS', correlationId: 'corr-provider', idempotencyKey: 'provider-key' })
    let invalid = ''
    try { await adapter.createPaymentIntent({ tenantId: '', commitmentId: 'commitment-finance-1', amount: 2500, currency: 'ARS', correlationId: 'corr-provider', idempotencyKey: 'provider-key' }) } catch (error) { invalid = error.message }
    console.log(JSON.stringify({ created, calls, source: adapter.source, invalid }))
  `)

  assert.equal(result.source, 'authorized')
  assert.equal(result.created.providerReference, 'mp-boundary-1')
  assert.equal(result.calls[0].commitmentId, 'commitment-finance-1')
  assert.equal(result.calls[0].currency, 'ARS')
  assert.match(result.invalid, /context is required/i)
})

test('WU4 creates a commitment-bound provider intent and immutable commission snapshot', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-payment-1', status: 'approved' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({
      store,
      provider,
      readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true },
      commitmentLookup: async (id) => id === 'commitment-finance-1' ? (${JSON.stringify(commitment())}) : null,
      now: () => 1724673600000,
    })
    const created = await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-1', commitmentId: 'commitment-finance-1', idempotencyKey: 'pay-key-1', requestHash: 'hash-1' })
    const snapshot = store.getSnapshot('tenant-a', 'commitment-finance-1')
    const ledger = store.listLedger('tenant-a', 'commitment-finance-1')
    console.log(JSON.stringify({ created, snapshot, ledger, providerCalls: provider.createCalls, frozen: Object.isFrozen(snapshot) }))
  `)

  assert.equal(result.created.status, 'created')
  assert.equal(result.created.payment.providerReference, 'mp-payment-1')
  assert.equal(result.created.payment.providerStatus, 'approved')
  assert.equal(result.created.payment.commercialStatus, 'held')
  assert.equal(result.snapshot.grossAmount, 2500)
  assert.equal(result.snapshot.commissionableBase, 2500)
  assert.equal(result.snapshot.rateBps, 1000)
  assert.equal(result.snapshot.commissionAmount, 250)
  assert.equal(result.snapshot.providerReference, 'mp-payment-1')
  assert.equal(result.frozen, true)
  assert.deepEqual(result.ledger.map(({ entryType, amount }) => ({ entryType, amount })), [
    { entryType: 'gross_authorized', amount: 2500 },
    { entryType: 'commission_reserved', amount: 250 },
    { entryType: 'merchant_payable_held', amount: 2250 },
  ])
})

test('WU4 keeps Argentina/provider execution fail-closed and never collects credentials', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    const finance = new TusFinanceService({
      store: new InMemoryFinanceStore(),
      provider,
      readiness: { legal: false, kyc: false, kyb: false, tax: false, mercadoPago: false, reconciliation: false },
      commitmentLookup: async () => (${JSON.stringify(commitment())}),
    })
    const result = await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-2', commitmentId: 'commitment-finance-1', idempotencyKey: 'pay-key-2', requestHash: 'hash-2' })
    let releaseError = ''
    try { await finance.release({ tenantId: 'tenant-a', actorId: 'staff-a', correlationId: 'corr-2', commitmentId: 'commitment-finance-1', now: '2026-08-27T12:00:00.000Z' }) } catch (error) { releaseError = error.code }
    console.log(JSON.stringify({ result, releaseError, providerCalls: provider.createCalls }))
  `)

  assert.equal(result.result.status, 'held')
  assert.equal(result.result.reason, 'financial_gates_incomplete')
  assert.equal(result.result.payment.credentialsCollected, false)
  assert.equal(result.releaseError, 'FINANCIAL_GATES_INCOMPLETE')
  assert.equal(result.providerCalls, 0)
})

test('WU4 keeps provider approval separate from commercial release and denies foreign commitments', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-payment-pending', status: 'pending' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true }, commitmentLookup: async (id) => id === 'foreign-commitment' ? (${JSON.stringify(commitment({ tenantId: 'tenant-b' }))}) : (${JSON.stringify(commitment())}) })
    const pending = await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-pending', commitmentId: 'commitment-finance-1', idempotencyKey: 'pay-key-pending', requestHash: 'hash-pending' })
    let forbidden = ''
    try { await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-foreign', commitmentId: 'foreign-commitment', idempotencyKey: 'pay-key-foreign', requestHash: 'hash-foreign' }) } catch (error) { forbidden = error.code }
    console.log(JSON.stringify({ pending, snapshot: store.getSnapshot('tenant-a', 'commitment-finance-1'), forbidden, providerCalls: provider.createCalls }))
  `)

  assert.equal(result.pending.status, 'created')
  assert.equal(result.pending.payment.providerStatus, 'pending')
  assert.equal(result.pending.payment.commercialStatus, 'held')
  assert.equal(result.snapshot, null)
  assert.equal(result.forbidden, 'FORBIDDEN')
  assert.equal(result.providerCalls, 1)
})

test('WU4 releases only after confirmation or approved aging policy and freezes risk paths', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-payment-3', status: 'approved' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true }, commitmentLookup: async () => (${JSON.stringify(commitment())}) })
    await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-3', commitmentId: 'commitment-finance-1', idempotencyKey: 'pay-key-3', requestHash: 'hash-3' })
    const checkIn = await finance.recordEvidence({ tenantId: 'tenant-a', actorId: 'merchant-a', correlationId: 'corr-3', commitmentId: 'commitment-finance-1', evidenceId: 'check-in-1', kind: 'check-in', occurredAt: '2026-08-26T12:00:00.000Z' })
    const beforeConfirmation = await finance.release({ tenantId: 'tenant-a', actorId: 'staff-a', correlationId: 'corr-3', commitmentId: 'commitment-finance-1', now: '2026-08-27T12:00:00.000Z' })
    const withConfirmationNoEvidence = await finance.confirmCompletion({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-3', commitmentId: 'commitment-finance-1', confirmationId: 'confirmation-before-evidence', confirmedAt: '2026-08-26T12:30:00.000Z' })
    await finance.recordEvidence({ tenantId: 'tenant-a', actorId: 'merchant-a', correlationId: 'corr-3', commitmentId: 'commitment-finance-1', evidenceId: 'completion-1', kind: 'completion', occurredAt: '2026-08-26T12:00:00.000Z' })
    const confirmed = await finance.confirmCompletion({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-3', commitmentId: 'commitment-finance-1', confirmationId: 'confirmation-1', confirmedAt: '2026-08-26T13:00:00.000Z' })
    const frozen = await finance.freeze({ tenantId: 'tenant-a', actorId: 'support-a', correlationId: 'corr-3', commitmentId: 'commitment-finance-1', reason: 'chargeback' })
    const afterFreeze = await finance.release({ tenantId: 'tenant-a', actorId: 'staff-a', correlationId: 'corr-3', commitmentId: 'commitment-finance-1', now: '2026-08-27T13:00:00.000Z' })
    console.log(JSON.stringify({ checkIn: checkIn.kind, beforeConfirmation, withConfirmationNoEvidence, confirmed, frozen, afterFreeze }))
  `)

  assert.equal(result.checkIn, 'check-in')
  assertHeld(result.beforeConfirmation, 'completion_evidence_required')
  assertHeld(result.withConfirmationNoEvidence, 'completion_evidence_required')
  assert.equal(result.confirmed.status, 'released')
  assert.equal(result.frozen.status, 'frozen')
  assert.equal(result.afterFreeze.status, 'frozen')
  assert.equal(result.afterFreeze.reason, 'absolute_freeze')
})

test('WU4 records compensating outcomes and quarantines unreconciled provider mismatches replay-safely', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-payment-4', status: 'approved' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true }, commitmentLookup: async () => (${JSON.stringify(commitment({ commitmentId: 'commitment-finance-4' }))}) })
    await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-4', commitmentId: 'commitment-finance-4', idempotencyKey: 'pay-key-4', requestHash: 'hash-4' })
    const refund = await finance.refund({ tenantId: 'tenant-a', actorId: 'support-a', correlationId: 'corr-4', commitmentId: 'commitment-finance-4', amount: 500, reason: 'partial_dispute', idempotencyKey: 'refund-key-1' })
    const refundReplay = await finance.refund({ tenantId: 'tenant-a', actorId: 'support-a', correlationId: 'corr-4', commitmentId: 'commitment-finance-4', amount: 500, reason: 'partial_dispute', idempotencyKey: 'refund-key-1' })
    const mismatch = await finance.reconcile({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-4', commitmentId: 'commitment-finance-4', providerAmount: 999, providerReference: 'mp-payment-4' })
    const ledger = store.listLedger('tenant-a', 'commitment-finance-4')
    console.log(JSON.stringify({ refund, refundReplay, mismatch, ledger, immutable: ledger[0].amount }))
  `)

  assert.equal(result.refund.status, 'compensated')
  assert.equal(result.refund.amount, 500)
  assert.deepEqual(result.refundReplay, result.refund)
  assert.equal(result.mismatch.status, 'quarantined')
  assert.equal(result.mismatch.reason, 'provider_amount_mismatch')
  assert.equal(result.immutable, 2500)
  assert.equal(result.ledger.filter(({ entryType }) => entryType === 'refund_compensation').length, 1)
})

test('WU4 adds relational finance source-of-truth tables and provider-free migration evidence', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260826120000_tus_finance/migration.sql'), 'utf8')
  assert.match(schema, /model IntencionPago[\s\S]*?compromisoId\s+String/)
  assert.match(schema, /model InstantaneaComision[\s\S]*?tasaPuntosBase\s+Int/)
  assert.match(schema, /model TusLedgerEntry[\s\S]*?linkedEntryId\s+String\?/)
  assert.match(schema, /model EvidenciaFinanciera[\s\S]*?tipo\s+String/)
  assert.match(schema, /model TusFinancialFreeze[\s\S]*?reason\s+String/)
  assert.match(migration, /CREATE TABLE "TusPaymentIntent"/)
  assert.match(migration, /CREATE TABLE "TusCommissionSnapshot"/)
  assert.match(migration, /CREATE TABLE "TusLedgerEntry"/)
  assert.match(migration, /CREATE TABLE "TusFinancialEvidence"/)
  assert.match(migration, /CREATE TABLE "TusFinancialFreeze"/)
})

test('WU4 mounts authenticated finance routes and returns a held response when production gates are disabled', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    await application.marketplace.store.commitments.saveMany([${JSON.stringify(commitment())}])
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('finance-token', { sessionId: 'finance-session', subjectId: 'customer-a', tenantId: 'tenant-a', roles: ['customer'], permissions: ['tus:checkout'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const response = await fetch('http://127.0.0.1:' + address.port + '/tus/v1/finanzas/payment-intents', { method: 'POST', headers: { authorization: 'Bearer finance-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-http', 'idempotency-key': 'http-pay-key' }, body: JSON.stringify({ commitmentId: 'commitment-finance-1', requestHash: 'http-hash' }) })
    const body = await response.json()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ status: response.status, body }))
  `)

  assert.equal(result.status, 202)
  assert.equal(result.body.status, 'held')
  assert.equal(result.body.reason, 'financial_gates_incomplete')
  assert.equal(result.body.payment.credentialsCollected, false)
})
