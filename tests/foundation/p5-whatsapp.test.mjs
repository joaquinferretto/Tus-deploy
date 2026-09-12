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
    secret: 'fixture-whatsapp-secret-only',
    policy: {
      tenantId: 'tenant-a',
      phoneNumberId: 'phone-a',
      allowedSenders: ['5491100000000'],
    },
    context: { tenantId: 'tenant-a', actorId: 'whatsapp-gateway', correlationId: 'corr-a' },
    event: {
      eventId: 'wa-event-1',
      requestId: 'wa-request-1',
      timestamp: 1_700_000_000,
      phoneNumberId: 'phone-a',
      messageId: 'wa-message-1',
      from: '5491100000000',
      to: '5491100000001',
      messageType: 'text',
      text: 'hello from fixture',
    },
    ...overrides,
  }
}

test('P5.3 messaging schemas are strict, versioned, tenant-scoped contracts', () => {
  for (const name of [
    'messaging-message.v1.schema.json',
    'messaging-webhook-receipt.v1.schema.json',
    'messaging-event.v1.schema.json',
    'messaging-delivery.v1.schema.json',
  ]) {
    const schema = JSON.parse(
      readFileSync(join(root, 'packages/contracts/schemas/messaging', name), 'utf8')
    )
    assert.equal(schema.type, 'object')
    assert.equal(schema.additionalProperties, false)
    assert.ok(schema.required.includes('contractVersion'))
    assert.ok(schema.required.includes('tenantId'))
    assert.match(schema.$id, /messaging\/[a-z-]+\.v1\.schema\.json$/)
  }
})

test('P5.3 accepts a signed webhook only for the configured tenant policy', () => {
  const input = fixture()
  const result = runTypeScriptScenario(`
    const { WhatsAppAdapter, DeterministicWhatsAppProvider, InMemoryWhatsAppStore, createWhatsAppSignature } = (await import('./apps/api/src/providers/whatsapp/index.ts')).default
    const provider = new DeterministicWhatsAppProvider()
    const store = new InMemoryWhatsAppStore()
    const adapter = new WhatsAppAdapter({ secret: ${JSON.stringify(input.secret)}, store, provider, policies: [${JSON.stringify(input.policy)}], maxAttempts: 2, retryDelayMs: 10 })
    const event = ${JSON.stringify(input.event)}
    const processed = await adapter.receiveWebhook({ ...event, context: ${JSON.stringify(input.context)}, signature: createWhatsAppSignature(${JSON.stringify(input.secret)}, event.eventId, event.requestId, event.timestamp) })
    console.log(JSON.stringify({ processed, message: store.getMessage('tenant-a', 'wa-message-1'), receipts: store.listReceipts('tenant-a'), outbox: store.listOutbox('tenant-a'), saga: store.getSaga('tenant-a', 'wa-event-1'), sends: provider.sendCalls }))
  `)

  assert.equal(result.processed.status, 'processed')
  assert.equal(result.processed.receipt.status, 'processed')
  assert.equal(result.message.text, 'hello from fixture')
  assert.equal(result.message.tenantId, 'tenant-a')
  assert.equal(result.outbox.length, 1)
  assert.equal(result.outbox[0].payload.messageId, 'wa-message-1')
  assert.equal(result.saga.status, 'completed')
  assert.equal(result.sends, 1)
})

