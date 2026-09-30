import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Editable geography (DIR-04). Stored polygons are the authority; the map places each provider at
// ONE point: exact (only if allowed) > inside neighbourhood polygon > inside zone polygon >
// reference point > nothing. The reverse geocoder only matches existing names.
const GEO = `
  const { puntoEnPoligono, puntoInterior, area } = await import('./apps/api/src/tus/geo/geometria.ts')
  const { resolverPuntoMapa, asociarPunto } = await import('./apps/api/src/tus/geo/resolucion.ts')
  const { SEMILLA_CATALOGO } = await import('./apps/api/src/tus/catalogo/semilla.ts')
  const cuadrado = (lng, lat, d) => ({ type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] })
  // Alta Gracia (zone) far from the seed neighbourhoods, with a polygon; a neighbourhood inside it.
  const altaGracia = { id: 'zona-alta-gracia', localidadId: 'corrientes-capital', nombre: 'Alta Gracia', slug: 'alta-gracia', activo: true, orden: 5, poligono: cuadrado(-58.70, -27.40, 0.02), lat: null, lng: null }
  const barrioAG = { id: 'barrio-ag-norte', localidadId: 'corrientes-capital', zonaId: 'zona-alta-gracia', nombre: 'AG Norte', slug: 'ag-norte', lat: -27.395, lng: -58.70, poligono: cuadrado(-58.70, -27.395, 0.004), activo: true, orden: 50 }
  const soloPunto = { id: 'zona-solo-punto', localidadId: 'corrientes-capital', nombre: 'Solo Punto', slug: 'solo-punto', activo: true, orden: 6, poligono: null, lat: -27.30, lng: -58.60 }
  const catalogo = { ...SEMILLA_CATALOGO, zonas: [altaGracia, soloPunto], barrios: [...SEMILLA_CATALOGO.barrios, barrioAG] }
  const geo = (extra) => ({ latitud: null, longitud: null, mostrarUbicacionExacta: false, barrioId: null, zonaId: null, zona: null, zonasCobertura: [], ...extra })
`

test('GEO geometry: point in polygon, a representative point ALWAYS inside (also for concave shapes), areas', () => {
  const r = runTypeScriptScenario(`${GEO}
    const sq = cuadrado(0, 0, 1).coordinates[0]
    // A "C"-shaped concave polygon whose centroid falls OUTSIDE.
    const c = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3], [0, 0]]
    const p = puntoInterior(c)
    console.log(JSON.stringify({ inside: puntoEnPoligono(0.5, 0.5, sq), outside: puntoEnPoligono(2, 2, sq), edge: puntoEnPoligono(1, 0, sq), concave: p, concaveInside: puntoEnPoligono(p.lat, p.lng, c), holeOfC: puntoEnPoligono(1.5, 2, c), area: area(sq) }))
  `)
  assert.equal(r.inside, true)
  assert.equal(r.outside, false)
  assert.equal(r.edge, true)
  assert.equal(r.concaveInside, true)
  assert.equal(r.holeOfC, false)
  assert.equal(r.area, 4)
})

test('GEO priority: exact pin (if shown) > neighbourhood polygon > zone polygon > reference point > not on the map', () => {
  const r = runTypeScriptScenario(`${GEO}
    const exacto = resolverPuntoMapa(catalogo, geo({ latitud: -27.46, longitud: -58.83, mostrarUbicacionExacta: true, zona: 'Centro' }))
    const exactoOculto = resolverPuntoMapa(catalogo, geo({ latitud: -27.46, longitud: -58.83, mostrarUbicacionExacta: false, zona: 'Centro' }))
    const barrioPoligono = resolverPuntoMapa(catalogo, geo({ barrioId: 'barrio-ag-norte' }))
    const zonaPoligono = resolverPuntoMapa(catalogo, geo({ zonaId: 'zona-alta-gracia' }))
    const zonaPorNombre = resolverPuntoMapa(catalogo, geo({ zona: 'Alta Gracia' }))
    const referencia = resolverPuntoMapa(catalogo, geo({ zonaId: 'zona-solo-punto' }))
    const sinPoligonoBarrio = resolverPuntoMapa({ ...catalogo, barrios: catalogo.barrios.map((b) => b.id === 'barrio-ag-norte' ? { ...b, poligono: null } : b) }, geo({ barrioId: 'barrio-ag-norte' }))
    const nada = resolverPuntoMapa(catalogo, geo({ zona: 'Lugar inexistente' }))
    const dentro = (p, pol) => puntoEnPoligono(p.lat, p.lng, pol.coordinates[0])
    console.log(JSON.stringify({ exacto, exactoOculto: exactoOculto.precision, barrioPoligono: [barrioPoligono.precision, dentro(barrioPoligono, barrioAG.poligono)], zonaPoligono: [zonaPoligono.precision, dentro(zonaPoligono, altaGracia.poligono)], zonaPorNombre: zonaPorNombre.label, referencia, sinPoligonoBarrio: [sinPoligonoBarrio.precision, sinPoligonoBarrio.label], nada }))
  `)
  assert.deepEqual([r.exacto.lat, r.exacto.lng, r.exacto.precision], [-27.46, -58.83, 'exact'])
  // Not allowed to show the exact pin -> its neighbourhood (Centro) instead.
  assert.equal(r.exactoOculto, 'barrio')
  assert.deepEqual(r.barrioPoligono, ['barrio', true])
  assert.deepEqual(r.zonaPoligono, ['zona', true])
  assert.equal(r.zonaPorNombre, 'Alta Gracia')
  assert.deepEqual([r.referencia.lat, r.referencia.lng, r.referencia.precision], [-27.3, -58.6, 'reference'])
  // A neighbourhood without polygon falls back to its ZONE polygon before its own point.
  assert.deepEqual(r.sinPoligonoBarrio, ['zona', 'Alta Gracia'])
  assert.equal(r.nada, null)
})

