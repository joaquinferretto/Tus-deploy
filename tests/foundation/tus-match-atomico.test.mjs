import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// The match (client picks ONE application, or the provider accepts a direct request) assigns the
// request AND creates its work atomically. Before the match the owner can cancel the request;
// after it, the request is bound to the work (WORK_ACTIVE).
const SETUP = `
  const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const { crearServicioSolicitudes, creadorTrabajoEnMemoria } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
  const { AlmacenSolicitudesEnMemoria } = await import('./apps/api/src/tus/solicitudes/almacenes.ts')
  const { ServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/servicio.ts')
  const { InMemoryTrabajoStore, InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoTransaction, ServicioTrabajo } = await import('./apps/api/src/tus/work/index.ts')
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
  const workStore = new InMemoryTrabajoStore()
  const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: workStore, idempotency: new InMemoryTrabajoIdempotencyStore(), outbox: new InMemoryTrabajoOutboxStore() }), clock)
  const solicitudes = crearServicioSolicitudes({ cuentas: auth.store, destinos: directorio, trabajos: work, now: clock, newId })
  const ctx = (tenantId) => ({ tenantId, subjectId: 'actor-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'c' })
  const actor = (tenantId) => ({ tenantId, cuentaId: 'actor-' + tenantId })
  async function prestador(tenantId, perfil) {
    merchants.set(tenantId, { merchantId: 'm-' + tenantId, status: 'approved' })
    return directorio.guardarPerfil(ctx(tenantId), { zone: 'Centro', ...perfil })
  }
  async function cliente(email, displayName = 'Laura Martinez') {
    const registered = await auth.register({ email, password: 'Contrasena-Segura-2026', displayName })
    await auth.verifyEmail({ token: registered.verificationToken })
    return registered.account
  }
  const valida = { category: 'plomeria', title: 'Pierde agua la canilla de la cocina', description: 'Gotea todo el dia.', zone: 'Camba Cuá', budgetMax: 25000, urgency: 'hoy_manana' }
  const worksOf = async (tenantId) => (await work.listWorks({ tenantId, actorId: 'x', correlationId: 'c' })).map((item) => item.trabajoId)
`

