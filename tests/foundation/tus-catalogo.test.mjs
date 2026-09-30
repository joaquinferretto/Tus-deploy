import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// Administered catalog (categories, trades + synonyms + icon, locality -> zone -> neighbourhood):
// ABM from the admin panel, validation, logical deactivation, audit, and the interpreter / directory
// / requests / WhatsApp tools reading it without a code change.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

const HTTP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
  const { crearRouterAdmin } = await import('./apps/api/src/tus/admin/http.ts')
  const { CuentasAdminEnMemoria } = await import('./apps/api/src/tus/admin/fuentes.ts')
  const { ServicioCatalogo } = await import('./apps/api/src/tus/catalogo/servicio.ts')
  const { AlmacenCatalogoEnMemoria } = await import('./apps/api/src/tus/catalogo/almacen.ts')
  const { establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  const { SEMILLA_CATALOGO } = await import('./apps/api/src/tus/catalogo/semilla.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  establecerCatalogo(SEMILLA_CATALOGO)
  const eventos = []
  const catalogo = new ServicioCatalogo({ almacen: new AlmacenCatalogoEnMemoria(), auditar: async (evento) => { eventos.push(evento) }, referenciasBarrio: async (nombre) => (nombre === 'Centro' ? 1 : 0) })
  const directorio = crearServicioDirectorio({ application: tusApp })
  const identityStore = new InMemoryIdentityStore()
  const solicitudes = crearServicioSolicitudes({ cuentas: identityStore, destinos: directorio })
  const admin = { subjectId: 'admin-1', tenantId: 'platform', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c' }
  const sessions = { resolve: async (token) => token === 'admin' ? admin : token === 'client' ? { ...admin, permissions: ['tus:marketplace:write'] } : null }
  const app = express(); app.use(express.json())
  app.use(crearRouterAdmin({ sessions, directorio, solicitudes, cuentas: new CuentasAdminEnMemoria(identityStore), adminEmails: () => [], catalogo }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const call = async (method, path, body, token = 'admin') => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'c', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
`

test('CATALOG ABM: categories, trades with synonyms, localities, zones and neighbourhoods; validation, duplicates, permissions, audit, no delete', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    const out = {}
    try {
      out.anonymous = (await fetch('http://127.0.0.1:' + server.address().port + '/tus/v1/admin/catalogo/categorias', { method: 'POST' })).status
      out.client = (await call('POST', '/tus/v1/admin/catalogo/categorias', { nombre: 'Algo' }, 'client')).status
      // Categories
      const cat = await call('POST', '/tus/v1/admin/catalogo/categorias', { nombre: 'Electrodomésticos', descripcion: 'Arreglos de equipos', orden: 5 })
      out.catCreate = [cat.status, cat.body.item.id, cat.body.item.slug]
      out.catDuplicate = (await call('POST', '/tus/v1/admin/catalogo/categorias', { nombre: '  electrodomesticos ' })).status
      out.catEmpty = (await call('POST', '/tus/v1/admin/catalogo/categorias', { nombre: ' ' })).body.error
      out.catEdit = (await call('PUT', '/tus/v1/admin/catalogo/categorias/electrodomesticos', { descripcion: 'Heladeras y lavarropas' })).body.item.descripcion
      out.catOff = (await call('PUT', '/tus/v1/admin/catalogo/categorias/electrodomesticos', { activo: false })).body.item.activo
      out.catOn = (await call('PUT', '/tus/v1/admin/catalogo/categorias/electrodomesticos', { activo: true })).body.item.activo
      out.catMissing = (await call('PUT', '/tus/v1/admin/catalogo/categorias/nope', { activo: true })).status
      // Trades
      const oficio = await call('POST', '/tus/v1/admin/catalogo/oficios', { nombre: 'Reparación de electrodomésticos', profesion: 'Técnico/a de electrodomésticos', categoriaId: 'electrodomesticos', icono: 'electrodomesticos', sinonimos: ['lavarropas', 'Heladera', 'heladera', 'electrodoméstico', 'microondas'] })
      out.oficio = [oficio.status, oficio.body.item.id, oficio.body.item.sinonimos]
      out.oficioBadCategory = (await call('POST', '/tus/v1/admin/catalogo/oficios', { nombre: 'Otro servicio', categoriaId: 'nope' })).body.error.campos
      out.oficioBadIcon = (await call('POST', '/tus/v1/admin/catalogo/oficios', { nombre: 'Otro servicio', icono: '<svg onload=x>' })).body.error.campos
      out.oficioBadSynonym = (await call('POST', '/tus/v1/admin/catalogo/oficios', { nombre: 'Otro servicio', sinonimos: ['x'] })).body.error.campos
      out.oficioDuplicate = (await call('POST', '/tus/v1/admin/catalogo/oficios', { nombre: 'PLOMERÍA' })).status
      out.oficioSynonyms = (await call('PUT', '/tus/v1/admin/catalogo/oficios/reparacion-de-electrodomesticos', { sinonimos: ['lavarropas', 'heladera', 'secarropas'] })).body.item.sinonimos
      // Locations
      const zona = await call('POST', '/tus/v1/admin/catalogo/zonas', { nombre: 'Norte', localidadId: 'corrientes-capital' })
      out.zona = zona.status
      const zonaId = zona.body.item.id
      out.zonaDuplicate = (await call('POST', '/tus/v1/admin/catalogo/zonas', { nombre: 'norte', localidadId: 'corrientes-capital' })).status
      out.zonaBadLocality = (await call('POST', '/tus/v1/admin/catalogo/zonas', { nombre: 'Sur', localidadId: 'nope' })).body.error.campos
      const ponce = await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'Ponce', localidadId: 'corrientes-capital', zonaId, lat: -27.452, lng: -58.79, poligono: { type: 'Polygon', coordinates: [[[-58.793, -27.455], [-58.787, -27.455], [-58.787, -27.449], [-58.793, -27.449], [-58.793, -27.455]]] } })
      out.ponce = [ponce.status, ponce.body.item.zonaId === zonaId]
      out.barrioNoPoint = (await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'Sin punto', localidadId: 'corrientes-capital' })).body.error.campos
      out.barrioDuplicate = (await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'PONCE', localidadId: 'corrientes-capital', lat: -27.4, lng: -58.8, poligono: { type: 'Polygon', coordinates: [[[-58.803, -27.403], [-58.797, -27.403], [-58.797, -27.397], [-58.803, -27.397], [-58.803, -27.403]]] } })).status
      out.renameInUse = (await call('PUT', '/tus/v1/admin/catalogo/barrios/barrio-centro', { nombre: 'Centro Histórico' })).body.error.code
      out.moveBarrio = (await call('PUT', '/tus/v1/admin/catalogo/barrios/barrio-molina-punta', { zonaId })).body.item.zonaId === zonaId
      out.localidad = (await call('POST', '/tus/v1/admin/catalogo/localidades', { nombre: 'Resistencia', provincia: 'Chaco' })).status
      const full = (await call('GET', '/tus/v1/admin/catalogo')).body
      out.norte = full.zonas.find((z) => z.nombre === 'Norte').barrios
      out.noDeleteRoute = (await fetch('http://127.0.0.1:' + server.address().port + '/tus/v1/admin/catalogo/oficios/plomeria', { method: 'DELETE', headers: { authorization: 'Bearer admin', 'x-correlation-id': 'c' } })).status
      out.audit = eventos.map((e) => e.entidad + ':' + e.accion)
      out.auditActor = eventos.every((e) => e.actorId === 'admin-1')
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.anonymous, 401)
  assert.equal(result.client, 403, 'only platform admins manage the catalog')
  assert.deepEqual(result.catCreate, [201, 'electrodomesticos', 'electrodomesticos'])
  assert.equal(result.catDuplicate, 409, 'case/accent-insensitive unique names')
  assert.deepEqual(result.catEmpty.campos, ['nombre'])
  assert.equal(result.catEdit, 'Heladeras y lavarropas')
  assert.deepEqual([result.catOff, result.catOn], [false, true])
  assert.equal(result.catMissing, 404)
  assert.deepEqual(result.oficio, [201, 'reparacion-de-electrodomesticos', ['lavarropas', 'heladera', 'electrodomestico', 'microondas']], 'synonyms normalized and deduplicated')
  assert.deepEqual(result.oficioBadCategory, ['categoriaId'])
  assert.deepEqual(result.oficioBadIcon, ['icono'], 'icons are keys of our own set, never markup')
  assert.deepEqual(result.oficioBadSynonym, ['sinonimos'])
  assert.equal(result.oficioDuplicate, 409)
  assert.deepEqual(result.oficioSynonyms, ['lavarropas', 'heladera', 'secarropas'])
  assert.equal(result.zona, 201)
  assert.equal(result.zonaDuplicate, 409)
  assert.deepEqual(result.zonaBadLocality, ['localidadId'])
  assert.deepEqual(result.ponce, [201, true])
  // DIR-06: the polygon is optional (it can be removed); the reference point stays mandatory.
  assert.deepEqual(result.barrioNoPoint, ['ubicacion'], 'a neighbourhood needs its map point')
  assert.equal(result.barrioDuplicate, 409)
  assert.equal(result.renameInUse, 'IN_USE_RENAME', 'renaming a neighbourhood in use would orphan profiles/requests')
  assert.equal(result.moveBarrio, true, 'a neighbourhood can move between zones')
  assert.equal(result.localidad, 201)
  assert.equal(result.norte, 2)
  assert.equal(result.noDeleteRoute, 404, 'no physical delete')
  for (const kind of ['categoria:creada', 'categoria:modificada', 'categoria:desactivada', 'categoria:activada', 'oficio:creado', 'oficio:sinonimos_modificados', 'zona:creada', 'barrio:creado', 'barrio:movido_de_zona', 'localidad:creada'])
    assert.ok(result.audit.includes(kind), kind)
  assert.equal(result.auditActor, true)
})

test('CATALOG SEARCH: synonyms and places from the catalog; new trade and neighbourhood work without code; inactive ones are not offered', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${HTTP}
    const { interpretarNecesidad } = await import('./apps/api/src/tus/directorio/modelo.ts')
    const { crearAltaPrestadorAdmin } = await import('./apps/api/src/tus/directorio/admin.ts')
    const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
    const { searchServices } = await import('./apps/web/src/features/home/service-search.ts')
    const { respond } = await import('./apps/web/src/features/home/assistant-service.ts')
    const { definicionChat, HERRAMIENTAS } = await import('./apps/api/src/tus/asistente/herramientas.ts')
    const i = (text) => interpretarNecesidad(text)
    const out = {}
    try {
      out.base = [i('se rompió una cañería').category, i('no prende el aire').category, i('plomero en Centro'), i('se me trabó la puerta, necesito un cerrajero').category, i('necesito hacer un revoque').category]
      // The real flow the owner asked for: Construcción -> Albañilería (already seeded) + Ponce (new).
      await call('PUT', '/tus/v1/admin/catalogo/oficios/albanileria', { sinonimos: ['albanil', 'pared', 'revoque'] })
      const zona = (await call('POST', '/tus/v1/admin/catalogo/zonas', { nombre: 'Norte', localidadId: 'corrientes-capital' })).body.item.id
      out.ponceBefore = i('albañil en Ponce').zone
      await call('POST', '/tus/v1/admin/catalogo/barrios', { nombre: 'Ponce', localidadId: 'corrientes-capital', zonaId: zona, lat: -27.452, lng: -58.79, poligono: { type: 'Polygon', coordinates: [[[-58.793, -27.455], [-58.787, -27.455], [-58.787, -27.449], [-58.793, -27.449], [-58.793, -27.455]]] } })
      out.ponceAfter = i('albañil en Ponce')
      out.zoneWord = i('electricista en Norte').zone
      // A provider in Ponce, loaded by the admin (managed account).
      const auth = createAuthService({ store: identityStore })
      const alta = crearAltaPrestadorAdmin({ accounts: identityStore, application: tusApp, directorio, createManagedAccount: (input) => auth.service.createManagedProviderAccount(input) })
      out.alta = (await alta(admin, { email: 'albanil@example.com', displayName: 'Albañil de Ponce', profession: 'albanileria', zone: 'Ponce', serviceZones: ['Ponce'], serviceMode: 'domicilio', description: 'Paredes y revoques', visible: true })).status
      const deps = { catalog: [{ id: 'albanileria', label: 'Albañilería' }], interpret: async (text) => directorio.interpretar(text), providers: async (filters) => (await directorio.listar({ oficio: filters.profession, zona: filters.zone, q: filters.query })).items }
      const found = async (text) => { const o = await searchServices(text, deps); return o.kind === 'category' ? o.providers.map((p) => p.displayName) : o.kind }
      out.searches = [await found('necesito un albañil'), await found('necesito hacer un revoque'), await found('albañil en Ponce'), await found('albañil en Norte')]
      out.assistant = (await respond('necesito un albañil en Ponce', { role: 'guest', name: null, returnTo: '/', search: (text) => searchServices(text, deps) })).text
      out.candidates = (await directorio.buscarCandidatos({ oficio: 'albanileria', zona: 'Ponce', exigirCobertura: true })).items.map((p) => p.displayName)
      out.mapPoint = (await directorio.listar({ oficio: 'albanileria' })).items[0].mapLocations[0]
      // A trade created in the panel is recognised at once (web, WhatsApp tools).
      await call('POST', '/tus/v1/admin/catalogo/oficios', { nombre: 'Reparación de electrodomésticos', icono: 'electrodomesticos', sinonimos: ['lavarropas', 'heladera', 'electrodomestico'] })
      out.newTrade = i('se rompió el lavarropas').category
      out.toolEnum = definicionChat(HERRAMIENTAS.find((h) => h.name === 'search_providers')).function.parameters.properties.profession.enum.includes('reparacion-de-electrodomesticos')
      out.requestAccepts = (await import('./apps/api/src/tus/solicitudes/modelo.ts')).esCategoriaSolicitud('reparacion-de-electrodomesticos')
      // Deactivation: not offered for new selections, history keeps the label.
      await call('PUT', '/tus/v1/admin/catalogo/oficios/reparacion-de-electrodomesticos', { activo: false })
      out.inactiveTrade = [i('se rompió el lavarropas').category, (await import('./apps/api/src/tus/solicitudes/modelo.ts')).esCategoriaSolicitud('reparacion-de-electrodomesticos'), (await import('./apps/api/src/tus/directorio/oficios.ts')).oficio('reparacion-de-electrodomesticos').label]
      const ponceId = (await call('GET', '/tus/v1/admin/catalogo')).body.barrios.find((b) => b.nombre === 'Ponce').id
      await call('PUT', '/tus/v1/admin/catalogo/barrios/' + ponceId, { activo: false })
      out.inactiveZone = [i('albañil en Ponce').zone, (await import('./apps/api/src/tus/solicitudes/modelo.ts')).zonasCorrientes().some((z) => z.nombre === 'Ponce')]
      // Deactivating a category hides its trades.
      await call('PUT', '/tus/v1/admin/catalogo/categorias/construccion', { activo: false })
      out.categoryOff = [i('necesito un albañil').category, i('necesito pintar la casa').category]
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.base.slice(0, 2), ['plomeria', 'aire'])
  assert.equal(result.base[2].category, 'plomeria')
  assert.equal(result.base[2].zone, 'Centro')
  assert.equal(result.base[3], 'cerrajeria', 'phrase + word synonyms')
  assert.equal(result.base[4], 'albanileria')
  assert.equal(result.ponceBefore, null)
  assert.deepEqual([result.ponceAfter.category, result.ponceAfter.zone], ['albanileria', 'Ponce'], 'a neighbourhood created in the panel is recognised')
  assert.equal(result.zoneWord, 'Norte', 'administered zones are recognised too')
  assert.equal(result.alta, 200)
  assert.deepEqual(result.searches, [['Albañil de Ponce'], ['Albañil de Ponce'], ['Albañil de Ponce'], ['Albañil de Ponce']], 'albañil / revoque / en Ponce / en zona Norte find the same provider')
  assert.equal(result.assistant, 'Parece que necesitás albañilería. Te muestro 1 profesional disponible en Ponce en el mapa.')
  assert.deepEqual(result.candidates, ['Albañil de Ponce'])
  assert.equal(result.mapPoint.label, 'Ponce', 'the map places the provider at the new neighbourhood')
  assert.equal(result.newTrade, 'reparacion-de-electrodomesticos', 'a new trade + synonyms is interpreted without code changes')
  assert.equal(result.toolEnum, true, 'WhatsApp tools list it too')
  assert.equal(result.requestAccepts, true)
  assert.deepEqual(result.inactiveTrade, [null, false, 'Reparación de electrodomésticos'])
  assert.deepEqual(result.inactiveZone, [null, false])
  assert.deepEqual(result.categoryOff, [null, 'pintura'].map((value, index) => (index === 1 ? null : value)), 'Pintura and Albañilería belong to Construcción')
})

test('CATALOG MIGRATION: additive, seeded with the same values as the in-memory seed, CHECKs replaced by foreign keys', () => {
  const sql = read('apps/api/prisma/migrations/20261007100000_tus_catalogo/migration.sql')
  assert.doesNotMatch(sql, /\bDROP TABLE\b|\bTRUNCATE\b|\bDELETE FROM\b|DROP COLUMN/iu)
  for (const table of ['categorias_servicio', 'oficios_servicio', 'sinonimos_oficio', 'localidades', 'zonas_ubicacion', 'barrios']) assert.match(sql, new RegExp(`CREATE TABLE public."${table}"`, 'u'), table)
  assert.match(sql, /DROP CONSTRAINT IF EXISTS "ck_perfiles_publicos_prestador_oficio"[\s\S]*ADD CONSTRAINT "fk_perfiles_publicos_prestador_oficio" FOREIGN KEY \("oficio"\) REFERENCES public."oficios_servicio"\("id"\)/u)
  assert.match(sql, /DROP CONSTRAINT IF EXISTS "ck_solicitudes_servicio_categoria"[\s\S]*ADD CONSTRAINT "fk_solicitudes_servicio_categoria" FOREIGN KEY \("categoria"\) REFERENCES public."oficios_servicio"\("id"\)/u)
  const seed = read('apps/api/src/tus/catalogo/semilla.ts')
  for (const id of ['plomeria', 'electricidad', 'aire', 'pintura', 'mecanica', 'otros', 'cerrajeria', 'albanileria']) {
    assert.match(seed, new RegExp(`id: '${id}'`, 'u'))
    assert.match(sql, new RegExp(`VALUES \\('${id}'`, 'u'), `migration seeds ${id}`)
  }
  assert.match(sql, /'cerrajeria:puerta trabada'/u)
  assert.match(sql, /'barrio-molina-punta', 'corrientes-capital', NULL, 'Molina Punta'/u)
  // The Web keeps no catalog of its own.
  assert.doesNotMatch(read('apps/web/src/features/home/types.ts'), /CATEGORIES|CORRIENTES_ZONES/u)
  assert.match(read('apps/web/src/features/catalog/use-catalog.ts'), /queryKey: \['tus-catalog'\]/u)
  assert.match(read('apps/web/src/features/requests/request-form.tsx'), /neighbourhoodGroups\(catalog\.data\)/u)
})
