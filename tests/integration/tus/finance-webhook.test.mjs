import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
const SECRET = 'finance-webhook-secret-placeholder'

function runTypeScriptScenario(source) {
  const output = execFileSync(process.execPath, [tsxCli, '--eval', `(async () => {\n${source}\n})()`], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

function commitment(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    commitmentId: 'order-arg-1-product',
    cartId: 'cart-arg-1',
    tenantId: 'tenant-arg',
    merchantId: 'merchant-arg',
    context: 'product',
    amount: 2500,
    currency: 'ARS',
    status: 'pending',
    lineIds: ['line-1'],
    version: 1,
    createdAt: '2026-09-09T12:00:00.000Z',
    ...overrides,
  }
}

function ready() {
  return { legal: true, kyc: true, kyb: true, tax: true, mercadoPago: true, reconciliation: true }
}

test('creates an order/POS-correlated intermediary payment with an exact five-day hold contract', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider, createFinanceMoney } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-sandbox-placeholder', status: 'pending' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, readiness: ${JSON.stringify(ready())}, providerEnabled: true, commitmentLookup: async () => (${JSON.stringify(commitment())}) })
    const exact = createFinanceMoney('ars', 2500n)
    const created = await finance.createPaymentIntent({ tenantId: 'tenant-arg', actorId: 'customer-arg', correlationId: 'corr-order-1', commitmentId: 'order-arg-1-product', orderId: 'order-arg-1', posOperationId: 'pos-op-1', idempotencyKey: 'pay-1', requestHash: 'hash-1' })
    console.log(JSON.stringify({ exact: { currency: exact.currency, minor: exact.minor.toString() }, payment: created.payment, source: created.payment.source, calls: provider.createCalls }))
  `)

  assert.deepEqual(result.exact, { currency: 'ARS', minor: '2500' })
  assert.equal(result.payment.orderId, 'order-arg-1')
  assert.equal(result.payment.posOperationId, 'pos-op-1')
  assert.equal(result.payment.merchantOfRecord, 'tus-intermediary')
  assert.equal(result.payment.splitPolicy.holdDays, 5)
  assert.equal(result.payment.splitPolicy.releaseRule, 'completion-confirmation-or-approved-policy')
  assert.equal(result.payment.providerStatus, 'pending')
  assert.equal(result.calls, 1)
})

test('does not release an approved payment before the explicit five-day hold expires', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-hold', status: 'approved' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, enforceFiveDayHold: true, readiness: ${JSON.stringify(ready())}, commitmentLookup: async () => (${JSON.stringify(commitment())}), now: () => 1725883200000 })
    await finance.createPaymentIntent({ tenantId: 'tenant-arg', actorId: 'customer-arg', correlationId: 'corr-hold', commitmentId: 'order-arg-1-product', idempotencyKey: 'pay-hold', requestHash: 'hash-hold' })
    const result = await finance.release({ tenantId: 'tenant-arg', actorId: 'finance-arg', correlationId: 'corr-hold', commitmentId: 'order-arg-1-product', now: new Date(1725883200000).toISOString() })
    console.log(JSON.stringify({ status: result.status, reason: result.reason, releaseAt: store.getPayment('tenant-arg', 'order-arg-1-product').releaseAt }))
  `)

  assert.equal(result.status, 'held')
  assert.equal(result.reason, 'five_day_hold_pending')
  assert.equal(result.releaseAt, 1726315200000)
})

