import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// Admin panel read views: real data only, gated like every admin route, and the one state action
// (publish / hide a provider profile) is reflected in the public directory the map uses.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

test('ADMIN PANEL API: permission required; providers with the real reason they are off the map; publish/hide reaches the directory', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
    const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
    const { crearAltaPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
    const { crearRouterAdmin } = await import('./apps/api/src/tus/admin/http.ts')
    const { CuentasAdminEnMemoria } = await import('./apps/api/src/tus/admin/fuentes.ts')
    const identityStore = new InMemoryIdentityStore()
    const auth = { ...createAuthService({ store: identityStore }), store: identityStore }
    const password = 'una frase larga y segura 2026'
    const r = await auth.service.register({ email: 'cliente@example.com', password, displayName: 'Carla Cliente' })
    await auth.service.verifyEmail({ token: r.verificationToken })
    const directory = crearServicioDirectorio({ application: tusApp })
    const solicitudes = crearServicioSolicitudes({ cuentas: identityStore, destinos: directory })
    const save = crearAltaPrestadorAdmin({ accounts: identityStore, application: tusApp, directorio: directory, createManagedAccount: (input) => auth.service.createManagedProviderAccount(input) })
    const admin = { subjectId: 'admin', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c' }
    const body = (email, name, zone) => ({ email, displayName: name, profession: 'plomeria', zone, serviceZones: [zone], serviceMode: 'domicilio', description: 'Reparación de pérdidas de agua', visible: true })
    await save(admin, body('p1@example.com', 'Plomería Uno', 'Centro'))
    await save(admin, { ...body('p2@example.com', 'Plomería Oculta', 'Camba Cuá'), visible: false })
    const sessions = { resolve: async (token) => token === 'admin' ? admin : token === 'client' ? { ...admin, subjectId: 'x', permissions: ['tus:marketplace:write'] } : null }
    const app = express(); app.use(express.json())
    app.use(crearRouterAdmin({ sessions, directorio: directory, solicitudes, cuentas: new CuentasAdminEnMemoria(identityStore), adminEmails: () => ['admin@example.com'], whatsappPendientes: async () => 2 }))
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const call = async (path, token = 'admin', payload) => {
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method: payload ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'c', 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) })
      return { status: response.status, body: await response.json() }
    }
    const out = {}
    try {
      out.anonymous = (await fetch('http://127.0.0.1:' + server.address().port + '/tus/v1/admin/resumen')).status
      out.client = (await call('/tus/v1/admin/resumen', 'client')).status
      out.clientUsers = (await call('/tus/v1/admin/usuarios', 'client')).status
      out.resumen = (await call('/tus/v1/admin/resumen')).body
      const prestadores = (await call('/tus/v1/admin/prestadores')).body.items
      out.prestadores = prestadores.map((p) => ({ nombre: p.nombre, enMapa: p.enMapa, motivos: p.motivos, verificado: p.verificado }))
      const oculto = prestadores.find((p) => p.nombre === 'Plomería Oculta')
      out.beforePublish = (await directory.buscarCandidatos({ oficio: 'plomeria', zona: 'Camba Cuá', exigirCobertura: true })).items.length
      out.publish = (await call('/tus/v1/admin/prestadores/' + oculto.id + '/visibilidad', 'admin', { visible: true })).status
      out.afterPublish = (await directory.buscarCandidatos({ oficio: 'plomeria', zona: 'Camba Cuá', exigirCobertura: true })).items.length
      out.badVisibility = (await call('/tus/v1/admin/prestadores/' + oculto.id + '/visibilidad', 'admin', { visible: 'si' })).status
      out.unknown = (await call('/tus/v1/admin/prestadores/nope/visibilidad', 'admin', { visible: false })).status
      const users = (await call('/tus/v1/admin/usuarios')).body.items
      out.users = users.map((u) => ({ email: u.email, roles: u.roles, administrada: u.administrada, verificado: u.verificado })).sort((a, b) => a.email.localeCompare(b.email))
      out.onlyProviders = (await call('/tus/v1/admin/usuarios?rol=prestador')).body.items.length
      out.search = (await call('/tus/v1/admin/usuarios?q=carla')).body.items.map((u) => u.email)
      out.noSecrets = !JSON.stringify(users).match(/passwordHash|tokenDigest|secret/iu)
      const catalogo = (await call('/tus/v1/admin/catalogo')).body
      out.plomeria = catalogo.oficios.find((o) => o.id === 'plomeria')
      out.otrosKeywords = catalogo.oficios.find((o) => o.id === 'otros').palabrasClave.includes('cerrajero')
      out.centro = catalogo.zonas.find((z) => z.nombre === 'Centro')
      out.solicitudes = (await call('/tus/v1/admin/solicitudes')).body.items
      out.actividad = (await call('/tus/v1/admin/actividad')).body.items
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.anonymous, 401)
  assert.equal(result.client, 403, 'a regular session cannot read the admin panel')
  assert.equal(result.clientUsers, 403)
  assert.deepEqual(result.resumen, { usuarios: 3, prestadores: { total: 2, enMapa: 1 }, solicitudes: { publicadas: 0, sinPostulantes: 0 }, whatsappPendientes: 2 })
  const visible = result.prestadores.find((p) => p.nombre === 'Plomería Uno')
  const hidden = result.prestadores.find((p) => p.nombre === 'Plomería Oculta')
  assert.deepEqual(visible, { nombre: 'Plomería Uno', enMapa: true, motivos: [], verificado: false })
  assert.deepEqual(hidden.motivos, ['Perfil oculto'], 'the real reason it is not on the map')
  assert.equal(result.beforePublish, 0)
  assert.equal(result.publish, 200)
  assert.equal(result.afterPublish, 1, 'publishing from the admin panel puts it on the map/search')
  assert.equal(result.badVisibility, 422)
  assert.equal(result.unknown, 404)
  assert.deepEqual(result.users.map((u) => [u.email, u.roles, u.administrada]), [
    ['cliente@example.com', ['cliente'], false],
    ['p1@example.com', ['prestador', 'cliente'], true],
    ['p2@example.com', ['prestador', 'cliente'], true],
  ])
  assert.equal(result.onlyProviders, 2)
  assert.deepEqual(result.search, ['cliente@example.com'])
  assert.equal(result.noSecrets, true)
  assert.equal(result.plomeria.prestadores, 2)
  assert.equal(result.plomeria.enMapa, 2)
  assert.equal(result.otrosKeywords, true, 'cerrajero is grouped under "Otros" and the panel shows it')
  assert.equal(result.centro.prestadores, 1)
  assert.deepEqual(result.solicitudes, [])
  assert.deepEqual(result.actividad, [], 'no invented activity without an audit source')
})

