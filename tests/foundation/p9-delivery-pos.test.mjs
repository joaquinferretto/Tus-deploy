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

function context(overrides = {}) {
  return {
    sessionId: 'session-pos',
    subjectId: 'staff-pos',
    tenantId: 'tenant-pos',
    roles: ['staff'],
    permissions: ['tus:delivery:write', 'tus:delivery:read', 'tus:pos:write'],
    correlationId: 'corr-pos-9',
    ...overrides,
  }
}

function productCommitment(overrides = {}) {
  return {
    commitmentId: 'commitment-product-9',
    tenantId: 'tenant-pos',
    context: 'product',
    merchantId: 'merchant-pos',
    amount: 2400,
    currency: 'ARS',
    ...overrides,
  }
}

test('PR7 provisions a device and shift session before recording separate product and service POS receipts', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const application = createTusApplication()
    const staff = ${JSON.stringify(context())}
    const pos = application.pos
    const device = await pos.registerDevice(staff, { deviceId: 'device-9', label: 'Counter 9', fingerprint: 'fingerprint-9' })
    const session = await pos.openSession(staff, { sessionId: 'pos-session-9', deviceId: device.deviceId, shiftId: 'shift-9' })
    const product = await pos.recordManualOperation(staff, { operationId: 'sale-9', idempotencyKey: 'sale-key-9', schemaVersion: '1.0.0', deviceId: device.deviceId, shiftId: session.shiftId, createdAt: '2026-08-27T12:00:00.000Z', expectedVersion: 0, kind: 'manual-sale', context: 'product', amount: 1200, currency: 'ARS' })
    const service = await pos.recordManualOperation(staff, { operationId: 'service-9', idempotencyKey: 'service-key-9', schemaVersion: '1.0.0', deviceId: device.deviceId, shiftId: session.shiftId, createdAt: '2026-08-27T12:01:00.000Z', expectedVersion: 1, kind: 'manual-service', context: 'service', amount: 900, currency: 'ARS' })
    const closed = await pos.closeSession(staff, session.sessionId)
    console.log(JSON.stringify({ device, session, product, service, closed, receipts: pos.store.listReceipts(staff.tenantId), outbox: pos.store.listOutbox(staff.tenantId) }))
  `)

  assert.equal(result.device.status, 'active')
  assert.equal(result.session.status, 'open')
  assert.equal(result.product.status, 'accepted')
  assert.equal(result.service.status, 'accepted')
  assert.equal(result.closed.status, 'closed')
  assert.equal(result.receipts.length, 2)
  assert.equal(result.receipts.every((receipt) => receipt.providerCapture === 'not-claimed' && receipt.settlement === 'not-claimed'), true)
  assert.equal(result.receipts.every((receipt) => receipt.integrityHash.length === 64), true)
  assert.equal(result.outbox.length >= 4, true)
})

test('PR7 preserves delivery incidents and conflicts for explicit resolution without changing settlement state', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const application = createTusApplication()
    const delivery = application.delivery
    const staff = ${JSON.stringify(context())}
    const zone = await delivery.createZone(staff, { zoneId: 'zone-9', name: 'Palermo', postalCodes: ['1425'] })
    const shift = await delivery.openShift(staff, { shiftId: 'shift-9', zoneId: zone.zoneId, startsAt: '2026-08-27T09:00:00.000Z', endsAt: '2026-08-27T18:00:00.000Z', operatorIds: ['staff-pos'] })
    const task = await delivery.createTask(staff, { taskId: 'task-9', commitment: ${JSON.stringify(productCommitment())}, zoneId: zone.zoneId, shiftId: shift.shiftId })
    const accepted = await delivery.acceptTask(staff, task.taskId, task.version)
    let conflict = ''
    try { await delivery.transitionTask(staff, task.taskId, 'picked-up', task.version) } catch (error) { conflict = error.code }
    const pickedUp = await delivery.transitionTask(staff, task.taskId, 'picked-up', accepted.version)
    const inTransit = await delivery.transitionTask(staff, task.taskId, 'in-transit', pickedUp.version)
    const failed = await delivery.failTask(staff, task.taskId, { incidentId: 'incident-9', reason: 'recipient_unavailable' }, inTransit.version)
    const resolved = await delivery.resolveIncident(staff, task.taskId, failed.task.version)
    console.log(JSON.stringify({ conflict, failed, resolved, outbox: delivery.store.listOutbox(staff.tenantId), audits: delivery.audit.list(staff.tenantId) }))
  `)

  assert.equal(result.conflict, 'VERSION_CONFLICT')
  assert.equal(result.failed.task.status, 'incident-review')
  assert.equal(result.failed.incident.status, 'open')
  assert.equal(result.resolved.status, 'returned')
  assert.equal(result.resolved.incident.status, 'resolved')
  assert.equal(result.resolved.settlementClaim, 'not-claimed')
  assert.equal(result.outbox.some(({ eventType }) => eventType === 'delivery.incident.opened'), true)
  assert.equal(result.audits.some(({ action }) => action === 'delivery.incident.resolved'), true)
})