test('GEO reverse: neighbourhood polygon, else zone polygon, else geocoder name match (never creating areas), else unassociated', () => {
  const r = runTypeScriptScenario(`${GEO}
    const calls = []
    const geocoder = (names) => ({ nombres: async (lat, lng) => { calls.push([lat, lng]); return names } })
    const enBarrio = await asociarPunto(catalogo, -27.395, -58.70, geocoder(['X']))
    const enZona = await asociarPunto(catalogo, -27.41, -58.71, geocoder(['X']))
    const porNombre = await asociarPunto(catalogo, -27.10, -58.10, geocoder(['Barrio Inexistente', 'Solo Punto']))
    const barrioNombre = await asociarPunto(catalogo, -27.10, -58.10, geocoder(['camba cua']))
    const nada = await asociarPunto(catalogo, -27.10, -58.10, geocoder(['Buenos Aires']))
    const caido = await asociarPunto(catalogo, -27.10, -58.10, { nombres: async () => { throw new Error('timeout') } })
    const sinGeocoder = await asociarPunto(catalogo, -27.10, -58.10, null)
    console.log(JSON.stringify({ enBarrio: [enBarrio.origen, enBarrio.barrio?.id, enBarrio.zona?.id], enZona: [enZona.origen, enZona.zona?.id], porNombre: [porNombre.origen, porNombre.zona?.id], barrioNombre: [barrioNombre.origen, barrioNombre.barrio?.nombre], nada: nada.origen, caido: caido.origen, sinGeocoder: sinGeocoder.origen, geocoderCalls: calls.length, zonas: catalogo.zonas.length }))
  `)
  assert.deepEqual(r.enBarrio, ['poligono_barrio', 'barrio-ag-norte', 'zona-alta-gracia'])
  assert.deepEqual(r.enZona, ['poligono_zona', 'zona-alta-gracia'])
  assert.deepEqual(r.porNombre, ['geocodificador', 'zona-solo-punto'])
  assert.deepEqual(r.barrioNombre, ['geocodificador', 'Camba Cuá'])
  assert.equal(r.nada, 'sin_asociar')
  assert.equal(r.caido, 'sin_asociar')
  assert.equal(r.sinGeocoder, 'sin_asociar')
  // The geocoder is consulted ONLY when no polygon contains the point (3 recorded + 1 failing).
  assert.equal(r.geocoderCalls, 3)
  assert.equal(r.zonas, 2)
})