test('verifies fresh signed webhooks, deduplicates replay, and ignores out-of-order regressions', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider, createFinanceWebhookSignature } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-payment-1', status: 'pending' })
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, readiness: ${JSON.stringify(ready())}, webhookSecret: '${SECRET}', commitmentLookup: async () => (${JSON.stringify(commitment())}) })
    await finance.createPaymentIntent({ tenantId: 'tenant-arg', actorId: 'customer-arg', correlationId: 'corr-payment', commitmentId: 'order-arg-1-product', idempotencyKey: 'pay-webhook', requestHash: 'hash-webhook' })
    const signed = (eventId, status, timestamp) => ({ tenantId: 'tenant-arg', actorId: 'provider-webhook', correlationId: 'corr-payment', commitmentId: 'order-arg-1-product', paymentId: 'payment-order-arg-1-product', providerReference: 'mp-payment-1', status, amount: 2500, currency: 'ARS', eventId, requestId: 'request-' + eventId, timestamp, signature: createFinanceWebhookSignature({ secret: '${SECRET}', eventId, requestId: 'request-' + eventId, timestamp }) })
    const approved = await finance.handleWebhook(signed('event-approved', 'approved', 1725883200), 1725883200000)
    const oldPending = await finance.handleWebhook(signed('event-old-pending', 'pending', 1725883190), 1725883200000)
    const replay = await finance.handleWebhook(signed('event-approved', 'approved', 1725883200), 1725883200000)
    const expired = await finance.handleWebhook(signed('event-expired', 'cancelled', 1725883200), 1725883560000)
    const finalPayment = store.getPayment('tenant-arg', 'order-arg-1-product')
    console.log(JSON.stringify({ approved: approved.status, oldPending: oldPending.status, replay: replay.status, expired: expired.status, final: finalPayment.providerStatus, outbox: store.listLedger('tenant-arg', 'order-arg-1-product').length }))
  `)

  assert.equal(result.approved, 'processed')
  assert.equal(result.oldPending, 'out_of_order')
  assert.equal(result.replay, 'replay')
  assert.equal(result.expired, 'rejected')
  assert.equal(result.final, 'approved')
  assert.equal(result.outbox, 3)
})

test('supports rejected, expired, cancelled, refund, chargeback, and freeze transitions without rewriting the ledger', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider, createFinanceWebhookSignature } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    const store = new InMemoryFinanceStore()
    const commitments = new Map([
      ['rejected-order', ${JSON.stringify(commitment({ commitmentId: 'rejected-order', amount: 1000 }))}],
      ['expired-order', ${JSON.stringify(commitment({ commitmentId: 'expired-order', amount: 1100 }))}],
      ['cancelled-order', ${JSON.stringify(commitment({ commitmentId: 'cancelled-order', amount: 1200 }))}],
      ['refund-order', ${JSON.stringify(commitment({ commitmentId: 'refund-order', amount: 2500 }))}],
    ])
    const finance = new TusFinanceService({ store, provider, readiness: ${JSON.stringify(ready())}, webhookSecret: '${SECRET}', commitmentLookup: async (id) => commitments.get(id) ?? null })
    const status = async (commitmentId, providerStatus, eventId) => { provider.setNext({ providerReference: 'mp-' + commitmentId, status: 'pending' }); await finance.createPaymentIntent({ tenantId: 'tenant-arg', actorId: 'customer-arg', correlationId: 'corr-' + commitmentId, commitmentId, idempotencyKey: 'pay-' + commitmentId, requestHash: 'hash-' + commitmentId }); const timestamp = 1725883200; return finance.handleWebhook({ tenantId: 'tenant-arg', actorId: 'provider', correlationId: 'corr-' + commitmentId, commitmentId, paymentId: 'payment-' + commitmentId, providerReference: 'mp-' + commitmentId, status: providerStatus, amount: commitments.get(commitmentId).amount, currency: 'ARS', eventId, requestId: 'request-' + eventId, timestamp, signature: createFinanceWebhookSignature({ secret: '${SECRET}', eventId, requestId: 'request-' + eventId, timestamp }) }, timestamp * 1000) }
    const rejected = await status('rejected-order', 'rejected', 'event-rejected')
    const expired = await status('expired-order', 'expired', 'event-expired')
    const cancelled = await status('cancelled-order', 'cancelled', 'event-cancelled')
    provider.setNext({ providerReference: 'mp-refund-order', status: 'approved' })
    await finance.createPaymentIntent({ tenantId: 'tenant-arg', actorId: 'customer-arg', correlationId: 'corr-refund', commitmentId: 'refund-order', idempotencyKey: 'pay-refund', requestHash: 'hash-refund' })
    const partial = await finance.refund({ tenantId: 'tenant-arg', actorId: 'support-arg', correlationId: 'corr-refund', commitmentId: 'refund-order', amount: 500, reason: 'partial', idempotencyKey: 'refund-1' })
    const full = await finance.refund({ tenantId: 'tenant-arg', actorId: 'support-arg', correlationId: 'corr-refund', commitmentId: 'refund-order', amount: 2000, reason: 'remaining', idempotencyKey: 'refund-2' })
    const chargeback = await finance.chargeback({ tenantId: 'tenant-arg', actorId: 'risk-arg', correlationId: 'corr-refund', commitmentId: 'refund-order' })
    const ledger = store.listLedger('tenant-arg', 'refund-order')
    console.log(JSON.stringify({ rejected: rejected.payment.providerStatus, expired: expired.payment.providerStatus, cancelled: cancelled.payment.providerStatus, partial: partial.amount, full: full.amount, chargeback: chargeback.status, original: ledger[0].amount, compensations: ledger.filter((entry) => entry.entryType.endsWith('compensation')).map((entry) => entry.amount), frozen: store.getPayment('tenant-arg', 'refund-order').commercialStatus }))
  `)

  assert.equal(result.rejected, 'rejected')
  assert.equal(result.expired, 'expired')
  assert.equal(result.cancelled, 'cancelled')
  assert.equal(result.partial, 500)
  assert.equal(result.full, 2000)
  assert.equal(result.chargeback, 'frozen')
  assert.equal(result.original, 2500)
  assert.deepEqual(result.compensations, [500, 2000, 2500])
  assert.equal(result.frozen, 'frozen')
})