test('PR7 keeps offline POS conflicts pending until an explicit retry or discard and survives client reconstruction', () => {
  const result = runTypeScriptScenario(`
    const { createTusMobileClient } = (await import('./apps/mobile/src/application/tus-client.ts')).default
    const runtime = { profile: 'dev', apiUrl: 'http://localhost:3101', requireTls: false, storageVersion: 1, tusContractVersion: '1.0.0', featureFlags: { offlineCache: true, mockAuth: true } }
    let records = { profile: 'dev', storageVersion: 1, operations: [] }
    let online = false
    let serverConflict = true
    const operation = { tenantId: 'tenant-pos', actorId: 'staff-pos', correlationId: 'corr-mobile-9', operationId: 'offline-9', idempotencyKey: 'offline-key-9', kind: 'manual-sale', context: 'product', amount: 300, currency: 'ARS', deviceId: 'device-9', shiftId: 'shift-9', schemaVersion: '1.0.0', createdAt: '2026-08-27T12:00:00.000Z', expectedVersion: 0 }
    const storage = { load: () => records, save: (envelope) => { records = envelope } }
    const transport = { request: async ({ operation: next }) => serverConflict ? { status: 'conflict', operationId: next.operationId, reason: 'server_version_changed' } : { status: 'accepted', operationId: next.operationId } }
    const first = createTusMobileClient(transport, { runtime, isOnline: () => online, storage })
    const queued = await first.recordManualOperation(operation)
    online = true
    const conflict = await first.syncPendingOperations()
    const second = createTusMobileClient(transport, { runtime, isOnline: () => online, storage })
    const reconstructed = second.pendingOperations()
    serverConflict = false
    const retried = await second.resolveConflict(operation.operationId, 'retry')
    console.log(JSON.stringify({ queued, conflict, reconstructed, retried, after: second.pendingOperations() }))
  `)

  assert.deepEqual(result.queued, { status: 'queued-offline', operationId: 'offline-9' })
  assert.equal(result.conflict[0].status, 'conflict')
  assert.equal(result.reconstructed.length, 1)
  assert.equal(result.retried.status, 'accepted')
  assert.equal(result.after.length, 0)
})

test('PR7 publishes delivery/POS contracts and additive durable conflict/session/receipt boundaries', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260827090600_tus_delivery_pos/migration.sql'), 'utf8')
  const result = runTypeScriptScenario(`
    const contracts = await import('./packages/contracts/src/tus.ts')
    const operation = { contractVersion: '1.0.0', operationId: 'operation-contract-9', tenantId: 'tenant-pos', actorId: 'staff-pos', deviceId: 'device-9', shiftId: 'shift-9', idempotencyKey: 'contract-key-9', schemaVersion: '1.0.0', createdAt: '2026-08-27T12:00:00.000Z', kind: 'manual-service', context: 'service', amount: 900, currency: 'ARS' }
    const receipt = { contractVersion: '1.0.0', receiptId: 'receipt-contract-9', tenantId: 'tenant-pos', operationId: operation.operationId, kind: operation.kind, context: operation.context, amount: operation.amount, currency: operation.currency, status: 'pending', source: 'deterministic-test-only', providerCapture: 'not-claimed', settlement: 'not-claimed', integrityHash: 'a'.repeat(64), createdAt: operation.createdAt }
    console.log(JSON.stringify({ operation: contracts.validarOperacionPOS(operation).operationId, receipt: contracts.validarComprobantePOS(receipt).receiptId }))
  `)

  assert.equal(result.operation, 'operation-contract-9')
  assert.equal(result.receipt, 'receipt-contract-9')
  assert.match(schema, /model TusPosDevice[\s\S]*?deviceId\s+String/)
  assert.match(schema, /model TusPosSession[\s\S]*?shiftId\s+String/)
  assert.match(schema, /model TusPosConflict[\s\S]*?reason\s+String/)
  assert.match(schema, /integrityHash\s+String/)
  assert.match(migration, /CREATE TABLE "TusPosDevice"/)
  assert.match(migration, /CREATE TABLE "TusPosSession"/)
  assert.match(migration, /CREATE TABLE "TusPosConflict"/)
  assert.match(migration, /integrityHash/)
})

