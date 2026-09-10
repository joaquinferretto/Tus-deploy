import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source, env = {}) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ...env },
  })
  return JSON.parse(output.trim())
}

test('web contracts keep payment and operational outcomes truthful', () => {
  const result = runTypeScriptScenario(`
    const { resolveTusPaymentPresentation, redactTusUiError, createTusOfflineRecord } = (await import('./apps/web/src/lib/tus-web-contract.ts')).default
    console.log(JSON.stringify({
      pending: resolveTusPaymentPresentation('pending'),
      approved: resolveTusPaymentPresentation('approved'),
      rejected: resolveTusPaymentPresentation('rejected'),
      refunded: resolveTusPaymentPresentation('refunded'),
      error: redactTusUiError(new Error('postgres://user:secret@example.test/sql?token=hidden')),
      offline: createTusOfflineRecord({ kind: 'manual-sale', operationId: 'op-1', idempotencyKey: 'tus:pos:op-1', payload: { amount: 1200 } }),
    }))
  `)

  assert.equal(result.pending.status, 'pending')
  assert.equal(result.pending.settlementClaim, 'not-claimed')
  assert.equal(result.approved.status, 'approved')
  assert.equal(result.approved.settlementClaim, 'not-claimed')
  assert.equal(result.rejected.retryable, true)
  assert.equal(result.refunded.status, 'refunded')
  assert.match(result.error.message, /could not be completed|try again/i)
  assert.doesNotMatch(JSON.stringify(result.error), /postgres|secret|token|sql/i)
  assert.deepEqual(result.offline, {
    kind: 'manual-sale',
    operationId: 'op-1',
    idempotencyKey: 'tus:pos:op-1',
    status: 'queued-offline',
    payload: { amount: 1200 },
  })
})

test('web client covers existing auth, booking, payment, POS, delivery, and support routes', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient, createStableIdempotencyKey } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const requests = []
    const client = createTusWebClient({ request: async (input) => { requests.push(input); return { status: 'accepted', operationId: 'op-1', tasks: [] } } })
    const context = { accessToken: 'token', tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a' }
    await client.register({ email: 'person@example.com', password: 'password', displayName: 'Person' })
    await client.requestRecovery('person@example.com')
    await client.completeRecovery({ token: 'recovery-token', newPassword: 'new-password' })
    await client.listServiceSlots({ ...context, calendarId: 'calendar-a', date: '2026-09-10' })
    await client.bookService({ ...context, idempotencyKey: createStableIdempotencyKey('booking', 'booking-a'), requestHash: 'booking-hash', calendarId: 'calendar-a', serviceId: 'service-a', customerId: 'actor-a', slotId: 'slot-a' })
    await client.createPaymentIntent({ ...context, idempotencyKey: createStableIdempotencyKey('payment', 'payment-a'), requestHash: 'payment-hash', commitmentId: 'commitment-a', orderId: 'order-a' })
    await client.getPosOperationStatus({ ...context, operationId: 'op-1' })
    await client.listDeliveryTasks(context)
    await client.openSupportCase({ ...context, caseId: 'case-a', commitmentId: 'commitment-a', category: 'refund' })
    console.log(JSON.stringify(requests.map(({ method, path, idempotencyKey, body }) => ({ method, path, idempotencyKey, body }))))
  `)

  assert.deepEqual(result.map(({ method, path }) => ({ method, path })), [
    { method: 'POST', path: '/auth/register' },
    { method: 'POST', path: '/auth/recovery/request' },
    { method: 'POST', path: '/auth/recovery/complete' },
    { method: 'GET', path: '/tus/v1/calendar/calendar-a/slots?date=2026-09-10' },
    { method: 'POST', path: '/tus/v1/calendar/bookings' },
    { method: 'POST', path: '/tus/v1/finance/payment-intents' },
    { method: 'GET', path: '/tus/v1/pos/operations/op-1/status' },
    { method: 'GET', path: '/tus/v1/delivery/tasks' },
    { method: 'POST', path: '/tus/v1/support/cases' },
  ])
  assert.equal(result[4].idempotencyKey, 'tus:booking:booking-a')
  assert.equal(result[5].idempotencyKey, 'tus:payment:payment-a')
  assert.equal(result[8].body.tenantId, undefined)
})

test('fetch transport uses explicit bearer security and never ambient cookies', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebFetchTransport } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const originalFetch = globalThis.fetch
    let call
    globalThis.fetch = async (url, options) => { call = { url, options }; return new Response(JSON.stringify({ ok: true }), { status: 200 }) }
    try {
      await createTusWebFetchTransport().request({ method: 'GET', path: '/tus/v1/delivery/tasks', tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', accessToken: 'secret-token' })
      console.log(JSON.stringify(call))
    } finally { globalThis.fetch = originalFetch }
  `, { NEXT_PUBLIC_API_URL: 'https://api.tusservicios.com', API_BASE_URL: '' })

  assert.equal(result.url, 'https://api.tusservicios.com/tus/v1/delivery/tasks')
  assert.equal(result.options.credentials, 'omit')
  assert.equal(result.options.headers.Authorization, 'Bearer secret-token')
  assert.equal(result.options.headers.Cookie, undefined)
})

test('web surface exposes install/update/offline and recovery contracts without localhost production defaults', () => {
  const sourceFiles = JSON.stringify({
    page: readFileSync(join(root, 'apps/web/src/app/page.tsx'), 'utf8'),
    layout: readFileSync(join(root, 'apps/web/src/app/layout.tsx'), 'utf8'),
    auth: readFileSync(join(root, 'apps/web/src/lib/tus-auth-client.ts'), 'utf8'),
  })
  assert.match(sourceFiles, /offline/i)
  assert.match(sourceFiles, /update|install/i)
  assert.match(sourceFiles, /recovery\/request|recovery\/complete/)
   assert.doesNotMatch(sourceFiles, /localhost:\\d+[^\n]*production/i)
 })

test('POS refresh checks operation status instead of resubmitting the sale', () => {
  const pos = readFileSync(join(root, 'apps/web/src/app/tus/tus-pos.tsx'), 'utf8')

  assert.match(pos, /getPosOperationStatus/)
  assert.match(pos, /refreshOperationStatus/)
  assert.match(pos, /feedback\.action === 'refresh'[\s\S]{0,120}\? refreshOperationStatus\(operation\)/)
  assert.doesNotMatch(pos, /onClick=\{\(\) => void sendOperation\(operation\)\}/)
})

test('auth keeps bearer credentials volatile and never writes tokens to browser storage', () => {
  const auth = readFileSync(join(root, 'apps/web/src/lib/tus-auth-client.ts'), 'utf8')

  assert.match(auth, /volatileCredential/)
  assert.doesNotMatch(auth, /storage\.write|serializeCredential|sessionStorage\.setItem/)
})
