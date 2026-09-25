import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// "Buscar trabajador" (directorio), "Buscar servicios" (asistente) y la solicitud TUS dirigida a
// un prestador. Los hechos (aprobación, servicios, verificación, trabajos) vienen de fuentes
// falsas con la misma forma que los módulos reales; nada se inventa.
const root = join(import.meta.dirname, '..', '..')
const SETUP = `
  const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
  const contratos = await import('./packages/contracts/src/tus-directorio.ts')
  // Lunes 28/09/2026, 10:00 en Argentina (día 1 en los horarios de las publicaciones).
  let now = Date.parse('2026-09-28T13:00:00.000Z')
  const clock = () => now
  let seq = 0
  const newId = () => 'id-' + String(++seq).padStart(8, '0')
  const merchants = new Map(); const listings = new Map(); const verified = new Set(); const completed = new Map()
  const application = {
    marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null }, listings: { forTenant: async (t) => listings.get(t) ?? [] } } },
    identity: { identidadVerificada: async (t) => verified.has(t) },
  }
  const directorio = crearServicioDirectorio({ application, contarCompletados: async (t) => completed.get(t) ?? 0, now: clock, newId })
  const auth = createInMemoryAuthService({ now: clock })
  const sessions = new DurableIdentitySessionResolver(auth.store, clock)
  const solicitudes = crearServicioSolicitudes({ cuentas: auth.store, destinos: directorio, now: clock, newId })
  const ctx = (tenantId, permissions = ['tus:marketplace:write', 'tus:marketplace:read']) => ({ tenantId, subjectId: 'actor-' + tenantId, sessionId: 's', roles: ['merchant'], permissions, correlationId: 'c' })
  const service = (name, price, days) => ({ listingId: 'l-' + name, name, price, currency: 'ARS', priceMode: 'fixed', published: true, kind: 'service', workingHours: days.map((day) => ({ day, start: '09:00', end: '18:00' })) })
  async function prestador(tenantId, perfil, opts = {}) {
    merchants.set(tenantId, { merchantId: 'm-' + tenantId, status: opts.status ?? 'approved' })
    if (opts.listings) listings.set(tenantId, opts.listings)
    if (opts.verified) verified.add(tenantId)
    if (opts.completed) completed.set(tenantId, opts.completed)
    return directorio.guardarPerfil(ctx(tenantId), { zone: 'Centro', ...perfil })
  }
  async function cliente(email, displayName = 'Laura Martínez') {
    const registered = await auth.register({ email, password: 'Contrasena-Segura-2026', displayName })
    await auth.verifyEmail({ token: registered.verificationToken })
    return registered.account
  }
  function png(extraChunks = []) {
    const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1'); return Buffer.concat([head, data, Buffer.alloc(4)]) }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13, 1)), ...extraChunks.map(([type, data]) => chunk(type, Buffer.from(data, 'utf8'))), chunk('IDAT', Buffer.alloc(9000, 3)), chunk('IEND', Buffer.alloc(0))])
  }
  const valida = { category: 'plomeria', title: 'Pierde agua la canilla de la cocina', description: 'Gotea todo el día.', zone: 'Camba Cuá', budgetMax: 25000, urgency: 'hoy_manana' }
`

