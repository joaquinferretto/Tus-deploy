import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'
import { ASISTENTE_TURNOS } from './fixtures/turnos-whatsapp-pg.mjs'

// ADMIN-WHATSAPP-AVISOS-01 on a DISPOSABLE PostgreSQL 16 (TUS_PAYMENTS_PG_URL). "¿TUS le avisó al
// prestador?" answered from what the system really has, for the requests of turno a conversation
// made: the message of the notice with the status Meta reported (sent, delivered, read, failed),
// the record of a notice that was NOT sent (with its reason) and the answer of the provider (the
// state of the turno + its audit). Nothing is inferred from the request having been created.
//
// REAL: the turnos service and its outbox of notices, the WhatsApp notifier, the ingest of Meta's
// status webhooks, the support service Admin reads. STAND-IN: Meta (FakeWhatsappProvider), so this
// proves the code, not a delivery by Meta. The requests are linked to the client's conversation
// the way the assistant does it: an executed confirmation of book_appointment.
const url = process.env.TUS_PAYMENTS_PG_URL
const skip = !url && 'TUS_PAYMENTS_PG_URL not set (disposable PostgreSQL 16 only)'
const SETUP = turnosPagosSetup(url)

test('ADMIN WhatsApp avisos: Admin sees, per request of a conversation, who was told, on which masked number, how far the notice got (sent, delivered, read, failed), why it was not sent, and what the provider answered', { skip }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const { ErrorMetaWhatsapp } = await import('./apps/api/src/tus/asistente/meta.ts')
      ${ASISTENTE_TURNOS}
      const ana = await cliente('ana')
      const waAna = await vincular(ana)
      const repos = waStore.repositorios()
      const contactoAna = await repos.contactos.buscarPorWaId(waAna)
      const convAna = await repos.conversaciones.activaDeContacto(contactoAna.contactId)
      const admin = { actorId: 'admin-1', correlationId: 'corr-admin' }
      // A request the way the assistant leaves it: asked by one client, kept by the conversation.
      let n = 0
      async function solicitar(p, hora) {
        n += 1
        const quien = await cliente('c' + n)
        const pedido = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(0, hora), tarifaId: p.tarifas['Reparación'], clienteId: quien.id, clienteTenantId: quien.tenantId })
        const ahora = new Date(reloj).toISOString()
        await waTx.ejecutar((x) => x.confirmaciones.crear({ confirmationId: 'conf-' + run + '-' + n, conversationId: convAna.conversationId, contactId: contactoAna.contactId, accountId: quien.id, tenantId: quien.tenantId, tool: 'book_appointment', arguments: {}, argumentsHash: 'h', summary: 's', status: 'executed', result: { appointment: { id: pedido.id } }, expiresAt: ahora, createdAt: new Date(reloj + n).toISOString(), decidedAt: ahora }))
        return pedido
      }
      const avisos = async () => (await modulo.soporte.detalle(convAna.conversationId, admin)).providerNotices
      const de = async (pedido) => { const x = (await avisos()).find((item) => item.reservaId === pedido.id); return x ? { prestador: x.provider.name, estado: x.state, entregas: x.deliveries.map((d) => [d.waIdMasked, d.kind, d.status, d.error]), noEnviado: x.notSent?.reason ?? null, respuesta: x.answer ? [x.answer.result, x.answer.channel] : null, turno: x.appointmentStatus } : null }
      const estadoMeta = async (wamid, status, masMs) => modulo.ingreso.procesar(parsearWebhookMeta({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE }, statuses: [{ id: wamid, status, timestamp: String(Math.floor((reloj + masMs) / 1000)), recipient_id: 'x' }] } }] }] }, PHONE), 'corr-estado')
      const wamidDe = (waId) => fakeWa.sent.filter((x) => x.to === waId && x.message.type === 'buttons').at(-1).wamid

      // No request yet: nothing to show.
      out.vacio = (await avisos()).length

      // A. Gabriela, her WhatsApp linked and its window open.
      const gabi = await prestador('g', 'Gabriela Lopez ' + run, [['Reparación', 30000]])
      const waGabi = await vincular(await cuentaDe(gabi, 'gabi'))
      const pedidoA = await solicitar(gabi, '10:00')
      out.antesDeProcesar = await de(pedidoA)
      await avisar()
      out.enviado = await de(pedidoA)
      out.mascara = [out.enviado.entregas[0][0], waGabi.slice(-4), JSON.stringify(await avisos()).includes(waGabi)]
      const convGabi = await repos.conversaciones.activaDeContacto((await repos.contactos.buscarPorWaId(waGabi)).contactId)
      out.conversacionDelPrestador = (await avisos())[0].deliveries[0].conversationId === convGabi.conversationId
      await estadoMeta(wamidDe(waGabi), 'delivered', 1000)
      out.entregado = (await de(pedidoA)).estado
      const entregadoEn = (await avisos())[0].deliveries[0].at
      await estadoMeta(wamidDe(waGabi), 'read', 2000)
      out.leido = (await de(pedidoA)).estado
      out.horaAvanza = (await avisos())[0].deliveries[0].at > entregadoEn
      // An older callback never moves it back.
      await estadoMeta(wamidDe(waGabi), 'delivered', 500)
      out.noRetrocede = (await de(pedidoA)).estado
      // What Admin reads in Gabriela's own conversation: the notice as it left, with its status.
      const suya = await modulo.soporte.detalle(convGabi.conversationId, admin)
      const mensaje = suya.messages.find((m) => m.type === 'buttons')
      out.enSuConversacion = [mensaje.direction, mensaje.status, Boolean(mensaje.statusAt), /Aceptar|solicitud|turno/iu.test(mensaje.text ?? ''), suya.providerNotices.length]
      // She accepts from WhatsApp.
      await decir(waGabi, '', boton('aceptar', pedidoA.id))
      out.acepto = await de(pedidoA)

      // B. Another provider rejects.
      const beto = await prestador('b', 'Beto Diaz ' + run, [['Reparación', 30000]])
      const waBeto = await vincular(await cuentaDe(beto, 'beto'))
      const pedidoB = await solicitar(beto, '11:00')
      await avisar()
      await decir(waBeto, '', boton('rechazar', pedidoB.id))
      out.rechazo = await de(pedidoB)

      // C. Meta refuses the send.
      const caro = await prestador('c', 'Caro Ruiz ' + run, [['Reparación', 30000]])
      await vincular(await cuentaDe(caro, 'caro'))
      const pedidoC = await solicitar(caro, '12:00')
      fakeWa.fallarProximo(new ErrorMetaWhatsapp('WHATSAPP_INVALID_REQUEST', 'refused'))
      await avisar()
      out.fallo = await de(pedidoC)

      // D. Meta reports the failure afterwards (accepted, then undeliverable).
      const dani = await prestador('d', 'Dani Sosa ' + run, [['Reparación', 30000]])
      const waDani = await vincular(await cuentaDe(dani, 'dani'))
      const pedidoD = await solicitar(dani, '13:00')
      await avisar()
      await estadoMeta(wamidDe(waDani), 'failed', 1000)
      out.falloDespues = (await de(pedidoD)).estado

      // E. No WhatsApp linked to the provider's account.
      const eva = await prestador('e', 'Eva Paz ' + run, [['Reparación', 30000]])
      await cuentaDe(eva, 'eva')
      const pedidoE = await solicitar(eva, '14:00')
      await avisar()
      out.sinWhatsapp = await de(pedidoE)

      // F. Linked, but its 24 hour window is closed and TUS has no approved template.
      const fede = await prestador('f', 'Fede Mora ' + run, [['Reparación', 30000]])
      const waFede = await vincular(await cuentaDe(fede, 'fede'))
      const convFede = await repos.conversaciones.activaDeContacto((await repos.contactos.buscarPorWaId(waFede)).contactId)
      await waTx.ejecutar((x) => x.conversaciones.actualizar({ ...convFede, lastInboundAt: new Date(reloj - 30 * 3600000).toISOString(), version: convFede.version + 1 }, convFede.version))
      const pedidoF = await solicitar(fede, '15:00')
      await avisar()
      out.requierePlantilla = await de(pedidoF)

      // G. Its only conversation was taken by an operator: the assistant does not write there.
      const gus = await prestador('h', 'Gus Vera ' + run, [['Reparación', 30000]])
      const waGus = await vincular(await cuentaDe(gus, 'gus'))
      const convGus = await repos.conversaciones.activaDeContacto((await repos.contactos.buscarPorWaId(waGus)).contactId)
      await modulo.soporte.tomar(convGus.conversationId, admin)
      const pedidoG = await solicitar(gus, '16:00')
      await avisar()
      out.conOperador = await de(pedidoG)

      // H. The provider has no account linked at all.
      const hugo = await prestador('i', 'Hugo Luna ' + run, [['Reparación', 30000]])
      const pedidoH = await solicitar(hugo, '17:00')
      await avisar()
      out.sinCuenta = await de(pedidoH)

      // The whole block, in the order the requests were made; nothing sent twice by reading.
      const antes = fakeWa.sent.length
      const todos = await avisos()
      out.orden = todos.map((x) => x.state)
      out.leerNoEnvia = fakeWa.sent.length === antes
      out.noEnviadosRegistrados = (await repos.auditoria.porCorrelaciones({ action: 'whatsapp.appointment_notice_not_sent', correlationIds: [pedidoE, pedidoF, pedidoG, pedidoH].map((p) => 'turno-solicitado:' + p.id) })).map((e) => [e.metadata.reason, JSON.stringify(e.metadata).includes('549')])
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  const nombre = (texto) => texto.replace(/ \S+$/u, '')
  assert.equal(r.vacio, 0)
  assert.deepEqual({ estado: r.antesDeProcesar.estado, entregas: r.antesDeProcesar.entregas, noEnviado: r.antesDeProcesar.noEnviado }, { estado: 'pending', entregas: [], noEnviado: null }, 'a request alone is not a notice: nothing is shown as sent')
  assert.equal(nombre(r.enviado.prestador), 'Gabriela Lopez', 'the provider that got the request is named')
  assert.equal(r.enviado.estado, 'sent')
  assert.deepEqual(r.enviado.entregas.map(([, tipo, estado, error]) => [tipo, estado, error]), [['message', 'sent', null]])
  assert.equal(r.mascara[0], `****${r.mascara[1]}`, 'the number is masked')
  assert.equal(r.mascara[2], false, 'the whole number never leaves the backend')
  assert.equal(r.conversacionDelPrestador, true, 'the notice points at the conversation of the provider')
  assert.equal(r.entregado, 'delivered')
  assert.equal(r.leido, 'read')
  assert.equal(r.horaAvanza, true, 'the time shown is the one of the status Meta reported')
  assert.equal(r.noRetrocede, 'read')
  assert.deepEqual(r.enSuConversacion, ['outbound', 'read', true, true, 0], 'the message sent to the provider is readable in its own conversation, with its status')
  assert.deepEqual([r.acepto.estado, r.acepto.respuesta, r.acepto.turno], ['accepted', ['accepted', 'whatsapp'], 'awaiting_payment'])
  assert.deepEqual([r.rechazo.estado, r.rechazo.respuesta, r.rechazo.turno], ['rejected', ['rejected', 'whatsapp'], 'rejected'])
  assert.deepEqual([r.fallo.estado, r.fallo.entregas.map(([, , estado, error]) => [estado, error])], ['failed', [['failed', 'WHATSAPP_INVALID_REQUEST']]], 'a send Meta refused is a failure, not a notice')
  assert.equal(r.falloDespues, 'failed')
  assert.deepEqual([r.sinWhatsapp.estado, r.sinWhatsapp.noEnviado, r.sinWhatsapp.entregas], ['not_sent', 'no_whatsapp_linked', []])
  assert.deepEqual([r.requierePlantilla.estado, r.requierePlantilla.noEnviado], ['template_required', 'template_required'])
  assert.deepEqual([r.conOperador.estado, r.conOperador.noEnviado], ['not_sent', 'conversation_with_operator'])
  assert.deepEqual([r.sinCuenta.estado, r.sinCuenta.noEnviado], ['not_sent', 'provider_without_account'])
  assert.deepEqual(r.orden, ['accepted', 'rejected', 'failed', 'failed', 'not_sent', 'template_required', 'not_sent', 'not_sent'])
  assert.equal(r.leerNoEnvia, true)
  assert.deepEqual(r.noEnviadosRegistrados, [['no_whatsapp_linked', false], ['template_required', false], ['conversation_with_operator', false], ['provider_without_account', false]], 'the record of a notice that was not sent carries the reason and no phone number')
})