test('MATCH: accepting one application creates exactly one work, visible only to the client and the chosen provider', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await prestador('t-b', { displayName: 'Bruno Plomero', profession: 'plomeria' })
    await prestador('t-c', { displayName: 'Carla Plomera', profession: 'plomeria' })
    const laura = await cliente('laura@example.com')
    const { solicitud } = await solicitudes.publicar(laura.id, valida)
    const b = await solicitudes.postular(actor('t-b'), solicitud.id, { message: 'Voy hoy.' })
    const c = await solicitudes.postular(actor('t-c'), solicitud.id, {})
    const elige = await solicitudes.elegirPostulante(laura.id, solicitud.id, b.postulacion.id)
    const reintento = await solicitudes.elegirPostulante(laura.id, solicitud.id, b.postulacion.id)
    const otro = await solicitudes.elegirPostulante(laura.id, solicitud.id, c.postulacion.id)
    const postulaciones = (await solicitudes.postulantes(laura.id, solicitud.id)).items.map((item) => [item.provider.displayName, item.status])
    const mias = await solicitudes.mias(laura.id)
    const deB = await solicitudes.misPostulaciones('t-b')
    const deC = await solicitudes.misPostulaciones('t-c')
    const detalle = await work.getWork({ tenantId: laura.tenantId, actorId: laura.id, correlationId: 'c' }, elige.workId)
    const cVe = await (async () => { try { await work.getWork({ tenantId: 't-c', actorId: 'x', correlationId: 'c' }, elige.workId); return 'visible' } catch (error) { return error.code } })()
    console.log(JSON.stringify({
      elige: { ok: elige.ok, workId: elige.workId, replay: elige.replay, assignment: elige.solicitud.assignment, viewWork: elige.solicitud.workId },
      reintento: { ok: reintento.ok, workId: reintento.workId, replay: reintento.replay },
      otro: otro.code, postulaciones,
      mia: { workId: mias[0].workId, assignment: mias[0].assignment },
      deB: deB[0].request.workId, deC: deC[0].request.workId,
      works: { laura: await worksOf(laura.tenantId), b: await worksOf('t-b'), c: await worksOf('t-c') },
      detalle: { origin: detalle.work.origin, solicitudId: detalle.work.solicitudId, prestadorTenantId: detalle.work.prestadorTenantId, tenantId: detalle.work.tenantId === laura.tenantId, status: detalle.work.status },
      cVe,
    }))
  `)
  assert.equal(result.elige.ok, true)
  assert.match(result.elige.workId, /^trabajo-solicitud-/u)
  assert.equal(result.elige.replay, false)
  assert.equal(result.elige.assignment, 'aceptada')
  assert.equal(result.elige.viewWork, result.elige.workId)
  assert.deepEqual(result.reintento, { ok: true, workId: result.elige.workId, replay: true }, 'double click / retry returns the same work')
  assert.equal(result.otro, 'NOT_FOUND', 'a second provider can never be accepted')
  assert.deepEqual(result.postulaciones, [['Bruno Plomero', 'aceptada'], ['Carla Plomera', 'rechazada']])
  assert.deepEqual(result.mia, { workId: result.elige.workId, assignment: 'aceptada' })
  assert.equal(result.deB, result.elige.workId, 'the chosen provider sees the work')
  assert.equal(result.deC, null, 'the rejected provider never gets the work id')
  assert.deepEqual(result.works, { laura: [result.elige.workId], b: [result.elige.workId], c: [] })
  assert.deepEqual(result.detalle, { origin: 'solicitud', solicitudId: result.detalle.solicitudId, prestadorTenantId: 't-b', tenantId: true, status: 'requested' })
  assert.notEqual(result.cVe, 'visible')
})

test('MATCH: a provider accepting a direct request also creates the work; rejecting does not', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const perfil = await prestador('t-b', { displayName: 'Bruno Plomero', profession: 'plomeria' })
    const laura = await cliente('laura@example.com')
    const dirigida = await solicitudes.publicar(laura.id, { ...valida, providerId: perfil.perfil.id })
    const otra = await solicitudes.publicar(laura.id, { ...valida, title: 'Otra perdida en el bano', providerId: perfil.perfil.id })
    const acepta = await solicitudes.responder('t-b', dirigida.solicitud.id, 'aceptada', { actorId: 'actor-t-b', correlationId: 'c' })
    const rechaza = await solicitudes.responder('t-b', otra.solicitud.id, 'rechazada', { actorId: 'actor-t-b', correlationId: 'c' })
    const cancelarAceptada = await solicitudes.cancelar(laura.id, dirigida.solicitud.id)
    console.log(JSON.stringify({ acepta: { ok: acepta.ok, workId: acepta.solicitud.workId }, rechaza: { ok: rechaza.ok, workId: rechaza.solicitud.workId }, works: await worksOf('t-b'), cancelarAceptada: cancelarAceptada.code }))
  `)
  assert.equal(result.acepta.ok, true)
  assert.match(result.acepta.workId, /^trabajo-solicitud-/u)
  assert.equal(result.rechaza.workId, null)
  assert.deepEqual(result.works, [result.acepta.workId])
  assert.equal(result.cancelarAceptada, 'WORK_ACTIVE')
})

