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
    commitmentId: 'commitment-finance-2-2',
    cartId: 'cart-finance-2-2',
    tenantId: 'tenant-a',
    merchantId: 'merchant-a',
    context: 'service',
    amount: 2500,
    currency: 'ARS',
    status: 'pending',
    lineIds: ['line-1'],
    version: 1,
    createdAt: '2026-08-26T12:00:00.000Z',
    ...overrides,
  }
}

function assertHeld(result, reason) {
  assert.equal(result.status, 'held')
  assert.equal(result.reason, reason)
}

test('WU2.2 gates provider intent creation from a durable commitment and keeps live execution disabled', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-finance-2-2', status: 'approved' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({
      store,
      provider,
      readiness: { legal: false, kyc: false, kyb: false, tax: false, mercadoPago: false, reconciliation: false },
      commitmentLookup: async (id) => id === 'commitment-finance-2-2' ? (${JSON.stringify(commitment())}) : null,
    })
    const held = await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-finance-2-2', commitmentId: 'commitment-finance-2-2', idempotencyKey: 'pay-2-2', requestHash: 'hash-2-2' })
    console.log(JSON.stringify({ held, providerCalls: provider.createCalls, readiness: finance.readinessStatus(), payment: store.getPayment('tenant-a', 'commitment-finance-2-2') }))
  `)

  assert.equal(result.held.status, 'held')
  assert.equal(result.held.payment.providerReference, null)
  assert.equal(result.held.payment.credentialsCollected, false)
  assert.equal(result.providerCalls, 0)
  assert.ok(result.readiness.failedGates.includes('mercadoPago'))
})

test('WU2.2 snapshots commission rule, rate, base, gross, amount, and net immutably while corrections append', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-snapshot-2-2', status: 'approved' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({
      store,
      provider,
      readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true },
      commissionRateBps: 1250,
      ruleVersion: 'argentina-mvp-v2',
      commitmentLookup: async () => (${JSON.stringify(commitment({ amount: 3333, context: 'product' }))}),
      now: () => 1724673600000,
    })
    await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-snapshot', commitmentId: 'commitment-finance-2-2', idempotencyKey: 'pay-snapshot', requestHash: 'hash-snapshot' })
    const snapshot = store.getSnapshot('tenant-a', 'commitment-finance-2-2')
    const before = JSON.stringify(snapshot)
    let rewriteError = ''
    try { store.saveSnapshot({ ...snapshot, commissionAmount: 1 }) } catch (error) { rewriteError = error.code }
    let mutationError = ''
    try { snapshot.commissionAmount = 1 } catch (error) { mutationError = error.name }
    const refund = await finance.refund({ tenantId: 'tenant-a', actorId: 'support-a', correlationId: 'corr-snapshot', commitmentId: 'commitment-finance-2-2', amount: 333, reason: 'pricing-correction', idempotencyKey: 'refund-snapshot' })
    const ledger = store.listLedger('tenant-a', 'commitment-finance-2-2')
    console.log(JSON.stringify({ before, stored: store.getSnapshot('tenant-a', 'commitment-finance-2-2'), rewriteError, mutationError, refund, freeze: store.getFreeze('tenant-a', 'commitment-finance-2-2'), ledger }))
  `)

  assert.equal(result.stored.commissionableBase, 3333)
  assert.equal(result.stored.rateBps, 1250)
  assert.equal(result.stored.commissionAmount, 417)
  assert.equal(result.stored.netAmount, 2916)
  assert.equal(result.rewriteError, 'SNAPSHOT_IMMUTABLE')
  assert.equal(result.mutationError, '')
  assert.equal(result.refund.status, 'compensated')
  assert.equal(result.freeze.reason, 'refund')
  assert.equal(result.ledger.at(-1).entryType, 'refund_compensation')
  assert.equal(result.ledger.at(-1).linkedEntryId, 'gross-commitment-finance-2-2')
})

