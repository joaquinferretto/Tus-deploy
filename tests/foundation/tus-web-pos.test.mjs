import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

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

test('WEB-05 uses the existing device, session, operation, and status endpoints', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const calls = []
    const context = { tenantId: 'tenant-pos', actorId: 'staff-pos', correlationId: 'corr-pos', accessToken: 'token' }
    const client = createTusWebClient({ request: async (input) => {
      calls.push(input)
      if (input.path === '/tus/v1/pos/devices') return { contractVersion: '1.0.0', deviceId: 'web-pos', tenantId: context.tenantId, label: 'TUS Web POS', fingerprint: 'tus-web-pos-v1', status: 'active', createdAt: '2026-09-17T12:00:00.000Z', updatedAt: '2026-09-17T12:00:00.000Z' }
      if (input.path === '/tus/v1/pos/sessions') return { contractVersion: '1.0.0', sessionId: 'session-pos', tenantId: context.tenantId, actorId: context.actorId, deviceId: 'web-pos', shiftId: 'shift-pos', status: 'open', openedAt: '2026-09-17T12:00:00.000Z' }
      if (input.path.endsWith('/close')) return { contractVersion: '1.0.0', sessionId: 'session-pos', tenantId: context.tenantId, actorId: context.actorId, deviceId: 'web-pos', shiftId: 'shift-pos', status: 'closed', openedAt: '2026-09-17T12:00:00.000Z', closedAt: '2026-09-17T13:00:00.000Z' }
      if (input.method === 'GET') return { status: 'accepted', operationId: 'operation-pos', receipt: { contractVersion: '1.0.0', receiptId: 'receipt-pos' } }
      return { status: 'accepted', operation: { operationId: 'operation-pos' }, receipt: { receiptId: 'receipt-pos' } }
    } })
    const device = await client.registerPosDevice({ ...context, deviceId: 'web-pos', label: 'TUS Web POS', fingerprint: 'tus-web-pos-v1' })
    const session = await client.openPosSession({ ...context, sessionId: 'session-pos', deviceId: device.deviceId, shiftId: 'shift-pos' })
    const operation = await client.recordManualOperation({ ...context, operationId: 'operation-pos', idempotencyKey: 'tus:pos:operation-pos', kind: 'manual-sale', context: 'product', amount: 1200, currency: 'ARS', deviceId: device.deviceId, shiftId: session.shiftId, schemaVersion: '1.0.0', createdAt: '2026-09-17T12:10:00.000Z' })
    const status = await client.posOperationStatus(context, operation.operationId)
    const closed = await client.closePosSession(context, session.sessionId)
    console.log(JSON.stringify({ calls, device, session, operation, status, closed }))
  `)

  assert.deepEqual(result.calls.map(({ method, path }) => ({ method, path })), [
    { method: 'POST', path: '/tus/v1/pos/devices' },
    { method: 'POST', path: '/tus/v1/pos/sessions' },
    { method: 'POST', path: '/tus/pos/manual-operations' },
    { method: 'GET', path: '/tus/v1/pos/operations/operation-pos/status' },
    { method: 'POST', path: '/tus/v1/pos/sessions/session-pos/close' },
  ])
  assert.equal(result.session.status, 'open')
  assert.equal(result.operation.status, 'accepted')
  assert.equal(result.status.status, 'accepted')
  assert.equal(result.closed.status, 'closed')
})

test('WEB-05 parses accepted, pending, not-found, conflict, error, and replay outcomes honestly', () => {
  const result = runTypeScriptScenario(`
    const client = await import('./apps/web/src/lib/tus-client.ts')
    console.log(JSON.stringify({
      accepted: client.parseTusPosOperationStatus({ status: 'accepted', operationId: 'accepted', receipt: { receiptId: 'receipt' } }, 'fallback'),
      pending: client.parseTusPosOperationStatus({ status: 'pending', operationId: 'pending', reason: 'receipt_pending' }, 'fallback'),
      missing: client.parseTusPosOperationStatus({ status: 'not_found', operationId: 'missing' }, 'fallback'),
      conflict: client.parseTusPosOperationStatus({ status: 'conflict', operationId: 'conflict', reason: 'version_conflict' }, 'fallback'),
      error: client.parseTusPosOperationStatus({ status: 'unknown' }, 'fallback'),
      replay: client.parseTusPosResponse({ status: 'replayed', operationId: 'replay' }, 'fallback'),
    }))
  `)

  assert.equal(result.accepted.status, 'accepted')
  assert.equal(result.pending.reason, 'receipt_pending')
  assert.equal(result.missing.status, 'not_found')
  assert.equal(result.conflict.reason, 'version_conflict')
  assert.deepEqual(result.error, { status: 'error', operationId: 'fallback', reason: 'invalid_server_response' })
  assert.equal(result.replay.status, 'replayed')
})

test('WEB-05 retries the exact idempotent operation without changing its identity', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const calls = []
    const operation = { tenantId: 'tenant-pos', actorId: 'staff-pos', correlationId: 'corr-pos', operationId: 'stable-operation', idempotencyKey: 'tus:pos:stable-operation', kind: 'manual-service', context: 'service', amount: 900, currency: 'ARS', deviceId: 'web-pos', shiftId: 'shift-pos', schemaVersion: '1.0.0', createdAt: '2026-09-17T12:00:00.000Z' }
    const client = createTusWebClient({ request: async (input) => { calls.push(input); if (calls.length === 1) throw new Error('network'); return { status: 'accepted', operation: input.body, receipt: { receiptId: 'receipt' } } } })
    await client.recordManualOperation(operation).catch(() => undefined)
    const accepted = await client.recordManualOperation(operation)
    console.log(JSON.stringify({ calls, accepted }))
  `)

  assert.equal(result.calls.length, 2)
  assert.equal(result.calls[0].idempotencyKey, result.calls[1].idempotencyKey)
  assert.equal(result.calls[0].body.operationId, result.calls[1].body.operationId)
  assert.equal(result.accepted.status, 'accepted')
})

