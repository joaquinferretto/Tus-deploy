import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// AUTH-LIMITE-01. The strict limit of the sensitive authentication routes (40 requests per IP every
// 15 minutes) is for operations that try a secret. Reading the own session state, which a screen
// does on every load, does not spend it. The real middlewares, mounted as the server mounts them.
test('AUTH límite: an administrator reloading its screens is not locked out (reading the MFA state and the session never spends the strict budget); guessing a second factor or a password still is limited, per IP, and one exhausts it for the other; the limit is not relaxed for any writing route', () => {
  const r = runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { authRateLimitMiddleware, rateLimitMiddleware, esLecturaDeSesion } = await import('./apps/api/src/presentation/middleware/rate-limit.ts')
    const app = express()
    app.use(rateLimitMiddleware)
    // The same prefixes as apps/api/src/server.ts.
    app.use(['/auth/register', '/auth/sign-in', '/auth/verify-email', '/auth/recovery/request', '/auth/recovery/complete', '/auth/oauth/exchange', '/auth/oauth/signup', '/auth/oauth/link', '/auth/mfa', '/auth/verify-email/resend', '/auth/admin/bootstrap-verify'], authRateLimitMiddleware)
    app.use((request, response) => response.status(200).json({ ok: true }))
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const base = 'http://127.0.0.1:' + server.address().port
    const varias = async (n, method, path) => { const estados = []; for (let i = 0; i < n; i += 1) estados.push((await fetch(base + path, { method })).status); return estados }
    const cuenta = (lista) => lista.reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {})
    const out = {}
    try {
      // An administrator moving through its panel: 120 loads, each reading the MFA state and the session.
      out.estadoMfa = cuenta(await varias(120, 'GET', '/auth/mfa/status'))
      out.sesion = cuenta(await varias(120, 'GET', '/auth/session'))
      // ...and after all that, its second factor still answers.
      out.verificaDespues = (await fetch(base + '/auth/mfa/verify', { method: 'POST' })).status
      // Guessing a code: 39 more attempts fit (40 in all), the next ones do not.
      out.fuerzaBruta = cuenta(await varias(45, 'POST', '/auth/mfa/verify'))
      // The same IP is now out of budget for every sensitive route, also for signing in.
      out.agotado = [(await fetch(base + '/auth/sign-in', { method: 'POST' })).status, (await fetch(base + '/auth/mfa/recover', { method: 'POST' })).status, (await fetch(base + '/auth/recovery/request', { method: 'POST' })).status, (await fetch(base + '/auth/mfa/enroll', { method: 'POST' })).status]
      // While reading its state is still possible (the person sees why it has to wait).
      out.lecturaConCupoAgotado = [(await fetch(base + '/auth/mfa/status')).status, (await fetch(base + '/auth/mfa/status?x=1')).status, (await fetch(base + '/auth/session')).status]
      out.regla = [esLecturaDeSesion('GET', '/auth/mfa/status'), esLecturaDeSesion('GET', '/auth/mfa/status?x=1'), esLecturaDeSesion('POST', '/auth/mfa/status'), esLecturaDeSesion('GET', '/auth/mfa/verify'), esLecturaDeSesion('GET', '/auth/mfa/status/../verify'), esLecturaDeSesion('GET', '/auth/sign-in'), esLecturaDeSesion('GET', '/auth/mfa/recovery-codes')]
    } finally { await new Promise((resolve) => server.close(resolve)) }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.estadoMfa, { 200: 120 }, 'reading the MFA state on every load never hits the strict limit')
  assert.deepEqual(r.sesion, { 200: 120 }, 'reading the session is not under the strict limit at all')
  assert.equal(r.verificaDespues, 200, 'after navigating, the second factor still answers')
  assert.deepEqual(r.fuerzaBruta, { 200: 39, 429: 6 }, 'guessing a code: 40 attempts per IP in 15 minutes, then blocked')
  assert.deepEqual(r.agotado, [429, 429, 429, 429], 'the budget is shared by every sensitive route of that IP')
  assert.deepEqual(r.lecturaConCupoAgotado, [200, 200, 200])
  assert.deepEqual(r.regla, [true, true, false, false, false, false, false], 'only the GET of the state is a read; nothing that tries or changes a secret')
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const limite = read('apps/api/src/presentation/middleware/rate-limit.ts')
  assert.match(limite, /export const LECTURAS_DE_SESION = \['\/auth\/mfa\/status'\] as const/u, 'one read, named')
  assert.match(limite, /max: 40,\n  skip: \(req\) => esLecturaDeSesion\(req\.method, req\.originalUrl\),/u, 'the strict limit keeps its 40')
  const server = read('apps/api/src/server.ts')
  for (const ruta of ["'/auth/sign-in'", "'/auth/register'", "'/auth/recovery/request'", "'/auth/recovery/complete'", "'/auth/mfa'", "'/auth/verify-email'", "'/auth/admin/bootstrap-verify'"]) assert.ok(server.includes(ruta), `${ruta} is still under the strict limit`)
  assert.doesNotMatch(/app\.use\(\s*\[[\s\S]*?\],\s*authRateLimitMiddleware/u.exec(server)[0], /'\/auth\/session'/u, 'the session route never was under it')
})