test('WU2.2 releases only after explicit confirmation and never after a risk freeze', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    const store = new InMemoryFinanceStore()
    const commitments = new Map([
      ['service-2-2', ${JSON.stringify(commitment({ commitmentId: 'service-2-2', context: 'service' }))}],
      ['product-2-2', ${JSON.stringify(commitment({ commitmentId: 'product-2-2', context: 'product' }))}],
    ])
    const finance = new TusFinanceService({ store, provider, readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true }, commitmentLookup: async (id) => commitments.get(id) ?? null })
    provider.setNext({ providerReference: 'mp-service-2-2', status: 'approved' })
    await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-service', commitmentId: 'service-2-2', idempotencyKey: 'pay-service', requestHash: 'hash-service' })
    await finance.recordEvidence({ tenantId: 'tenant-a', actorId: 'merchant-a', correlationId: 'corr-service', commitmentId: 'service-2-2', evidenceId: 'completion-service', kind: 'completion', occurredAt: '2026-08-26T12:00:00.000Z' })
    await finance.confirmCompletion({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-service', commitmentId: 'service-2-2', confirmationId: 'confirmation-service', confirmedAt: '2026-08-26T12:01:00.000Z' })
    const serviceRelease = await finance.release({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-service', commitmentId: 'service-2-2', now: '2026-08-27T00:00:00.000Z' })
    provider.setNext({ providerReference: 'mp-product-2-2', status: 'approved' })
    await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-product', commitmentId: 'product-2-2', idempotencyKey: 'pay-product', requestHash: 'hash-product' })
    await finance.recordEvidence({ tenantId: 'tenant-a', actorId: 'merchant-a', correlationId: 'corr-product', commitmentId: 'product-2-2', evidenceId: 'completion-product', kind: 'completion', occurredAt: '2026-08-26T12:00:00.000Z' })
    const productPending = await finance.release({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-product', commitmentId: 'product-2-2', now: '2026-08-27T11:59:59.000Z' })
    await finance.confirmCompletion({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-product', commitmentId: 'product-2-2', confirmationId: 'confirmation-product', confirmedAt: '2026-08-27T12:00:00.000Z' })
    const productRelease = await finance.release({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-product', commitmentId: 'product-2-2', now: '2026-08-27T12:00:00.000Z' })
    const productReplay = await finance.release({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-product', commitmentId: 'product-2-2', now: '2026-08-28T12:00:00.000Z' })
    await finance.chargeback({ tenantId: 'tenant-a', actorId: 'support-a', correlationId: 'corr-product', commitmentId: 'product-2-2' })
    const afterChargeback = await finance.release({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-product', commitmentId: 'product-2-2', now: '2026-08-28T12:00:00.000Z' })
    console.log(JSON.stringify({ serviceRelease, productPending, productRelease, productReplay, afterChargeback, ledger: store.listLedger('tenant-a', 'product-2-2') }))
  `)

  assert.equal(result.serviceRelease.status, 'released')
  assert.equal(result.serviceRelease.reason, 'customer_confirmed')
  assertHeld(result.productPending, 'completion_confirmation_required')
  assert.equal(result.productRelease.reason, 'customer_confirmed')
  assert.equal(result.productReplay.reason, 'customer_confirmed')
  assert.equal(result.ledger.filter(({ entryType }) => entryType === 'merchant_release').length, 1)
  assert.equal(result.afterChargeback.status, 'frozen')
  assert.equal(result.afterChargeback.reason, 'absolute_freeze')
})

test('WU2.2 freezes reserve risk, preserves reconciliation evidence, and replays compensation without duplicate ledger effects', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-reconcile-2-2', status: 'approved' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true }, commitmentLookup: async () => (${JSON.stringify(commitment())}) })
    await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-reconcile', commitmentId: 'commitment-finance-2-2', idempotencyKey: 'pay-reconcile', requestHash: 'hash-reconcile' })
    const reserve = await finance.freeze({ tenantId: 'tenant-a', actorId: 'risk-a', correlationId: 'corr-reconcile', commitmentId: 'commitment-finance-2-2', reason: 'reserve' })
    const refund = await finance.refund({ tenantId: 'tenant-a', actorId: 'support-a', correlationId: 'corr-reconcile', commitmentId: 'commitment-finance-2-2', amount: 200, reason: 'reserve-release', idempotencyKey: 'refund-reconcile' })
    const refundReplay = await finance.refund({ tenantId: 'tenant-a', actorId: 'support-a', correlationId: 'corr-reconcile', commitmentId: 'commitment-finance-2-2', amount: 200, reason: 'reserve-release', idempotencyKey: 'refund-reconcile' })
    const mismatch = await finance.reconcile({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-reconcile', commitmentId: 'commitment-finance-2-2', providerReference: 'wrong-reference', providerAmount: 2499 })
    const mismatchReplay = await finance.reconcile({ tenantId: 'tenant-a', actorId: 'finance-b', correlationId: 'corr-reconcile-replay', commitmentId: 'commitment-finance-2-2', providerReference: 'another-reference', providerAmount: 1 })
    console.log(JSON.stringify({ reserve, refund, refundReplay, mismatch, mismatchReplay, ledger: store.listLedger('tenant-a', 'commitment-finance-2-2'), freeze: store.getFreeze('tenant-a', 'commitment-finance-2-2') }))
  `)

  assert.equal(result.reserve.freeze.reason, 'reserve')
  assert.deepEqual(result.refundReplay, result.refund)
  assert.equal(result.mismatch.status, 'quarantined')
  assert.equal(result.mismatch.evidenceId, 'reconciliation-evidence-commitment-finance-2-2')
  assert.equal(result.mismatch.actorId, 'finance-a')
  assert.deepEqual(result.mismatchReplay, result.mismatch)
  assert.equal(result.ledger.filter(({ entryType }) => entryType === 'refund_compensation').length, 1)
  assert.equal(result.ledger.filter(({ entryType }) => entryType === 'reconciliation_compensation').length, 1)
  assert.equal(result.ledger.find(({ entryType }) => entryType === 'reconciliation_compensation').linkedEntryId, 'gross-commitment-finance-2-2')
  assert.equal(result.freeze.reason, 'reserve')
})

test('WU2.2 adds the additive finance migration and append-only ledger guard', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260827090500_tus_finance/migration.sql'), 'utf8')
  assert.match(schema, /model TusFinancialFreeze[\s\S]*?reason\s+String/)
  assert.match(schema, /model TusReconciliationRecord[\s\S]*?deterministic\s+Boolean/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION[\s\S]*TusLedgerEntry/i)
  assert.match(migration, /append-only/i)
  assert.match(migration, /preserve.*ledger/i)
})

test('WU2.2 fails payout and custody release jobs closed even when local finance proof is complete', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    const finance = new TusFinanceService({ store: new InMemoryFinanceStore(), provider, readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true, payout: false, custody: false }, commitmentLookup: async () => (${JSON.stringify(commitment())}) })
    let code = ''
    try { await finance.enqueueReleaseJob({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-readiness', commitmentId: 'commitment-finance-2-2' }) } catch (error) { code = error.code }
    console.log(JSON.stringify({ code, readiness: finance.payoutReadinessStatus() }))
  `)

  assert.equal(result.code, 'FINANCIAL_GATES_INCOMPLETE')
  assert.deepEqual(result.readiness.failedGates, ['payout', 'custody'])
})

test('PR4 requires explicit completion confirmation after the release window and rejects divergent ledger rewrites', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-pr4-confirmation', status: 'approved' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, readiness: { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true }, commitmentLookup: async () => (${JSON.stringify(commitment({ context: 'product' }))}) })
    await finance.createPaymentIntent({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-pr4-confirmation', commitmentId: 'commitment-finance-2-2', idempotencyKey: 'pay-pr4-confirmation', requestHash: 'hash-pr4-confirmation' })
    await finance.recordEvidence({ tenantId: 'tenant-a', actorId: 'merchant-a', correlationId: 'corr-pr4-confirmation', commitmentId: 'commitment-finance-2-2', evidenceId: 'completion-pr4-confirmation', kind: 'completion', occurredAt: '2026-08-26T12:00:00.000Z' })
    const aged = await finance.release({ tenantId: 'tenant-a', actorId: 'finance-a', correlationId: 'corr-pr4-confirmation', commitmentId: 'commitment-finance-2-2', now: '2026-08-30T12:00:00.000Z' })
    const confirmed = await finance.confirmCompletion({ tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-pr4-confirmation', commitmentId: 'commitment-finance-2-2', confirmationId: 'confirmation-pr4', confirmedAt: '2026-08-30T12:01:00.000Z' })
    let rewriteCode = ''
    try { await store.appendLedger({ entryId: 'gross-commitment-finance-2-2', tenantId: 'tenant-a', commitmentId: 'commitment-finance-2-2', entryType: 'gross_authorized', amount: 1, currency: 'ARS', linkedEntryId: null, reason: 'rewrite', immutable: true, createdAt: Date.now() }) } catch (error) { rewriteCode = error.code }
    console.log(JSON.stringify({ aged, confirmed, rewriteCode, providerCalls: provider.createCalls, ledger: store.listLedger('tenant-a', 'commitment-finance-2-2') }))
  `)

  assertHeld(result.aged, 'completion_confirmation_required')
  assert.equal(result.confirmed.status, 'released')
  assert.equal(result.rewriteCode, 'LEDGER_IMMUTABLE')
  assert.equal(result.providerCalls, 1)
  assert.equal(result.ledger.filter(({ entryType }) => entryType === 'merchant_release').length, 1)
})

test('BUILD 12F2 maps commission, evidence, and confirmation delegates without changing financial values', () => {
  const result = runTypeScriptScenario(`
    const { PrismaTusFinanceStore } = (await import('./apps/api/src/tus/finance/prisma.ts')).default
    const captured = {}
    const client = {
      instantaneaComision: {
        findUnique: async (input) => { captured.snapshotGet = input; return captured.snapshotCreate.data },
        create: async (input) => { captured.snapshotCreate = input; return input.data },
      },
      evidenciaFinanciera: {
        findMany: async (input) => { captured.evidenceList = input; return [captured.evidenceCreate.create] },
        upsert: async (input) => { captured.evidenceCreate = input; return input.create },
      },
      confirmacionFinanciera: {
        findUnique: async (input) => { captured.confirmationGet = input; return captured.confirmationCreate.create },
        upsert: async (input) => { captured.confirmationCreate = input; return input.create },
      },
    }
    const store = new PrismaTusFinanceStore(client)
    const snapshot = await store.saveSnapshot({ contractVersion: '1.0.0', snapshotId: 'snapshot-12f2', tenantId: 'tenant-a', commitmentId: 'commitment-12f2', context: 'product', grossAmount: 3333, deductions: 111, commissionableBase: 3222, rateBps: 1250, ruleVersion: 'argentina-mvp-v2', commissionAmount: 403, netAmount: 2819, currency: 'ARS', providerReference: 'mp-12f2', evidenceId: 'payment-authorized:payment-12f2', ledgerStatus: 'held', createdAt: 1724673600000 })
    const loadedSnapshot = await store.getSnapshot('tenant-a', 'commitment-12f2')
    const evidence = await store.saveEvidence({ contractVersion: '1.0.0', evidenceId: 'evidence-12f2', tenantId: 'tenant-a', commitmentId: 'commitment-12f2', actorId: 'merchant-a', correlationId: 'corr-12f2', kind: 'completion', occurredAt: '2026-08-26T12:00:00.000Z' })
    const evidenceList = await store.listEvidence('tenant-a', 'commitment-12f2')
    const confirmation = await store.saveConfirmation({ confirmationId: 'confirmation-12f2', tenantId: 'tenant-a', commitmentId: 'commitment-12f2', actorId: 'customer-a', correlationId: 'corr-12f2', confirmedAt: '2026-08-26T12:01:00.000Z' })
    const loadedConfirmation = await store.getConfirmation('tenant-a', 'commitment-12f2')
    console.log(JSON.stringify({ snapshot, loadedSnapshot, snapshotCreate: captured.snapshotCreate, snapshotGet: captured.snapshotGet, evidence, evidenceList, evidenceCreate: captured.evidenceCreate, evidenceListQuery: captured.evidenceList, confirmation, loadedConfirmation, confirmationCreate: captured.confirmationCreate, confirmationGet: captured.confirmationGet }))
  `)
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')

  assert.deepEqual(result.snapshotCreate.data, {
    id: 'snapshot-12f2',
    versionContrato: '1.0.0',
    instantaneaId: 'snapshot-12f2',
    tenantId: 'tenant-a',
    compromisoId: 'commitment-12f2',
    contexto: 'product',
    montoBruto: 3333,
    deducciones: 111,
    baseComisionable: 3222,
    tasaPuntosBase: 1250,
    versionRegla: 'argentina-mvp-v2',
    montoComision: 403,
    montoNeto: 2819,
    moneda: 'ARS',
    referenciaProveedor: 'mp-12f2',
    evidenciaId: 'payment-authorized:payment-12f2',
    estadoContable: 'held',
    fechaCreacion: new Date(1724673600000).toISOString(),
  })
  assert.deepEqual(result.snapshotGet, { where: { tenantId_compromisoId: { tenantId: 'tenant-a', compromisoId: 'commitment-12f2' } } })
  assert.deepEqual(result.evidenceCreate.create, {
    id: 'evidence-12f2',
    versionContrato: '1.0.0',
    evidenciaId: 'evidence-12f2',
    tenantId: 'tenant-a',
    compromisoId: 'commitment-12f2',
    actorId: 'merchant-a',
    correlacionId: 'corr-12f2',
    tipo: 'completion',
    fechaOcurrencia: new Date('2026-08-26T12:00:00.000Z').toISOString(),
    fechaCreacion: result.evidenceCreate.create.fechaCreacion,
  })
  assert.deepEqual(result.evidenceListQuery, { where: { tenantId: 'tenant-a', compromisoId: 'commitment-12f2' }, orderBy: { fechaOcurrencia: 'asc' } })
  assert.equal(result.evidence.kind, 'completion')
  assert.deepEqual(result.confirmationCreate.create, {
    id: 'confirmation-12f2',
    confirmacionId: 'confirmation-12f2',
    tenantId: 'tenant-a',
    compromisoId: 'commitment-12f2',
    actorId: 'customer-a',
    correlacionId: 'corr-12f2',
    fechaConfirmacion: new Date('2026-08-26T12:01:00.000Z').toISOString(),
    fechaCreacion: result.confirmationCreate.create.fechaCreacion,
  })
  assert.deepEqual(result.confirmationGet, { where: { tenantId_compromisoId: { tenantId: 'tenant-a', compromisoId: 'commitment-12f2' } } })

  for (const field of ['montoBruto', 'deducciones', 'baseComisionable', 'montoComision', 'montoNeto']) {
    assert.match(schema, new RegExp(`${field}\\s+BigInt\\s+@map\\("${{ montoBruto: 'grossAmount', deducciones: 'deductions', baseComisionable: 'commissionableBase', montoComision: 'commissionAmount', montoNeto: 'netAmount' }[field]}"\\)`))
  }
  assert.match(schema, /tasaPuntosBase\s+Int\s+@map\("rateBps"\)/)
  assert.match(schema, /versionRegla\s+String\s+@map\("ruleVersion"\)/)
  assert.match(schema, /evidenciaId\s+String\s+@map\("evidenceId"\)/)
  assert.match(schema, /@@unique\(\[tenantId, compromisoId\], map: "TusFinancialConfirmation_tenantId_commitmentId_key"\)/)
  assert.doesNotMatch(schema.match(/model InstantaneaComision[\s\S]*?\n}\n\nmodel TusLedgerEntry/)?.[0] ?? '', /@relation/)
})