test('DIRECTORIO one canonical profession catalog shared by API, contracts, requests, WhatsApp and Web', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const oficios = await import('./apps/api/src/tus/directorio/oficios.ts')
    const solicitudesModelo = await import('./apps/api/src/tus/solicitudes/modelo.ts')
    console.log(JSON.stringify({ api: [...oficios.IDS_OFICIOS].sort(), contracts: [...contratos.OFICIOS_TUS].sort(), requests: [...solicitudesModelo.CATEGORIAS_SOLICITUD].sort(), catalog: oficios.catalogoPublico() }))
  `)
  assert.deepEqual(result.api, result.contracts)
  assert.deepEqual(result.api, result.requests)
  assert.deepEqual(Object.keys(result.catalog[0]).sort(), ['id', 'label', 'profession'])
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20261001100000_tus_directorio_prestadores/migration.sql'), 'utf8')
  for (const id of result.api) assert.match(migration, new RegExp(`'${id}'`))
  const web = readFileSync(join(root, 'apps/web/src/features/home/types.ts'), 'utf8')
  for (const id of result.api) assert.match(web, new RegExp(`id: '${id}'`))
  const tools = readFileSync(join(root, 'apps/api/src/tus/asistente/herramientas.ts'), 'utf8')
  assert.match(tools, /IDS_OFICIOS/)
})

test('ASISTENTE interprets the need deterministically and never guesses when unsure', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const i = (text) => directorio.interpretar(text)
    console.log(JSON.stringify({
      bacha: i('Pierde agua abajo de la bacha de mi cocina'),
      aire: i('Necesito alguien que arregle mi aire acondicionado porque dejó de enfriar'),
      full: i('Busco electricista urgente en Camba Cuá, hasta $30.000'),
      pesos: i('Pintar el living, tengo 45000 pesos, sin apuro'),
      unknown: i('Hola, qué tal'),
      ambiguous: i('techo'),
    }))
  `)
  assert.equal(result.bacha.category, 'plomeria')
  assert.equal(result.aire.category, 'aire')
  assert.deepEqual(result.full, { category: 'electricidad', alternatives: [], zone: 'Camba Cuá', urgency: 'urgente', budgetMax: 30000 })
  assert.equal(result.pesos.category, 'pintura')
  assert.equal(result.pesos.budgetMax, 45000)
  assert.equal(result.pesos.urgency, 'sin_apuro')
  assert.deepEqual(result.unknown, { category: null, alternatives: [], zone: null, urgency: null, budgetMax: null })
  assert.equal(result.ambiguous.category, null)
  assert.ok(result.ambiguous.alternatives.length >= 2)
})