test('PR7 contract validators reject settlement claims and malformed provisioned identities', () => {
  const result = runTypeScriptScenario(`
    const contracts = await import('./packages/contracts/src/tus.ts')
    const device = { contractVersion: '1.0.0', deviceId: 'device-validator', tenantId: 'tenant-pos', label: 'Validator', fingerprint: 'fp', status: 'active', createdAt: '2026-08-27T12:00:00.000Z', updatedAt: '2026-08-27T12:00:00.000Z' }
    const session = { contractVersion: '1.0.0', sessionId: 'session-validator', tenantId: 'tenant-pos', deviceId: 'device-validator', actorId: 'staff-pos', shiftId: 'shift-9', status: 'open', openedAt: '2026-08-27T12:00:00.000Z' }
    let receiptError = ''
    try { contracts.validarComprobantePOS({ contractVersion: '1.0.0', receiptId: 'r', tenantId: 'tenant-pos', operationId: 'o', kind: 'manual-sale', context: 'product', amount: 1, currency: 'ARS', status: 'accepted', source: 'authorized', providerCapture: 'captured', settlement: 'released', integrityHash: 'a'.repeat(64), createdAt: '2026-08-27T12:00:00.000Z' }) } catch (error) { receiptError = error.message }
    console.log(JSON.stringify({ device: contracts.validarDispositivoPOS(device).deviceId, session: contracts.validarSesionPOS(session).sessionId, receiptError }))
  `)

  assert.equal(result.device, 'device-validator')
  assert.equal(result.session, 'session-validator')
  assert.match(result.receiptError, /receipt integrity or settlement state is invalid/)
})

