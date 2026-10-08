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
      // (Taken BEFORE the request: the request itself starts delivering its notice in the background,
      // and it may already be out by the time the lines below have run.)
      let marca = fakeWa.sent.length
      const pedido = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(0, '10:00'), tarifaId: p.tarifas['Reparación'], clienteId: ana.id, clienteTenantId: ana.tenantId, notas: 'Pierde la canilla de la cocina' })
      const guardada = await fila(pedido.id)
      out.pendiente = [guardada.estado, guardada.clienteId === ana.id, guardada.tenantId === p.tenantId, guardada.servicioId === oficio.id, guardada.fechaInicio.toISOString() === a(0, '10:00'), Number(guardada.precioFinal)]
      // the deposit cannot be paid before the provider accepts
      out.pagarAntes = await codeOf(() => turnos.pagarSena({ clienteId: ana.id, reservaId: pedido.id, correlationId: 'c' }))
      out.sinObligacion = (await pagoDe(pedido.reservaId)).obligacion === null

      // 2. the provider is told on WhatsApp, automatically
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
      for (let i = 0; i < 40 && enviadosA(waAna, marca).length === 0; i += 1) { await new Promise((resolve) => setTimeout(resolve, 250)); await avisar() }
      const alCliente = enviadosA(waAna, marca)
      out.avisoAceptacion = { tipos: alCliente.map((m) => m.type), texto: alCliente[0]?.text }
      out.avisosUnaVez = alCliente.length
      // TURNOS-CANCELACION-01: the link is not sent before the client accepts the cancellation
      // policy. It asks to pay, reads the policy, goes back (nothing opens) and then accepts.
      const botonDe = (b) => ({ type: 'interactive', body: { interactive: { type: 'button_reply', button_reply: { id: b.id, title: b.title } } } })
      const mensajesDe = async (text, extra) => { const antes = fakeWa.sent.length; await decir(waAna, text, extra); return fakeWa.sent.slice(antes).filter((x) => x.to === waAna).map((x) => x.message) }
      const pedidoDePago = await mensajesDe('pagar la seña')
      const politica = pedidoDePago.find((m) => m.type === 'buttons')
      const sinAceptar = await prisma.aceptacionPoliticaCancelacion.count({ where: { reservaId: pedido.id } })
      const vuelve = await mensajesDe('Volver', botonDe(politica.buttons[1]))
      out.politica = { texto: politica.text, botones: politica.buttons.map((b) => b.title), sinEnlace: !pedidoDePago.some((m) => m.type === 'cta_url') && !vuelve.some((m) => m.type === 'cta_url'), sinAceptar, trasVolver: await prisma.aceptacionPoliticaCancelacion.count({ where: { reservaId: pedido.id } }) }
      const aceptado = await mensajesDe('Aceptar y pagar', botonDe(politica.buttons[0]))
      const enlace = aceptado.find((m) => m.type === 'cta_url')
      const politicaGuardada = await prisma.aceptacionPoliticaCancelacion.findMany({ where: { reservaId: pedido.id } })
      out.avisoCliente = { tipos: aceptado.map((m) => m.type), texto: enlace?.text, etiqueta: enlace?.label, url: Boolean(enlace?.url && enlace.url.startsWith('https://')), aceptacion: politicaGuardada.map((g) => [g.cuentaId === ana.id, g.canal, g.tramo]) }

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
  // TURNOS-CANCELACION-01: the notice of the acceptance carries no link any more; the link comes
  // after the client accepted the cancellation policy on this channel.
  assert.deepEqual(r.avisoAceptacion.tipos, ['text'])
  assert.match(r.avisoAceptacion.texto, /aceptó tu solicitud.*seña de \$\s?15\.000.*pagar la seña/u)
  assert.match(r.politica.texto, /La seña reserva tu turno\. Podés cancelar con devolución dentro de las 24 horas de reservar, si faltan más de 24 horas para el turno\. Después la seña no es reembolsable\. El cargo de TUS nunca se devuelve\./u)
  assert.deepEqual([r.politica.botones, r.politica.sinEnlace, r.politica.sinAceptar, r.politica.trasVolver], [['Aceptar y pagar', 'Volver'], true, 0, 0], 'reading the policy or going back opens no payment and stores no acceptance')
  assert.deepEqual(r.avisoCliente.aceptacion, [[true, 'whatsapp', 'sena']], 'accepting stores who, the channel and the way of paying')
  assert.deepEqual(r.avisoCliente.tipos, ['cta_url'])
  assert.match(r.avisoCliente.texto, /Seña: \$\s?15\.000/u)
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
  // PAGOS-RETENCION-01: a deposit is an advance payment, so TUS collects it with its own account even
  // for a provider with a linked one (before: Split 1:1, paid straight to the provider).
  assert.deepEqual(r.diagnostico.con, { disponible: true, motivo: null, modo: 'plataforma' }, 'own account linked: the deposit is still collected by the platform')
  assert.equal(r.porPlataforma.estado, 'confirmed')
  assert.equal(r.porPlataforma.cobrador, true, 'the platform account collected')
  assert.ok(r.porPlataforma.movimientos.some(([tipo]) => tipo === 'earning_credit'), `the provider's share is an earning (${JSON.stringify(r.porPlataforma.movimientos)})`)
  // PAGOS-RETENCION-01: before, that share was withdrawable the moment the deposit was approved. Now it
  // is booked and held until the turno is closed.
  assert.equal(r.porPlataforma.saldo, '0', 'a deposit paid in advance is not withdrawable yet')
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

