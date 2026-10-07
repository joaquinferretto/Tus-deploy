import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// AUSENCIAS-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database. A provider keeps its usual
// week and marks exceptions (a whole day, some hours, a vacation): the one slot engine takes them
// off for the Web, the booking and the assistant alike, and a block never covers a taken turno.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
  const { crearRouterTurnos } = await import('./apps/api/src/tus/calendar/turnos-http.ts')
  const { DominioAsistenteTus } = await import('./apps/api/src/tus/asistente/dominio.ts')
  const { createProviderSuspensionGuard } = await import('./apps/api/src/auth-security/modes/modos.ts')
  const c = await import('./packages/contracts/src/tus-turnos.ts')
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const run = 'au' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const turnos = new ServicioTurnos(prisma)
  const oficio = await prisma.oficioServicio.findFirst({ where: { activo: true }, orderBy: { orden: 'asc' } })
  async function prestador(tag, nombre) {
    const tenantId = run + '-tenant-' + tag
    const prestadorId = run + '-prestador-' + tag
    const ahora = new Date()
    await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: nombre, status: 'active', createdAt: ahora, updatedAt: ahora } })
    await prisma.prestador.create({ data: { id: run + '-p-' + tag, tenantId, prestadorId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
    const perfil = await prisma.perfilPublicoPrestador.create({ data: { id: run + '-perfil-' + tag, tenantId, prestadorId, nombrePublico: nombre, oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 15000n }] } } })
    return { tenantId, prestadorId, perfilId: perfil.id }
  }
  // Monday of NEXT week in Argentina time: a whole week in the future.
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const lunes = c.sumarDias(c.lunesDe(hoy), 7)
  const fecha = (indice) => c.sumarDias(lunes, indice)
  const a = (indice, hora) => new Date(fecha(indice) + 'T' + hora + ':00.000-03:00').toISOString()
  const code = async (operation) => { try { await operation(); return 'ok' } catch (error) { return error?.code ?? String(error?.message ?? error).slice(0, 120) } }
  const p = await prestador('ana', 'Ana Ausencias ' + run)
  const otro = await prestador('otro', 'Otro Ausencias ' + run)
  // Usual week: Monday 10-15, Tuesday 10-18, Thursday 14-20, Friday 9-13.
  const SEMANA = [{ diaSemana: 1, horaInicio: '10:00', horaFin: '15:00' }, { diaSemana: 2, horaInicio: '10:00', horaFin: '18:00' }, { diaSemana: 4, horaInicio: '14:00', horaFin: '20:00' }, { diaSemana: 5, horaInicio: '09:00', horaFin: '13:00' }]
  await turnos.guardarDisponibilidadSemanal(p.tenantId, { intervaloGeneral: 60, horarios: SEMANA })
  await turnos.guardarDisponibilidadSemanal(otro.tenantId, { intervaloGeneral: 60, horarios: SEMANA })
  const semana = (desde = lunes) => turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde })
  const libres = (dia) => dia.franjas.filter((f) => f.estado === 'disponible').map((f) => f.hora)
  const dia = async (indice) => libres((await semana()).dias[indice])
  const bloquear = (inicio, fin, motivo = 'Médico') => turnos.bloquearHorario({ prestadorTenantId: p.tenantId, inicio, fin, motivo })
  const manual = (indice, hora) => turnos.crearTurnoManual({ prestadorTenantId: p.tenantId, oficioId: oficio.id, inicio: a(indice, hora), clienteNombre: 'Cliente presencial' })
  const habitual = { lunes: ['10:00', '11:00', '12:00', '13:00', '14:00'], martes: ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'], jueves: ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00'], viernes: ['09:00', '10:00', '11:00', '12:00'] }