test('DIRECTORIO profile: only onboarded providers, validated fields, no contact data', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const sinOnboarding = await directorio.guardarPerfil(ctx('t-nadie'), { displayName: 'Carlos Méndez', profession: 'plomeria', zone: 'Centro' })
    const invalido = await prestador('t-1', { displayName: 'Llamame 3794123456', profession: 'jardineria', zone: 'Palermo', description: 'escribime a carlos@example.com', yearsOfExperience: 200 })
    const ok = await prestador('t-1', { displayName: 'Carlos Méndez', profession: 'plomeria', zone: 'Centro', description: 'Plomería general y destapaciones.', yearsOfExperience: 12 })
    const editado = await directorio.guardarPerfil(ctx('t-1'), { displayName: 'Carlos Méndez', profession: 'plomeria', zone: 'Libertad' })
    console.log(JSON.stringify({ sinOnboarding, invalido, ok, editado, mismoId: ok.perfil.id === editado.perfil.id }))
  `)
  assert.equal(result.sinOnboarding.code, 'PROVIDER_REQUIRED')
  assert.deepEqual(result.invalido.fields.sort(), ['description', 'displayName', 'profession', 'yearsOfExperience', 'zone'])
  assert.equal(result.ok.ok, true)
  assert.equal(result.ok.perfil.profession.title, 'Plomero/a')
  assert.equal(result.ok.perfil.yearsOfExperience, 12)
  assert.equal(result.editado.perfil.approximateArea, 'Libertad')
  assert.ok(result.mismoId)
})

test('DIRECTORIO lists only approved visible providers with real facts, filters and pages; public DTO has no private data', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await prestador('t-carlos', { displayName: 'Carlos Méndez', profession: 'plomeria', zone: 'Centro' }, { verified: true, completed: 37, listings: [service('Destapación', 18000, [1, 2, 3])] })
    await prestador('t-ana', { displayName: 'Ana Gómez', profession: 'electricidad', zone: 'Camba Cuá' }, { completed: 5, listings: [service('Instalación eléctrica', 25000, [5])] })
    await prestador('t-luis', { displayName: 'Luis Pérez', profession: 'electricidad', zone: 'Laguna Seca' }, { verified: true, completed: 12 })
    await prestador('t-suspendido', { displayName: 'Pedro Suspendido', profession: 'plomeria', zone: 'Centro' }, { status: 'pending' })
    await prestador('t-oculto', { displayName: 'Oculto', profession: 'plomeria', zone: 'Centro', visible: false })
    const all = await directorio.listar()
    const electricistas = await directorio.listar({ oficio: 'electricidad' })
    const texto = await directorio.listar({ q: 'electricista' })
    const porNombre = await directorio.listar({ q: 'carlos' })
    const verificados = await directorio.listar({ verificados: 'true' })
    const hoy = await directorio.listar({ hoy: '1', atiendeHoy: '1' })
    const zona = await directorio.listar({ zona: 'Camba Cuá' })
    const porTrabajos = await directorio.listar({ orden: 'trabajos' })
    const vacio = await directorio.listar({ oficio: 'mecanica' })
    const perfil = await directorio.perfil(all.items.find((item) => item.displayName === 'Carlos Méndez').id)
    const suspendido = await directorio.perfil('id-99999999')
    console.log(JSON.stringify({
      all, names: all.items.map((item) => item.displayName), electricistas: electricistas.items.map((item) => item.displayName), texto: texto.items.map((item) => item.displayName),
      porNombre: porNombre.items.map((item) => item.displayName), verificados: verificados.items.map((item) => item.displayName), hoy: hoy.items.map((item) => item.displayName),
      zona: zona.items.map((item) => item.displayName), porTrabajos: porTrabajos.items.map((item) => item.completedJobs), vacio, perfil, suspendido,
      contrato: all.items.every(contratos.esPrestadorPublico), pagina: contratos.esPaginaDirectorio(all),
    }))
  `)
  assert.deepEqual(result.names.sort(), ['Ana Gómez', 'Carlos Méndez', 'Luis Pérez'])
  assert.deepEqual(result.electricistas.sort(), ['Ana Gómez', 'Luis Pérez'])
  assert.deepEqual(result.texto.sort(), ['Ana Gómez', 'Luis Pérez'])
  assert.deepEqual(result.porNombre, ['Carlos Méndez'])
  assert.deepEqual(result.verificados.sort(), ['Carlos Méndez', 'Luis Pérez'])
  assert.deepEqual(result.hoy, ['Carlos Méndez'])
  assert.deepEqual(result.zona, ['Ana Gómez'])
  assert.deepEqual(result.porTrabajos, [37, 12, 5])
  assert.deepEqual(result.vacio, { items: [], total: 0, page: 1, hasMore: false })
  const carlos = result.all.items.find((item) => item.displayName === 'Carlos Méndez')
  assert.equal(carlos.rating, null)
  assert.equal(carlos.completedJobs, 37)
  assert.equal(carlos.verified, true)
  assert.equal(carlos.availability.status, 'atiende_hoy')
  assert.deepEqual(carlos.startingPrice, { amount: 18000, currency: 'ARS' })
  assert.equal(result.all.items.find((item) => item.displayName === 'Luis Pérez').availability.status, 'sin_agenda')
  assert.equal(result.all.items.find((item) => item.displayName === 'Ana Gómez').availability.label, 'Atiende viernes')
  assert.equal(result.contrato, true)
  assert.equal(result.pagina, true)
  assert.doesNotMatch(JSON.stringify(result.all), /t-carlos|m-t-carlos|tenant|merchant/i)
  assert.deepEqual(result.perfil.services.map((item) => [item.name, item.days]), [['Destapación', [1, 2, 3]]])
  assert.equal(result.suspendido, null)
})

