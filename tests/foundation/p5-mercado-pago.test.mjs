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

function fixture(overrides = {}) {
  return {
    secret: 'fixture-secret-only',
    context: { tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a' },
    event: {
      eventId: 'mp-event-1',
      requestId: 'mp-request-1',
      timestamp: 1_700_000_000,
      externalPaymentId: 'mp-payment-1',
      action: 'payment.approved',
      payload: { data: { id: 'mp-payment-1' }, type: 'payment', action: 'payment.approved' },
    },
    ...overrides,
  }
}

test('P5.2 payment schemas are strict, versioned, tenant-scoped contracts', () => {
  for (const name of [
    'payment-intent.v1.schema.json',
    'payment-webhook-receipt.v1.schema.json',
    'payment-event.v1.schema.json',
    'payment-delivery.v1.schema.json',
  ]) {
    const schema = JSON.parse(
      readFileSync(join(root, 'packages/contracts/schemas/payments', name), 'utf8')
    )
    assert.equal(schema.type, 'object')
    assert.equal(schema.additionalProperties, false)
    assert.ok(schema.required.includes('contractVersion'))
    assert.ok(schema.required.includes('tenantId'))
    assert.match(schema.$id, /payments\/[a-z-]+\.v1\.schema\.json$/)
  }
})

test('P5.2 accepts a signed webhook only after tenant-safe receipt and outbox processing', () => {
  const input = fixture()
  const result = runTypeScriptScenario(`
    const { MercadoPagoAdapter, DeterministicMercadoPagoProvider, InMemoryMercadoPagoStore, createMercadoPagoSignature } = (await import('./apps/api/src/providers/mercado-pago/index.ts')).default
    const provider = new DeterministicMercadoPagoProvider()
    provider.setPayment('mp-payment-1', { amount: 1250, currency: 'ARS', status: 'approved' })
    const store = new InMemoryMercadoPagoStore()
    const adapter = new MercadoPagoAdapter({ secret: ${JSON.stringify(input.secret)}, store, provider, maxAttempts: 2, retryDelayMs: 10 })
    const event = ${JSON.stringify(input.event)}
    const processed = await adapter.receiveWebhook({ ...event, context: ${JSON.stringify(input.context)}, signature: createMercadoPagoSignature(${JSON.stringify(input.secret)}, event.eventId, event.requestId, event.timestamp) })
    console.log(JSON.stringify({ processed, payment: store.getPayment('tenant-a', 'mp-payment-1'), receipts: store.listReceipts('tenant-a'), outbox: store.listOutbox('tenant-a'), saga: store.getSaga('tenant-a', 'mp-event-1'), calls: provider.lookupCalls }))
  `)

  assert.equal(result.processed.status, 'processed')
  assert.equal(result.processed.receipt.status, 'processed')
  assert.equal(result.payment.status, 'approved')
  assert.equal(result.outbox.length, 1)
  assert.equal(result.outbox[0].tenantId, 'tenant-a')
  assert.equal(result.saga.status, 'completed')
  assert.equal(result.calls, 1)
})

test('P5.2 records and rejects forged webhooks before any state change', () => {
  const input = fixture()
  const result = runTypeScriptScenario(`
    const { MercadoPagoAdapter, DeterministicMercadoPagoProvider, InMemoryMercadoPagoStore } = (await import('./apps/api/src/providers/mercado-pago/index.ts')).default
    const store = new InMemoryMercadoPagoStore()
    const adapter = new MercadoPagoAdapter({ secret: ${JSON.stringify(input.secret)}, store, provider: new DeterministicMercadoPagoProvider() })
    const event = ${JSON.stringify(input.event)}
    const rejected = await adapter.receiveWebhook({ ...event, context: ${JSON.stringify(input.context)}, signature: 'ts=1700000000,v1=forged' })
    console.log(JSON.stringify({ rejected, receipts: store.listReceipts('tenant-a'), payments: store.listPayments('tenant-a'), outbox: store.listOutbox('tenant-a') }))
  `)

  assert.equal(result.rejected.status, 'rejected')
  assert.equal(result.rejected.reason, 'invalid_signature')
  assert.equal(result.receipts[0].status, 'rejected')
  assert.equal(result.payments.length, 0)
  assert.equal(result.outbox.length, 0)
})

test('P5.2 rejects replayed webhooks without duplicating payment effects', () => {
  const input = fixture()
  const result = runTypeScriptScenario(`
    const { MercadoPagoAdapter, DeterministicMercadoPagoProvider, InMemoryMercadoPagoStore, createMercadoPagoSignature } = (await import('./apps/api/src/providers/mercado-pago/index.ts')).default
    const provider = new DeterministicMercadoPagoProvider()
    provider.setPayment('mp-payment-1', { amount: 1250, currency: 'ARS', status: 'approved' })
    const store = new InMemoryMercadoPagoStore()
    const adapter = new MercadoPagoAdapter({ secret: ${JSON.stringify(input.secret)}, store, provider })
    const event = ${JSON.stringify(input.event)}
    const request = { ...event, context: ${JSON.stringify(input.context)}, signature: createMercadoPagoSignature(${JSON.stringify(input.secret)}, event.eventId, event.requestId, event.timestamp) }
    const first = await adapter.receiveWebhook(request)
    const replay = await adapter.receiveWebhook(request)
    const foreign = await adapter.getPayment({ tenantId: 'tenant-b', paymentId: 'mp-payment-1' })
    console.log(JSON.stringify({ first, replay, foreign, paymentCount: store.listPayments('tenant-a').length, outboxCount: store.listOutbox('tenant-a').length, calls: provider.lookupCalls }))
  `)

  assert.equal(result.first.status, 'processed')
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.foreign, null)
  assert.equal(result.paymentCount, 1)
  assert.equal(result.outboxCount, 1)
  assert.equal(result.calls, 1)
})