test('P5.3 rejects forged signatures and denied tenant policy before state change', () => {
  const input = fixture()
  const result = runTypeScriptScenario(`
    const { WhatsAppAdapter, DeterministicWhatsAppProvider, InMemoryWhatsAppStore, createWhatsAppSignature } = (await import('./apps/api/src/providers/whatsapp/index.ts')).default
    const store = new InMemoryWhatsAppStore()
    const provider = new DeterministicWhatsAppProvider()
    const adapter = new WhatsAppAdapter({ secret: ${JSON.stringify(input.secret)}, store, provider, policies: [${JSON.stringify(input.policy)}] })
    const event = ${JSON.stringify(input.event)}
    const forged = await adapter.receiveWebhook({ ...event, context: ${JSON.stringify(input.context)}, signature: 'ts=1700000000,v1=forged' })
    const denied = await adapter.receiveWebhook({ ...event, eventId: 'wa-event-denied', messageId: 'wa-message-denied', from: '5491199999999', context: ${JSON.stringify(input.context)}, signature: createWhatsAppSignature(${JSON.stringify(input.secret)}, 'wa-event-denied', event.requestId, event.timestamp) })
    console.log(JSON.stringify({ forged, denied, receipts: store.listReceipts('tenant-a'), messages: store.listMessages('tenant-a'), outbox: store.listOutbox('tenant-a'), sends: provider.sendCalls }))
  `)

  assert.equal(result.forged.status, 'rejected')
  assert.equal(result.forged.reason, 'invalid_signature')
  assert.equal(result.denied.status, 'rejected')
  assert.equal(result.denied.reason, 'tenant_policy_denied')
  assert.equal(result.messages.length, 0)
  assert.equal(result.outbox.length, 0)
  assert.equal(result.sends, 0)
})

test('P5.3 returns a replay outcome without duplicating messaging effects or crossing tenants', () => {
  const input = fixture()
  const result = runTypeScriptScenario(`
    const { WhatsAppAdapter, DeterministicWhatsAppProvider, InMemoryWhatsAppStore, createWhatsAppSignature } = (await import('./apps/api/src/providers/whatsapp/index.ts')).default
    const provider = new DeterministicWhatsAppProvider()
    const store = new InMemoryWhatsAppStore()
    const adapter = new WhatsAppAdapter({ secret: ${JSON.stringify(input.secret)}, store, provider, policies: [${JSON.stringify(input.policy)}] })
    const event = ${JSON.stringify(input.event)}
    const request = { ...event, context: ${JSON.stringify(input.context)}, signature: createWhatsAppSignature(${JSON.stringify(input.secret)}, event.eventId, event.requestId, event.timestamp) }
    const first = await adapter.receiveWebhook(request)
    const replay = await adapter.receiveWebhook(request)
    const foreign = store.getMessage('tenant-b', 'wa-message-1')
    console.log(JSON.stringify({ first, replay, foreign, messageCount: store.listMessages('tenant-a').length, outboxCount: store.listOutbox('tenant-a').length, sends: provider.sendCalls }))
  `)

  assert.equal(result.first.status, 'processed')
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.foreign, null)
  assert.equal(result.messageCount, 1)
  assert.equal(result.outboxCount, 1)
  assert.equal(result.sends, 1)
})

test('P5.3 retries deterministically, compensates the saga, and quarantines poison delivery', () => {
  const input = fixture()
  const result = runTypeScriptScenario(`
    const { WhatsAppAdapter, DeterministicWhatsAppProvider, InMemoryWhatsAppStore, createWhatsAppSignature } = (await import('./apps/api/src/providers/whatsapp/index.ts')).default
    const provider = new DeterministicWhatsAppProvider()
    provider.failNext = 2
    const store = new InMemoryWhatsAppStore()
    const adapter = new WhatsAppAdapter({ secret: ${JSON.stringify(input.secret)}, store, provider, policies: [${JSON.stringify(input.policy)}], maxAttempts: 2, retryDelayMs: 10 })
    const event = ${JSON.stringify(input.event)}
    const request = { ...event, context: ${JSON.stringify(input.context)}, signature: createWhatsAppSignature(${JSON.stringify(input.secret)}, event.eventId, event.requestId, event.timestamp) }
    const initial = await adapter.receiveWebhook(request)
    const deadLetter = await adapter.retryNext(1700000000011, 'tenant-a')
    const reconciliation = await adapter.reconcile(1700000000012, 'tenant-a')
    console.log(JSON.stringify({ initial, deadLetter, reconciliation, dlq: store.listDeadLetters('tenant-a'), saga: store.getSaga('tenant-a', 'wa-event-1'), receipt: store.listReceipts('tenant-a')[0] }))
  `)

  assert.equal(result.initial.status, 'retryable')
  assert.equal(result.deadLetter.status, 'dead_letter')
  assert.equal(result.dlq.length, 1)
  assert.equal(result.saga.status, 'compensated')
  assert.equal(result.reconciliation.status, 'recovered')
  assert.equal(result.receipt.status, 'failed')
})
