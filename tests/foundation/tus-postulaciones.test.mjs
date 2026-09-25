import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Postulaciones a solicitudes públicas: un prestador (de cualquier oficio) se ofrece para una
// solicitud del mapa y el cliente decide a quién acepta. Aceptar a uno la saca del mapa, la deja
// confirmada con ese prestador y rechaza al resto; nada se confirma antes de la decisión.
const root = join(import.meta.dirname, '..', '..')
const SETUP = `
  const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
  let now = Date.parse('2026-09-28T13:00:00.000Z')
  const clock = () => now
  let seq = 0
  const newId = () => 'id-' + String(++seq).padStart(8, '0')
  const merchants = new Map()
  const application = {
    marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null }, listings: { forTenant: async () => [] } } },
    identity: { identidadVerificada: async () => false },
  }
  const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, now: clock, newId })
  const auth = createInMemoryAuthService({ now: clock })
  const solicitudes = crearServicioSolicitudes({ cuentas: auth.store, destinos: directorio, now: clock, newId })
  const ctx = (tenantId, permissions = ['tus:marketplace:write', 'tus:marketplace:read']) => ({ tenantId, subjectId: 'actor-' + tenantId, sessionId: 's', roles: ['merchant'], permissions, correlationId: 'c' })
  const actor = (tenantId) => ({ tenantId, cuentaId: 'actor-' + tenantId })
  async function prestador(tenantId, perfil, opts = {}) {
    merchants.set(tenantId, { merchantId: 'm-' + tenantId, status: opts.status ?? 'approved' })
    return directorio.guardarPerfil(ctx(tenantId), { zone: 'Centro', ...perfil })
  }
  async function cliente(email, displayName = 'Laura Martínez') {
    const registered = await auth.register({ email, password: 'Contrasena-Segura-2026', displayName })
    await auth.verifyEmail({ token: registered.verificationToken })
    return registered.account
  }
  const valida = { category: 'plomeria', title: 'Pierde agua la canilla de la cocina', description: 'Gotea todo el día.', zone: 'Camba Cuá', budgetMax: 25000, urgency: 'hoy_manana' }
`

