import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// TURNOS-REPROGRAMACION-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL): the real turnos with their deposit, the real payments module
// (offline Mercado Pago at the `fetch` boundary), the real agenda, reminders and cancellation.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'
const root = join(import.meta.dirname, '../..')

const SETUP = `${turnosPagosSetup(url)}
  const HORA = 3600_000
  const MINUTO = 60_000
  const c2 = await import('./packages/contracts/src/tus-turnos.ts')
  const { ServicioRecordatoriosTurno } = await import('./apps/api/src/tus/calendar/turnos-recordatorios.ts')
  let pagos = 500000 + Math.floor(Math.random() * 400000) * 10
  async function turnoPagado(p, cuenta, indice, hora) {
    const t = await turnoConCheckout(p, cuenta, indice, hora, 'Masaje')
    pagos += 1
    mpPayment(String(pagos), t.preferencia)
    await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-rp-' + pagos }))
    return t
  }
  const fila = (t) => prisma.reserva.findUnique({ where: { id: t.pedido.id } })
  const codigo = async (op) => { try { await op(); return 'ok' } catch (e) { return e?.code ?? String(e) } }
  let reloj = null
  turnos.conReloj(() => reloj ?? Date.now())
  // Everything money-related that hangs from a turno, to compare before and after moving it.
  const dinero = async (t) => ({
    trabajo: (await prisma.trabajo.findMany({ where: { origen: 'turno', reservaId: t.pedido.reservaId } })).map((x) => x.trabajoId),
    obligaciones: (await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: t.trabajoId }, orderBy: { tramo: 'asc' } })).map((o) => [o.obligacionId, o.tramo, o.estado, String(o.monto)]),
    intentos: (await prisma.intencionPago.findMany({ where: { obligacionId: t.obligacion.obligacionId }, orderBy: { fechaCreacion: 'asc' } })).map((i) => [i.pagoId, i.tasaComisionBps, String(i.comisionMarketplace)]),
    liquidaciones: (await prisma.liquidacionServicio.findMany({ where: { trabajoId: t.trabajoId } })).map((l) => [l.estado, l.retencionActiva, String(l.montoBruto), String(l.montoComision)]),
    comision: await prisma.comisionTrabajo.findFirst({ where: { trabajoId: t.trabajoId } }).then((x) => [x.tasaPuntosBase, String(x.baseMinor), String(x.comisionMinor), x.fijadaEn.toISOString()]),
    politica: (await prisma.aceptacionPoliticaCancelacion.findMany({ where: { reservaId: t.pedido.id } })).map((x) => [x.version, x.canal, x.aceptadaEn.toISOString()]),
    reembolsos: Number((await db.query('SELECT count(*)::int AS n FROM reembolsos_servicio WHERE obligacion_id = $1', [t.obligacion.obligacionId])).rows[0].n),
  })
`

