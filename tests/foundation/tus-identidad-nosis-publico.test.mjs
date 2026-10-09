import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { IDENTITY_SETUP } from './fixtures/identidad.mjs'

// DOCUMENTO-NOSIS-PUBLICO-01. The documentary verification against the PUBLIC search of Nosis.
// NOTHING here reaches Nosis: the adapter runs against a `fetch` stand-in that answers the
// fixtures of tests/foundation/fixtures/nosis-publico (the real shape of the answer, fictitious
// people). So this proves the code; that the real site still answers this shape is checked by
// hand with scripts/identidad/nosis-publico-smoke.mjs, never in CI.
const fixture = (nombre) => JSON.parse(readFileSync(join(root, 'tests/foundation/fixtures/nosis-publico', nombre + '.json'), 'utf8'))
const FIXTURES = Object.fromEntries(['encontrado', 'vacio', 'captcha', 'error', 'nombre-invertido', 'tildes', 'nombre-distinto', 'provincia-distinta', 'provincia-faltante', 'cuit-invalido', 'inesperado'].map((nombre) => [nombre, fixture(nombre)]))

test('NOSIS público, lectura de la respuesta: only the tax id, the document inside it, the name and the province leave the adapter; a captcha, an error and an unexpected shape are codes, never data; provinces and names are compared normalized with no permissive fuzzy', () => {
  const r = runTypeScriptScenario(`
    const { leerRespuestaNosisPublica, dniDeCuit } = await import('./apps/api/src/tus/identidad/nosis-public.ts')
    const { normalizarProvincia, compararProvincia, compararNombre, compararConFuente, resultadoDocumental } = await import('./apps/api/src/tus/identidad/modelo.ts')
    const F = ${JSON.stringify(FIXTURES)}
    const codigo = (operacion) => { try { operacion(); return 'none' } catch (error) { return error.code ?? String(error) } }
    const out = {}
    out.encontrado = leerRespuestaNosisPublica(F.encontrado)
    out.cuit = [dniDeCuit('20-45247702-6'), dniDeCuit('20452477026'), dniDeCuit('27-05123456-1'), dniDeCuit('45247702'), dniDeCuit(null)]
    out.vacio = leerRespuestaNosisPublica(F.vacio)
    out.codigos = [codigo(() => leerRespuestaNosisPublica(F.captcha)), codigo(() => leerRespuestaNosisPublica(F.error)), codigo(() => leerRespuestaNosisPublica(F.inesperado)), codigo(() => leerRespuestaNosisPublica(null)), codigo(() => leerRespuestaNosisPublica({ ExigirCaptcha: false, EntidadesEncontradas: [{ Documento: 20301112220 }] })), codigo(() => leerRespuestaNosisPublica({ ExigirCaptcha: false, EntidadesEncontradas: [{ Documento: 'sin numero', RazonSocial: 'X' }] }))]
    out.masResultados = leerRespuestaNosisPublica({ ...F.encontrado, HayMasResultados: true }).length
    out.provincias = ['Corrientes', 'CORRIENTES', ' corrientes ', 'Córdoba', 'Entre Ríos', 'Provincia de Buenos Aires', 'C.A.B.A.', 'Capital Federal', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur', 'Corrientes Capital', 'Springfield', '', null].map((x) => normalizarProvincia(x))
    out.comparaProvincia = [compararProvincia('CORRIENTES', 'Corrientes'), compararProvincia('Corrientes', 'Chaco'), compararProvincia(null, 'Chaco'), compararProvincia('Corrientes', ''), compararProvincia('Corientes', 'Corrientes')]
    const doc = { firstName: 'JOAQUIN DANIEL', lastName: 'FERRETTO' }
    out.nombres = ['Ferretto Joaquin Daniel', 'Joaquin Daniel Ferretto', 'FERRETTO, JOAQUÍN DANIEL', '  ferretto   joaquin-daniel. ', 'Ferretto Joaquin', 'Ferreto Joaquin Daniel', 'Ferretto Joaquin Daniel Ezequiel', 'Gomez Joaquin Daniel'].map((fuente) => compararNombre(doc, fuente))
    const persona = (cambios = {}) => [{ documentNumber: '30111222', fullName: 'Prueba Demo Juan', cuil: '20301112220', verifiedArea: { barrio: null, localidad: null, provincia: 'Corrientes' }, ...cambios }]
    const decide = (results, provincia) => { const x = compararConFuente({ documentNumber: '30.111.222', firstName: 'JUAN', lastName: 'PRUEBA DEMO', results, province: { required: true, document: provincia } }); return x.decision + ':' + (x.reason ?? x.cuil) }
    out.decisiones = [decide(persona(), 'CORRIENTES'), decide(persona(), 'Chaco'), decide(persona(), null), decide(persona({ verifiedArea: null }), 'Corrientes'), decide(persona({ documentNumber: '30111226', cuil: '20301112263' }), 'Corrientes'), decide(persona({ fullName: 'Otra Persona Carlos' }), 'Corrientes'), decide(persona({ cuil: '20301112229' }), 'Corrientes'), decide([], 'Corrientes')]
    // Without "required" (the other providers) the province takes no part, as before.
    out.sinExigir = compararConFuente({ documentNumber: '30111222', firstName: 'JUAN', lastName: 'PRUEBA DEMO', results: persona({ verifiedArea: null }) }).decision
    out.resultados = [['verified', null], ['rejected', 'NAME_MISMATCH'], ['review_required', 'NOSIS_NOT_FOUND'], ['review_required', 'PROVINCE_MISMATCH'], ['review_required', 'DOCUMENT_NUMBER_MISMATCH'], ['review_required', 'PROVINCE_UNAVAILABLE'], ['review_required', 'PROVIDER_RESPONSE_UNEXPECTED'], ['review_required', 'RETRIES_EXHAUSTED'], ['retry_pending', null], ['session_required', null], ['queued', null], ['pending_upload', null]].map(([status, reviewReason]) => resultadoDocumental({ status, reviewReason }))
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.encontrado, [{ documentNumber: '30111222', taxId: '20301112220', fullName: 'Prueba Demo Juan', province: 'Corrientes', source: 'nosis_public' }], 'four data and their source: no activity, no link to a report, no habeas data notice')
  assert.deepEqual(r.cuit, ['45247702', '45247702', '5123456', null, null], 'CUIT 20-45247702-6 -> DNI 45247702')
  assert.deepEqual(r.vacio, [])
  assert.deepEqual(r.codigos, ['NOSIS_CHALLENGE_REQUIRED', 'NOSIS_UNAVAILABLE', 'NOSIS_LAYOUT_CHANGED', 'NOSIS_LAYOUT_CHANGED', 'NOSIS_LAYOUT_CHANGED', 'NOSIS_LAYOUT_CHANGED'], 'a captcha, an error and an unexpected shape are never read as a person')
  assert.equal(r.masResultados, 2, 'more results than the answer carries: ambiguous')
  assert.deepEqual(r.provincias, ['CORRIENTES', 'CORRIENTES', 'CORRIENTES', 'CORDOBA', 'ENTRE RIOS', 'BUENOS AIRES', 'CIUDAD AUTONOMA DE BUENOS AIRES', 'CIUDAD AUTONOMA DE BUENOS AIRES', 'TIERRA DEL FUEGO', null, null, null, null], 'a text that is not a province is not approximated')
  assert.deepEqual(r.comparaProvincia, ['match', 'mismatch', 'unavailable', 'unavailable', 'unavailable'], 'a misspelled province is not "close enough"')
  assert.deepEqual(r.nombres, ['match', 'match', 'match', 'match', 'partial', 'mismatch', 'partial', 'mismatch'], 'surname first or last, accents, case, spaces and punctuation; a different surname never matches')
  assert.deepEqual(r.decisiones, ['verified:20301112220', 'review_required:PROVINCE_MISMATCH', 'review_required:PROVINCE_UNAVAILABLE', 'review_required:PROVINCE_UNAVAILABLE', 'review_required:DOCUMENT_NUMBER_MISMATCH', 'rejected:NAME_MISMATCH', 'review_required:CUIL_INVALID', 'review_required:NOSIS_NOT_FOUND'], 'approved only with DNI + name + province; a missing province is a manual review')
  assert.equal(r.sinExigir, 'verified')
  assert.deepEqual(r.resultados, ['VERIFIED', 'MISMATCH', 'NOT_FOUND', 'MISMATCH', 'MISMATCH', 'MANUAL_REVIEW_REQUIRED', 'MANUAL_REVIEW_REQUIRED', 'MANUAL_REVIEW_REQUIRED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', null, null])
})

test('NOSIS público, circuito completo: the worker asks the public search only for the document of a verification, once, within the hourly limit; VERIFIED needs DNI + name + province; every other case is told apart; only the minimal evidence is stored; no report is opened; no full document reaches a log', () => {
  const r = runTypeScriptScenario(`${IDENTITY_SETUP}
    const { NosisPublicLookupAdapter } = await import('./apps/api/src/tus/identidad/nosis-public.ts')
    const { digitoVerificadorCuil, resultadoDocumental } = await import('./apps/api/src/tus/identidad/modelo.ts')
    const F = ${JSON.stringify(FIXTURES)}
    const cuilDe = (dni) => { const base = '20' + String(dni).padStart(8, '0'); return base.slice(0, 2) + '-' + base.slice(2) + '-' + digitoVerificadorCuil(base) }
    // The stand-in of the public site: what each document number answers, and everything asked.
    const respuestas = new Map()
    const pedidos = []
    const fetchFalso = async (url, init) => {
      pedidos.push({ url, method: init.method, body: init.body ?? '' })
      if (init.method === 'GET') return { ok: true, status: 200, headers: { getSetCookie: () => ['ASP.NET_SessionId=ficticia; path=/; HttpOnly'] }, json: async () => ({}) }
      const dni = new URLSearchParams(init.body).get('Texto')
      const respuesta = respuestas.get(dni)
      if (respuesta === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
      return { ok: true, status: 200, headers: { getSetCookie: () => [] }, json: async () => JSON.parse(JSON.stringify(respuesta)) }
    }
    const publico = new NosisPublicLookupAdapter({ fetch: fetchFalso, baseUrl: 'https://nosis.test' })
    const trabajador = makeWorker('worker-publico', publico)
    const vaciar = async () => { for (let i = 0; i < 20; i += 1) { const x = await trabajador.procesarSiguiente(); if (x.outcome === 'idle' || x.outcome === 'paused') return x.outcome } return 'limite' }
    const conDocumento = (nombre, dni, documento = cuilDe(dni)) => { const copia = JSON.parse(JSON.stringify(F[nombre])); for (const entidad of copia.EntidadesEncontradas ?? []) entidad.Documento = documento; return copia }
    const out = {}
    let n = 100
    async function caso(dni, respuesta, { provincia = 'Corrientes', apellido = 'PRUEBA DEMO', nombre = 'JUAN' } = {}) {
      n += 1
      respuestas.set(String(dni), respuesta)
      await submitIdentity(n, [dni, apellido, nombre, '', provincia ?? ''].join('|'))
      await vaciar()
      const v = await latest(n)
      return { n, v, linea: [v.status, v.reviewReason, resultadoDocumental(v), v.verificationMethod] }
    }
    // ---- VERIFIED: the same person, however the name is written.
    const a = await caso(30111301, conDocumento('encontrado', 30111301))
    const b = await caso(30111302, conDocumento('nombre-invertido', 30111302))
    const c = await caso(30111303, conDocumento('tildes', 30111303), { provincia: 'CORRIENTES' })
    out.verificados = [a.linea, b.linea, c.linea]
    out.evidencia = [a.v.verifiedCuil, a.v.externalSnapshot.source, a.v.externalSnapshot.sourceTaxId, typeof a.v.externalSnapshot.checkedAt, a.v.externalSnapshot.comparison, a.v.providerReference]
    out.sinDatosComerciales = /Actividad|Servicios personales|UrlInforme|UrlClon|Informes\\/Comprar|Habeas|ficticio/iu.test(JSON.stringify(a.v))
    // ---- MISMATCH: which datum failed is told apart.
    const d = await caso(30111304, conDocumento('encontrado', 30111304, cuilDe(30111399)))
    const e = await caso(30111305, conDocumento('nombre-distinto', 30111305))
    const f = await caso(30111306, conDocumento('provincia-distinta', 30111306))
    out.noCoincide = [d.linea, e.linea, f.linea]
    out.cualFallo = [[d.v.externalSnapshot.comparison.dni.match, d.v.externalSnapshot.comparison.dni.source], e.v.externalSnapshot.comparison.name.match, [f.v.externalSnapshot.comparison.province.document, f.v.externalSnapshot.comparison.province.source, f.v.externalSnapshot.comparison.province.match]]
    advance(61 * 60_000)
    // ---- MANUAL_REVIEW_REQUIRED / NOT_FOUND.
    const g = await caso(30111307, conDocumento('provincia-faltante', 30111307))
    const h = await caso(30111308, conDocumento('encontrado', 30111308), { provincia: null })
    const i = await caso(30111309, F.vacio)
    const j = await caso(30111310, F.inesperado)
    const k = await caso(30111311, conDocumento('cuit-invalido', 30111311, '20-30111311-0'))
    out.revision = [g.linea, h.linea, i.linea, j.linea, k.linea]
    out.inesperadoNoReintenta = [j.v.attempts, (await identityStore.state.trabajos ? [...identityStore.state.trabajos.values()] : []).filter((t) => t.verificationId === j.v.verificationId && (t.status === 'pending' || t.status === 'leased')).length]
    // ---- The same verification never asks twice: more cycles, no new search.
    const buscadasAntes = pedidos.filter((p) => p.method === 'POST').length
    await vaciar(); await vaciar()
    out.sinRepetir = [pedidos.filter((p) => p.method === 'POST').length === buscadasAntes, pedidos.filter((p) => p.method === 'POST' && new URLSearchParams(p.body).get('Texto') === '30111301').length]
    advance(61 * 60_000)
    // ---- PROVIDER_UNAVAILABLE: an error of the site, a timeout, a captcha (never answered).
    const l = await caso(30111312, F.error)
    const m = await caso(30111313, 'timeout')
    const o = await caso(30111314, F.captcha)
    out.noDisponible = [l.linea, m.linea, o.linea]
    // After the captcha: a new verification is NOT searched (the worker waits for an operator).
    const antesDeEsperar = pedidos.filter((p) => p.method === 'POST').length
    const p = await caso(30111315, conDocumento('encontrado', 30111315))
    out.trasCaptcha = [p.v.status === 'verified', pedidos.filter((x) => x.method === 'POST').length === antesDeEsperar, p.v.externalSnapshot]
    // ---- What was asked of the site, in all: its landing page and its search form; nothing else.
    const rutas = [...new Set(pedidos.map((p) => p.method + ' ' + new URL(p.url).pathname))].sort()
    const buscados = pedidos.filter((p) => p.method === 'POST').map((p) => new URLSearchParams(p.body).get('Texto'))
    out.pedidos = [rutas, buscados.length, buscados.every((dni) => /^3011131\\d|^3011130\\d/u.test(dni)), pedidos.some((p) => /informe|comprar|clon/iu.test(p.url)), pedidos.filter((p) => p.method === 'POST').every((p) => new URLSearchParams(p.body).get('encodedResponse') === '')]
    // ---- The hourly limit is the existing one: an eighth search in the same hour waits.
    advance(61 * 60_000)
    await identity.reanudarWorker?.(platformAdmin).catch(() => null)
    out.logsSinDni = logs.some((linea) => /30111\\d{3}/u.test(JSON.stringify(linea)))
    console.log(JSON.stringify(out))
  `)
  const V = ['verified', null, 'VERIFIED', 'nosis_public']
  assert.deepEqual(r.verificados, [V, V, V], 'surname first, name first, accents and case: the same person, verified by the public search')
  assert.match(r.evidencia[0], /^2030111301\d$/u, 'the tax id the source showed, whose document is the one of the card')
  assert.deepEqual(r.evidencia.slice(1, 4), ['nosis_public', r.evidencia[0], 'string'], 'where it came from, the tax id shown and when')
  assert.deepEqual(r.evidencia[4], { dni: { document: '30111301', source: '30111301', match: true }, name: { document: 'JUAN PRUEBA DEMO', source: 'PRUEBA DEMO JUAN', match: 'match' }, province: { document: 'CORRIENTES', source: 'CORRIENTES', match: 'match' } }, 'the three compared data, normalized')
  assert.equal(r.evidencia[5], null)
  assert.equal(r.sinDatosComerciales, false, 'no activity, no report link, no habeas data notice is stored')
  assert.deepEqual(r.noCoincide, [['review_required', 'DOCUMENT_NUMBER_MISMATCH', 'MISMATCH', null], ['rejected', 'NAME_MISMATCH', 'MISMATCH', null], ['review_required', 'PROVINCE_MISMATCH', 'MISMATCH', null]])
  assert.deepEqual(r.cualFallo, [[false, '30111399'], 'mismatch', ['CORRIENTES', 'CHACO', 'mismatch']], 'the datum that failed is told apart')
  assert.deepEqual(r.revision, [
    ['review_required', 'PROVINCE_UNAVAILABLE', 'MANUAL_REVIEW_REQUIRED', null],
    ['review_required', 'PROVINCE_UNAVAILABLE', 'MANUAL_REVIEW_REQUIRED', null],
    ['review_required', 'NOSIS_NOT_FOUND', 'NOT_FOUND', null],
    ['review_required', 'PROVIDER_RESPONSE_UNEXPECTED', 'MANUAL_REVIEW_REQUIRED', null],
    ['review_required', 'CUIL_INVALID', 'MANUAL_REVIEW_REQUIRED', null],
  ], 'a missing province (in the source or in the document), nobody found, an unexpected answer and an invalid tax id: a person decides')
  assert.equal(r.inesperadoNoReintenta[1], 0, 'an unexpected answer is not asked again')
  assert.deepEqual(r.sinRepetir, [true, 1], 'a resolved verification never asks the source again')
  assert.deepEqual(r.noDisponible.map((x) => [x[0], x[2]]), [['retry_pending', 'PROVIDER_UNAVAILABLE'], ['retry_pending', 'PROVIDER_UNAVAILABLE'], ['session_required', 'PROVIDER_UNAVAILABLE']], 'an error of the site and a timeout are retried later; a captcha stops everything')
  assert.deepEqual(r.trasCaptcha, [false, true, null], 'after a captcha nothing more is asked of the site until an operator resumes the worker')
  assert.deepEqual(r.pedidos, [['GET /', 'POST /Home/Buscar'], 14, true, false, true], 'only the landing page and the search form, one search per verification, never a report, never an answer to a captcha')
  assert.equal(r.logsSinDni, false, 'no log line carries a whole document number')
})

test('NOSIS público, seguridad y pantallas: no route takes a document number to look a person up; only the worker composition builds the adapter; the adapter reads nothing commercial and logs nothing; the migration only widens the method; the screens say "Documento verificado" and show DNI next to Nosis', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const fuentes = []
  const recorrer = (dir) => { for (const item of readdirSync(dir, { withFileTypes: true })) { const ruta = join(dir, item.name); if (item.isDirectory()) recorrer(ruta); else if (/\.tsx?$/u.test(item.name)) fuentes.push(ruta) } }
  recorrer(join(root, 'apps/api/src'))
  const relativa = (ruta) => relative(root, ruta).split(sep).join('/')
  // Who can reach the adapter: its own file and the composition the worker is built with.
  const usan = fuentes.filter((ruta) => /NosisPublicLookupAdapter|nosis-public\.ts/u.test(readFileSync(ruta, 'utf8'))).map(relativa).sort()
  assert.deepEqual(usan, ['apps/api/src/tus/identidad/composicion.ts', 'apps/api/src/tus/identidad/nosis-public.ts'], 'no HTTP route nor any other service can call the public search')
  // No route that looks a document number up.
  for (const ruta of fuentes.filter((item) => /http|router|server/u.test(relativa(item)))) {
    const texto = readFileSync(ruta, 'utf8')
    assert.doesNotMatch(texto, /['"`]\/[^'"`]*[/-]nosis(?:[/-][^'"`]*)?['"`]/iu, relativa(ruta) + ': no route named after Nosis')
  }
  // No route anywhere reads a document number from the address of a request.
  for (const ruta of fuentes) assert.doesNotMatch(readFileSync(ruta, 'utf8'), /(?:query|params)\[['"](?:dni|documento|documentNumber|document)['"]\]/u, relativa(ruta))
  const adaptador = read('apps/api/src/tus/identidad/nosis-public.ts')
  const codigo = adaptador.replace(/^\s*\/\/.*$/gmu, '')
  assert.doesNotMatch(codigo, /\['(?:Actividad|UrlInforme|UrlClon|MensajeHabeasData)'\]|console\.|logger|playwright|chromium/iu, 'nothing commercial is read, nothing is logged, no browser')
  assert.match(codigo, /if \(body\['ExigirCaptcha'\]\) throw new ErrorProveedorIdentidad\('NOSIS_CHALLENGE_REQUIRED'/u, 'a captcha stops the adapter')
  assert.match(codigo, /if \(!\(await consumirSlot\(\)\)\) throw new ErrorProveedorIdentidad\('NOSIS_RATE_LIMITED'/u, 'the hourly limit is asked before any search')
  assert.deepEqual([...codigo.matchAll(/\$\{this\.baseUrl\}([^`]*)`/gu)].map((m) => m[1]).sort(), ['/', '/', '${RUTA_BUSCAR}'].sort(), 'the landing page and the search: no other address of the site is ever requested')
  // The limit is the existing one (at most 7 per hour).
  assert.match(read('apps/api/src/tus/identidad/composicion.ts'), /const maxChecksPerHour = Number\.isInteger\(max\) && max >= 1 && max <= 7 \? max : 7/u)
  // Migration: only the CHECK of the method, wider.
  const sql = read('apps/api/prisma/migrations/20261119100000_tus_identidad_nosis_publico/migration.sql').replace(/^--.*$/gmu, '')
  assert.match(sql, /IN \('nosis_browser', 'nosis_api', 'nosis_public', 'demo', 'manual'\)/u)
  assert.doesNotMatch(sql, /DROP (?:TABLE|COLUMN)|DELETE|UPDATE|TRUNCATE/iu)
  // Screens.
  const lib = read('apps/web/src/lib/tus-identidad.ts')
  assert.match(lib, /verified: 'Documento verificado'/u)
  assert.doesNotMatch(lib + read('apps/web/src/components/prestador/verificacion-identidad.tsx'), /identidad biom[eé]trica verificada/iu)
  const admin = read('apps/web/src/components/admin/verificaciones-identidad.tsx')
  assert.match(admin, /<tr><th>Dato<\/th><th>DNI<\/th><th>Nosis<\/th><th>Resultado<\/th><\/tr>/u)
  for (const dato of ["'Documento', comparison.dni.document, comparison.dni.source", "'Nombre', comparison.name.document, comparison.name.source", "'Provincia', comparison.province.document, comparison.province.source"]) assert.ok(admin.includes(dato), dato)
  assert.match(admin, /RESULTADO_DOCUMENTAL_TEXTO\[result\]/u)
  assert.match(lib, /MANUAL_REVIEW_REQUIRED: 'Revisión manual requerida'/u)
})
