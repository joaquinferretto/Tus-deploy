import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url).pathname.replace(/^\/(\w):/, '$1:').replace(/\/$/, '')
const tsxCli = `${root}/apps/api/node_modules/tsx/dist/cli.mjs`

async function runTypeScriptScenario(source) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execute = promisify(execFile)
  const wrapped = `(async () => {\n${source}\n})()`
  const result = await execute(process.execPath, [tsxCli, '--eval', wrapped], { cwd: root })
  return JSON.parse(result.stdout.trim())
}

test('authenticated signup, tenant bootstrap, and session authorization survive app restart', async () => {
  const result = await runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createInMemoryAuthService } = (await import('./apps/api/src/auth-security/composition.ts')).default
    const { DurableIdentitySessionResolver } = (await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')).default
    const { createAuthRouter } = (await import('./apps/api/src/auth-security/http/auth-router.ts')).default
    const { createTenancyRouter } = (await import('./apps/api/src/tenancy/http/tenancy-router.ts')).default
    const { createInMemoryTenancyService } = (await import('./apps/api/src/tenancy/composition.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default

    const auth = createInMemoryAuthService({ now: () => 1_700_000_000_000 })
    const firstApp = express()
    firstApp.use(express.json())
    const firstResolver = new DurableIdentitySessionResolver(auth.store, () => 1_700_000_000_000)
    const tenancy = createInMemoryTenancyService({ now: () => 1_700_000_000_000 })
    firstApp.use(createAuthRouter({ service: auth.service, sessions: firstResolver }))
    firstApp.use(createTenancyRouter({ service: tenancy.service, sessions: firstResolver }))
    firstApp.use(createTusHttpRouter({ application: createTusApplication(), sessions: firstResolver }))
    const firstServer = await new Promise((resolve) => { const server = firstApp.listen(0, () => resolve(server)) })
    const firstPort = firstServer.address().port
    const request = async (path, options = {}) => fetch('http://127.0.0.1:' + firstPort + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })

    const registration = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'Correct horse battery staple 42!', displayName: 'Owner', tenantId: 'tenant-a' }) })
    const verificationToken = auth.email.messages[0].token
    await request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: verificationToken }) })
    const signIn = await request('/auth/sign-in', { method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'Correct horse battery staple 42!', deviceId: 'browser-a' }) })
    const session = await signIn.json()
    const context = await request('/auth/session', { headers: { authorization: 'Bearer ' + session.session.accessToken, 'x-correlation-id': 'corr-a' } })
    const contextBody = await context.json()
    const bootstrap = await request('/tenancy/organizations', { method: 'POST', headers: { authorization: 'Bearer ' + session.session.accessToken, 'x-correlation-id': 'corr-bootstrap' }, body: JSON.stringify({ name: 'Owner business', slug: 'owner-business' }) })
    await new Promise((resolve, reject) => firstServer.close((error) => error ? reject(error) : resolve()))

    const secondApp = express()
    secondApp.use(express.json())
    const secondResolver = new DurableIdentitySessionResolver(auth.store, () => 1_700_000_000_000)
    secondApp.use(createAuthRouter({ service: auth.service, sessions: secondResolver }))
    secondApp.use(createTenancyRouter({ service: tenancy.service, sessions: secondResolver }))
    secondApp.use(createTusHttpRouter({ application: createTusApplication(), sessions: secondResolver }))
    const secondServer = await new Promise((resolve) => { const server = secondApp.listen(0, () => resolve(server)) })
    const secondPort = secondServer.address().port
    const restarted = await fetch('http://127.0.0.1:' + secondPort + '/auth/session', { headers: { authorization: 'Bearer ' + session.session.accessToken, 'x-correlation-id': 'corr-restart' } })
    const restartedBody = await restarted.json()
    const signedOut = await fetch('http://127.0.0.1:' + secondPort + '/auth/sign-out', { method: 'POST', headers: { authorization: 'Bearer ' + session.session.accessToken, 'x-correlation-id': 'corr-sign-out' } })
    const afterSignOut = await fetch('http://127.0.0.1:' + secondPort + '/auth/session', { headers: { authorization: 'Bearer ' + session.session.accessToken, 'x-correlation-id': 'corr-after-sign-out' } })
    await new Promise((resolve, reject) => secondServer.close((error) => error ? reject(error) : resolve()))

    console.log(JSON.stringify({
      registration: registration.status,
      context: context.status,
      bootstrap: bootstrap.status,
      tenantId: contextBody.context.tenantId,
      actorId: contextBody.context.subjectId,
      restarted: restarted.status,
      restartedTenantId: restartedBody.context.tenantId,
      signedOut: signedOut.status,
      afterSignOut: afterSignOut.status,
      audited: auth.audit.events.some((event) => event.kind === 'session.created' && event.tenantId === 'tenant-a'),
      tenantPersisted: tenancy.store.organizations.has('tenant-a') && tenancy.store.memberships.size === 1,
    }))
  `)

  assert.match(result.actorId, /^[0-9a-f-]{36}$/)
  const { actorId, ...stableResult } = result
  assert.deepEqual(stableResult, {
    registration: 201,
    context: 200,
    bootstrap: 201,
    tenantId: 'tenant-a',
    restarted: 200,
    restartedTenantId: 'tenant-a',
    signedOut: 204,
    afterSignOut: 401,
    audited: true,
    tenantPersisted: true,
  })
})

test('HTTP authority is server-derived: spoofed tenant and foreign commitment are denied and audited', async () => {
  const result = await runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createInMemoryAuthService } = (await import('./apps/api/src/auth-security/composition.ts')).default
    const { DurableIdentitySessionResolver } = (await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')).default
    const { createAuthRouter } = (await import('./apps/api/src/auth-security/http/auth-router.ts')).default
    const { createTusHttpRouter } = (await import('./apps/api/src/tus/http/router.ts')).default
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default

    const auth = createInMemoryAuthService({ now: () => 1_700_000_000_000 })
    const makeAccount = async (email, tenantId) => {
      const registration = await auth.register({ email, password: 'Correct horse battery staple 42!', displayName: email, tenantId })
      await auth.verifyEmail({ token: registration.verificationToken })
      const signedIn = await auth.signIn({ email, password: 'Correct horse battery staple 42!' })
      return signedIn.session.accessToken
    }
    const tokenA = await makeAccount('a@example.com', 'tenant-a')
    const tokenB = await makeAccount('b@example.com', 'tenant-b')
    const application = createTusApplication()
    const foreignCommitment = await application.checkout({ tenantId: 'tenant-b', actorId: 'foreign', correlationId: 'seed', idempotencyKey: 'seed-key', cartId: 'seed-cart', createdAt: new Date(1_700_000_000_000).toISOString(), requestHash: 'seed-hash', recordId: 'seed-record', expiresAt: 1_700_000_100_000, lines: [{ lineId: 'seed-line', context: 'product', merchantId: 'merchant-b', amount: 10, currency: 'ARS' }] })
    const denied = []
    const app = express()
    app.use(express.json())
    const resolver = new DurableIdentitySessionResolver(auth.store, () => 1_700_000_000_000)
    app.use(createAuthRouter({ service: auth.service, sessions: resolver }))
    app.use(createTusHttpRouter({ application, sessions: resolver, onAuthorizationDenied: async (event) => denied.push(event) }))
    const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)) })
    const port = server.address().port
    const response = await fetch('http://127.0.0.1:' + port + '/tus/checkout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokenA, 'x-correlation-id': 'corr-spoof', 'x-tenant-id': 'tenant-b', 'idempotency-key': 'spoof-key' }, body: JSON.stringify({ tenantId: 'tenant-b', cartId: 'cart-spoof', requestHash: 'hash-spoof', lines: [{ lineId: 'line-1', context: 'product', merchantId: 'merchant-a', amount: 10, currency: 'ARS' }] }) })
    const foreign = await fetch('http://127.0.0.1:' + port + '/tus/commitments/' + foreignCommitment.commitments[0].commitmentId, { headers: { authorization: 'Bearer ' + tokenA, 'x-correlation-id': 'corr-cross-tenant' } })
    const own = await fetch('http://127.0.0.1:' + port + '/tus/commitments/tenant-a-record', { headers: { authorization: 'Bearer ' + tokenB, 'x-correlation-id': 'corr-cross-tenant-b' } })
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    console.log(JSON.stringify({ spoof: response.status, foreign: foreign.status, own: own.status, noTUSWrite: application.outbox.list('tenant-a').length === 0, audited: auth.audit.events.filter((event) => event.kind === 'session.created').length === 2, denialAudit: denied.map((event) => event.reason) }))
  `)

  assert.deepEqual(result, { spoof: 403, foreign: 403, own: 404, noTUSWrite: true, audited: true, denialAudit: ['spoofed_authority', 'cross_tenant_resource'] })
})