test('REPROGRAMACION turnos PostgreSQL: off by default and frozen on each turno when it is booked; only with more than 24 h left, and only to a free time of the same provider that is also more than 24 h away; an occupied time is refused and two clients never get the same one; the turno keeps its row, its order, its payments, its deposit, its commission and its accepted policy (no refund, no second deposit); the old reminders are invalidated and new ones computed; the grace period of the cancellation is not restarted; a cancelled or finished turno cannot be moved; the provider is told', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('rep', 'Reprograma ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      const avisos = []
      turnos.agregarNotificador({ solicitudRecibida: async () => {}, solicitudRespondida: async () => {}, turnoConfirmado: async () => {}, turnoCancelado: async () => {}, turnoReprogramado: async (aviso) => { avisos.push(aviso) } })
      const estadoDe = async (t, cuenta = ana) => (await turnos.turnosCliente(cuenta.id)).find((x) => x.id === t.pedido.id).reprogramacion
      const mover = (t, inicio, cuenta = ana) => codigo(() => turnos.reprogramarTurno({ clienteId: cuenta.id, reservaId: t.pedido.id, inicio, canal: 'web' }))
      const libres = async (t, desde, cuenta = ana) => (await turnos.horariosParaReprogramar({ clienteId: cuenta.id, reservaId: t.pedido.id, desde })).dias.flatMap((d) => d.franjas.filter((f) => f.estado === 'disponible').map((f) => f.inicio))
      const viernes = c.sumarDias(lunes, 4)

      // ---- 1. Off by default: a turno booked then can never be moved by its client.
      out.porDefecto = await turnos.reprogramacionPrestador(p.tenantId)
      const sinPermiso = await turnoPagado(p, ana, 4, '09:00')
      out.sinPermiso = [await estadoDe(sinPermiso), await mover(sinPermiso, a(4, '17:00')), await codigo(() => libres(sinPermiso, viernes))]
      // ---- 2. The provider turns it on: for the turnos booked from now on, not for that one.
      out.encendido = await turnos.guardarReprogramacionPrestador(p.tenantId, true)
      const t = await turnoPagado(p, ana, 4, '10:00')
      const ocupado = await turnoPagado(p, beto, 4, '12:00')
      const rival = await turnoPagado(p, beto, 4, '13:00')
      out.snapshot = [(await fila(sinPermiso)).admiteReprogramacion, (await estadoDe(sinPermiso)).motivo, (await fila(t)).admiteReprogramacion, await estadoDe(t)]
      // ...and turning it off again does not take it away from a turno that was booked with it.
      await turnos.guardarReprogramacionPrestador(p.tenantId, false)
      const despuesDeApagar = await turnoPagado(p, ana, 4, '11:00')
      out.apagado = [(await estadoDe(t)).permitida, (await fila(despuesDeApagar)).admiteReprogramacion]
      await turnos.guardarReprogramacionPrestador(p.tenantId, true)

      // ---- 3. The window, with the server's clock.
      const inicio = (await fila(t)).fechaInicio.getTime()
      reloj = inicio - 24 * HORA
      out.exactas24 = [await estadoDe(t), await mover(t, a(4, '17:00')), await codigo(() => libres(t, viernes))]
      reloj = inicio - 23 * HORA
      out.menosDe24 = [(await estadoDe(t)).motivo, await mover(t, a(4, '17:00'))]
      reloj = inicio - 24 * HORA - MINUTO
      out.masDe24 = [(await estadoDe(t)).permitida, (await libres(t, viernes)).length]
      // The new time must be more than 24 hours away too: from Wednesday 14:00, Thursday 14:00 is not.
      reloj = Date.parse(a(2, '14:00'))
      out.destinoCercano = [await mover(t, a(3, '14:00')), (await libres(t, c.sumarDias(lunes, 3))).includes(a(3, '14:00')), (await libres(t, c.sumarDias(lunes, 3))).includes(a(3, '15:00'))]
      reloj = null

      // ---- 4. Only real free times of the same provider.
      const ofrecidos = await libres(t, viernes)
      out.oferta = [ofrecidos.includes(a(4, '17:00')), ofrecidos.includes(a(4, '12:00')), ofrecidos.includes(a(4, '10:00')), ofrecidos.includes(a(4, '09:00'))]
      out.rechazos = [await mover(t, a(4, '12:00')), await mover(t, a(4, '03:00')), await mover(t, a(4, '10:00')), await mover(t, 'mañana'), await mover(t, a(4, '17:00'), beto), (await fila(t)).fechaInicio.toISOString() === a(4, '10:00')]
      // ---- 5. Two clients want the same free time at once: one gets it.
      const carrera = await Promise.all([mover(t, a(4, '15:00')), mover(rival, a(4, '15:00'), beto)])
      const enLas15 = await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(4, '15:00')), estado: 'confirmed' } })
      out.carrera = [carrera.slice().sort(), enLas15]
      const ganoAna = carrera[0] === 'ok'
      // (Whoever lost keeps its own time; from here on the turno of Ana is the one that is followed.)
      if (!ganoAna) out.movidaTrasPerder = await mover(t, a(4, '16:00'))
      const destino = ganoAna ? a(4, '15:00') : a(4, '16:00')

      // ---- 6. What stays and what changes. (A fresh turno: its money is compared before and after.)
      const m = await turnoPagado(p, ana, 3, '10:00')
      const recordatorios = new ServicioRecordatoriosTurno(prisma, async (id) => { const d = await turnos.datosDeRecordatorio(id); return d ? { ...d, prestadorCuentaId: beto.id } : null }, { recordatorio: async (aviso) => { enviados.push(aviso); return { enviado: true, via: 'ventana', plantilla: null, wamid: null } } }, () => relojRec)
      const enviados = []
      let relojRec = Date.now()
      await recordatorios.procesar(500)
      const antes = await dinero(m)
      const filaAntes = await fila(m)
      const recAntes = (await prisma.recordatorioTurno.findMany({ where: { reservaId: m.pedido.id } })).map((x) => x.estado)
      const movido = await turnos.reprogramarTurno({ clienteId: ana.id, reservaId: m.pedido.id, inicio: a(4, '17:00'), canal: 'web' })
      const filaDespues = await fila(m)
       out.elMismoTurno = [movido.id === m.pedido.id, filaDespues.reservaId === filaAntes.reservaId, filaDespues.estado, filaDespues.fechaInicio.toISOString() === a(4, '17:00'), filaDespues.fechaFin.getTime() - filaDespues.fechaInicio.getTime() === filaAntes.fechaFin.getTime() - filaAntes.fechaInicio.getTime(), filaDespues.version === filaAntes.version + 1, filaDespues.fechaCreacion.getTime() === filaAntes.fechaCreacion.getTime(), Number(filaDespues.precioFinal), filaDespues.clienteId === ana.id, filaDespues.tenantId === p.tenantId, filaDespues.servicioId === filaAntes.servicioId]
      out.origenPreservado = [filaAntes.origen, filaDespues.origen, movido.origen]
      out.dineroIgual = JSON.stringify(await dinero(m)) === JSON.stringify(antes)
      out.dinero = [antes.trabajo.length, antes.obligaciones.map((o) => o.slice(1)), antes.liquidaciones, antes.politica.length, antes.reembolsos]
      const sena = (await turnos.turnosCliente(ana.id)).find((x) => x.id === m.pedido.id)
      out.vista = [sena.estado, sena.sena.estado, sena.pago.pagado, sena.pago.saldoPendiente, sena.pago.modalidad, sena.reprogramacion.veces, sena.reprogramacion.anterior === a(3, '10:00'), sena.reprogramacion.permitida]
      const historia = await turnos.reprogramacionesDe(m.pedido.id)
      out.auditoria = historia.map((h) => [h.actorId === ana.id, h.canal, h.anterior === a(3, '10:00'), h.nuevo === a(4, '17:00'), !Number.isNaN(Date.parse(h.en)), h.politicaVersion === c2.VERSION_POLITICA_CANCELACION])
      // ---- 7. Reminders: the ones of the old time are invalidated at once; new ones are computed.
      const recTrasMover = (await prisma.recordatorioTurno.findMany({ where: { reservaId: m.pedido.id } })).map((x) => x.estado + ':' + (x.motivo ?? ''))
      await recordatorios.procesar(500)
      const nuevos = (await prisma.recordatorioTurno.findMany({ where: { reservaId: m.pedido.id, estado: 'pending' } })).map((x) => [x.tipo, x.turnoInicio.toISOString() === a(4, '17:00')])
      relojRec = Date.parse(a(3, '10:00')) - 24 * HORA
      await recordatorios.procesar(500)
      const aLaFechaVieja = enviados.filter((x) => x.reservaId === m.pedido.id).length
      relojRec = Date.parse(a(4, '17:00')) - 24 * HORA
      await recordatorios.procesar(500)
      out.recordatorios = [recAntes.sort(), recTrasMover.sort(), nuevos.sort(), aLaFechaVieja, enviados.filter((x) => x.reservaId === m.pedido.id).map((x) => [x.tipo, x.inicio.toISOString() === a(4, '17:00')])]
      // ---- 8. The provider is told: who, what, when it was and when it is.
      for (let i = 0; i < 6; i += 1) await turnos.procesarNotificacionesPendientes()
      const aviso = avisos.find((x) => x.reservaId === m.pedido.id)
      out.aviso = aviso ? [aviso.clienteNombre, aviso.servicio, aviso.anterior.toISOString() === a(3, '10:00'), aviso.inicio.toISOString() === a(4, '17:00'), aviso.prestadorTenantId === p.tenantId] : null

      // ---- 9. Rescheduling never restarts the grace period of the cancellation.
      const creada = filaAntes.fechaCreacion.getTime()
      reloj = creada + 30 * HORA
      const otraVez = await mover(m, a(3, '16:00'))
      reloj = creada + 31 * HORA
      const previa = await turnos.previsualizarCancelacionCliente({ clienteId: ana.id, reservaId: m.pedido.id })
      out.sinNuevaGracia = [otraVez, (await estadoDe(m)).veces, previa.desglose.regla, previa.desglose.reembolsable, previa.requiereConfirmacion]
      // And 24 hours or less before the NEW time it is the last moment (the new date counts).
      reloj = Date.parse(a(3, '16:00')) - 2 * HORA
      out.conLaFechaNueva = [(await turnos.previsualizarCancelacionCliente({ clienteId: ana.id, reservaId: m.pedido.id })).desglose.regla, (await estadoDe(m)).motivo]
      reloj = null

      // ---- 10. States that cannot be moved: cancelled, and finished by its provider.
      const cancelado = await turnoPagado(p, ana, 2, '10:00')
      await turnos.cambiarEstadoTurno({ reservaId: cancelado.pedido.id, tenantId: p.tenantId, nuevoEstado: 'cancelled' })
      const finalizado = await turnoPagado(p, ana, 2, '11:00')
      adelantar(12 * 24 * HORA)
      await cierre.finalizar(p.ctx, finalizado.trabajoId, { evidence: 'Sesión de masaje realizada completa.' })
      const pendienteDePago = await turnoConCheckout(p, ana, 2, '12:00', 'Masaje')
      out.bloqueados = [[(await estadoDe(cancelado)).motivo, await mover(cancelado, a(4, '09:00'))], [(await estadoDe(finalizado)).motivo, await mover(finalizado, a(4, '09:00'))], [(await estadoDe(pendienteDePago)).motivo, await mover(pendienteDePago, a(4, '09:00'))]]
      out.codigos = [c2.CODIGO_REPROGRAMACION_NO_PERMITIDA, c2.CODIGO_REPROGRAMACION_CERRADA, c2.CODIGO_REPROGRAMACION_DESTINO_CERCANO, c2.CODIGO_REPROGRAMACION_BLOQUEADA, c2.CODIGO_HORARIO_OCUPADO]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  const [NO_PERMITIDA, CERRADA, DESTINO_CERCANO, BLOQUEADA, OCUPADO] = r.codigos
  assert.deepEqual(r.porDefecto, { permite: false })
  assert.deepEqual(r.sinPermiso, [{ permitida: false, motivo: NO_PERMITIDA, veces: 0, anterior: null }, NO_PERMITIDA, NO_PERMITIDA], 'the provider does not allow it: its client cannot')
  assert.deepEqual(r.encendido, { permite: true })
  assert.deepEqual(r.snapshot, [false, NO_PERMITIDA, true, { permitida: true, motivo: null, veces: 0, anterior: null }], 'the switch applies to the turnos booked from then on; the one that existed keeps its condition')
  assert.deepEqual(r.apagado, [true, false], 'turning it off does not take it away from a turno booked with it')
  assert.deepEqual(r.exactas24, [{ permitida: false, motivo: CERRADA, veces: 0, anterior: null }, CERRADA, CERRADA], 'exactly 24 h: closed')
  assert.deepEqual(r.menosDe24, [CERRADA, CERRADA])
  assert.equal(r.masDe24[0], true, '24 h + 1 min: open')
  assert.ok(r.masDe24[1] > 0)
  assert.deepEqual(r.destinoCercano, [DESTINO_CERCANO, false, true], 'the new time must also be more than 24 h away: it is refused and never offered')
  assert.deepEqual(r.oferta, [true, false, false, false], 'only free times are offered: not the taken ones, not the one the turno already has')
  assert.deepEqual(r.rechazos, [OCUPADO, 'SLOT_NOT_AVAILABLE', 'INVALID_PARAMS', 'INVALID_DATE', 'NOT_FOUND', true], 'occupied, outside the agenda, the same time, not a date, somebody else\'s turno: nothing moves')
  assert.deepEqual(r.carrera, [[OCUPADO, 'ok'], 1], 'two clients at once on the same free time: one turno there, the other is told it was taken')
  assert.deepEqual(r.elMismoTurno, [true, true, 'confirmed', true, true, true, true, 30000, true, true, true], 'the same turno: only its date and time change')
  assert.deepEqual(r.origenPreservado, ['tus', 'tus', 'tus'], 'origin is structured and never changed by rescheduling')
  assert.equal(r.dineroIgual, true, 'order, obligations, payment intents, settlements, frozen commission, accepted policy and refunds: byte for byte the same')
  assert.deepEqual(r.dinero, [1, [['sena', 'paid', '1500000']], [['held', true, '1500000', r.dinero[2][0][3]]], 1, 0], 'one order, one deposit paid and held, one accepted policy, no refund, no second deposit')
  assert.deepEqual(r.vista, ['confirmed', 'paid', 15000, 15000, 'sena', 1, true, true])
  assert.deepEqual(r.auditoria, [[true, 'web', true, true, true, true]])
  assert.deepEqual(r.recordatorios[0], ['pending', 'pending', 'pending', 'pending'])
  assert.deepEqual(r.recordatorios[1], ['invalidated:turno_reprogramado', 'invalidated:turno_reprogramado', 'invalidated:turno_reprogramado', 'invalidated:turno_reprogramado'], 'the reminders of the old time are invalidated with the change itself')
  assert.deepEqual(r.recordatorios[2], [['24h', true], ['24h', true], ['2h', true], ['2h', true]], 'new reminders for the new time')
  assert.equal(r.recordatorios[3], 0, 'nothing is ever sent for the old time')
  assert.deepEqual(r.recordatorios[4], [['24h', true], ['24h', true]])
  assert.deepEqual(r.aviso, ['Cliente ana', 'Masaje', true, true, true], 'the provider is told who, what, when it was and when it is')
  assert.deepEqual(r.sinNuevaGracia, ['ok', 2, 'intermedia', 0, true], 'rescheduling 30 h after booking does not open a new grace period: the deposit is not refundable')
  assert.deepEqual(r.conLaFechaNueva, ['ultimo_momento', CERRADA], 'the time left is counted to the NEW date')
  assert.deepEqual(r.bloqueados, [[BLOQUEADA, BLOQUEADA], [BLOQUEADA, BLOQUEADA], [BLOQUEADA, BLOQUEADA]], 'a cancelled turno, one its provider already finished and one that is not confirmed yet cannot be moved')
})

