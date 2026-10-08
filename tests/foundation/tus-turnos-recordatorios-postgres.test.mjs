import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// TURNOS-CANCELACION-01 and TURNOS-RECORDATORIOS-01 on a DISPOSABLE PostgreSQL 16 with every
// migration applied (TUS_PERFIL_TURNOS_PG_URL): the real turnos with their deposit, the real
// payments module (offline Mercado Pago at the `fetch` boundary) and the real reminders sweep.
// Nothing is sent anywhere: the channel of the reminders records what it would deliver.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `${turnosPagosSetup(url)}
  const HORA = 3600_000
  const MINUTO = 60_000
  const { ServicioRecordatoriosTurno } = await import('./apps/api/src/tus/calendar/turnos-recordatorios.ts')
  const { VERSION_POLITICA_CANCELACION, CODIGO_CANCELACION_TARDIA, CODIGO_POLITICA_CANCELACION_REQUERIDA } = await import('./packages/contracts/src/tus-turnos.ts')
  let pagos = 100000 + Math.floor(Math.random() * 800000) * 10
  async function turnoPagado(p, cuenta, indice, hora) {
    const t = await turnoConCheckout(p, cuenta, indice, hora, 'Masaje')
    pagos += 1
    mpPayment(String(pagos), t.preferencia)
    await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-n-' + pagos }))
    return t
  }
  const fila = (t) => prisma.reserva.findUnique({ where: { id: t.pedido.id } })
  const inicioDe = async (t) => (await fila(t)).fechaInicio.getTime()
  const cancelacion = async (t) => { const c = await prisma.cancelacionTurno.findUnique({ where: { reservaId: t.pedido.id } }); return c ? [c.canceladaPor, c.tardia, c.devolucion, c.canal, c.politicaVersion === VERSION_POLITICA_CANCELACION] : null }
  const dinero = async (t) => { const o = await prisma.obligacionPagoServicio.findFirst({ where: { obligacionId: t.obligacion.obligacionId } }); const l = await prisma.liquidacionServicio.findFirst({ where: { obligacionId: t.obligacion.obligacionId } }); return [o.estado, l.retencionActiva, l.liberadaEn !== null, Number((await db.query('SELECT count(*)::int AS n FROM reembolsos_servicio WHERE pago_id = $1', [t.pago.pagoId]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n)] }
  // The clock the cancellation policy is decided with (the server's), moved for each case.
  let reloj = null
  turnos.conReloj(() => reloj ?? Date.now())
`

test('CANCELACION turnos PostgreSQL: the client cancelling more than 24 hours before keeps its right to the refund; at exactly 24 hours or less the deposit is not refundable and the loss must be confirmed; the provider cancelling inside the 24 hours never penalizes the client; nothing is refunded or released by the cancellation itself', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('canc', 'Cancela ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const cancelar = async (t, extra = {}) => { try { const d = await turnos.cancelarTurnoCliente({ clienteId: ana.id, reservaId: t.pedido.id, canal: 'web', ...extra }); return d.estado } catch (e) { return e?.code ?? String(e) } }

      // 24 h + 1 minute: refund due, no second confirmation.
      const t1 = await turnoPagado(p, ana, 0, '10:00')
      reloj = (await inicioDe(t1)) - 24 * HORA - MINUTO
      out.antes = [await cancelar(t1), (await fila(t1)).estado, await cancelacion(t1), await dinero(t1)]
      // Exactly 24 hours: not refundable. Without confirming the loss nothing is cancelled.
      const t2 = await turnoPagado(p, ana, 0, '11:00')
      reloj = (await inicioDe(t2)) - 24 * HORA
      const sinConfirmar = await cancelar(t2)
      out.exactas = [sinConfirmar, (await fila(t2)).estado, await cancelacion(t2), await cancelar(t2, { confirmaPerdida: true }), (await fila(t2)).estado, await cancelacion(t2), await dinero(t2)]
      // 23 h 59 min.
      const t3 = await turnoPagado(p, ana, 0, '12:00')
      reloj = (await inicioDe(t3)) - 24 * HORA + MINUTO
      out.dentro = [await cancelar(t3), await cancelar(t3, { confirmaPerdida: true }), await cancelacion(t3)]
      // Cancelled twice: the same state, one record.
      out.repetida = [await cancelar(t3, { confirmaPerdida: true }), await prisma.cancelacionTurno.count({ where: { reservaId: t3.pedido.id } })]
      // Accepted but never paid, inside the 24 hours: nothing to lose, nothing to confirm.
      const t4 = await turnoConCheckout(p, ana, 0, '13:00', 'Masaje')
      reloj = (await inicioDe(t4)) - HORA
      out.sinPago = [await cancelar(t4), await cancelacion(t4)]
      // The PROVIDER cancels 3 hours before the turno: the client loses nothing.
      const t5 = await turnoPagado(p, ana, 0, '14:00')
      reloj = (await inicioDe(t5)) - 3 * HORA
      const porPrestador = await turnos.cambiarEstadoTurno({ reservaId: t5.pedido.id, tenantId: p.tenantId, nuevoEstado: 'cancelled' })
      out.prestador = [porPrestador.estado, await cancelacion(t5), await dinero(t5)]
      // What the client reads of each.
      const vistos = await turnos.turnosCliente(ana.id)
      out.vistos = [t1, t2, t5].map((t) => { const v = vistos.find((x) => x.id === t.pedido.id); return [v.estado, v.cancelacion?.por, v.cancelacion?.tardia, v.cancelacion?.devolucion] })
      out.codigo = CODIGO_CANCELACION_TARDIA
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.antes, ['cancelled', 'cancelled', ['cliente', false, 'corresponde', 'web', true], ['paid', true, false, 0]], '24 h + 1 min: cancelled, the refund is due, and nothing was refunded or released by the cancellation itself')
  assert.deepEqual(r.exactas, [r.codigo, 'confirmed', null, 'cancelled-late', 'cancelled-late', ['cliente', true, 'no_reembolsable', 'web', true], ['paid', true, false, 0]], 'exactly 24 h: the loss is confirmed first; then a late cancellation, not refundable, with its money still traced')
  assert.deepEqual(r.dentro, [r.codigo, 'cancelled-late', ['cliente', true, 'no_reembolsable', 'web', true]], '23 h 59 min: not refundable')
  assert.deepEqual(r.repetida, ['cancelled-late', 1])
  assert.deepEqual(r.sinPago, ['cancelled', ['cliente', false, 'sin_pago', 'web', true]], 'nothing paid: nothing to lose and nothing to confirm')
  assert.deepEqual(r.prestador, ['cancelled', ['prestador', false, 'corresponde', null, true], ['paid', true, false, 0]], 'the provider cancelling inside the 24 hours: the client is due everything back')
  assert.deepEqual(r.vistos, [['cancelled', 'cliente', false, 'corresponde'], ['cancelled-late', 'cliente', true, 'no_reembolsable'], ['cancelled', 'prestador', false, 'corresponde']])
})

test('POLITICA de cancelación PostgreSQL: an advance payment (deposit or total) is not opened until its client accepted the policy; the acceptance is stored with who, which turno, when, channel and version; another version is not an acceptance; the balance needs none', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('pol', 'Politica ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const pedido = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(0, '10:00'), tarifaId: p.tarifas['Masaje'], clienteId: ana.id, clienteTenantId: ana.tenantId })
      await turnos.aceptarSolicitud({ prestadorTenantId: p.tenantId, reservaId: pedido.id })
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const antes = mp.preferences.length
      const pagar = async (extra = {}) => { for (let i = 0; ; i += 1) { try { return (await turnos.pagarSena({ clienteId: ana.id, reservaId: pedido.id, correlationId: 'c', ...extra })).monto } catch (e) { if (e?.code !== 'IN_PROGRESS' || i >= 40) return e?.code ?? String(e); await new Promise((resolve) => setTimeout(resolve, 250)) } } }
      const total = async (extra = {}) => { try { return (await turnos.pagarTurno({ clienteId: ana.id, reservaId: pedido.id, correlationId: 'c', tramo: 'total', ...extra })).monto } catch (e) { return e?.code ?? String(e) } }
      out.sinAceptar = [await pagar(), await total(), await pagar({ politica: { version: 'otra-version', canal: 'web' } }), mp.preferences.length - antes, await prisma.aceptacionPoliticaCancelacion.count({ where: { reservaId: pedido.id } }), await turnos.politicaAceptada({ clienteId: ana.id, reservaId: pedido.id })]
      const monto = await pagar({ politica: { version: VERSION_POLITICA_CANCELACION, canal: 'whatsapp' } })
      const guardada = await prisma.aceptacionPoliticaCancelacion.findMany({ where: { reservaId: pedido.id } })
      out.aceptada = [monto, guardada.map((g) => [g.cuentaId === ana.id, g.canal, g.version === VERSION_POLITICA_CANCELACION, g.tramo, g.aceptadaEn instanceof Date]), mp.preferences.length - antes]
      // Accepted once for this turno: asking again needs nothing more, and stores nothing more.
      out.otraVez = [await pagar(), await prisma.aceptacionPoliticaCancelacion.count({ where: { reservaId: pedido.id } })]
      out.codigo = CODIGO_POLITICA_CANCELACION_REQUERIDA
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinAceptar, [r.codigo, r.codigo, r.codigo, 0, 0, null], 'without the acceptance (or with another version) no checkout is opened and nothing is stored')
  assert.deepEqual(r.aceptada, [15000, [[true, 'whatsapp', true, 'sena', true]], 1], 'accepted: who, channel, version and way of paying are stored, and the checkout exists')
  assert.deepEqual(r.otraVez, [15000, 1])
})

test('RECORDATORIOS turnos PostgreSQL: 24 h and 2 h before, once each, to the client and the provider of a confirmed turno; repeating or running the sweep twice at once sends nothing twice; a cancelled or completed turno gets none; a moved turno gets new ones; a turno confirmed with less than 24 h gets no late reminder of the day before but still the one of 2 h; answers are recorded for the right account only', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('rec', 'Recuerda ' + run, [['Masaje', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      const duena = await cliente('duena')
      // (How a provider's account is linked is covered by its own tests: here it is given.)
      const datos = async (id) => { const d = await turnos.datosDeRecordatorio(id); return d ? { ...d, prestadorCuentaId: duena.id } : null }
      let ahora = Date.now()
      const enviados = []
      let falla = null
      const canal = { recordatorio: async (aviso) => { enviados.push(aviso); if (falla) return { enviado: false, motivo: falla }; return { enviado: true, via: aviso.destinatario === 'cliente' ? 'plantilla' : 'ventana', plantilla: aviso.destinatario === 'cliente' ? 'turno_recordatorio_' + aviso.tipo : null, wamid: 'wamid.' + aviso.recordatorioId } } }
      const recordatorios = new ServicioRecordatoriosTurno(prisma, datos, canal, () => ahora)
      const de = (t) => enviados.filter((x) => x.reservaId === t.pedido.id).map((x) => x.destinatario + ':' + x.tipo).sort()
      const filas = async (t) => (await prisma.recordatorioTurno.findMany({ where: { reservaId: t.pedido.id }, orderBy: [{ tipo: 'asc' }, { destinatario: 'asc' }, { fechaCreacion: 'asc' }] })).map((x) => [x.destinatario, x.tipo, x.estado, x.motivo])
      const barrer = async () => { const x = await recordatorios.procesar(500); return x }

      // ---- A. A confirmed turno, days ahead.
      const t = await turnoPagado(p, ana, 0, '10:00')
      const inicio = await inicioDe(t)
      await barrer()
      out.programados = [await filas(t), de(t)]
      ahora = inicio - 24 * HORA - MINUTO
      await barrer()
      out.unMinutoAntes = de(t)
      ahora = inicio - 24 * HORA
      await barrer()
      const aviso24 = enviados.find((x) => x.reservaId === t.pedido.id && x.destinatario === 'cliente')
      out.a24 = [de(t), [aviso24.tipo, aviso24.cuentaId === ana.id, aviso24.contraparte.startsWith('Recuerda '), aviso24.servicio, aviso24.conPago, aviso24.inicio.getTime() === inicio], enviados.find((x) => x.reservaId === t.pedido.id && x.destinatario === 'prestador').cuentaId === duena.id]
      // Repeating the sweep, and a restart (another instance over the same database), send nothing more.
      await barrer(); await barrer()
      await new ServicioRecordatoriosTurno(prisma, datos, canal, () => ahora).procesar(500)
      out.repetido = de(t)
      // Two processes at the same moment, when the one of 2 hours is due.
      ahora = inicio - 2 * HORA
      await Promise.all([barrer(), new ServicioRecordatoriosTurno(prisma, datos, canal, () => ahora).procesar(500), barrer()])
      out.a2 = [de(t), await filas(t)]
      const guardado = await prisma.recordatorioTurno.findFirst({ where: { reservaId: t.pedido.id, destinatario: 'cliente', tipo: '24h' } })
      out.auditoria = [guardado.via, guardado.plantilla, guardado.wamid === 'wamid.' + guardado.id, guardado.enviadoEn !== null, guardado.programadoPara.getTime() === inicio - 24 * HORA]

      // ---- B. Answers: only the account the reminder was sent to; repeating changes nothing.
      const ajena = await recordatorios.responder({ recordatorioId: guardado.id, cuentaId: beto.id, respuesta: 'asiste', canal: 'whatsapp' })
      const propia = await recordatorios.responder({ recordatorioId: guardado.id, cuentaId: ana.id, respuesta: 'asiste', canal: 'whatsapp' })
      const primera = (await prisma.recordatorioTurno.findUnique({ where: { id: guardado.id } })).respuestaEn.getTime()
      ahora += MINUTO
      await recordatorios.responder({ recordatorioId: guardado.id, cuentaId: ana.id, respuesta: 'asiste', canal: 'whatsapp' })
      const despues = await prisma.recordatorioTurno.findUnique({ where: { id: guardado.id } })
      out.respuesta = [ajena, [propia.destinatario, propia.turnoEstado, propia.conPago, propia.contraparte.startsWith('Recuerda ')], despues.respuesta, despues.respuestaActor === ana.id, despues.respuestaCanal, despues.respuestaEn.getTime() === primera, despues.cancelacion]

      // ---- C. Cancelled and completed turnos get nothing.
      ahora = Date.now()
      const c1 = await turnoPagado(p, ana, 1, '10:00')
      const c2 = await turnoPagado(p, ana, 1, '11:00')
      await barrer()
      await turnos.cambiarEstadoTurno({ reservaId: c1.pedido.id, tenantId: p.tenantId, nuevoEstado: 'cancelled' })
      await prisma.reserva.update({ where: { id: c2.pedido.id }, data: { estado: 'completed' } })
      ahora = (await inicioDe(c1)) - 90 * MINUTO
      await barrer()
      out.sinVigencia = [de(c1), de(c2), (await filas(c1)).map((x) => x[2] + ':' + x[3]), (await filas(c2)).map((x) => x[2] + ':' + x[3])]

      // ---- D. The turno is moved: what was pending is invalidated and computed again.
      ahora = Date.now()
      const m = await turnoPagado(p, ana, 2, '10:00')
      await barrer()
      const viejo = await inicioDe(m)
      await prisma.reserva.update({ where: { id: m.pedido.id }, data: { fechaInicio: new Date(viejo + 3 * HORA), fechaFin: new Date(viejo + 4 * HORA) } })
      const movido = await barrer()
      out.movido = [movido.invalidados >= 4, (await filas(m)).map((x) => x[2]).sort()]
      ahora = viejo - 24 * HORA
      await barrer()
      const aLaViejaHora = de(m)
      ahora = viejo + 3 * HORA - 24 * HORA
      await barrer()
      ahora = viejo + 3 * HORA - 2 * HORA
      await barrer()
      out.reprogramado = [aLaViejaHora, de(m), enviados.filter((x) => x.reservaId === m.pedido.id).every((x) => x.inicio.getTime() === viejo + 3 * HORA)]

      // ---- E. Confirmed with less than 24 hours: no late "tomorrow", but the one of 2 hours.
      ahora = Date.now()
      const tarde = await turnoPagado(p, ana, 3, '10:00')
      const cerca = Date.now() + 5 * HORA
      await prisma.reserva.update({ where: { id: tarde.pedido.id }, data: { fechaInicio: new Date(cerca), fechaFin: new Date(cerca + HORA), fechaActualizacion: new Date() } })
      await barrer()
      const alVerlo = await filas(tarde)
      ahora = cerca - 2 * HORA
      await barrer()
      out.conPocoTiempo = [alVerlo, de(tarde)]

      // ---- F. The API was down while the one of 24 hours was due; it comes back 1 hour before.
      ahora = Date.now()
      const caida = await turnoPagado(p, ana, 4, '10:00')
      await barrer()
      ahora = (await inicioDe(caida)) - HORA
      await barrer()
      out.trasLaCaida = [de(caida), (await filas(caida)).map((x) => x[1] + ':' + x[2] + ':' + x[3])]

      // ---- G. Nothing can be written to that account: recorded with its reason, not retried blindly.
      ahora = Date.now()
      const mudo = await turnoPagado(p, beto, 4, '11:00')
      await barrer()
      falla = 'requiere_plantilla'
      ahora = (await inicioDe(mudo)) - 24 * HORA
      await barrer()
      falla = null
      await barrer()
      out.sinPlantilla = [(await filas(mudo)).filter((x) => x[1] === '24h').map((x) => x[2] + ':' + x[3]), de(mudo).filter((x) => x.endsWith('24h')).length]
      out.vista = (await recordatorios.deTurno(t.pedido.id)).map((x) => [x.destinatario, x.tipo, x.estado, x.via, x.respuesta])
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  const cuatro = [['cliente', '24h', 'pending', null], ['prestador', '24h', 'pending', null], ['cliente', '2h', 'pending', null], ['prestador', '2h', 'pending', null]]
  assert.deepEqual(r.programados, [cuatro, []], 'the four reminders are computed and stored; nothing is sent before it is due')
  assert.deepEqual(r.unMinutoAntes, [])
  assert.deepEqual(r.a24, [['cliente:24h', 'prestador:24h'], ['24h', true, true, 'Masaje', true, true], true], '24 h before: one to the client and one to the provider, with the real data of the turno')
  assert.deepEqual(r.repetido, ['cliente:24h', 'prestador:24h'], 'repeating the sweep or restarting sends nothing twice')
  assert.deepEqual(r.a2[0], ['cliente:24h', 'cliente:2h', 'prestador:24h', 'prestador:2h'], 'three sweeps at once: each reminder of 2 h exactly once')
  assert.deepEqual(r.a2[1].map((x) => x[2]), ['sent', 'sent', 'sent', 'sent'])
  assert.deepEqual(r.auditoria, ['plantilla', 'turno_recordatorio_24h', true, true, true])
  assert.deepEqual(r.respuesta, [null, ['cliente', 'confirmed', true, true], 'asiste', true, 'whatsapp', true, false], 'the answer is the recipient\'s only, recorded once; it cancels nothing')
  assert.deepEqual(r.sinVigencia.slice(0, 2), [[], []], 'a cancelled or completed turno is never reminded')
  assert.ok(r.sinVigencia[2].every((x) => x === 'skipped:turno_cancelled' || x.startsWith('pending')) && r.sinVigencia[2].includes('skipped:turno_cancelled'), JSON.stringify(r.sinVigencia[2]))
  assert.ok(r.sinVigencia[3].includes('skipped:turno_completed'), JSON.stringify(r.sinVigencia[3]))
  assert.deepEqual(r.movido, [true, ['invalidated', 'invalidated', 'invalidated', 'invalidated', 'pending', 'pending', 'pending', 'pending']], 'a moved turno: the pending reminders are invalidated and computed for the new time')
  assert.deepEqual(r.reprogramado, [[], ['cliente:24h', 'cliente:2h', 'prestador:24h', 'prestador:2h'], true], 'nothing at the old time; everything at the new one')
  assert.deepEqual(r.conPocoTiempo[0], [['cliente', '24h', 'skipped', 'confirmado_con_menos_de_24h'], ['prestador', '24h', 'skipped', 'confirmado_con_menos_de_24h'], ['cliente', '2h', 'pending', null], ['prestador', '2h', 'pending', null]])
  assert.deepEqual(r.conPocoTiempo[1], ['cliente:2h', 'prestador:2h'], 'confirmed with less than 24 h: only the reminder of 2 h')
  assert.deepEqual(r.trasLaCaida[0], ['cliente:2h', 'prestador:2h'], 'after an outage the stale reminder of the day before is dropped and the one of 2 h is sent')
  assert.ok(r.trasLaCaida[1].includes('24h:skipped:vencido'))
  assert.deepEqual(r.sinPlantilla, [['skipped:requiere_plantilla', 'skipped:requiere_plantilla'], 2], 'a number that cannot be written to is recorded with its reason and not tried again')
  assert.deepEqual(r.vista.filter((x) => x[0] === 'cliente' && x[1] === '24h'), [['cliente', '24h', 'sent', 'plantilla', 'asiste']])
})
