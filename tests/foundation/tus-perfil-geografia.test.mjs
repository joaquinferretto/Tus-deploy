import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// PERFIL-GEO-01: personal profile (names, document, residence), normalized geography
// (País -> Provincia -> Localidad), onboarding with returnTo, capability-based navigation and the
// map centre of the person's locality. In-memory store with the semantics of the PostgreSQL one;
// the database invariants are in tus-perfil-turnos-postgres.test.mjs.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

const SETUP = `
  const contracts = await import('./packages/contracts/src/tus-perfil.ts')
  const { AlmacenPerfilEnMemoria } = await import('./apps/api/src/tus/perfil/almacen.ts')
  const { ServicioPerfil } = await import('./apps/api/src/tus/perfil/servicio.ts')
  const { crearRouterPerfil } = await import('./apps/api/src/tus/perfil/http.ts')
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const almacen = new AlmacenPerfilEnMemoria({
    paises: [{ id: 'ar', nombre: 'Argentina', codigoIso: 'AR' }],
    provincias: [{ id: 'ar-w', paisId: 'ar', nombre: 'Corrientes' }, { id: 'ar-h', paisId: 'ar', nombre: 'Chaco' }],
    localidades: [
      { id: 'corrientes-capital', provinciaId: 'ar-w', nombre: 'Corrientes Capital', latitud: -27.4692, longitud: -58.8306 },
      { id: 'ar-w-goya', provinciaId: 'ar-w', nombre: 'Goya', latitud: -29.14, longitud: -59.2626 },
      { id: 'ar-h-resistencia', provinciaId: 'ar-h', nombre: 'Resistencia', latitud: -27.4514, longitud: -58.9867 },
      { id: 'inactiva', provinciaId: 'ar-w', nombre: 'Inactiva', latitud: null, longitud: null, activo: false },
    ],
  })
  const persona = (accountId, email, displayName) => almacen.perfiles.set(accountId, { accountId, email, emailVerified: true, displayName, firstName: null, lastName: null, documentType: null, documentNumber: null, localidadId: null, addressStreet: null, addressNumber: null, addressUnit: null, postalCode: null, profileComplete: false, profileUpdatedAt: null, phoneNumber: '+5493794123456', phonePending: null })
  persona('cuenta-laura', 'laura@example.com', 'Laura Martínez')
  persona('cuenta-otro', 'otro@example.com', 'Otro Usuario')
  const servicio = new ServicioPerfil(almacen, () => Date.parse('2026-10-01T12:00:00.000Z'))
  const VALIDO = { nombre: ' Laura ', apellido: 'Martínez', tipoDocumento: 'DNI', numeroDocumento: '30.123.456', localidadId: 'ar-w-goya', calle: 'San Martín', numero: '1234', pisoDepto: '2° B', codigoPostal: '3450' }
`