test('REPROGRAMACION agenda vigente: un slot mostrado y tomado después se rechaza, respeta bloqueos/manuales/duración/descanso, retry no duplica y el barrido tardío no crea un 24h retroactivo', { skip, timeout: 120000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('vigente', 'Agenda vigente ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      await turnos.guardarReprogramacionPrestador(p.tenantId, true)
      const t = await turnoPagado(p, ana, 3, '10:00')
      const rival = await turnoPagado(p, beto, 3, '11:00')
      const dineroAntes = JSON.stringify(await dinero(t))
      const original = await fila(t)
      const oferta = await turnos.horariosParaReprogramar({ clienteId: ana.id, reservaId: t.pedido.id, desde: lunes })
      out.mostradoLibre = oferta.dias.flatMap((d) => d.franjas).some((f) => f.inicio === a(4, '09:00') && f.estado === 'disponible')
      await turnos.reprogramarTurno({ clienteId: beto.id, reservaId: rival.pedido.id, inicio: a(4, '09:00'), canal: 'web' })
      out.agendaVieja = [await codigo(() => turnos.reprogramarTurno({ clienteId: ana.id, reservaId: t.pedido.id, inicio: a(4, '09:00'), canal: 'web' })), (await fila(t)).fechaInicio.toISOString() === original.fechaInicio.toISOString(), JSON.stringify(await dinero(t)) === dineroAntes]
      const bloqueo = await turnos.bloquearHorario({ prestadorTenantId: p.tenantId, inicio: a(4, '10:00'), fin: a(4, '11:00'), motivo: 'Ausencia de prueba' })
      const manual = await turnos.crearTurnoManual({ prestadorTenantId: p.tenantId, oficioId: oficio.id, inicio: a(4, '12:00'), clienteNombre: 'Invitada manual' })
      const mover = (inicio) => codigo(() => turnos.reprogramarTurno({ clienteId: ana.id, reservaId: t.pedido.id, inicio, canal: 'web' }))
      out.bloqueados = [await mover(a(4, '10:00')), await mover(a(4, '12:00')), manual.origen, Boolean(bloqueo.id)]
      // The service changed its rest while the client was looking at the previous agenda.
      await prisma.perfilServicio.updateMany({ where: { perfilId: p.perfilId, oficioId: oficio.id }, data: { bufferMinutos: 30 } })
      const nueva = await turnos.horariosParaReprogramar({ clienteId: ana.id, reservaId: t.pedido.id, desde: lunes })
      const viernes = nueva.dias.find((d) => d.fecha === c.sumarDias(lunes, 4))
      out.descanso = [viernes.franjas.filter((f) => f.estado === 'disponible').map((f) => f.hora), await mover(a(4, '13:00'))]
      const avisos = []
      turnos.agregarNotificador({ solicitudRecibida: async () => {}, solicitudRespondida: async () => {}, turnoConfirmado: async () => {}, turnoCancelado: async () => {}, turnoReprogramado: async (aviso) => avisos.push(aviso) })
      const elegido = a(4, '13:30')
      const movido = await turnos.reprogramarTurno({ clienteId: ana.id, reservaId: t.pedido.id, inicio: elegido, canal: 'web' })
      const trasMover = await fila(t)
      out.invariantes = [movido.id === t.pedido.id, movido.origen === original.origen, trasMover.fechaCreacion.getTime() === original.fechaCreacion.getTime(), trasMover.duracionMinutos === original.duracionMinutos, trasMover.fechaFin.getTime() - trasMover.fechaInicio.getTime(), JSON.stringify(await dinero(t)) === dineroAntes]
      const filasAntesRetry = await prisma.reprogramacionTurno.count({ where: { reservaId: t.pedido.id } })
      out.retry = [await mover(elegido), await prisma.reprogramacionTurno.count({ where: { reservaId: t.pedido.id } }) === filasAntesRetry, JSON.stringify(await dinero(t)) === dineroAntes]
      await turnos.procesarNotificacionesPendientes(); await turnos.procesarNotificacionesPendientes()
      out.avisoUnaVez = avisos.filter((x) => x.reservaId === t.pedido.id).length
      // The new time was >24h when chosen, but the first reminder sweep occurs 20h before it.
      // No retroactive day-before notice is sent; both 2h notices are still scheduled and sent once.
      let ahoraRec = Date.parse(elegido) - 20 * HORA
      const enviados = []
      const rec = new ServicioRecordatoriosTurno(prisma, async (id) => { const d = await turnos.datosDeRecordatorio(id); return d ? { ...d, prestadorCuentaId: beto.id } : null }, { recordatorio: async (aviso) => { enviados.push(aviso); return { enviado: true, via: 'ventana', plantilla: null, wamid: null } } }, () => ahoraRec)
      await rec.procesar(500)
      const registros = await prisma.recordatorioTurno.findMany({ where: { reservaId: t.pedido.id } })
      out.barridoTardio = [registros.filter((x) => x.tipo === '24h').map((x) => x.estado).sort(), registros.filter((x) => x.tipo === '2h').map((x) => x.estado).sort(), enviados.filter((x) => x.reservaId === t.pedido.id).length]
      ahoraRec = Date.parse(elegido) - 2 * HORA
      await rec.procesar(500); await rec.procesar(500)
      out.soloDosHoras = enviados.filter((x) => x.reservaId === t.pedido.id).map((x) => x.tipo).sort()
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.mostradoLibre, true)
  assert.deepEqual(r.agendaVieja, ['SLOT_OCCUPIED', true, true])
  assert.deepEqual(r.bloqueados, ['SLOT_NOT_AVAILABLE', 'SLOT_OCCUPIED', 'manual', true])
  assert.deepEqual(r.descanso, [['13:30', '15:00', '16:30'], 'SLOT_OCCUPIED'])
  assert.deepEqual(r.invariantes, [true, true, true, true, 3600000, true])
  assert.deepEqual(r.retry, ['INVALID_PARAMS', true, true])
  assert.equal(r.avisoUnaVez, 1)
  assert.deepEqual(r.barridoTardio, [['skipped', 'skipped'], ['pending', 'pending'], 0])
  assert.deepEqual(r.soloDosHoras, ['2h', '2h'])
})