// PAGOS-MODALIDAD-01 / CIERRE-TRABAJO-01 on WhatsApp: the same backend as the Web. The client
// chooses the total instead of the deposit, is told when its turno was finished, confirms it or
// reports a problem with the buttons, and pays its balance; nothing is decided by the assistant.
test('TURNOS pago y cierre por WhatsApp PostgreSQL: "pagar total" sends the checkout of the total (and replaces the deposit); the client is told when the provider finishes and confirms with the button; a reported problem is recorded and blocks; once settled the confirmation enables the balance and its link; an unlinked number is served nothing', { skip, timeout: 600_000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('wa', 'Wa Cierre ' + run, [['Reparación', 30000]])
      const ana = await cliente('ana')
      ${ASISTENTE}
      const waAna = await vincular(ana)
      const EVIDENCIA = 'Reparación terminada y probada con el cliente.'
      const preferenciaDe = async (trabajoId, tramo) => { const o = await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId, tramo } }); const pago = await prisma.intencionPago.findFirst({ where: { obligacionId: o.obligacionId }, orderBy: { fechaCreacion: 'desc' } }); return mp.preferences.find((item) => item.body.external_reference === pago.pagoId) }
      let pagos = 200000 + Math.floor(Math.random() * 700000) * 10
      const aprobar = async (preferencia) => { pagos += 1; mpPayment(String(pagos), preferencia); const resultado = await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-w-' + pagos })); await avisar(); return resultado.result }
      const tramos = async (trabajoId) => (await prisma.obligacionPagoServicio.findMany({ where: { trabajoId }, orderBy: { tramo: 'asc' } })).map((o) => [o.tramo, o.estado])
      const liquidaciones = async (trabajoId) => (await prisma.liquidacionServicio.findMany({ where: { trabajoId }, orderBy: { obligacionId: 'asc' } })).map((l) => [l.estado, l.liberadaEn !== null])
      const ultimo = (desde) => enviadosA(waAna, desde).at(-1)

      // ---- A. The total instead of the deposit.
      const t = await turnoConCheckout(p, ana, 0, '10:00', 'Reparación')
      await avisar()
      out.avisoAceptado = enviadosA(waAna).some((m) => /pagar total/u.test(m.text ?? ''))
      let desde = fakeWa.sent.length
      await decir(waAna, 'quiero pagar el total')
      const linkTotal = ultimo(desde)
      out.pagarTotal = [linkTotal.type, linkTotal.label, /\\$\\s?30\\.000/u.test(linkTotal.text), await tramos(t.trabajoId)]
      out.totalAprobado = [await aprobar(await preferenciaDe(t.trabajoId, 'total')), await estadoTurno(t)]
      // The provider finishes it: the client is told, with the two buttons.
      adelantar(9 * 24 * 3600_000)
      desde = fakeWa.sent.length
      await cierre.finalizar(p.ctx, t.trabajoId, { evidence: EVIDENCIA })
      await avisar()
      const finalizado = ultimo(desde)
      out.avisoFinalizado = [finalizado.type, finalizado.buttons.map((b) => b.id), finalizado.text.includes(EVIDENCIA), /se confirma automáticamente/u.test(finalizado.text)]
      // A number that is not linked to the account of that turno is served nothing.
      const ajeno = await decir('5491155900999', 'Confirmar', botonCierre('confirmar', t.pedido.id))
      out.numeroAjeno = [ajeno.some((x) => /vinculado a tu cuenta/u.test(x)), (await prisma.cierreTrabajo.findFirst({ where: { trabajoId: t.trabajoId } })).confirmadoEn]
      const confirmado = await decir(waAna, 'Confirmar', botonCierre('confirmar', t.pedido.id))
      out.confirmado = [confirmado.some((x) => /confirmaste que se realizó/u.test(x) && /pagado por completo/u.test(x)), await estadoTurno(t), await liquidaciones(t.trabajoId), (await prisma.cierreTrabajo.findFirst({ where: { trabajoId: t.trabajoId } })).confirmacionOrigen]
      out.repetido = (await decir(waAna, 'Confirmar', botonCierre('confirmar', t.pedido.id))).join(' | ')

      // ---- B. Deposit, a problem, the balance.
      const s = await turnoConCheckout(p, ana, 0, '11:00', 'Reparación')
      await aprobar(s.preferencia)
      desde = fakeWa.sent.length
      out.saldoAntes = (await decir(waAna, 'quiero pagar el saldo')).join(' | ')
      await cierre.finalizar(p.ctx, s.trabajoId, { evidence: EVIDENCIA })
      await avisar()
      const pideMotivo = await decir(waAna, 'Reportar problema', botonCierre('problema', s.pedido.id))
      const registrado = await decir(waAna, 'El técnico se fue sin terminar de ajustar la canilla.')
      const fila1 = await prisma.cierreTrabajo.findFirst({ where: { trabajoId: s.trabajoId } })
      out.problema = [pideMotivo.some((x) => /Contame en un mensaje qué pasó/u.test(x)), registrado.some((x) => /Registré el problema/u.test(x)), fila1.observacionMotivo, fila1.confirmadoEn, (await waStore.repositorios().conversaciones.activaDeContacto((await waStore.repositorios().contactos.buscarPorWaId(waAna)).contactId)).state.closingReport ?? null]
      out.confirmarConProblema = (await decir(waAna, 'Confirmar', botonCierre('confirmar', s.pedido.id))).join(' | ')
      // The platform settles it; the client confirms in words; the balance is enabled and sent.
      await cierre.resolverObservacion(admin, { tenantId: ana.tenantId, trabajoId: s.trabajoId })
      desde = fakeWa.sent.length
      const enPalabras = await decir(waAna, 'confirmo que el turno se realizó')
      await avisar()
      const enlaces = enviadosA(waAna, desde).filter((m) => m.type === 'cta_url')
      out.saldoHabilitado = [enPalabras.some((x) => /confirmaste que se realizó/u.test(x)), enlaces.map((m) => m.label), enlaces.every((m) => /\\$\\s?15\\.000/u.test(m.text)), new Set(enlaces.map((m) => m.url)).size, await tramos(s.trabajoId), await liquidaciones(s.trabajoId)]
      desde = fakeWa.sent.length
      await decir(waAna, 'pasame el link para pagar el saldo')
      out.pedirSaldo = [ultimo(desde).label, ultimo(desde).url === enlaces[0].url]
      out.saldoAprobado = [await aprobar(await preferenciaDe(s.trabajoId, 'saldo')), await tramos(s.trabajoId), await liquidaciones(s.trabajoId)]
      out.nadaMas = (await decir(waAna, 'quiero pagar el saldo')).join(' | ')
      console.log(JSON.stringify(out))
    } catch (e) { console.error('DUMP-W', JSON.stringify(out)); throw e } finally { await cerrar() }
  `)
  assert.equal(r.avisoAceptado, true, 'the acceptance notice offers the total in words')
  assert.deepEqual(r.pagarTotal, ['cta_url', 'Pagar total', true, [['sena', 'voided'], ['total', 'pending_payment']]], 'the checkout of the total, with its amount; the deposit is replaced')
  assert.deepEqual(r.totalAprobado, ['applied', 'confirmed'])
  assert.deepEqual(r.avisoFinalizado[0], 'buttons')
  assert.equal(r.avisoFinalizado[1].length, 2)
  assert.match(r.avisoFinalizado[1][0], /^cierre:confirmar:/u)
  assert.match(r.avisoFinalizado[1][1], /^cierre:problema:/u)
  assert.deepEqual(r.avisoFinalizado.slice(2), [true, true], 'the notice carries what the provider did and says it confirms by itself')
  assert.deepEqual(r.numeroAjeno, [true, null], 'another number confirms nothing')
  assert.deepEqual(r.confirmado, [true, 'completed', [['eligible', true]], 'cliente'], 'the button confirms it through the backend: fully paid, released')
  assert.match(r.repetido, /ya estaba confirmado|confirmaste que se realizó/u, 'tapping again changes nothing')
  assert.match(r.saldoAntes, /Se puede pagar cuando el turno se haya prestado y esté confirmado/u, 'the balance is told, and not payable yet')
  assert.deepEqual(r.problema, [true, true, 'El técnico se fue sin terminar de ajustar la canilla.', null, null], 'the problem is recorded in the backend; nothing of it stays in the conversation')
  assert.match(r.confirmarConProblema, /problema reportado/u, 'an open problem blocks the confirmation')
  assert.deepEqual(r.saldoHabilitado.slice(0, 4), [true, ['Pagar saldo', 'Pagar saldo'].slice(0, r.saldoHabilitado[1].length), true, 1], 'confirmed: the balance and its one checkout')
  assert.ok(r.saldoHabilitado[1].length >= 1)
  assert.deepEqual(r.saldoHabilitado.slice(4), [[['saldo', 'pending_payment'], ['sena', 'paid']], [['held', false]]], 'everything still held until the balance is approved')
  assert.deepEqual(r.pedirSaldo, ['Pagar saldo', true], 'asking for it again is the same payment')
  assert.deepEqual(r.saldoAprobado, ['applied', [['saldo', 'paid'], ['sena', 'paid']], [['eligible', true], ['eligible', true]]])
  assert.match(r.nadaMas, /No tenés saldos pendientes/u)
})

// TURNOS-RECORDATORIOS-01 / TURNOS-CANCELACION-01 through the REAL assistant and notifier.
test('RECORDATORIOS por WhatsApp PostgreSQL: outside the 24 hour window only the approved template is sent (nothing free-form, and nothing without it); inside it an interactive message; the client is told about the deposit and the provider never is; "No puedo asistir" cancels nothing until it is confirmed, the loss is confirmed explicitly inside the 24 hours and the backend decides again at that moment; buttons repeated change nothing; somebody else\'s reminder does not exist', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('rec', 'Wa Recuerda ' + run, [['Reparación', 30000]])
      const ana = await cliente('ana')
      ${ASISTENTE}
      const cuentaP = await cuentaDe(p, 'duena')
      const waAna = await vincular(ana)
      const waP = await vincular(cuentaP)
      const { ServicioRecordatoriosTurno, idRecordatorio } = await import('./apps/api/src/tus/calendar/turnos-recordatorios.ts')
      const { NotificadorRecordatoriosWhatsapp } = await import('./apps/api/src/tus/asistente/avisos-recordatorios.ts')
      const TODAS = ['turno_recordatorio_24h', 'turno_recordatorio_2h', 'turno_recordatorio_24h_prestador', 'turno_recordatorio_2h_prestador']
      const canalCon = (aprobadas) => new NotificadorRecordatoriosWhatsapp(waTx, fakeWa, () => reloj, undefined, new WhatsappTemplateService(new Set(aprobadas)))
      const recordatorios = new ServicioRecordatoriosTurno(prisma, (id) => turnos.datosDeRecordatorio(id), canalCon([]), () => reloj)
      compartidos.recordatorios = recordatorios
      turnos.conReloj(() => reloj)
      const HORA = 3600_000
      let pagos = 300000 + Math.floor(Math.random() * 600000) * 10
      async function turnoPagado(hora) {
        const t = await turnoConCheckout(p, ana, 0, hora, 'Reparación')
        pagos += 1
        mpPayment(String(pagos), t.preferencia)
        await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-r-' + pagos }))
        await avisar()
        return { ...t, inicio: (await fila(t.pedido.id)).fechaInicio.getTime() }
      }
      const hablar = async (wa, text, extra) => { const antes = fakeWa.sent.length; await decir(wa, text, extra); return fakeWa.sent.slice(antes).filter((x) => x.to === wa).map((x) => x.message) }
      const rapida = (payload, text) => ({ type: 'button', body: { button: { payload, text } } })
      const tocar = (b) => ({ type: 'interactive', body: { interactive: { type: 'button_reply', button_reply: { id: b.id, title: b.title } } } })
      const filas = async (t) => (await prisma.recordatorioTurno.findMany({ where: { reservaId: t.pedido.id }, orderBy: [{ tipo: 'asc' }, { destinatario: 'asc' }] })).map((x) => [x.destinatario, x.tipo, x.estado, x.motivo, x.via, x.plantilla, x.respuesta, x.respuestaCanal, x.cancelacion])
      const cancelacion = async (t) => { const c = await prisma.cancelacionTurno.findUnique({ where: { reservaId: t.pedido.id } }); return c ? [c.canceladaPor, c.tardia, c.devolucion, c.canal] : null }
      const t1 = await turnoPagado('10:00')
      const t2 = await turnoPagado('11:00')
      const t3 = await turnoPagado('12:00')
      await recordatorios.procesar(500)

      // ---- A. Outside the window and WITHOUT an approved template: nothing is written.
      reloj = t1.inicio - 24 * HORA
      let marca = fakeWa.sent.length
      await recordatorios.procesar(500)
      out.sinPlantilla = [fakeWa.sent.length - marca, (await filas(t1)).filter((x) => x[1] === '24h').map((x) => x[2] + ':' + x[3])]

      // ---- B. With the templates approved: the template, with the payloads of the two answers.
      recordatorios.conCanal(canalCon(TODAS))
      reloj = t2.inicio - 24 * HORA
      marca = fakeWa.sent.length
      await recordatorios.procesar(500)
      const aCliente = enviadosA(waAna, marca)
      const aPrestador = enviadosA(waP, marca)
      const cuerpo = cuerpoMensajeMeta(waAna, aCliente[0])
      out.plantillas = {
        cliente: [aCliente.length, aCliente[0]?.type, aCliente[0]?.name, aCliente[0]?.parameters?.length, aCliente[0]?.parameters?.[1], aCliente[0]?.parameters?.[4].startsWith('Wa Recuerda')],
        prestador: [aPrestador.length, aPrestador[0]?.type, aPrestador[0]?.name, aPrestador[0]?.parameters?.length],
        botones: cuerpo.template.components.filter((x) => x.type === 'button').map((x) => x.sub_type + ':' + x.parameters[0].payload.split(':').slice(0, 2).join(':')),
        idioma: cuerpo.template.language.code,
      }
      out.auditoria = (await filas(t2)).filter((x) => x[1] === '24h').map((x) => [x[0], x[2], x[4], x[5]])
      const recCliente = await prisma.recordatorioTurno.findFirst({ where: { reservaId: t2.pedido.id, destinatario: 'cliente', tipo: '24h' } })
      const recPrestador = await prisma.recordatorioTurno.findFirst({ where: { reservaId: t2.pedido.id, destinatario: 'prestador', tipo: '24h' } })
      out.wamid = [Boolean(recCliente.wamid), recCliente.enviadoEn !== null]

      // ---- C. The client: "No puedo asistir" asks first. Inside the 24 hours it names the loss.
      const pregunta = await hablar(waAna, 'No puedo asistir', rapida(idRecordatorio('nopuede', recCliente.id), 'No puedo asistir'))
      out.pregunta = [pregunta.map((m) => m.type), pregunta[0]?.text, pregunta[0]?.buttons?.map((b) => b.title), (await fila(t2.pedido.id)).estado]
      const vuelve = await hablar(waAna, 'Volver', tocar(pregunta[0].buttons[1]))
      out.vuelve = [vuelve[0]?.text, (await fila(t2.pedido.id)).estado, await cancelacion(t2)]
      // A button that did NOT name the loss (shown before the 24 hours) confirmed now, inside
      // them: the backend decides with its own clock and asks for the explicit confirmation.
      const sinPerdida = await hablar(waAna, 'Sí, cancelar turno', tocar({ id: idRecordatorio('cancelar', recCliente.id), title: 'Sí, cancelar turno' }))
      out.sinPerdida = [sinPerdida[0]?.type, sinPerdida[0]?.text === pregunta[0]?.text, (await fila(t2.pedido.id)).estado]
      const cancela = await hablar(waAna, 'Sí, cancelar turno', tocar(pregunta[0].buttons[0]))
      const otraVez = await hablar(waAna, 'Sí, cancelar turno', tocar(pregunta[0].buttons[0]))
      out.cancela = [cancela[0]?.text, (await fila(t2.pedido.id)).estado, await cancelacion(t2), await prisma.cancelacionTurno.count({ where: { reservaId: t2.pedido.id } }), otraVez.length > 0, (await filas(t2)).find((x) => x[0] === 'cliente' && x[1] === '24h').slice(6)]
      // Somebody else's reminder does not exist for this account.
      const ajeno = await hablar(waAna, 'Confirmar asistencia', rapida(idRecordatorio('asiste', recPrestador.id), 'Confirmar asistencia'))
      out.ajeno = [ajeno[0]?.text, (await prisma.recordatorioTurno.findUnique({ where: { id: recPrestador.id } })).respuesta]

      // ---- D. The provider confirms it attends; later, inside the window, the reminder of 2 hours
      // is an interactive message. It is never told about the deposit.
      reloj = t3.inicio - 24 * HORA
      await recordatorios.procesar(500)
      const rec3P = await prisma.recordatorioTurno.findFirst({ where: { reservaId: t3.pedido.id, destinatario: 'prestador', tipo: '24h' } })
      const asiste = await hablar(waP, 'Confirmar asistencia', rapida(idRecordatorio('asiste', rec3P.id), 'Confirmar asistencia'))
      const asiste2 = await hablar(waP, 'Confirmar asistencia', rapida(idRecordatorio('asiste', rec3P.id), 'Confirmar asistencia'))
      out.asiste = [asiste[0]?.text, asiste2.length, (await prisma.recordatorioTurno.findUnique({ where: { id: rec3P.id } })).respuesta, (await fila(t3.pedido.id)).estado]
      await hablar(waAna, 'hola')
      reloj = t3.inicio - 2 * HORA
      marca = fakeWa.sent.length
      await recordatorios.procesar(500)
      const dosCliente = enviadosA(waAna, marca)
      const dosPrestador = enviadosA(waP, marca)
      out.enVentana = { cliente: [dosCliente.length, dosCliente[0]?.type, dosCliente[0]?.text, dosCliente[0]?.buttons?.map((b) => b.title)], prestador: [dosPrestador.length, dosPrestador[0]?.type, /seña|reembols/iu.test(dosPrestador[0]?.text ?? ''), /es hoy a las/u.test(dosPrestador[0]?.text ?? '')], vias: (await filas(t3)).filter((x) => x[1] === '2h').map((x) => [x[0], x[2], x[4], x[5]]) }
      // The provider cannot go: asked first, never the wording of the client's loss; the client is due its money.
      const preguntaP = await hablar(waP, 'No puedo asistir', tocar(dosPrestador[0].buttons[1]))
      const cancelaP = await hablar(waP, 'Sí, cancelar turno', tocar(preguntaP[0].buttons[0]))
      out.prestadorCancela = [preguntaP[0]?.type, /seña no será reembolsada/u.test(preguntaP[0]?.text ?? ''), /devolverle lo que pagó/u.test(preguntaP[0]?.text ?? ''), cancelaP[0]?.text, (await fila(t3.pedido.id)).estado, await cancelacion(t3)]
      console.log(JSON.stringify(out))
    } finally { await cerrar() }
  `)
  assert.deepEqual(r.sinPlantilla, [0, ['skipped:requiere_plantilla', 'skipped:requiere_plantilla']], 'outside the window and without an approved template nothing is written, and the reason is kept')
  assert.deepEqual(r.plantillas.cliente, [1, 'template', 'turno_recordatorio_24h', 5, 'Reparación', true])
  assert.deepEqual(r.plantillas.prestador, [1, 'template', 'turno_recordatorio_24h_prestador', 5])
  assert.deepEqual(r.plantillas.botones, ['quick_reply:recordatorio:asiste', 'quick_reply:recordatorio:nopuede'])
  assert.equal(r.plantillas.idioma, 'es_AR')
  assert.deepEqual(r.auditoria, [['cliente', 'sent', 'plantilla', 'turno_recordatorio_24h'], ['prestador', 'sent', 'plantilla', 'turno_recordatorio_24h_prestador']])
  assert.deepEqual(r.wamid, [true, true])
  assert.deepEqual(r.pregunta, [['buttons'], 'Este turno comienza dentro de las próximas 24 horas. Si cancelás ahora, la seña no será reembolsada. ¿Querés continuar?', ['Sí, cancelar turno', 'Volver'], 'confirmed'], '"No puedo asistir" cancels nothing: it asks, naming the loss')
  assert.deepEqual(r.vuelve, ['Listo, no cancelé nada: tu turno sigue en pie.', 'confirmed', null])
  assert.deepEqual(r.sinPerdida, ['buttons', true, 'confirmed'], 'a confirmation that did not name the loss does not cancel inside the 24 hours')
  assert.match(r.cancela[0], /^Listo, cancelé tu turno de Reparación con Wa Recuerda .* No hay devolución: se retiene lo que pagaste \(\$\s?15\.000\)\.$/u)
  assert.deepEqual(r.cancela.slice(1), ['cancelled-late', ['cliente', true, 'no_reembolsable', 'whatsapp'], 1, true, ['no_puede', 'whatsapp', true]], 'confirmed: a late cancellation, once, recorded on the reminder')
  assert.deepEqual(r.ajeno, ['No encontré ese turno entre los tuyos.', null])
  assert.match(r.asiste[0], /^¡Gracias! Quedó registrado que asistís a tu turno de Reparación con Cliente ana/u)
  assert.deepEqual(r.asiste.slice(1), [1, 'asiste', 'confirmed'])
  assert.deepEqual(r.enVentana.cliente.slice(0, 2), [1, 'buttons'], 'inside the window: an interactive message, not a template')
  assert.match(r.enVentana.cliente[2], /^Hola, Cliente\. Te recordamos que tu turno de Reparación es hoy a las 12:00 con Wa Recuerda .*\. Si cancelás ahora, la seña abonada no es reembolsable\.$/u)
  assert.deepEqual(r.enVentana.cliente[3], ['Confirmar asistencia', 'No puedo asistir'])
  assert.deepEqual(r.enVentana.prestador, [1, 'buttons', false, true], 'the provider is never told about the deposit')
  assert.deepEqual(r.enVentana.vias, [['cliente', 'sent', 'ventana', null], ['prestador', 'sent', 'ventana', null]])
  assert.deepEqual(r.prestadorCancela.slice(0, 3), ['buttons', false, true])
  assert.match(r.prestadorCancela[3], /^Listo, cancelé tu turno de Reparación con Cliente ana.* Al cliente le corresponde la devolución de lo que pagó por el servicio: la procesa TUS\.$/u)
  assert.deepEqual(r.prestadorCancela.slice(4), ['cancelled', ['prestador', false, 'corresponde', null]])
})