test('PR7 fail-closes revoked devices, closed sessions, tampered receipts, and uncertain network replay', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { verifyPosReceipt } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const application = createTusApplication()
    const staff = ${JSON.stringify(context())}
    const pos = application.pos
    const device = await pos.registerDevice(staff, { deviceId: 'device-fail-closed', label: 'Fail closed', fingerprint: 'fp-fail-closed' })
    const session = await pos.openSession(staff, { sessionId: 'session-fail-closed', deviceId: device.deviceId, shiftId: 'shift-fail-closed' })
    const accepted = await pos.recordManualOperation(staff, { operationId: 'sale-fail-closed', idempotencyKey: 'sale-fail-closed', schemaVersion: '1.0.0', deviceId: device.deviceId, shiftId: session.shiftId, createdAt: '2026-08-27T12:00:00.000Z', expectedVersion: 0, kind: 'manual-sale', context: 'product', amount: 100, currency: 'ARS' })
    const tampered = { ...accepted.receipt, amount: 101 }
    await pos.closeSession(staff, session.sessionId)
    let closedError = ''
    try { await pos.recordManualOperation(staff, { operationId: 'sale-after-close', idempotencyKey: 'sale-after-close', schemaVersion: '1.0.0', deviceId: device.deviceId, shiftId: session.shiftId, createdAt: '2026-08-27T12:01:00.000Z', expectedVersion: 1, kind: 'manual-sale', context: 'product', amount: 100, currency: 'ARS' }) } catch (error) { closedError = error.code }
    await pos.revokeDevice(staff, device.deviceId)
    let revokedError = ''
    try { await pos.openSession(staff, { sessionId: 'session-revoked', deviceId: device.deviceId, shiftId: session.shiftId }) } catch (error) { revokedError = error.code }
    const offline = (await import('./apps/mobile/src/application/tus-client.ts')).default.createTusMobileClient({ request: async () => { throw new Error('timeout') } }, { isOnline: () => true })
    const uncertain = await offline.recordManualOperation({ tenantId: 'tenant-pos', actorId: 'staff-pos', correlationId: 'corr-fail-closed', operationId: 'offline-uncertain', idempotencyKey: 'offline-uncertain', kind: 'manual-service', context: 'service', amount: 100, currency: 'ARS', deviceId: 'device-fail-closed', shiftId: 'shift-fail-closed', schemaVersion: '1.0.0', createdAt: '2026-08-27T12:00:00.000Z' })
    console.log(JSON.stringify({ closedError, revokedError, receiptValid: verifyPosReceipt(accepted.receipt), tamperedValid: verifyPosReceipt(tampered), uncertain, pending: offline.pendingOperations() }))
  `)

  assert.equal(result.closedError, 'SESSION_REQUIRED')
  assert.equal(result.revokedError, 'DEVICE_UNAVAILABLE')
  assert.equal(result.receiptValid, true)
  assert.equal(result.tamperedValid, false)
  assert.equal(result.uncertain.status, 'pending')
  assert.equal(result.pending.length, 1)
})

test('PR7 exposes authenticated device/session provisioning over HTTP without accepting client authority', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('pos-http-token', { sessionId: 'auth-session-9', subjectId: 'staff-pos', tenantId: 'tenant-pos', roles: ['staff'], permissions: ['tus:delivery:write', 'tus:delivery:read', 'tus:pos:write'] })
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const port = server.address().port
    const headers = { authorization: 'Bearer pos-http-token', 'content-type': 'application/json', 'x-correlation-id': 'corr-http-9' }
    const post = async (path, body) => { const response = await fetch('http://127.0.0.1:' + port + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
    const device = await post('/tus/v1/pos/devices', { deviceId: 'device-http-9', label: 'HTTP counter', fingerprint: 'fp-http-9' })
    const session = await post('/tus/v1/pos/sessions', { sessionId: 'session-http-9', deviceId: device.body.deviceId, shiftId: 'shift-http-9' })
    const operation = await post('/tus/v1/pos/manual-operations', { operationId: 'operation-http-9', idempotencyKey: 'operation-http-key-9', schemaVersion: '1.0.0', deviceId: device.body.deviceId, shiftId: session.body.shiftId, createdAt: '2026-08-27T12:00:00.000Z', expectedVersion: 0, kind: 'manual-service', context: 'service', amount: 900, currency: 'ARS' })
    const spoof = await post('/tus/v1/pos/manual-operations', { tenantId: 'tenant-other', operationId: 'spoof-http-9', idempotencyKey: 'spoof-http-key-9', schemaVersion: '1.0.0', deviceId: device.body.deviceId, shiftId: session.body.shiftId, createdAt: '2026-08-27T12:00:00.000Z', expectedVersion: 1, kind: 'manual-service', context: 'service', amount: 900, currency: 'ARS' })
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    console.log(JSON.stringify({ device, session, operation, spoof }))
  `)

  assert.equal(result.device.status, 201)
  assert.equal(result.session.status, 201)
  assert.equal(result.operation.status, 201)
  assert.equal(result.operation.body.receipt.providerCapture, 'not-claimed')
  assert.equal(result.spoof.status, 403)
})

