import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
const node = process.execPath

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(node, [tsxCli, '--eval', wrapped], { cwd: root, encoding: 'utf8' })
  return JSON.parse(output.trim())
}

function context(overrides = {}) {
  return {
    sessionId: 'pos-session',
    subjectId: 'cashier-pos',
    tenantId: 'tenant-pos',
    roles: ['cashier'],
    permissions: ['tus:pos:write'],
    correlationId: 'corr-pos',
    ...overrides,
  }
}

function sale(overrides = {}) {
  return {
    operationId: 'sale-pos',
    idempotencyKey: 'key-sale-pos',
    schemaVersion: '1.0.0',
    deviceId: 'device-pos',
    shiftId: 'shift-pos',
    createdAt: '2026-08-27T12:00:00.000Z',
    expectedVersion: 0,
    kind: 'manual-sale',
    context: 'product',
    amount: 1200,
    currency: 'ARS',
    lines: [{ lineId: 'line-pos', name: 'Product', context: 'product', quantity: 1, unitAmount: 1200, totalAmount: 1200 }],
    paymentMethod: 'cash',
    ...overrides,
  }
}

test('POS registers tenant-owned devices, opens cash shifts, records product/service sales, and reconciles closeout', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store, now: () => Date.parse('2026-08-27T13:00:00.000Z') })
    const staff = ${JSON.stringify(context())}
    const device = await pos.registerDevice(staff, { deviceId: 'device-pos', label: 'Counter', fingerprint: 'fingerprint' })
    const session = await pos.openSession(staff, { sessionId: 'session-pos', deviceId: device.deviceId, shiftId: 'shift-pos', openingFloat: 5000 })
    const product = await pos.recordManualOperation(staff, ${JSON.stringify(sale())})
    const service = await pos.recordManualOperation(staff, ${JSON.stringify(sale({ operationId: 'service-pos', idempotencyKey: 'key-service-pos', expectedVersion: 1, kind: 'manual-service', context: 'service', amount: 800, lines: [{ lineId: 'service-line', name: 'Repair', context: 'service', quantity: 1, unitAmount: 800, totalAmount: 800 }] }))})
    const closed = await pos.closeSession(staff, session.sessionId, { countedCash: 7000 })
    console.log(JSON.stringify({ device, session, product, service, closed, shift: await pos.getShift(staff, 'shift-pos') }))
  `)

  assert.equal(result.device.tenantId, 'tenant-pos')
  assert.equal(result.product.status, 'accepted')
  assert.equal(result.service.status, 'accepted')
  assert.equal(result.closed.status, 'closed')
  assert.deepEqual(result.closed.reconciliation, { expectedCash: 7000, countedCash: 7000, variance: 0 })
  assert.deepEqual(result.shift.totals, { openingFloat: 5000, sales: 2000, refunds: 0, cashIn: 0, cashOut: 0, expectedCash: 7000 })
})

test('POS replays a same-key request once, fences concurrent versions, and keeps immutable snapshots', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store })
    const staff = ${JSON.stringify(context())}
    await pos.registerDevice(staff, { deviceId: 'device-pos', label: 'Counter', fingerprint: 'fingerprint' })
    await pos.openSession(staff, { sessionId: 'session-pos', deviceId: 'device-pos', shiftId: 'shift-pos' })
    const input = ${JSON.stringify(sale())}
    const [first, second] = await Promise.all([pos.recordManualOperation(staff, input), pos.recordManualOperation(staff, input)])
    input.amount = 999999
    const status = await pos.getOperationStatus(staff, input.operationId)
    console.log(JSON.stringify({ first, second, status, operations: await store.listOperations(staff.tenantId), receipts: await store.listReceipts(staff.tenantId), audits: await store.listAudit(staff.tenantId), outbox: await store.listOutbox(staff.tenantId), version: await store.getVersion(staff.tenantId, input.shiftId) }))
  `)

  assert.deepEqual(result.second, result.first)
  assert.equal(result.operations.length, 1)
  assert.equal(result.receipts.length, 1)
  assert.equal(result.operations[0].amount, 1200)
  assert.equal(result.status.status, 'accepted')
  assert.equal(result.audits.filter(({ action }) => action === 'pos.operation.accepted').length, 1)
  assert.equal(result.outbox.filter(({ eventType }) => eventType === 'pos.operation.accepted').length, 1)
  assert.equal(result.version, 1)
})

