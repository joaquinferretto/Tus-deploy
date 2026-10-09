import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const SETUP = `
  const { createHmac } = await import('node:crypto')
  const { verificarFirmaMercadoPago, TOLERANCIA_FIRMA_MS } = await import('./apps/api/src/tus/finance/servicios/mercado-pago.ts')
  const nowMs = Date.parse('2026-10-08T22:00:00.000Z')
  const secret = 'fictitious-webhook-signature-test'
  // Independent signer: no production manifest or signing helper is used to build the fixture.
  const firma = (ts, signedTs = ts) => 'ts=' + ts + ',v1=' + createHmac('sha256', secret).update('id:abc123;request-id:req-timestamp;ts:' + signedTs + ';').digest('hex')
  const verificar = (signatureHeader, extra = {}) => {
    try { return verificarFirmaMercadoPago({ secret, signatureHeader, requestId: 'req-timestamp', dataId: 'AbC123', nowMs, ...extra }) }
    catch (error) { return { status: error.status, code: error.code } }
  }
`

test('MP signature: a valid 13-digit milliseconds timestamp is accepted', () => {
  const r = runTypeScriptScenario(`${SETUP}
    console.log(JSON.stringify({ result: verificar(firma(String(nowMs))), expected: nowMs }))
  `)
  assert.deepEqual(r.result, { timestampMs: r.expected })
})

test('MP signature: a valid 10-digit Unix seconds timestamp is accepted and normalized to ms', () => {
  const r = runTypeScriptScenario(`${SETUP}
    console.log(JSON.stringify({ result: verificar(firma(String(nowMs / 1000))), expected: nowMs }))
  `)
  assert.deepEqual(r.result, { timestampMs: r.expected })
})

test('MP signature: expired Unix seconds timestamp is rejected with 401 EXPIRED_SIGNATURE', () => {
  const r = runTypeScriptScenario(`${SETUP}
    console.log(JSON.stringify(verificar(firma(String((nowMs - 301000) / 1000)))))
  `)
  assert.deepEqual(r, { status: 401, code: 'EXPIRED_SIGNATURE' })
})

test('MP signature: expired milliseconds timestamp is rejected with 401 EXPIRED_SIGNATURE', () => {
  const r = runTypeScriptScenario(`${SETUP}
    console.log(JSON.stringify(verificar(firma(String(nowMs - 301000)))))
  `)
  assert.deepEqual(r, { status: 401, code: 'EXPIRED_SIGNATURE' })
})

test('MP signature: an incorrect HMAC is rejected with 401 INVALID_SIGNATURE in both units', () => {
  const r = runTypeScriptScenario(`${SETUP}
    console.log(JSON.stringify([String(nowMs / 1000), String(nowMs)].map((ts) => verificar('ts=' + ts + ',v1=' + '0'.repeat(64)))))
  `)
  assert.deepEqual(r, [{ status: 401, code: 'INVALID_SIGNATURE' }, { status: 401, code: 'INVALID_SIGNATURE' }])
})

test('MP signature: HMAC uses the ORIGINAL textual seconds ts, never the converted ms', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const ts = String(nowMs / 1000)
    console.log(JSON.stringify({ original: verificar(firma(ts)), converted: verificar(firma(ts, String(nowMs))), expected: nowMs }))
  `)
  assert.deepEqual(r.original, { timestampMs: r.expected })
  assert.deepEqual(r.converted, { status: 401, code: 'INVALID_SIGNATURE' })
})

test('MP signature: the existing five-minute tolerance and signed query data.id/request-id remain enforced', () => {
  const r = runTypeScriptScenario(`${SETUP}
    console.log(JSON.stringify({ tolerance: TOLERANCIA_FIRMA_MS, boundary: verificar(firma(String((nowMs - 300000) / 1000))), future: verificar(firma(String((nowMs + 301000) / 1000))), wrongQuery: verificar(firma(String(nowMs)), { dataId: 'different-query-id' }), wrongRequest: verificar(firma(String(nowMs / 1000)), { requestId: 'different-request' }), malformed: ['123456789', '12345678901', '123456789012', '12345678901234', 'not-a-timestamp'].map((ts) => verificar(firma(ts))) }))
  `)
  assert.equal(r.tolerance, 300000)
  assert.ok(Number.isSafeInteger(r.boundary.timestampMs))
  assert.deepEqual(r.future, { status: 401, code: 'EXPIRED_SIGNATURE' })
  assert.deepEqual(r.wrongQuery, { status: 401, code: 'INVALID_SIGNATURE' })
  assert.deepEqual(r.wrongRequest, { status: 401, code: 'INVALID_SIGNATURE' })
  assert.ok(r.malformed.every((error) => error.status === 401 && error.code === 'INVALID_SIGNATURE'))
})