test('ASISTENTE candidates: 3-5 real compatible providers, verified and nearer first; honest empty result', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const zonas = ['Centro', 'Camba Cuá', 'Libertad', 'Laguna Seca', 'Molina Punta', 'Barrio Sur']
    for (const [index, zona] of zonas.entries()) await prestador('t-p' + index, { displayName: 'Plomero ' + index, profession: 'plomeria', zone: zona }, { verified: index === 5 })
    const candidatos = await directorio.buscarCandidatos({ oficio: 'plomeria', zona: 'Camba Cuá' })
    const sinZona = await directorio.buscarCandidatos({ oficio: 'plomeria' })
    const ninguno = await directorio.buscarCandidatos({ oficio: 'mecanica', zona: 'Centro' })
    const invalido = await directorio.buscarCandidatos({ oficio: 'magia' })
    console.log(JSON.stringify({ candidatos, sinZona: sinZona.items.length, ninguno, invalido }))
  `)
  assert.equal(result.candidatos.reason, 'ok')
  assert.equal(result.candidatos.items.length, 5)
  assert.equal(result.candidatos.items[0].displayName, 'Plomero 5')
  assert.equal(result.candidatos.items[1].displayName, 'Plomero 1')
  assert.equal(result.candidatos.items[1].distanceKm, 0)
  const distancias = result.candidatos.items.slice(1).map((item) => item.distanceKm)
  assert.deepEqual(distancias, [...distancias].sort((a, b) => a - b))
  assert.equal(result.sinZona, 5)
  assert.deepEqual(result.ninguno, { items: [], reason: 'no_providers' })
  assert.equal(result.invalido.reason, 'invalid_profession')
})

test('SOLICITUD dirigida: chosen is not confirmed; only the target provider answers; private to client and provider', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const carlos = await prestador('t-carlos', { displayName: 'Carlos Méndez', profession: 'plomeria', zone: 'Centro' })
    await prestador('t-otro', { displayName: 'Otro Prestador', profession: 'plomeria', zone: 'Centro' })
    await prestador('t-pendiente', { displayName: 'No Aprobado', profession: 'plomeria', zone: 'Centro' }, { status: 'pending' })
    const pendienteId = (await directorio.perfilPorTenant('t-pendiente')).id
    const laura = await cliente('laura@example.com')
    const providerId = carlos.perfil.id
    const dirigida = await solicitudes.publicar(laura.id, { ...valida, providerId }, { origen: 'web_assistant' })
    const noDisponible = await solicitudes.publicar(laura.id, { ...valida, providerId: pendienteId })
    const inexistente = await solicitudes.publicar(laura.id, { ...valida, providerId: 'id-12345678' })
    const publicas = await solicitudes.listarPublicas()
    const bandeja = await solicitudes.recibidas('t-carlos')
    const bandejaOtro = await solicitudes.recibidas('t-otro')
    const otroResponde = await solicitudes.responder('t-otro', dirigida.solicitud.id, 'aceptada')
    const acepta = await solicitudes.responder('t-carlos', dirigida.solicitud.id, 'aceptada')
    const repite = await solicitudes.responder('t-carlos', dirigida.solicitud.id, 'rechazada')
    const mias = await solicitudes.mias(laura.id)
    // Rechazo y cancelación.
    now += 60_000
    const segunda = await solicitudes.publicar(laura.id, { ...valida, providerId })
    const rechaza = await solicitudes.responder('t-carlos', segunda.solicitud.id, 'rechazada')
    now += 60_000
    const tercera = await solicitudes.publicar(laura.id, { ...valida, providerId })
    const cancela = await solicitudes.cerrar(laura.id, tercera.solicitud.id)
    const tardia = await solicitudes.responder('t-carlos', tercera.solicitud.id, 'aceptada')
    const estados = (await solicitudes.mias(laura.id)).map((item) => [item.status, item.assignment])
    // Un prestador no puede pedirse a sí mismo.
    const propia = await cliente('carlos@example.com', 'Carlos Méndez')
    const selfProvider = await prestador(propia.tenantId, { displayName: 'Carlos Otro', profession: 'plomeria', zone: 'Centro' })
    const self = await solicitudes.publicar(propia.id, { ...valida, providerId: selfProvider.perfil.id })
    console.log(JSON.stringify({ dirigida, noDisponible, inexistente, publicas: publicas.length, bandeja, bandejaOtro: bandejaOtro.length, otroResponde, acepta, repite, mias, rechaza, cancela, tardia, estados, self }))
  `)
  assert.equal(result.dirigida.ok, true)
  assert.equal(result.dirigida.solicitud.assignment, 'pendiente')
  assert.equal(result.dirigida.solicitud.origin, 'web_assistant')
  assert.deepEqual(result.dirigida.solicitud.provider, { id: result.dirigida.solicitud.provider.id, displayName: 'Carlos Méndez' })
  assert.equal(result.noDisponible.code, 'PROVIDER_NOT_AVAILABLE')
  assert.equal(result.inexistente.code, 'PROVIDER_NOT_AVAILABLE')
  assert.equal(result.publicas, 0)
  assert.equal(result.bandeja.length, 1)
  assert.equal(result.bandeja[0].requesterName, 'Laura M.')
  assert.equal(result.bandeja[0].assignment, 'pendiente')
  assert.doesNotMatch(JSON.stringify(result.bandeja), /laura@example\.com|Martínez|cuentaId|accountId/)
  assert.equal(result.bandejaOtro, 0)
  assert.equal(result.otroResponde.code, 'NOT_FOUND')
  assert.equal(result.acepta.solicitud.assignment, 'aceptada')
  assert.ok(result.acepta.solicitud.respondedAt)
  assert.equal(result.repite.code, 'NOT_FOUND')
  assert.equal(result.mias[0].assignment, 'aceptada')
  assert.equal(result.rechaza.solicitud.assignment, 'rechazada')
  assert.equal(result.cancela.ok, true)
  assert.equal(result.tardia.code, 'NOT_FOUND')
  assert.deepEqual(result.estados, [['cerrada', 'cancelada'], ['cerrada', 'rechazada'], ['abierta', 'aceptada']])
  assert.equal(result.self.code, 'SELF_REQUEST')
})