test('POS creates compensating refunds and cancellations without rewriting the original receipt', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store })
    const cashier = ${JSON.stringify(context())}
    const manager = ${JSON.stringify(context({ subjectId: 'manager-pos', roles: ['manager'], permissions: ['tus:pos:write', 'tus:pos:refund'] }))}
    await pos.registerDevice(manager, { deviceId: 'device-pos', label: 'Counter', fingerprint: 'fingerprint' })
    await pos.openSession(cashier, { sessionId: 'session-pos', deviceId: 'device-pos', shiftId: 'shift-pos' })
    const accepted = await pos.recordManualOperation(cashier, ${JSON.stringify(sale())})
    const refund = await pos.refund(manager, { refundId: 'refund-pos', originalOperationId: accepted.operation.operationId, idempotencyKey: 'key-refund-pos', amount: 200, reason: 'customer-return', expectedVersion: 1 })
    const cancelled = await pos.cancelOperation(manager, { cancellationId: 'cancel-pos', originalOperationId: accepted.operation.operationId, idempotencyKey: 'key-cancel-pos', reason: 'operator-error', expectedVersion: 2 })
    console.log(JSON.stringify({ accepted, refund, cancelled, original: (await store.listReceipts(cashier.tenantId))[0], compensations: await pos.listCompensations(manager) }))
  `)

  assert.equal(result.refund.status, 'accepted')
  assert.equal(result.cancelled.status, 'accepted')
  assert.equal(result.original.amount, 1200)
  assert.equal(result.original.status, 'accepted')
  assert.deepEqual(result.compensations.map(({ kind, originalOperationId }) => ({ kind, originalOperationId })), [
    { kind: 'refund', originalOperationId: 'sale-pos' },
    { kind: 'cancellation', originalOperationId: 'sale-pos' },
  ])
})

test('POS denies cashier refunds and cross-tenant authority, and rejects zero, precision, negative, and overflow amounts', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store })
    const cashier = ${JSON.stringify(context())}
    await pos.registerDevice(cashier, { deviceId: 'device-pos', label: 'Counter', fingerprint: 'fingerprint' })
    await pos.openSession(cashier, { sessionId: 'session-pos', deviceId: 'device-pos', shiftId: 'shift-pos' })
    const errors = []
    for (const input of [${JSON.stringify(sale({ amount: 0 }))}, ${JSON.stringify(sale({ amount: -1 }))}, ${JSON.stringify(sale({ amount: 1.5 }))}, ${JSON.stringify(sale({ amount: Number.MAX_SAFE_INTEGER + 1 }))}]) {
      try { await pos.recordManualOperation(cashier, input) } catch (error) { errors.push(error.code) }
    }
    let refundError = ''
    try { await pos.refund(cashier, { refundId: 'refund-denied', originalOperationId: 'missing', idempotencyKey: 'refund-denied', amount: 1, reason: 'nope', expectedVersion: 0 }) } catch (error) { refundError = error.code }
    let tenantError = ''
    try { await pos.recordManualOperation(cashier, ${JSON.stringify(sale({ operationId: 'spoofed', idempotencyKey: 'spoofed', tenantId: 'tenant-other' }))}) } catch (error) { tenantError = error.code }
    console.log(JSON.stringify({ errors, refundError, tenantError }))
  `)

  assert.deepEqual(result.errors, ['INVALID', 'INVALID', 'INVALID', 'INVALID'])
  assert.equal(result.refundError, 'FORBIDDEN')
  assert.equal(result.tenantError, 'FORBIDDEN')
})

test('POS records retryable printer failure, preserves operation status, and fences outbox claims', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryPosStore, TusPosService } = (await import('./apps/api/src/tus/pos/index.ts')).default
    const store = new InMemoryPosStore()
    const pos = new TusPosService({ store, now: () => 1000 })
    const staff = ${JSON.stringify(context())}
    const accepted = await pos.recordManualOperation(staff, ${JSON.stringify(sale({ deviceId: 'unprovisioned', shiftId: 'shift-printer' }))})
    const failure = await pos.recordPrinterFailure(staff, { failureId: 'printer-failure', operationId: accepted.operation.operationId, reason: 'paper-empty' })
    const status = await pos.getOperationStatus(staff, accepted.operation.operationId)
    const claimed = await store.outbox.claim(staff.tenantId, 'worker-a', 1000, 100)
    const wrong = await store.outbox.acknowledge({ tenantId: staff.tenantId, eventId: claimed.eventId, claimId: 'worker-b:wrong', publishedAt: 1100 })
    const right = await store.outbox.acknowledge({ tenantId: staff.tenantId, eventId: claimed.eventId, claimId: claimed.claimId, publishedAt: 1100 })
    console.log(JSON.stringify({ failure, status, wrong, right }))
  `)

  assert.equal(result.failure.status, 'retryable')
  assert.equal(result.status.status, 'accepted')
  assert.equal(result.wrong, false)
  assert.equal(result.right, true)
})

test('offline replay quarantines a revoked-device operation and never resubmits status queries', () => {
  const result = runTypeScriptScenario(`
    const { createTusMobileClient } = (await import('./apps/mobile/src/application/tus-client.ts')).default
    const operation = ${JSON.stringify(sale({ operationId: 'offline-revoked', idempotencyKey: 'offline-revoked' }))}
    let online = false
    let requests = 0
    const quarantined = []
    const client = createTusMobileClient({ request: async () => { requests += 1; return { status: 'conflict', operationId: operation.operationId, reason: 'device_revoked' } } }, { runtime: { profile: 'dev', apiUrl: 'http://localhost:3101', requireTls: false, storageVersion: 1, tusContractVersion: '1.0.0', featureFlags: { offlineCache: true, mockAuth: true } }, isOnline: () => online, storage: { load: () => null, save: () => undefined, quarantine: (entry) => quarantined.push(entry) } })
    const queued = await client.recordManualOperation(operation)
    online = true
    const replay = await client.syncPendingOperations()
    const status = await client.queryOperationStatus(operation.operationId)
    console.log(JSON.stringify({ queued, replay, status, requests, pending: client.pendingOperations(), quarantined }))
  `)

  assert.deepEqual(result.queued, { status: 'queued-offline', operationId: 'offline-revoked' })
  assert.deepEqual(result.replay, [{ status: 'conflict', operationId: 'offline-revoked', reason: 'device_revoked' }])
  assert.deepEqual(result.status, { status: 'pending', operationId: 'offline-revoked', reason: 'quarantined' })
  assert.equal(result.requests, 1)
  assert.equal(result.pending.length, 0)
  assert.equal(result.quarantined[0].reason, 'device_revoked')
})