test('PERFIL contract: one document normalizer and one profile validation for the API and the Web', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const n = (tipo, numero) => { const r = contracts.normalizarDocumento(tipo, numero); return r.ok ? r.numero : r.motivo }
    console.log(JSON.stringify({
      dni: [n('DNI', '30.123.456'), n('DNI', ' 30 123 456 '), n('DNI', '7.654.321'), n('DNI', '123456'), n('DNI', '012345678'), n('DNI', '30a23456'), n('DNI', ''), n('CUIT', '30123456')],
      libreta: [n('LC', '123.456'), n('LE', '1234567')],
      pasaporte: [n('PASAPORTE', 'aaa 123456'), n('PASAPORTE', 'ab-1'), n('PASAPORTE', 'AAA123456789012')],
      formato: [contracts.formatearDocumento('DNI', '30123456'), contracts.formatearDocumento('PASAPORTE', 'AAA123456'), contracts.enmascararDocumento('30123456')],
      valido: contracts.validarPerfilPersonal(VALIDO),
      invalido: contracts.validarPerfilPersonal({ nombre: 'L', apellido: '', tipoDocumento: 'DNI', numeroDocumento: 'abc', localidadId: '', calle: '', numero: 'doce', pisoDepto: 'x'.repeat(31), codigoPostal: '12' }),
      sinNumero: contracts.validarPerfilPersonal({ ...VALIDO, numero: 's/n', codigoPostal: 'w3450abc' }).valor,
      centro: contracts.CENTRO_MAPA_PREDETERMINADO,
    }))
  `)
  assert.deepEqual(result.dni, ['30123456', '30123456', '7654321', 'formato', 'formato', 'formato', 'vacio', 'tipo'])
  assert.deepEqual(result.libreta, ['123456', '1234567'])
  assert.deepEqual(result.pasaporte, ['AAA123456', 'formato', 'formato'])
  assert.deepEqual(result.formato, ['30.123.456', 'AAA123456', '*****456'])
  assert.deepEqual(result.valido, { ok: true, valor: { nombre: 'Laura', apellido: 'Martínez', tipoDocumento: 'DNI', numeroDocumento: '30123456', localidadId: 'ar-w-goya', calle: 'San Martín', numero: '1234', pisoDepto: '2° B', codigoPostal: '3450' } })
  assert.equal(result.invalido.ok, false)
  assert.deepEqual(Object.keys(result.invalido.errores).sort(), ['apellido', 'calle', 'codigoPostal', 'localidadId', 'nombre', 'numero', 'numeroDocumento', 'pisoDepto'])
  assert.deepEqual([result.sinNumero.numero, result.sinNumero.codigoPostal], ['S/N', 'W3450ABC'])
  assert.deepEqual(result.centro, { latitud: -27.4692, longitud: -58.8306, origen: 'predeterminado', etiqueta: 'Corrientes Capital' }, 'visitors start in Corrientes Capital, not Buenos Aires')
})

test('PERFIL service: existing people start incomplete with nothing invented; saving completes the profile; locality from the catalog; one person per document; map centre from the locality', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const out = {}
    const antes = await servicio.obtener('cuenta-laura')
    out.antes = { completo: antes.perfilCompleto, faltantes: antes.faltantes, nombre: antes.nombre, documento: antes.numeroDocumento, residencia: antes.residencia, centro: antes.centroMapa.origen, telefono: antes.telefono }
    out.estadoAntes = await servicio.estado('cuenta-laura')
    out.invalido = await servicio.actualizar('cuenta-laura', { ...VALIDO, numeroDocumento: '12' })
    out.localidadInexistente = await servicio.actualizar('cuenta-laura', { ...VALIDO, localidadId: 'no-existe' })
    out.localidadInactiva = await servicio.actualizar('cuenta-laura', { ...VALIDO, localidadId: 'inactiva' })
    const guardado = await servicio.actualizar('cuenta-laura', VALIDO)
    out.guardado = guardado.ok && { completo: guardado.perfil.perfilCompleto, faltantes: guardado.perfil.faltantes, visible: guardado.perfil.nombreVisible, documento: [guardado.perfil.tipoDocumento, guardado.perfil.numeroDocumento], residencia: guardado.perfil.residencia, ubicacion: guardado.perfil.ubicacion, centro: guardado.perfil.centroMapa }
    out.duplicado = await servicio.actualizar('cuenta-otro', { ...VALIDO, nombre: 'Otro', apellido: 'Usuario' })
    out.otroSigueIncompleto = (await servicio.obtener('cuenta-otro')).perfilCompleto
    out.inexistente = await servicio.actualizar('cuenta-fantasma', VALIDO)
    // The person moves: the map centre follows the new locality.
    const mudanza = await servicio.actualizar('cuenta-laura', { ...VALIDO, localidadId: 'ar-h-resistencia', codigoPostal: '3500' })
    out.mudanza = mudanza.ok && [mudanza.perfil.centroMapa, mudanza.perfil.residencia.provinciaNombre]
    out.centroAnonimo = await servicio.centroMapa(null)
    out.admin = await servicio.perfilAdmin('cuenta-laura')
    out.geografia = [(await servicio.paises()).map((p) => p.id), (await servicio.provincias('ar')).map((p) => p.nombre), (await servicio.localidades('ar-w', '')).map((l) => l.nombre), (await servicio.localidades('ar-w', 'goy')).map((l) => l.id), (await servicio.localidades('otra', '')).length]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.antes, { completo: false, faltantes: ['nombre', 'apellido', 'tipoDocumento', 'numeroDocumento', 'localidadId', 'calle', 'numero', 'codigoPostal'], nombre: null, documento: null, residencia: null, centro: 'predeterminado', telefono: { verificado: true, numero: result.antes.telefono.numero, pendiente: null } })
  assert.doesNotMatch(result.antes.telefono.numero, /3794123456/u, 'the phone is masked')
  assert.equal(result.estadoAntes.profileComplete, false)
  assert.deepEqual([result.invalido.ok, result.invalido.code, Object.keys(result.invalido.errores)], [false, 'INVALID_PROFILE', ['numeroDocumento']])
  assert.deepEqual([result.localidadInexistente.code, Object.keys(result.localidadInexistente.errores)], ['INVALID_PROFILE', ['localidadId']])
  assert.equal(result.localidadInactiva.code, 'INVALID_PROFILE', 'an inactive locality cannot be chosen')
  assert.equal(result.guardado.completo, true)
  assert.deepEqual(result.guardado.faltantes, [])
  assert.equal(result.guardado.visible, 'Laura Martínez')
  assert.deepEqual(result.guardado.documento, ['DNI', '30123456'], 'stored normalized')
  assert.deepEqual(result.guardado.residencia, { paisId: 'ar', paisNombre: 'Argentina', provinciaId: 'ar-w', provinciaNombre: 'Corrientes', localidadId: 'ar-w-goya', localidadNombre: 'Goya', calle: 'San Martín', numero: '1234', pisoDepto: '2° B', codigoPostal: '3450' })
  assert.deepEqual(result.guardado.ubicacion, { paisId: 'ar', provinciaId: 'ar-w', localidadId: 'ar-w-goya' })
  assert.deepEqual(result.guardado.centro, { latitud: -29.14, longitud: -59.2626, origen: 'localidad', etiqueta: 'Goya' })
  assert.deepEqual(result.duplicado, { ok: false, code: 'DOCUMENT_ALREADY_REGISTERED' })
  assert.equal(result.otroSigueIncompleto, false)
  assert.deepEqual(result.inexistente, { ok: false, code: 'NOT_FOUND' })
  assert.deepEqual(result.mudanza, [{ latitud: -27.4514, longitud: -58.9867, origen: 'localidad', etiqueta: 'Resistencia' }, 'Chaco'])
  assert.deepEqual(result.centroAnonimo, { latitud: -27.4692, longitud: -58.8306, origen: 'predeterminado', etiqueta: 'Corrientes Capital' })
  assert.deepEqual(result.admin.documento, { tipo: 'DNI', numero: '30123456' })
  assert.equal(result.admin.perfilActualizadoEn, '2026-10-01T12:00:00.000Z')
  assert.deepEqual(result.geografia, [['ar'], ['Chaco', 'Corrientes'], ['Corrientes Capital', 'Goya'], ['ar-w-goya'], 0], 'inactive localities are not offered; the catalog comes from the store')
})

test('PERFIL HTTP: the account is the session, never the body; strict fields; private data only for its owner; geography is public reference data never cached as public', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const sesiones = { resolve: async (token, correlationId) => ({ 'tok-laura': 'cuenta-laura', 'tok-otro': 'cuenta-otro' })[token] ? { subjectId: ({ 'tok-laura': 'cuenta-laura', 'tok-otro': 'cuenta-otro' })[token], sessionId: 's', tenantId: 't', roles: [], permissions: [], correlationId } : null }
    const app = express()
    app.use(express.json())
    app.use(crearRouterPerfil({ servicio, sessions: sesiones }))
    const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const base = 'http://127.0.0.1:' + servidor.address().port
    const call = async (method, path, { token, body, correlation = 'c' } = {}) => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(correlation ? { 'x-correlation-id': correlation } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json().catch(() => null) }
    }
    const out = {}
    try {
      out.sinSesion = [(await call('GET', '/tus/v1/perfil')).status, (await call('PUT', '/tus/v1/perfil', { body: VALIDO })).status, (await call('GET', '/tus/v1/perfil', { token: 'tok-falso' })).status, (await call('GET', '/tus/v1/perfil', { token: 'tok-laura', correlation: '' })).status]
      const guardado = await call('PUT', '/tus/v1/perfil', { token: 'tok-laura', body: VALIDO })
      out.guardado = [guardado.status, guardado.cache, guardado.body.perfil.cuentaId, guardado.body.perfil.perfilCompleto]
      // Authority fields are rejected: nobody edits another account by sending its id.
      const forjado = await call('PUT', '/tus/v1/perfil', { token: 'tok-otro', body: { ...VALIDO, numeroDocumento: '31222333', cuentaId: 'cuenta-laura', accountId: 'cuenta-laura', profileComplete: true } })
      out.forjado = [forjado.status, forjado.body.error.code, forjado.body.error.fields.sort()]
      out.lauraIntacta = (await call('GET', '/tus/v1/perfil', { token: 'tok-laura' })).body.perfil.numeroDocumento
      // Each session reads only its own profile (there is no route that takes an account id).
      const otro = await call('GET', '/tus/v1/perfil', { token: 'tok-otro' })
      out.otro = [otro.body.perfil.cuentaId, otro.body.perfil.numeroDocumento, otro.body.perfil.residencia]
      out.rutaConId = (await call('GET', '/tus/v1/perfil/cuenta-laura', { token: 'tok-otro' })).status
      const invalido = await call('PUT', '/tus/v1/perfil', { token: 'tok-otro', body: { ...VALIDO, numeroDocumento: 'x' } })
      out.invalido = [invalido.status, invalido.body.error.code, invalido.body.error.fields, typeof invalido.body.error.details.numeroDocumento]
      const duplicado = await call('PUT', '/tus/v1/perfil', { token: 'tok-otro', body: VALIDO })
      out.duplicado = [duplicado.status, duplicado.body.error.code]
      // Geography: public, from the catalog, with a private cache policy.
      const paises = await call('GET', '/tus/v1/geografia/paises')
      const provincias = await call('GET', '/tus/v1/geografia/provincias?paisId=ar')
      const localidades = await call('GET', '/tus/v1/geografia/localidades?provinciaId=ar-w')
      out.geografia = [paises.status, paises.cache, paises.body.items.length, provincias.body.items.map((p) => p.nombre), localidades.body.items.map((l) => [l.nombre, l.latitud !== null]), (await call('GET', '/tus/v1/geografia/provincias')).status, (await call('GET', '/tus/v1/geografia/localidades?provinciaId=' + encodeURIComponent("x' OR 1=1"))).status]
    } finally { await new Promise((resolve) => servidor.close(resolve)) }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.sinSesion, [401, 401, 401, 401])
  assert.deepEqual(result.guardado, [200, 'no-store', 'cuenta-laura', true])
  assert.deepEqual(result.forjado, [422, 'INVALID_PROFILE', ['accountId', 'cuentaId', 'profileComplete']])
  assert.equal(result.lauraIntacta, '30123456')
  assert.deepEqual(result.otro, ['cuenta-otro', null, null], 'another session never sees Laura\'s document or address')
  assert.equal(result.rutaConId, 404)
  assert.deepEqual(result.invalido, [422, 'INVALID_PROFILE', ['numeroDocumento'], 'string'])
  assert.deepEqual(result.duplicado, [409, 'DOCUMENT_ALREADY_REGISTERED'])
  assert.deepEqual(result.geografia, [200, 'private, max-age=300', 1, ['Chaco', 'Corrientes'], [['Corrientes Capital', true], ['Goya', true]], 422, 422])
})

test('ONBOARDING and navigation: incomplete profile -> /mi-perfil with returnTo and back; no loops; platform administration is not blocked and has no "Mis trabajos"', () => {
  const result = runTypeScriptScenario(`
    const mod = await import('./apps/web/src/lib/tus-auth-client.ts')
    const auth = mod.default ?? mod
    const incompleto = { platformAdmin: false, provider: false, profileComplete: false, profileRequired: true }
    const completo = { ...incompleto, profileComplete: true }
    const soloAdmin = { platformAdmin: true, provider: false, profileComplete: false, profileRequired: false }
    const adminPrestador = { platformAdmin: true, provider: true, profileComplete: false, profileRequired: true }
    const antiguo = { platformAdmin: false, provider: false }
    console.log(JSON.stringify({
      ejemplo: auth.resolvePostLoginRoute(incompleto, '/trabajadores'),
      conQuery: auth.resolvePostLoginRoute(incompleto, '/trabajadores/abc?tab=turnos'),
      sinDestino: auth.resolvePostLoginRoute(incompleto, null),
      completo: auth.resolvePostLoginRoute(completo, '/trabajadores'),
      soloAdmin: [auth.resolvePostLoginRoute(soloAdmin, null), auth.needsProfile(soloAdmin)],
      adminPrestador: auth.resolvePostLoginRoute(adminPrestador, null),
      antiguo: [auth.resolvePostLoginRoute(antiguo, '/publicar'), auth.needsProfile(antiguo)],
      sinLoop: [auth.profileRoute('/mi-perfil'), auth.profileRoute('/mi-perfil?returnTo=%2Fmi-perfil'), auth.resolvePostLoginRoute(incompleto, '/mi-perfil')],
      abierto: [auth.profileRoute('https://evil.example/x'), auth.profileRoute('//evil.example'), auth.profileRoute('/sign-in')],
      exentas: ['/mi-perfil', '/sign-in', '/registro', '/auth/sign-in', '/verificar-email', '/tus/admin', '/tus/admin/usuarios', '/ayuda', '/ayuda/verificar-celular'].map(auth.exemptFromProfile),
      protegidas: ['/', '/trabajadores', '/trabajos', '/publicar', '/prestador/turnos', '/asistente', '/tus'].map(auth.exemptFromProfile),
      links: [auth.accountLinks(soloAdmin).map((l) => l.label), auth.accountLinks(adminPrestador).map((l) => l.label), auth.accountLinks(completo).map((l) => l.label)],
      platformOnly: [auth.isPlatformOnly(soloAdmin), auth.isPlatformOnly(adminPrestador), auth.isPlatformOnly(completo), auth.isPlatformOnly(null)],
    }))
  `)
  assert.equal(result.ejemplo, '/mi-perfil?returnTo=%2Ftrabajadores', 'the documented example')
  assert.equal(result.conQuery, '/mi-perfil?returnTo=%2Ftrabajadores%2Fabc%3Ftab%3Dturnos')
  assert.equal(result.sinDestino, '/mi-perfil?returnTo=%2F')
  assert.equal(result.completo, '/trabajadores')
  assert.deepEqual(result.soloAdmin, ['/tus/admin', false], 'a platform administration account is never sent to onboarding')
  assert.equal(result.adminPrestador, '/tus/admin', 'the administration panel stays reachable')
  assert.deepEqual(result.antiguo, ['/publicar', false], 'an API without the profile module never forces onboarding')
  assert.deepEqual(result.sinLoop, ['/mi-perfil', '/mi-perfil', '/mi-perfil'], 'the profile never returns to itself')
  assert.deepEqual(result.abierto, ['/mi-perfil', '/mi-perfil', '/mi-perfil'], 'returnTo is an internal path only')
  assert.deepEqual(result.exentas, [true, true, true, true, true, true, true, true, true], 'the Help Center is public: the guide that explains the profile is never behind it')
  assert.deepEqual(result.protegidas, [false, false, false, false, false, false, false])
  assert.deepEqual(result.links, [['Panel admin', 'Mi perfil'], ['Panel admin', 'Mi perfil', 'Mis turnos', 'Mis trabajos', 'Manual del prestador'], ['Mis solicitudes', 'Mis turnos', 'Mis trabajos', 'Mi perfil']])
  assert.deepEqual(result.platformOnly, [true, false, false, false])

  // Header (desktop + mobile menu) and footer render that one list; the route itself answers.
  const header = read('apps/web/src/features/home/public-header.tsx')
  // One list for both. The desktop header leaves out the links marked soloMenu ("Mis turnos": a
  // fourth button runs into the centred logo); the mobile menu and the footer show them all.
  assert.equal((header.match(/links\.filter\(\(link\) => !link\.soloMenu\)\.map\(/gu) ?? []).length, 1, 'desktop actions come from the shared list')
  assert.equal((header.match(/links\.map\(/gu) ?? []).length, 1, 'the mobile menu renders the whole shared list')
  assert.match(read('apps/web/src/features/home/site-footer.tsx'), /accountLinks\(account\.capabilities\)/u)
  const work = read('apps/web/src/features/work/work-page.tsx')
  assert.match(work, /isPlatformOnly\(account\.capabilities\)/u, '/trabajos itself tells a platform-only account it has no works (not only hidden)')
  assert.match(work, /href="\/tus\/admin\/trabajos"/u)
  // The gate is mounted once for every route and reads the API capabilities.
  assert.match(read('apps/web/src/app/layout.tsx'), /<ProfileGate \/>/u)
  const gate = read('apps/web/src/features/profile/profile-gate.tsx')
  assert.match(gate, /needsProfile\(account\.capabilities\)/u)
  assert.match(gate, /exemptFromProfile\(pathname\)/u)
  // Capabilities are decided by the API from the session.
  assert.match(read('apps/api/src/server.ts'), /profileRequired: !\(platformAdmin && !provider\)/u)
})

test('MAP and profile UI: the centre is the locality from the API or Corrientes Capital; no GPS, no Buenos Aires default, no catalog hard-coded in React; personal and professional data are separate', () => {
  const mapHome = read('apps/web/src/features/home/use-map-home.ts')
  assert.match(mapHome, /account\.capabilities\.mapCenter/u)
  assert.match(mapHome, /center\?\.origen === 'localidad'/u)
  const web = ['apps/web/src/features/home/provider-map.tsx', 'apps/web/src/features/home/use-map-home.ts', 'apps/web/src/features/alojamientos/alojamientos-map.tsx', 'apps/web/src/components/admin/admin-alojamientos.tsx', 'apps/web/src/features/profile/profile-page.tsx'].map((file) => [file, read(file)])
  for (const [file, source] of web) {
    assert.doesNotMatch(source, /-34\.6037|-58\.3816/u, `${file}: no Buenos Aires default`)
    assert.doesNotMatch(source, /navigator\.geolocation/u, `${file}: the browser GPS never replaces the profile`)
  }
  const providerMap = read('apps/web/src/features/home/provider-map.tsx')
  assert.match(providerMap, /goHome\(map, home\)/u, 'the map re-centres when the locality changes, with no reload')
  assert.match(providerMap, /map\.setView\(\[home\.lat, home\.lng\], home\.zoom, \{ animate: false \}\)/u, 'applied without animation: Leaflet ignores setView during a running zoom animation')
  assert.match(read('apps/web/src/features/session/use-account-view.ts'), /export function refreshAccountView\(\)/u)

  const profile = read('apps/web/src/features/profile/profile-page.tsx')
  assert.match(profile, /geography\s*\.countries\(\)/u)
  assert.match(profile, /geography\s*\.provinces\(form\.paisId\)/u)
  assert.match(profile, /geography\s*\.localities\(form\.provinciaId\)/u)
  assert.doesNotMatch(profile, /Buenos Aires|Corrientes|Chaco|Misiones/u, 'no province or locality list in the component')
  assert.match(profile, /validarPerfilPersonal\(/u, 'same validation as the API (shared contract)')
  assert.match(profile, /id="perfil-datos">Datos personales</u)
  assert.match(profile, /id="perfil-residencia">Residencia</u)
  assert.match(profile, /'Perfil profesional'/u, 'professional data is a separate section')
  assert.match(profile, /await refreshAccountView\(\)/u)
  assert.match(profile, /window\.location\.assign\(returnTo\)/u)
  assert.match(profile, /sanitizeTusReturnTo\(/u)
  // The public directory contract carries no personal data.
  const directorio = read('packages/contracts/src/tus-directorio.ts')
  const publico = directorio.slice(directorio.indexOf('export interface PrestadorPublico'), directorio.indexOf('export interface SlotDisponible'))
  assert.doesNotMatch(publico, /numeroDocumento|documentNumber|addressStreet|calle:|codigoPostal|phoneNumber/u)
})