test('reconciles exact minor units, retries provider timeouts, and fails closed without secret-bearing diagnostics', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, FinanceError } = (await import('./apps/api/src/tus/finance/index.ts')).default
    let attempts = 0
    const provider = { source: 'authorized', createPaymentIntent: async () => { attempts += 1; if (attempts < 3) throw Object.assign(new Error('timeout ${SECRET}'), { code: 'PROVIDER_TIMEOUT' }); return { providerReference: 'mp-retry', status: 'approved' } } }
    const store = new InMemoryFinanceStore()
    const finance = new TusFinanceService({ store, provider, readiness: ${JSON.stringify(ready())}, providerRetry: { maxAttempts: 3 }, commitmentLookup: async () => (${JSON.stringify(commitment())}) })
    const created = await finance.createPaymentIntent({ tenantId: 'tenant-arg', actorId: 'customer-arg', correlationId: 'corr-retry', commitmentId: 'order-arg-1-product', orderId: 'order-arg-1', idempotencyKey: 'pay-retry', requestHash: 'hash-retry' })
    const clean = await finance.reconcile({ tenantId: 'tenant-arg', actorId: 'finance-arg', correlationId: 'corr-retry', commitmentId: 'order-arg-1-product', providerReference: 'mp-retry', providerAmount: 2500 })
    const disabled = new TusFinanceService({ store: new InMemoryFinanceStore(), provider: { source: 'authorized', createPaymentIntent: async () => { throw new Error('must not call') } }, providerEnabled: false, readiness: ${JSON.stringify(ready())}, commitmentLookup: async () => (${JSON.stringify(commitment())}) })
    const held = await disabled.createPaymentIntent({ tenantId: 'tenant-arg', actorId: 'customer-arg', correlationId: 'corr-disabled', commitmentId: 'order-arg-1-product', idempotencyKey: 'pay-disabled', requestHash: 'hash-disabled' })
    let secretSafe = true
    try { await finance.handleWebhook({ tenantId: 'tenant-arg', actorId: 'provider', correlationId: 'corr-retry', commitmentId: 'order-arg-1-product', paymentId: 'payment-order-arg-1-product', providerReference: 'mp-retry', status: 'approved', amount: 2500, currency: 'ARS', eventId: 'bad-event', requestId: 'bad-request', timestamp: 1725883200, signature: 'invalid', secret: '${SECRET}' }, 1725883200000) } catch (error) { secretSafe = !(error.message.includes('${SECRET}')) }
    console.log(JSON.stringify({ status: created.status, attempts, clean: clean.status, held: held.status, providerReference: held.payment.providerReference, secretSafe }))
  `)

  assert.equal(result.status, 'created')
  assert.equal(result.attempts, 3)
  assert.equal(result.clean, 'clean')
  assert.equal(result.held, 'held')
  assert.equal(result.providerReference, null)
  assert.equal(result.secretSafe, true)
})

test('rejects a webhook whose signed timestamp does not match the verified event timestamp', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryFinanceStore, TusFinanceService, DeterministicMercadoPagoFinanceProvider, createFinanceWebhookSignature } = (await import('./apps/api/src/tus/finance/index.ts')).default
    const provider = new DeterministicMercadoPagoFinanceProvider()
    provider.setNext({ providerReference: 'mp-timestamp-boundary', status: 'pending' })
    const finance = new TusFinanceService({ store: new InMemoryFinanceStore(), provider, webhookSecret: '${SECRET}', readiness: ${JSON.stringify(ready())}, commitmentLookup: async () => (${JSON.stringify(commitment())}) })
    await finance.createPaymentIntent({ tenantId: 'tenant-arg', actorId: 'customer-arg', correlationId: 'corr-timestamp', commitmentId: 'order-arg-1-product', idempotencyKey: 'pay-timestamp', requestHash: 'hash-timestamp' })
    const timestamp = 1725883200
    const signature = createFinanceWebhookSignature({ secret: '${SECRET}', eventId: 'event-timestamp', requestId: 'request-timestamp', timestamp }).replace('ts=' + timestamp, 'ts=' + (timestamp - 1))
    const webhook = await finance.handleWebhook({ tenantId: 'tenant-arg', actorId: 'provider', correlationId: 'corr-timestamp', commitmentId: 'order-arg-1-product', paymentId: 'payment-order-arg-1-product', providerReference: 'mp-timestamp-boundary', status: 'approved', amount: 2500, currency: 'ARS', eventId: 'event-timestamp', requestId: 'request-timestamp', timestamp, signature }, timestamp * 1000)
    console.log(JSON.stringify({ status: webhook.status, reason: webhook.reason }))
  `)

  assert.equal(result.status, 'rejected')
  assert.equal(result.reason, 'invalid_signature')
})