test('ADMIN PANEL UI: own layout (no workspace shell), Spanish sidebar with real sections, MFA gate in the layout', () => {
  const layout = read('apps/web/src/components/admin/admin-layout.tsx')
  for (const label of ['Inicio', 'Usuarios', 'Prestadores', 'Solicitudes', 'Servicios', 'Zonas', 'WhatsApp', 'Identidad', 'Seguridad', '← Volver al mapa', 'Mi cuenta'])
    assert.ok(layout.includes(label), label)
  assert.match(layout, /<AdminMfaGate returnTo=\{pathname\}>\{children\}<\/AdminMfaGate>/u)
  assert.match(read('apps/web/src/app/tus/admin/layout.tsx'), /<AdminLayout>\{children\}<\/AdminLayout>/u)
  assert.match(read('apps/web/src/components/layout/tus-section-shell.tsx'), /pathname\.startsWith\('\/tus\/admin\/'\)/u)
  const views = ['admin-home', 'admin-usuarios', 'admin-prestadores-lista', 'admin-solicitudes', 'admin-catalogo', 'admin-whatsapp', 'admin-seguridad'].map((name) => read(`apps/web/src/components/admin/${name}.tsx`)).join('\n')
  assert.doesNotMatch(views, /WORKSPACE|OPERATIONS|Keep the human|Handoffs|Loading the selected/iu)
  assert.doesNotMatch(views, /lorem|ipsum/iu)
  const whatsapp = read('apps/web/src/components/admin/admin-whatsapp.tsx')
  assert.match(whatsapp, /No hay conversaciones pendientes\./u)
  assert.match(whatsapp, /Elegí una conversación de la lista\./u)
  assert.match(whatsapp, /detail\.mode === 'human' && detail\.serviceWindowOpen/u, 'reply only after takeover and inside the 24 h window')
})