test('PR2 records delivery proof and completes a versioned handoff over the canonical HTTP route', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { InMemoryTusSessionResolver } = (await import('./apps/api/src/tus/adapters/in-memory.ts')).default
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const application = createTusApplication()
    const staff = ${JSON.stringify(context())}
    const delivery = application.delivery
    const zone = await delivery.createZone(staff, { zoneId: 'zone-http-handoff-9', name: 'Palermo', postalCodes: ['1425'] })
    const shift = await delivery.openShift(staff, { shiftId: 'shift-http-handoff-9', zoneId: zone.zoneId, startsAt: '2026-08-27T09:00:00.000Z', endsAt: '2026-08-27T18:00:00.000Z', operatorIds: ['staff-pos'] })
    const task = await delivery.createTask(staff, { taskId: 'task-http-handoff-9', commitment: ${JSON.stringify(productCommitment({ commitmentId: 'commitment-http-handoff-9' }))}, zoneId: zone.zoneId, shiftId: shift.shiftId })
    const accepted = await delivery.acceptTask(staff, task.taskId, task.version)
    const pickedUp = await delivery.transitionTask(staff, task.taskId, 'picked-up', accepted.version)
    const inTransit = await delivery.transitionTask(staff, task.taskId, 'in-transit', pickedUp.version)
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('handoff-http-token-9', staff)
    const app = createApp({ tusRouter: createTusHttpRouter({ application, sessions }) })
    const server = app.listen(0)
    const port = server.address().port
    const headers = { authorization: 'Bearer handoff-http-token-9', 'content-type': 'application/json', 'x-correlation-id': 'corr-http-handoff-9' }
    const post = async (path, body) => { const response = await fetch('http://127.0.0.1:' + port + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
    const proof = await post('/tus/v1/delivery/tasks/' + task.taskId + '/proof', { proofId: 'proof-http-handoff-9', recipientName: 'Recipient', capturedAt: '2026-08-27T12:00:00.000Z', evidenceSource: 'deterministic-test-only', expectedVersion: inTransit.version })
    const handoff = await post('/tus/v1/delivery/tasks/' + task.taskId + '/handoff', { expectedVersion: proof.body.version })
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    console.log(JSON.stringify({ proof, handoff, settlement: handoff.body.settlementClaim }))
  `)

  assert.equal(result.proof.status, 200)
  assert.equal(result.proof.body.proof.evidenceSource, 'deterministic-test-only')
  assert.equal(result.handoff.status, 200)
  assert.equal(result.handoff.body.status, 'handed-off')
  assert.equal(result.settlement, 'not-claimed')
})

test('PR2 rolls back every POS effect when a durable receipt write fails', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const originalSaveReceipt = store.saveReceipt.bind(store)
    store.saveReceipt = async () => { throw new Error('receipt write failed') }
    const pos = new TusPosService({ store })
    const staff = ${JSON.stringify(context())}
    const device = await pos.registerDevice(staff, { deviceId: 'device-atomic-9', label: 'Atomic counter', fingerprint: 'fp-atomic-9' })
    const session = await pos.openSession(staff, { sessionId: 'session-atomic-9', deviceId: device.deviceId, shiftId: 'shift-atomic-9' })
    let error = ''
    try {
      await pos.recordManualOperation(staff, { operationId: 'operation-atomic-9', idempotencyKey: 'operation-atomic-key-9', schemaVersion: '1.0.0', deviceId: device.deviceId, shiftId: session.shiftId, createdAt: '2026-08-27T12:00:00.000Z', expectedVersion: 0, kind: 'manual-sale', context: 'product', amount: 100, currency: 'ARS' })
    } catch (caught) { error = caught.message }
    store.saveReceipt = originalSaveReceipt
    console.log(JSON.stringify({ error, operations: store.listOperations(staff.tenantId), receipts: store.listReceipts(staff.tenantId), version: store.getVersion(staff.tenantId, session.shiftId), acceptedAudits: pos.audit.list(staff.tenantId).filter(({ action }) => action === 'pos.operation.accepted'), acceptedOutbox: store.listOutbox(staff.tenantId).filter(({ eventType }) => eventType === 'pos.operation.accepted') }))
  `)

  assert.equal(result.error, 'receipt write failed')
  assert.equal(result.operations.length, 0)
  assert.equal(result.receipts.length, 0)
  assert.equal(result.version, 0)
  assert.equal(result.acceptedAudits.length, 0)
  assert.equal(result.acceptedOutbox.length, 0)
})

test('PR2 uses a durable tenant-and-shift version row instead of counting operations', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260829120000_tus_pos_runtime_correction/migration.sql'), 'utf8')

  assert.match(schema, /model TusPosVersion[\s\S]*?tenantId\s+String[\s\S]*?shiftId\s+String[\s\S]*?version\s+Int/)
  assert.match(migration, /CREATE TABLE "TusPosVersion"/)
  assert.match(migration, /tenantId.*shiftId/)
  assert.match(migration, /version.*INTEGER/i)
  assert.match(migration, /TusPosVersion_tenantId_shiftId_version_idx/)
})

