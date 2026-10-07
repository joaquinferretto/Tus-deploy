import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'
import { ASISTENTE_TURNOS as ASISTENTE } from './fixtures/turnos-whatsapp-pg.mjs'

// TURNOS-WHATSAPP-01 on a DISPOSABLE PostgreSQL 16 (TUS_PAYMENTS_PG_URL, every migration applied,
// never a shared or production database). The whole road of a turno after "Solicitud enviada":
//
//   request pending in PostgreSQL -> the provider is told on WhatsApp with Aceptar / Rechazar ->
//   its answer reaches the SAME use case as the panel -> rejected (client told, time free) or
//   awaiting the deposit (client told, payment link) -> Mercado Pago's signed notification ->
//   the turno is confirmed once -> both are told on WhatsApp -> the Web reads the same state.
//
// REAL here: the turnos service, the outbox of notices, the WhatsApp assistant (ingest, worker,
// orchestrator, notifier), the payments module, finance, the ledger and PostgreSQL's constraints.
// STAND-INS, at the network edge only: Meta (FakeWhatsappProvider: what would be sent is recorded,
// nothing leaves) and Mercado Pago (an offline API behind `fetch`, with real signature checks).
// So this proves the code, NOT the delivery by Meta nor a real charge.
//
// The run needs a FRESH database (the Mercado Pago stand-in uses fixed user ids).
const url = process.env.TUS_PAYMENTS_PG_URL
const skip = !url && 'TUS_PAYMENTS_PG_URL not set (disposable PostgreSQL 16 only)'
const SETUP = turnosPagosSetup(url)


