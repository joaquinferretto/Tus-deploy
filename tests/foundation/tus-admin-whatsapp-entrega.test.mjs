import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// WHATSAPP-DESTINO-01. The route of a message an administrator writes by hand, end to end:
//   - it goes to the wa_id of the contact of THAT conversation, never to a number resolved again
//     from an account, a provider or a name;
//   - Meta's id of the message (wamid) is kept, and every status webhook (sent, delivered, read,
//     failed) is applied to the ONE message with that wamid, whoever wrote it;
//   - "Enviado" only exists after Meta accepted the request; a refusal is "Falló" with its reason;
//   - the trace that is logged carries ids and states, never a full number, a text or a credential.
// Meta is the stand-in (FakeWhatsappProvider), except for the provider's own request, checked
// against a fetch that answers like the Graph API.

const SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP}
  const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
  const { createApp } = (await import('./apps/api/src/server.ts')).default
  const { ErrorMetaWhatsapp, MetaWhatsappCloudProvider } = await import('./apps/api/src/tus/asistente/meta.ts')
  const sessions = new InMemoryTusSessionResolver()
  sessions.add('support', { sessionId: 's1', subjectId: 'operator-1', tenantId: 'platform-tenant', roles: ['admin'], permissions: ['tus:whatsapp:support'] })
  const logs = []
  const modulo = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, application: tusApp, knowledgeIndex, whatsapp: fakeWa, chat, embeddings, transcriptor: null, now: waClock, log: (event, fields) => logs.push({ event, ...fields }) })
  const server = createApp({ tusRouter: createTusHttpRouter({ application: tusApp, sessions, whatsapp: modulo }), tusRoutesEnabled: true }).listen(0)
  const base = 'http://127.0.0.1:' + server.address().port + '/tus/v1/admin/whatsapp/conversations'
  const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { authorization: 'Bearer support', 'x-correlation-id': 'corr-' + Math.random(), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => null) } }
  // A status webhook as Meta sends it, through the module under test.
  const estado = (wamid, status, extra = {}) => modulo.ingreso.procesar(parsearWebhookMeta({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: wamid, status, timestamp: String(Math.floor((waClock() + (extra.despues ?? 1000)) / 1000)), recipient_id: extra.para, ...(extra.error ? { errors: [{ code: extra.error, title: 'Message undeliverable' }] } : {}) }] } }] }] }, PHONE_ID), 'corr-estado')
  const guardado = (texto) => [...waStore.state.mensajes.values()].find((m) => m.text === texto)
