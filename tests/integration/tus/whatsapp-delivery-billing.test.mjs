import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

function staffContext(overrides = {}) {
  return {
    sessionId: 'session-comms-delivery',
    subjectId: 'operator-a',
    tenantId: 'tenant-a',
    roles: ['operator'],
    permissions: ['tus:whatsapp:write', 'tus:delivery:write', 'tus:delivery:read'],
    correlationId: 'corr-comms-delivery',
    ...overrides,
  }
}

test('phase 7 governs consent, template variables, opt-out, support handoff, audit, and outbox', () => {
  const result = runTypeScriptScenario(`
    const { TusWhatsAppService, InMemoryWhatsAppActionStore } = (await import('./apps/api/src/tus/whatsapp/index.ts')).default
    let now = Date.parse('2026-09-09T12:00:00.000Z')
    const store = new InMemoryWhatsAppActionStore()
    const service = new TusWhatsAppService({
      store,
      now: () => now,
      templateAllowlist: [{ name: 'order_status', version: '1', variables: ['orderId', 'status'] }],
      supportHandoff: async ({ reason }) => ({ handoffId: 'support-' + reason }),
    })
    const context = ${JSON.stringify(staffContext())}
    const consent = await service.recordConsent(context, { recipientType: 'customer', recipientId: 'customer-a', source: 'checkout', granted: true })
    const queued = await service.sendTemplate(context, { recipientType: 'customer', recipientId: 'customer-a', template: 'order_status', templateVersion: '1', variables: { orderId: 'order-a', status: 'ready', token: 'secret=do-not-send' }, idempotencyKey: 'wa-template-1', requestHash: 'hash-1' })
    let templateConflict = ''
    try { await service.sendTemplate(context, { recipientType: 'customer', recipientId: 'customer-a', template: 'order_status', templateVersion: '1', variables: { orderId: 'order-other', status: 'ready' }, idempotencyKey: 'wa-template-1', requestHash: 'hash-other' }) } catch (error) { templateConflict = error.code }
    const handoff = await service.handoffToSupport(context, { senderId: 'customer-a', reason: 'refund_request' })
    const optedOut = await service.optOut(context, { recipientType: 'customer', recipientId: 'customer-a', source: 'whatsapp' })
    let blocked = ''
    try { await service.sendTemplate(context, { recipientType: 'customer', recipientId: 'customer-a', template: 'order_status', templateVersion: '1', variables: { orderId: 'order-b', status: 'ready' }, idempotencyKey: 'wa-template-2', requestHash: 'hash-2' }) } catch (error) { blocked = error.code }
   console.log(JSON.stringify({ consent, queued, templateConflict, handoff, optedOut, blocked, outbox: store.listOutbox('tenant-a'), audits: store.listAudits('tenant-a') }))
  `)

  assert.equal(result.consent.status, 'active')
  assert.equal(result.queued.status, 'queued')
  assert.equal(result.templateConflict, 'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(result.queued.variables, { orderId: 'order-a', status: 'ready' })
  assert.equal(result.handoff.status, 'handoff')
  assert.equal(result.optedOut.status, 'revoked')
  assert.equal(result.blocked, 'CONSENT_REQUIRED')
  assert.equal(result.outbox.length, 2)
  assert.equal(result.outbox[0].payload.variables.token, undefined)
  assert.equal(result.audits.some(({ action }) => action === 'whatsapp.consent.revoked'), true)
})

test('phase 7 fails closed for disabled or rate-limited signed webhook traffic and rejects stale signatures', () => {
  const result = runTypeScriptScenario(`
    const { WhatsAppAdapter, DeterministicWhatsAppProvider, InMemoryWhatsAppStore, createWhatsAppSignature } = (await import('./apps/api/src/providers/whatsapp/index.ts')).default
    const secret = 'fixture-secret-phase-7'
    const provider = new DeterministicWhatsAppProvider()
    const store = new InMemoryWhatsAppStore()
    const base = { eventId: 'wa-phase-7-a', requestId: 'req-a', timestamp: 1000, phoneNumberId: 'phone-a', messageId: 'message-a', from: 'sender-a', to: 'tenant-a', messageType: 'text', text: 'status', context: { tenantId: 'tenant-a', actorId: 'gateway', correlationId: 'corr-wa-7' } }
    const signature = (event) => ({ ...event, signature: createWhatsAppSignature(secret, event.eventId, event.requestId, event.timestamp) })
    const adapter = new WhatsAppAdapter({ secret, store, provider, policies: [{ tenantId: 'tenant-a', phoneNumberId: 'phone-a', allowedSenders: ['sender-a'] }], clock: () => 1000 * 1000, freshnessMs: 60 * 1000, rateLimit: { maxPerWindow: 1, windowMs: 60 * 1000 } })
    const first = await adapter.receiveWebhook(signature(base))
    const forgedReplay = await adapter.receiveWebhook({ ...base, signature: createWhatsAppSignature('wrong-secret', base.eventId, base.requestId, base.timestamp) })
    const limited = await adapter.receiveWebhook(signature({ ...base, eventId: 'wa-phase-7-b', requestId: 'req-b', messageId: 'message-b' }))
    const stale = await adapter.receiveWebhook(signature({ ...base, eventId: 'wa-phase-7-c', requestId: 'req-c', messageId: 'message-c', timestamp: 1 }))
    const disabled = new WhatsAppAdapter({ secret, store: new InMemoryWhatsAppStore(), provider, providerEnabled: false, policies: [{ tenantId: 'tenant-a', phoneNumberId: 'phone-a', allowedSenders: ['sender-a'] }], clock: () => 1000 * 1000, freshnessMs: 60 * 1000 })
    const closed = await disabled.receiveWebhook(signature({ ...base, eventId: 'wa-phase-7-d', requestId: 'req-d', messageId: 'message-d' }))
   console.log(JSON.stringify({ first, forgedReplay, limited, stale, closed, sends: provider.sendCalls }))
  `)

  assert.equal(result.first.status, 'processed')
  assert.equal(result.forgedReplay.status, 'rejected')
  assert.equal(result.forgedReplay.reason, 'invalid_signature')
  assert.equal(result.limited.status, 'rejected')
  assert.equal(result.limited.reason, 'rate_limited')
  assert.equal(result.stale.status, 'rejected')
  assert.equal(result.stale.reason, 'stale_signature')
  assert.equal(result.closed.status, 'rejected')
  assert.equal(result.closed.reason, 'provider_disabled')
  assert.equal(result.sends, 1)
})

test('phase 7 retries provider timeout through the idempotent delivery job without duplicating the message', () => {
  const result = runTypeScriptScenario(`
    const { WhatsAppAdapter, DeterministicWhatsAppProvider, InMemoryWhatsAppStore, createWhatsAppSignature } = (await import('./apps/api/src/providers/whatsapp/index.ts')).default
    const secret = 'fixture-secret-phase-7-timeout'
    const provider = new DeterministicWhatsAppProvider()
    provider.timeoutNext = 1
    const store = new InMemoryWhatsAppStore()
    const adapter = new WhatsAppAdapter({ secret, store, provider, maxAttempts: 2, retryDelayMs: 1, policies: [{ tenantId: 'tenant-a', phoneNumberId: 'phone-a', allowedSenders: ['sender-a'] }] })
    const event = { eventId: 'wa-timeout-a', requestId: 'req-timeout-a', timestamp: 1000, phoneNumberId: 'phone-a', messageId: 'message-timeout-a', from: 'sender-a', to: 'tenant-a', messageType: 'text', text: 'status', context: { tenantId: 'tenant-a', actorId: 'gateway', correlationId: 'corr-wa-timeout' } }
    const request = { ...event, signature: createWhatsAppSignature(secret, event.eventId, event.requestId, event.timestamp) }
    const retryable = await adapter.receiveWebhook(request)
    const processed = await adapter.retryNext(1000002, 'tenant-a')
    const replay = await adapter.receiveWebhook(request)
    console.log(JSON.stringify({ retryable, processed, replay, sends: provider.sendCalls, messages: store.listMessages('tenant-a'), outbox: store.listOutbox('tenant-a') }))
  `)

  assert.equal(result.retryable.status, 'retryable')
  assert.equal(result.processed.status, 'processed')
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.sends, 2)
  assert.equal(result.messages.length, 1)
  assert.equal(result.outbox.length, 1)
})

