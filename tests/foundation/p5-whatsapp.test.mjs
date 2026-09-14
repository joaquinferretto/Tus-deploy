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

test('BUILD 12E2 normaliza WhatsApp en Prisma y conserva tablas, columnas, indices y relaciones logicas', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migrations = [
    '20260827090700_tus_support_reporting/migration.sql',
    '20260909090000_tus_argentina_market_launch/migration.sql',
    '20260909150000_tus_comms_delivery_controls/migration.sql',
  ].map((file) => readFileSync(join(root, 'apps/api/prisma/migrations', file), 'utf8')).join('\n')
  const whatsappModels = schema.slice(schema.indexOf('model AccionWhatsApp {'), schema.indexOf('model TusWhatsAppOutbox {'))
  const models = [
    ['AccionWhatsApp', 'TusWhatsAppAction'],
    ['ConfirmacionWhatsApp', 'TusWhatsAppConfirmation'],
    ['AuditoriaWhatsApp', 'TusWhatsAppAudit'],
    ['ConsentimientoWhatsApp', 'TusWhatsAppConsent'],
    ['MensajeWhatsApp', 'TusWhatsAppMessage'],
    ['EventoWebhookWhatsApp', 'TusWhatsAppWebhookEvent'],
  ]

  for (const [model, table] of models) {
    assert.match(schema, new RegExp(`model ${model}\\s+\\{`))
    assert.match(schema, new RegExp(`@@map\\("${table}"\\)`))
    assert.doesNotMatch(schema, new RegExp(`model ${table}\\s+\\{`))
    assert.match(migrations, new RegExp(`"${table}"`))
  }
  assert.match(whatsappModels, /claveIdempotencia\s+String\s+@map\("idempotencyKey"\)/)
  assert.match(whatsappModels, /remitenteId\s+String\s+@map\("senderId"\)/)
  assert.match(whatsappModels, /destinatarioId\s+String\s+@map\("recipientId"\)/)
  assert.match(whatsappModels, /consentimientoId\s+String\s+@map\("consentId"\)/)
  assert.doesNotMatch(whatsappModels, /@relation\(/)
  for (const index of [
    'TusWhatsAppAction_tenantId_idempotencyKey_key',
    'TusWhatsAppConfirmation_tenantId_confirmationId_key',
    'TusWhatsAppConsent_tenantId_recipientId_key',
    'TusWhatsAppMessage_tenantId_messageId_key',
    'TusWhatsAppWebhookEvent_tenantId_providerEventId_key',
  ]) assert.match(schema, new RegExp(`map: "${index}"`))
})

