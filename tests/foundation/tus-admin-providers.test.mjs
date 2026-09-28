import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

test('manual provider administration requires elevated permission and verified existing account; real directory, no forged facts', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { crearAltaPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
    const { crearRouterDirectorio } = await import('./apps/api/src/tus/directorio/http.ts')
    const { MfaAdminSessionResolver } = await import('./apps/api/src/auth-security/mfa/admin-gate.ts')
    const { createRequire } = await import('node:module')
    const express = createRequire(process.cwd() + '/apps/api/package.json')('express')
    const account = { id: 'manual-account', email: 'provider@example.test', normalizedEmail: 'provider@example.test', tenantId: 'manual-tenant', roles: ['owner'], status: 'active', emailVerifiedAt: 1 }
    const directory = crearServicioDirectorio({ application: tusApp })
    const save = crearAltaPrestadorAdmin({ accounts: { findAccountByEmail: async email => email === account.email ? account : undefined }, application: tusApp, directorio: directory })
    const raw = new InMemoryTusSessionResolver()
    raw.add('admin', { subjectId: 'real-admin', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin'] })
    raw.add('client', { subjectId: 'client', tenantId: 'platform', sessionId: 'c', roles: ['owner'], permissions: ['tus:marketplace:write'] })
    let elevated = false
    const gated = new MfaAdminSessionResolver(raw, { isElevated: async () => elevated })
    const app = express(); app.use(express.json()); app.use(crearRouterDirectorio({ servicio: directory, sessions: gated, adminSave: save }))
    const server = app.listen(0)
    const body = { email: account.email, displayName: 'Prestador Manual', profession: 'plomeria', zone: 'Centro', serviceZones: ['Centro'], serviceMode: 'domicilio', description: 'Reparación de pérdidas', visible: true }
    const call = async (token, payload = body) => { const response = await fetch('http://127.0.0.1:' + server.address().port + '/tus/v1/admin/prestadores', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'manual-test', 'content-type': 'application/json' }, body: JSON.stringify(payload) }); return { status: response.status, data: await response.json() } }
    try {
      const denied = [(await call('client')).status, (await call('admin')).status]
      elevated = true
      const missing = await call('admin', { ...body, email: 'absent@example.test' })
      const forged = await call('admin', { ...body, verified: true, completedJobs: 500, tenantId: 'another' })
      const created = await call('admin')
      const updated = await call('admin', { ...body, displayName: 'Nombre actualizado' })
      const publicList = await directory.listar({ oficio: 'plomeria' })
      const compatible = await directory.buscarCandidatos({ oficio: 'plomeria', zona: 'Barrio Centro', exigirCobertura: true })
      const elsewhere = await directory.buscarCandidatos({ oficio: 'plomeria', zona: 'Ponce', exigirCobertura: true })
      const merchant = await marketplace.merchant.find(account.tenantId)
      elevated = false
      const revoked = await call('admin')
      console.log(JSON.stringify({ denied, missing, forged, created, updated, publicList, merchant, compatible: compatible.items.length, elsewhere: elsewhere.items.length, revoked: revoked.status }))
    } finally { server.closeAllConnections(); server.close() }
  `)
  assert.deepEqual(result.denied, [403, 403])
  assert.equal(result.missing.status, 409)
  assert.equal(result.forged.status, 422)
  assert.equal(result.created.status, 200)
  assert.equal(result.updated.data.profile.id, result.created.data.profile.id)
  assert.equal(result.publicList.items.length, 1)
  assert.equal(result.publicList.items[0].displayName, 'Nombre actualizado')
  assert.equal(result.publicList.items[0].verified, false)
  assert.equal(result.publicList.items[0].completedJobs, 0)
  assert.equal(result.merchant.tenantId, 'manual-tenant')
  assert.equal(result.revoked, 403)
  assert.equal(result.compatible, 1)
  assert.equal(result.elsewhere, 0)
})

test('manual directory registration does not bypass commercial publication readiness', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = await import('./apps/api/src/tus/composition/index.ts')
    const { EvaluadorHabilitacion } = await import('./apps/api/src/tus/readiness/index.ts')
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { crearAltaPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
    const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
    const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
    const identityStore = new InMemoryIdentityStore()
    const auth = createAuthService({ store: identityStore })
    const registered = await auth.service.register({ email: 'ready@example.test', password: 'una frase larga y segura 2026', displayName: 'Prestador Readiness' })
    await auth.service.verifyEmail({ token: registered.verificationToken })
    const account = await identityStore.findAccountByEmail('ready@example.test')
    const application = createTusApplication({ evaluadorHabilitacion: new EvaluadorHabilitacion({ listEvidence: () => [] }) })
    const directory = crearServicioDirectorio({ application })
    const save = crearAltaPrestadorAdmin({ accounts: identityStore, application, directorio: directory })
    const admin = { subjectId: 'admin', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin'], correlationId: 'admin-readiness' }
    const body = { email: 'ready@example.test', displayName: 'Prestador Readiness', profession: 'plomeria', zone: 'Centro', serviceZones: ['Centro'], serviceMode: 'domicilio', description: 'Reparación de pérdidas', visible: true }
    const created = await save(admin, body)
    let onboardCode = 'none'
    try {
      await application.marketplace.onboard({ ...admin, tenantId: account.tenantId, permissions: ['tus:marketplace:write'] }, { merchantId: 'commercial-id', locationId: 'commercial-location', cohort: 'repairs-trades', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'commercial-v1' })
    } catch (error) { onboardCode = error?.code ?? String(error) }
    const merchant = await application.marketplace.store.merchant.find(account.tenantId)
    const audits = await application.marketplace.store.audit.list(account.tenantId)
    const outbox = await application.marketplace.store.outbox.list(account.tenantId)
    console.log(JSON.stringify({ created: created.status, merchant: merchant?.status, onboardCode, actions: audits.map((item) => item.action), outbox: outbox.length }))
  `)
  assert.equal(result.created, 200)
  assert.equal(result.merchant, 'approved')
  assert.equal(result.onboardCode, 'TUS_READINESS_BLOCKED')
  assert.deepEqual(result.actions, ['provider.profile.admin_saved'])
  assert.equal(result.outbox, 0, 'directory registration must not emit commercial onboarding events')
})

