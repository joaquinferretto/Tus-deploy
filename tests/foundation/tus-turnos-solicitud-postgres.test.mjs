import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const require = createRequire(import.meta.url)
const { Client } = require('../../apps/api/node_modules/pg')
const root = join(import.meta.dirname, '..', '..')

// TURNOS-SOLICITUD-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database. Real Prisma, real
// constraints, real HTTP router: a client REQUESTS a turno (pending); only its provider confirms.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
  const { crearRouterTurnos } = await import('./apps/api/src/tus/calendar/turnos-http.ts')
  const c = await import('./packages/contracts/src/tus-turnos.ts')
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const run = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const auth = createPrismaAuthService(prisma)
  // Outbound notices are recorded: who was told what, and how many times.
  const avisos = []
  const turnos = new ServicioTurnos(prisma, {
    solicitudRecibida: async (aviso) => { avisos.push(['recibida', aviso.reservaId, aviso.prestadorTenantId, aviso.clienteNombre, aviso.servicio, aviso.duracionMinutos, aviso.inicio.toISOString()]) },
    solicitudRespondida: async (aviso) => { avisos.push(['respondida', aviso.reservaId, aviso.clienteCuentaId, aviso.resultado]) },
  })
  const [oficio] = await prisma.oficioServicio.findMany({ where: { activo: true }, orderBy: { orden: 'asc' }, take: 1 })
  async function cuenta(tag, nombre) {
    const outcome = await auth.service.registerAccount({ email: run + '-' + tag + '@example.com', password: 'una frase larga y segura 2026', displayName: nombre })
    return outcome.created.account
  }
  async function prestador(tag, nombre) {
    const tenantId = run + '-tenant-' + tag
    const prestadorId = run + '-prestador-' + tag
    const ahora = new Date()
    await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: nombre, status: 'active', createdAt: ahora, updatedAt: ahora } })
    await prisma.prestador.create({ data: { id: run + '-p-' + tag, tenantId, prestadorId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
    const perfil = await prisma.perfilPublicoPrestador.create({
      data: { id: run + '-perfil-' + tag, tenantId, prestadorId, nombrePublico: nombre, oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } },
    })
    return { tenantId, prestadorId, perfilId: perfil.id }
  }
  // Monday of NEXT week in Argentina time (default agenda: Monday to Friday, 9 to 18).
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const lunes = c.sumarDias(c.lunesDe(hoy), 7)
  const a = (indice, hora) => new Date(c.sumarDias(lunes, indice) + 'T' + hora + ':00.000-03:00').toISOString()
  const dbCode = (e) => e?.code ?? (String(e?.message ?? e).match(/(P2002|P2003|23505|23514|23P01)/u)?.[1] ?? String(e?.message ?? e).slice(0, 80))
  const app = express()
  app.use(express.json())
  const sesiones = {}
  const sesion = (token, subjectId, tenantId) => { sesiones[token] = { subjectId, sessionId: 's', tenantId, roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c' } }
  app.use(crearRouterTurnos({ servicio: turnos, sessions: { resolve: async (token) => sesiones[token] ?? null } }))
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const call = async (method, path, token, body) => {
    const response = await fetch('http://127.0.0.1:' + servidor.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const cerrar = async () => { await new Promise((resolve) => servidor.close(resolve)); await prisma.$disconnect() }
  const p = await prestador('ana', 'Paula Prestadora ' + run)
  const p2 = await prestador('otro', 'Otro Prestador ' + run)
  const ana = await cuenta('ana', 'Ana Cuenta')
  const beto = await cuenta('beto', 'Beto Cuenta')
  // The personal profile of the account is what TUS shows: nobody types a name in the form.
  await prisma.user.update({ where: { email: run + '-ana@example.com' }, data: { firstName: 'Ana María', lastName: 'Cliente' } })
  sesion('tok-ana', ana.id, ana.tenantId); sesion('tok-beto', beto.id, beto.tenantId)
  sesion('tok-p', 'u-' + p.tenantId, p.tenantId); sesion('tok-p2', 'u-' + p2.tenantId, p2.tenantId)
  const solicitar = (token, indice, hora, extra = {}) => call('POST', '/tus/v1/prestadores/' + p.perfilId + '/turnos/solicitudes', token, { oficioId: oficio.id, inicio: a(indice, hora), ...extra })
  const fila = (id) => prisma.reserva.findUnique({ where: { id } })
  const agendaDe = async (indice, hora) => (await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: lunes })).dias[indice].franjas.find((f) => f.hora === hora)?.estado
  const pendientes = async (token) => { const r = await call('GET', '/tus/v1/prestador/turnos/solicitudes', token); return r.body }
`

test('TURNOS solicitud PostgreSQL: a visitor cannot request; a signed-in client requests as the account of the session (no identity from the body, no copy of name/phone/email); the request is pending and holds its time; the provider is notified, sees it and accepts or rejects; with nothing to pay (no deposit service composed) accepting confirms', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // 13. A visitor: nobody to request for.
      const visitante = await solicitar(null, 0, '10:00')
      out.visitante = [visitante.status, visitante.body.code, await prisma.reserva.count({ where: { tenantId: p.tenantId } })]

      // 1-4, 14. Authority fields are rejected; Ana then sends a valid request.
      const inyeccion = await solicitar('tok-ana', 0, '09:00', { clienteId: beto.id, userId: beto.id, clienteTenantId: beto.tenantId, clienteNombre: 'Otra Persona', clienteTelefono: '3794000000', clienteEmail: 'otra@example.com', estado: 'confirmed' })
      out.inyeccion = [inyeccion.status, inyeccion.body.code, await prisma.reserva.count({ where: { clienteId: beto.id } })]
      const pedido = await solicitar('tok-ana', 0, '10:00', { notas: 'Dolor de espalda' })
      const guardada = await fila(pedido.body.id)
      out.pedido = [pedido.status, pedido.body.estado, pedido.body.clienteNombre, pedido.body.oficioNombre === oficio.nombre, pedido.body.duracionMinutos, Boolean(pedido.body.expiraEn), pedido.body.notas]
      out.enBase = [guardada.estado, guardada.clienteId === ana.id, guardada.clienteTenantId === ana.tenantId, guardada.esInvitado, guardada.clienteNombre, guardada.clienteTelefono, guardada.clienteEmail]
      // Valid for 24 hours and never beyond the start of the turno.
      const vigencia = guardada.solicitudExpiraEn.getTime() - guardada.fechaCreacion.getTime()
      // The turno is next Monday at 10:00: run on a Sunday after 10:00 it starts in less than 24
      // hours, so the expected validity is computed from the same two instants, not assumed.
      const esperada = Math.min(24 * 3_600_000, guardada.fechaInicio.getTime() - guardada.fechaCreacion.getTime())
      out.vigencia = [Math.abs(vigencia - esperada) < 1000, guardada.solicitudExpiraEn.getTime() <= guardada.fechaInicio.getTime()]
      // The old path is the same rule (a Web still on the previous version keeps working).
      const alias = await call('POST', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/reservar', 'tok-ana', { oficioId: oficio.id, inicio: a(0, '12:00') })
      out.alias = [alias.status, alias.body.estado, alias.body.clienteNombre, (await call('POST', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/reservar', null, { oficioId: oficio.id, inicio: a(0, '14:00') })).status]
      // What the Web shows instead of asking: the data of the session's account.
      const solicitante = await call('GET', '/tus/v1/cliente/turnos/solicitante', 'tok-ana')
      out.solicitante = [solicitante.status, solicitante.body.nombre, solicitante.body.email === run + '-ana@example.com', solicitante.body.telefono, (await call('GET', '/tus/v1/cliente/turnos/solicitante', null)).status]

      // 5. The provider is told (outbound notice) and sees the request; another provider sees nothing.
      out.aviso = avisos.filter((x) => x[0] === 'recibida' && x[1] === pedido.body.id).map((x) => [x[2] === p.tenantId, x[3], x[4] === oficio.nombre, x[5], x[6] === a(0, '10:00')])
      const lista = await pendientes('tok-p')
      const vista = lista.items.find((item) => item.id === pedido.body.id)
      out.panel = [lista.pendientes, vista.estado, vista.clienteNombre, vista.clienteTelefono, vista.clienteEmail, vista.oficioNombre === oficio.nombre, vista.duracionMinutos]
      out.panelAjeno = [(await pendientes('tok-p2')).pendientes, (await call('GET', '/tus/v1/prestador/turnos/solicitudes', null)).status]

      // The request holds its time: the agenda shows it taken and nobody else can request it.
      out.retiene = [await agendaDe(0, '10:00'), (await solicitar('tok-beto', 0, '10:00')).body.code, (await solicitar('tok-beto', 0, '10:30')).body.code]
      // The client sees its request as pending; another client sees none of it.
      const propias = await call('GET', '/tus/v1/cliente/turnos', 'tok-ana')
      const propia = propias.body.items.find((item) => item.id === pedido.body.id)
      out.cliente = [propias.status, propia.estado, c.etiquetaEstadoTurno(propia.estado), propia.prestadorNombre === 'Paula Prestadora ' + run, propia.prestadorId === p.perfilId, propia.oficioNombre === oficio.nombre, (await call('GET', '/tus/v1/cliente/turnos', 'tok-beto')).body.items.length]

      // Only the provider of that agenda answers it. A client cannot confirm its own request.
      const aceptar = (token, id) => call('POST', '/tus/v1/prestador/turnos/' + id + '/aceptar', token)
      const rechazar = (token, id) => call('POST', '/tus/v1/prestador/turnos/' + id + '/rechazar', token)
      out.ajenos = [(await aceptar('tok-p2', pedido.body.id)).status, (await aceptar('tok-ana', pedido.body.id)).status, (await aceptar(null, pedido.body.id)).status, (await rechazar('tok-p2', pedido.body.id)).status, (await fila(pedido.body.id)).estado]
      out.noPorEstado = [(await call('PATCH', '/tus/v1/prestador/turnos/' + pedido.body.id + '/estado', 'tok-p', { estado: 'confirmed' })).body.code, (await call('PATCH', '/tus/v1/prestador/turnos/' + pedido.body.id + '/estado', 'tok-p', { estado: 'completed' })).body.code, (await fila(pedido.body.id)).estado]

      // 6-7. The provider accepts. No deposit can be charged here, so accepting confirms (the
      //      deposit flow is in tus-turnos-sena-postgres).
      const aceptada = await aceptar('tok-p', pedido.body.id)
      out.aceptada = [aceptada.status, aceptada.body.estado, aceptada.body.expiraEn, aceptada.body.clienteNombre, aceptada.body.clienteEmail === run + '-ana@example.com', (await fila(pedido.body.id)).estado]
      // The same answer again is the same result (and no second notice); the opposite one is refused.
      const otraVez = await aceptar('tok-p', pedido.body.id)
      const tarde = await rechazar('tok-p', pedido.body.id)
      out.repetida = [otraVez.status, otraVez.body.estado, tarde.status, tarde.body.code, (await fila(pedido.body.id)).estado]
      out.avisoCliente = avisos.filter((x) => x[0] === 'respondida' && x[1] === pedido.body.id).map((x) => [x[2] === ana.id, x[3]])
      out.clienteConfirmada = (await call('GET', '/tus/v1/cliente/turnos', 'tok-ana')).body.items.find((item) => item.id === pedido.body.id).estado
      out.sigueOcupado = [await agendaDe(0, '10:00'), (await pendientes('tok-p')).items.some((item) => item.id === pedido.body.id)]

      // 8-9. The provider rejects another request: rejected, and the time is offered again.
      const segunda = await solicitar('tok-ana', 1, '11:00')
      const rechazada = await rechazar('tok-p', segunda.body.id)
      out.rechazada = [rechazada.status, rechazada.body.estado, (await fila(segunda.body.id)).estado, await agendaDe(1, '11:00'), (await aceptar('tok-p', segunda.body.id)).body.code]
      out.avisoRechazo = avisos.filter((x) => x[0] === 'respondida' && x[1] === segunda.body.id).map((x) => x[3])
      const reuso = await solicitar('tok-beto', 1, '11:00')
      out.reuso = [reuso.status, reuso.body.estado, reuso.body.clienteNombre]

      // The client withdraws its own request; never somebody else's.
      const retirar = (token, id) => call('POST', '/tus/v1/cliente/turnos/' + id + '/cancelar', token)
      out.retiro = [(await retirar('tok-ana', reuso.body.id)).status, (await retirar('tok-beto', reuso.body.id)).body.estado, (await retirar('tok-beto', reuso.body.id)).status, await agendaDe(1, '11:00'), (await aceptar('tok-p', reuso.body.id)).body.code]

      // States follow the allowed changes: a confirmed turno is completed, and nothing leaves a final state.
      const estado = (id, nuevo) => call('PATCH', '/tus/v1/prestador/turnos/' + id + '/estado', 'tok-p', { estado: nuevo })
      out.transiciones = [(await estado(pedido.body.id, 'completed')).body.estado, (await estado(pedido.body.id, 'cancelled')).body.code, (await estado(segunda.body.id, 'completed')).body.code, (await estado(pedido.body.id, 'inventado')).body.code]

      // The database itself: an unknown state, a pending row without validity, two live rows of one time.
      const cruda = (id, datos) => prisma.reserva.create({ data: { id, tenantId: p.tenantId, reservaId: id, calendarioId: guardada.calendarioId, clienteId: ana.id, fechaInicio: new Date(a(3, '09:00')), fechaFin: new Date(a(3, '10:00')), version: 1, fechaCreacion: new Date(), fechaActualizacion: new Date(), ...datos } }).then(() => 'ok', dbCode)
      out.base = [
        await cruda(run + '-x1', { estado: 'aprobado' }),
        await cruda(run + '-x2', { estado: 'pending' }),
        await cruda(run + '-x3', { estado: 'pending', solicitudExpiraEn: new Date(a(3, '09:00')) }),
        await cruda(run + '-x4', { estado: 'confirmed' }),
        await cruda(run + '-x5', { estado: 'rejected' }),
        await cruda(run + '-x6', { estado: 'expired' }),
      ]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.visitante, [401, 'LOGIN_REQUIRED', 0], 'a visitor is sent to sign in and nothing is stored')
  assert.deepEqual(r.inyeccion, [400, 'UNTRUSTED_BOOKING_FIELDS', 0])
  assert.deepEqual(r.pedido, [201, 'pending', 'Ana María Cliente', true, 60, true, 'Dolor de espalda'], 'the request is pending, in the name of the account of the session')
  assert.deepEqual(r.enBase, ['pending', true, true, false, null, null, null], 'the client is the session account; no name, phone or email is copied onto the reservation')
  assert.deepEqual(r.vigencia, [true, true], 'valid for 24 hours, or until the start when that comes first')
  assert.deepEqual(r.alias, [201, 'pending', 'Ana María Cliente', 401], 'the old path requests too, and never books as a guest')
  assert.deepEqual(r.solicitante, [200, 'Ana María Cliente', true, null, 401])
  assert.deepEqual(r.aviso, [[true, 'Ana María Cliente', true, 60, true]], 'the provider is notified once, with client, service, time and duration')
  assert.deepEqual(r.panel, [2, 'pending', 'Ana María Cliente', null, null, true, 60], 'the provider sees who asks; the contact stays private while it is pending')
  assert.deepEqual(r.panelAjeno, [0, 401])
  assert.deepEqual(r.retiene, ['ocupado', 'SLOT_OCCUPIED', 'SLOT_OCCUPIED'], 'a pending request holds its time against other requests')
  assert.deepEqual(r.cliente, [200, 'pending', 'Pendiente de respuesta', true, true, true, 0])
  assert.deepEqual(r.ajenos, [404, 404, 401, 404, 'pending'], 'nobody but the provider of that agenda answers a request')
  assert.deepEqual(r.noPorEstado, ['INVALID_STATUS', 'INVALID_TRANSITION', 'pending'], 'a request is never confirmed through the generic state change')
  assert.deepEqual(r.aceptada, [200, 'confirmed', null, 'Ana María Cliente', true, 'confirmed'], 'nothing to pay: accepting confirms; the contact is shown from then on')
  assert.deepEqual(r.repetida, [200, 'confirmed', 409, 'REQUEST_NOT_PENDING', 'confirmed'])
  assert.deepEqual(r.avisoCliente, [[true, 'confirmed']], 'the client is told once')
  assert.equal(r.clienteConfirmada, 'confirmed')
  assert.deepEqual(r.sigueOcupado, ['ocupado', false])
  assert.deepEqual(r.rechazada, [200, 'rejected', 'rejected', 'disponible', 'REQUEST_NOT_PENDING'], 'a rejected request gives the time back and cannot be accepted later')
  assert.deepEqual(r.avisoRechazo, ['rejected'])
  assert.deepEqual(r.reuso, [201, 'pending', 'Beto Cuenta'])
  assert.deepEqual(r.retiro, [404, 'cancelled', 200, 'disponible', 'REQUEST_NOT_PENDING'], 'only its own client withdraws a request')
  assert.deepEqual(r.transiciones, ['completed', 'INVALID_TRANSITION', 'INVALID_TRANSITION', 'INVALID_STATUS'])
  assert.deepEqual(r.base, ['23514', '23514', 'ok', '23P01', 'ok', 'ok'], 'PostgreSQL: known states only, a pending row has its validity, live rows never overlap, rejected and expired ones do')
})

test('TURNOS solicitud PostgreSQL: the time is decided again on accepting (blocked meanwhile -> not accepted, rejected); an overdue request expires, frees its time and cannot be accepted; one client cannot keep an agenda waiting', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const aceptar = (id) => call('POST', '/tus/v1/prestador/turnos/' + id + '/aceptar', 'tok-p')
      // 10. The provider blocks the time after the request: accepting does not move it to payment.
      const pedido = await solicitar('tok-ana', 0, '10:00')
      await turnos.bloquearHorario({ prestadorTenantId: p.tenantId, inicio: a(0, '09:00'), fin: a(0, '12:00'), motivo: 'Trámite' })
      const sinHorario = await aceptar(pedido.body.id)
      out.bloqueado = [sinHorario.status, sinHorario.body.code, (await fila(pedido.body.id)).estado, (await call('GET', '/tus/v1/cliente/turnos', 'tok-ana')).body.items.find((item) => item.id === pedido.body.id).estado]
      out.avisoBloqueado = avisos.filter((x) => x[0] === 'respondida' && x[1] === pedido.body.id).map((x) => x[3])
      out.yaRespondida = (await aceptar(pedido.body.id)).body.code

      // An overdue request: every read already treats it as expired and its time as free...
      const vieja = await solicitar('tok-ana', 1, '15:00')
      await prisma.reserva.update({ where: { id: vieja.body.id }, data: { solicitudExpiraEn: new Date(Date.now() - 60_000) } })
      const porEstado = async (estado) => (await call('GET', '/tus/v1/prestador/turnos?estado=' + estado, 'tok-p')).body.items.filter((item) => item.id === vieja.body.id).map((item) => item.estado)
      out.vencidaFiltro = [await porEstado('pending'), await porEstado('expired')]
      out.vencidaLectura = [(await fila(vieja.body.id)).estado, (await call('GET', '/tus/v1/cliente/turnos', 'tok-ana')).body.items.find((item) => item.id === vieja.body.id).estado, (await pendientes('tok-p')).items.some((item) => item.id === vieja.body.id), await agendaDe(1, '15:00')]
      // ...the next write of the agenda marks it, another client takes the time, and it can no longer be accepted.
      const nueva = await solicitar('tok-beto', 1, '15:00')
      const tarde = await aceptar(vieja.body.id)
      out.vencida = [nueva.status, nueva.body.estado, (await fila(vieja.body.id)).estado, tarde.status, tarde.body.code, (await fila(nueva.body.id)).estado]
      const aceptadaNueva = await aceptar(nueva.body.id)
      out.unaSola = [aceptadaNueva.body.estado, await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(1, '15:00')), estado: { in: ['pending', 'awaiting_payment', 'confirmed'] } } })]
      // A request whose turno already started cannot be confirmed either.
      const pasada = await solicitar('tok-ana', 2, '09:00')
      await prisma.$executeRawUnsafe('UPDATE public."reservas" SET "fecha_inicio" = now() at time zone \\'utc\\' - interval \\'2 hours\\', "fecha_fin" = now() at time zone \\'utc\\' - interval \\'1 hour\\', "solicitud_expira_en" = now() at time zone \\'utc\\' + interval \\'1 hour\\' WHERE "id" = $1', pasada.body.id)
      const yaPaso = await aceptar(pasada.body.id)
      out.pasada = [yaPaso.status, yaPaso.body.code, (await fila(pasada.body.id)).estado]

      // One client, one agenda: a limited number of open requests.
      const abiertas = []
      for (const hora of ['09:00', '11:00', '13:00', '15:00']) abiertas.push(await solicitar('tok-ana', 3, hora))
      out.limite = [abiertas.map((x) => x.status), abiertas.at(-1).body.code, c.MAXIMO_SOLICITUDES_PENDIENTES_POR_AGENDA, (await solicitar('tok-beto', 3, '15:00')).status]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.bloqueado, [409, 'REQUEST_SLOT_UNAVAILABLE', 'rejected', 'rejected'], 'a time that is no longer free is never confirmed: the request ends rejected')
  assert.deepEqual(r.avisoBloqueado, ['rejected'])
  assert.equal(r.yaRespondida, 'REQUEST_NOT_PENDING')
  assert.deepEqual(r.vencidaFiltro, [[], ['expired']], 'the list filter agrees with the state shown: overdue is expired, not pending')
  assert.deepEqual(r.vencidaLectura, ['pending', 'expired', false, 'disponible'], 'an overdue request reads as expired and stops holding its time')
  assert.deepEqual(r.vencida, [201, 'pending', 'expired', 409, 'REQUEST_EXPIRED', 'pending'], 'the overdue request is expired by the next write and can no longer be accepted')
  assert.deepEqual(r.unaSola, ['confirmed', 1], 'one live reservation for that time')
  assert.deepEqual(r.pasada, [409, 'REQUEST_EXPIRED', 'expired'])
  assert.deepEqual(r.limite, [[201, 201, 201, 409], 'TOO_MANY_PENDING_REQUESTS', 3, 201])
})

test('TURNOS solicitud PostgreSQL concurrency: several clients requesting the same time at once -> one request; several answers of the provider to the same request at once -> one result, one notice; an accept racing a reject -> exactly one wins', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const clientes = [ana, beto, await cuenta('caro', 'Caro Cuenta'), await cuenta('dani', 'Dani Cuenta'), await cuenta('eva', 'Eva Cuenta'), await cuenta('fede', 'Fede Cuenta')]
      clientes.forEach((cliente, i) => sesion('tok-c' + i, cliente.id, cliente.tenantId))
      // Open several connections first, so the requests really run side by side.
      await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRawUnsafe('select 1 as ok from pg_sleep(0.05)')))

      // 11. Six clients, the same time, at once.
      const carrera = await Promise.all(clientes.map((_, i) => solicitar('tok-c' + i, 0, '10:00')))
      const ganadora = carrera.find((x) => x.status === 201)
      out.carrera = [carrera.filter((x) => x.status === 201).length, carrera.filter((x) => x.status === 409 && x.body.code === 'SLOT_OCCUPIED').length, await prisma.reserva.count({ where: { tenantId: p.tenantId, estado: 'pending' } })]
      // Different starts that overlap each other (a 60 minute turno every 15 minutes): one request.
      const solapadas = await Promise.all(['14:00', '14:15', '14:30', '14:45'].map((hora, i) => solicitar('tok-c' + i, 0, hora)))
      out.solapadas = [solapadas.filter((x) => x.status === 201).length, solapadas.filter((x) => x.body?.code === 'SLOT_OCCUPIED').length]

      // 12. The provider answers the same request from several tabs at once.
      const aceptar = (id) => call('POST', '/tus/v1/prestador/turnos/' + id + '/aceptar', 'tok-p')
      const rechazar = (id) => call('POST', '/tus/v1/prestador/turnos/' + id + '/rechazar', 'tok-p')
      const dobles = await Promise.all(Array.from({ length: 5 }, () => aceptar(ganadora.body.id)))
      out.dobles = [dobles.map((x) => x.status), dobles.every((x) => x.body.estado === 'confirmed'), (await fila(ganadora.body.id)).estado, (await fila(ganadora.body.id)).version, avisos.filter((x) => x[0] === 'respondida' && x[1] === ganadora.body.id).length]
      out.unaReserva = await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(0, '10:00')), estado: 'confirmed' } })

      // An accept and a reject of the same request, at once, several times over.
      const duelos = []
      for (const hora of ['09:00', '11:00', '16:00']) {
        const pedido = await solicitar('tok-c5', 1, hora)
        const [si, no] = await Promise.all([aceptar(pedido.body.id), rechazar(pedido.body.id)])
        const final = (await fila(pedido.body.id)).estado
        duelos.push([[si.status, no.status].sort().join(), final === 'confirmed' ? si.status === 200 && no.body.code === 'REQUEST_NOT_PENDING' : final === 'rejected' && no.status === 200 && si.body.code === 'REQUEST_NOT_PENDING', avisos.filter((x) => x[0] === 'respondida' && x[1] === pedido.body.id).length])
      }
      out.duelos = duelos

      // A request racing the provider's own manual turno for the same time: one of them.
      const mezcla = await Promise.all([
        solicitar('tok-c1', 2, '10:00').then((x) => x.status),
        call('POST', '/tus/v1/prestador/turnos/manual', 'tok-p', { oficioId: oficio.id, inicio: a(2, '10:00'), clienteNombre: 'Presencial' }).then((x) => x.status),
      ])
      out.mezcla = [mezcla.filter((x) => x === 201).length, mezcla.filter((x) => x === 409).length, await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(2, '10:00')), estado: { in: ['pending', 'awaiting_payment', 'confirmed'] } } })]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.carrera, [1, 5, 1], 'six simultaneous requests for one time: one request, five 409')
  assert.deepEqual(r.solapadas, [1, 3])
  assert.deepEqual(r.dobles, [[200, 200, 200, 200, 200], true, 'confirmed', 2, 1], 'the same answer five times at once: accepted once, one change, one notice')
  assert.equal(r.unaReserva, 1)
  assert.deepEqual(r.duelos, [['200,409', true, 1], ['200,409', true, 1], ['200,409', true, 1]], 'accept against reject: exactly one wins and the loser is told the request was already answered')
  assert.deepEqual(r.mezcla, [1, 1, 1])
})

test('TURNOS solicitud review: no client path confirms; the owner of a request is always the session; each state holds or releases the time as defined; the validity is 24 hours and never beyond the turno; the contact of the client is private until the turno is confirmed', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // The client has a verified phone: it must stay private while the request is pending.
      await prisma.user.update({ where: { email: run + '-ana@example.com' }, data: { phoneNumber: '+549379' + String(Date.now()).slice(-7), phoneVerifiedAt: new Date() } })
      sesion('tok-admin', 'admin-' + run, 'platform-' + run)
      sesiones['tok-admin'].permissions = ['tus:providers:admin']
      const aceptar = (token, id) => call('POST', '/tus/v1/prestador/turnos/' + id + '/aceptar', token)

      // 6. Every attempt to name another owner, provider, price or state is rejected.
      const inyeccion = await solicitar('tok-ana', 0, '09:00', { clienteId: beto.id, userId: beto.id, accountId: beto.id, subjectId: beto.id, cliente: { cuentaId: beto.id }, clienteTenantId: beto.tenantId, tenantId: p2.tenantId, prestadorTenantId: p2.tenantId, esInvitado: true, estado: 'confirmed', creadoPorAdminId: 'admin-' + run, solicitudExpiraEn: '2099-01-01T00:00:00.000Z', precioFinal: 1 })
      out.inyeccion = [inyeccion.status, inyeccion.body.code, await prisma.reserva.count({ where: { clienteId: beto.id } })]
      const forjada = await solicitar('tok-ana', 0, '10:00')
      const guardada = await fila(forjada.body.id)
      out.forjada = [forjada.status, guardada.estado, guardada.clienteId === ana.id, guardada.clienteTenantId === ana.tenantId, guardada.tenantId === p.tenantId, guardada.esInvitado, guardada.creadoPorAdminId, Number(guardada.precioFinal), guardada.solicitudExpiraEn.getFullYear() < 2099]
      out.betoNoLaVe = (await call('GET', '/tus/v1/cliente/turnos', 'tok-beto')).body.items.length

      // 1-2. Nothing a client can call confirms it; the administration cannot either.
      const id = forjada.body.id
      out.clienteNoConfirma = [
        (await aceptar('tok-ana', id)).status,
        (await call('PATCH', '/tus/v1/prestador/turnos/' + id + '/estado', 'tok-ana', { estado: 'confirmed' })).status,
        (await call('PATCH', '/tus/v1/prestador/turnos/' + id + '/estado', 'tok-ana', { estado: 'completed' })).status,
        (await call('PATCH', '/tus/v1/admin/turnos/' + id + '/estado', 'tok-ana', { estado: 'confirmed' })).status,
        (await call('POST', '/tus/v1/cliente/turnos/' + id + '/aceptar', 'tok-ana')).status,
        (await call('POST', '/tus/v1/admin/turnos', 'tok-ana', { tipo: 'general', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(0, '12:00'), cliente: { tipo: 'registrado', cuentaId: ana.id } })).status,
        (await call('PATCH', '/tus/v1/admin/turnos/' + id + '/estado', 'tok-admin', { estado: 'confirmed' })).body.code,
        (await fila(id)).estado,
      ]

      // 10. Privacy: name while pending; phone and email only once it is confirmed.
      const contacto = (item) => [item.clienteNombre, item.clienteTelefono === null, item.clienteEmail === null]
      const enPanel = async () => (await pendientes('tok-p')).items.find((item) => item.id === id)
      const enLista = async () => (await call('GET', '/tus/v1/prestador/turnos', 'tok-p')).body.items.find((item) => item.id === id)
      out.privadoPendiente = [contacto(await enPanel()), contacto(await enLista()), contacto((await call('GET', '/tus/v1/prestador/turnos?estado=pending', 'tok-p')).body.items[0])]
      const agendaPublica = await call('GET', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/agenda?oficioId=' + oficio.id + '&desde=' + lunes)
      out.agendaSinCliente = [JSON.stringify(agendaPublica.body).includes('Ana María'), JSON.stringify(agendaPublica.body).includes(ana.id), Object.keys(agendaPublica.body.dias[0].franjas[0]).sort()]
      out.solicitanteEnmascarado = /^\\+549379•+\\d{4}$/u.test((await call('GET', '/tus/v1/cliente/turnos/solicitante', 'tok-ana')).body.telefono)
      const aceptada = await aceptar('tok-p', id)
      out.visibleConfirmada = [aceptada.body.clienteNombre, /^\\+549379\\d+$/u.test(aceptada.body.clienteTelefono), aceptada.body.clienteEmail === run + '-ana@example.com', /^\\+549379\\d+$/u.test((await enLista()).clienteTelefono)]
      // A rejected request never showed the contact and still does not.
      const otra = await solicitar('tok-ana', 0, '14:00')
      await call('POST', '/tus/v1/prestador/turnos/' + otra.body.id + '/rechazar', 'tok-p')
      out.privadoRechazada = contacto((await call('GET', '/tus/v1/prestador/turnos', 'tok-p')).body.items.find((item) => item.id === otra.body.id))

      // 7. Each state, the same time: does it hold it (agenda + a new request)?
      const estados = {}
      const base = await solicitar('tok-ana', 2, '10:00')
      for (const estado of ['pending', 'awaiting_payment', 'confirmed', 'completed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show']) {
        await prisma.reserva.update({ where: { id: base.body.id }, data: { estado } })
        const libre = await agendaDe(2, '10:00')
        const intento = await solicitar('tok-beto', 2, '10:00')
        estados[estado] = [libre, intento.status]
        if (intento.status === 201) await prisma.reserva.delete({ where: { id: intento.body.id } })
      }
      out.estados = estados

      // 8. Validity: 24 hours for a turno far ahead; for a turno sooner than that, its own start.
      await turnos.guardarDisponibilidadSemanal(p2.tenantId, { intervaloGeneral: 15, horarios: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio: '00:00', horaFin: '23:45' })) })
      const semana = await turnos.agendaSemanal({ prestadorId: p2.perfilId, oficioId: oficio.id, desde: c.lunesDe(hoy) })
      const proxima = [...semana.dias.flatMap((d) => d.franjas), ...(await turnos.agendaSemanal({ prestadorId: p2.perfilId, oficioId: oficio.id, desde: c.sumarDias(c.lunesDe(hoy), 7) })).dias.flatMap((d) => d.franjas)].find((f) => f.estado === 'disponible' && Date.parse(f.inicio) > Date.now() + 20 * 60_000)
      const pronto = await call('POST', '/tus/v1/prestadores/' + p2.perfilId + '/turnos/solicitudes', 'tok-ana', { oficioId: oficio.id, inicio: proxima.inicio })
      const filaPronto = await fila(pronto.body.id)
      out.vigenciaCorta = [pronto.status, Date.parse(proxima.inicio) - Date.now() < 24 * 3_600_000, filaPronto.solicitudExpiraEn.getTime() === filaPronto.fechaInicio.getTime(), pronto.body.expiraEn === proxima.inicio]
      const lejos = await fila(base.body.id)
      out.vigenciaLarga = Math.round((lejos.solicitudExpiraEn.getTime() - lejos.fechaCreacion.getTime()) / 60_000)
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.inyeccion, [400, 'UNTRUSTED_BOOKING_FIELDS', 0])
  assert.deepEqual(r.forjada, [201, 'pending', true, true, true, false, null, 15000, true], 'the owner, provider, state, price and validity come from the server')
  assert.equal(r.betoNoLaVe, 0, 'the account named in the body owns nothing')
  assert.deepEqual(r.clienteNoConfirma, [404, 400, 404, 403, 404, 403, 'INVALID_TRANSITION', 'pending'], 'no client call confirms a request; the administration cannot confirm it for the provider either')
  assert.deepEqual(r.privadoPendiente, [['Ana María Cliente', true, true], ['Ana María Cliente', true, true], ['Ana María Cliente', true, true]], 'pending: the name, never the phone or the email, in every provider endpoint')
  assert.deepEqual(r.agendaSinCliente, [false, false, ['estado', 'fin', 'hora', 'inicio']], 'the public agenda says a time is taken, never by whom')
  assert.equal(r.solicitanteEnmascarado, true, 'the client sees its own phone masked')
  assert.deepEqual(r.visibleConfirmada, ['Ana María Cliente', true, true, true], 'confirmed: the provider can contact its client')
  assert.deepEqual(r.privadoRechazada, ['Ana María Cliente', true, true])
  assert.deepEqual(r.estados, {
    pending: ['ocupado', 409],
    awaiting_payment: ['ocupado', 409],
    confirmed: ['ocupado', 409],
    completed: ['ocupado', 409],
    rejected: ['disponible', 201],
    expired: ['disponible', 201],
    cancelled: ['disponible', 201],
    'cancelled-late': ['disponible', 201],
    'no-show': ['disponible', 201],
  })
  assert.deepEqual(r.vigenciaCorta, [201, true, true, true], 'a turno sooner than 24 hours: the request is valid until the turno starts, not after')
  assert.equal(r.vigenciaLarga, 24 * 60, 'a turno far ahead: exactly 24 hours')
})

test('TURNOS solicitud review concurrency: accepting while another client takes the time (overdue request) changes nothing twice; accepting a live request while another client asks for its time leaves one reservation', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRawUnsafe('select 1 as ok from pg_sleep(0.05)')))
      const aceptar = (id) => call('POST', '/tus/v1/prestador/turnos/' + id + '/aceptar', 'tok-p')
      const vivas = (indice, hora) => prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(indice, hora)), estado: { in: ['pending', 'awaiting_payment', 'confirmed'] } } })
      const rondas = []
      for (const hora of ['09:00', '11:00', '13:00', '15:00']) {
        // Overdue request of Ana: the provider accepts it at the same moment Beto asks for that time.
        const vieja = await solicitar('tok-ana', 0, hora)
        await prisma.reserva.update({ where: { id: vieja.body.id }, data: { solicitudExpiraEn: new Date(Date.now() - 1000) } })
        const [si, nueva] = await Promise.all([aceptar(vieja.body.id), solicitar('tok-beto', 0, hora)])
        rondas.push([si.status, si.body.code, nueva.status, (await fila(vieja.body.id)).estado, await vivas(0, hora)])
        // Beto withdraws it: one client may keep only a few requests waiting in an agenda.
        if (nueva.status === 201) await call('POST', '/tus/v1/cliente/turnos/' + nueva.body.id + '/cancelar', 'tok-beto')
      }
      out.vencidaContraNueva = rondas
      const vigentes = []
      for (const hora of ['09:00', '11:00', '13:00']) {
        // Live request of Ana: accepted while Beto asks for the same time.
        const pedido = await solicitar('tok-ana', 1, hora)
        const [si, otro] = await Promise.all([aceptar(pedido.body.id), solicitar('tok-beto', 1, hora)])
        vigentes.push([si.status, si.body.estado, otro.status, otro.body.code, await vivas(1, hora)])
      }
      out.vigenteContraNueva = vigentes
      // Many answers of every kind to one request, at once.
      const pedido = await solicitar('tok-ana', 2, '10:00')
      const mezcla = await Promise.all([aceptar(pedido.body.id), call('POST', '/tus/v1/prestador/turnos/' + pedido.body.id + '/rechazar', 'tok-p'), aceptar(pedido.body.id), call('POST', '/tus/v1/cliente/turnos/' + pedido.body.id + '/cancelar', 'tok-ana'), call('POST', '/tus/v1/prestador/turnos/' + pedido.body.id + '/rechazar', 'tok-p')])
      const final = await fila(pedido.body.id)
      out.mezcla = [mezcla.every((x) => x.status === 200 || x.status === 409), ['confirmed', 'rejected', 'cancelled'].includes(final.estado), avisos.filter((x) => x[0] === 'respondida' && x[1] === pedido.body.id).length <= 1, await vivas(2, '10:00') <= 1]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  for (const ronda of r.vencidaContraNueva) assert.deepEqual(ronda, [409, 'REQUEST_EXPIRED', 201, 'expired', 1], 'the overdue request is never confirmed; the new one is the only live reservation')
  for (const ronda of r.vigenteContraNueva) assert.deepEqual(ronda, [200, 'confirmed', 409, 'SLOT_OCCUPIED', 1], 'the accepted request keeps its time; the other client is told it is taken')
  assert.deepEqual(r.mezcla, [true, true, true, true], 'any mix of simultaneous answers leaves one consistent final state')
})

// Upgrade from the database as it is today (every migration before this one, with real rows):
// TUS_MIGRATIONS_PG_ADMIN_URL is a DISPOSABLE PostgreSQL 16 where the user may CREATE DATABASE.
const adminUrl = process.env.TUS_MIGRATIONS_PG_ADMIN_URL
const MIGRACION = '20261026100000_tus_turnos_solicitud_reserva'

test('TURNOS solicitud upgrade PG16: the migration runs over existing reservations without touching them, keeps the overlap rule for every state that held a time, and adds the request states', { skip: !adminUrl && 'TUS_MIGRATIONS_PG_ADMIN_URL not set (disposable PostgreSQL 16 only)', timeout: 600000 }, async () => {
  const database = `tus_solicitud_${Date.now().toString(36)}`
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${database}`)
  const target = new URL(adminUrl)
  target.pathname = `/${database}`
  const db = new Client({ connectionString: target.toString() })
  const migrar = () => spawnSync(process.execPath, ['scripts/db/migrate-deploy.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: target.toString(), DIRECT_URL: target.toString() }, encoding: 'utf8', timeout: 480000 })
  const def = async (name) => (await db.query(`SELECT pg_get_constraintdef(oid) AS d, convalidated AS v FROM pg_constraint WHERE conname = $1`, [name])).rows[0] ?? null
  try {
    const primera = migrar()
    assert.equal(primera.status, 0, `migrate-deploy failed:\n${(primera.stdout + primera.stderr).slice(-1500)}`)
    await db.connect()

    // 1. Back to the database of today: exactly what the previous migrations left (the statements
    //    of 20261017100000 for the overlap rule), with this migration not applied.
    await db.query('BEGIN')
    await db.query(`DROP INDEX public."ix_reservas_solicitudes_pendientes"`)
    await db.query(`ALTER TABLE public."reservas" DROP CONSTRAINT "ck_reservas_solicitud_vigencia", DROP CONSTRAINT "ck_reservas_estado", DROP CONSTRAINT "ex_reservas_sin_solapamiento", DROP COLUMN "solicitud_expira_en"`)
    await db.query(`ALTER TABLE public."reservas" ADD CONSTRAINT "ex_reservas_sin_solapamiento" EXCLUDE USING gist ("calendario_id" WITH =, tsrange("fecha_inicio", "fecha_fin", '[)') WITH &&) WHERE ("estado" NOT IN ('cancelled', 'cancelled-late', 'no-show'))`)
    await db.query(`DELETE FROM _prisma_migrations WHERE migration_name = $1`, [MIGRACION])
    await db.query('COMMIT')
    assert.doesNotMatch((await def('ex_reservas_sin_solapamiento')).d, /rejected|expired/u, 'the previous overlap rule')

    // 2. Reservations as production has them: every state the previous code wrote, a legacy state,
    //    and released rows sharing a time with a live one.
    await db.query(`INSERT INTO "TusTenant"(id, slug, name, status, "createdAt", "updatedAt") VALUES ('t-up', 't-up', 'Upgrade', 'active', now(), now())`)
    await db.query(`INSERT INTO calendarios(id, tenant_id, nombre, zona_horaria, estado, fecha_creacion, fecha_actualizacion) VALUES ('cal-up', 't-up', 'Agenda', 'America/Argentina/Buenos_Aires', 'active', now(), now())`)
    const reserva = (id, inicio, fin, estado) =>
      db.query(`INSERT INTO reservas(id, tenant_id, reserva_id, calendario_id, cliente_id, fecha_inicio, fecha_fin, estado, version, fecha_creacion, fecha_actualizacion, cliente_nombre) VALUES ($1, 't-up', $1, 'cal-up', 'invitado', $2, $3, $4, 1, now(), now(), 'Cliente previo')`, [id, inicio, fin, estado]).then(() => 'ok', (error) => error.code)
    const previas = [['r-conf', '2026-11-02 10:00', '2026-11-02 11:00', 'confirmed'], ['r-comp', '2026-11-02 11:00', '2026-11-02 12:00', 'completed'], ['r-canc', '2026-11-02 10:00', '2026-11-02 11:00', 'cancelled'], ['r-late', '2026-11-02 10:00', '2026-11-02 11:00', 'cancelled-late'], ['r-nosh', '2026-11-02 10:00', '2026-11-02 11:00', 'no-show'], ['r-raro', '2026-11-03 10:00', '2026-11-03 11:00', 'legacy-state']]
    for (const fila of previas) assert.equal(await reserva(...fila), 'ok', `existing row ${fila[0]}`)
    const antes = (await db.query(`SELECT id, estado, version, fecha_inicio, fecha_fin, cliente_nombre FROM reservas ORDER BY id`)).rows

    // 3. Upgrade: only this migration is pending.
    const segunda = migrar()
    assert.equal(segunda.status, 0, `upgrade failed:\n${(segunda.stdout + segunda.stderr).slice(-1500)}`)
    const aplicada = (await db.query(`SELECT finished_at IS NOT NULL AS ok FROM _prisma_migrations WHERE migration_name = $1 AND rolled_back_at IS NULL`, [MIGRACION])).rows
    assert.deepEqual(aplicada, [{ ok: true }])

    // 4. Nothing existing was rewritten; the new column is empty for all of it.
    const despues = (await db.query(`SELECT id, estado, version, fecha_inicio, fecha_fin, cliente_nombre FROM reservas ORDER BY id`)).rows
    assert.deepEqual(despues, antes, 'existing reservations are untouched')
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM reservas WHERE solicitud_expira_en IS NOT NULL`)).rows[0].n, 0)

    // 5. The overlap rule: same columns, the two new states added to the released ones.
    const regla = await def('ex_reservas_sin_solapamiento')
    assert.match(regla.d, /EXCLUDE USING gist \(calendario_id WITH =, tsrange\(fecha_inicio, fecha_fin/u)
    for (const estado of ['cancelled', 'cancelled-late', 'no-show', 'rejected', 'expired']) assert.ok(regla.d.includes(`'${estado}'`), `${estado} releases the time`)
    assert.equal(await reserva('n-conf', '2026-11-02 10:30', '2026-11-02 11:30', 'confirmed'), '23P01', 'a confirmed turno still cannot overlap an existing one')
    assert.equal(await reserva('n-pend', '2026-11-02 10:30', '2026-11-02 11:30', 'pending'), '23514', 'a pending row needs its validity')
    const pendiente = (id, inicio, fin) => db.query(`INSERT INTO reservas(id, tenant_id, reserva_id, calendario_id, cliente_id, fecha_inicio, fecha_fin, estado, version, fecha_creacion, fecha_actualizacion, solicitud_expira_en) VALUES ($1, 't-up', $1, 'cal-up', 'cuenta', $2, $3, 'pending', 1, now(), now(), $2)`, [id, inicio, fin]).then(() => 'ok', (error) => error.code)
    assert.equal(await pendiente('n-p1', '2026-11-02 10:30', '2026-11-02 11:30'), '23P01', 'a request cannot take a time that is taken')
    assert.equal(await pendiente('n-p2', '2026-11-04 10:00', '2026-11-04 11:00'), 'ok')
    assert.equal(await pendiente('n-p3', '2026-11-04 10:30', '2026-11-04 11:30'), '23P01', 'two requests cannot hold the same time')
    for (const estado of ['rejected', 'expired']) assert.equal(await reserva(`n-${estado}`, '2026-11-04 10:00', '2026-11-04 11:00', estado), 'ok', `${estado} does not hold a time`)

    // 6. New rules are NOT VALID: they bind new and updated rows and leave the legacy row alone.
    assert.deepEqual([(await def('ck_reservas_estado')).v, (await def('ck_reservas_solicitud_vigencia')).v], [false, false])
    assert.equal(await reserva('n-raro', '2026-11-05 10:00', '2026-11-05 11:00', 'otro-estado'), '23514')
    assert.equal((await db.query(`SELECT estado FROM reservas WHERE id = 'r-raro'`)).rows[0].estado, 'legacy-state')
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'ix_reservas_solicitudes_pendientes'`)).rows[0].n, 1)
  } finally {
    await db.end().catch(() => undefined)
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined)
    await admin.end()
  }
})