test('SOLICITUD images: up to 2, metadata stripped, public only for public requests, private for client and target provider', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const carlos = await prestador('t-carlos', { displayName: 'Carlos Méndez', profession: 'plomeria', zone: 'Centro' })
    const laura = await cliente('laura@example.com')
    const publica = await solicitudes.publicar(laura.id, valida)
    const dirigida = await solicitudes.publicar(laura.id, { ...valida, providerId: carlos.perfil.id })
    const conGps = png([['tEXt', 'GPSLatitude -27.46'], ['eXIf', 'Exif GPS data']])
    const invalida = await solicitudes.agregarImagen(laura.id, publica.solicitud.id, Buffer.from('<svg onload=alert(1)>'))
    const ajena = await solicitudes.agregarImagen('otra-cuenta', publica.solicitud.id, png())
    const primera = await solicitudes.agregarImagen(laura.id, publica.solicitud.id, conGps)
    const segunda = await solicitudes.agregarImagen(laura.id, publica.solicitud.id, png())
    const tercera = await solicitudes.agregarImagen(laura.id, publica.solicitud.id, png())
    await solicitudes.agregarImagen(laura.id, dirigida.solicitud.id, png())
    const guardada = await solicitudes.imagenPublica(publica.solicitud.id, 1)
    const listado = await solicitudes.listarPublicas()
    const dirigidaPublica = await solicitudes.imagenPublica(dirigida.solicitud.id, 1)
    const paraCliente = await solicitudes.imagenPrivada({ cuentaId: laura.id, tenantId: laura.tenantId }, dirigida.solicitud.id, 1)
    const paraPrestador = await solicitudes.imagenPrivada({ cuentaId: 'x', tenantId: 't-carlos' }, dirigida.solicitud.id, 1)
    const paraOtro = await solicitudes.imagenPrivada({ cuentaId: 'x', tenantId: 't-otro' }, dirigida.solicitud.id, 1)
    const bandeja = await solicitudes.recibidas('t-carlos')
    console.log(JSON.stringify({ primera, segunda, tercera, ajena, invalida, mime: guardada.tipoMime, gps: guardada.contenido.includes(Buffer.from('GPS')), images: listado[0].images, dirigidaPublica, paraCliente: Boolean(paraCliente), paraPrestador: Boolean(paraPrestador), paraOtro, bandejaImages: bandeja[0].images }))
  `)
  assert.deepEqual([result.primera.ok, result.segunda.ok], [true, true])
  assert.equal(result.tercera.code, 'IMAGE_LIMIT')
  assert.equal(result.ajena.code, 'NOT_FOUND')
  assert.equal(result.invalida.code, 'INVALID_IMAGE')
  assert.equal(result.mime, 'image/png')
  assert.equal(result.gps, false)
  assert.equal(result.images.length, 2)
  assert.match(result.images[0], /^\/tus\/v1\/public\/solicitudes\/[\w-]+\/imagenes\/1$/)
  assert.equal(result.dirigidaPublica, null)
  assert.equal(result.paraCliente, true)
  assert.equal(result.paraPrestador, true)
  assert.equal(result.paraOtro, null)
  assert.match(result.bandejaImages[0], /^\/tus\/v1\/solicitudes\//)
})

test('DIRECTORIO + SOLICITUDES HTTP: public reads without auth, private actions need a session, forged fields rejected', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { crearRouterDirectorio } = await import('./apps/api/src/tus/directorio/http.ts')
    const { crearRouterSolicitudes } = await import('./apps/api/src/tus/solicitudes/http.ts')
    const carlos = await prestador('t-carlos', { displayName: 'Carlos Méndez', profession: 'plomeria', zone: 'Centro' }, { verified: true, completed: 3 })
    const app = express(); app.use(express.json()); app.use(express.raw({ type: ['application/octet-stream'], limit: '10mb' }))
    app.use(crearRouterSolicitudes({ servicio: solicitudes, sessions })); app.use(crearRouterDirectorio({ servicio: directorio, sessions }))
    const server = app.listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    await cliente('laura@example.com')
    const signed = await auth.signIn({ email: 'laura@example.com', password: 'Contrasena-Segura-2026' })
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + signed.session.accessToken, 'x-correlation-id': 'corr-1' }
    const json = async (res) => [res.status, await res.json()]
    try {
      const oficios = await json(await fetch(base + '/tus/v1/public/oficios'))
      const lista = await json(await fetch(base + '/tus/v1/public/prestadores?oficio=plomeria'))
      const perfil = await json(await fetch(base + '/tus/v1/public/prestadores/' + carlos.perfil.id))
      const noExiste = (await fetch(base + '/tus/v1/public/prestadores/id-00000999')).status
      const interpretar = await json(await fetch(base + '/tus/v1/asistente/interpretar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Se me rompió el termotanque, es urgente' }) }))
      const candidatosAnon = (await fetch(base + '/tus/v1/asistente/candidatos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profession: 'plomeria' }) })).status
      const candidatos = await json(await fetch(base + '/tus/v1/asistente/candidatos', { method: 'POST', headers, body: JSON.stringify({ profession: 'plomeria', zone: 'Centro' }) }))
      const origenFalso = (await fetch(base + '/tus/v1/solicitudes', { method: 'POST', headers, body: JSON.stringify({ ...valida, providerId: carlos.perfil.id, origin: 'whatsapp' }) })).status
      const forjada = (await fetch(base + '/tus/v1/solicitudes', { method: 'POST', headers, body: JSON.stringify({ ...valida, providerId: carlos.perfil.id, prestadorTenantId: 't-otro' }) })).status
      const creada = await json(await fetch(base + '/tus/v1/solicitudes', { method: 'POST', headers, body: JSON.stringify({ ...valida, providerId: carlos.perfil.id, origin: 'web_directory' }) }))
      const foto = await json(await fetch(base + '/tus/v1/solicitudes/' + creada[1].id + '/imagenes', { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: png() }))
      const fotoAnon = (await fetch(base + '/tus/v1/solicitudes/' + creada[1].id + '/imagenes/1')).status
      const fotoPropia = await fetch(base + '/tus/v1/solicitudes/' + creada[1].id + '/imagenes/1', { headers })
      const fotoPublica = (await fetch(base + '/tus/v1/public/solicitudes/' + creada[1].id + '/imagenes/1')).status
      const perfilAnon = (await fetch(base + '/tus/v1/prestador/perfil-publico', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status
      const perfilCliente = (await fetch(base + '/tus/v1/prestador/perfil-publico', { method: 'PUT', headers, body: JSON.stringify({ displayName: 'X', tenantId: 't-carlos' }) })).status
      console.log(JSON.stringify({ oficios, lista, perfil, noExiste, interpretar, candidatosAnon, candidatos, origenFalso, forjada, creada, foto, fotoAnon, fotoPropia: [fotoPropia.status, fotoPropia.headers.get('content-type'), fotoPropia.headers.get('x-content-type-options'), fotoPropia.headers.get('cache-control')], fotoPublica, perfilAnon, perfilCliente }))
    } finally { server.close() }
  `)
  assert.equal(result.oficios[0], 200)
  assert.equal(result.oficios[1].items.length, 6)
  assert.ok(result.oficios[1].zones.includes('Camba Cuá'))
  assert.equal(result.lista[0], 200)
  assert.equal(result.lista[1].items.length, 1)
  assert.equal(result.perfil[1].displayName, 'Carlos Méndez')
  assert.doesNotMatch(JSON.stringify([result.lista, result.perfil]), /t-carlos|tenantId|prestadorId|merchant/)
  assert.equal(result.noExiste, 404)
  assert.equal(result.interpretar[1].category, 'plomeria')
  assert.equal(result.interpretar[1].urgency, 'urgente')
  assert.equal(result.candidatosAnon, 401)
  assert.equal(result.candidatos[1].items.length, 1)
  assert.equal(result.origenFalso, 422)
  assert.equal(result.forjada, 403)
  assert.equal(result.creada[0], 201)
  assert.equal(result.creada[1].assignment, 'pendiente')
  assert.equal(result.creada[1].origin, 'web_directory')
  assert.deepEqual(result.foto, [201, { images: 1 }])
  assert.equal(result.fotoAnon, 401)
  assert.deepEqual(result.fotoPropia, [200, 'image/png', 'nosniff', 'private, no-store'])
  assert.equal(result.fotoPublica, 404)
  assert.equal(result.perfilAnon, 401)
  assert.equal(result.perfilCliente, 403)
})