`

test('AUSENCIAS PostgreSQL: the usual week stays as it is and the exceptions (whole day, some hours, several days) take their slots off for the Web, the booking and the assistant; a slot never crosses a block; removing a block gives the slots back; the reason is private', { skip, timeout: 240_000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // 1. usual week
      const inicial = await semana()
      out.habitual = { lunes: libres(inicial.dias[0]), martes: libres(inicial.dias[1]), jueves: libres(inicial.dias[3]), viernes: libres(inicial.dias[4]) }
      // 2. whole day: Tuesday
      const todoElDia = await bloquear(a(1, '00:00'), a(2, '00:00'), 'Turno con el cardiólogo')
      const conDia = await semana()
      out.diaCompleto = { martes: libres(conDia.dias[1]), lunes: libres(conDia.dias[0]), jueves: libres(conDia.dias[3]) }
      // 12. time zone: the block is the provider's day; the days around it keep every slot
      out.vecinos = [libres(conDia.dias[0]).at(-1), libres(conDia.dias[3])[0]]
      // 3, 6, 7. some hours on Thursday 15:30-17:30: 15:00 would end inside, 17:00 starts inside
      const parcial = await bloquear(a(3, '15:30'), a(3, '17:30'))
      out.parcial = await dia(3)
      out.reservaCruzaInicio = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(3, '15:00'), clienteNombre: 'Invitada' }))
      out.reservaCruzaFin = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(3, '17:00'), clienteNombre: 'Invitada' }))
      out.reservaDentro = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(3, '16:00'), clienteNombre: 'Invitada' }))
      out.manualDentro = await code(() => manual(3, '16:00'))
      // 4. vacations: two whole weeks
      const vacaciones = await bloquear(a(7, '00:00'), a(21, '00:00'), 'Vacaciones')
      const s2 = await semana(fecha(7)); const s3 = await semana(fecha(14)); const s4 = await semana(fecha(21))
      out.vacaciones = [s2.dias.flatMap(libres).length, s3.dias.flatMap(libres).length, libres(s4.dias[0])]
      out.reservaEnVacaciones = await code(() => turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(8, '10:00'), clienteNombre: 'Invitada' }))
      // 10-11. the Web day view and the assistant read the same engine
      const web = await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: fecha(1) })
      const asistente = Object.create(DominioAsistenteTus.prototype)
      asistente.compartidos = { turnos }
      const ia = (indice) => asistente.turnosDisponibles(p.perfilId, oficio.id, fecha(indice)).then((x) => x.slots.filter((s) => s.disponible !== false).map((s) => new Date(s.inicio).toISOString()))
      out.web = web.slots.filter((s) => s.disponible !== false).length
      out.asistente = { martes: (await ia(1)).length, vacaciones: (await ia(8)).length, jueves: (await ia(3)).join() === ['14:00', '18:00', '19:00'].map((h) => a(3, h)).join(), lunes: (await ia(0)).length }
      // the reason never leaves the provider's own panel
      const publico = JSON.stringify([conDia, web, await semana(fecha(7))])
      out.motivoPrivado = !publico.includes('cardiólogo') && !publico.includes('Vacaciones') && !publico.includes('Médico')
      out.estadoPublico = [...new Set(conDia.dias[1].franjas.map((f) => f.estado))]
      const propios = await turnos.bloqueosPrestador(p.tenantId)
      out.propios = propios.map((b) => b.motivo)
      out.ajenos = (await turnos.bloqueosPrestador(otro.tenantId)).length
      // another provider with the same week is untouched
      out.otroPrestador = libres((await turnos.agendaSemanal({ prestadorId: otro.perfilId, oficioId: oficio.id, desde: lunes })).dias[1])
      // 5. removing a block gives the slots back; the weekly hours were never touched
      await turnos.quitarBloqueo(p.tenantId, todoElDia.id)
      out.trasQuitar = await dia(1)
      await turnos.quitarBloqueo(p.tenantId, parcial.id)
      out.trasQuitarParcial = await dia(3)
      out.quitarDosVeces = await code(() => turnos.quitarBloqueo(p.tenantId, parcial.id))
      out.filaConservada = (await prisma.excepcionCalendario.findUnique({ where: { id: parcial.id } })).estado
      out.semanaIntacta = (await turnos.disponibilidadSemanal(p.tenantId)).horarios.map((h) => [h.diaSemana, h.horaInicio, h.horaFin].join())
      // editing: the vacation ends a week earlier
      await turnos.editarBloqueo({ prestadorTenantId: p.tenantId, id: vacaciones.id, inicio: a(7, '00:00'), fin: a(14, '00:00'), motivo: 'Vacaciones' })
      out.trasEditar = [(await semana(fecha(7))).dias.flatMap(libres).length, libres((await semana(fecha(14))).dias[0])]
      console.log(JSON.stringify(out))
    } finally { await prisma.$disconnect() }
  `)
  const habitual = { lunes: ['10:00', '11:00', '12:00', '13:00', '14:00'], martes: ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'], jueves: ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00'], viernes: ['09:00', '10:00', '11:00', '12:00'] }
  assert.deepEqual(r.habitual, habitual)
  assert.deepEqual(r.diaCompleto, { martes: [], lunes: habitual.lunes, jueves: habitual.jueves })
  assert.deepEqual(r.vecinos, ['14:00', '14:00'])
  assert.deepEqual(r.parcial, ['14:00', '18:00', '19:00'], 'a 60 minute turno neither ends inside the block (15:00) nor starts inside it (16:00, 17:00); 14:00 ends before it and 18:00 starts after it')
  assert.notEqual(r.reservaCruzaInicio, 'ok', 'a turno that would end inside the block is refused')
  assert.notEqual(r.reservaCruzaFin, 'ok')
  assert.notEqual(r.reservaDentro, 'ok')
  assert.equal(r.manualDentro, 'SLOT_BLOCKED', 'the provider does not load a turno over its own block')
  assert.deepEqual(r.vacaciones, [0, 0, habitual.lunes], 'no slot during the vacation; the week after is the usual one')
  assert.notEqual(r.reservaEnVacaciones, 'ok')
  assert.equal(r.web, 0, 'the Web offers nothing on a blocked day')
  assert.deepEqual(r.asistente, { martes: 0, vacaciones: 0, jueves: true, lunes: 5 }, 'the assistant reads the same availability as the Web')
  assert.equal(r.motivoPrivado, true, 'a client never reads why the provider is away')
  assert.deepEqual(r.estadoPublico.includes('disponible'), false)
  assert.deepEqual(r.propios, ['Turno con el cardiólogo', 'Médico', 'Vacaciones'])
  assert.equal(r.ajenos, 0)
  assert.deepEqual(r.otroPrestador, habitual.martes)
  assert.deepEqual(r.trasQuitar, habitual.martes)
  assert.deepEqual(r.trasQuitarParcial, habitual.jueves)
  assert.equal(r.quitarDosVeces, 'NOT_FOUND')
  assert.equal(r.filaConservada, 'cancelled', 'a removed block stays as history')
  assert.deepEqual(r.semanaIntacta, ['1,10:00,15:00', '2,10:00,18:00', '4,14:00,20:00', '5,09:00,13:00'], 'an exception never rewrites the usual week')
  assert.deepEqual(r.trasEditar, [0, habitual.lunes])
})