test('GEO admin catalog: zone and neighbourhood polygons are saved, updated, removed and validated; reference point in range', () => {
  const r = runTypeScriptScenario(`${GEO}
    const { ServicioCatalogo } = await import('./apps/api/src/tus/catalogo/servicio.ts')
    const { AlmacenCatalogoEnMemoria } = await import('./apps/api/src/tus/catalogo/almacen.ts')
    const audit = []
    const svc = new ServicioCatalogo({ almacen: new AlmacenCatalogoEnMemoria(structuredClone(SEMILLA_CATALOGO)), auditar: async (e) => audit.push(e.accion) })
    const zona = await svc.guardarZona('admin', null, { nombre: 'Alta Gracia', localidadId: 'corrientes-capital' })
    const conPunto = await svc.guardarZona('admin', zona.valor.id, { lat: -27.4, lng: -58.7 })
    const fueraDeRango = await svc.guardarZona('admin', zona.valor.id, { lat: 95, lng: -58.7 })
    const conPoligono = await svc.guardarZona('admin', zona.valor.id, { poligono: cuadrado(-58.7, -27.4, 0.02) })
    const invalido = await svc.guardarZona('admin', zona.valor.id, { poligono: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]] } })
    const basura = await svc.guardarZona('admin', zona.valor.id, { poligono: { type: 'Point', coordinates: [1, 2] } })
    const pocos = await svc.guardarZona('admin', zona.valor.id, { poligono: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] } })
    const actualizado = await svc.guardarZona('admin', zona.valor.id, { poligono: cuadrado(-58.7, -27.4, 0.03) })
    const eliminado = await svc.guardarZona('admin', zona.valor.id, { poligono: null })
    const barrio = (await svc.leer()).barrios[0]
    const barrioSinPoligono = await svc.guardarBarrio('admin', barrio.id, { poligono: null })
    const barrioSinPunto = await svc.guardarBarrio('admin', barrio.id, { lat: null, lng: null })
    const cerrado = (await svc.guardarBarrio('admin', barrio.id, { poligono: { type: 'Polygon', coordinates: [[[-58.8, -27.4], [-58.7, -27.4], [-58.7, -27.5]]] } })).valor.poligono.coordinates[0]
    console.log(JSON.stringify({ conPunto: [conPunto.ok, conPunto.valor?.lat], fueraDeRango: fueraDeRango.campos, conPoligono: conPoligono.ok, invalido: invalido.campos, basura: basura.campos, pocos: pocos.campos, actualizado: actualizado.valor.poligono.coordinates[0][0].map((v) => Math.round(v * 1e6) / 1e6), eliminado: [eliminado.valor.poligono, eliminado.valor.lat], barrioSinPoligono: [barrioSinPoligono.ok, barrioSinPoligono.valor?.poligono, barrioSinPoligono.valor?.lat !== null], barrioSinPunto: barrioSinPunto.campos, cerrado: [cerrado.length, JSON.stringify(cerrado[0]) === JSON.stringify(cerrado.at(-1))], audit }))
  `)
  assert.deepEqual(r.conPunto, [true, -27.4])
  assert.deepEqual(r.fueraDeRango, ['ubicacion'])
  assert.equal(r.conPoligono, true)
  assert.deepEqual(r.invalido, ['poligono'], 'self-intersecting polygon rejected')
  assert.deepEqual(r.basura, ['poligono'])
  assert.deepEqual(r.pocos, ['poligono'])
  assert.deepEqual(r.actualizado, [-58.73, -27.43])
  // Removing the polygon keeps the reference point as fallback.
  assert.deepEqual(r.eliminado, [null, -27.4])
  assert.deepEqual(r.barrioSinPoligono, [true, null, true])
  assert.deepEqual(r.barrioSinPunto, ['ubicacion'], 'a neighbourhood keeps its reference point')
  assert.deepEqual(r.cerrado, [4, true], 'the ring is closed server-side')
  for (const accion of ['creada', 'punto_modificado', 'poligono_creado', 'poligono_modificado', 'poligono_eliminado', 'poligono_eliminado'])
    assert.ok(r.audit.includes(accion), accion)
})

