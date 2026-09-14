import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: 'http://localhost:3101' },
  })
  return JSON.parse(output.trim())
}

test('PR4 creates one stable key per intent and sends it again for a replay-safe checkout retry', () => {
  const result = runTypeScriptScenario(`
    const { createStableIdempotencyKey, createTusWebClient, parseTusCheckoutResponse } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const requests = []
    const client = createTusWebClient({ request: async (input) => {
      requests.push(input)
      return { status: requests.length === 1 ? 'executed' : 'replay', commitments: [{ commitmentId: 'commitment-1' }] }
    } })
    const idempotencyKey = createStableIdempotencyKey('checkout', 'intent-1')
    const input = { tenantId: 'tenant-a', actorId: 'customer-a', correlationId: 'corr-a', idempotencyKey, cartId: 'cart-intent-1', requestHash: 'hash-1', lines: [{ lineId: 'line-1', listingId: 'listing-1', context: 'product', quantity: 1, availabilityVersion: 1 }] }
    const first = await client.checkoutMarketplace(input)
    const retry = await client.checkoutMarketplace(input)
    console.log(JSON.stringify({ key: idempotencyKey, keys: requests.map((request) => request.idempotencyKey), first, retry, parsed: parseTusCheckoutResponse({ status: 'replay', commitments: [{ commitmentId: 'commitment-1' }] }, 'intent-1') }))
  `)

  assert.equal(result.key, 'tus:checkout:intent-1')
  assert.deepEqual(result.keys, ['tus:checkout:intent-1', 'tus:checkout:intent-1'])
  assert.equal(result.first.status, 'accepted')
  assert.equal(result.retry.status, 'replayed')
  assert.equal(result.parsed.status, 'replayed')
  assert.equal(result.parsed.commitments[0].commitmentId, 'commitment-1')
})

test('PR4 keeps duplicate, in-flight, timeout, and invalid acknowledgements out of success', () => {
  const result = runTypeScriptScenario(`
    const { classifyTusRequestError, parseTusCheckoutResponse, tusIntentFeedback } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const conflict = Object.assign(new Error('duplicate'), { status: 409, code: 'CONFLICT' })
    const inFlight = Object.assign(new Error('in flight'), { status: 409, code: 'IN_PROGRESS' })
    const timeout = Object.assign(new Error('timeout'), { status: 504, code: 'UNAVAILABLE' })
    console.log(JSON.stringify({ conflict: classifyTusRequestError(conflict, 'intent-1'), inFlight: classifyTusRequestError(inFlight, 'intent-1'), timeout: classifyTusRequestError(timeout, 'intent-1'), invalid: tusIntentFeedback(parseTusCheckoutResponse({ ok: true }, 'intent-1')) }))
  `)

  assert.equal(result.conflict.status, 'conflict')
  assert.equal(result.conflict.action, 'resolve')
  assert.equal(result.inFlight.status, 'pending')
  assert.equal(result.inFlight.action, 'refresh')
  assert.equal(result.timeout.status, 'pending')
  assert.equal(result.timeout.action, 'retry')
  assert.equal(result.invalid.status, 'error')
  assert.equal(result.invalid.action, 'retry')
  assert.doesNotMatch(JSON.stringify(result.invalid), /accepted|replayed/)
})

test('PR4 maps server acknowledgement and transport errors to actionable, finance-bounded feedback', () => {
  const result = runTypeScriptScenario(`
    const { tusIntentFeedback } = (await import('./apps/web/src/lib/tus-client.ts')).default
    console.log(JSON.stringify({
      accepted: tusIntentFeedback({ status: 'accepted', intentId: 'intent-1', commitments: [{ commitmentId: 'commitment-1' }] }),
      replayed: tusIntentFeedback({ status: 'replayed', intentId: 'intent-1', commitments: [{ commitmentId: 'commitment-1' }] }),
      pending: tusIntentFeedback({ status: 'pending', intentId: 'intent-1', reason: 'timeout' }),
      conflict: tusIntentFeedback({ status: 'conflict', intentId: 'intent-1', reason: 'idempotency_conflict' }),
      error: tusIntentFeedback({ status: 'error', intentId: 'intent-1', reason: 'invalid_server_response' }),
    }))
  `)

  assert.equal(result.accepted.status, 'accepted')
  assert.match(result.accepted.message, /server acknowledgement/i)
  assert.match(result.accepted.evidence, /settlement.*not claimed/i)
  assert.equal(result.replayed.status, 'replayed')
  assert.match(result.replayed.message, /original/i)
  assert.equal(result.pending.action, 'retry')
  assert.equal(result.conflict.action, 'resolve')
  assert.equal(result.error.action, 'retry')
  assert.doesNotMatch(JSON.stringify(result.pending), /success/i)
})

