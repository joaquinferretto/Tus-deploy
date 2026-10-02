import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// TURNOS-AGENDA-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database. Real Prisma, real
// constraints: the weekly availability is stored in the existing calendar tables and the exclusion
// constraint of reservas is what makes a double booking impossible.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
  const { crearRouterTurnos } = await import('./apps/api/src/tus/calendar/turnos-http.ts')
  const c = await import('./packages/contracts/src/tus-turnos.ts')
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const run = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const turnos = new ServicioTurnos(prisma)
  const oficios = await prisma.oficioServicio.findMany({ where: { activo: true }, orderBy: { orden: 'asc' }, take: 2 })
  const [oficio, otroOficio] = oficios
  async function prestador(tag, nombre, opciones = {}) {
    const tenantId = run + '-tenant-' + tag
    const prestadorId = run + '-prestador-' + tag
    const ahora = new Date()
    await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: nombre, status: 'active', createdAt: ahora, updatedAt: ahora } })
    await prisma.prestador.create({ data: { id: run + '-p-' + tag, tenantId, prestadorId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
    const perfil = await prisma.perfilPublicoPrestador.create({
      data: { id: run + '-perfil-' + tag, tenantId, prestadorId, nombrePublico: nombre, oficio: oficio.id, zona: 'Centro', visible: opciones.visible ?? true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: opciones.duracion ?? 60, precioBase: 15000n }] } },
    })
    return { tenantId, prestadorId, perfilId: perfil.id }
  }
  // Monday of NEXT week in Argentina time: a whole week in the future.
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const lunes = c.sumarDias(c.lunesDe(hoy), 7)
  const fecha = (indice) => c.sumarDias(lunes, indice)
  const a = (indice, hora) => new Date(fecha(indice) + 'T' + hora + ':00.000-03:00').toISOString()
  const code = async (operation) => { try { await operation(); return 'ok' } catch (error) { return error?.code ?? String(error?.message ?? error).slice(0, 120) } }
  const dbCode = (e) => e?.code ?? (String(e?.message ?? e).match(/(P2002|P2003|23505|23514|23P01)/u)?.[1] ?? String(e?.message ?? e).slice(0, 80))
  const horas = (dia, estado = 'disponible') => dia.franjas.filter((f) => f.estado === estado).map((f) => f.hora)
  // The example of the specification: general 1 hora; jueves 30 minutos; viernes 15 minutos.
  const EJEMPLO = [
    { diaSemana: 1, horaInicio: '10:00', horaFin: '15:00' },
    { diaSemana: 2, horaInicio: '10:00', horaFin: '18:00' },
    { diaSemana: 4, horaInicio: '14:00', horaFin: '20:00', intervaloMinutos: 30 },
    { diaSemana: 5, horaInicio: '09:00', horaFin: '13:00', intervaloMinutos: 15 },
  ]