test('phase 8 records owned delivery SLA timestamps and proof before handoff', () => {
  const result = runTypeScriptScenario(`
    const { TusDeliveryService, InMemoryDeliveryStore } = (await import('./apps/api/src/tus/delivery/index.ts')).default
    let now = Date.parse('2026-09-09T09:00:00.000Z')
    const delivery = new TusDeliveryService({ store: new InMemoryDeliveryStore(), now: () => now })
    const context = ${JSON.stringify(staffContext({ permissions: ['tus:delivery:write', 'tus:delivery:read'] }))}
    const zone = await delivery.createZone(context, { zoneId: 'zone-a', name: 'Palermo', postalCodes: ['1425'] })
    const shift = await delivery.openShift(context, { shiftId: 'shift-a', zoneId: zone.zoneId, startsAt: '2026-09-09T08:00:00.000Z', endsAt: '2026-09-09T18:00:00.000Z', operatorIds: ['operator-a'] })
    const task = await delivery.createTask(context, { taskId: 'task-a', commitment: { commitmentId: 'order-a', tenantId: 'tenant-a', context: 'product', merchantId: 'merchant-a', amount: 1000, currency: 'ARS' }, zoneId: zone.zoneId, shiftId: shift.shiftId, sla: { pickupDueAt: '2026-09-09T10:00:00.000Z', dropoffDueAt: '2026-09-09T13:00:00.000Z' } })
    const accepted = await delivery.acceptTask(context, task.taskId, task.version)
    now += 60 * 60 * 1000
    const pickedUp = await delivery.transitionTask(context, task.taskId, 'picked-up', accepted.version)
    const inTransit = await delivery.transitionTask(context, task.taskId, 'in-transit', pickedUp.version)
    const proof = await delivery.recordProof(context, { taskId: task.taskId, proofId: 'proof-a', recipientName: 'Recipient', capturedAt: new Date(now).toISOString(), evidenceSource: 'deterministic-test-only' }, inTransit.version)
    const handedOff = await delivery.transitionTask(context, task.taskId, 'handed-off', proof.version)
    const delivered = await delivery.transitionTask(context, task.taskId, 'delivered', handedOff.version)
    let terminalFailure = ''
    try { await delivery.failTask(context, task.taskId, { incidentId: 'incident-terminal', reason: 'late_report' }, delivered.version) } catch (error) { terminalFailure = error.code }
    const sla = await delivery.evaluateSla(context, task.taskId, Date.parse('2026-09-09T14:00:00.000Z'))
    const afterSla = await delivery.getTask(context, task.taskId)
    console.log(JSON.stringify({ task, handedOff, delivered, terminalFailure, sla, afterSla, outbox: delivery.store.listOutbox('tenant-a'), audits: delivery.audit.list('tenant-a') }))
  `)

  assert.equal(result.task.sla.pickupDueAt, '2026-09-09T10:00:00.000Z')
  assert.equal(result.handedOff.status, 'handed-off')
  assert.equal(result.delivered.status, 'delivered')
  assert.equal(result.terminalFailure, 'INVALID_TRANSITION')
  assert.equal(result.afterSla.sla.status, 'breached')
  assert.equal(result.handedOff.pickup.pickedUpAt !== null, true)
  assert.equal(result.handedOff.dropoff.handedOffAt !== null, true)
  assert.equal(result.handedOff.proof.evidenceSource, 'deterministic-test-only')
  assert.equal(result.sla.status, 'breached')
  assert.equal(result.outbox.some(({ eventType }) => eventType === 'delivery.task.handed-off'), true)
})

