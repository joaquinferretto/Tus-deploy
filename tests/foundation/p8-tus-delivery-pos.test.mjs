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

function productCommitment(overrides = {}) {
  return {
    commitmentId: 'commitment-delivery-1',
    tenantId: 'tenant-a',
    context: 'product',
    merchantId: 'merchant-a',
    status: 'pending',
    amount: 2400,
    currency: 'ARS',
    ...overrides,
  }
}

function context(overrides = {}) {
  return {
    sessionId: 'session-a',
    subjectId: 'staff-a',
    tenantId: 'tenant-a',
    roles: ['staff'],
    permissions: ['tus:delivery:write', 'tus:delivery:read', 'tus:pos:write'],
    correlationId: 'corr-delivery',
    ...overrides,
  }
}

test('WU5 runs a tenant-scoped delivery task from zone and shift through proof without settlement', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const application = createTusApplication()
    const delivery = application.delivery
    const staff = ${JSON.stringify(context())}
    const zone = await delivery.createZone(staff, { zoneId: 'zone-a', name: 'Palermo', postalCodes: ['1425'] })
    const shift = await delivery.openShift(staff, { shiftId: 'shift-a', zoneId: zone.zoneId, startsAt: '2026-08-26T09:00:00.000Z', endsAt: '2026-08-26T18:00:00.000Z', operatorIds: ['staff-a'] })
    const task = await delivery.createTask(staff, { taskId: 'task-a', commitment: ${JSON.stringify(productCommitment())}, zoneId: zone.zoneId, shiftId: shift.shiftId })
    const accepted = await delivery.acceptTask(staff, task.taskId, 0)
    const pickedUp = await delivery.transitionTask(staff, task.taskId, 'picked-up', accepted.version)
    const inTransit = await delivery.transitionTask(staff, task.taskId, 'in-transit', pickedUp.version)
    const proof = await delivery.recordProof(staff, { taskId: task.taskId, proofId: 'proof-a', recipientName: 'Recipient A', capturedAt: '2026-08-26T12:00:00.000Z', evidenceSource: 'deterministic-test-only' }, inTransit.version)
    const completed = await delivery.transitionTask(staff, task.taskId, 'handed-off', proof.version)
    let publicBidding = ''
    try { await delivery.openPublicBidding(staff, { taskId: task.taskId }) } catch (error) { publicBidding = error.code }
    console.log(JSON.stringify({ zone, shift, task, accepted, completed, proof: completed.proof, publicBidding, audits: delivery.audit.list('tenant-a'), settlement: completed.settlementClaim }))
  `)

  assert.equal(result.zone.tenantId, 'tenant-a')
  assert.equal(result.shift.status, 'open')
  assert.equal(result.task.context, 'product')
  assert.equal(result.accepted.status, 'accepted')
  assert.equal(result.completed.status, 'handed-off')
  assert.equal(result.proof.evidenceSource, 'deterministic-test-only')
  assert.equal(result.publicBidding, 'OUT_OF_SCOPE')
  assert.equal(result.settlement, 'not-claimed')
  assert.equal(result.audits.some(({ action, outcome }) => action === 'delivery.proof.recorded' && outcome === 'allowed'), true)
})

test('WU5 rejects service delivery, cross-tenant mutation, and failed handoff remains in incident review', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const application = createTusApplication()
    const delivery = application.delivery
    const staff = ${JSON.stringify(context())}
    await delivery.createZone(staff, { zoneId: 'zone-b', name: 'Recoleta', postalCodes: [] })
    await delivery.openShift(staff, { shiftId: 'shift-b', zoneId: 'zone-b', startsAt: '2026-08-26T09:00:00.000Z', endsAt: '2026-08-26T18:00:00.000Z', operatorIds: ['staff-a'] })
    let serviceError = ''
    try { await delivery.createTask(staff, { taskId: 'task-service', commitment: ${JSON.stringify(productCommitment({ commitmentId: 'service-1', context: 'service' }))}, zoneId: 'zone-b', shiftId: 'shift-b' }) } catch (error) { serviceError = error.code }
    const task = await delivery.createTask(staff, { taskId: 'task-failed', commitment: ${JSON.stringify(productCommitment({ commitmentId: 'commitment-failed' }))}, zoneId: 'zone-b', shiftId: 'shift-b' })
    let tenantError = ''
    try { await delivery.getTask({ ...staff, tenantId: 'tenant-b' }, task.taskId) } catch (error) { tenantError = error.code }
    const incident = await delivery.failTask(staff, task.taskId, { incidentId: 'incident-a', reason: 'recipient_unavailable' }, task.version)
    console.log(JSON.stringify({ serviceError, tenantError, incident, state: await delivery.getTask(staff, task.taskId), settlement: incident.task.settlementClaim }))
  `)

  assert.equal(result.serviceError, 'CONTEXT_MISMATCH')
  assert.equal(result.tenantError, 'FORBIDDEN')
  assert.equal(result.incident.status, 'incident-review')
  assert.equal(result.incident.incident.status, 'open')
  assert.equal(result.state.status, 'incident-review')
  assert.equal(result.settlement, 'not-claimed')
})