test('TURNOS WhatsApp PostgreSQL: the request stays pending, the provider is told on WhatsApp with everything it needs and two buttons, it accepts from WhatsApp through the same use case as the panel, the client gets the payment link, the signed notification of Mercado Pago confirms the turno once, both are told, and the Web reads the same state; pictures of the request reach the provider', { skip, timeout: 600_000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('p', 'Gabriela López ' + run, [['Reparación', 30000]])
      const ana = await cliente('ana')
      ${ASISTENTE}
      const cuentaP = await cuentaDe(p, 'gabi')
      const waP = await vincular(cuentaP)
      const waAna = await vincular(ana)

      // 1. the request: pending in PostgreSQL, holding its time
      const pedido = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(0, '10:00'), tarifaId: p.tarifas['Reparación'], clienteId: ana.id, clienteTenantId: ana.tenantId, notas: 'Pierde la canilla de la cocina' })
      const guardada = await fila(pedido.id)
      out.pendiente = [guardada.estado, guardada.clienteId === ana.id, guardada.tenantId === p.tenantId, guardada.servicioId === oficio.id, guardada.fechaInicio.toISOString() === a(0, '10:00'), Number(guardada.precioFinal)]
      // the deposit cannot be paid before the provider accepts
      out.pagarAntes = await codeOf(() => turnos.pagarSena({ clienteId: ana.id, reservaId: pedido.id, correlationId: 'c' }))
      out.sinObligacion = (await pagoDe(pedido.reservaId)).obligacion === null

      // 2. the provider is told on WhatsApp, automatically
      let marca = fakeWa.sent.length
      await avisar()
      const aviso = enviadosA(waP, marca)
      out.aviso = { cantidad: aviso.length, tipo: aviso[0]?.type, botones: aviso[0]?.buttons?.map((b) => b.title + '=' + b.id), texto: aviso[0]?.text }
      out.avisoMeta = cuerpoMensajeMeta(waP, aviso[0]).interactive.action.buttons.map((b) => b.reply.title)
      out.clienteSinAviso = enviadosA(waAna, marca).length
      await avisar()
      out.avisoUnaVez = enviadosA(waP, marca).length

      // 3. the client adds two pictures from WhatsApp; a third is refused; the provider gets them
      marca = fakeWa.sent.length
      out.foto1 = await decir(waAna, '', foto(png(400, 300, [['tEXt', 'GPS\\u0000-27.4']])))
      out.foto2 = await decir(waAna, '', foto(png(500, 300)))
      out.foto3 = await decir(waAna, '', foto(png(600, 300)))
      await new Promise((resolve) => setTimeout(resolve, 300))
      const guardadas = await prisma.imagenReserva.findMany({ where: { reservaId: pedido.id }, orderBy: { orden: 'asc' } })
      out.fotos = { filas: guardadas.map((f) => [f.orden, f.tipoMime, !Buffer.from(f.contenido).includes('GPS')]), alPrestador: enviadosA(waP, marca).filter((m) => m.type === 'image').length }
      // a file that is not a picture is not attached
      out.fotoFalsa = await codeOf(() => turnos.adjuntarImagen({ clienteId: ana.id, reservaId: pedido.id, bytes: Buffer.from('<svg></svg>') }))
      // only the client and the provider of that turno read a picture
      const beto = await cliente('beto')
      out.fotoLectura = [await codeOf(() => turnos.imagenDeTurno({ reservaId: pedido.id, orden: 0, cuentaId: ana.id, tenantId: ana.tenantId })), await codeOf(() => turnos.imagenDeTurno({ reservaId: pedido.id, orden: 0, cuentaId: cuentaP.id, tenantId: p.tenantId })), await codeOf(() => turnos.imagenDeTurno({ reservaId: pedido.id, orden: 0, cuentaId: beto.id, tenantId: beto.tenantId })), await codeOf(() => turnos.adjuntarImagen({ clienteId: beto.id, reservaId: pedido.id, bytes: png(300, 300) }))]

      // 4. somebody who is not that provider taps a button: nothing changes
      const waBeto = await vincular(beto)
      out.ajeno = [await decir(waBeto, 'Aceptar', boton('aceptar', pedido.id)), (await fila(pedido.id)).estado]
      const otro = await prestador('otro', 'Otro Prestador ' + run, [['Reparación', 30000]])
      const waOtro = await vincular(await cuentaDe(otro, 'otro'))
      out.otroPrestador = [await decir(waOtro, 'Aceptar', boton('aceptar', pedido.id)), (await fila(pedido.id)).estado]

      // 5. the provider accepts from WhatsApp: awaiting the deposit, audited, the client is told
      marca = fakeWa.sent.length
      const respuesta = await decir(waP, 'Aceptar', boton('aceptar', pedido.id))
      const aceptada = await fila(pedido.id)
      out.aceptar = { respuesta, estado: aceptada.estado, version: aceptada.version }
      // the same tap again (a retried webhook of Meta, a second tap): the same result, once
      const repetida = await decir(waP, 'Aceptar', boton('aceptar', pedido.id))
      const mismoWamid = 'wamid.dup-' + run
      await decir(waP, 'Aceptar', boton('aceptar', pedido.id), mismoWamid)
      const duplicado = await decir(waP, 'Aceptar', boton('aceptar', pedido.id), mismoWamid)
      out.idempotente = { repetida, duplicadoDeMeta: duplicado.length, estado: (await fila(pedido.id)).estado, version: (await fila(pedido.id)).version, auditoria: (await auditoria(pedido.id)).map((e) => [e.metadata.a, e.metadata.canal, e.actorId === cuentaP.id]) }
      // rejecting what was accepted does not undo it
      out.rechazarAceptada = [await decir(waP, 'Rechazar', boton('rechazar', pedido.id)), (await fila(pedido.id)).estado]
      await avisar()
      for (let i = 0; i < 40 && !enviadosA(waAna, marca).some((m) => m.type === 'cta_url'); i += 1) { await new Promise((resolve) => setTimeout(resolve, 250)); await avisar() }
      const alCliente = enviadosA(waAna, marca)
      const enlace = alCliente.find((m) => m.type === 'cta_url')
      out.avisoCliente = { tipos: alCliente.map((m) => m.type), texto: (enlace ?? alCliente[0])?.text, etiqueta: enlace?.label, url: Boolean(enlace?.url && enlace.url.startsWith('https://')) }
      out.avisosUnaVez = alCliente.length

      // 6. the correlation of the payment: request -> work -> obligation -> intent -> preference
      const { obligacion, pago, preferencia } = await pagoDe(pedido.reservaId)
      out.correlacion = { monto: Number(obligacion.importe ?? obligacion.monto ?? 0), referencia: preferencia.body.external_reference === pago.pagoId, precioPreferencia: preferencia.body.items[0].unit_price, mismoEnlace: enlace?.url === (await turnos.pagarSena({ clienteId: ana.id, reservaId: pedido.id, correlationId: 'c' })).checkoutUrl }
      // opening the link, or saying it was paid, confirms nothing
      out.sinPagoReal = [await decir(waAna, 'ya pagué'), (await fila(pedido.id)).estado]

      // 7. Mercado Pago: a pending payment confirms nothing; the approved one does, once
      mpPayment('9101', preferencia, { status: 'in_process', status_detail: 'pending_contingency' })
      const enProceso = await ingerir(notification('9101', { userId: '555', notificationId: run + '-p1' }))
      out.pagoPendiente = [enProceso.status, (await fila(pedido.id)).estado]
      // a forged notification is refused
      mpPayment('9101', preferencia)
      // a forged notification of that approved payment is refused: nothing is confirmed by it
      const falsa = await fin.ingerirEventoProveedor(notification('9101', { userId: '555', notificationId: run + '-bad', signature: 'ts=1,v1=0000' })).then((x) => x.status, (e) => 'error:' + (e?.code ?? 'x'))
      out.firmaFalsa = [falsa, (await fila(pedido.id)).estado]
      marca = fakeWa.sent.length
      const aprobado = await ingerir(notification('9101', { userId: '555', notificationId: run + '-p2' }))
      // what the webhook route does with an applied approval of a deposit (tus/http/router.ts)
      const alAplicar = async (resultado) => { if (resultado.status === 'recorded' && resultado.result === 'applied' && resultado.obligation.amountSource === 'booked_price' && resultado.payment.providerStatus === 'approved') await turnos.avisarTurnoConfirmado(resultado.obligation.trabajoId) }
      await alAplicar(aprobado)
      out.confirmado = [aprobado.status, (await fila(pedido.id)).estado]
      // the same notification again, another id for the same payment, and both at once
      const otraVez = await ingerir(notification('9101', { userId: '555', notificationId: run + '-p2' }))
      await alAplicar(otraVez)
      // ...and the client asking 'ya pague' afterwards verifies again: still one notice
      await turnos.verificarPagoSena({ clienteId: ana.id, reservaId: pedido.id, correlationId: 'c-verif' }).catch(() => null)
      const juntas = await Promise.allSettled([ingerir(notification('9101', { userId: '555', notificationId: run + '-p3' })), ingerir(notification('9101', { userId: '555', notificationId: run + '-p4' }))])
      out.webhookRepetido = { otraVez: otraVez.status, juntas: juntas.map((x) => x.status), estado: (await fila(pedido.id)).estado, ganancias: (await filas(p)).filter(([tipo]) => tipo === 'earning_credit').length, pagosAprobados: await prisma.intencionPago.count({ where: { obligacionId: obligacion.obligacionId } }) }

      // 8. both are told on WhatsApp, once
      await avisar(); await avisar()
      out.confirmacion = { cliente: enviadosA(waAna, marca).map((m) => m.text).filter((t) => t.includes('confirmado')), prestador: enviadosA(waP, marca).map((m) => m.text).filter((t) => t.includes('confirmado')) }

      // 9. the Web reads the same state
      const mia = (await turnos.turnosCliente(ana.id)).find((t) => t.id === pedido.id)
      const delPrestador = (await turnos.turnosPrestador({ prestadorTenantId: p.tenantId })).find((t) => t.id === pedido.id)
      out.web = { cliente: [mia.estado, mia.sena?.estado], prestador: delPrestador.estado, pendientes: (await turnos.solicitudesPrestador(p.tenantId)).length, agenda: (await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: lunes })).dias[0].franjas.find((f) => f.hora === '10:00')?.estado }
      console.log(JSON.stringify(out))
    } finally { await cerrar() }
  `)
  assert.deepEqual(r.pendiente, ['pending', true, true, true, true, 30000])
  assert.equal(r.pagarAntes, 'DEPOSIT_NOT_PAYABLE', 'the deposit cannot be paid before the provider accepts')
  assert.equal(r.sinObligacion, true, 'no payment obligation exists for a request that was not accepted')
  assert.equal(r.aviso.cantidad, 1)
  assert.equal(r.aviso.tipo, 'buttons')
  assert.equal(r.aviso.botones.length, 2)
  assert.match(r.aviso.botones[0], /^Aceptar=turno:aceptar:res-/u)
  assert.match(r.aviso.botones[1], /^Rechazar=turno:rechazar:res-/u)
  for (const dato of ['Cliente: Cliente ana', 'Servicio: Reparación', 'Fecha: ', 'Hora: 10:00', 'Precio: $', '30.000', 'Seña: $', '15.000', 'Observación: Pierde la canilla de la cocina']) assert.ok(r.aviso.texto.includes(dato), `the notice says "${dato}": ${r.aviso.texto}`)
  assert.deepEqual(r.avisoMeta, ['Aceptar', 'Rechazar'], 'native reply buttons of WhatsApp')
  assert.equal(r.clienteSinAviso, 0)
  assert.equal(r.avisoUnaVez, 1, 'the notice is sent once')
  assert.match(r.foto1.join(' '), /Sumé la foto .*\(1 de 2\)/u)
  assert.match(r.foto2.join(' '), /\(2 de 2\)/u)
  assert.match(r.foto3.join(' '), /ya tiene sus 2 fotos/u)
  assert.deepEqual(r.fotos, { filas: [[0, 'image/png', true], [1, 'image/png', true]], alPrestador: 2 }, 'two pictures, without metadata, delivered to the provider')
  assert.equal(r.fotoFalsa, 'IMAGE_TYPE_NOT_ALLOWED')
  assert.deepEqual(r.fotoLectura, ['none', 'none', 'NOT_FOUND', 'NOT_FOUND'])
  assert.match(r.ajeno[0].join(' '), /vinculado a tu cuenta de prestador/u)
  assert.equal(r.ajeno[1], 'pending')
  assert.match(r.otroPrestador[0].join(' '), /No encontré esa solicitud/u)
  assert.equal(r.otroPrestador[1], 'pending')
  assert.match(r.aceptar.respuesta.join(' '), /aceptaste .*seña de \$\s?15\.000/u)
  assert.equal(r.aceptar.estado, 'awaiting_payment')
  assert.match(r.idempotente.repetida.join(' '), /aceptaste/u, 'the same answer twice is the same result')
  assert.equal(r.idempotente.duplicadoDeMeta, 0, 'a message Meta delivers twice is processed once')
  assert.equal(r.idempotente.estado, 'awaiting_payment')
  assert.equal(r.idempotente.version, r.aceptar.version, 'one transition only')
  assert.deepEqual(r.idempotente.auditoria, [['awaiting_payment', 'whatsapp', true]], 'one audit line: who, from where, what it became')
  assert.equal(r.rechazarAceptada[1], 'awaiting_payment')
  assert.deepEqual(r.avisoCliente.tipos, ['cta_url'])
  assert.match(r.avisoCliente.texto, /aceptó tu solicitud.*seña de \$\s?15\.000/u)
  assert.equal(r.avisoCliente.etiqueta, 'Pagar seña')
  assert.equal(r.avisoCliente.url, true)
  assert.equal(r.correlacion.referencia, true)
  assert.equal(r.correlacion.precioPreferencia, 15000)
  assert.equal(r.correlacion.mismoEnlace, true, 'one checkout for that deposit')
  assert.equal(r.sinPagoReal[1], 'awaiting_payment', '"ya pagué" confirms nothing')
  assert.equal(r.pagoPendiente[1], 'awaiting_payment', 'a payment in process confirms nothing')
  assert.equal(r.firmaFalsa[1], 'awaiting_payment', `a notification with a bad signature confirms nothing (${r.firmaFalsa})`)
  assert.notEqual(r.firmaFalsa[0], r.confirmado[0])
  assert.equal(r.confirmado[1], 'confirmed')
  assert.deepEqual([r.webhookRepetido.estado, r.webhookRepetido.ganancias, r.webhookRepetido.pagosAprobados], ['confirmed', 1, 1], `a repeated notification doubles nothing (${JSON.stringify(r.webhookRepetido)})`)
  assert.equal(r.confirmacion.cliente.length, 1, `the client is told once (${JSON.stringify(r.confirmacion)})`)
  assert.equal(r.confirmacion.prestador.length, 1)
  assert.deepEqual(r.web, { cliente: ['confirmed', 'paid'], prestador: 'confirmed', pendientes: 0, agenda: 'ocupado' })
})

test('TURNOS WhatsApp PostgreSQL: rejecting from WhatsApp frees the time, tells the client and charges nothing; a rejected request cannot be accepted; two answers at once are one transition; accepting against a block of the same time never leaves both; two clients never share a slot; a late payment confirms nothing; outside the 24 hour window only an approved template is sent', { skip, timeout: 600_000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('p', 'Gabriela López ' + run, [['Reparación', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      ${ASISTENTE}
      const cuentaP = await cuentaDe(p, 'gabi')
      const waP = await vincular(cuentaP)
      const waAna = await vincular(ana)
      const pedir = (cuenta, indice, hora) => turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(indice, hora), tarifaId: p.tarifas['Reparación'], clienteId: cuenta.id, clienteTenantId: cuenta.tenantId })
      const agenda = async (indice, hora) => (await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: lunes })).dias[indice].franjas.find((f) => f.hora === hora)?.estado

      // two clients, the same slot, at once: one request
      await Promise.all(Array.from({ length: 6 }, () => prisma.$queryRawUnsafe('select 1 as ok from pg_sleep(0.05)')))
      const juntos = await Promise.all([codeOf(() => pedir(ana, 0, '09:00')), codeOf(() => pedir(beto, 0, '09:00'))])
      out.mismoSlot = [juntos.filter((x) => x === 'none').length, await prisma.reserva.count({ where: { tenantId: p.tenantId, fechaInicio: new Date(a(0, '09:00')), estado: 'pending' } })]

      // reject from WhatsApp
      const pedido = await pedir(ana, 1, '10:00')
      await avisar()
      out.antes = await agenda(1, '10:00')
      let marca = fakeWa.sent.length
      const rechazo = await decir(waP, 'Rechazar', boton('rechazar', pedido.id))
      await avisar()
      out.rechazo = { respuesta: rechazo, estado: (await fila(pedido.id)).estado, agenda: await agenda(1, '10:00'), alCliente: enviadosA(waAna, marca).map((m) => m.type + ':' + m.text), obligacion: (await pagoDe(pedido.reservaId)).obligacion === null, auditoria: (await auditoria(pedido.id)).map((e) => [e.metadata.a, e.metadata.canal]) }
      // accepting a rejected request (button, word, panel): it stays rejected
      out.aceptarRechazada = [await decir(waP, 'Aceptar', boton('aceptar', pedido.id)), await codeOf(() => turnos.aceptarSolicitud({ prestadorTenantId: p.tenantId, reservaId: pedido.id })), (await fila(pedido.id)).estado, (await auditoria(pedido.id)).length]
      out.pagarRechazada = await codeOf(() => turnos.pagarSena({ clienteId: ana.id, reservaId: pedido.id, correlationId: 'c' }))
      // the freed time can be requested again
      out.reuso = await codeOf(() => pedir(beto, 1, '10:00'))

      // the word alone: with one request waiting it answers it; with two it asks which
      const sola = await pedir(ana, 2, '10:00')
      await prisma.reserva.updateMany({ where: { tenantId: p.tenantId, estado: 'pending', id: { not: sola.id } }, data: { estado: 'rejected' } })
      const conPalabra = await decir(waP, 'rechazar')
      out.palabra = [conPalabra, (await fila(sola.id)).estado]
      const dosA = await pedir(ana, 2, '11:00'); const dosB = await pedir(beto, 2, '12:00')
      out.palabraAmbigua = [await decir(waP, 'aceptar'), (await fila(dosA.id)).estado, (await fila(dosB.id)).estado]

      // the button and the panel at the same time: one transition, one audit line, one notice
      const resultados = await Promise.allSettled([decir(waP, 'Aceptar', boton('aceptar', dosA.id)), turnos.aceptarSolicitud({ prestadorTenantId: p.tenantId, reservaId: dosA.id, actorId: cuentaP.id, canal: 'web' })])
      out.dosAceptaciones = { fallas: resultados.filter((x) => x.status === 'rejected').length, estado: (await fila(dosA.id)).estado, auditoria: (await auditoria(dosA.id)).length, avisosEnCola: Number((await db.query("SELECT count(*)::int AS n FROM public.\\"outbox\\" WHERE aggregate_type = 'turno-notification' AND payload::text LIKE '%' || $1 || '%' AND payload::text LIKE '%solicitud_respondida%'", [dosA.id]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n) }
      // accept and reject at the same time: one of them, never both
      const cruce = await Promise.allSettled([turnos.aceptarSolicitud({ prestadorTenantId: p.tenantId, reservaId: dosB.id }), turnos.rechazarSolicitud({ prestadorTenantId: p.tenantId, reservaId: dosB.id })])
      out.aceptarYRechazar = [cruce.filter((x) => x.status === 'fulfilled').length >= 1, ['awaiting_payment', 'rejected'].includes((await fila(dosB.id)).estado), (await auditoria(dosB.id)).length]

      // accepting against a block of the same time
      const rondas = []
      for (const hora of ['09:00', '10:00', '11:00']) {
        const s = await pedir(ana, 3, hora)
        const fin = String(Number(hora.slice(0, 2)) + 1).padStart(2, '0') + ':00'
        const [acepta, bloquea] = await Promise.all([codeOf(() => turnos.aceptarSolicitud({ prestadorTenantId: p.tenantId, reservaId: s.id })), codeOf(() => turnos.bloquearHorario({ prestadorTenantId: p.tenantId, inicio: a(3, hora), fin: a(3, fin), motivo: 'Médico' }))])
        const estado = (await fila(s.id)).estado
        const bloqueo = await prisma.excepcionCalendario.count({ where: { tenantId: p.tenantId, estado: 'active', fechaInicio: { lt: new Date(a(3, fin)) }, fechaFin: { gt: new Date(a(3, hora)) } } })
        rondas.push([estado === 'awaiting_payment' && bloqueo > 0 ? 'AMBOS' : 'uno', estado, bloqueo, acepta, bloquea])
      }
      out.aceptarContraBloqueo = rondas

      // a payment that arrives after the turno expired or was cancelled confirms nothing
      const vencido = await turnoConCheckout(p, ana, 4, '09:00', 'Reparación')
      await prisma.reserva.update({ where: { id: vencido.pedido.id }, data: { solicitudExpiraEn: new Date(Date.now() - 60_000) } })
      mpPayment('9201', vencido.preferencia)
      await ingerir(notification('9201', { userId: '555', notificationId: run + '-late1' })).catch(() => null)
      const cancelado = await turnoConCheckout(p, ana, 4, '11:00', 'Reparación')
      await turnos.cancelarTurnoCliente({ clienteId: ana.id, reservaId: cancelado.pedido.id })
      mpPayment('9202', cancelado.preferencia)
      await ingerir(notification('9202', { userId: '555', notificationId: run + '-late2' })).catch(() => null)
      out.pagoTardio = [await estadoTurno(vencido), await estadoTurno(cancelado)]

      // outside the 24 hour window: nothing free-form; the approved template or nothing
      reloj += 25 * 3600_000
      const lejos = await pedir(beto, 4, '14:00')
      marca = fakeWa.sent.length
      await avisar()
      out.fueraDeVentana = enviadosA(waP, marca).length
      const aviso = { reservaId: lejos.id, prestadorTenantId: p.tenantId, prestadorCuentaId: cuentaP.id, clienteNombre: 'Cliente beto', servicio: 'Reparación', inicio: new Date(a(4, '14:00')), duracionMinutos: 60, expiraEn: new Date(a(4, '13:00')), precio: 30000, sena: 15000, notas: null, imagenes: [] }
      await new NotificadorTurnosWhatsapp(waTx, fakeWa, () => reloj, undefined, new WhatsappTemplateService(new Set())).solicitudRecibida(aviso)
      out.sinPlantillaAprobada = enviadosA(waP, marca).length
      await new NotificadorTurnosWhatsapp(waTx, fakeWa, () => reloj, undefined, new WhatsappTemplateService(new Set(['turno_solicitud_recibida']))).solicitudRecibida(aviso)
      const plantilla = enviadosA(waP, marca)[0]
      const cuerpo = cuerpoMensajeMeta(waP, plantilla)
      out.plantilla = { tipo: plantilla?.type, nombre: plantilla?.name, parametros: plantilla?.parameters?.length, botones: cuerpo.template.components.filter((x) => x.type === 'button').map((x) => x.sub_type + ':' + x.parameters[0].payload.split(':').slice(0, 2).join(':')) }
      // the quick reply of the template comes back as a button with the payload TUS sent
      const desdePlantilla = await decir(waP, 'Aceptar', { type: 'button', body: { button: { payload: idRespuestaTurno('aceptar', lejos.id), text: 'Aceptar' } } })
      out.respuestaPlantilla = [desdePlantilla.join(' ').includes('aceptaste'), (await fila(lejos.id)).estado]
      console.log(JSON.stringify(out))
    } finally { await cerrar() }
  `)
  assert.deepEqual(r.mismoSlot, [1, 1], 'two clients, one slot: one request')
  assert.equal(r.antes, 'ocupado', 'a pending request holds its time')
  assert.match(r.rechazo.respuesta.join(' '), /rechazaste/u)
  assert.equal(r.rechazo.estado, 'rejected')
  assert.equal(r.rechazo.agenda, 'disponible', 'the time is offered again')
  assert.equal(r.rechazo.alCliente.length, 1)
  assert.match(r.rechazo.alCliente[0], /^text:.*no pudo tomar tu solicitud/u)
  assert.equal(r.rechazo.obligacion, true, 'a rejection charges nothing')
  assert.deepEqual(r.rechazo.auditoria, [['rejected', 'whatsapp']])
  assert.match(r.aceptarRechazada[0].join(' '), /ya había sido respondida/u)
  assert.deepEqual(r.aceptarRechazada.slice(1), ['REQUEST_NOT_PENDING', 'rejected', 1])
  assert.equal(r.pagarRechazada, 'DEPOSIT_NOT_PAYABLE')
  assert.equal(r.reuso, 'none')
  assert.match(r.palabra[0].join(' '), /rechazaste/u)
  assert.equal(r.palabra[1], 'rejected')
  assert.match(r.palabraAmbigua[0].join(' '), /2 solicitudes de turno esperando/u)
  assert.deepEqual(r.palabraAmbigua.slice(1), ['pending', 'pending'], 'the word alone never guesses between two requests')
  assert.deepEqual([r.dosAceptaciones.fallas, r.dosAceptaciones.estado, r.dosAceptaciones.auditoria], [0, 'awaiting_payment', 1], `two acceptances at once are one transition (${JSON.stringify(r.dosAceptaciones)})`)
  assert.deepEqual(r.aceptarYRechazar, [true, true, 1])
  for (const ronda of r.aceptarContraBloqueo) assert.equal(ronda[0], 'uno', `an accepted turno and a block of the same time never coexist (${JSON.stringify(r.aceptarContraBloqueo)})`)
  assert.ok(!r.pagoTardio.includes('confirmed'), `a late payment confirms nothing (${r.pagoTardio})`)
  assert.equal(r.fueraDeVentana, 0, 'no free-form message outside the 24 hour window')
  assert.equal(r.sinPlantillaAprobada, 0, 'a template that Meta did not approve is never sent')
  assert.deepEqual(r.plantilla, { tipo: 'template', nombre: 'turno_solicitud_recibida', parametros: 6, botones: ['quick_reply:turno:aceptar', 'quick_reply:turno:rechazar'] })
  assert.deepEqual(r.respuestaPlantilla, [true, 'awaiting_payment'])
})