test('phase 8 enforces operator ownership, tenant isolation, cancellation, failed return, and no external bidding', () => {
  const result = runTypeScriptScenario(`
    const { TusDeliveryService, InMemoryDeliveryStore } = (await import('./apps/api/src/tus/delivery/index.ts')).default
    const delivery = new TusDeliveryService({ store: new InMemoryDeliveryStore(), now: () => Date.parse('2026-09-09T09:00:00.000Z') })
    const owner = ${JSON.stringify(staffContext({ permissions: ['tus:delivery:write', 'tus:delivery:read'] }))}
    const other = ${JSON.stringify(staffContext({ subjectId: 'operator-b', sessionId: 'session-b' }))}
    await delivery.createZone(owner, { zoneId: 'zone-b', name: 'Recoleta', postalCodes: [] })
    await delivery.openShift(owner, { shiftId: 'shift-b', zoneId: 'zone-b', startsAt: '2026-09-09T08:00:00.000Z', endsAt: '2026-09-09T18:00:00.000Z', operatorIds: ['operator-a'] })
    const task = await delivery.createTask(owner, { taskId: 'task-b', commitment: { commitmentId: 'order-b', tenantId: 'tenant-a', context: 'product', merchantId: 'merchant-a', amount: 1000, currency: 'ARS' }, zoneId: 'zone-b', shiftId: 'shift-b' })
    let ownership = ''
    try { await delivery.acceptTask(other, task.taskId, task.version) } catch (error) { ownership = error.code }
    let failureOwnership = ''
    try { await delivery.failTask(other, task.taskId, { incidentId: 'incident-foreign', reason: 'recipient_unavailable' }, task.version) } catch (error) { failureOwnership = error.code }
    let foreign = ''
    try { await delivery.getTask({ ...owner, tenantId: 'tenant-b', sessionId: 'session-foreign' }, task.taskId) } catch (error) { foreign = error.code }
    const cancelled = await delivery.cancelTask(owner, task.taskId, task.version, 'customer_requested')
    let bidding = ''
    try { await delivery.openPublicBidding(owner, { taskId: task.taskId }) } catch (error) { bidding = error.code }
   console.log(JSON.stringify({ ownership, failureOwnership, foreign, cancelled, bidding, audits: delivery.audit.list('tenant-a'), outbox: delivery.store.listOutbox('tenant-a') }))
  `)

  assert.equal(result.ownership, 'FORBIDDEN')
  assert.equal(result.failureOwnership, 'FORBIDDEN')
  assert.equal(result.foreign, 'FORBIDDEN')
  assert.equal(result.cancelled.status, 'cancelled')
  assert.equal(result.bidding, 'OUT_OF_SCOPE')
  assert.equal(result.outbox.some(({ eventType }) => eventType === 'delivery.task.cancelled'), true)
  assert.equal(result.audits.some(({ action, outcome }) => action === 'delivery.task.cancelled' && outcome === 'allowed'), true)
})

test('phase 7 and 8 persistence contracts are additive, tenant-keyed, and retention-aware', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260909150000_tus_comms_delivery_controls/migration.sql'), 'utf8')
  const router = readFileSync(join(root, 'apps/api/src/tus/http/router.ts'), 'utf8')
  assert.match(schema, /model OutboxWhatsApp[\s\S]*?tenantId\s+String[\s\S]*?retencionHasta\s+DateTime\s+@map\("retentionUntil"\)/)
  assert.match(schema, /model TareaEntrega[\s\S]*?sla\s+Json\?[\s\S]*?fechaCancelacion\s+DateTime\?/)
  assert.match(migration, /ALTER TABLE "TusWhatsAppMessage" ADD COLUMN IF NOT EXISTS "variables" JSONB/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "TusWhatsAppOutbox"/)
  assert.match(migration, /ALTER TABLE "TusDeliveryTask" ADD COLUMN IF NOT EXISTS "sla" JSONB/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|CASCADE|DROP COLUMN/i)
  assert.match(router, /whatsapp\/consent/)
  assert.match(router, /whatsapp\/templates/)
  assert.match(router, /delivery\/tasks\/:taskId\/assign/)
  assert.match(router, /delivery\/tasks\/:taskId\/cancel/)
})