test('WU5 accepts scoped POS operations exactly once and preserves version conflicts without settlement', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const application = createTusApplication()
    const pos = application.pos
    const staff = ${JSON.stringify(context())}
    const operation = { operationId: 'operation-a', idempotencyKey: 'pos-key-a', schemaVersion: '1.0.0', deviceId: 'device-a', shiftId: 'shift-a', createdAt: '2026-08-26T12:00:00.000Z', expectedVersion: 0, kind: 'manual-sale', context: 'product', amount: 1200, currency: 'ARS' }
    const accepted = await pos.recordManualOperation(staff, operation)
    const replay = await pos.recordManualOperation(staff, operation)
    const conflict = await pos.recordManualOperation(staff, { ...operation, operationId: 'operation-b', idempotencyKey: 'pos-key-b', expectedVersion: 0 })
    let foreign = ''
    try { await pos.recordManualOperation({ ...staff, tenantId: 'tenant-b' }, { ...operation, tenantId: 'tenant-a', operationId: 'operation-foreign', idempotencyKey: 'pos-key-foreign' }) } catch (error) { foreign = error.code }
    console.log(JSON.stringify({ accepted, replay, conflict, foreign, operations: pos.store.listOperations('tenant-a'), receipts: pos.store.listReceipts('tenant-a'), audits: pos.audit.list('tenant-a') }))
  `)

  assert.equal(result.accepted.status, 'accepted')
  assert.equal(result.accepted.receipt.settlement, 'not-claimed')
  assert.deepEqual(result.replay, result.accepted)
  assert.equal(result.conflict.status, 'conflict')
  assert.equal(result.conflict.reason, 'version_conflict')
  assert.equal(result.foreign, 'FORBIDDEN')
  assert.equal(result.operations.length, 1)
  assert.equal(result.receipts.length, 1)
  assert.equal(result.receipts[0].providerCapture, 'not-claimed')
  assert.equal(result.audits.some(({ action, outcome }) => action === 'pos.operation.accepted' && outcome === 'allowed'), true)
})

test('WU5 replays offline POS commands and leaves conflicts pending for explicit reconciliation', () => {
  const result = runTypeScriptScenario(`
    const { createTusMobileClient } = (await import('./apps/mobile/src/application/tus-client.ts')).default
    let calls = 0
    let conflict = true
    let online = false
    const client = createTusMobileClient({ request: async ({ operation }) => { calls += 1; if (conflict) return { status: 'conflict', operationId: operation.operationId, reason: 'server_version_changed' }; return { status: 'accepted', operationId: operation.operationId } } }, { isOnline: () => online })
    const operation = { tenantId: 'tenant-a', actorId: 'staff-a', correlationId: 'corr-pos', operationId: 'offline-a', idempotencyKey: 'offline-key', kind: 'manual-sale', amount: 300, currency: 'ARS', deviceId: 'device-a', shiftId: 'shift-a', schemaVersion: '1.0.0', createdAt: '2026-08-26T12:00:00.000Z', expectedVersion: 0 }
    const queued = await client.recordManualOperation(operation)
    const stillOffline = await client.syncPendingOperations()
    online = true
    const conflictResult = await client.syncPendingOperations()
    conflict = false
    const reconciled = await client.resolveConflict(operation.operationId, 'retry')
    console.log(JSON.stringify({ queued, stillOffline, conflictResult, pending: client.pendingOperations(), reconciled, pendingAfter: client.pendingOperations(), calls }))
  `)

  assert.deepEqual(result.queued, { status: 'queued-offline', operationId: 'offline-a' })
  assert.equal(result.stillOffline[0].reason, 'offline')
  assert.equal(result.conflictResult[0].status, 'conflict')
  assert.equal(result.pending.length, 0)
  assert.equal(result.reconciled.status, 'accepted')
  assert.equal(result.pendingAfter.length, 0)
  assert.equal(result.calls, 2)
})

test('WU5 exposes web/PWA POS transport and relational delivery/POS source-of-truth models', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260826130000_tus_delivery_pos/migration.sql'), 'utf8')
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const calls = []
    const client = createTusWebClient({ request: async (input) => { calls.push(input); return { status: 'queued-offline', operationId: 'web-operation' } } })
    await client.recordManualOperation({ tenantId: 'tenant-a', actorId: 'staff-a', correlationId: 'corr-web', operationId: 'web-operation', idempotencyKey: 'web-key', kind: 'manual-service', amount: 900, currency: 'ARS', deviceId: 'browser-a', shiftId: 'shift-a', schemaVersion: '1.0.0', createdAt: '2026-08-26T12:00:00.000Z', expectedVersion: 0 })
    console.log(JSON.stringify(calls))
  `)

  assert.match(schema, /model ZonaEntrega[\s\S]*?tenantId\s+String/)
  assert.match(schema, /model TurnoEntrega[\s\S]*?zonaId\s+String/)
  assert.match(schema, /model TareaEntrega[\s\S]*?compromisoId\s+String/)
  assert.match(schema, /model EvidenciaEntrega[\s\S]*?origenEvidencia\s+String/)
  assert.match(schema, /model IncidenteEntrega[\s\S]*?motivo\s+String/)
  assert.match(schema, /model TusPosOperation[\s\S]*?expectedVersion\s+Int\?/)
  assert.match(schema, /model TusPosReceipt[\s\S]*?settlement\s+String/)
  assert.match(migration, /CREATE TABLE "TusDeliveryZone"/)
  assert.match(migration, /CREATE TABLE "TusDeliveryTask"/)
  assert.match(migration, /CREATE TABLE "TusPosOperation"/)
  assert.equal(result[0].path, '/tus/pos/manual-operations')
  assert.equal(result[0].method, 'POST')
})

