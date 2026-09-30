import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// Admin lists paginated by the store (10 / 25 / 50, never more than 50), server-side filters,
// catalog ABM (services with keywords, zones and neighbourhoods with polygons) consumed by the real
// flow, aggregated counts without a query per row, provider rows without N+1, admin user creation
// with a real conflict and admin audit with the admin as actor.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

const HTTP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
  const { crearAltaPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
  const { crearRouterAdmin } = await import('./apps/api/src/tus/admin/http.ts')
  const { CuentasAdminEnMemoria, ActividadAdminEnMemoria } = await import('./apps/api/src/tus/admin/fuentes.ts')
  const { ServicioCatalogo } = await import('./apps/api/src/tus/catalogo/servicio.ts')
  const { AlmacenCatalogoEnMemoria } = await import('./apps/api/src/tus/catalogo/almacen.ts')
  const { establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  const { SEMILLA_CATALOGO } = await import('./apps/api/src/tus/catalogo/semilla.ts')
  establecerCatalogo(SEMILLA_CATALOGO)
  const identityStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: identityStore }), store: identityStore }
  const directorio = crearServicioDirectorio({ application: tusApp })
  const solicitudes = crearServicioSolicitudes({ cuentas: identityStore, destinos: directorio })
  const catalogo = new ServicioCatalogo({ almacen: new AlmacenCatalogoEnMemoria() })
  const adminAccount = await auth.service.register({ email: 'admin@example.com', password: 'una frase larga y segura 2026', displayName: 'Admin TUS' })
  const admin = { subjectId: adminAccount.account.id, tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c' }
  const sessions = { resolve: async (token) => token === 'admin' ? admin : token === 'client' ? { ...admin, subjectId: 'x', permissions: ['tus:marketplace:write'] } : null }
  const app = express(); app.use(express.json())
  app.use(crearRouterAdmin({
    sessions, directorio, solicitudes, catalogo,
    cuentas: new CuentasAdminEnMemoria(identityStore),
    actividad: new ActividadAdminEnMemoria(() => auth.audit.events),
    adminEmails: () => ['admin@example.com'],
    crearUsuario: (input) => auth.service.createAccountAsAdmin(input),
    actualizarUsuario: (input) => auth.service.updateAccountAsAdmin(input),
  }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const call = async (method, path, body, token = 'admin') => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'c', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
  const square = (lat, lng, r = 0.002) => ({ type: 'Polygon', coordinates: [[[lng - r, lat - r], [lng + r, lat - r], [lng + r, lat + r], [lng - r, lat + r], [lng - r, lat - r]]] })
`

test('PAGINATION: pageSize 10/25/50 honored, 51/100/100000 capped at 50, junk falls back to 25, page from 1', () => {
  const result = runTypeScriptScenario(`
    const { paginacion, paginaJson } = await import('./apps/api/src/tus/admin/paginacion.ts')
    const size = (pageSize) => paginacion({ pageSize }).tamano
    console.log(JSON.stringify({
      allowed: [10, 25, 50].map(String).map(size),
      capped: ['51', '100', '100000', '999999999'].map(size),
      fallback: [undefined, '', '0', '-5', '7', 'abc', '25.5', '1e9'].map(size),
      pages: ['0', '-3', 'x', '3', '99999999'].map((page) => paginacion({ page }).pagina),
      empty: paginaJson([], 7, 25, 0),
    }))
  `)
  assert.deepEqual(result.allowed, [10, 25, 50])
  assert.deepEqual(result.capped, [50, 50, 50, 50])
  // '25.5' parses as 25 (an allowed size) and '1e9' as 1; everything else is the default.
  assert.deepEqual(result.fallback, [25, 25, 25, 25, 25, 25, 25, 25])
  assert.deepEqual(result.pages, [1, 1, 1, 3, 10000])
  assert.deepEqual(result.empty, { items: [], page: 7, pageSize: 25, total: 0, totalPages: 1 })
})

test('CATALOG LISTS: server-side pages, filters, stable order and the 50 cap over HTTP', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    const out = {}
    try {
      for (let index = 0; index < 60; index += 1)
        await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'Barrio prueba ' + String(index).padStart(2, '0'), localidadId: 'corrientes-capital', lat: -27.4 - index / 1000, lng: -58.8, poligono: square(-27.4 - index / 1000, -58.8, 0.0004), orden: 500 })
      const all = (await call('GET', '/tus/v1/admin/catalogo')).body.barrios.length
      const page = (query) => call('GET', '/tus/v1/admin/catalogo/barrios?' + query).then((r) => r.body)
      out.total = all
      for (const size of [10, 25, 50, 51, 100, 100000]) {
        const body = await page('pageSize=' + size)
        out['size' + size] = [body.pageSize, body.items.length, body.total]
      }
      const seen = []
      for (let p = 1; p <= Math.ceil(all / 25); p += 1) seen.push(...(await page('pageSize=25&page=' + p)).items.map((b) => b.id))
      out.stable = [seen.length, new Set(seen).size]
      out.beyond = await page('page=999')
      out.search = (await page('q=prueba%2005')).items.map((b) => b.nombre)
      out.accents = (await page('q=' + encodeURIComponent('camba cua'))).items.map((b) => b.nombre)
      await call('PUT', '/tus/v1/admin/catalogo/barrios/' + (await page('q=prueba%2001')).items[0].id, { activo: false })
      out.inactive = (await page('estado=inactivo')).items.map((b) => b.nombre)
      out.activeTotal = (await page('estado=activo')).total
      const zona = (await call('POST', '/tus/v1/admin/catalogo/zonas', { nombre: 'Norte', localidadId: 'corrientes-capital' })).body.item
      await call('PUT', '/tus/v1/admin/catalogo/barrios/barrio-centro', { zonaId: zona.id })
      out.byZone = (await page('zona=' + zona.id)).items.map((b) => b.nombre)
      out.zones = (await call('GET', '/tus/v1/admin/catalogo/zonas?q=nor')).body.items.map((z) => [z.nombre, z.barrios])
      out.oficiosByCategory = (await call('GET', '/tus/v1/admin/catalogo/oficios?categoria=climatizacion')).body.items.map((o) => [o.id, o.categoriaId])
      out.oficiosBySynonym = (await call('GET', '/tus/v1/admin/catalogo/oficios?q=canilla')).body.items.map((o) => o.id)
      out.oficiosByAccentless = (await call('GET', '/tus/v1/admin/catalogo/oficios?q=plomeria')).body.items.map((o) => o.id)
      out.unknown = (await call('GET', '/tus/v1/admin/catalogo/nope')).status
      out.client = (await call('GET', '/tus/v1/admin/catalogo/barrios', null, 'client')).status
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.ok(result.total > 60)
  assert.deepEqual(result.size10.slice(0, 2), [10, 10])
  assert.deepEqual(result.size25.slice(0, 2), [25, 25])
  assert.deepEqual(result.size50.slice(0, 2), [50, 50])
  for (const size of ['size51', 'size100', 'size100000']) assert.deepEqual(result[size].slice(0, 2), [50, 50], `${size} never returns more than 50`)
  assert.equal(result.size10[2], result.total, 'the total is the filtered count, not the page size')
  assert.deepEqual(result.stable, [result.total, result.total], 'walking every page returns each row once (stable order with id tie-break)')
  assert.deepEqual(result.beyond.items, [])
  assert.equal(result.beyond.page, 999)
  assert.deepEqual(result.search, ['Barrio prueba 05'])
  assert.deepEqual(result.accents, ['Camba Cuá'])
  assert.deepEqual(result.inactive, ['Barrio prueba 01'])
  assert.equal(result.activeTotal, result.total - 1)
  assert.deepEqual(result.byZone, ['Centro'])
  assert.deepEqual(result.zones, [['Norte', 1]])
  assert.ok(result.oficiosByCategory.some(([id]) => id === 'aire'))
  assert.ok(result.oficiosByCategory.every(([, categoria]) => categoria === 'climatizacion'))
  assert.ok(result.oficiosBySynonym.includes('plomeria'))
  assert.ok(result.oficiosByAccentless.includes('plomeria'))
  assert.equal(result.unknown, 404)
  assert.equal(result.client, 403)
})

test('SERVICES + ZONES ABM: keywords normalized, duplicates rejected, deactivation keeps history, the real flow uses the catalog', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    const { buscarOficio, esOficioVigente, barriosVigentes, buscarBarrio } = await import('./apps/api/src/tus/catalogo/vigente.ts')
    const { catalogoUbicacionesPublico } = await import('./apps/api/src/tus/catalogo/publico.ts')
    const { interpretarNecesidad } = await import('./apps/api/src/tus/directorio/modelo.ts')
    const out = {}
    try {
      // Services
      const created = await call('POST', '/tus/v1/admin/catalogo/oficios', { nombre: 'Vidriería', profesion: 'Vidriero/a', categoriaId: 'hogar', icono: 'herramienta', sinonimos: ['  Vidrio ', 'vidrio', 'VIDRIERO', 'ventana rota', 'Mampara'] })
      out.created = [created.status, created.body.item.id, created.body.item.sinonimos]
      out.duplicate = (await call('POST', '/tus/v1/admin/catalogo/oficios', { nombre: 'VIDRIERIA' })).status
      out.badKeyword = (await call('PUT', '/tus/v1/admin/catalogo/oficios/vidrieria', { sinonimos: ['v'] })).body.error.campos
      out.edited = (await call('PUT', '/tus/v1/admin/catalogo/oficios/vidrieria', { profesion: 'Vidriero', sinonimos: ['vidrio', 'espejo'] })).body.item
      out.off = (await call('PUT', '/tus/v1/admin/catalogo/oficios/vidrieria', { activo: false })).body.item.activo
      out.history = [buscarOficio('vidrieria')?.nombre ?? null, esOficioVigente('vidrieria')]
      out.on = (await call('PUT', '/tus/v1/admin/catalogo/oficios/vidrieria', { activo: true })).body.item.activo
      // Neighbourhoods: create, invalid polygons, edit, deactivate
      const ponce = await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'Ponce', localidadId: 'corrientes-capital', lat: -27.452, lng: -58.79, poligono: square(-27.452, -58.79) })
      out.ponce = ponce.status
      const ponceId = ponce.body.item.id
      out.bowtie = (await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'Cruzado', localidadId: 'corrientes-capital', lat: -27.4, lng: -58.8, poligono: { type: 'Polygon', coordinates: [[[-58.8, -27.4], [-58.79, -27.39], [-58.79, -27.4], [-58.8, -27.39], [-58.8, -27.4]]] } })).body.error.campos
      out.twoPoints = (await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'Linea', localidadId: 'corrientes-capital', lat: -27.4, lng: -58.8, poligono: { type: 'Polygon', coordinates: [[[-58.8, -27.4], [-58.79, -27.39]]] } })).body.error.campos
      out.outOfRange = (await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'Fuera', localidadId: 'corrientes-capital', lat: -27.4, lng: -58.8, poligono: { type: 'Polygon', coordinates: [[[-200, -27.4], [-58.79, -27.39], [-58.79, -27.4]]] } })).body.error.campos
      const bigger = square(-27.452, -58.79, 0.004)
      out.editPolygon = (await call('PUT', '/tus/v1/admin/catalogo/barrios/' + ponceId, { poligono: bigger })).body.item.poligono.coordinates[0].length
      const publicPonce = catalogoUbicacionesPublico().localities[0].neighbourhoods.find((item) => item.name === 'Ponce')
      out.publicPolygon = publicPonce ? publicPonce.polygon : null
      out.recognized = interpretarNecesidad('necesito un plomero en ponce').zone
      out.offered = barriosVigentes().some((item) => item.nombre === 'Ponce')
      await call('PUT', '/tus/v1/admin/catalogo/barrios/' + ponceId, { activo: false })
      out.offeredAfter = barriosVigentes().some((item) => item.nombre === 'Ponce')
      out.publicAfter = catalogoUbicacionesPublico().localities[0].neighbourhoods.some((item) => item.name === 'Ponce')
      out.historyAfter = buscarBarrio('Ponce')?.nombre ?? null
      out.recognizedAfter = interpretarNecesidad('necesito un plomero en ponce').zone
      out.renamedInactive = (await call('PUT', '/tus/v1/admin/catalogo/barrios/' + ponceId, { nombre: 'Ponce Norte' })).status
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.created, [201, 'vidrieria', ['vidrio', 'vidriero', 'ventana rota', 'mampara']], 'keywords trimmed, lower-cased, deduplicated')
  assert.equal(result.duplicate, 409)
  assert.deepEqual(result.badKeyword, ['sinonimos'])
  assert.equal(result.edited.profesion, 'Vidriero')
  assert.deepEqual(result.edited.sinonimos, ['vidrio', 'espejo'])
  assert.equal(result.off, false)
  assert.deepEqual(result.history, ['Vidriería', false], 'a deactivated service keeps its label for history but is not offered')
  assert.equal(result.on, true)
  assert.equal(result.ponce, 201)
  assert.deepEqual(result.bowtie, ['poligono'], 'a self-intersecting polygon is rejected')
  assert.deepEqual(result.twoPoints, ['poligono'])
  assert.deepEqual(result.outOfRange, ['poligono'])
  assert.equal(result.editPolygon, 5)
  assert.equal(result.publicPolygon.type, 'Polygon')
  assert.equal(result.publicPolygon.coordinates[0].length, 5)
  assert.deepEqual(result.publicPolygon.coordinates[0][0], result.publicPolygon.coordinates[0][4], 'closed GeoJSON ring')
  assert.equal(result.recognized, 'Ponce', 'a neighbourhood created from the admin panel is recognised by the real flow')
  assert.equal(result.offered, true)
  assert.equal(result.offeredAfter, false, 'a deactivated neighbourhood is not offered for new flows')
  assert.equal(result.publicAfter, false)
  assert.equal(result.historyAfter, 'Ponce', 'history keeps resolving the neighbourhood')
  assert.equal(result.recognizedAfter, null)
  assert.equal(result.renamedInactive, 200)
})

test('USERS: admin creation with a real 409, public sign-up still indistinguishable, suspension revokes sessions, audit names the admin', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    const out = {}
    try {
      const password = 'otra frase larga y segura 2026'
      const create = await call('POST', '/tus/v1/admin/usuarios', { displayName: 'Carla Cliente', email: 'carla@example.com', password })
      out.create = [create.status, create.body]
      const mailsBefore = auth.email.messages.length
      const duplicate = await call('POST', '/tus/v1/admin/usuarios', { displayName: 'Otra', email: ' CARLA@example.com ', password })
      out.duplicate = [duplicate.status, duplicate.body.error.code]
      out.noMailOnConflict = auth.email.messages.length === mailsBefore
      out.publicExisting = (await auth.service.registerAccount({ email: 'carla@example.com', password, displayName: 'X' })).status
      out.publicNew = (await auth.service.registerAccount({ email: 'nueva@example.com', password, displayName: 'Nueva' })).status
      out.roleAdmin = (await call('POST', '/tus/v1/admin/usuarios', { displayName: 'Admin 2', email: 'a2@example.com', password, role: 'admin' })).status
      out.invalid = (await call('POST', '/tus/v1/admin/usuarios', { displayName: 'C', email: 'mal', password: 'corta' })).status
      out.clientCreate = (await call('POST', '/tus/v1/admin/usuarios', { displayName: 'Hack', email: 'h@example.com', password }, 'client')).status
      const carla = [...identityStore.accounts.values()].find((a) => a.normalizedEmail === 'carla@example.com')
      await auth.service.verifyEmail({ token: auth.email.messages.find((m) => m.email === 'carla@example.com' && m.kind === 'verification').token })
      const signIn = await auth.service.signIn({ email: 'carla@example.com', password })
      out.signedIn = signIn.ok
      out.rename = (await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { displayName: 'Carla Gómez' })).status
      out.renamed = identityStore.accounts.get(carla.id).displayName
      out.roleChange = (await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { role: 'admin' })).status
      out.suspend = (await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { status: 'suspended', reason: 'Pedido del titular' })).status
      out.sessionsRevoked = [...identityStore.sessions.values()].filter((s) => s.accountId === carla.id).every((s) => s.revokedAt !== null)
      out.signInSuspended = (await auth.service.signIn({ email: 'carla@example.com', password })).ok
      out.reactivate = (await call('PATCH', '/tus/v1/admin/usuarios/' + carla.id, { status: 'active' })).status
      out.selfSuspend = (await call('PATCH', '/tus/v1/admin/usuarios/' + admin.subjectId, { status: 'suspended' })).status
      out.audit = auth.audit.events.filter((e) => e.kind.startsWith('account.admin_')).map((e) => ({ kind: e.kind, actorId: e.actorId === admin.subjectId, target: e.metadata.targetAccountId === carla.id, action: e.metadata.action, fields: e.metadata.changedFields, reason: e.metadata.reason ?? null, noEmail: !JSON.stringify(e).includes('carla@') }))
      out.auditPage = (await call('GET', '/tus/v1/admin/actividad?tipo=usuarios&pageSize=10')).body
      const many = []
      for (let index = 0; index < 55; index += 1) many.push(auth.service.register({ email: 'u' + index + '@example.com', password, displayName: 'Usuario ' + index }))
      await Promise.all(many)
      const users = (await call('GET', '/tus/v1/admin/usuarios?pageSize=100000')).body
      out.users = [users.pageSize, users.items.length, users.total]
      out.usersPage3 = (await call('GET', '/tus/v1/admin/usuarios?pageSize=25&page=3')).body.items.length
      out.usersSearch = (await call('GET', '/tus/v1/admin/usuarios?q=usuario%2054&pageSize=10')).body.items.map((u) => u.email)
      out.usersSuspended = (await call('GET', '/tus/v1/admin/usuarios?estado=suspended')).body.total
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.create, [201, { created: true }])
  assert.deepEqual(result.duplicate, [409, 'EMAIL_ALREADY_REGISTERED'], 'the admin gets a real conflict')
  assert.equal(result.noMailOnConflict, true, 'the existing owner is not notified by an admin conflict')
  assert.equal(result.publicExisting, 'pending_verification', 'public sign-up keeps answering the same for an existing email')
  assert.equal(result.publicNew, 'pending_verification')
  assert.equal(result.roleAdmin, 422, 'admin authority is never created from the general form')
  assert.equal(result.invalid, 422)
  assert.equal(result.clientCreate, 403)
  assert.equal(result.signedIn, true)
  assert.equal(result.rename, 200)
  assert.equal(result.renamed, 'Carla Gómez')
  assert.equal(result.roleChange, 422)
  assert.equal(result.suspend, 200)
  assert.equal(result.sessionsRevoked, true)
  assert.equal(result.signInSuspended, false)
  assert.equal(result.reactivate, 200)
  assert.equal(result.selfSuspend, 403)
  assert.deepEqual(result.audit.map((e) => e.kind), ['account.admin_created', 'account.admin_updated', 'account.admin_suspended', 'account.admin_reactivated'])
  assert.ok(result.audit.every((e) => e.actorId && e.target && e.noEmail), 'actor = admin, target = the account, no email in the audit')
  assert.deepEqual(result.audit.map((e) => e.action), ['created', 'updated', 'suspended', 'reactivated'])
  assert.equal(result.audit[1].fields, 'displayName')
  assert.equal(result.audit[2].reason, 'Pedido del titular')
  assert.equal(result.auditPage.total, 4)
  assert.equal(result.auditPage.items[0].tipo, 'account.admin_reactivated', 'newest first')
  assert.deepEqual(result.users.slice(0, 2), [50, 50])
  assert.ok(result.users[2] > 55)
  assert.ok(result.usersPage3 > 0 && result.usersPage3 <= 25)
  assert.deepEqual(result.usersSearch, ['u54@example.com'])
  assert.equal(result.usersSuspended, 0)
})

test('PROVIDERS: the admin page reads merchants and identity in one batch each (no N+1), counts are real, the identity filter uses the verified state', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    const { ServicioDirectorio } = await import('./apps/api/src/tus/directorio/servicio.ts')
    const { AlmacenPerfilesEnMemoria, AlmacenPerfilesPrisma, FuentesDirectorioTus } = await import('./apps/api/src/tus/directorio/almacenes.ts')
    const { ConteosCatalogoPrisma } = await import('./apps/api/src/tus/admin/conteos.ts')
    const { AlmacenCatalogoPrisma } = await import('./apps/api/src/tus/catalogo/almacen.ts')
    const out = {}
    try {
      const save = crearAltaPrestadorAdmin({ accounts: identityStore, application: tusApp, directorio, createManagedAccount: (input) => auth.service.createManagedProviderAccount(input) })
      for (let index = 0; index < 12; index += 1)
        out['save' + index] = (await save(admin, { email: 'p' + index + '@example.com', displayName: 'Prestador ' + index, profession: index % 2 ? 'plomeria' : 'electricidad', zone: index % 3 ? 'Centro' : 'Camba Cuá', serviceZones: [], serviceMode: 'domicilio', description: 'Trabajos de calidad en la zona', visible: index !== 0 })).status
      // Batch evidence: count every per-tenant read made by a page of providers.
      const calls = { find: 0, findMany: 0 }
      const store = tusApp.marketplace.store.merchant
      const originalFind = store.find, originalFindMany = store.findMany
      store.find = async (...args) => { calls.find += 1; return originalFind(...args) }
      store.findMany = async (...args) => { calls.findMany += 1; return originalFindMany(...args) }
      const page = await call('GET', '/tus/v1/admin/prestadores?pageSize=10')
      out.page = [page.body.items.length, page.body.total, page.body.pageSize]
      out.calls = { ...calls }
      out.filtered = (await call('GET', '/tus/v1/admin/prestadores?oficio=plomeria&pageSize=50')).body.items.every((p) => p.oficio === 'plomeria')
      out.hidden = (await call('GET', '/tus/v1/admin/prestadores?visibilidad=oculto')).body.items.map((p) => p.nombre)
      out.capped = (await call('GET', '/tus/v1/admin/prestadores?pageSize=100')).body.pageSize
      // Real counts from the catalog lists (aggregates, not a query per row).
      const oficios = (await call('GET', '/tus/v1/admin/catalogo/oficios?q=plomer')).body.items
      out.plomeria = oficios.find((o) => o.id === 'plomeria')
      out.centro = (await call('GET', '/tus/v1/admin/catalogo/barrios?q=centro')).body.items.find((b) => b.nombre === 'Centro')
      // Prisma adapters: fixed number of queries, real delegate and state for identity.
      const log = []
      const fakeDelegate = (name) => ({
        findMany: async (input) => { log.push([name, 'findMany', input]); return [] },
        count: async (input) => { log.push([name, 'count', input]); return 0 },
        groupBy: async (input) => { log.push([name, 'groupBy', input]); return [] },
        findFirst: async () => null, upsert: async () => ({}),
      })
      const client = { perfilPublicoPrestador: fakeDelegate('perfil'), verificacionIdentidad: fakeDelegate('verificacion'), trabajo: fakeDelegate('trabajo'), solicitudServicio: fakeDelegate('solicitud'), oficioServicio: fakeDelegate('oficio'), barrio: fakeDelegate('barrio'), categoriaServicio: fakeDelegate('categoria'), localidad: fakeDelegate('localidad'), zonaUbicacion: fakeDelegate('zona'), $queryRawUnsafe: async (sql, ...values) => { log.push(['raw', sql.includes('zona_id') ? 'zona' : 'barrio', values]); return [] } }
      await new AlmacenPerfilesPrisma(client).paginaAdmin({ pagina: 3, tamano: 50, q: 'ana', oficio: 'plomeria', zona: 'Centro', visible: true, verificado: false })
      const verification = log.find((entry) => entry[0] === 'verificacion')
      out.identityQuery = verification[2]
      const profiles = log.find((entry) => entry[0] === 'perfil' && entry[1] === 'findMany')[2]
      out.profilesQuery = { skip: profiles.skip, take: profiles.take, orderBy: profiles.orderBy }
      log.length = 0
      const conteos = new ConteosCatalogoPrisma(client)
      const ids = Array.from({ length: 50 }, (_, index) => 'oficio-' + index)
      await Promise.all([conteos.porOficio(ids), conteos.porBarrio(ids), conteos.porZona(ids), conteos.oficiosPorCategoria(ids)])
      out.countQueries = log.length
      log.length = 0
      await new AlmacenCatalogoPrisma(client).pagina('barrios', { pagina: 2, tamano: 50, q: 'San Martín', activo: true, categoriaId: '', localidadId: 'corrientes-capital', zonaId: '' })
      const catalogPage = log.find((entry) => entry[1] === 'findMany')[2]
      out.catalogQuery = { skip: catalogPage.skip, take: catalogPage.take, orderBy: catalogPage.orderBy, where: catalogPage.where }
      out.catalogCount = log.filter((entry) => entry[1] === 'count').length
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  for (let index = 0; index < 12; index += 1) assert.equal(result['save' + index], 200, 'admin provider registration keeps working')
  assert.deepEqual(result.page, [10, 12, 10])
  assert.deepEqual(result.calls, { find: 0, findMany: 1 }, 'one batch read of merchants for the whole page, never one per provider')
  assert.equal(result.filtered, true)
  assert.deepEqual(result.hidden, ['Prestador 0'])
  assert.equal(result.capped, 50)
  assert.deepEqual({ prestadores: result.plomeria.prestadores, enMapa: result.plomeria.enMapa }, { prestadores: 6, enMapa: 6 })
  assert.ok(result.centro.prestadores >= 7, 'visible approved providers attending Centro')
  assert.deepEqual(result.identityQuery.where, { estado: 'verified' }, 'the real VerificacionIdentidad state is "verified"')
  assert.deepEqual(result.identityQuery.distinct, ['tenantId'])
  assert.deepEqual(result.profilesQuery, { skip: 100, take: 50, orderBy: [{ fechaActualizacion: 'desc' }, { id: 'desc' }] })
  assert.equal(result.countQueries, 6, 'counts for 50 rows: 6 aggregate queries in total (1 trade over perfil_servicios, 2 neighbourhood, 2 zone, 1 category)')
  assert.deepEqual(result.catalogQuery.orderBy, [{ orden: 'asc' }, { nombre: 'asc' }, { id: 'asc' }])
  assert.equal(result.catalogQuery.skip, 50)
  assert.equal(result.catalogQuery.take, 50)
  assert.deepEqual(result.catalogQuery.where.AND.slice(1), [{ activo: true }, { localidadId: 'corrientes-capital' }])
  assert.equal(result.catalogCount, 1)
})

test('ADMIN WEB: lists use server pagination, filters reset to page 1, sensitive actions confirm in a modal, no admin role in the user form', () => {
  const catalogo = read('apps/web/src/components/admin/admin-catalogo.tsx')
  const usuarios = read('apps/web/src/components/admin/admin-usuarios.tsx')
  const prestadores = read('apps/web/src/components/admin/admin-prestadores-lista.tsx')
  const seguridad = read('apps/web/src/components/admin/admin-seguridad.tsx')
  const whatsapp = read('apps/web/src/components/admin/admin-whatsapp.tsx')
  const identidad = read('apps/web/src/components/admin/verificaciones-identidad.tsx')
  const confirm = read('apps/web/src/components/admin/admin-confirm.tsx')
  const api = read('apps/web/src/lib/tus-admin-api.ts')
  assert.match(api, /\/tus\/v1\/admin\/catalogo\/\$\{entidad\}\?/)
  assert.match(catalogo, /adminApi\.listaCatalogo\(entidad/)
  // Changing a filter goes back to page 1; paging keeps the filters.
  assert.match(catalogo, /const setFiltros = \(cambio: Partial<Filtros>\) => \{ setFiltrosState\(\(actual\) => \(\{ \.\.\.actual, \.\.\.cambio \}\)\); setPage\(1\) \}/)
  for (const source of [catalogo, usuarios, prestadores, seguridad, whatsapp, identidad]) assert.match(source, /AdminPagination/)
  for (const source of [whatsapp, identidad, seguridad]) assert.match(source, /setPage\(1\)/)
  assert.match(catalogo, /¿Desactivar \$\{item\.nombre\}\?/)
  assert.match(catalogo, /El historial existente se conservará/)
  assert.match(usuarios, /¿Suspender a/)
  assert.match(prestadores, /¿Ocultar a/)
  assert.match(confirm, /showModal\(\)/)
  for (const source of [catalogo, usuarios, prestadores, confirm]) assert.doesNotMatch(source, /window\.confirm|\bconfirm\(/)
  // Keywords as removable chips.
  assert.match(catalogo, /aria-label=\{`Quitar \$\{palabra\}`\}/)
  // The general user form only creates clients.
  assert.doesNotMatch(usuarios, /<option value="admin"/)
  assert.match(usuarios, /role: 'cliente'/)
  assert.match(usuarios, /error\.status === 409/)
})