test('POSTULACIONES: any approved provider applies (any trade); the client decides; accepting confirms one and rejects the rest', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await prestador('t-carlos', { displayName: 'Carlos Méndez', profession: 'plomeria' })
    // Ana es electricista: igual puede ofrecerse para una solicitud de plomería.
    await prestador('t-ana', { displayName: 'Ana Gómez', profession: 'electricidad', zone: 'La Rosada' })
    await prestador('t-pepe', { displayName: 'Pepe Ruiz', profession: 'pintura' })
    await prestador('t-pendiente', { displayName: 'No Aprobado', profession: 'plomeria' }, { status: 'pending' })
    const laura = await cliente('laura@example.com')
    const publicada = await solicitudes.publicar(laura.id, valida)
    const id = publicada.solicitud.id

    const carlos = await solicitudes.postular(actor('t-carlos'), id, { message: 'Puedo ir hoy a la tarde.' })
    const ana = await solicitudes.postular(actor('t-ana'), id, {})
    const pepe = await solicitudes.postular(actor('t-pepe'), id, { message: '  ' })
    const repetida = await solicitudes.postular(actor('t-carlos'), id, {})
    const noAprobado = await solicitudes.postular(actor('t-pendiente'), id, {})
    const sinPerfil = await solicitudes.postular(actor('t-nadie'), id, {})
    const conContacto = await solicitudes.postular(actor('t-pepe'), id, { message: 'Llamame al 3794 123456' })
    const propia = await solicitudes.postular({ tenantId: laura.tenantId, cuentaId: laura.id }, id, {})
    const inexistente = await solicitudes.postular(actor('t-carlos'), 'id-99999999', {})

    // Postularse no confirma nada: sigue pública y en el mapa.
    const publicasAntes = (await solicitudes.listarPublicas()).map((item) => item.id)
    const postulantes = await solicitudes.postulantes(laura.id, id)
    const ajena = await solicitudes.postulantes('otra-cuenta', id)
    const rechazaPepe = await solicitudes.rechazarPostulante(laura.id, id, pepe.postulacion.id)
    const retiraRepetido = await solicitudes.retirarPostulacion('t-ana', carlos.postulacion.id)

    // El cliente elige a Ana (otro oficio).
    const eligeAjena = await solicitudes.elegirPostulante('otra-cuenta', id, ana.postulacion.id)
    const elige = await solicitudes.elegirPostulante(laura.id, id, ana.postulacion.id)
    const eligeOtraVez = await solicitudes.elegirPostulante(laura.id, id, carlos.postulacion.id)
    const tarde = await solicitudes.postular(actor('t-pepe'), id, {})
    const publicasDespues = (await solicitudes.listarPublicas()).map((item) => item.id)
    const bandejaAna = await solicitudes.recibidas('t-ana')
    const bandejaCarlos = await solicitudes.recibidas('t-carlos')
    const deCarlos = await solicitudes.misPostulaciones('t-carlos')
    const deAna = await solicitudes.misPostulaciones('t-ana')
    const final = await solicitudes.postulantes(laura.id, id)
    const mias = await solicitudes.mias(laura.id)
    console.log(JSON.stringify({ publicada, carlos, ana, pepe, repetida, noAprobado, sinPerfil, conContacto, propia, inexistente, publicasAntes, postulantes, ajena, rechazaPepe, retiraRepetido, eligeAjena, elige, eligeOtraVez, tarde, publicasDespues, bandejaAna, bandejaCarlos, deCarlos, deAna, final, mias }))
  `)
  const id = result.publicada.solicitud.id
  assert.equal(result.carlos.ok, true)
  assert.equal(result.carlos.postulacion.status, 'pendiente')
  assert.equal(result.carlos.postulacion.message, 'Puedo ir hoy a la tarde.')
  assert.equal(result.carlos.postulacion.request.id, id)
  assert.equal(result.ana.ok, true, 'a provider of another trade can apply')
  assert.equal(result.pepe.postulacion.message, null)
  assert.equal(result.repetida.code, 'ALREADY_APPLIED')
  assert.equal(result.noAprobado.code, 'PROVIDER_NOT_AVAILABLE')
  assert.equal(result.sinPerfil.code, 'PROVIDER_NOT_AVAILABLE')
  assert.deepEqual([result.conContacto.code, result.conContacto.fields], ['INVALID_REQUEST', ['message']])
  assert.equal(result.propia.code, 'SELF_REQUEST')
  assert.equal(result.inexistente.code, 'NOT_FOUND')

  assert.ok(result.publicasAntes.includes(id), 'applying confirms nothing')
  assert.equal(result.postulantes.items.length, 3)
  assert.deepEqual(result.postulantes.items.map((item) => item.provider.displayName), ['Carlos Méndez', 'Ana Gómez', 'Pepe Ruiz'])
  assert.deepEqual(result.postulantes.items[1].provider, { id: result.postulantes.items[1].provider.id, displayName: 'Ana Gómez', profession: 'electricidad', approximateArea: 'La Rosada' })
  assert.doesNotMatch(JSON.stringify(result.postulantes), /t-ana|t-carlos|tenantId|prestadorId|merchant/)
  assert.equal(result.ajena.code, 'NOT_FOUND')
  assert.equal(result.rechazaPepe.ok, true)
  assert.equal(result.retiraRepetido.code, 'NOT_FOUND', 'only the owner of an application can withdraw it')

  assert.equal(result.eligeAjena.code, 'NOT_FOUND')
  assert.equal(result.elige.ok, true)
  assert.equal(result.elige.solicitud.assignment, 'aceptada')
  assert.equal(result.elige.solicitud.provider.displayName, 'Ana Gómez')
  assert.equal(result.eligeOtraVez.code, 'NOT_FOUND', 'only one provider can be accepted')
  assert.equal(result.tarde.code, 'NOT_FOUND')
  assert.ok(!result.publicasDespues.includes(id), 'an accepted request leaves the public map')
  assert.deepEqual(result.bandejaAna.map((item) => [item.id, item.assignment]), [[id, 'aceptada']])
  assert.equal(result.bandejaCarlos.length, 0)
  assert.deepEqual(result.deCarlos.map((item) => [item.status, item.request.open]), [['rechazada', true]])
  assert.deepEqual(result.deAna.map((item) => item.status), ['aceptada'])
  assert.deepEqual(result.final.items.map((item) => item.status), ['rechazada', 'aceptada', 'rechazada'])
  assert.equal(result.mias[0].assignment, 'aceptada')
})

test('POSTULACIONES: withdrawing and closing the request answer every pending applicant', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await prestador('t-carlos', { displayName: 'Carlos Méndez', profession: 'plomeria' })
    await prestador('t-ana', { displayName: 'Ana Gómez', profession: 'electricidad' })
    const laura = await cliente('laura@example.com')
    const { solicitud } = await solicitudes.publicar(laura.id, valida)
    const carlos = await solicitudes.postular(actor('t-carlos'), solicitud.id, {})
    const ana = await solicitudes.postular(actor('t-ana'), solicitud.id, {})
    const retira = await solicitudes.retirarPostulacion('t-carlos', carlos.postulacion.id)
    const eligeRetirado = await solicitudes.elegirPostulante(laura.id, solicitud.id, carlos.postulacion.id)
    const visibles = (await solicitudes.postulantes(laura.id, solicitud.id)).items.map((item) => item.provider.displayName)
    const cierra = await solicitudes.cerrar(laura.id, solicitud.id)
    const anaDespues = (await solicitudes.misPostulaciones('t-ana')).map((item) => [item.status, item.request.open])
    const eligeCerrada = await solicitudes.elegirPostulante(laura.id, solicitud.id, ana.postulacion.id)
    console.log(JSON.stringify({ retira, eligeRetirado, visibles, cierra, anaDespues, eligeCerrada }))
  `)
  assert.equal(result.retira.ok, true)
  assert.equal(result.eligeRetirado.code, 'NOT_FOUND')
  assert.deepEqual(result.visibles, ['Ana Gómez'], 'withdrawn applications are not shown to the client')
  assert.equal(result.cierra.ok, true)
  assert.deepEqual(result.anaDespues, [['rechazada', false]])
  assert.equal(result.eligeCerrada.code, 'NOT_FOUND')
})