test('PR1 rolls back POS device and session lifecycle effects when audit or outbox persistence fails', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store })
    const staff = ${JSON.stringify(context())}
    const originalAudit = store.saveAudit.bind(store)
    const originalOutbox = store.outbox.append
    store.saveAudit = async () => { throw new Error('audit write failed') }
    let deviceAuditError = ''
    try { await pos.registerDevice(staff, { deviceId: 'device-atomic-lifecycle', label: 'Atomic counter', fingerprint: 'fp-atomic-lifecycle' }) } catch (error) { deviceAuditError = error.message }
    const afterDeviceFailure = await store.getDevice(staff.tenantId, 'device-atomic-lifecycle')
    store.saveAudit = originalAudit
    const device = await pos.registerDevice(staff, { deviceId: 'device-session-atomic', label: 'Session counter', fingerprint: 'fp-session-atomic' })
    store.outbox.append = async () => { throw new Error('outbox write failed') }
    let sessionOutboxError = ''
    const session = await pos.openSession(staff, { sessionId: 'session-atomic-lifecycle', deviceId: device.deviceId, shiftId: 'shift-atomic-lifecycle' }).catch((error) => { sessionOutboxError = error.message; return null })
    store.outbox.append = originalOutbox
    console.log(JSON.stringify({ deviceAuditError, afterDeviceFailure, sessionOutboxError, session }))
  `)

  assert.equal(result.deviceAuditError, 'audit write failed')
  assert.equal(result.afterDeviceFailure, null)
  assert.equal(result.sessionOutboxError, 'outbox write failed')
  assert.equal(result.session, null)
})

test('PR1 exposes tenant-scoped POS audit and outbox readback from the Prisma adapter', () => {
  const result = runTypeScriptScenario(`
    const { PrismaPosStore } = (await import('./apps/api/src/tus/adapters/delivery-pos.ts')).default
    const audits = [
      { auditId: 'audit-pos-a', tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', action: 'pos.operation.accepted', operationId: 'operation-a', outcome: 'allowed', createdAt: new Date('2026-08-27T12:00:00.000Z') },
      { auditId: 'audit-pos-b', tenantId: 'tenant-b', actorId: 'actor-b', correlationId: 'corr-b', action: 'pos.operation.accepted', operationId: 'operation-b', outcome: 'allowed', createdAt: new Date('2026-08-27T12:00:00.000Z') },
    ]
    const outbox = [
      { eventId: 'event-pos-a', tenantId: 'tenant-a', eventType: 'pos.operation.accepted', aggregateId: 'operation-a', payload: { status: 'accepted' }, status: 'pending', attempts: 0, createdAt: new Date('2026-08-27T12:00:00.000Z') },
      { eventId: 'event-pos-b', tenantId: 'tenant-b', eventType: 'pos.operation.accepted', aggregateId: 'operation-b', payload: { status: 'accepted' }, status: 'pending', attempts: 0, createdAt: new Date('2026-08-27T12:00:00.000Z') },
    ]
    const client = {
      tusPosAudit: { findMany: async ({ where }) => audits.filter((row) => row.tenantId === where.tenantId) },
      tusPosOutbox: { findMany: async ({ where }) => outbox.filter((row) => row.tenantId === where.tenantId) },
    }
    const store = new PrismaPosStore(client)
    const tenantAudits = await store.listAudit('tenant-a')
    const tenantOutbox = await store.listOutbox('tenant-a')
    console.log(JSON.stringify({ tenantAudits, tenantOutbox }))
  `)

  assert.deepEqual(result.tenantAudits.map(({ tenantId, correlationId, operationId }) => ({ tenantId, correlationId, operationId })), [{ tenantId: 'tenant-a', correlationId: 'corr-a', operationId: 'operation-a' }])
  assert.deepEqual(result.tenantOutbox.map(({ tenantId, aggregateId, eventType }) => ({ tenantId, aggregateId, eventType })), [{ tenantId: 'tenant-a', aggregateId: 'operation-a', eventType: 'pos.operation.accepted' }])
})

test('PR3 maps a durable POS version race to a deterministic version conflict', () => {
  const result = runTypeScriptScenario(`
    const { PrismaPosStore } = (await import('./apps/api/src/tus/adapters/delivery-pos.ts')).default
    const client = {
      tusPosVersion: {
        findUnique: async () => ({ tenantId: 'tenant-a', shiftId: 'shift-a', version: 2 }),
        updateMany: async () => ({ count: 0 }),
      },
    }
    const store = new PrismaPosStore(client)
    let error = null
    try { await store.incrementVersion('tenant-a', 'shift-a', 1) } catch (caught) { error = { name: caught.name, code: caught.code, status: caught.status, message: caught.message } }
    console.log(JSON.stringify(error))
  `)

  assert.deepEqual(result, {
    name: 'PosError',
    code: 'VERSION_CONFLICT',
    status: 409,
    message: 'POS shift version differs from the offline expectation',
  })
})

test('PR3 resolves conflicts transactionally and rolls back the resolution evidence on failure', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store })
    const staff = ${JSON.stringify(context())}
    await store.saveConflict({ conflictId: 'conflict-transactional', tenantId: staff.tenantId, operationId: 'operation-conflict', reason: 'version_conflict', expectedVersion: 0, actualVersion: 1, status: 'open', createdAt: '2026-08-27T12:00:00.000Z' })
    const originalAudit = store.saveAudit.bind(store)
    store.saveAudit = async () => { throw new Error('conflict audit failed') }
    let error = ''
    try { await pos.resolveConflict(staff, 'conflict-transactional', 'retry') } catch (caught) { error = caught.message }
    store.saveAudit = originalAudit
    console.log(JSON.stringify({ error, conflict: (await store.listConflicts(staff.tenantId))[0], outbox: store.listOutbox(staff.tenantId) }))
  `)

  assert.equal(result.error, 'conflict audit failed')
  assert.equal(result.conflict.status, 'open')
  assert.equal(result.outbox.length, 0)
})