// TURNOS-REPROGRAMACION-01 through the REAL assistant: the same backend operations as the Web.
test('REPROGRAMACION por WhatsApp PostgreSQL: "quiero cambiar mi turno" lists the real free times of the same provider; a number chooses one and the change is confirmed with two buttons before anything moves; going back changes nothing; confirming moves the SAME turno (payments untouched) and the provider is told on WhatsApp; a turno that does not admit it, or inside the 24 hours, is explained and not moved; words of a booking in progress are not taken as a rescheduling', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const p = await prestador('rpw', 'Wa Mueve ' + run, [['Reparación', 30000]])
      const ana = await cliente('ana')
      const beto = await cliente('beto')
      ${ASISTENTE}
      const cuentaP = await cuentaDe(p, 'duena')
      const waAna = await vincular(ana)
      const waBeto = await vincular(beto)
      const waP = await vincular(cuentaP)
      turnos.conReloj(() => relojTurnos ?? Date.now())
      let relojTurnos = null
      const HORA = 3600_000
      let pagos = 600000 + Math.floor(Math.random() * 300000) * 10
      async function turnoPagado(cuenta, indice, hora) {
        const t = await turnoConCheckout(p, cuenta, indice, hora, 'Reparación')
        pagos += 1
        mpPayment(String(pagos), t.preferencia)
        await ingerir(notification(String(pagos), { userId: '555', notificationId: run + '-w-' + pagos }))
        await avisar()
        return t
      }
      const hablar = async (wa, text, extra) => { const antes = fakeWa.sent.length; await decir(wa, text, extra); return fakeWa.sent.slice(antes).filter((x) => x.to === wa).map((x) => x.message) }
      const tocar = (b) => ({ type: 'interactive', body: { interactive: { type: 'button_reply', button_reply: { id: b.id, title: b.title } } } })
      const inicioDe = async (t) => (await fila(t.pedido.id)).fechaInicio.toISOString()

      // Beto's turno was booked while the provider did not allow rescheduling.
      const fijo = await turnoPagado(beto, 4, '09:00')
      await turnos.guardarReprogramacionPrestador(p.tenantId, true)
      const t = await turnoPagado(ana, 4, '10:00')
      const antes = await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: t.trabajoId } })

      // ---- A. The list of free times, as the agenda of that provider gives them.
      const lista = await hablar(waAna, 'quiero cambiar mi turno')
      const lineas = (lista[0]?.text ?? '').split('\\n')
      out.lista = [lista.map((m) => m.type), /^Tu turno de Reparación con Wa Mueve .* es el /u.test(lineas[0] ?? ''), lineas.filter((l) => /^\\d+\\. /u.test(l)).length, /Respondé con el número/u.test(lineas.at(-1) ?? ''), (lista[0]?.text ?? '').includes('10:00'), await inicioDe(t)]
      const fuera = await hablar(waAna, '99')
      out.fueraDeRango = fuera[0]?.text
      // ---- B. A number: the change is confirmed first.
      const elegir = await hablar(waAna, '2')
      const confirmacion = elegir[0]
      out.confirmacion = [confirmacion?.type, /^Vas a cambiar tu turno del .* a las 10:00 al .* Tus pagos y tu seña se mantienen\\.$/u.test(confirmacion?.text ?? ''), confirmacion?.buttons?.map((b) => b.title), await inicioDe(t)]
      const vuelve = await hablar(waAna, 'Volver', tocar(confirmacion.buttons[1]))
      out.vuelve = [vuelve[0]?.text, await inicioDe(t), await prisma.reprogramacionTurno.count({ where: { reservaId: t.pedido.id } })]
      // ---- C. Again, and this time it confirms: the SAME turno moves; the provider is told.
      await hablar(waAna, 'reprogramar')
      const elegir2 = await hablar(waAna, '1')
      const marca = fakeWa.sent.length
      const hecho = await hablar(waAna, 'Confirmar cambio', tocar(elegir2[0].buttons[0]))
      await avisar()
      const nuevo = await inicioDe(t)
      const despues = await prisma.obligacionPagoServicio.findMany({ where: { trabajoId: t.trabajoId } })
      const historia = await prisma.reprogramacionTurno.findMany({ where: { reservaId: t.pedido.id } })
      const alPrestador = enviadosA(waP, marca).map((m) => m.text ?? m.type)
      out.movido = [/^Listo: tu turno quedó para el .* Tus pagos y tu seña se mantienen\\.$/u.test(hecho[0]?.text ?? ''), nuevo !== a(4, '10:00'), Date.parse(nuevo) - Date.now() > 24 * HORA, (await fila(t.pedido.id)).estado, JSON.stringify(despues.map((o) => [o.obligacionId, o.estado, String(o.monto)])) === JSON.stringify(antes.map((o) => [o.obligacionId, o.estado, String(o.monto)])), historia.map((h) => [h.actorId === ana.id, h.canal, h.inicioAnterior.toISOString() === a(4, '10:00'), h.inicioNuevo.toISOString() === nuevo])]
      out.avisoPrestador = [alPrestador.length, /^Cliente ana reprogramó su turno de Reparación\\. Antes: .* a las 10:00\\. Ahora: .*\\. No tenés que hacer nada: eligió un horario libre de tu agenda\\.$/u.test(alPrestador[0] ?? '')]
      // The same button again: the time is the turno's own now; nothing else happens.
      const repetido = await hablar(waAna, 'Confirmar cambio', tocar(elegir2[0].buttons[0]))
      out.repetido = [repetido.length > 0, await prisma.reprogramacionTurno.count({ where: { reservaId: t.pedido.id } }), (await inicioDe(t)) === nuevo]

      // ---- D. A turno that does not admit it; and one inside the 24 hours.
      const noAdmite = await hablar(waBeto, 'quiero reprogramar mi turno')
      out.noAdmite = [noAdmite[0]?.text, (await inicioDe(fijo)) === a(4, '09:00')]
      relojTurnos = Date.parse(nuevo) - 5 * HORA
      const cerrado = await hablar(waAna, 'necesito cambiar mi turno')
      out.cerrado = cerrado[0]?.text
      relojTurnos = null
      // ---- E. Somebody that is booking is not taken for somebody rescheduling.
      const sinTurnos = await cliente('caro')
      const waCaro = await vincular(sinTurnos)
      const otroHorario = await hablar(waCaro, '¿tenés otro horario?')
      out.noSecuestra = !otroHorario.some((m) => /reprogramar/iu.test(m.text ?? ''))
      console.log(JSON.stringify(out))
    } finally { await cerrar() }
  `)
  assert.deepEqual(r.lista.slice(0, 4), [['text'], true, 8, true], 'the next free times of the same provider, numbered')
  assert.equal(r.lista[4], true)
  assert.match(r.fueraDeRango, /^Respondé con un número del 1 al 8\.$/u)
  assert.deepEqual(r.confirmacion.slice(0, 3), ['buttons', true, ['Confirmar cambio', 'Volver']], 'choosing a time asks to confirm the change, saying what stays')
  assert.equal(r.confirmacion[3], r.lista[5], 'nothing moved yet')
  assert.deepEqual(r.vuelve, ['Listo, no cambié nada: tu turno sigue como estaba.', r.lista[5], 0])
  assert.deepEqual(r.movido, [true, true, true, 'confirmed', true, [[true, 'whatsapp', true, true]]], 'confirmed: the same turno at its new time, its payments untouched, recorded with its channel')
  assert.deepEqual(r.avisoPrestador, [1, true], 'the provider is told who, what, when it was and when it is')
  assert.deepEqual(r.repetido, [true, 1, true], 'the same button twice moves it once')
  assert.deepEqual(r.noAdmite, ['Este turno no admite reprogramación.', true])
  assert.equal(r.cerrado, 'Este turno comienza dentro de las próximas 24 horas: ya no se puede reprogramar. Podés mantenerlo o cancelarlo según la política de cancelación.')
  assert.equal(r.noSecuestra, true)
})

