import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// SEG-DEPENDENCIAS-01. The IP the API believes a request comes from decides its rate limits. It is
// computed by Express through `proxy-addr`, from the socket and X-Forwarded-For, according to
// `trust proxy` (apps/api/src/platform/runtime.ts). The real Express of the API, with the real
// resolution of the setting: what a client can and cannot make the API believe.
test('IP del cliente: with no trusted proxy X-Forwarded-For is ignored; with one hop only the last entry counts and a client cannot forge its IP by sending the header; with trusted addresses an IPv4-mapped IPv6 hop is the same proxy as its IPv4 (CVE-2026-90711); the strict limit counts by that IP', () => {
  const r = runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { resolveTrustProxy } = await import('./apps/api/src/platform/runtime.ts')
    const { authRateLimitMiddleware } = await import('./apps/api/src/presentation/middleware/rate-limit.ts')
    const levantar = async (env) => {
      const app = express()
      app.set('trust proxy', resolveTrustProxy(env))
      app.get('/ip', (request, response) => response.json({ ip: request.ip, ips: request.ips }))
      app.use('/auth/sign-in', authRateLimitMiddleware, (request, response) => response.json({ ip: request.ip }))
      const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
      const pedir = async (xff, path = '/ip', method = 'GET') => { const res = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } }); return { status: res.status, body: await res.json().catch(() => null) } }
      return { pedir, cerrar: () => new Promise((resolve) => server.close(resolve)) }
    }
    const local = (ip) => ip === '127.0.0.1' || ip === '::ffff:127.0.0.1'
    const out = {}
    // ---- No proxy trusted (the default): the header is never believed.
    const sin = await levantar({})
    out.sinProxy = [local((await sin.pedir()).body.ip), local((await sin.pedir('203.0.113.9')).body.ip), (await sin.pedir('203.0.113.9')).body.ips]
    await sin.cerrar()
    // ---- One hop (the platform proxy in front of the API): the entry the proxy wrote, never an earlier one.
    const uno = await levantar({ TRUST_PROXY_HOPS: '1' })
    out.unSalto = [(await uno.pedir('203.0.113.9')).body.ip, (await uno.pedir('1.2.3.4, 203.0.113.9')).body.ip, (await uno.pedir('1.2.3.4, 5.6.7.8, 203.0.113.9')).body.ip, local((await uno.pedir()).body.ip)]
    // The strict limit follows that IP: one client spending its budget does not block another.
    const estados = { a: [], b: [] }
    for (let i = 0; i < 42; i += 1) estados.a.push((await uno.pedir('1.1.1.1, 198.51.100.7', '/auth/sign-in', 'POST')).status)
    estados.b.push((await uno.pedir('198.51.100.7, 198.51.100.8', '/auth/sign-in', 'POST')).status)
    // Forging the header changes nothing: the last entry is the one the proxy saw.
    estados.forjada = (await uno.pedir('9.9.9.9, 198.51.100.7', '/auth/sign-in', 'POST')).status
    out.limite = [estados.a.filter((s) => s === 200).length, estados.a.filter((s) => s === 429).length, estados.b[0], estados.forjada]
    await uno.cerrar()
    // ---- Trusted addresses: loopback (this test's "proxy") and a private range.
    const dir = await levantar({ TRUST_PROXY_ADDRESSES: '127.0.0.1/32,::ffff:127.0.0.1/128,10.0.0.0/8' })
    out.direcciones = [
      (await dir.pedir('203.0.113.9')).body.ip,
      (await dir.pedir('203.0.113.9, 10.0.0.5')).body.ip,
      // The same private proxy written as IPv4-mapped IPv6 is the same trusted proxy.
      (await dir.pedir('203.0.113.9, ::ffff:10.0.0.5')).body.ip,
      // A public address written as mapped IPv6 is NOT trusted: the chain stops there.
      (await dir.pedir('203.0.113.9, ::ffff:8.8.8.8')).body.ip,
      (await dir.pedir('203.0.113.9, 8.8.8.8')).body.ip,
    ]
    await dir.cerrar()
    out.invalidos = [(() => { try { resolveTrustProxy({ TRUST_PROXY_HOPS: '1', TRUST_PROXY_ADDRESSES: '10.0.0.0/8' }); return 'ok' } catch { return 'rechazado' } })(), (() => { try { resolveTrustProxy({ TRUST_PROXY_HOPS: '99' }); return 'ok' } catch { return 'rechazado' } })(), (() => { try { resolveTrustProxy({ TRUST_PROXY_ADDRESSES: 'no-es-una-ip' }); return 'ok' } catch { return 'rechazado' } })(), resolveTrustProxy({})]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinProxy, [true, true, []], 'no trusted proxy: X-Forwarded-For is ignored')
  assert.deepEqual(r.unSalto, ['203.0.113.9', '203.0.113.9', '203.0.113.9', true], 'one hop: the entry written by the proxy; what the client put before it is not believed')
  assert.deepEqual(r.limite, [40, 2, 200, 429], '40 attempts per IP; another client is not affected; forging the first entry does not escape the limit')
  assert.deepEqual(r.direcciones, ['203.0.113.9', '203.0.113.9', '203.0.113.9', '::ffff:8.8.8.8', '8.8.8.8'], 'a trusted proxy is trusted in both notations; an untrusted hop ends the chain in both notations')
  assert.deepEqual(r.invalidos, ['rechazado', 'rechazado', 'rechazado', false], 'the setting is validated and off by default')
  // The fixed version is the one the API resolves.
  const require = createRequire(join(root, 'apps/api/package.json'))
  const expressDir = require.resolve('express/package.json')
  const version = createRequire(expressDir)('proxy-addr/package.json').version
  const [mayor, menor, parche] = version.split('.').map(Number)
  assert.ok(mayor > 2 || (mayor === 2 && (menor > 0 || parche >= 8)), `proxy-addr ${version} is at least 2.0.8`)
})
