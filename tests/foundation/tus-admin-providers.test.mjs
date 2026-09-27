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