test('WEB-05 distinguishes uncertain network responses from real conflicts', () => {
  const result = runTypeScriptScenario(`
    const { classifyTusRequestError, TusRequestError } = await import('./apps/web/src/lib/tus-client.ts')
    console.log(JSON.stringify({
      network: classifyTusRequestError(new Error('network'), 'operation'),
      conflict: classifyTusRequestError(new TusRequestError('version changed', 409, 'CONFLICT'), 'operation'),
    }))
  `)

  assert.equal(result.network.status, 'pending')
  assert.equal(result.network.action, 'retry')
  assert.equal(result.conflict.status, 'conflict')
  assert.equal(result.conflict.retryable, false)
})

test('WEB-05 renders real session state, an empty visit state, and status refresh without a second POST', () => {
  const source = readFileSync(join(root, 'apps/web/src/app/tus/tus-pos.tsx'), 'utf8')
  const refreshBody = source.slice(
    source.indexOf('async function refreshOperationStatus'),
    source.indexOf('function upsertRecentOperation')
  )

  assert.match(source, /registerPosDevice/)
  assert.match(source, /openPosSession/)
  assert.match(source, /closePosSession/)
  assert.match(source, /No operations were recorded during this visit/)
  assert.match(source, /recentOperations\.map/)
  assert.match(source, /formatTusCurrency/)
  assert.match(refreshBody, /posOperationStatus/)
  assert.doesNotMatch(refreshBody, /recordManualOperation|sendOperation/)
  assert.doesNotMatch(source, /JSON\.stringify/)
})

test('WEB-05 keeps session and operation actions usable on narrow screens', () => {
  const css = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8')

  assert.match(css, /\.tus-pos-operation-list li\s*\{[\s\S]*?display:\s*flex/)
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.tus-pos-session-state,[\s\S]*?flex-direction:\s*column/)
  assert.match(css, /\.tus-pos-operation-list \.tus-action-button\s*\{[\s\S]*?width:\s*100%/)
})