test('PR3 returns an identical replay without duplicating POS business or evidence counts', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store })
    const staff = ${JSON.stringify(context())}
    const input = { operationId: 'operation-replay-3', idempotencyKey: 'operation-replay-key-3', schemaVersion: '1.0.0', deviceId: 'device-replay-3', shiftId: 'shift-replay-3', createdAt: '2026-08-27T12:00:00.000Z', expectedVersion: 0, kind: 'manual-sale', context: 'product', amount: 100, currency: 'ARS' }
    const first = await pos.recordManualOperation(staff, input)
    const second = await pos.recordManualOperation(staff, input)
    console.log(JSON.stringify({ first, second, operations: (await store.listOperations(staff.tenantId)).length, receipts: (await store.listReceipts(staff.tenantId)).length, audits: (await pos.audit.list(staff.tenantId)).length, outbox: (await store.listOutbox(staff.tenantId)).length, version: await store.getVersion(staff.tenantId, input.shiftId) }))
  `)

  assert.deepEqual(result.second, result.first)
  assert.equal(result.operations, 1)
  assert.equal(result.receipts, 1)
  assert.equal(result.audits, 1)
  assert.equal(result.outbox, 1)
  assert.equal(result.version, 1)
})

test('PR3 records hash and stale-version conflicts inside the authenticated tenant boundary', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store })
    const tenantA = ${JSON.stringify(context())}
    const tenantB = ${JSON.stringify(context({ tenantId: 'tenant-pos-b', subjectId: 'staff-pos-b', correlationId: 'corr-pos-b' }))}
    const base = { operationId: 'operation-conflict-3', idempotencyKey: 'operation-conflict-key-3', schemaVersion: '1.0.0', deviceId: 'device-conflict-3', shiftId: 'shift-conflict-3', createdAt: '2026-08-27T12:00:00.000Z', expectedVersion: 0, kind: 'manual-sale', context: 'product', amount: 100, currency: 'ARS' }
    const accepted = await pos.recordManualOperation(tenantA, base)
    const hashConflict = await pos.recordManualOperation(tenantA, { ...base, operationId: 'operation-conflict-hash-3', amount: 101 })
    const versionConflict = await pos.recordManualOperation(tenantA, { ...base, operationId: 'operation-conflict-version-3', idempotencyKey: 'operation-conflict-version-key-3' })
    const isolated = await pos.recordManualOperation(tenantB, { ...base, operationId: 'operation-conflict-tenant-b-3', idempotencyKey: 'operation-conflict-tenant-b-key-3' })
    console.log(JSON.stringify({ accepted, hashConflict, versionConflict, isolated, tenantAOperations: (await store.listOperations(tenantA.tenantId)).length, tenantBOperations: (await store.listOperations(tenantB.tenantId)).length, tenantAConflicts: (await store.listConflicts(tenantA.tenantId)).map(({ reason }) => reason), tenantBConflicts: await store.listConflicts(tenantB.tenantId) }))
  `)

  assert.equal(result.accepted.status, 'accepted')
  assert.deepEqual(result.hashConflict, { status: 'conflict', operationId: 'operation-conflict-hash-3', reason: 'idempotency_conflict' })
  assert.deepEqual(result.versionConflict, { status: 'conflict', operationId: 'operation-conflict-version-3', reason: 'version_conflict' })
  assert.equal(result.isolated.status, 'accepted')
  assert.equal(result.tenantAOperations, 1)
  assert.equal(result.tenantBOperations, 1)
  assert.deepEqual(result.tenantAConflicts, ['idempotency_conflict', 'version_conflict'])
  assert.deepEqual(result.tenantBConflicts, [])
})