test('POSTULACIONES HTTP: provider routes need the provider permission; client routes only for the owner', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { crearRouterSolicitudes } = await import('./apps/api/src/tus/solicitudes/http.ts')
    await prestador('t-ana', { displayName: 'Ana Gómez', profession: 'electricidad' })
    const laura = await cliente('laura@example.com')
    const { solicitud } = await solicitudes.publicar(laura.id, valida)
    // Sesiones de prueba: el token decide el contexto (tenant, sujeto y permisos).
    const contextos = new Map([
      ['tok-ana', ctx('t-ana')],
      ['tok-lectora', ctx('t-lectora', ['tus:marketplace:read'])],
      ['tok-laura', { ...ctx(laura.tenantId), subjectId: laura.id }],
      ['tok-otra', { ...ctx('t-otra'), subjectId: 'otra-cuenta' }],
    ])
    const sessions = { resolve: async (token) => contextos.get(token) ?? null }
    const app = express(); app.use(express.json())
    app.use(crearRouterSolicitudes({ servicio: solicitudes, sessions }))
    const server = app.listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const h = (token) => ({ 'content-type': 'application/json', authorization: 'Bearer ' + token, 'x-correlation-id': 'corr-1' })
    const post = (path, token, body = {}) => fetch(base + path, { method: 'POST', headers: token ? h(token) : { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const json = async (res) => [res.status, await res.json()]
    try {
      const anon = (await post('/tus/v1/prestador/solicitudes/' + solicitud.id + '/postular', null)).status
      const lectora = (await post('/tus/v1/prestador/solicitudes/' + solicitud.id + '/postular', 'tok-lectora')).status
      const forjada = (await post('/tus/v1/prestador/solicitudes/' + solicitud.id + '/postular', 'tok-ana', { prestadorTenantId: 't-otro' })).status
      const postula = await json(await post('/tus/v1/prestador/solicitudes/' + solicitud.id + '/postular', 'tok-ana', { message: 'Voy mañana.' }))
      const repite = await json(await post('/tus/v1/prestador/solicitudes/' + solicitud.id + '/postular', 'tok-ana'))
      const mis = await json(await fetch(base + '/tus/v1/prestador/postulaciones', { headers: h('tok-ana') }))
      const ajena = (await fetch(base + '/tus/v1/solicitudes/' + solicitud.id + '/postulaciones', { headers: h('tok-otra') })).status
      const lista = await json(await fetch(base + '/tus/v1/solicitudes/' + solicitud.id + '/postulaciones', { headers: h('tok-laura') }))
      const eligeAjena = (await post('/tus/v1/solicitudes/' + solicitud.id + '/postulaciones/' + postula[1].id + '/aceptar', 'tok-otra')).status
      const elige = await json(await post('/tus/v1/solicitudes/' + solicitud.id + '/postulaciones/' + postula[1].id + '/aceptar', 'tok-laura'))
      const otraVez = (await post('/tus/v1/solicitudes/' + solicitud.id + '/postulaciones/' + postula[1].id + '/aceptar', 'tok-laura')).status
      console.log(JSON.stringify({ anon, lectora, forjada, postula, repite, mis, ajena, lista, eligeAjena, elige, otraVez }))
    } finally { server.close() }
  `)
  assert.equal(result.anon, 401)
  assert.equal(result.lectora, 403)
  assert.equal(result.forjada, 403)
  assert.equal(result.postula[0], 201)
  assert.equal(result.postula[1].status, 'pendiente')
  assert.deepEqual([result.repite[0], result.repite[1].code], [409, 'ALREADY_APPLIED'])
  assert.equal(result.mis[1].items.length, 1)
  assert.equal(result.ajena, 404)
  assert.equal(result.lista[0], 200)
  assert.equal(result.lista[1].items[0].provider.displayName, 'Ana Gómez')
  assert.doesNotMatch(JSON.stringify(result.lista), /t-ana|tenantId|prestadorId/)
  assert.equal(result.eligeAjena, 409)
  assert.equal(result.elige[0], 200)
  assert.equal(result.elige[1].assignment, 'aceptada')
  assert.equal(result.otraVez, 409)
})

test('POSTULACIONES migration: additive, one application per provider, a single accepted applicant', () => {
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20261002100000_tus_postulaciones_solicitud/migration.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE public\."postulaciones_solicitud"/)
  assert.match(migration, /UNIQUE INDEX "uq_postulaciones_solicitud_prestador" ON public\."postulaciones_solicitud"\("solicitud_id", "prestador_tenant_id"\)/)
  assert.match(migration, /UNIQUE INDEX "uq_postulaciones_solicitud_aceptada"[^;]*WHERE "estado" = 'aceptada'/)
  assert.match(migration, /ON DELETE RESTRICT/)
  assert.doesNotMatch(migration, /\bDROP\b|\bCASCADE\b|ALTER TABLE/)
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  assert.match(schema, /model PostulacionSolicitud \{[\s\S]*@@map\("postulaciones_solicitud"\)/)
})

test('POSTULACIONES Web: provider applies from the open list, client accepts or rejects in Mis solicitudes', () => {
  const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
  const source = `(async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.tusservicios.shop'
    const dir = await import('./apps/web/src/features/directory/directory-client.ts')
    const req = await import('./apps/web/src/features/requests/requests-client.ts')
    const { createDirectoryClient } = dir.default ?? dir
    const { createRequestsClient, requestStatusLabel } = req.default ?? req
    const calls = []
    const ok = (body) => async (url, init = {}) => { calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null, body: init.body ?? null }); return { ok: true, status: 200, json: async () => body } }
    const session = { accessToken: 'tok', correlationId: 'corr' }
    await createDirectoryClient(ok({})).apply(session, 'sol-1', 'Voy mañana')
    await createDirectoryClient(ok({})).apply(session, 'sol-1', '   ')
    await createDirectoryClient(ok({ items: [] })).myApplications(session)
    await createDirectoryClient(ok({})).withdraw(session, 'pos-1')
    await createRequestsClient(session, ok({ items: [] })).applicants('sol-1')
    await createRequestsClient(session, ok({ id: 'sol-1' })).chooseApplicant('sol-1', 'pos-2')
    await createRequestsClient(session, ok({})).declineApplicant('sol-1', 'pos-3')
    const confirmado = requestStatusLabel({ status: 'abierta', provider: { id: 'p', displayName: 'Ana G.' }, assignment: 'aceptada' })
    console.log(JSON.stringify({ calls, confirmado }))
  })()`
  const result = JSON.parse(execFileSync(process.execPath, [tsxCli, '--eval', source], { cwd: root, encoding: 'utf8' }).trim())
  const api = 'https://api.tusservicios.shop/tus/v1'
  assert.deepEqual(result.calls.map((call) => [call.method, call.url.replace(api, '')]), [
    ['POST', '/prestador/solicitudes/sol-1/postular'],
    ['POST', '/prestador/solicitudes/sol-1/postular'],
    ['GET', '/prestador/postulaciones'],
    ['POST', '/prestador/postulaciones/pos-1/retirar'],
    ['GET', '/solicitudes/sol-1/postulaciones'],
    ['POST', '/solicitudes/sol-1/postulaciones/pos-2/aceptar'],
    ['POST', '/solicitudes/sol-1/postulaciones/pos-3/rechazar'],
  ])
  assert.ok(result.calls.every((call) => call.auth === 'Bearer tok'))
  assert.equal(result.calls[0].body, JSON.stringify({ message: 'Voy mañana' }))
  assert.equal(result.calls[1].body, '{}', 'an empty message is not sent')
  assert.equal(result.confirmado, 'Confirmado con Ana G.')
  const page = readFileSync(join(root, 'apps/web/src/app/prestador/solicitudes/page.tsx'), 'utf8')
  assert.match(page, /ProviderOpenRequests/)
  const mine = readFileSync(join(root, 'apps/web/src/features/requests/my-requests.tsx'), 'utf8')
  assert.match(mine, /chooseApplicant/)
  assert.match(mine, /declineApplicant/)
  for (const file of ['features/home/request-map.tsx', 'features/home/recent-requests.tsx'])
    assert.match(readFileSync(join(root, 'apps/web/src', file), 'utf8'), /href="\/prestador\/solicitudes#abiertas"/, file)
})