test('GEO provider location: own profile only, validated coordinates, association by polygon, privacy of the exact pin, admin by id', () => {
  const r = runTypeScriptScenario(`${GEO}
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { crearRouterDirectorio } = await import('./apps/api/src/tus/directorio/http.ts')
    const { establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
    const { InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    establecerCatalogo(catalogo)
    const merchants = new Map()
    const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null, findMany: async (ids) => ids.map((t) => merchants.get(t)).filter(Boolean) }, listings: { forTenant: async () => [] } } }, identity: { identidadVerificada: async () => false, resumenDeTenants: async () => new Map() } }
    let seq = 0
    const geocoderCalls = []
    const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, now: () => Date.parse('2026-09-28T13:00:00.000Z'), newId: () => 'perfil-' + String(++seq).padStart(8, '0'), geocodificador: { nombres: async (lat, lng) => { geocoderCalls.push([lat, lng]); return ['Solo Punto'] } } })
    const ctx = (tenantId) => ({ tenantId, subjectId: 'a-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    for (const t of ['t-a', 't-b']) { merchants.set(t, { tenantId: t, merchantId: 'm-' + t, status: 'approved' }); await directorio.guardarPerfil(ctx(t), { displayName: 'Prestador ' + t, profession: 'plomeria', description: 'Trabajo prolijo' }) }
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('a', { sessionId: 'sa', subjectId: 'ua', tenantId: 't-a', roles: ['merchant'], permissions: ['tus:marketplace:write'] })
    sessions.add('cliente', { sessionId: 'sc', subjectId: 'uc', tenantId: 't-c', roles: ['customer'], permissions: ['tus:checkout'] })
    sessions.add('admin', { sessionId: 'sx', subjectId: 'ux', tenantId: 'platform', roles: ['admin'], permissions: ['tus:providers:admin'] })
    const app = express(); app.use(express.json()); app.use(crearRouterDirectorio({ servicio: directorio, sessions }))
    const server = app.listen(0)
    const call = async (method, path, token, body) => { const res = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'c', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, body: await res.json().catch(() => null) } }
    const out = {}
    try {
      out.fueraRango = (await call('PUT', '/tus/v1/prestador/ubicacion', 'a', { lat: 91, lng: 0 })).status
      out.texto = (await call('PUT', '/tus/v1/prestador/ubicacion', 'a', { lat: '-27.4', lng: '-58.7' })).status
      out.ajeno = (await call('PUT', '/tus/v1/prestador/ubicacion', 'a', { lat: -27.395, lng: -58.70, prestadorId: 'p-b' })).status
      out.cliente = (await call('PUT', '/tus/v1/prestador/ubicacion', 'cliente', { lat: -27.395, lng: -58.70 })).status
      out.anonimo = (await call('PUT', '/tus/v1/prestador/ubicacion', null, { lat: -27.395, lng: -58.70 })).status
      const oculto = await call('PUT', '/tus/v1/prestador/ubicacion', 'a', { lat: -27.393, lng: -58.699, showExact: false })
      out.oculto = [oculto.status, oculto.body.location.association, oculto.body.location.barrio?.name, oculto.body.location.zone?.name, oculto.body.location.mapPoint.precision]
      const publicoOculto = (await directorio.listar({})).items.find((item) => item.displayName === 'Prestador t-a')
      out.publicoOculto = [publicoOculto.mapPoint.precision, publicoOculto.mapPoint.lat === -27.393 && publicoOculto.mapPoint.lng === -58.699]
      const visible = await call('PUT', '/tus/v1/prestador/ubicacion', 'a', { lat: -27.393, lng: -58.699, showExact: true })
      out.visible = visible.body.location.mapPoint
      const pb = (await directorio.listar({})).items.find((item) => item.displayName === 'Prestador t-b')
      out.otroIntacto = pb.mapPoint
      const perfilB = (await directorio.listar({})).items.find((item) => item.displayName === 'Prestador t-b').id
      out.adminCliente = (await call('PUT', '/tus/v1/admin/prestadores/' + perfilB + '/ubicacion', 'a', { lat: -27.30, lng: -58.60 })).status
      const adminOk = await call('PUT', '/tus/v1/admin/prestadores/' + perfilB + '/ubicacion', 'admin', { lat: -27.10, lng: -58.10 })
      out.adminOk = [adminOk.status, adminOk.body.location.association, adminOk.body.location.zone?.name]
      const quitar = await call('DELETE', '/tus/v1/prestador/ubicacion', 'a')
      out.quitar = [quitar.body.location.lat, quitar.body.location.barrio?.name, quitar.body.location.mapPoint.precision]
      out.geocoderCalls = geocoderCalls.length
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.fueraRango, 422)
  assert.equal(r.texto, 422, 'coordinates must be numbers')
  assert.equal(r.ajeno, 403, 'a provider id in the body is refused')
  assert.equal(r.cliente, 403)
  assert.equal(r.anonimo, 401)
  assert.deepEqual(r.oculto, [200, 'poligono_barrio', 'AG Norte', 'Alta Gracia', 'barrio'])
  // Hidden exact pin: the public point is inside the neighbourhood, never the private coordinate.
  assert.deepEqual(r.publicoOculto, ['barrio', false])
  assert.deepEqual([r.visible.lat, r.visible.lng, r.visible.precision], [-27.393, -58.699, 'exact'])
  assert.equal(r.otroIntacto, null, 'provider B is not affected (and has no geography: not on the map)')
  assert.equal(r.adminCliente, 403)
  assert.deepEqual(r.adminOk, [200, 'geocodificador', 'Solo Punto'])
  // Removing the pin keeps the associated neighbourhood.
  assert.deepEqual(r.quitar, [null, 'AG Norte', 'barrio'])
  assert.equal(r.geocoderCalls, 1, 'only the point outside every polygon consulted the geocoder')
})

test('GEO migration: optional zone polygon + reference point, optional neighbourhood polygon, provider pin with privacy and association', () => {
  const sql = readFileSync(join(root, 'apps/api/prisma/migrations/20261016100000_tus_geografia_mapa/migration.sql'), 'utf8')
  assert.match(sql, /ALTER TABLE public\."zonas_ubicacion" ADD COLUMN "poligono" jsonb;/u)
  assert.match(sql, /ALTER TABLE public\."barrios" ALTER COLUMN "poligono" DROP NOT NULL;/u)
  assert.match(sql, /"mostrar_ubicacion_exacta" boolean NOT NULL DEFAULT false/u)
  assert.match(sql, /"latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180/u)
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|^\s*UPDATE /imu)
})