test('REPROGRAMACION rutas y cableado: the routes take only what they need (the switch; the new start), the client is the session; the Web and the assistant call the same backend operations and decide nothing by themselves; the migration is additive', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const http = read('apps/api/src/tus/calendar/turnos-http.ts')
  const servicio = read('apps/api/src/tus/calendar/turnos-service.ts')
  const dominio = read('apps/api/src/tus/asistente/dominio.ts')
  const orquestador = read('apps/api/src/tus/asistente/orquestador.ts')
  const pagina = read('apps/web/src/features/turnos/mis-turnos-page.tsx')
  const panel = read('apps/web/src/features/provider/provider-turnos.tsx')
  const cliente = read('apps/web/src/lib/tus-turnos-client.ts')
  const migracion = read('apps/api/prisma/migrations/20261116100000_tus_turnos_reprogramacion/migration.sql')
  // HTTP: the turno is the one of the path and the client is the session.
  assert.match(http, /'\/tus\/v1\/cliente\/turnos\/:id\/reprogramar'[\s\S]{0,700}filter\(\(campo\) => campo !== 'inicio'\)[\s\S]{0,500}reprogramarTurno\(\{ clienteId: context\.subjectId, reservaId: String\(request\.params\['id'\] \?\? ''\), inicio: body\['inicio'\], canal: 'web' \}\)/u)
  assert.match(http, /'\/tus\/v1\/cliente\/turnos\/:id\/reprogramacion\/horarios'[\s\S]{0,500}horariosParaReprogramar\(\{ clienteId: context\.subjectId/u)
  assert.match(http, /'\/tus\/v1\/prestador\/turnos\/reprogramacion'[\s\S]{0,700}typeof body\['permite'\] !== 'boolean'[\s\S]{0,400}guardarReprogramacionPrestador\(context\.tenantId, body\['permite'\]\)/u)
  // One operation moves a turno, for every channel: it updates the SAME reservation row.
  assert.equal((servicio.match(/tx\.reprogramacionTurno\.create\(/gu) ?? []).length, 1)
  assert.match(servicio, /const movida = await tx\.reserva\.update\(\{ where: \{ id: actual\.id \}, data: \{ fechaInicio: nuevoInicio, fechaFin: /u)
  assert.doesNotMatch(/async reprogramarTurno\([\s\S]*?\n  \}\n/u.exec(servicio)[0], /reserva\.create|obligacion|reembols|solicitarReembolso|cancelacionTurno/u, 'moving a turno creates no reservation, no obligation and no refund')
  assert.match(servicio, /admiteReprogramacion: \(await tx\.calendario\.findUnique\(/u, 'frozen on the turno when it is booked')
  // The assistant: the same backend, no rule of its own.
  assert.match(dominio, /this\.compartidos\.turnos\.reprogramarTurno\(\{ clienteId: context\.subjectId, reservaId: ref, inicio, canal \}\)/u)
  assert.match(dominio, /turnos\.horariosParaReprogramar\(\{ clienteId: context\.subjectId, reservaId: ref, desde \}\)/u)
  const flujo = /private async reprogramacionDeTurno\([\s\S]*?\n  \}\n/u.exec(orquestador)[0]
  assert.doesNotMatch(flujo, /esCancelacionTardia|24 \* 60|VENTANA_CANCELACION_MS|prisma|chat\.|completion/u, 'the assistant decides neither the 24 hours nor the availability, and uses no language model here')
  assert.match(flujo, /textoConfirmacionReprogramacion\(cuando\(turno\.startsAt\), cuando\(elegido\)\)[\s\S]{0,200}title: 'Confirmar cambio'[\s\S]{0,120}title: 'Volver'/u)
  // The Web: shown only when the API says so, with a confirmation, sending only the new start.
  assert.match(pagina, /\{turno\.reprogramacion\?\.permitida && moviendo\?\.id !== turno\.id \? \(\s*<button[^>]*data-reprogramar/u)
  assert.match(pagina, /textoConfirmacionReprogramacion\(/u)
  assert.match(pagina, /data-confirmar-cambio[\s\S]{0,200}Confirmar cambio[\s\S]{0,260}Volver/u)
  assert.doesNotMatch(pagina, /esCancelacionTardia|enPeriodoDeGracia/u)
  assert.match(cliente, /reprogramarTurno: \(id: string, inicio: string\)[\s\S]{0,200}JSON\.stringify\(\{ inicio \}\)/u)
  assert.match(panel, /Permitir reprogramación de turnos/u)
  assert.match(panel, /los que ya existen conservan la condición con la que se reservaron/u)
  // Migration: two columns with a default and one table.
  assert.doesNotMatch(migracion, /\bDROP\b|\bDELETE FROM\b|\bUPDATE public\b|\bINSERT INTO\b/u)
  assert.equal((migracion.match(/ADD COLUMN "[a-z_]+" boolean NOT NULL DEFAULT false/gu) ?? []).length, 2)
  assert.match(migracion, /ENABLE ROW LEVEL SECURITY/u)
})