test('PR4 requires a POS response body and preserves the authoritative receipt when present', () => {
  const result = runTypeScriptScenario(`
    const { parseTusPosResponse } = (await import('./apps/web/src/lib/tus-client.ts')).default
    console.log(JSON.stringify({
      accepted: parseTusPosResponse({ status: 'accepted', operationId: 'operation-1', receipt: { receiptId: 'receipt-1', settlement: 'not-claimed' } }, 'fallback'),
      invalid: parseTusPosResponse({ ok: true }, 'fallback'),
    }))
  `)

  assert.equal(result.accepted.status, 'accepted')
  assert.equal(result.accepted.receipt.receiptId, 'receipt-1')
  assert.equal(result.accepted.receipt.settlement, 'not-claimed')
  assert.equal(result.invalid.status, 'error')
  assert.equal(result.invalid.reason, 'invalid_server_response')
})

test('PR4 joins API URLs once and preserves contract transport headers and idempotency', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebFetchTransport, createTusWebClient, createStableIdempotencyKey, joinTusApiUrl } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ status: 'executed', commitments: [] }), { status: 200 })
    }
    try {
      const client = createTusWebClient(createTusWebFetchTransport())
      await client.checkoutMarketplace({
        tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', accessToken: 'token-a',
        idempotencyKey: createStableIdempotencyKey('checkout', 'intent-a'), cartId: 'cart-a', requestHash: 'hash-a', lines: [],
      })
      console.log(JSON.stringify({ url: calls[0].url, joined: joinTusApiUrl('https://api.example///', '//tus/v1/mercado-servicios'), headers: calls[0].options.headers, body: JSON.parse(calls[0].options.body) }))
    } finally {
      globalThis.fetch = originalFetch
    }
  `)

  assert.equal(result.url, 'http://localhost:3101/tus/v1/mercado-servicios/checkout')
  assert.equal(result.joined, 'https://api.example/tus/v1/mercado-servicios')
  assert.equal(result.headers['X-Tenant-Id'], 'tenant-a')
  assert.equal(result.headers['X-Actor-Id'], 'actor-a')
  assert.equal(result.headers['X-Correlation-Id'], 'corr-a')
  assert.equal(result.headers.Authorization, 'Bearer token-a')
  assert.equal(result.headers['Idempotency-Key'], 'tus:checkout:intent-a')
  assert.equal(result.headers['X-TUS-Contract-Version'], '1.0.0')
  assert.equal(result.headers['X-TUS-API-Version'], 'v1')
  assert.equal(result.headers['Content-Type'], 'application/json')
  assert.equal(result.body.idempotencyKey, 'tus:checkout:intent-a')
  assert.equal(result.body.requestHash, 'hash-a')
})

test('PR4 serializes the governed nested WhatsApp handoff contract without claiming payment success', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const requests = []
    const client = createTusWebClient({ request: async (input) => { requests.push(input); return { status: 'handoff', reason: 'customer_requested_handoff', credentialsCollected: false } } })
    const response = await client.whatsappPaymentHandoff({
      tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a', accessToken: 'token-a',
      senderId: 'sender-a', consent: true, idempotencyKey: 'tus:whatsapp:intent-a', requestHash: 'hash-a',
      commitmentId: 'commitment-a', confirmationId: 'confirmation-a',
    })
    console.log(JSON.stringify({ request: requests[0], response }))
  `)

  assert.equal(result.request.path, '/tus/v1/whatsapp/handoff')
  assert.equal(result.request.idempotencyKey, 'tus:whatsapp:intent-a')
  assert.equal(result.request.body.type, 'handoff')
  assert.equal(result.request.body.action.type, 'handoff')
  assert.equal(result.request.body.action.tenantId, 'tenant-a')
  assert.equal(result.request.body.action.commitmentId, 'commitment-a')
  assert.equal(result.request.body.action.confirmationId, 'confirmation-a')
  assert.equal(result.request.body.senderId, 'sender-a')
  assert.equal(result.request.body.consent, true)
  assert.equal(result.response.credentialsCollected, false)
  assert.doesNotMatch(JSON.stringify(result.response), /accepted|settled|paid/i)
})
