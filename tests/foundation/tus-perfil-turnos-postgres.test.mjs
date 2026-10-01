import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// PERFIL-GEO-01 and TURNOS-ADMIN-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database. Real Prisma adapters, real
// constraints: the exclusion constraint is what makes a double booking impossible.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
  const { crearRouterTurnos } = await import('./apps/api/src/tus/calendar/turnos-http.ts')
  const { AlmacenPerfilPrisma } = await import('./apps/api/src/tus/perfil/almacen.ts')
  const { ServicioPerfil } = await import('./apps/api/src/tus/perfil/servicio.ts')
  const { CuentasAdminPrisma } = await import('./apps/api/src/tus/admin/fuentes.ts')
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const run = 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const auth = createPrismaAuthService(prisma)
  const turnos = new ServicioTurnos(prisma)
  const perfiles = new ServicioPerfil(new AlmacenPerfilPrisma(prisma))
  const PASSWORD = 'una frase larga y segura 2026'
  async function cuenta(tag, nombre) {
    const outcome = await auth.service.registerAccount({ email: run + '-' + tag + '@example.com', password: PASSWORD, displayName: nombre })
    return outcome.created.account
  }
  const oficios = await prisma.oficioServicio.findMany({ where: { activo: true }, orderBy: { orden: 'asc' }, take: 2 })
  const [oficio, otroOficio] = oficios
  async function prestador(tag, nombre, opciones = {}) {
    const tenantId = run + '-tenant-' + tag
    const prestadorId = run + '-prestador-' + tag
    const ahora = new Date()
    await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: nombre, status: 'active', createdAt: ahora, updatedAt: ahora } })
    await prisma.prestador.create({ data: { id: run + '-p-' + tag, tenantId, prestadorId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
    const perfil = await prisma.perfilPublicoPrestador.create({
      data: { id: run + '-perfil-' + tag, tenantId, prestadorId, nombrePublico: nombre, oficio: oficio.id, zona: 'Centro', visible: opciones.visible ?? true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } },
    })
    return { tenantId, prestadorId, perfilId: perfil.id }
  }
  // A weekday at least two days ahead, in Argentina time (default agenda: Monday to Friday 9 to 18).
  const dia = (() => { const d = new Date(Date.now() - 3 * 3600_000 + 2 * 86400_000); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
  const a = (hora) => new Date(dia + 'T' + hora + ':00.000-03:00').toISOString()
  const code = async (operation) => { try { await operation(); return 'ok' } catch (error) { return error?.code ?? String(error?.message ?? error).slice(0, 120) } }
  const dbCode = (e) => e?.code ?? (String(e?.message ?? e).match(/\\b(P2002|P2003|23505|23514|23P01)\\b/u)?.[1] ?? String(e?.message ?? e).slice(0, 80))
`

test('TURNOS PostgreSQL: availability comes from the agenda; a general turno only fits a real free slot; two people cannot book the same slot (409 SLOT_OCCUPIED)', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('ana', 'Ana Gómez ' + run)
      const c1 = await cuenta('c1', 'Cliente Uno'); const c2 = await cuenta('c2', 'Cliente Dos')
      const libre = await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: dia })
      out.libre = [libre.slots.length, libre.slots[0].inicio === a('09:00'), libre.slots.at(-1).inicio === a('17:00'), libre.duracionMinutos]
      out.otroServicio = (await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: otroOficio.id, fecha: dia })).slots.length
      out.fechaInvalida = await code(() => turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: 'mañana' }))
      // A time that is not a slot of the agenda (invented by a client, the assistant or a form).
      out.fueraDeAgenda = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('03:00'), clienteId: c1.id, clienteTenantId: c1.tenantId }))
      out.desalineado = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('10:07'), clienteId: c1.id, clienteTenantId: c1.tenantId }))
      out.pasado = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: '2020-01-06T13:00:00.000Z', clienteId: c1.id }))
      out.servicioAjeno = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: otroOficio.id, inicio: a('10:00'), clienteId: c1.id }))
      // Two clients, the same slot, at the same time: exactly one wins.
      const carrera = await Promise.all([c1, c2].map((c) => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('10:00'), clienteId: c.id, clienteTenantId: c.tenantId }).then(() => 'ok', (e) => e.code + ':' + e.status)))
      out.carrera = carrera.sort()
      out.filas = await prisma.reserva.count({ where: { tenantId: p.tenantId } })
      // Afterwards the slot (and every slot overlapping it) is no longer offered.
      const despues = (await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: dia })).slots.map((s) => s.inicio)
      out.despues = [despues.includes(a('10:00')), despues.includes(a('09:15')), despues.includes(a('10:45')), despues.includes(a('09:00')), despues.includes(a('11:00'))]
      out.tercero = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('10:00'), clienteNombre: 'Invitada' }))
      // Cancelling frees the slot.
      const reserva = await prisma.reserva.findFirst({ where: { tenantId: p.tenantId } })
      await turnos.cambiarEstadoTurno({ reservaId: reserva.id, tenantId: p.tenantId, nuevoEstado: 'cancelled' })
      out.trasCancelar = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('10:00'), clienteNombre: 'Invitada' }))
      // Weekly hours edited by the provider change what is offered (never the taken turnos).
      const diaSemana = new Date(dia + 'T12:00:00.000Z').getUTCDay()
      out.horariosInvalidos = await code(() => turnos.guardarHorariosPrestador(p.tenantId, [{ diaSemana, horaInicio: '09:00', horaFin: '12:00' }, { diaSemana, horaInicio: '11:00', horaFin: '13:00' }]))
      await turnos.guardarHorariosPrestador(p.tenantId, [{ diaSemana, horaInicio: '14:00', horaFin: '16:00' }])
      out.horarios = await turnos.horariosPrestador(p.tenantId)
      out.nuevaAgenda = (await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: dia })).slots.map((s) => s.inicio)
      out.reservasIntactas = await prisma.reserva.count({ where: { tenantId: p.tenantId, estado: 'confirmed' } })
      // A hidden profile takes no public bookings.
      const oculto = await prestador('oculto', 'Oculto ' + run, { visible: false })
      out.oculto = [await code(() => turnos.disponibilidadPublica({ prestadorId: oculto.perfilId, oficioId: oficio.id, fecha: dia })), await code(() => turnos.reservarTurno({ prestadorId: oculto.perfilId, oficioId: oficio.id, inicio: a('10:00'), clienteNombre: 'X' }))]
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify({ ...out, esperadoNuevaAgenda: ['14:00', '14:15', '14:30', '14:45', '15:00'].map(a) }))
  `)
  assert.deepEqual(r.libre, [33, true, true, 60], '9:00 to 17:00 every 15 minutes for a 60 minute service')
  assert.equal(r.otroServicio, 0, 'a service the provider does not offer has no turnos')
  assert.equal(r.fechaInvalida, 'INVALID_DATE')
  assert.equal(r.fueraDeAgenda, 'SLOT_NOT_AVAILABLE')
  assert.equal(r.desalineado, 'SLOT_NOT_AVAILABLE')
  assert.equal(r.pasado, 'PAST_DATE')
  assert.equal(r.servicioAjeno, 'NOT_FOUND')
  assert.deepEqual(r.carrera, ['SLOT_OCCUPIED:409', 'ok'], 'exactly one of two simultaneous bookings is stored')
  assert.equal(r.filas, 1)
  assert.deepEqual(r.despues, [false, false, false, true, true], 'the taken slot and the ones overlapping it are gone')
  assert.equal(r.tercero, 'SLOT_OCCUPIED')
  assert.equal(r.trasCancelar, 'ok', 'a cancelled turno frees its slot')
  assert.equal(r.horariosInvalidos, 'INVALID_PARAMS')
  assert.equal(r.horarios.length, 1)
  assert.deepEqual(r.nuevaAgenda, r.esperadoNuevaAgenda)
  assert.equal(r.reservasIntactas, 1, 'changing the hours never touches a taken turno')
  assert.deepEqual(r.oculto, ['NOT_FOUND', 'NOT_FOUND'])
})

