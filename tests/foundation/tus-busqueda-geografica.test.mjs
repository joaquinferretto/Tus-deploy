import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// GEO-BUSQUEDA-01. Where a client looks for providers: near (8 km), in its town, in its province.
// The real directory service over the catalog of TUS (its neighbourhoods and their points); the
// API decides who matches, with the rules of coverage of each provider.
test('BÚSQUEDA geográfica: near me is 8 km AND the coverage of the provider (one who goes to homes is not shown just for being near); one who attends at its place is shown by distance; town and province by the area of work; the point of the client is never returned and an incomplete request is not a filter', () => {
  const r = runTypeScriptScenario(`
    const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
    const { catalogoVigente, barriosVigentes } = await import('./apps/api/src/tus/catalogo/vigente.ts')
    const geo = await import('./apps/api/src/tus/directorio/busqueda-geografica.ts')
    const merchants = new Map()
    const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null }, listings: { forTenant: async () => [] } } }, identity: { identidadVerificada: async () => false } }
    let seq = 0
    const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, newId: () => 'id-' + String(++seq).padStart(4, '0') })
    const ctx = (tenantId) => ({ tenantId, subjectId: 'actor-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    const alta = async (t, perfil) => { merchants.set(t, { merchantId: 'm-' + t, status: 'approved' }); const x = await directorio.guardarPerfil(ctx(t), { profession: 'plomeria', ...perfil }); if (!x.ok) throw new Error(t + ' ' + JSON.stringify(x)); return x.perfil.id }
    // Two neighbourhoods of the catalog: the centre and another one between 1 and 8 km away.
    const barrios = barriosVigentes()
    const centro = barrios.find((b) => b.nombre === 'Centro') ?? barrios[0]
    const p = (b) => ({ lat: b.lat, lng: b.lng })
    const otro = barrios.map((b) => ({ b, km: geo.distanciaKm(p(centro), p(b)) })).filter((x) => x.km > 1.5 && x.km < 6).sort((a, b) => b.km - a.km)[0].b
    const kmOtro = geo.distanciaKm(p(centro), p(otro))
    const lejos = { lat: centro.lat + 0.2, lng: centro.lng }
    const ids = {
      local: await alta('local', { displayName: 'Taller Fijo', zone: centro.nombre, serviceMode: 'local' }),
      domicilioCentro: await alta('dom-centro', { displayName: 'Va Solo Al Centro', zone: centro.nombre, serviceZones: [centro.nombre], serviceMode: 'domicilio' }),
      domicilioRadio: await alta('dom-radio', { displayName: 'Va Con Radio', zone: centro.nombre, serviceZones: [centro.nombre], serviceMode: 'domicilio', coverageRadiusKm: 7 }),
      domicilioRadioCorto: await alta('dom-corto', { displayName: 'Va Un Kilometro', zone: centro.nombre, serviceZones: [centro.nombre], serviceMode: 'domicilio', coverageRadiusKm: 1 }),
      domicilioDos: await alta('dom-dos', { displayName: 'Va A Los Dos', zone: otro.nombre, serviceZones: [otro.nombre, centro.nombre], serviceMode: 'domicilio' }),
      mixto: await alta('mixto', { displayName: 'Local Y Domicilio', zone: otro.nombre, serviceZones: [otro.nombre], serviceMode: 'mixto' }),
    }
    const nombre = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]))
    const buscar = async (filtros) => { const res = await directorio.listar(filtros); return { quienes: res.items.map((i) => nombre[i.id]).sort(), items: res.items, texto: JSON.stringify(res) } }
    const out = { kmOtro: kmOtro > 1.5 && kmOtro < 6 }
    const enCentro = await buscar({ ambito: 'cerca', lat: centro.lat, lng: centro.lng })
    // (a point of its own, a little off the reference of the neighbourhood)
    const mio = { lat: otro.lat + 0.00137, lng: otro.lng + 0.00091 }
    const enOtro = await buscar({ ambito: 'cerca', lat: String(mio.lat), lng: String(mio.lng) })
    out.enCentro = enCentro.quienes
    out.enOtro = enOtro.quienes
    out.zonaOtro = (await buscar({ zona: otro.nombre })).quienes
    out.candidatosOtro = (await directorio.buscarCandidatos({ oficio: 'plomeria', zona: otro.nombre, exigirCobertura: true })).items.map((i) => nombre[i.id]).sort()
    out.lejos = (await buscar({ ambito: 'cerca', lat: lejos.lat, lng: lejos.lng })).quienes
    // The distance: whole kilometres, never less than one, the nearest first.
    out.distancias = [enOtro.items.every((i) => Number.isInteger(i.distanceKm) && i.distanceKm >= 1), enOtro.items.map((i) => i.distanceKm).every((km, i, lista) => i === 0 || lista[i - 1] <= km), Math.abs(enOtro.items.find((i) => nombre[i.id] === 'local').distanceKm - Math.max(1, Math.round(kmOtro))) <= 1]
    // Nothing of the client comes back.
    const numeros = new Set((enOtro.texto.match(/-?[0-9]+[.][0-9]+/gu) ?? []).map(Number))
    out.hayNumeros = numeros.size > 0
    out.privacidad = [enOtro.texto.includes(String(mio.lat)), numeros.has(Number(mio.lat.toFixed(3))), numeros.has(Number(mio.lng.toFixed(3)))]
    // An incomplete request is not a filter: the search still answers.
    const todos = (await buscar({})).quienes
    out.incompleto = [(await buscar({ ambito: 'cerca' })).quienes.length === todos.length, (await buscar({ ambito: 'cerca', lat: 'x', lng: 200 })).quienes.length === todos.length, (await buscar({ ambito: 'localidad', localidadId: 'no-existe' })).quienes.length === todos.length, (await buscar({ ambito: 'cerca' })).items.every((i) => i.distanceKm === undefined)]
    // Town and province.
    const catalogo = catalogoVigente()
    const { validarPerfil } = await import('./apps/api/src/tus/directorio/modelo.ts')
    const { resolverUbicacionPublicaPrestador } = await import('./apps/api/src/tus/directorio/ubicacion.ts')
    const basePerfil = { displayName: 'Profesional de prueba', profession: 'plomeria', zone: centro.nombre, serviceZones: [centro.nombre] }
    out.modalidades = {
      localConRadio: validarPerfil({ ...basePerfil, serviceMode: 'local', coverageRadiusKm: 12 }),
      localSinRadio: validarPerfil({ ...basePerfil, serviceMode: 'local', coverageRadiusKm: null }),
      domicilioConRadio: validarPerfil({ ...basePerfil, serviceMode: 'domicilio', coverageRadiusKm: 12 }),
      mixtoConRadio: validarPerfil({ ...basePerfil, serviceMode: 'mixto', coverageRadiusKm: 12 }),
      radioHistoricoLocal: resolverUbicacionPublicaPrestador({ zone: centro.nombre, serviceZones: [centro.nombre], mode: 'local', radiusKm: 12 }).coverage.radiusKm,
      zonaVerificada: resolverUbicacionPublicaPrestador({ zone: null, serviceZones: [], mode: 'domicilio', radiusKm: null, identityFallback: { barrio: centro.nombre, localidad: null, provincia: null } }).publicArea,
    }
    const localidad = catalogo.localidades.find((l) => l.id === centro.localidadId)
    out.localidad = [(await buscar({ ambito: 'localidad', localidadId: localidad.id })).quienes.length === todos.length, (await buscar({ ambito: 'provincia', localidadId: localidad.id })).quienes.length === todos.length]
    const otraLocalidad = catalogo.localidades.find((l) => l.id !== localidad.id && !catalogo.barrios.some((b) => b.localidadId === l.id))
    out.otraLocalidad = otraLocalidad ? [(await buscar({ ambito: 'localidad', localidadId: otraLocalidad.id })).quienes.length, geo.localidadesDeProvincia(catalogo, otraLocalidad.id).has(otraLocalidad.id)] : 'sin otra localidad en el catalogo'
    // The pure rules.
    out.puros = [geo.RADIO_CERCA_KM, geo.leerPunto('-27.4712345', -58.8398765), geo.leerPunto(91, 0), geo.leerPunto('', 0), geo.distanciaPublica(0.2), geo.distanciaPublica(7.6), geo.barrioDePunto(catalogo, p(centro)).nombre === centro.nombre, geo.barrioDePunto(catalogo, lejos)]
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.kmOtro, true)
  assert.deepEqual(r.enCentro, ['domicilioCentro', 'domicilioDos', 'domicilioRadio', 'domicilioRadioCorto', 'local', 'mixto'], 'a client in the centre: the place nearby, those who go to the centre (also the one based elsewhere that covers it) and the mixed one')
  assert.deepEqual(r.enOtro, ['domicilioDos', 'domicilioRadio', 'local', 'mixto'], 'a client a few km away: the place and the mixed one by distance, who covers that neighbourhood, who travels 7 km; NOT who only goes to the centre nor who travels 1 km, although both are near')
  assert.deepEqual(r.zonaOtro, ['domicilioDos', 'domicilioRadio', 'mixto'], 'the barrio filter uses actual modality, declared zones and radius, not a place-only provider based elsewhere')
  assert.deepEqual(r.candidatosOtro, r.zonaOtro, 'the assistant uses exactly the same coverage check when required')
  assert.deepEqual(r.lejos, [], 'more than 8 km away: nobody')
  assert.deepEqual(r.distancias, [true, true, true])
  assert.equal(r.hayNumeros, true, 'the answer does carry coordinates (the public points of the providers)')
  assert.deepEqual(r.privacidad, [false, false, false], 'the point of the client is not in the answer')
  assert.deepEqual(r.incompleto, [true, true, true, true])
  assert.deepEqual(r.localidad, [true, true])
  assert.deepEqual([r.modalidades.localConRadio.ok, r.modalidades.localConRadio.campos, r.modalidades.localSinRadio.ok, r.modalidades.localSinRadio.valor.radioCoberturaKm, r.modalidades.domicilioConRadio.valor.radioCoberturaKm, r.modalidades.mixtoConRadio.valor.radioCoberturaKm, r.modalidades.radioHistoricoLocal, r.modalidades.zonaVerificada], [false, ['coverageRadiusKm'], true, null, 12, 12, null, 'Centro'], 'solo los servicios a domicilio publican radio; la zona verificada se usa sin inventarla')
  if (Array.isArray(r.otraLocalidad)) assert.deepEqual(r.otraLocalidad, [0, true], 'a town where nobody works: nobody')
  assert.deepEqual(r.puros, [8, { lat: -27.471, lng: -58.84 }, null, null, 1, 8, true, null])
})

test('BÚSQUEDA geográfica, ruta y pantalla: the public route passes where to look and never caches it; the Web rounds the position, keeps it in memory only, falls back to the town when the permission is refused and says the three choices in plain words', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const http = read('apps/api/src/tus/directorio/http.ts')
  const ruta = /'\/tus\/v1\/public\/prestadores',[\s\S]*?response\.status\(200\)\.json\(resultado\)/u.exec(http)[0]
  for (const campo of ["ambito: request.query['ambito']", "lat: request.query['lat']", "lng: request.query['lng']", "localidadId: request.query['localidadId']"]) assert.ok(ruta.includes(campo), campo)
  assert.match(ruta, /cache-control', 'private, no-store'/u)
  const modulo = read('apps/api/src/tus/directorio/busqueda-geografica.ts')
  assert.doesNotMatch(modulo, /console\.|logger|prisma|fetch\(|geocodificador/u, 'the point is not logged, not stored and not sent anywhere')
  const cliente = read('apps/web/src/features/directory/directory-client.ts')
  assert.match(cliente, /params\.set\('lat', filters\.lat\.toFixed\(3\)\)/u)
  const pantalla = read('apps/web/src/features/directory/worker-directory.tsx')
  for (const texto of ['¿Dónde querés buscar?', 'Cerca de mí', 'Prestadores dentro de 8 km de tu ubicación actual.', 'En mi localidad', 'En toda mi provincia', 'No pudimos usar tu ubicación. Buscamos en tu localidad']) assert.ok(pantalla.includes(texto), texto)
  assert.match(pantalla, /navigator\.geolocation\.getCurrentPosition\(/u)
  assert.match(read('apps/web/next.config.js'), /geolocation=\(self\)/u, 'the same-origin search page must be permitted to request location explicitly')
  const perfil = read('apps/web/src/features/provider/provider-public-profile.tsx')
  assert.doesNotMatch(perfil, /Usar fallback si existe|Radio de cobertura en km/u)
  assert.match(perfil, /values\.serviceMode !== 'local' \? \(/u)
  assert.doesNotMatch(pantalla, /localStorage|sessionStorage|document\.cookie/u, 'the position is not saved')
  assert.doesNotMatch(pantalla, /useEffect\([^)]*geolocation/u, 'asked only when the person chooses "Cerca de mí"')
})