test('WU5 mounts authenticated delivery and POS routes while denying spoofed tenant authority', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('pos-token', { sessionId: 'pos-session', subjectId: 'staff-a', tenantId: 'tenant-a', roles: ['staff'], permissions: ['tus:delivery:write', 'tus:delivery:read', 'tus:pos:write'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const address = server.address()
    const base = 'http://127.0.0.1:' + address.port
    const headers = { authorization: 'Bearer pos-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-http-pos' }
    const post = async (path, body) => { const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
    const zone = await post('/tus/v1/entrega/zones', { zoneId: 'zone-http', name: 'Centro', postalCodes: [] })
    const shift = await post('/tus/v1/entrega/shifts', { shiftId: 'shift-http', zoneId: 'zone-http', startsAt: '2026-08-26T09:00:00.000Z', endsAt: '2026-08-26T18:00:00.000Z', operatorIds: ['staff-a'] })
    const pos = await post('/tus/v1/pos/manual-operations', { operationId: 'operation-http', idempotencyKey: 'pos-http-key', schemaVersion: '1.0.0', deviceId: 'browser-a', shiftId: shift.body.shiftId, createdAt: '2026-08-26T12:00:00.000Z', expectedVersion: 0, kind: 'manual-service', context: 'service', amount: 900, currency: 'ARS' })
    const spoof = await post('/tus/v1/pos/manual-operations', { tenantId: 'tenant-b', operationId: 'operation-spoof', idempotencyKey: 'pos-spoof-key', schemaVersion: '1.0.0', deviceId: 'browser-a', shiftId: shift.body.shiftId, createdAt: '2026-08-26T12:00:00.000Z', expectedVersion: 1, kind: 'manual-service', context: 'service', amount: 900, currency: 'ARS' })
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    console.log(JSON.stringify({ zone, shift, pos, spoof }))
  `)

  assert.equal(result.zone.status, 201)
  assert.equal(result.shift.status, 201)
  assert.equal(result.pos.status, 201)
  assert.equal(result.pos.body.status, 'accepted')
  assert.equal(result.pos.body.receipt.settlement, 'not-claimed')
  assert.equal(result.spoof.status, 403)
})

test('WU5 persists pending POS commands across client instances and reconciles only after explicit retry', () => {
  const result = runTypeScriptScenario(`
    const { createTusMobileClient } = (await import('./apps/mobile/src/application/tus-client.ts')).default
    const runtime = { profile: 'dev', apiUrl: 'http://localhost:3101', requireTls: false, storageVersion: 1, tusContractVersion: '1.0.0', featureFlags: { offlineCache: true, mockAuth: true } }
    let records = { profile: 'dev', storageVersion: 1, operations: [] }
    let online = false
    const storage = { load: () => records, save: (envelope) => { records = envelope } }
    const operation = { tenantId: 'tenant-a', actorId: 'staff-a', correlationId: 'corr-persist', operationId: 'persisted-a', idempotencyKey: 'persisted-key', kind: 'manual-service', context: 'service', amount: 800, currency: 'ARS', deviceId: 'device-a', shiftId: 'shift-a', schemaVersion: '1.0.0', createdAt: '2026-08-26T12:00:00.000Z', expectedVersion: 0 }
    const first = createTusMobileClient({ request: async () => ({ status: 'accepted', operationId: operation.operationId }) }, { runtime, isOnline: () => online, storage })
    const queued = await first.recordManualOperation(operation)
    const storedBeforeSync = records.operations.length
    const second = createTusMobileClient({ request: async () => ({ status: 'accepted', operationId: operation.operationId }) }, { runtime, isOnline: () => online, storage })
    online = true
    const synced = await second.syncPendingOperations()
    console.log(JSON.stringify({ queued, storedBeforeSync, synced, pending: second.pendingOperations() }))
  `)

  assert.equal(result.queued.status, 'queued-offline')
  assert.equal(result.storedBeforeSync, 1)
  assert.equal(result.synced[0].status, 'accepted')
  assert.equal(result.pending.length, 0)
})