test('BUILD 12E2 adapta el adapter Prisma WhatsApp sin traducir valores externos', () => {
  const result = runTypeScriptScenario(`
    const { PrismaWhatsAppActionStore } = (await import('./apps/api/src/tus/whatsapp/index.ts')).default
    const calls = []
    let actionRow = null
    let confirmationRow = null
    let consentRow = null
    let messageRow = null
    const client = {
      accionWhatsApp: { findUnique: async () => actionRow, findFirst: async () => actionRow, create: async (input) => { calls.push({ model: 'accionWhatsApp', method: 'create', input }); actionRow = input.data; return actionRow }, update: async (input) => { calls.push({ model: 'accionWhatsApp', method: 'update', input }); actionRow = { ...actionRow, ...input.data }; return actionRow } },
      confirmacionWhatsApp: { upsert: async (input) => { calls.push({ model: 'confirmacionWhatsApp', method: 'upsert', input }); confirmationRow = { ...input.create }; return confirmationRow }, findUnique: async () => confirmationRow, updateMany: async (input) => { calls.push({ model: 'confirmacionWhatsApp', method: 'updateMany', input }); confirmationRow = { ...confirmationRow, ...input.data }; return { count: 1 } } },
      auditoriaWhatsApp: { create: async (input) => { calls.push({ model: 'auditoriaWhatsApp', method: 'create', input }); return input.data } },
      consentimientoWhatsApp: { upsert: async (input) => { calls.push({ model: 'consentimientoWhatsApp', method: 'upsert', input }); consentRow = { ...input.create }; return consentRow }, findUnique: async () => consentRow },
      mensajeWhatsApp: { upsert: async (input) => { calls.push({ model: 'mensajeWhatsApp', method: 'upsert', input }); messageRow = { ...input.create }; return messageRow }, findUnique: async () => messageRow },
      tusWhatsAppOutbox: { create: async () => { throw new Error('outbox must not be touched by this scenario') }, findMany: async () => [] },
    }
    const store = new PrismaWhatsAppActionStore(client)
    const response = { status: 'completed', tenantId: 'tenant-a', credentialsCollected: false, mutated: false }
    await store.claim('tenant-a', 'key-a', 'hash-a')
    await store.complete('tenant-a', 'key-a', response)
    const actionResponse = await store.response('tenant-a', 'key-a')
    await store.saveConfirmation({ confirmationId: 'confirmation-a', tenantId: 'tenant-a', senderId: '5491100000000', expiresAt: 1700000005000, consumed: false, items: [] })
    const confirmation = await store.getConfirmation('tenant-a', 'confirmation-a')
    const consumed = await store.consumeConfirmation('tenant-a', 'confirmation-a', '5491100000000', 1700000001000)
    await store.registrarAuditoriaWhatsApp({ action: 'whatsapp.confirmation.consumed', outcome: 'allowed', tenantId: 'tenant-a', actorId: 'actor-a', senderId: '5491100000000', correlationId: 'corr-a', createdAt: '2026-09-14T12:00:00.000Z', retentionUntil: '2027-09-14T12:00:00.000Z' })
    await store.saveConsent({ consentId: 'consent-a', tenantId: 'tenant-a', recipientType: 'customer', recipientId: 'customer-a', status: 'active', source: 'checkout', grantedAt: '2026-09-14T12:00:00.000Z', revokedAt: null, updatedAt: '2026-09-14T12:00:00.000Z', retentionUntil: '2027-09-14T12:00:00.000Z' })
    const consent = await store.getConsent('tenant-a', 'customer', 'customer-a')
    await store.saveTemplateMessage({ messageId: 'message-a', tenantId: 'tenant-a', recipientType: 'customer', recipientId: 'customer-a', template: 'order_status', templateVersion: '1', consentId: 'consent-a', requestHash: 'hash-message', variables: { status: 'ready' }, correlationId: 'corr-a', status: 'queued', createdAt: '2026-09-14T12:00:00.000Z', retentionUntil: '2027-09-14T12:00:00.000Z' })
    const message = await store.getTemplateMessage('tenant-a', 'message-a')
    console.log(JSON.stringify({ actionResponse, confirmation, consumed, consent, message, calls }))
  `)

  assert.equal(result.actionResponse.status, 'completed')
  assert.equal(result.confirmation.senderId, '5491100000000')
  assert.equal(result.consumed, true)
  assert.equal(result.consent.recipientId, 'customer-a')
  assert.equal(result.message.template, 'order_status')
  assert.deepEqual(result.calls.map(({ model }) => model), ['accionWhatsApp', 'accionWhatsApp', 'confirmacionWhatsApp', 'confirmacionWhatsApp', 'auditoriaWhatsApp', 'consentimientoWhatsApp', 'mensajeWhatsApp'])
  assert.equal(result.calls[0].input.data.claveIdempotencia, 'key-a')
  assert.equal(result.calls[2].input.create.remitenteId, '5491100000000')
  assert.equal(result.calls[4].input.data.remitenteId, '5491100000000')
  assert.equal(result.calls[5].input.create.destinatarioId, 'customer-a')
  assert.equal(result.calls[6].input.create.plantilla, 'order_status')
  assert.equal(result.calls[6].input.create.consentimientoId, 'consent-a')
})

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