`

test('ADMIN WhatsApp entrega: a manual answer goes to the wa_id of that conversation (never to another number of the account, the provider or a namesake), keeps Meta\'s id, and each status webhook moves only the message with that id', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const A = '5493794555031'
      const HOMONIMO = '5493794555032'
      const PRESTADOR = '5493794555033'
      // Three people on WhatsApp: the one that writes (its account is linked), a namesake and the
      // WhatsApp linked to a provider account.
      await say(A, 'hola', { name: 'Juan Perez' })
      await say(HOMONIMO, 'buenas', { name: 'Juan Perez' })
      await say(PRESTADOR, 'hola', { name: 'Gabriela Prestadora' })
      await linkContact(A, 'customer-user')
      await linkContact(PRESTADOR, 'provider-user')
      const id = (await conversationOf(A)).conversationId
      const detalle = async () => (await call('GET', '/' + id)).body
      const mensaje = async (texto) => (await detalle()).messages.find((m) => m.text === texto)
      await call('POST', '/' + id + '/takeover', {})
      await say(A, '¿me responden?', { name: 'Juan Perez' })

      // Two manual messages, one right after the other.
      let enviados = fakeWa.sent.length
      const uno = await call('POST', '/' + id + '/reply', { text: 'Primer mensaje manual' })
      const dos = await call('POST', '/' + id + '/reply', { text: 'Segundo mensaje manual' })
      const salientes = fakeWa.sent.slice(enviados)
      const m1 = guardado('Primer mensaje manual')
      const m2 = guardado('Segundo mensaje manual')
      out.destino = { http: [uno.status, uno.body.status, dos.status, dos.body.status], to: salientes.map((x) => x.to), guardado: [m1.metadata.sentTo, m2.metadata.sentTo], wamids: [m1.wamid === salientes[0].wamid, m2.wamid === salientes[1].wamid, m1.wamid !== m2.wamid], actor: [m1.actor, m2.actor], estado: [m1.status, m2.status] }
      out.enPanel = [(await mensaje('Primer mensaje manual')).recipient, (await mensaje('Primer mensaje manual')).recipientMismatch ?? false]

      // Meta: "sent" and then "delivered", only for the first one.
      out.sent = await estado(m1.wamid, 'sent', { para: A })
      out.trasSent = [(await mensaje('Primer mensaje manual')).status, (await mensaje('Segundo mensaje manual')).status]
      out.delivered = await estado(m1.wamid, 'delivered', { para: A, despues: 2000 })
      out.trasDelivered = [(await mensaje('Primer mensaje manual')).status, (await mensaje('Segundo mensaje manual')).status, Boolean((await mensaje('Primer mensaje manual')).statusAt)]
      // A status of an id TUS never sent, and one of an inbound message: nothing moves.
      out.ajeno = await estado('wamid.de-otro-sistema', 'delivered', { para: A })
      const entrante = [...waStore.state.mensajes.values()].find((m) => m.text === '¿me responden?')
      out.deEntrante = [await estado(entrante.wamid, 'read', { para: A }), guardado('¿me responden?').status === entrante.status]
      out.sinCambios = [(await mensaje('Primer mensaje manual')).status, (await mensaje('Segundo mensaje manual')).status]
      // "read" for the first; an older "delivered" arriving late never takes it back.
      await estado(m1.wamid, 'read', { para: A, despues: 3000 })
      await estado(m1.wamid, 'delivered', { para: A, despues: 2500 })
      out.leido = (await mensaje('Primer mensaje manual')).status

      // Meta accepted the second one and later reports it could not deliver it.
      out.failed = await estado(m2.wamid, 'failed', { para: A, error: 131026, despues: 4000 })
      const fallido = await mensaje('Segundo mensaje manual')
      out.trasFailed = [fallido.status, fallido.error, (await mensaje('Primer mensaje manual')).status]
      // ...and a "delivered" that arrives afterwards does not make it look delivered.
      await estado(m2.wamid, 'delivered', { para: A, despues: 5000 })
      out.sigueFallido = (await mensaje('Segundo mensaje manual')).status

      // Meta refuses the request itself: never "sent", the operator is told with Meta's number.
      fakeWa.fallarProximo(new ErrorMetaWhatsapp('WHATSAPP_INVALID_REQUEST', 'refused', 131030))
      const rechazo = await call('POST', '/' + id + '/reply', { text: 'Mensaje rechazado' })
      out.rechazo = [rechazo.status, rechazo.body.code, rechazo.body.error, (await mensaje('Mensaje rechazado')).status, (await mensaje('Mensaje rechazado')).error, guardado('Mensaje rechazado').wamid]
      // The request may have reached Meta (timeout): neither sent nor failed, and not resent.
      fakeWa.fallarProximo(new ErrorMetaWhatsapp('WHATSAPP_TIMEOUT', 'timeout', null, true))
      const dudoso = await call('POST', '/' + id + '/reply', { text: 'Mensaje dudoso' })
      out.dudoso = [dudoso.status, dudoso.body.status, (await mensaje('Mensaje dudoso')).status]

      // Meta says a status is about ANOTHER number: shown as a mismatch, never hidden.
      await call('POST', '/' + id + '/reply', { text: 'Tercer mensaje manual' })
      await estado(guardado('Tercer mensaje manual').wamid, 'delivered', { para: HOMONIMO })
      const tercero = await mensaje('Tercer mensaje manual')
      out.otroDestinatario = [tercero.status, tercero.recipient, tercero.recipientMismatch ?? false]

      // The trace: ids and states, no full number, no text of a message.
      const traza = logs.filter((l) => l.event === 'whatsapp.send' || l.event.startsWith('whatsapp.status'))
      out.traza = {
        envio: traza.filter((l) => l.event === 'whatsapp.send' && l.messageId === m1.messageId).map((l) => [l.actor, l.to, l.wamid === m1.wamid, l.status, l.conversationId === id]),
        rechazo: traza.filter((l) => l.event === 'whatsapp.send' && l.status === 'failed').map((l) => [l.errorCode, l.metaCode, l.wamid]),
        estados: traza.filter((l) => l.event === 'whatsapp.status' && l.messageId === m1.messageId).map((l) => [l.previous, l.incoming, l.status, l.applied, l.recipient, l.wamid === m1.wamid, typeof l.at]),
        fallo: traza.filter((l) => l.event === 'whatsapp.status' && l.messageId === m2.messageId && l.incoming === 'failed').map((l) => [l.previous, l.status, l.metaErrorCode, l.actor]),
        sinMensaje: traza.filter((l) => l.event === 'whatsapp.status_unmatched').map((l) => [l.wamid, l.messageId, l.applied]),
        sinDatos: ![A, HOMONIMO, PRESTADOR, 'Primer mensaje manual', 'fictitious-access'].some((secreto) => JSON.stringify(traza).includes(secreto)),
      }

      // The provider's own request: the "to" it is given, and what Meta answers.
      const pedidos = []
      const meta = new MetaWhatsappCloudProvider({ accessToken: 'fictitious-access', phoneNumberId: PHONE_ID, graphApiVersion: 'v25.0' }, async (url, init) => { pedidos.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: A, wa_id: A }], messages: [{ id: 'wamid.real-1' }] }), { status: 200 }) })
      out.graph = [await meta.send(A, { type: 'text', text: 'hola' }), pedidos[0].to, pedidos[0].type]
      const sinId = new MetaWhatsappCloudProvider({ accessToken: 'fictitious-access', phoneNumberId: PHONE_ID, graphApiVersion: 'v25.0' }, async () => new Response('{}', { status: 200 }))
      out.graphSinId = await sinId.send(A, { type: 'text', text: 'hola' }).then(() => 'sent', (e) => [e.code, e.ambiguous])
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  const A = '5493794555031'
  assert.deepEqual(r.destino, { http: [202, 'sent', 202, 'sent'], to: [A, A], guardado: [A, A], wamids: [true, true, true], actor: ['operator:operator-1', 'operator:operator-1'], estado: ['sent', 'sent'] }, 'both leave to the wa_id that wrote in that conversation and keep Meta\'s id')
  assert.deepEqual(r.enPanel, [{ to: '****5031', meta: null, status: null }, false], 'the panel shows where it went, masked')
  assert.equal(r.sent.statusesIgnored, 1, 'a "sent" for a message already sent changes nothing')
  assert.deepEqual(r.trasSent, ['sent', 'sent'])
  assert.equal(r.delivered.statusesApplied, 1)
  assert.deepEqual(r.trasDelivered, ['delivered', 'sent', true], 'only the message with that wamid is delivered; the one next to it keeps its state')
  assert.equal(r.ajeno.statusesIgnored, 1, 'a status of an unknown id is ignored')
  assert.deepEqual([r.deEntrante[0].statusesIgnored, r.deEntrante[1]], [1, true], 'a status never touches an inbound message')
  assert.deepEqual(r.sinCambios, ['delivered', 'sent'])
  assert.equal(r.leido, 'read', 'a late "delivered" never takes a read message back')
  assert.equal(r.failed.statusesApplied, 1)
  assert.deepEqual(r.trasFailed, ['failed', { code: 'WHATSAPP_DELIVERY_FAILED', metaCode: 131026 }, 'read'], 'a failure Meta reports later is shown with its number, on that message only')
  assert.equal(r.sigueFallido, 'failed', 'a failed message never becomes delivered')
  assert.deepEqual(r.rechazo, [502, 'WHATSAPP_INVALID_REQUEST', 'WhatsApp did not accept the message (WHATSAPP_INVALID_REQUEST, Meta 131030)', 'failed', { code: 'WHATSAPP_INVALID_REQUEST', metaCode: 131030 }, null], 'a refused request is an error with Meta\'s number, never "sent"')
  assert.deepEqual(r.dudoso, [202, 'unknown', 'unknown'], 'an unknown outcome is neither sent nor failed')
  assert.deepEqual(r.otroDestinatario, ['delivered', { to: '****5031', meta: null, status: '****5032' }, true], 'a status about another number is flagged')
  assert.deepEqual(r.traza.envio, [['operator', '****5031', true, 'sent', true]])
  assert.deepEqual(r.traza.rechazo, [['WHATSAPP_INVALID_REQUEST', 131030, null]])
  assert.deepEqual(r.traza.estados, [['sent', 'sent', 'sent', false, '****5031', true, 'string'], ['sent', 'delivered', 'delivered', true, '****5031', true, 'string'], ['delivered', 'read', 'read', true, '****5031', true, 'string'], ['read', 'delivered', 'read', false, '****5031', true, 'string']], 'previous state, incoming, resulting, by wamid')
  assert.deepEqual(r.traza.fallo, [['sent', 'failed', 131026, 'operator']])
  assert.deepEqual(r.traza.sinMensaje, [['wamid.de-otro-sistema', null, false], ['wamid.in-4', null, false]], 'a status with no outbound message of that id is traced as unmatched')
  assert.equal(r.traza.sinDatos, true, 'no full number, text or credential in the trace')
  assert.deepEqual(r.graph, [{ wamid: 'wamid.real-1', waId: A }, A, 'text'], 'the request carries the "to" it was given and returns messages[0].id and the account Meta resolved')
  assert.deepEqual(r.graphSinId, ['WHATSAPP_UNAVAILABLE', true], 'an answer without a message id is never a sent message')
})