`

test('TURNOS agenda PostgreSQL: the weekly availability (general interval + own interval per day) is stored in the existing calendar tables and drives the weekly agenda, the day view and the booking check; reservations and exceptions are crossed; two clients never get the same time', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('ana', 'Ana Agenda ' + run)
      const otro = await prestador('otro', 'Otro Agenda ' + run)
      const pedir = (extra = {}) => turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: lunes, ...extra })
      const reservar = (indice, hora, nombre = 'Invitada') => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(indice, hora), clienteNombre: nombre })

      // The agenda of a new provider is created by its first request; several first requests at
      // once (two clients opening the booking together) all succeed and leave ONE calendar.
      const nuevo = await prestador('nuevo', 'Nuevo Agenda ' + run)
      // Open several connections first, so the requests really run side by side.
      await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRawUnsafe('select 1 as ok from pg_sleep(0.05)')))
      const primeras = await Promise.all(Array.from({ length: 6 }, () => turnos.agendaSemanal({ prestadorId: nuevo.perfilId, oficioId: oficio.id, desde: lunes }).then((x) => x.dias.length, (e) => 'error: ' + String(e?.message ?? e).slice(0, 80))))
      out.primeras = [primeras, await prisma.calendario.count({ where: { tenantId: nuevo.tenantId } }), await prisma.reglaCalendario.count({ where: { tenantId: nuevo.tenantId } })]

      // Default agenda of a new provider: Monday to Friday 9 to 18, every 15 minutes.
      out.inicial = await turnos.disponibilidadSemanal(p.tenantId)
      out.intervaloInvalido = [
        await code(() => turnos.guardarDisponibilidadSemanal(p.tenantId, { intervaloGeneral: 45, horarios: EJEMPLO })),
        await code(() => turnos.guardarDisponibilidadSemanal(p.tenantId, { intervaloGeneral: 60, horarios: [{ diaSemana: 1, horaInicio: '10:00', horaFin: '15:00', intervaloMinutos: 20 }] })),
      ]
      out.guardada = await turnos.guardarDisponibilidadSemanal(p.tenantId, { intervaloGeneral: 60, horarios: EJEMPLO })
      const calendario = await prisma.calendario.findFirst({ where: { tenantId: p.tenantId } })
      const reglas = await prisma.reglaCalendario.findMany({ where: { calendarioId: calendario.id }, orderBy: { diaSemana: 'asc' } })
      out.enBase = [calendario.granularidadMinutos, reglas.map((regla) => [regla.diaSemana, regla.horaInicio, regla.horaFin, regla.intervaloMinutos])]
      out.unSoloCalendario = await prisma.calendario.count({ where: { tenantId: p.tenantId } })
      // The database itself refuses an interval outside the list.
      out.checkIntervalo = await prisma.reglaCalendario.update({ where: { id: reglas[0].id }, data: { intervaloMinutos: 45 } }).then(() => 'ok', dbCode)

      // Weekly agenda for the 60 minute service.
      const semana = await pedir()
      out.semana = [semana.desde === lunes, semana.hasta === fecha(6), semana.duracionMinutos, semana.dias.length, semana.dias.map((d) => d.fecha).join() === [0, 1, 2, 3, 4, 5, 6].map(fecha).join()]
      out.estados = semana.dias.map((d) => d.estado)
      out.lunes = horas(semana.dias[0]); out.martes = horas(semana.dias[1]); out.jueves = horas(semana.dias[3]); out.viernes = horas(semana.dias[4])
      out.noLaborales = [semana.dias[2].franjas.length, semana.dias[5].franjas.length, semana.dias[6].franjas.length]
      // The day view offers exactly the available starts of the weekly agenda (one generator).
      const dia = await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: fecha(3) })
      out.mismoGenerador = dia.slots.map((s) => s.inicio).join() === semana.dias[3].franjas.filter((f) => f.estado === 'disponible').map((f) => f.inicio).join()
      out.diaLibre = (await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: fecha(2) })).slots.length

      // The backend is the authority: only a start of the agenda can be booked.
      out.fueraDeIntervalo = await code(() => reservar(0, '10:30'))
      out.diaNoLaboral = await code(() => reservar(2, '10:00'))
      out.noEntra = await code(() => reservar(0, '14:30'))
      out.ultimoQueEntra = await code(() => reservar(0, '14:00'))
      out.intervaloPropio = await code(() => reservar(3, '14:30'))
      const conReservas = await pedir()
      out.juevesOcupado = horas(conReservas.dias[3], 'ocupado')
      out.juevesLibre = horas(conReservas.dias[3]).slice(0, 2)
      out.lunesOcupado = horas(conReservas.dias[0], 'ocupado')
      out.sinDatosDelCliente = Object.keys(conReservas.dias[3].franjas[0]).sort()
      out.ocupadoNoSeReserva = await code(() => reservar(3, '15:00'))

      // Another week: same weekly hours, no reservations of this one; out of range weeks are refused.
      const siguiente = await pedir({ desde: fecha(7) })
      out.semanaSiguiente = [siguiente.desde === fecha(7), horas(siguiente.dias[3], 'ocupado').length, horas(siguiente.dias[3]).length, horas(siguiente.dias[0]).length]
      out.fueraDeRango = [await code(() => pedir({ desde: c.sumarDias(hoy, -8) })), await code(() => pedir({ desde: c.sumarDias(hoy, 181) })), await code(() => pedir({ desde: 'lunes' }))]
      const actual = await pedir({ desde: c.lunesDe(hoy) })
      out.semanaActual = [actual.dias.length, actual.dias.flatMap((d) => d.franjas).filter((f) => Date.parse(f.inicio) <= Date.now()).every((f) => f.estado === 'pasado')]

      // Concurrency: six clients, the same time, at once -> exactly one reservation.
      const carrera = await Promise.all(Array.from({ length: 6 }, (_, i) => reservar(4, '09:00', 'Cliente ' + i).then(() => 'ok', (e) => e.code + ':' + e.status)))
      out.carrera = [carrera.filter((x) => x === 'ok').length, carrera.filter((x) => x === 'SLOT_OCCUPIED:409').length]
      // Different starts that overlap each other (60 minute service every 15 minutes): one wins.
      const solapadas = await Promise.all(['10:15', '10:30', '10:45', '11:00'].map((hora) => reservar(4, hora).then(() => 'ok', (e) => e.code + ':' + e.status)))
      out.solapadas = [solapadas.filter((x) => x === 'ok').length, solapadas.filter((x) => x === 'SLOT_OCCUPIED:409').length]
      out.filasViernes = await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: { gte: new Date(a(4, '00:00')), lt: new Date(a(5, '00:00')) } } })

      // Exceptions: a closed day (holiday / vacation / manual block) without touching the weekly hours.
      out.bloqueoInvalido = await code(() => turnos.bloquearHorario({ prestadorTenantId: p.tenantId, inicio: a(1, '12:00'), fin: a(1, '10:00'), motivo: 'x' }))
      const bloqueo = await turnos.bloquearHorario({ prestadorTenantId: p.tenantId, inicio: a(1, '00:00'), fin: a(2, '00:00'), motivo: 'Feriado' })
      const parcial = await turnos.bloquearHorario({ prestadorTenantId: p.tenantId, inicio: a(0, '10:00'), fin: a(0, '12:00'), motivo: 'Trámite' })
      const bloqueada = await pedir()
      out.feriado = [bloqueada.dias[1].estado, horas(bloqueada.dias[1]).length, horas(bloqueada.dias[1], 'bloqueado').length]
      out.horarioEspecial = [bloqueada.dias[0].estado, horas(bloqueada.dias[0], 'bloqueado'), horas(bloqueada.dias[0])]
      out.bloqueadoNoSeReserva = await code(() => reservar(1, '10:00'))
      out.bloqueos = (await turnos.bloqueosPrestador(p.tenantId)).map((b) => [b.id === bloqueo.id || b.id === parcial.id, b.motivo])
      out.bloqueosAjenos = (await turnos.bloqueosPrestador(otro.tenantId)).length
      out.quitarAjeno = await code(() => turnos.quitarBloqueo(otro.tenantId, bloqueo.id))
      await turnos.quitarBloqueo(p.tenantId, bloqueo.id)
      out.quitarDosVeces = await code(() => turnos.quitarBloqueo(p.tenantId, bloqueo.id))
      const liberada = await pedir()
      out.trasQuitar = [liberada.dias[1].estado, horas(liberada.dias[1]).length]
      out.reglasIntactas = await prisma.reglaCalendario.count({ where: { calendarioId: calendario.id } })

      // The duration is the one of the chosen tarifa: a 2 hour tarifa has fewer starts.
      const [larga] = await turnos.guardarTarifasPrestador({ tenantId: p.tenantId, perfilId: p.perfilId, oficioId: oficio.id, tarifas: [{ nombre: 'Sesión larga', duracionMinutos: 120, precio: 30000n }] })
      const conTarifa = await pedir({ desde: fecha(7), tarifaId: larga.id })
      out.tarifa = [conTarifa.duracionMinutos, horas(conTarifa.dias[0]), horas(conTarifa.dias[3]).at(-1), horas(conTarifa.dias[4]).at(-1)]
      out.tarifaAjena = await code(() => pedir({ tarifaId: 'tar-inexistente' }))

      // Changing the weekly availability never touches a taken turno.
      const antes = await prisma.reserva.count({ where: { tenantId: p.tenantId, estado: 'confirmed' } })
      await turnos.guardarDisponibilidadSemanal(p.tenantId, { intervaloGeneral: 120, horarios: [{ diaSemana: 6, horaInicio: '08:00', horaFin: '12:00' }] })
      const nueva = await pedir({ desde: fecha(7) })
      out.nueva = [nueva.dias.map((d) => d.estado), horas(nueva.dias[5]), (await turnos.disponibilidadSemanal(p.tenantId)).intervaloGeneral]
      out.reservasIntactas = antes === (await prisma.reserva.count({ where: { tenantId: p.tenantId, estado: 'confirmed' } })) && antes > 0
      out.sinServicio = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: otroOficio.id, desde: lunes }).then((x) => [x.dias.length, Boolean(x.mensaje)])
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.primeras, [[7, 7, 7, 7, 7, 7], 1, 5], 'simultaneous first requests create the agenda once')
  assert.equal(r.inicial.intervaloGeneral, 15)
  assert.deepEqual(r.inicial.horarios.map((h) => [h.diaSemana, h.horaInicio, h.horaFin, h.intervaloMinutos]), [1, 2, 3, 4, 5].map((dia) => [dia, '09:00', '18:00', null]))
  assert.deepEqual(r.intervaloInvalido, ['INVALID_PARAMS', 'INVALID_PARAMS'])
  assert.equal(r.guardada.intervaloGeneral, 60)
  assert.deepEqual(r.enBase, [60, [[1, '10:00', '15:00', null], [2, '10:00', '18:00', null], [4, '14:00', '20:00', 30], [5, '09:00', '13:00', 15]]], 'general interval on the calendar, own interval on the rules of the day')
  assert.equal(r.unSoloCalendario, 1, 'the existing calendar is reused')
  assert.equal(r.checkIntervalo, '23514', 'ck_reglas_calendario_intervalo')
  assert.deepEqual(r.semana, [true, true, 60, 7, true])
  assert.deepEqual(r.estados, ['laboral', 'laboral', 'no_laboral', 'laboral', 'laboral', 'no_laboral', 'no_laboral'])
  assert.deepEqual(r.lunes, ['10:00', '11:00', '12:00', '13:00', '14:00'])
  assert.deepEqual(r.martes, ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'])
  assert.deepEqual(r.jueves, ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00'], 'own 30 minute interval; 19:30 + 1 hour would end after 20:00')
  assert.deepEqual([r.viernes.length, r.viernes[0], r.viernes[1], r.viernes.at(-1)], [13, '09:00', '09:15', '12:00'])
  assert.deepEqual(r.noLaborales, [0, 0, 0])
  assert.equal(r.mismoGenerador, true)
  assert.equal(r.diaLibre, 0)
  assert.equal(r.fueraDeIntervalo, 'SLOT_NOT_AVAILABLE', '10:30 is not a start of a day with a 1 hour interval')
  assert.equal(r.diaNoLaboral, 'SLOT_NOT_AVAILABLE')
  assert.equal(r.noEntra, 'SLOT_NOT_AVAILABLE')
  assert.equal(r.ultimoQueEntra, 'ok')
  assert.equal(r.intervaloPropio, 'ok')
  assert.deepEqual(r.juevesOcupado, ['14:00', '14:30', '15:00'], 'the whole duration of the reservation is taken')
  assert.deepEqual(r.juevesLibre, ['15:30', '16:00'])
  assert.deepEqual(r.lunesOcupado, ['14:00'])
  assert.deepEqual(r.sinDatosDelCliente, ['estado', 'fin', 'hora', 'inicio'], 'a taken time never exposes who took it')
  assert.equal(r.ocupadoNoSeReserva, 'SLOT_OCCUPIED')
  assert.deepEqual(r.semanaSiguiente, [true, 0, 11, 5])
  assert.deepEqual(r.fueraDeRango, ['INVALID_DATE', 'INVALID_DATE', 'INVALID_DATE'])
  assert.deepEqual(r.semanaActual, [7, true])
  assert.deepEqual(r.carrera, [1, 5], 'exactly one of six simultaneous bookings of the same time is stored')
  assert.deepEqual(r.solapadas, [1, 3], 'overlapping starts cannot both be stored')
  assert.equal(r.filasViernes, 2)
  assert.equal(r.bloqueoInvalido, 'INVALID_DATE')
  assert.deepEqual(r.feriado, ['bloqueado', 0, 8])
  assert.deepEqual(r.horarioEspecial, ['laboral', ['10:00', '11:00'], ['12:00', '13:00']])
  assert.equal(r.bloqueadoNoSeReserva, 'SLOT_NOT_AVAILABLE')
  assert.deepEqual(r.bloqueos, [[true, 'Trámite'], [true, 'Feriado']])
  assert.equal(r.bloqueosAjenos, 0)
  assert.equal(r.quitarAjeno, 'NOT_FOUND', 'a block of another provider cannot be removed')
  assert.equal(r.quitarDosVeces, 'NOT_FOUND')
  assert.deepEqual(r.trasQuitar, ['laboral', 8], 'removing the exception restores the usual hours')
  assert.equal(r.reglasIntactas, 4, 'exceptions never rewrite the weekly configuration')
  assert.deepEqual(r.tarifa, [120, ['10:00', '11:00', '12:00', '13:00'], '18:00', '11:00'])
  assert.equal(r.tarifaAjena, 'INVALID_PARAMS')
  assert.deepEqual(r.nueva, [['no_laboral', 'no_laboral', 'no_laboral', 'no_laboral', 'no_laboral', 'laboral', 'no_laboral'], ['08:00', '10:00'], 120])
  assert.equal(r.reservasIntactas, true)
  assert.deepEqual(r.sinServicio, [0, true])
})

test('TURNOS agenda HTTP: the weekly agenda is public and never cached; the weekly availability and the blocks are of the session tenant only; unknown fields are refused', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const app = express()
    app.use(express.json())
    let p, p2, oculto
    const contexto = (tenantId) => ({ subjectId: 'u-' + tenantId, sessionId: 's', tenantId, roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
    const contextos = () => ({ 'tok-p': contexto(p.tenantId), 'tok-p2': contexto(p2.tenantId), 'tok-oculto': contexto(oculto.tenantId), 'tok-cliente': contexto(run + '-tenant-cliente') })
    app.use(crearRouterTurnos({ servicio: turnos, sessions: { resolve: async (token) => contextos()[token] ?? null } }))
    const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const call = async (method, path, token, body) => {
      const response = await fetch('http://127.0.0.1:' + servidor.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json().catch(() => null) }
    }
    try {
      p = await prestador('http', 'Http Agenda ' + run)
      p2 = await prestador('http2', 'Http Dos ' + run)
      oculto = await prestador('oculto', 'Oculto Agenda ' + run, { visible: false })
      const agenda = '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/agenda?oficioId=' + oficio.id + '&desde=' + lunes
      const publica = await call('GET', agenda)
      out.publica = [publica.status, publica.cache, publica.body.dias.length, publica.body.duracionMinutos]
      out.sinParametros = (await call('GET', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/agenda?oficioId=' + oficio.id)).status
      out.fechaMala = await call('GET', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/agenda?oficioId=' + oficio.id + '&desde=2020-01-06').then((x) => [x.status, x.body.code])
      out.perfilOculto = (await call('GET', '/tus/v1/public/prestadores/' + oculto.perfilId + '/turnos/agenda?oficioId=' + oficio.id + '&desde=' + lunes)).status
      out.propiaOculta = await call('GET', '/tus/v1/prestador/turnos/agenda?oficioId=' + oficio.id + '&desde=' + lunes, 'tok-oculto').then((x) => [x.status, x.body.dias.length])
      out.propiaSinSesion = (await call('GET', '/tus/v1/prestador/turnos/agenda?oficioId=' + oficio.id + '&desde=' + lunes)).status
      out.sinPerfil = (await call('GET', '/tus/v1/prestador/turnos/agenda?oficioId=' + oficio.id + '&desde=' + lunes, 'tok-cliente')).status

      // Weekly availability of the session tenant.
      out.horariosSinSesion = [(await call('GET', '/tus/v1/prestador/turnos/horarios')).status, (await call('PUT', '/tus/v1/prestador/turnos/horarios', undefined, { horarios: [] })).status]
      const inicial = await call('GET', '/tus/v1/prestador/turnos/horarios', 'tok-p')
      out.inicial = [inicial.status, inicial.body.intervaloGeneral, inicial.body.items.length]
      out.campoDesconocido = await call('PUT', '/tus/v1/prestador/turnos/horarios', 'tok-p', { intervaloGeneral: 60, horarios: EJEMPLO, tenantId: p2.tenantId }).then((x) => [x.status, x.body.code])
      out.intervaloInvalido = await call('PUT', '/tus/v1/prestador/turnos/horarios', 'tok-p', { intervaloGeneral: 45, horarios: EJEMPLO }).then((x) => [x.status, x.body.code])
      out.diaInvalido = await call('PUT', '/tus/v1/prestador/turnos/horarios', 'tok-p', { intervaloGeneral: 60, horarios: [{ diaSemana: 1, horaInicio: '10:00', horaFin: '15:00', intervaloMinutos: 45 }] }).then((x) => [x.status, x.body.code])
      const guardada = await call('PUT', '/tus/v1/prestador/turnos/horarios', 'tok-p', { intervaloGeneral: 60, horarios: EJEMPLO })
      out.guardada = [guardada.status, guardada.body.intervaloGeneral, guardada.body.items.map((h) => [h.diaSemana, h.intervaloMinutos])]
      // Only the hours (the former body): the general interval stays.
      const soloHoras = await call('PUT', '/tus/v1/prestador/turnos/horarios', 'tok-p', { horarios: EJEMPLO.slice(0, 2) })
      out.soloHoras = [soloHoras.status, soloHoras.body.items.length, (await call('GET', '/tus/v1/prestador/turnos/horarios', 'tok-p')).body.intervaloGeneral]
      // The other provider was not touched.
      out.otroIntacto = await call('GET', '/tus/v1/prestador/turnos/horarios', 'tok-p2').then((x) => [x.body.intervaloGeneral, x.body.items.length])
      const trasGuardar = await call('GET', agenda)
      out.agendaTrasGuardar = trasGuardar.body.dias.map((d) => d.franjas.filter((f) => f.estado === 'disponible').length)

      // Blocks: created, listed and removed only by their owner.
      const creado = await call('POST', '/tus/v1/prestador/turnos/bloquear', 'tok-p', { inicio: a(0, '00:00'), fin: a(1, '00:00'), motivo: 'Vacaciones' })
      out.bloqueoCreado = creado.status
      out.bloqueoInvalido = await call('POST', '/tus/v1/prestador/turnos/bloquear', 'tok-p', { inicio: 'ayer', fin: 'hoy' }).then((x) => [x.status, x.body.code])
      out.listaPropia = await call('GET', '/tus/v1/prestador/turnos/bloqueos', 'tok-p').then((x) => [x.status, x.body.items.map((b) => b.motivo)])
      out.listaAjena = await call('GET', '/tus/v1/prestador/turnos/bloqueos', 'tok-p2').then((x) => x.body.items.length)
      out.listaSinSesion = (await call('GET', '/tus/v1/prestador/turnos/bloqueos')).status
      out.diaBloqueado = (await call('GET', agenda)).body.dias[0].estado
      out.reservaEnBloqueo = await call('POST', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/reservar', 'tok-cliente', { oficioId: oficio.id, inicio: a(0, '10:00') }).then((x) => [x.status, x.body.code])
      out.quitarAjeno = (await call('DELETE', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-p2')).status
      out.quitarSinSesion = (await call('DELETE', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id)).status
      out.quitar = (await call('DELETE', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-p')).status
      out.diaLiberado = (await call('GET', agenda)).body.dias[0].estado

      // Requesting through HTTP (a signed-in client): the requested time is shown as taken and a
      // second request for it gets 409. A visitor is asked to sign in.
      const reserva = { oficioId: oficio.id, inicio: a(0, '10:00') }
      out.visitante = await call('POST', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/reservar', undefined, { ...reserva, clienteNombre: 'Invitada' }).then((x) => [x.status, x.body.code])
      const dos = await Promise.all([call('POST', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/reservar', 'tok-cliente', reserva), call('POST', '/tus/v1/public/prestadores/' + p.perfilId + '/turnos/reservar', 'tok-cliente', reserva)])
      out.dosReservas = dos.map((x) => x.status + ':' + (x.body.code ?? 'ok')).sort()
      const final = (await call('GET', agenda)).body.dias[0].franjas.find((f) => f.hora === '10:00')
      out.ocupadoEnAgenda = [final.estado, Object.keys(final).sort()]
    } finally { servidor.close(); await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.publica, [200, 'private, no-store', 7, 60])
  assert.equal(r.sinParametros, 400)
  assert.deepEqual(r.fechaMala, [400, 'INVALID_DATE'])
  assert.equal(r.perfilOculto, 404)
  assert.deepEqual(r.propiaOculta, [200, 7], 'the owner sees its own agenda even with a hidden profile')
  assert.equal(r.propiaSinSesion, 401)
  assert.equal(r.sinPerfil, 404)
  assert.deepEqual(r.horariosSinSesion, [401, 401])
  assert.deepEqual(r.inicial, [200, 15, 5])
  assert.deepEqual(r.campoDesconocido, [422, 'INVALID_PARAMS'], 'a tenant sent in the body is refused, never obeyed')
  assert.deepEqual(r.intervaloInvalido, [400, 'INVALID_PARAMS'])
  assert.deepEqual(r.diaInvalido, [400, 'INVALID_PARAMS'])
  assert.deepEqual(r.guardada, [200, 60, [[1, null], [2, null], [4, 30], [5, 15]]])
  assert.deepEqual(r.soloHoras, [200, 2, 60])
  assert.deepEqual(r.otroIntacto, [15, 5])
  assert.deepEqual(r.agendaTrasGuardar, [5, 8, 0, 0, 0, 0, 0])
  assert.equal(r.bloqueoCreado, 201)
  assert.deepEqual(r.bloqueoInvalido, [400, 'INVALID_DATE'])
  assert.deepEqual(r.listaPropia, [200, ['Vacaciones']])
  assert.equal(r.listaAjena, 0)
  assert.equal(r.listaSinSesion, 401)
  assert.equal(r.diaBloqueado, 'bloqueado')
  assert.deepEqual(r.reservaEnBloqueo, [409, 'SLOT_NOT_AVAILABLE'])
  assert.equal(r.quitarAjeno, 404)
  assert.equal(r.quitarSinSesion, 401)
  assert.equal(r.quitar, 200)
  assert.equal(r.diaLiberado, 'laboral')
  assert.deepEqual(r.visitante, [401, 'LOGIN_REQUIRED'], 'a visitor cannot request a turno')
  assert.deepEqual(r.dosReservas, ['201:ok', '409:SLOT_OCCUPIED'])
  assert.deepEqual(r.ocupadoEnAgenda, ['ocupado', ['estado', 'fin', 'hora', 'inicio']])
})
