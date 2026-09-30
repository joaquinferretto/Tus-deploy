import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Hardening of the geographic flows: polygons without surface or with repeated clicks, the
// external reverse geocoder (bounded, coordinates only, failures never lose the point, never on map
// loads, never creating areas) and its configuration.

test('POLYGONS: zero-area (collinear) and self-crossing shapes refused; a repeated click is dropped; the ring is closed', () => {
  const r = runTypeScriptScenario(`
    const { validarPoligono } = await import('./apps/api/src/tus/catalogo/modelo.ts')
    const P = (pts) => ({ type: 'Polygon', coordinates: [pts] })
    const ok = (pts) => validarPoligono(P(pts))?.coordinates[0] ?? null
    console.log(JSON.stringify({
      colineal: ok([[-58, -27], [-58.1, -27], [-58.2, -27]]),
      casiColineal: ok([[-58, -27], [-58.1, -27], [-58.2, -27.0000000001]]),
      moño: ok([[-58, -27], [-58.1, -27.1], [-58.1, -27], [-58, -27.1], [-58, -27]]),
      espiga: ok([[-58, -27], [-58.1, -27], [-58.1, -27.1], [-58.1, -27.05], [-58.1, -27.2], [-58.2, -27.2], [-58, -27]]),
      dobleClick: ok([[-58, -27], [-58.1, -27], [-58.1, -27], [-58.1, -27.1]]),
      abierto: ok([[-58, -27], [-58.1, -27], [-58.1, -27.1]]),
      dosPuntos: ok([[-58, -27], [-58.1, -27], [-58, -27]]),
      fueraDeRango: ok([[-58, -27], [-181, -27], [-58.1, -27.1]]),
      texto: ok([['a', 'b'], [-58.1, -27], [-58.1, -27.1]]),
      demasiados: ok(Array.from({ length: 201 }, (_, i) => [-58 + Math.cos(i / 32) * 0.01, -27 + Math.sin(i / 32) * 0.01])),
      dosAnillos: validarPoligono({ type: 'Polygon', coordinates: [[[-58, -27], [-58.1, -27], [-58.1, -27.1], [-58, -27]], [[-58, -27], [-58.1, -27], [-58.1, -27.1], [-58, -27]]] }),
      otroTipo: validarPoligono({ type: 'MultiPolygon', coordinates: [] }),
    }))
  `)
  assert.equal(r.colineal, null)
  assert.equal(r.casiColineal, null)
  assert.equal(r['moño'], null)
  assert.equal(r.espiga, null)
  assert.deepEqual(r.dobleClick, [[-58, -27], [-58.1, -27], [-58.1, -27.1], [-58, -27]])
  assert.deepEqual(r.abierto, [[-58, -27], [-58.1, -27], [-58.1, -27.1], [-58, -27]])
  assert.equal(r.dosPuntos, null)
  assert.equal(r.fueraDeRango, null)
  assert.equal(r.texto, null)
  assert.equal(r.demasiados, null)
  assert.equal(r.dosAnillos, null)
  assert.equal(r.otroTipo, null)
})

test('GEOCODER: only coordinates leave TUS (6 decimals), bounded, sanitized names; failures and timeouts keep the point unassociated', () => {
  const r = runTypeScriptScenario(`
    const { GeocodificadorNominatim, crearGeocodificador } = await import('./apps/api/src/tus/geo/geocodificador.ts')
    const { asociarPunto } = await import('./apps/api/src/tus/geo/resolucion.ts')
    const { SEMILLA_CATALOGO } = await import('./apps/api/src/tus/catalogo/semilla.ts')
    const pedidos = []
    const responde = (body, ok = true) => async (url, init) => { pedidos.push({ url, headers: init.headers, signal: init.signal instanceof AbortSignal }); return { ok, json: async () => body } }
    const nombres = await new GeocodificadorNominatim('https://geo.example/', responde({ address: { road: 'Calle privada 123', neighbourhood: 'Barrio Norte', city: 'Alta Gracia', postcode: '5186', suburb: 'x'.repeat(81), town: 42 } })).nombres(-31.6612345678, -64.4298765)
    const noOk = await new GeocodificadorNominatim('https://geo.example', responde({ address: { city: 'X' } }, false)).nombres(1, 1)
    const lento = new GeocodificadorNominatim('https://geo.example', (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))), 30)
    const t0 = Date.now()
    const conLento = await asociarPunto(SEMILLA_CATALOGO, -40, -70, lento)
    const demora = Date.now() - t0
    const roto = await asociarPunto(SEMILLA_CATALOGO, -40, -70, { nombres: async () => { throw new Error('red caída') } })
    const basura = await asociarPunto(SEMILLA_CATALOGO, -40, -70, new GeocodificadorNominatim('https://geo.example', async () => ({ ok: true, json: async () => { throw new SyntaxError('no json') } })))
    console.log(JSON.stringify({
      nombres, noOk, pedido: pedidos[0], conLento: conLento.origen, demora, roto: roto.origen, basura: basura.origen,
      off: crearGeocodificador({ TUS_REVERSE_GEOCODER: 'OFF' }), http: crearGeocodificador({ TUS_REVERSE_GEOCODER_URL: 'http://inseguro.example' })?.baseUrl ?? null,
      https: crearGeocodificador({ TUS_REVERSE_GEOCODER_URL: 'https://propio.example' })?.baseUrl ?? null,
    }))
  `)
  // Most specific first; addresses, postcodes, non-strings and over-long values never used.
  assert.deepEqual(r.nombres, ['Barrio Norte', 'Alta Gracia'])
  assert.deepEqual(r.noOk, [])
  assert.equal(r.pedido.url, 'https://geo.example/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=es&lat=-31.661235&lon=-64.429877')
  assert.equal(r.pedido.headers['user-agent'], 'TUS/1.0 (https://tusservicios.shop)')
  assert.equal(r.pedido.signal, true)
  assert.equal(r.conLento, 'sin_asociar')
  assert.ok(r.demora < 2000, `timeout honoured (${r.demora} ms)`)
  assert.equal(r.roto, 'sin_asociar')
  assert.equal(r.basura, 'sin_asociar')
  assert.equal(r.off, null)
  // A non-HTTPS URL is ignored (default HTTPS service); an HTTPS one is honoured.
  assert.equal(r.http, 'https://nominatim.openstreetmap.org')
  assert.equal(r.https, 'https://propio.example')
})