test('CANCEL: the owner cancels an open request before choosing; it leaves the map, rejects pending applications and records who/when', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await prestador('t-b', { displayName: 'Bruno Plomero', profession: 'plomeria' })
    const perfilC = await prestador('t-c', { displayName: 'Carla Plomera', profession: 'plomeria' })
    const laura = await cliente('laura@example.com')
    const otra = await cliente('otra@example.com', 'Otra Persona')
    const { solicitud } = await solicitudes.publicar(laura.id, valida)
    const b = await solicitudes.postular(actor('t-b'), solicitud.id, {})
    const ajena = await solicitudes.cancelar(otra.id, solicitud.id)
    now += 60_000
    const cancela = await solicitudes.cancelar(laura.id, solicitud.id)
    const deNuevo = await solicitudes.cancelar(laura.id, solicitud.id)
    const publica = (await solicitudes.listarPublicas()).some((item) => item.id === solicitud.id)
    const postulaTarde = await solicitudes.postular(actor('t-c'), solicitud.id, {})
    const eligeTarde = await solicitudes.elegirPostulante(laura.id, solicitud.id, b.postulacion.id)
    const mia = (await solicitudes.mias(laura.id))[0]
    const deB = (await solicitudes.misPostulaciones('t-b'))[0]
    // A direct request still pending is cancellable too (assignment -> cancelada).
    const dirigida = await solicitudes.publicar(laura.id, { ...valida, title: 'Arreglo del termotanque roto', providerId: perfilC.perfil.id })
    const cancelaDirigida = await solicitudes.cancelar(laura.id, dirigida.solicitud.id)
    const bandejaC = (await solicitudes.recibidas('t-c')).find((item) => item.id === dirigida.solicitud.id)
    const aceptaTarde = await solicitudes.responder('t-c', dirigida.solicitud.id, 'aceptada', { actorId: 'x', correlationId: 'c' })
    console.log(JSON.stringify({ ajena: ajena.code, cancela: cancela.ok, deNuevo: deNuevo.code, publica, postulaTarde: postulaTarde.code, eligeTarde: eligeTarde.code, mia: { status: mia.status, cancelledAt: mia.cancelledAt, workId: mia.workId }, deB: deB.status, cancelaDirigida: cancelaDirigida.ok, bandejaC: bandejaC.assignment, aceptaTarde: aceptaTarde.code, works: await worksOf(laura.tenantId) }))
  `)
  assert.equal(result.ajena, 'NOT_FOUND', 'only the owner cancels')
  assert.equal(result.cancela, true)
  assert.equal(result.deNuevo, 'ALREADY_CLOSED')
  assert.equal(result.publica, false, 'a cancelled request leaves the public map')
  assert.equal(result.postulaTarde, 'NOT_FOUND', 'no applications after cancelling')
  assert.equal(result.eligeTarde, 'NOT_FOUND')
  assert.deepEqual(result.mia, { status: 'cerrada', cancelledAt: '2026-09-28T13:01:00.000Z', workId: null })
  assert.equal(result.deB, 'rechazada', 'pending applications are answered')
  assert.equal(result.cancelaDirigida, true)
  assert.equal(result.bandejaC, 'cancelada')
  assert.equal(result.aceptaTarde, 'NOT_FOUND')
  assert.deepEqual(result.works, [])
})

test('ATOMIC: if the work cannot be created the acceptance is fully rolled back', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await prestador('t-b', { displayName: 'Bruno Plomero', profession: 'plomeria' })
    await prestador('t-c', { displayName: 'Carla Plomera', profession: 'plomeria' })
    const laura = await cliente('laura@example.com')
    const falla = { crear: async () => { throw Object.assign(new Error('boom'), { code: 'BOOM' }) } }
    const almacen = new AlmacenSolicitudesEnMemoria(falla)
    const conFalla = new ServicioSolicitudes({ almacen, cuentas: auth.store, destinos: directorio, now: clock, newId })
    const { solicitud } = await conFalla.publicar(laura.id, valida)
    const b = await conFalla.postular(actor('t-b'), solicitud.id, {})
    const c = await conFalla.postular(actor('t-c'), solicitud.id, {})
    const error = await conFalla.elegirPostulante(laura.id, solicitud.id, b.postulacion.id).then(() => 'none', (e) => e.code)
    const despues = await almacen.obtener(solicitud.id)
    const estados = (await almacen.postulacionesDe(solicitud.id)).map((item) => item.estado)
    const publica = (await conFalla.listarPublicas()).some((item) => item.id === solicitud.id)
    console.log(JSON.stringify({ error, visibilidad: despues.visibilidad, prestador: despues.prestadorTenantId, asignacion: despues.estadoAsignacion, trabajo: despues.trabajoId, estados, publica }))
  `)
  assert.equal(result.error, 'BOOM')
  assert.deepEqual({ visibilidad: result.visibilidad, prestador: result.prestador, asignacion: result.asignacion, trabajo: result.trabajo }, { visibilidad: 'publica', prestador: null, asignacion: null, trabajo: null })
  assert.deepEqual(result.estados, ['pendiente', 'pendiente'])
  assert.equal(result.publica, true)
})