test('manual directory registration keeps the provider business id immutable for later onboarding', () => {
  const result = runTypeScriptScenario(`
    const { createTusApplication } = await import('./apps/api/src/tus/composition/index.ts')
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { crearAltaPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
    const account = { id: 'stable-account', email: 'stable@example.test', normalizedEmail: 'stable@example.test', tenantId: 'stable-tenant', roles: ['owner'], status: 'active', emailVerifiedAt: 1 }
    const application = createTusApplication()
    const directory = crearServicioDirectorio({ application })
    const save = crearAltaPrestadorAdmin({ accounts: { findAccountByEmail: async () => account }, application, directorio: directory })
    const admin = { subjectId: 'admin', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin'], correlationId: 'admin-stable-id' }
    const body = { email: account.email, displayName: 'Prestador Stable', profession: 'plomeria', zone: 'Centro', serviceZones: ['Centro'], serviceMode: 'domicilio', visible: true }
    await save(admin, body)
    const before = await application.marketplace.store.merchant.find(account.tenantId)
    let mismatch = 'none'
    try {
      await application.marketplace.onboard({ ...admin, tenantId: account.tenantId, permissions: ['tus:marketplace:write'] }, { merchantId: 'different-id', locationId: 'commercial-location', cohort: 'repairs-trades', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'commercial-v1' })
    } catch (error) { mismatch = error?.code ?? String(error) }
    const after = await application.marketplace.store.merchant.find(account.tenantId)
    console.log(JSON.stringify({ mismatch, before: before?.merchantId, after: after?.merchantId }))
  `)
  assert.equal(result.mismatch, 'MERCHANT_ID_MISMATCH')
  assert.equal(result.after, result.before)
})