test('PR4 routes delivery proof into finance evidence and preserves correlation on the delivery outbox', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const application = createTusApplication()
    const staff = ${JSON.stringify(context({ permissions: ['tus:delivery:write', 'tus:delivery:read', 'tus:pos:write', 'tus:finance:write'] }))}
    const commitment = ${JSON.stringify({ commitmentId: 'commitment-cross-context-pr4', tenantId: 'tenant-pos', context: 'product', merchantId: 'merchant-pos', amount: 2400, currency: 'ARS' })}
    await application.marketplace.store.commitments.saveMany([commitment])
    const delivery = application.delivery
    const zone = await delivery.createZone(staff, { zoneId: 'zone-cross-context-pr4', name: 'Palermo', postalCodes: ['1425'] })
    const shift = await delivery.openShift(staff, { shiftId: 'shift-cross-context-pr4', zoneId: zone.zoneId, startsAt: '2026-08-27T09:00:00.000Z', endsAt: '2026-08-27T18:00:00.000Z', operatorIds: ['staff-pos'] })
    const task = await delivery.createTaskFromCommitment(staff, { taskId: 'task-cross-context-pr4', commitmentId: commitment.commitmentId, zoneId: zone.zoneId, shiftId: shift.shiftId })
    const accepted = await delivery.acceptTask(staff, task.taskId, task.version)
    const pickedUp = await delivery.transitionTask(staff, task.taskId, 'picked-up', accepted.version)
    const inTransit = await delivery.transitionTask(staff, task.taskId, 'in-transit', pickedUp.version)
    const proof = await application.recordDeliveryProof(staff, { taskId: task.taskId, proofId: 'proof-cross-context-pr4', recipientName: 'Recipient', capturedAt: '2026-08-27T12:00:00.000Z', evidenceSource: 'deterministic-test-only' }, inTransit.version)
    const handoff = await application.handoffDelivery(staff, task.taskId, proof.version)
    console.log(JSON.stringify({ proof, handoff, evidence: application.finance.store.listEvidence(staff.tenantId, commitment.commitmentId), outbox: delivery.store.listOutbox(staff.tenantId), providerCalls: application.finance.providerCalls ?? 0 }))
  `)

  assert.equal(result.proof.proof.commitmentId, 'commitment-cross-context-pr4')
  assert.equal(result.handoff.status, 'handed-off')
  assert.deepEqual(result.evidence.map(({ evidenceId, commitmentId, kind }) => ({ evidenceId, commitmentId, kind })), [{ evidenceId: 'proof-cross-context-pr4', commitmentId: 'commitment-cross-context-pr4', kind: 'delivery-accepted' }])
  assert.equal(result.outbox.some(({ eventType, correlationId, payload }) => eventType === 'delivery.proof.recorded' && correlationId === 'corr-pos-9' && payload.commitmentId === 'commitment-cross-context-pr4' && payload.evidenceId === 'proof-cross-context-pr4'), true)
  assert.equal(result.providerCalls, 0)
})