test('TURNOS admin PostgreSQL + HTTP: providers, services and clients are found by name; "turno general" uses real availability; "forzar" needs an audited reason and still cannot overlap; platform administration only', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const ADMIN = { subjectId: run + '-admin', sessionId: 's', tenantId: 'plataforma', roles: [], permissions: ['tus:providers:admin'], correlationId: 'corr-admin' }
    const app = express()
    app.use(express.json())
    let p, p2
    const contextos = () => ({ 'tok-admin': ADMIN, 'tok-prestador': { subjectId: 'u', sessionId: 's', tenantId: p.tenantId, roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c' }, 'tok-otro-prestador': { subjectId: 'u2', sessionId: 's', tenantId: p2.tenantId, roles: ['owner'], permissions: ['tus:marketplace:write', 'tus:calendar:write'], correlationId: 'c' } })
    app.use(crearRouterTurnos({ servicio: turnos, sessions: { resolve: async (token) => contextos()[token] ?? null } }))
    const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const call = async (method, path, token, body) => {
      const response = await fetch('http://127.0.0.1:' + servidor.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    try {
      p = await prestador('beto', 'Beto Ruiz ' + run)
      p2 = await prestador('caro', 'Caro Díaz ' + run)
      const cliente = await cuenta('cli', 'Laura Martínez ' + run)
      await prisma.user.update({ where: { id: (await prisma.account.findUnique({ where: { id: cliente.id } })).userId }, data: { phoneNumber: '+549379' + String(1000000 + Math.floor(Math.random() * 8999999)), phoneVerifiedAt: new Date() } })
      // Authorization: platform administration only.
      out.sinSesion = (await call('GET', '/tus/v1/admin/turnos/prestadores?q=beto')).status
      out.prestadorNoEsAdmin = [(await call('GET', '/tus/v1/admin/turnos/prestadores?q=beto', 'tok-prestador')).status, (await call('GET', '/tus/v1/admin/turnos/clientes?q=laura', 'tok-otro-prestador')).status, (await call('POST', '/tus/v1/admin/turnos', 'tok-otro-prestador', { tipo: 'forzado' })).status]
      // Search by name: no ids typed anywhere.
      const encontrados = await call('GET', '/tus/v1/admin/turnos/prestadores?q=' + encodeURIComponent('beto ruiz ' + run), 'tok-admin')
      out.prestadores = encontrados.body.items.map((i) => [i.id === p.perfilId, i.nombre.startsWith('Beto Ruiz'), i.aceptaTurnos])
      const servicios = await call('GET', '/tus/v1/admin/turnos/prestadores/' + p.perfilId + '/servicios', 'tok-admin')
      out.servicios = servicios.body.items.map((s) => [s.oficioId === oficio.id, s.nombre === oficio.nombre, s.turnosHabilitados, s.duracionMinutos, s.precioBase])
      const clientes = await call('GET', '/tus/v1/admin/turnos/clientes?q=' + encodeURIComponent('laura martínez ' + run), 'tok-admin')
      out.clientes = clientes.body.items.map((c) => [c.cuentaId === cliente.id, c.email === cliente.email, c.telefono.includes('•') && c.telefono.replace(/\\D/gu, '').length < 11])
      out.clienteCorto = (await call('GET', '/tus/v1/admin/turnos/clientes?q=l', 'tok-admin')).body.items.length
      const disponibilidad = await call('GET', '/tus/v1/admin/turnos/disponibilidad?prestadorId=' + p.perfilId + '&oficioId=' + oficio.id + '&fecha=' + dia, 'tok-admin')
      out.disponibilidad = [disponibilidad.status, disponibilidad.body.slots.length]
      // Turno general for a registered client: identity read from the database, not from the form.
      const general = await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'general', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('11:00'), cliente: { tipo: 'registrado', cuentaId: cliente.id } })
      out.general = [general.status, general.body.clienteCuentaId === cliente.id, general.body.clienteNombre.startsWith('Laura Martínez'), general.body.esInvitado, general.body.forzadoFueraHorario, general.body.creadoPorAdminId === ADMIN.subjectId, general.body.prestadorNombre.startsWith('Beto Ruiz')]
      const repetido = await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'general', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('11:00'), cliente: { tipo: 'invitado', nombre: 'Otra Persona' } })
      out.repetido = [repetido.status, repetido.body.code]
      const fueraDeHorario = await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'general', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('22:00'), cliente: { tipo: 'invitado', nombre: 'Otra Persona' } })
      out.generalFueraDeHorario = [fueraDeHorario.status, fueraDeHorario.body.code]
      out.sinCliente = (await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'general', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('12:00'), cliente: { tipo: 'invitado', nombre: ' ' } })).body.code
      out.clienteInexistente = (await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'general', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('12:00'), cliente: { tipo: 'registrado', cuentaId: 'cuenta-que-no-existe' } })).status
      out.campoDesconocido = (await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'general', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('12:00'), cliente: { tipo: 'invitado', nombre: 'X Y' }, adminId: 'otro-admin' })).status
      // Forced turno: reason mandatory, any future time, never an overlap.
      const sinMotivo = await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'forzado', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('22:00'), cliente: { tipo: 'invitado', nombre: 'Urgencia Nocturna' } })
      out.sinMotivo = [sinMotivo.status, sinMotivo.body.code]
      const forzado = await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'forzado', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('22:00'), cliente: { tipo: 'invitado', nombre: 'Urgencia Nocturna', telefono: '3794 111222' }, motivo: 'Urgencia autorizada por el prestador' })
      out.forzado = [forzado.status, forzado.body.forzadoFueraHorario, forzado.body.motivoForzado, forzado.body.creadoPorAdminId === ADMIN.subjectId, forzado.body.esInvitado]
      const solapado = await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'forzado', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('22:30'), cliente: { tipo: 'invitado', nombre: 'Otra Urgencia' }, motivo: 'Segundo pedido urgente' })
      out.forzadoSolapado = [solapado.status, solapado.body.code]
      const sobreGeneral = await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'forzado', prestadorId: p.perfilId, oficioId: oficio.id, inicio: a('11:30'), cliente: { tipo: 'invitado', nombre: 'Otra Urgencia' }, motivo: 'Intento sobre un turno general' })
      out.forzadoSobreGeneral = [sobreGeneral.status, sobreGeneral.body.code]
      out.forzadoServicioAjeno = (await call('POST', '/tus/v1/admin/turnos', 'tok-admin', { tipo: 'forzado', prestadorId: p.perfilId, oficioId: otroOficio.id, inicio: a('23:00'), cliente: { tipo: 'invitado', nombre: 'Otra Urgencia' }, motivo: 'Servicio que no ofrece' })).status
      // Audit: who forced it and why, in the same transaction as the reservation.
      const auditoria = await prisma.auditEvent.findMany({ where: { eventType: 'turnos.turno_forzado', actorId: ADMIN.subjectId } })
      out.auditoria = auditoria.map((e) => [e.metadata.reservaId === forzado.body.id, e.metadata.motivo, e.outcome, e.tenantId === p.tenantId, JSON.stringify(e.metadata).includes('Urgencia Nocturna')])
      // The database itself refuses a forced turno without reason or author.
      out.checkForzado = await prisma.reserva.update({ where: { id: forzado.body.id }, data: { motivoForzado: null } }).then(() => 'ok', dbCode)
      // List: names of provider and service, filtered by provider.
      const lista = await call('GET', '/tus/v1/admin/turnos?prestadorId=' + p.perfilId + '&tamano=10', 'tok-admin')
      out.lista = [lista.body.total, lista.body.items.every((t) => t.prestadorNombre.startsWith('Beto Ruiz') && t.oficioNombre === oficio.nombre && t.prestadorId === p.perfilId)]
      out.listaDesconocido = (await call('GET', '/tus/v1/admin/turnos?prestadorId=no-existe', 'tok-admin')).body.total
      // Provider endpoints act on the profile of THEIR tenant: a profile id in the body is ignored.
      const config = await call('PUT', '/tus/v1/prestador/servicios/' + oficio.id + '/turnos-config', 'tok-otro-prestador', { perfilId: p.perfilId, duracionMinutos: 30 })
      const duraciones = await prisma.perfilServicio.findMany({ where: { perfilId: { in: [p.perfilId, p2.perfilId] } }, orderBy: { perfilId: 'asc' } })
      out.idor = [config.status, duraciones.find((s) => s.perfilId === p.perfilId).duracionMinutos, duraciones.find((s) => s.perfilId === p2.perfilId).duracionMinutos]
      out.propios = (await call('GET', '/tus/v1/prestador/turnos/servicios', 'tok-prestador')).body.items.length
      out.propiaDisponibilidad = (await call('GET', '/tus/v1/prestador/turnos/disponibilidad?oficioId=' + oficio.id + '&fecha=' + dia, 'tok-prestador')).status
    } finally { await new Promise((resolve) => servidor.close(resolve)); await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.sinSesion, 401)
  assert.deepEqual(r.prestadorNoEsAdmin, [403, 403, 403], 'no tenant role or calendar permission grants the administration of turnos')
  assert.deepEqual(r.prestadores, [[true, true, true]])
  assert.deepEqual(r.servicios, [[true, true, true, 60, 15000]], 'only the services of that provider')
  assert.deepEqual(r.clientes, [[true, true, true]], 'the client is found by name and its phone is masked')
  assert.equal(r.clienteCorto, 0, 'a one-letter search returns nothing')
  assert.deepEqual(r.disponibilidad, [200, 33])
  assert.deepEqual(r.general, [201, true, true, false, false, true, true])
  assert.deepEqual(r.repetido, [409, 'SLOT_OCCUPIED'])
  assert.deepEqual(r.generalFueraDeHorario, [409, 'SLOT_NOT_AVAILABLE'], 'a general turno cannot be placed outside the published hours')
  assert.equal(r.sinCliente, 'CLIENT_REQUIRED')
  assert.equal(r.clienteInexistente, 404)
  assert.equal(r.campoDesconocido, 422, 'the administrator is the session, never a body field')
  assert.deepEqual(r.sinMotivo, [400, 'MOTIVO_REQUIRED'])
  assert.deepEqual(r.forzado, [201, true, 'Urgencia autorizada por el prestador', true, true])
  assert.deepEqual(r.forzadoSolapado, [409, 'SLOT_OCCUPIED'], 'a forced turno cannot overlap another forced turno')
  assert.deepEqual(r.forzadoSobreGeneral, [409, 'SLOT_OCCUPIED'], 'a forced turno cannot overlap a general turno')
  assert.equal(r.forzadoServicioAjeno, 404)
  assert.deepEqual(r.auditoria, [[true, 'Urgencia autorizada por el prestador', 'success', true, false]], 'the audit has the reason and the author, never the client\'s name')
  assert.match(r.checkForzado, /23514|ck_reservas_forzado_auditado|check/iu)
  assert.deepEqual(r.lista, [2, true])
  assert.equal(r.listaDesconocido, 0)
  assert.deepEqual(r.idor, [200, 60, 30], 'the body cannot point a provider at another provider\'s profile')
  assert.equal(r.propios, 1)
  assert.equal(r.propiaDisponibilidad, 200)
})