test('P5.2 retries deterministically, compensates the saga, and quarantines poison delivery', () => {
  const input = fixture()
  const result = runTypeScriptScenario(`
    const { MercadoPagoAdapter, DeterministicMercadoPagoProvider, InMemoryMercadoPagoStore, createMercadoPagoSignature } = (await import('./apps/api/src/providers/mercado-pago/index.ts')).default
    const provider = new DeterministicMercadoPagoProvider()
    provider.setPayment('mp-payment-1', { amount: 1250, currency: 'ARS', status: 'approved' })
    provider.failNext = 2
    const store = new InMemoryMercadoPagoStore()
    const adapter = new MercadoPagoAdapter({ secret: ${JSON.stringify(input.secret)}, store, provider, maxAttempts: 2, retryDelayMs: 10 })
    const event = ${JSON.stringify(input.event)}
    const request = { ...event, context: ${JSON.stringify(input.context)}, signature: createMercadoPagoSignature(${JSON.stringify(input.secret)}, event.eventId, event.requestId, event.timestamp) }
    const initial = await adapter.receiveWebhook(request)
    const deadLetter = await adapter.retryNext(1700000000011, 'tenant-a')
    const reconciliation = await adapter.reconcile(1700000000012, 'tenant-a')
    console.log(JSON.stringify({ initial, deadLetter, reconciliation, dlq: store.listDeadLetters('tenant-a'), saga: store.getSaga('tenant-a', 'mp-event-1'), receipt: store.listReceipts('tenant-a')[0] }))
  `)

  assert.equal(result.initial.status, 'retryable')
  assert.equal(result.deadLetter.status, 'dead_letter')
  assert.equal(result.dlq.length, 1)
  assert.equal(result.saga.status, 'compensated')
  assert.equal(result.reconciliation.status, 'recovered')
  assert.equal(result.receipt.status, 'failed')
})

test('P5.2 deterministic reference fallback emits a signed local webhook fixture', () => {
  const result = runTypeScriptScenario(`
    const { createPaymentFallbackFixture } = (await import('./apps/reference/fallback/payment/index.ts')).default
    const fixture = createPaymentFallbackFixture()
    console.log(JSON.stringify({ keys: Object.keys(fixture).sort(), tenantId: fixture.context.tenantId, eventId: fixture.event.eventId, hasSecret: Boolean(fixture.secret) }))
  `)

  assert.deepEqual(result.keys, ['context', 'event', 'secret'])
  assert.equal(result.tenantId, 'fixture-tenant')
  assert.equal(result.eventId, 'fixture-payment-event')
  assert.equal(result.hasSecret, true)
})
