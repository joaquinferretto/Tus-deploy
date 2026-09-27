import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// Without an email provider: (1) the operator activates the allowlisted admin with a bootstrap
// code set in the API environment; (2) the admin loads managed providers (no password, nobody can
// sign in with them) and the real directory search finds them.
const AUTH = `
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { FixedWindowRateLimiter } = await import('./apps/api/src/auth-security/adapters/in-memory-auxiliaries.ts')
  const CODE = 'arranque-tus-admin-2026-una-frase-larga'
  const identityStore = new InMemoryIdentityStore()
  const make = (code) => createAuthService({ store: identityStore, platformAdminEmails: ['admin@example.com'], adminBootstrapCode: code, adminBootstrapRateLimiter: new FixedWindowRateLimiter(5, 15 * 60_000) })
  const auth = make(CODE)
  const password = 'una frase larga y segura 2026'
`

test('ADMIN BOOTSTRAP: only the operator code verifies an allowlisted, password-registered admin; generic failures; limited', () => {
  const result = runTypeScriptScenario(`${AUTH}
    await auth.service.registerAccount({ email: 'admin@example.com', password, displayName: 'Admin' })
    await auth.service.registerAccount({ email: 'otro@example.com', password, displayName: 'Otro' })
    const out = {}
    out.beforeSignIn = (await auth.service.signIn({ email: 'admin@example.com', password })).ok
    out.disabled = (await make(undefined).service.verifyAdminWithBootstrapCode({ email: 'admin@example.com', code: CODE })).code
    out.shortCode = (await make('corto').service.verifyAdminWithBootstrapCode({ email: 'admin@example.com', code: 'corto' })).code
    out.wrongCode = (await auth.service.verifyAdminWithBootstrapCode({ email: 'admin@example.com', code: CODE + 'x' })).code
    out.notAllowlisted = (await auth.service.verifyAdminWithBootstrapCode({ email: 'otro@example.com', code: CODE })).code
    out.notRegistered = (await auth.service.verifyAdminWithBootstrapCode({ email: 'nadie@example.com', code: CODE })).code
    out.stillUnverified = (await auth.service.signIn({ email: 'otro@example.com', password })).ok
    out.ok = (await auth.service.verifyAdminWithBootstrapCode({ email: ' Admin@Example.com ', code: CODE })).ok
    const signIn = await auth.service.signIn({ email: 'admin@example.com', password })
    out.signIn = signIn.ok
    out.adminScope = signIn.session.scope.permissions.includes('tus:providers:admin')
    const shared = make(CODE)
    for (let i = 0; i < 5; i += 1) await shared.service.verifyAdminWithBootstrapCode({ email: 'admin@example.com', code: 'x'.repeat(30) })
    out.limitedEvenWithRightCode = (await shared.service.verifyAdminWithBootstrapCode({ email: 'admin@example.com', code: CODE })).ok
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.beforeSignIn, false)
  for (const key of ['disabled', 'shortCode', 'wrongCode', 'notAllowlisted', 'notRegistered']) assert.equal(result[key], 'INVALID_TOKEN', key)
  assert.equal(result.stillUnverified, false)
  assert.equal(result.ok, true)
  assert.equal(result.signIn, true)
  assert.equal(result.adminScope, true, 'admin scope still needs MFA on every request (gate)')
  assert.equal(result.limitedEvenWithRightCode, false, '5 attempts per 15 minutes per email')
})

test('MANAGED PROVIDERS: admin loads a provider without email confirmation; nobody can sign in with it; directory finds it; no takeover', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${AUTH}
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { crearAltaPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
    const directory = crearServicioDirectorio({ application: tusApp })
    const save = crearAltaPrestadorAdmin({ accounts: identityStore, application: tusApp, directorio: directory, createManagedAccount: (input) => auth.service.createManagedProviderAccount(input) })
    const admin = { subjectId: 'admin', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin'], correlationId: 'c' }
    const body = (email, name, zone = 'Centro') => ({ email, displayName: name, profession: 'plomeria', zone, serviceZones: [zone], serviceMode: 'domicilio', description: 'Reparación de pérdidas de agua', visible: true })
    const out = {}
    out.noPermission = (await save({ ...admin, permissions: [] }, body('p1@example.com', 'Plomeria Uno'))).status
    const created = await save(admin, body('p1@example.com', 'Plomeria Uno'))
    out.created = created.status
    const account = await identityStore.findAccountByEmail('p1@example.com')
    out.noPassword = !(await identityStore.findPasswordCredential(account.id))
    out.unverified = account.emailVerifiedAt === null
    out.cannotSignIn = (await auth.service.signIn({ email: 'p1@example.com', password })).ok
    out.updated = (await save(admin, body('p1@example.com', 'Plomeria Uno Actualizada'))).status
    // Somebody's pending sign-up (password, unverified) is never taken over by the admin.
    await auth.service.registerAccount({ email: 'pendiente@example.com', password, displayName: 'Pendiente' })
    out.pendingTakeover = (await save(admin, body('pendiente@example.com', 'Impostor'))).code
    out.found = (await directory.buscarCandidatos({ oficio: 'plomeria', zona: 'Centro', exigirCobertura: true })).items.length
    out.elsewhere = (await directory.buscarCandidatos({ oficio: 'plomeria', zona: 'Camba Cuá', exigirCobertura: true })).items.length
    const listed = (await directory.listar({ oficio: 'plomeria' })).items
    out.listedName = listed[0]?.displayName
    out.verifiedBadge = listed[0]?.verified
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.noPermission, 403)
  assert.equal(result.created, 200)
  assert.equal(result.noPassword, true)
  assert.equal(result.unverified, true)
  assert.equal(result.cannotSignIn, false, 'a managed provider has no login')
  assert.equal(result.updated, 200)
  assert.equal(result.pendingTakeover, 'VERIFIED_ACCOUNT_REQUIRED')
  assert.equal(result.found, 1, 'the real directory search finds the managed provider')
  assert.equal(result.elsewhere, 0, 'zone coverage is still enforced')
  assert.equal(result.listedName, 'Plomeria Uno Actualizada')
  assert.equal(result.verifiedBadge, false, 'admin loading never marks identity as verified')
})