test('GEOCODER: never called when a stored polygon contains the point, never on map loads, and a name match never creates or edits areas', () => {
  const r = runTypeScriptScenario(`
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { establecerCatalogo, catalogoVigente } = await import('./apps/api/src/tus/catalogo/vigente.ts')
    const { SEMILLA_CATALOGO } = await import('./apps/api/src/tus/catalogo/semilla.ts')
    const cuadrado = (lat, lng, r) => ({ type: 'Polygon', coordinates: [[[lng - r, lat - r], [lng + r, lat - r], [lng + r, lat + r], [lng - r, lat + r], [lng - r, lat - r]]] })
    const zona = { id: 'zona-ag', localidadId: SEMILLA_CATALOGO.localidades[0].id, nombre: 'Alta Gracia', slug: 'alta-gracia', activo: true, orden: 1, poligono: cuadrado(-27.4, -58.7, 0.02), lat: -27.4, lng: -58.7 }
    establecerCatalogo({ ...SEMILLA_CATALOGO, zonas: [...SEMILLA_CATALOGO.zonas, zona] })
    const antes = JSON.stringify(catalogoVigente())
    let llamadas = 0
    const geocodificador = { nombres: async () => { llamadas += 1; return ['Alta Gracia'] } }
    const merchants = new Map()
    const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null, findMany: async (ids) => ids.map((t) => merchants.get(t)).filter(Boolean) }, listings: { forTenant: async () => [], forTenants: async () => [] } } }, identity: { identidadVerificada: async () => false, resumenDeTenants: async () => new Map() } }
    const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, geocodificador })
    const ctx = (tenantId) => ({ tenantId, subjectId: 's', sessionId: 's', roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    merchants.set('t-1', { tenantId: 't-1', merchantId: 'm-1', status: 'approved' })
    await directorio.guardarPerfil(ctx('t-1'), { displayName: 'Prestador Uno', profession: 'plomeria' })
    const enPoligono = await directorio.guardarMiUbicacion('t-1', { lat: -27.401, lng: -58.701 })
    const trasPoligono = llamadas
    const fuera = await directorio.guardarMiUbicacion('t-1', { lat: -31.66, lng: -64.43 })
    const trasFuera = llamadas
    for (let i = 0; i < 3; i++) await directorio.listar({})
    await directorio.perfil((await directorio.listar({})).items[0].id)
    console.log(JSON.stringify({
      enPoligono: enPoligono.ubicacion.association, trasPoligono, fuera: [fuera.ubicacion.association, fuera.ubicacion.zone?.name, fuera.ubicacion.lat], trasFuera, trasMapa: llamadas,
      catalogoIntacto: JSON.stringify(catalogoVigente()) === antes,
    }))
  `)
  assert.equal(r.enPoligono, 'poligono_zona')
  assert.equal(r.trasPoligono, 0)
  // Outside every polygon the geocoder only MATCHES an existing zone; the pin is kept as given.
  assert.deepEqual(r.fuera, ['geocodificador', 'Alta Gracia', -31.66])
  assert.equal(r.trasFuera, 1)
  assert.equal(r.trasMapa, 1)
  assert.equal(r.catalogoIntacto, true)
})