test('AUSENCIAS PostgreSQL: a block never covers a taken turno nor cancels it; a turno and a block of the same time made at once: only one; the routes validate ranges and fields, belong to the provider of the session and are closed to a suspended provider', { skip, timeout: 240_000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // 8. a taken turno on Friday 10:00
      const turno = await manual(4, '10:00')
      out.bloqueoSobreTurno = await code(() => bloquear(a(4, '09:00'), a(4, '12:00')))
      out.diaSobreTurno = await code(() => bloquear(a(4, '00:00'), a(5, '00:00'), 'Vacaciones'))
      const tras = await prisma.reserva.findUnique({ where: { id: turno.id } })
      out.turnoIntacto = [tras.estado, await prisma.excepcionCalendario.count({ where: { tenantId: p.tenantId } })]
      out.bloqueoAlLado = await code(() => bloquear(a(4, '11:00'), a(4, '13:00')))
      // a request still unanswered does not stop the block; accepting it later looks at the block
      const pedido = await turnos.reservarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(1, '10:00'), clienteNombre: 'Invitada' })
      await prisma.reserva.update({ where: { id: pedido.id }, data: { estado: 'pending', solicitudExpiraEn: new Date(Date.now() + 3600_000) } })
      out.sobreSolicitud = [(await prisma.reserva.findUnique({ where: { id: pedido.id } })).estado, await code(() => bloquear(a(1, '09:00'), a(1, '12:00')))]
      // editing a block onto a taken turno is refused too, and the block stays where it was
      const libre = await bloquear(a(3, '14:00'), a(3, '15:00'))
      out.editarSobreTurno = await code(() => turnos.editarBloqueo({ prestadorTenantId: p.tenantId, id: libre.id, inicio: a(4, '09:30'), fin: a(4, '10:30'), motivo: 'Trámite' }))
      out.bloqueoSinMover = (await prisma.excepcionCalendario.findUnique({ where: { id: libre.id } })).fechaInicio.toISOString() === a(3, '14:00')
      // 9. a turno and a block of the same hour at the same time, several rounds
      await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRawUnsafe('select 1 as ok from pg_sleep(0.05)')))
      const rondas = []
      for (const hora of ['10:00', '11:00', '12:00', '13:00']) {
        const [t, b] = await Promise.all([code(() => manual(0, hora)), code(() => bloquear(a(0, hora), a(0, String(Number(hora.slice(0, 2)) + 1) + ':00')))])
        const desde = new Date(a(0, hora)); const hasta = new Date(desde.getTime() + 3600_000)
        const turnosEnHora = await prisma.reserva.count({ where: { tenantId: p.tenantId, estado: 'confirmed', fechaInicio: { lt: hasta }, fechaFin: { gt: desde } } })
        const bloqueosEnHora = await prisma.excepcionCalendario.count({ where: { tenantId: p.tenantId, estado: 'active', fechaInicio: { lt: hasta }, fechaFin: { gt: desde } } })
        rondas.push([[t, b].filter((x) => x === 'ok').length, turnosEnHora + bloqueosEnHora, [t, b].filter((x) => x !== 'ok').every((x) => x === 'BLOCK_HAS_BOOKINGS' || x === 'SLOT_BLOCKED')])
      }
      out.rondas = rondas
      // the routes
      const cuentas = { 'tok-p': { subjectId: 'acc-p', sessionId: 's-p', tenantId: p.tenantId, roles: [], permissions: ['tus:marketplace:write'], correlationId: 'c' }, 'tok-otro': { subjectId: 'acc-o', sessionId: 's-o', tenantId: otro.tenantId, roles: [], permissions: ['tus:marketplace:write'], correlationId: 'c' }, 'tok-susp': { subjectId: 'acc-s', sessionId: 's-s', tenantId: p.tenantId, roles: [], permissions: ['tus:marketplace:write'], correlationId: 'c' } }
      const sessions = { resolve: async (token) => cuentas[token] ?? null }
      const app = express(); app.use(express.json())
      // 16. the same guard the server mounts: a suspended provider does not operate its agenda
      app.use(createProviderSuspensionGuard({ sessions, estadoPrestador: async (context) => (context.subjectId === 'acc-s' ? 'suspended' : 'active') }))
      app.use(crearRouterTurnos({ servicio: turnos, sessions }))
      const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
      const call = async (method, path, token, body) => { const res = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c-1', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: res.status, body: await res.json().catch(() => null) } }
      const crear = (token, body) => call('POST', '/tus/v1/prestador/turnos/bloquear', token, body)
      const valido = { inicio: a(8, '00:00'), fin: a(9, '00:00'), motivo: 'Trámite' }
      // 13-14. limits and unknown fields
      const invalidos = {}
      for (const [nombre, body] of Object.entries({ alReves: { ...valido, fin: a(7, '00:00') }, igual: { ...valido, fin: valido.inicio }, masDeUnAno: { ...valido, fin: a(8 + 400, '00:00') }, fechaImposible: { ...valido, inicio: '2027-02-30T10:00:00-03:00' }, sinHora: { ...valido, inicio: 'mañana' }, motivoLargo: { ...valido, motivo: 'x'.repeat(201) }, extra: { ...valido, estado: 'active' }, deOtro: { ...valido, tenantId: otro.tenantId }, calendario: { ...valido, calendarioId: 'otro' } })) {
        const res = await crear('tok-p', body)
        invalidos[nombre] = res.status
      }
      out.invalidos = invalidos
      out.sinSesion = (await crear(null, valido)).status
      const creado = await crear('tok-p', valido)
      out.creado = creado.status
      out.sinMotivo = (await crear('tok-p', { inicio: a(9, '10:00'), fin: a(9, '12:00') })).status
      const lista = await call('GET', '/tus/v1/prestador/turnos/bloqueos', 'tok-p')
      out.lista = lista.body.items.some((b) => b.id === creado.body.id && b.motivo === 'Trámite')
      // 15. ownership: another provider neither sees, edits nor removes it
      out.listaAjena = (await call('GET', '/tus/v1/prestador/turnos/bloqueos', 'tok-otro')).body.items.length
      out.editarAjeno = (await call('PUT', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-otro', valido)).status
      out.quitarAjeno = (await call('DELETE', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-otro')).status
      out.sigue = (await prisma.excepcionCalendario.findUnique({ where: { id: creado.body.id } })).estado
      out.editar = (await call('PUT', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-p', { inicio: a(8, '10:00'), fin: a(8, '12:00'), motivo: 'Médico' })).status
      out.editarInvalido = (await call('PUT', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-p', { inicio: a(8, '12:00'), fin: a(8, '10:00') })).status
      out.editarSobreTurnoHttp = (await call('PUT', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-p', { inicio: a(4, '09:30'), fin: a(4, '10:30') })).body
      out.editado = await turnos.bloqueosPrestador(p.tenantId).then((items) => items.filter((b) => b.id === creado.body.id).map((b) => [b.inicio === a(8, '10:00'), b.fin === a(8, '12:00'), b.motivo]))
      out.bloqueoSobreTurnoHttp = (await crear('tok-p', { inicio: a(4, '09:00'), fin: a(4, '12:00') })).status
      // 16. suspended
      const suspendido = await crear('tok-susp', { inicio: a(10, '00:00'), fin: a(11, '00:00') })
      out.suspendido = [suspendido.status, suspendido.body.code, (await call('DELETE', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-susp')).status, (await call('GET', '/tus/v1/prestador/turnos/bloqueos', 'tok-susp')).status]
      out.quitar = (await call('DELETE', '/tus/v1/prestador/turnos/bloqueos/' + creado.body.id, 'tok-p')).status
      await new Promise((resolve) => server.close(resolve))
      console.log(JSON.stringify(out))
    } finally { await prisma.$disconnect() }
  `)
  assert.equal(r.bloqueoSobreTurno, 'BLOCK_HAS_BOOKINGS')
  assert.equal(r.diaSobreTurno, 'BLOCK_HAS_BOOKINGS')
  assert.deepEqual(r.turnoIntacto, ['confirmed', 0], 'the turno is neither cancelled nor covered')
  assert.equal(r.bloqueoAlLado, 'ok', 'a block next to the turno is fine')
  assert.deepEqual(r.sobreSolicitud, ['pending', 'ok'])
  assert.equal(r.editarSobreTurno, 'BLOCK_HAS_BOOKINGS')
  assert.equal(r.bloqueoSinMover, true)
  for (const ronda of r.rondas) assert.deepEqual(ronda, [1, 1, true], `a turno and a block of the same hour: one wins (${JSON.stringify(r.rondas)})`)
  assert.deepEqual(r.invalidos, { alReves: 400, igual: 400, masDeUnAno: 400, fechaImposible: 400, sinHora: 400, motivoLargo: 400, extra: 400, deOtro: 400, calendario: 400 })
  assert.equal(r.sinSesion, 401)
  assert.deepEqual([r.creado, r.sinMotivo], [201, 201], 'the reason is optional')
  assert.equal(r.lista, true)
  assert.equal(r.listaAjena, 0)
  assert.deepEqual([r.editarAjeno, r.quitarAjeno, r.sigue], [404, 404, 'active'])
  assert.deepEqual([r.editar, r.editarInvalido], [200, 400])
  assert.equal(r.editarSobreTurnoHttp.code ?? r.editarSobreTurnoHttp.error?.code, 'BLOCK_HAS_BOOKINGS')
  assert.deepEqual(r.editado, [[true, true, 'Médico']])
  assert.equal(r.bloqueoSobreTurnoHttp, 409)
  assert.deepEqual(r.suspendido, [403, 'PROVIDER_SUSPENDED', 403, 200], 'a suspended provider reads its agenda and changes nothing')
  assert.equal(r.quitar, 200)
})

test('AUSENCIAS: the assistant has no availability rule of its own (it asks the turnos service)', () => {
  const dominio = readFileSync(new URL('../../apps/api/src/tus/asistente/dominio.ts', import.meta.url), 'utf8')
  assert.match(dominio, /this\.compartidos\.turnos\.disponibilidadPublica\(\{ prestadorId: providerId, oficioId, fecha \}\)/u)
  assert.doesNotMatch(dominio, /excepcionCalendario|reglaCalendario/u, 'the assistant never reads the calendar tables by itself')
})
