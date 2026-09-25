import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// "Mi perfil": the signed-in user reads their own account (never another id) and edits the name
// others see in their requests.
const root = join(import.meta.dirname, '..', '..')

test('MI PERFIL: GET /auth/account returns only the session account in its safe shape', () => {
  const result = runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
    const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
    const { createAuthRouter } = await import('./apps/api/src/auth-security/http/auth-router.ts')
    const now = Date.parse('2026-09-28T13:00:00.000Z')
    const auth = createInMemoryAuthService({ now: () => now })
    const sessions = new DurableIdentitySessionResolver(auth.store, () => now)
    const registered = await auth.register({ email: 'laura@example.com', password: 'Contrasena-Segura-2026', displayName: 'Laura Martínez' })
    await auth.verifyEmail({ token: registered.verificationToken })
    const otra = await auth.register({ email: 'otra@example.com', password: 'Contrasena-Segura-2026', displayName: 'Otra Persona' })
    const signed = await auth.signIn({ email: 'laura@example.com', password: 'Contrasena-Segura-2026' })
    const app = express(); app.use(express.json()); app.use(createAuthRouter({ service: auth.service, sessions }))
    const server = app.listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + signed.session.accessToken, 'x-correlation-id': 'corr-1' }
    try {
      const anon = (await fetch(base + '/auth/account')).status
      const res = await fetch(base + '/auth/account', { headers })
      const own = [res.status, res.headers.get('cache-control'), await res.json()]
      const renamed = await (await fetch(base + '/auth/accounts/' + registered.account.id, { method: 'PATCH', headers, body: JSON.stringify({ displayName: 'Laura Gómez' }) })).json()
      const ajena = (await fetch(base + '/auth/accounts/' + otra.account.id, { method: 'PATCH', headers, body: JSON.stringify({ displayName: 'X' }) })).status
      const after = await (await fetch(base + '/auth/account', { headers })).json()
      console.log(JSON.stringify({ anon, own, renamed, ajena, after, id: registered.account.id }))
    } finally { server.close() }
  `)
  assert.equal(result.anon, 401)
  assert.equal(result.own[0], 200)
  assert.equal(result.own[1], 'no-store')
  assert.equal(result.own[2].account.id, result.id)
  assert.equal(result.own[2].account.email, 'laura@example.com')
  assert.ok(result.own[2].account.emailVerifiedAt)
  assert.doesNotMatch(JSON.stringify(result.own[2]), /password|hash|secret|token/i)
  assert.equal(result.renamed.account.displayName, 'Laura Gómez')
  assert.equal(result.ajena, 403)
  assert.equal(result.after.account.displayName, 'Laura Gómez')
})

test('MI PERFIL Web: page exists, header links to it when signed in', () => {
  assert.ok(existsSync(join(root, 'apps/web/src/app/mi-perfil/page.tsx')))
  const header = readFileSync(join(root, 'apps/web/src/features/home/public-header.tsx'), 'utf8')
  assert.match(header, /href=\{'\/mi-perfil' as Route\}/)
  const client = readFileSync(join(root, 'apps/web/src/features/profile/profile-client.ts'), 'utf8')
  assert.match(client, /\/auth\/account`/)
})