test('PERFIL PostgreSQL: seeded geography, persisted profile, one person per document, complete flag backed by a CHECK; admin list searches and filters in SQL', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const paises = await perfiles.paises()
      const provincias = await perfiles.provincias('ar')
      const corrientes = await perfiles.localidades('ar-w', '')
      out.geografia = [paises.map((p) => p.codigoIso), provincias.length, provincias.some((p) => p.nombre === 'Corrientes'), corrientes.some((l) => l.id === 'corrientes-capital' && l.latitud !== null), corrientes.some((l) => l.nombre === 'Goya'), (await perfiles.localidades('ar-h', 'resis')).map((l) => l.nombre)]
      const goya = corrientes.find((l) => l.nombre === 'Goya')
      const laura = await cuenta('laura', 'Laura Martínez'); const pedro = await cuenta('pedro', 'Pedro Gómez'); const sinPerfil = await cuenta('nuevo', 'Sin Perfil')
      const dni = String(20000000 + Math.floor(Math.random() * 9999999))
      const datos = { nombre: 'Laura', apellido: 'Martínez', tipoDocumento: 'DNI', numeroDocumento: dni.slice(0, 2) + '.' + dni.slice(2, 5) + '.' + dni.slice(5), localidadId: goya.id, calle: 'Colón', numero: '742', codigoPostal: '3450' }
      out.antes = (await perfiles.estado(laura.id)).profileComplete
      const guardado = await perfiles.actualizar(laura.id, datos)
      out.guardado = guardado.ok && [guardado.perfil.perfilCompleto, guardado.perfil.numeroDocumento === dni, guardado.perfil.residencia.localidadNombre, guardado.perfil.residencia.provinciaNombre, guardado.perfil.residencia.paisNombre, guardado.perfil.centroMapa.origen, guardado.perfil.nombreVisible]
      out.estado = await perfiles.estado(laura.id)
      out.duplicado = (await perfiles.actualizar(pedro.id, { ...datos, nombre: 'Pedro', apellido: 'Gómez' })).code
      const userOf = async (accountId) => (await prisma.account.findUnique({ where: { id: accountId } })).userId
      out.checkCompleto = await prisma.user.update({ where: { id: await userOf(sinPerfil.id) }, data: { profileComplete: true } }).then(() => 'ok', dbCode)
      out.checkDocumento = await prisma.user.update({ where: { id: await userOf(sinPerfil.id) }, data: { documentType: 'DNI', documentNumber: '12.345.678' } }).then(() => 'ok', dbCode)
      out.fkLocalidad = await prisma.user.update({ where: { id: await userOf(sinPerfil.id) }, data: { localidadId: 'no-existe' } }).then(() => 'ok', dbCode)
      // Admin list: search and filters run in PostgreSQL.
      const fuente = new CuentasAdminPrisma(prisma)
      const base = { pagina: 1, tamano: 10, estado: '', rol: '', adminEmails: [], prestadorTenants: [], telefono: '' }
      const ids = (resultado) => resultado.items.map((i) => i.id)
      const porDni = await fuente.listar({ ...base, q: dni })
      out.porDni = [ids(porDni).includes(laura.id), porDni.total, porDni.items[0].documento, porDni.items[0].perfilCompleto, porDni.items[0].ubicacion]
      out.porDniFormateado = ids(await fuente.listar({ ...base, q: datos.numeroDocumento })).includes(laura.id)
      out.porEmail = ids(await fuente.listar({ ...base, q: run + '-pedro' })).join() === pedro.id
      const completos = await fuente.listar({ ...base, q: run, perfil: 'completo' })
      const incompletos = await fuente.listar({ ...base, q: run, perfil: 'incompleto' })
      out.porPerfil = [ids(completos).join() === laura.id, incompletos.total, ids(incompletos).includes(laura.id)]
      out.porLocalidad = [ids(await fuente.listar({ ...base, q: run, localidadId: goya.id })).join() === laura.id, (await fuente.listar({ ...base, q: run, localidadId: 'corrientes-capital' })).total]
      out.porProvincia = [(await fuente.listar({ ...base, q: run, provinciaId: 'ar-w' })).total, (await fuente.listar({ ...base, q: run, provinciaId: 'ar-h' })).total, (await fuente.listar({ ...base, q: run, paisId: 'ar' })).total]
      const pagina = await fuente.listar({ ...base, q: run, tamano: 2 })
      out.paginado = [pagina.items.length, pagina.total]
      out.admin = await perfiles.perfilAdmin(laura.id)
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.geografia, [['AR'], 24, true, true, true, ['Resistencia']])
  assert.equal(r.antes, false, 'a new or existing person starts with an incomplete profile')
  assert.deepEqual(r.guardado, [true, true, 'Goya', 'Corrientes', 'Argentina', 'localidad', 'Laura Martínez'])
  assert.equal(r.estado.profileComplete, true)
  assert.deepEqual([r.estado.mapCenter.origen, r.estado.mapCenter.etiqueta], ['localidad', 'Goya'])
  assert.equal(r.duplicado, 'DOCUMENT_ALREADY_REGISTERED')
  assert.match(r.checkCompleto, /23514|ck_user_perfil_completo|check/iu)
  assert.match(r.checkDocumento, /23514|ck_user_documento|check/iu)
  assert.match(r.fkLocalidad, /P2003|23503|fk_user_localidad|foreign key/iu)
  assert.equal(r.porDni[0], true)
  assert.equal(r.porDni[1], 1)
  assert.equal(r.porDni[2].tipo, 'DNI')
  assert.equal(r.porDni[3], true)
  assert.deepEqual(r.porDni[4], { localidad: 'Goya', provincia: 'Corrientes' })
  assert.equal(r.porDniFormateado, true, '"12.345.678" finds 12345678')
  assert.equal(r.porEmail, true)
  assert.deepEqual(r.porPerfil, [true, 2, false])
  assert.deepEqual(r.porLocalidad, [true, 0])
  assert.deepEqual(r.porProvincia, [1, 0, 1])
  assert.deepEqual(r.paginado, [2, 3], 'the page is cut in the database and the total is the filtered count')
  assert.equal(r.admin.residencia.calle, 'Colón')
})