test('maps payment timestamps and provider values to the Spanish Prisma boundary', () => {
  const result = runTypeScriptScenario(`
    const { PrismaTusFinanceStore } = (await import('./apps/api/src/tus/finance/prisma.ts')).default
    let captured
    const client = { intencionPago: { upsert: async (input) => { captured = input.create; return { ...input.create, fechaCreacion: new Date(0), fechaActualizacion: new Date(0) } } } }
    const store = new PrismaTusFinanceStore(client)
    await store.savePayment({ contractVersion: '1.0.0', paymentId: 'payment-prisma', tenantId: 'tenant-arg', commitmentId: 'order-prisma', provider: 'mercado-pago', providerReference: 'mp-prisma', providerStatus: 'pending', commercialStatus: 'held', amount: 2500, currency: 'ARS', idempotencyKey: 'pay-prisma', correlationId: 'corr-prisma', credentialsCollected: false, source: 'authorized', orderId: 'order-prisma', posOperationId: null, merchantOfRecord: 'tus-intermediary', collectionModel: 'intermediary', splitPolicy: { name: 'five-day-intermediary', version: 'argentina-five-day-v1', holdDays: 5, releaseRule: 'completion-confirmation-or-approved-policy', merchantOfRecord: 'tus-intermediary', providerEvidenceId: null, legalEvidenceId: null }, releaseAt: 1000, providerEventAt: 2000, providerError: null, createdAt: 0, updatedAt: 0 })
    console.log(JSON.stringify({ releaseAtDate: captured.fechaLiberacion instanceof Date, providerEventAtDate: captured.fechaEventoProveedor instanceof Date, releaseAt: captured.fechaLiberacion.getTime(), providerEventAt: captured.fechaEventoProveedor.getTime(), hasEnglishKeys: ['paymentId', 'providerStatus', 'amount', 'createdAt'].some((key) => key in captured), provider: captured.proveedor, amount: captured.monto }))
  `)

  assert.equal(result.releaseAtDate, true)
  assert.equal(result.providerEventAtDate, true)
  assert.equal(result.releaseAt, 1000)
  assert.equal(result.providerEventAt, 2000)
  assert.equal(result.hasEnglishKeys, false)
  assert.equal(result.provider, 'mercado-pago')
  assert.equal(result.amount, 2500)
})

test('uses Spanish Prisma delegates for idempotency without translating provider values', () => {
  const result = runTypeScriptScenario(`
    const { PrismaTusFinanceStore } = (await import('./apps/api/src/tus/finance/prisma.ts')).default
    let captured
    const client = { idempotenciaFinanciera: { findUnique: async () => ({ hashSolicitud: 'hash-idem', respuesta: { status: 'created', provider: 'mercado-pago' } }), upsert: async (input) => { captured = input; return input.create } } }
    const store = new PrismaTusFinanceStore(client)
    await store.saveIdempotency('tenant-arg', 'pay-idem', { requestHash: 'hash-idem', response: { status: 'created', provider: 'mercado-pago' } })
    const found = await store.getIdempotency('tenant-arg', 'pay-idem')
    console.log(JSON.stringify({ where: captured.where, create: captured.create, found }))
  `)

  assert.deepEqual(result.where, { tenantId_claveIdempotencia: { tenantId: 'tenant-arg', claveIdempotencia: 'pay-idem' } })
  assert.equal(result.create.claveIdempotencia, 'pay-idem')
  assert.equal(result.create.hashSolicitud, 'hash-idem')
  assert.equal(result.create.respuesta.provider, 'mercado-pago')
  assert.deepEqual(result.found, { requestHash: 'hash-idem', response: { status: 'created', provider: 'mercado-pago' } })
})

test('keeps the three payment models Spanish internally while preserving physical PostgreSQL names', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')

  assert.match(schema, /model IntencionPago[\s\S]*?monto\s+BigInt\s+@map\("amount"\)/)
  assert.match(schema, /model IntencionPago[\s\S]*?@@unique\(\[tenantId, compromisoId\], map: "TusPaymentIntent_tenantId_commitmentId_key"\)/)
  assert.match(schema, /model IdempotenciaFinanciera[\s\S]*?claveIdempotencia\s+String\s+@map\("idempotencyKey"\)/)
  assert.match(schema, /model EventoWebhookPago[\s\S]*?datosEvento\s+Json\s+@map\("payload"\)/)
  assert.match(schema, /@@unique\(\[tenantId, proveedor, eventoProveedorId\], map: "TusPaymentWebhookEvent_tenant_provider_event_key"\)/)
  assert.doesNotMatch(schema, /model (TusPaymentIntent|TusFinanceIdempotency|TusPaymentWebhookEvent)\b/)
})