test('HTTP: accept returns workId; cancel / close after the match answers 409 WORK_ACTIVE', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const { createRequire } = await import('node:module')
    const express = createRequire(process.cwd() + '/apps/api/package.json')('express')
    const { crearRouterSolicitudes } = await import('./apps/api/src/tus/solicitudes/http.ts')
    await prestador('t-b', { displayName: 'Bruno Plomero', profession: 'plomeria' })
    const laura = await cliente('laura@example.com')
    const sessions = { resolve: async (token) => token === 'tok-laura' ? { tenantId: laura.tenantId, subjectId: laura.id, sessionId: 's', roles: ['owner'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'corr-http' } : null }
    const app = express(); app.use(express.json()); app.use(crearRouterSolicitudes({ servicio: solicitudes, sessions }))
    const server = app.listen(0); await new Promise((r) => server.once('listening', r))
    const base = 'http://127.0.0.1:' + server.address().port
    const headers = { authorization: 'Bearer tok-laura', 'x-correlation-id': 'corr-http', 'content-type': 'application/json' }
    const { solicitud } = await solicitudes.publicar(laura.id, valida)
    const b = await solicitudes.postular(actor('t-b'), solicitud.id, {})
    const accept = await fetch(base + '/tus/v1/solicitudes/' + solicitud.id + '/postulaciones/' + b.postulacion.id + '/aceptar', { method: 'POST', headers })
    const acceptBody = await accept.json()
    const cancel = await fetch(base + '/tus/v1/solicitudes/' + solicitud.id + '/cancelar', { method: 'POST', headers })
    const close = await fetch(base + '/tus/v1/solicitudes/' + solicitud.id + '/cerrar', { method: 'POST', headers })
    const otra = await solicitudes.publicar(laura.id, { ...valida, title: 'Se tapo la pileta de la cocina' })
    const cancelOpen = await fetch(base + '/tus/v1/solicitudes/' + otra.solicitud.id + '/cancelar', { method: 'POST', headers })
    server.close()
    console.log(JSON.stringify({ accept: [accept.status, acceptBody.workId, acceptBody.replay], cancel: [cancel.status, (await cancel.json()).code], close: [close.status, (await close.json()).code], cancelOpen: [cancelOpen.status, (await cancelOpen.json()).status] }))
  `)
  assert.equal(result.accept[0], 200)
  assert.match(result.accept[1], /^trabajo-solicitud-/u)
  assert.equal(result.accept[2], false)
  assert.deepEqual(result.cancel, [409, 'WORK_ACTIVE'])
  assert.deepEqual(result.close, [409, 'WORK_ACTIVE'], 'the old close route cannot be used to escape the work')
  assert.deepEqual(result.cancelOpen, [200, 'cancelada'])
})

test('CANCEL migration is additive and accepted by the migration gate', async () => {
  const { reviewMigrationChain } = await import('../../scripts/tus-migration-repair-lib.mjs')
  const { readFile } = await import('node:fs/promises')
  const review = await reviewMigrationChain({ names: ['20261010100000_tus_solicitud_cancelacion'] })
  assert.equal(review.accepted, true)
  const sql = await readFile(new URL('../../apps/api/prisma/migrations/20261010100000_tus_solicitud_cancelacion/migration.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /^\s*(DELETE\s+FROM|TRUNCATE|DROP\b)/imu)
  assert.match(sql, /"ck_solicitudes_servicio_cancelacion"/u)
})