test('WHATSAPP uses the same directory and request services (no duplicated rules)', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const { DominioAsistenteTus } = await import('./apps/api/src/tus/asistente/dominio.ts')
    const { validarYEjecutar } = await import('./apps/api/src/tus/asistente/herramientas.ts')
    const carlos = await prestador('t-carlos', { displayName: 'Carlos Méndez', profession: 'plomeria', zone: 'Centro' }, { verified: true })
    const laura = await cliente('laura@example.com')
    const domain = new DominioAsistenteTus({}, clock, { directorio, solicitudes })
    const context = { tenantId: laura.tenantId, subjectId: laura.id, sessionId: 's', roles: [], permissions: ['tus:checkout'], correlationId: 'c' }
    const actor = { contactId: 'contact', conversationId: 'conv', context, isProvider: false }
    const anon = { ...actor, context: null }
    const run = (name, args, who = actor, confirmed) => validarYEjecutar({ name, rawArguments: JSON.stringify(args), actor: who, domain, allowed: new Set(['search_providers', 'request_provider']), timeoutMs: 2000, ...(confirmed ? { confirmed } : {}) })
    const busqueda = await run('search_providers', { query: 'pierde agua la bacha en el centro', profession: null, zone: null }, anon)
    const pedido = { providerId: carlos.perfil.id, title: 'Pierde agua la bacha', description: null, zone: 'Centro', urgency: 'hoy_manana', budgetMax: null }
    const sinVincular = await run('request_provider', pedido, anon)
    const sinConfirmar = await run('request_provider', pedido)
    const confirmado = await run('request_provider', pedido, actor, { idempotencyKey: 'k1' })
    const bandeja = await solicitudes.recibidas('t-carlos')
    console.log(JSON.stringify({ busqueda, sinVincular, sinConfirmar, confirmado, bandeja: bandeja.map((item) => [item.origin, item.assignment]) }))
  `)
  assert.equal(result.busqueda.ok, true)
  assert.equal(result.busqueda.data.profession, 'plomeria')
  assert.equal(result.busqueda.data.providers[0].name, 'Carlos Méndez')
  assert.deepEqual(Object.keys(result.busqueda.data.providers[0]).sort(), ['area', 'availability', 'completedJobs', 'distanceKm', 'name', 'profession', 'providerId', 'verified'])
  assert.equal(result.sinVincular.error, 'LINK_REQUIRED')
  assert.equal(result.sinConfirmar.confirmationRequired, true)
  assert.match(result.sinConfirmar.summary, /pendiente hasta que el prestador la acepte/)
  assert.equal(result.confirmado.data.request.assignment, 'pendiente')
  assert.deepEqual(result.bandeja, [['whatsapp', 'pendiente']])
})