test('TURNOS cobro de señas PostgreSQL: a provider WITHOUT its own Mercado Pago is charged through the platform (its share becomes its balance); what blocks an acceptance is told apart — identity not verified vs nobody able to collect — and the provider is never told it must link its own account; the administration reads the same diagnosis', { skip, timeout: 600_000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const sin = await prestador('sin', 'Sin Cuenta ' + run, [['Reparación', 30000]])
      const con = await prestador('con', 'Con Cuenta ' + run, [['Reparación', 30000]])
      await conectarMercadoPago(con, '8831')
      const ana = await cliente('ana')
      ${ASISTENTE}
      const cuentaSin = await cuentaDe(sin, 'sin')
      const waSin = await vincular(cuentaSin)
      // The diagnosis the administration reads, with nothing attempted.
      const cobros = await turnos.cobroDeSenas([sin.tenantId, con.tenantId])
      out.diagnostico = { sin: cobros.get(sin.tenantId), con: cobros.get(con.tenantId) }
      // No own account: accepting works, the platform collects, the share becomes balance.
      const t = await turnoConCheckout(sin, ana, 0, '10:00', 'Reparación')
      mpPayment('9301', t.preferencia)
      await ingerir(notification('9301', { userId: '555', notificationId: run + '-c1' }))
      out.porPlataforma = { estado: await estadoTurno(t), cobrador: t.preferencia.token === PLATFORM_TOKEN || String(mp.payments.get('9301').collector_id) === '555', movimientos: await filas(sin), saldo: (await saldo(sin)).disponible }
      // Identity not verified: refused with ITS reason, by the panel and from WhatsApp.
      verificados.delete(sin.tenantId)
      out.diagnosticoSinIdentidad = (await turnos.cobroDeSenas([sin.tenantId])).get(sin.tenantId)
      const pedido = await turnos.solicitarTurno({ prestadorId: sin.perfilId, oficioId: oficio.id, inicio: a(1, '10:00'), tarifaId: sin.tarifas['Reparación'], clienteId: ana.id, clienteTenantId: ana.tenantId })
      const error = await turnos.aceptarSolicitud({ prestadorTenantId: sin.tenantId, reservaId: pedido.id }).then(() => null, (e) => ({ code: e.code, message: e.message, status: e.statusCode ?? e.status }))
      const porWhatsapp = await decir(waSin, 'Aceptar', boton('aceptar', pedido.id))
      out.sinIdentidad = { code: error?.code, status: error?.status, diceIdentidad: /verificar tu identidad/u.test(error?.message ?? ''), noExigeMercadoPago: /No hace falta que conectes/u.test(error?.message ?? ''), estado: (await fila(pedido.id)).estado, whatsapp: porWhatsapp.join(' ').includes('verificar tu identidad') }
      verificados.add(sin.tenantId)
      out.vuelveAAceptar = (await turnos.aceptarSolicitud({ prestadorTenantId: sin.tenantId, reservaId: pedido.id })).estado
      console.log(JSON.stringify(out))
    } finally { await cerrar() }
  `)
  assert.deepEqual(r.diagnostico.sin, { disponible: true, motivo: null, modo: 'plataforma' }, 'no own account: collected by the platform')
  assert.deepEqual(r.diagnostico.con, { disponible: true, motivo: null, modo: 'split' }, 'own account linked: collected with it')
  assert.equal(r.porPlataforma.estado, 'confirmed')
  assert.equal(r.porPlataforma.cobrador, true, 'the platform account collected')
  assert.ok(r.porPlataforma.movimientos.some(([tipo]) => tipo === 'earning_credit'), `the provider's share is an earning (${JSON.stringify(r.porPlataforma.movimientos)})`)
  assert.ok(Number(r.porPlataforma.saldo) > 0, `the provider has balance (${r.porPlataforma.saldo})`)
  assert.deepEqual(r.diagnosticoSinIdentidad, { disponible: false, motivo: 'PROVIDER_IDENTITY_NOT_VERIFIED', modo: null })
  assert.deepEqual(r.sinIdentidad, { code: 'PROVIDER_IDENTITY_REQUIRED', status: 409, diceIdentidad: true, noExigeMercadoPago: true, estado: 'pending', whatsapp: true }, 'identity is what is missing, and the provider is told exactly that')
  assert.equal(r.vuelveAAceptar, 'awaiting_payment')
})

test('TURNOS cobro de señas: every reason has its own wording for the administration and for the provider', () => {
  const contratos = readFileSync(new URL('../../packages/contracts/src/tus-turnos.ts', import.meta.url), 'utf8')
  const admin = readFileSync(new URL('../../apps/web/src/lib/tus-admin-api.ts', import.meta.url), 'utf8')
  assert.match(contratos, /CODIGO_PRESTADOR_SIN_IDENTIDAD = 'PROVIDER_IDENTITY_REQUIRED'/u)
  assert.doesNotMatch(contratos, /primero tenés que conectar tu cuenta de Mercado Pago/u, 'a provider is never told it must link its own account')
  for (const motivo of ['PAYMENTS_DISABLED', 'PROVIDER_NOT_CONFIGURED', 'PRODUCTION_NOT_AUTHORIZED', 'PROVIDER_IDENTITY_NOT_VERIFIED', 'PROVIDER_ACCOUNT_NOT_CONNECTED']) assert.ok(admin.includes(motivo), motivo)
  assert.match(admin, /Por plataforma/u)
  assert.doesNotMatch(admin, /ACCESS_TOKEN\s*[:=]\s*['"][A-Za-z0-9_-]{10,}/u, 'names of settings only, never a value')
})
