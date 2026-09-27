import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { resolveTrustProxy } from '../../apps/api/src/platform/runtime.ts'
import { createSafeLogger } from '../../apps/api/src/presentation/middleware/logger.ts'

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url))
const express = require('express')
const { rateLimit } = require('express-rate-limit')

test('explicit proxy addresses reject unsafe and ambiguous configuration', () => {
  assert.deepEqual(resolveTrustProxy({ TRUST_PROXY_ADDRESSES: '127.0.0.1,::1/128' }), ['127.0.0.1', '::1/128'])
  for (const value of ['true', '*', '0.0.0.0/0', '::/0', '127.0.0.1,', '127.0.0.1/99']) {
    assert.throws(() => resolveTrustProxy({ TRUST_PROXY_ADDRESSES: value }))
  }
  assert.throws(() => resolveTrustProxy({ TRUST_PROXY_ADDRESSES: '127.0.0.1', TRUST_PROXY_HOPS: '1' }))
})

test('Express resolves nearest untrusted client, ignores spoofed prefix and separates limiter buckets', async () => {
  const app = express()
  app.set('trust proxy', resolveTrustProxy({ TRUST_PROXY_ADDRESSES: '127.0.0.1,::1' }))
  app.use(rateLimit({ windowMs: 60000, limit: 1 }))
  app.post('/tus/v1/integrations/whatsapp/webhook', (req, res) => res.json({ ip: req.ip }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const call = xff => fetch(`http://127.0.0.1:${server.address().port}/tus/v1/integrations/whatsapp/webhook`, { method: 'POST', headers: { 'x-forwarded-for': xff }, signal: AbortSignal.timeout(5000) })
  try {
    const a = await call('198.51.100.99, 203.0.113.10')
    assert.equal(a.status, 200)
    assert.equal((await a.json()).ip, '203.0.113.10')
    assert.equal((await call('198.51.100.88, 203.0.113.10')).status, 429)
    assert.equal((await call('203.0.113.11')).status, 200)
    // An untrusted socket cannot supply the client IP through XFF.
    app.set('trust proxy', ['192.0.2.10'])
    app.get('/ip', (req, res) => res.json({ ip: req.ip }))
    const direct = await fetch(`http://127.0.0.1:${server.address().port}/ip`, { headers: { 'x-forwarded-for': '203.0.113.90' }, signal: AbortSignal.timeout(5000) })
    assert.equal((await direct.json()).ip, '127.0.0.1')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('unexpected XFF is logged but does not reject webhook; shared bucket eventually returns 429', async () => {
  const errors = []
  const original = console.error
  console.error = error => errors.push(error.code)
  const app = express()
  app.use(rateLimit({ windowMs: 60000, limit: 1 }))
  app.post('/tus/v1/integrations/whatsapp/webhook', (_req, res) => res.sendStatus(200))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    const call = ip => fetch(`http://127.0.0.1:${server.address().port}/tus/v1/integrations/whatsapp/webhook`, { method: 'POST', headers: { 'x-forwarded-for': ip }, signal: AbortSignal.timeout(5000) })
    assert.equal((await call('203.0.113.10')).status, 200)
    assert.ok(errors.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR'))
    assert.equal((await call('203.0.113.11')).status, 429)
  } finally { console.error = original; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('structured info and warnings use stdout; errors use stderr, secrets stay redacted', () => {
  const out = [], err = []
  const log = console.log, error = console.error
  console.log = line => out.push(JSON.parse(line))
  console.error = line => err.push(JSON.parse(line))
  try {
    const logger = createSafeLogger()
    logger.info('api listening', { details: { token: 'do-not-print' } })
    logger.warn('retry')
    logger.error('failure')
  } finally { console.log = log; console.error = error }
  assert.deepEqual(out.map(e => e.level), ['info', 'warn'])
  assert.deepEqual(err.map(e => e.level), ['error'])
  assert.equal(out[0].details.token, '[REDACTED]')
})
