import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// ADMIN-WHATSAPP-BUSQUEDA-01 and ADMIN-WHATSAPP-RESPUESTA-01, through the HTTP routes of the
// support panel over the real WhatsApp module (ingest, worker, orchestrator, support service).
// Meta is the stand-in (FakeWhatsappProvider: what would be sent is recorded, nothing leaves).
//
// Search: by a piece of the contact's name or of its number, in the STORE (never only the page on
// screen), combined with "Requieren intervención" and with the pages.
// Manual answer: free text only inside Meta's 24 hour window; outside it only an APPROVED
// template; the person's answer opens the window again; a conversation an operator took never
// goes back to the assistant by itself.

const SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP}
  const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
  const { createApp } = (await import('./apps/api/src/server.ts')).default
  const { ErrorMetaWhatsapp, cuerpoMensajeMeta } = await import('./apps/api/src/tus/asistente/meta.ts')
  const sessions = new InMemoryTusSessionResolver()
  sessions.add('support', { sessionId: 's1', subjectId: 'operator-1', tenantId: 'platform-tenant', roles: ['admin'], permissions: ['tus:whatsapp:support'] })
  sessions.add('support-2', { sessionId: 's3', subjectId: 'operator-2', tenantId: 'platform-tenant', roles: ['admin'], permissions: ['tus:whatsapp:support'] })
  // The same store and the same Meta stand-in, with a module that has the manual template approved
  // (as production will once Meta approves it) and knows the operators by name.
  const modulo = (aprobadas) => crearModuloWhatsapp({ env: { ...waEnv, WHATSAPP_APPROVED_TEMPLATES: aprobadas }, transaction: waTx, accounts: accountResolver, application: tusApp, knowledgeIndex, whatsapp: fakeWa, chat, embeddings, transcriptor: null, now: waClock, nombreOperador: async (id) => ({ 'operator-1': 'Ana Soporte', 'operator-2': 'Beto Soporte' })[id] ?? null })
  const servidores = []
  const panel = (m) => {
    const server = createApp({ tusRouter: createTusHttpRouter({ application: tusApp, sessions, whatsapp: m }), tusRoutesEnabled: true }).listen(0)
    servidores.push(server)
    const base = 'http://127.0.0.1:' + server.address().port + '/tus/v1/admin/whatsapp/conversations'
    return async (method, path, body, token = 'support') => { const r = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'corr-' + Math.random(), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => null) } }
  }
  const cerrar = () => { for (const server of servidores) server.close() }
  const conversationOfId = async (waId) => (await conversationOf(waId)).conversationId
`

test('ADMIN WhatsApp búsqueda: by full name, a piece of it, the surname, any case; by the whole number, a piece of it and every Argentine way of writing it; combined with "requieren intervención" and with the pages; no result is an empty page, and clearing it is the normal list', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const call = panel(wa)
    try {
      const gente = [['5493794123456', 'joaquin ferretto'], ['5493794555022', 'Leo canteros'], ['5491155550403', 'Mauricio Martinez'], ['5493624001122', 'juan floress'], ['34600111222', 'Leonor de España']]
      for (const [waId, name] of gente) { await deliver(inbound(waId, 'hola', { name })); waAdvance(1000) }
      for (let i = 0; i < 12; i += 1) { await deliver(inbound('54937940000' + String(i).padStart(2, '0'), 'hola', { name: 'Vecino ' + i })); waAdvance(1000) }
      await wa.soporte.tomar(await conversationOfId('5493794555022'), { actorId: 'operator-1', correlationId: 'c' })
      await wa.soporte.tomar(await conversationOfId('5493794123456'), { actorId: 'operator-1', correlationId: 'c' })
      const buscar = async (search, extra = '') => { const res = await call('GET', '?search=' + encodeURIComponent(search) + extra); return { nombres: res.body.conversations.map((c) => c.contact.displayName), total: res.body.total, paginas: res.body.totalPages, status: res.status } }
      const nombres = async (search, extra) => (await buscar(search, extra)).nombres
      out.completo = await nombres('joaquin ferretto')
      out.parte = await nombres('joaq')
      out.apellido = await nombres('ferretto')
      out.mayusculas = await nombres('FERRETTO')
      out.mixto = await nombres('LeO')
      // The number, as stored and in every shape people write it.
      out.telefono = {}
      for (const texto of ['5493794123456', '+54 9 379 412-3456', '3794123456', '0379 15 4123456', '0379154123456', '(0379) 15-412-3456', '+54 379 4123456', '4123456']) out.telefono[texto] = await nombres(texto)
      out.parcial = (await buscar('3794')).total
      out.parcialNombres = (await nombres('37945')).sort()
      // A number of another country is searched as typed, never rewritten.
      out.extranjero = [await nombres('34600111222'), await nombres('+34 600 111 222'), await nombres('0600 111 222')]
      // Combined with the filter.
      out.leoHumano = await nombres('leo', '&mode=human')
      out.leoTodas = (await nombres('leo')).sort()
      out.vecinoHumano = (await buscar('vecino', '&mode=human')).total
      // Nothing found: an empty page, not an error.
      out.nada = await buscar('zzz no existe')
      out.nadaTelefono = await buscar('0000000000')
      // Pages over the search result, newest first.
      const p1 = await buscar('vecino', '&page=1&pageSize=10')
      const p2 = await buscar('vecino', '&page=2&pageSize=10')
      out.paginas = [p1.nombres.length, p1.total, p1.paginas, p2.nombres.length, p1.nombres[0], p2.nombres.at(-1), new Set([...p1.nombres, ...p2.nombres]).size]
      // Cleared (or blank): the normal list again.
      const todo = await call('GET', '?page=1&pageSize=50')
      const vacio = await call('GET', '?search=' + encodeURIComponent('   ') + '&page=1&pageSize=50')
      out.limpio = [todo.body.total, vacio.body.total, vacio.body.conversations.length]
      // The number never leaves whole, even when it was searched whole.
      out.sinFuga = !JSON.stringify((await call('GET', '?search=5493794123456')).body).includes('5493794123456')
      // Nothing stored was changed by searching.
      out.almacenado = (await contactOf('5493794123456')).waId
    } finally { cerrar() }
    console.log(JSON.stringify(out))
  `)
  for (const clave of ['completo', 'parte', 'apellido', 'mayusculas']) assert.deepEqual(r[clave], ['joaquin ferretto'], clave)
  assert.deepEqual(r.mixto.sort(), ['Leo canteros', 'Leonor de España'], 'a piece of the name, without case')
  for (const [texto, encontrados] of Object.entries(r.telefono)) assert.deepEqual(encontrados, ['joaquin ferretto'], `"${texto}" finds 5493794123456`)
  assert.equal(r.parcial, 14, 'a piece of the number: the two of that area and the twelve neighbours')
  assert.deepEqual(r.parcialNombres, ['Leo canteros'])
  assert.deepEqual(r.extranjero, [['Leonor de España'], ['Leonor de España'], []], 'a foreign number is found as typed; an Argentine rewriting never invents a match')
  assert.deepEqual(r.leoHumano, ['Leo canteros'], '"Requieren intervención" + "leo": only Leo')
  assert.deepEqual(r.leoTodas, ['Leo canteros', 'Leonor de España'])
  assert.equal(r.vecinoHumano, 0)
  assert.deepEqual(r.nada, { nombres: [], total: 0, paginas: 1, status: 200 }, 'no result is an empty page')
  assert.deepEqual(r.nadaTelefono, { nombres: [], total: 0, paginas: 1, status: 200 })
  assert.deepEqual(r.paginas, [10, 12, 2, 2, 'Vecino 11', 'Vecino 0', 12], 'the search is paged by the backend, newest first')
  assert.deepEqual(r.limpio, [17, 17, 17], 'a blank search is the normal list')
  assert.equal(r.sinFuga, true)
  assert.equal(r.almacenado, '5493794123456')
})

test('ADMIN WhatsApp búsqueda: the phone reader only rewrites Argentine shapes it is sure of', () => {
  const r = runTypeScriptScenario(`
    const { variantesTelefono, interpretarBusqueda } = await import('./apps/api/src/tus/asistente/busqueda-contactos.ts')
    const out = {}
    for (const t of ['5493794123456', '+54 9 379 412-3456', '3794123456', '0379 15 4123456', '0379154123456', '011 15 5555-0403', '+54 379 4123456', '0379 4151234', '379', '37', 'leo 379', '+34 600 111 222', '0600 111 222']) out[t] = variantesTelefono(t)
    out.nombre = interpretarBusqueda('  Joaquin   Ferretto ')
    out.numero = interpretarBusqueda('0379 15 4123456')
    out.vacio = [interpretarBusqueda(''), interpretarBusqueda('   '), interpretarBusqueda(null)]
    console.log(JSON.stringify(out))
  `)
  const STORED = '5493794123456'
  for (const t of ['5493794123456', '+54 9 379 412-3456', '3794123456', '0379 15 4123456', '0379154123456', '+54 379 4123456']) assert.ok([...r[t].exactas, ...r[t].argentinas].some((v) => STORED.includes(v)), `${t} -> ${JSON.stringify(r[t])}`)
  assert.deepEqual(r['5493794123456'], { exactas: ['5493794123456'], argentinas: [] }, 'already as stored: nothing to rewrite')
  assert.deepEqual(r['0379 15 4123456'], { exactas: [], argentinas: ['379154123456', '3794123456'] }, 'the national 0 and the local 15 are dropped; the text with its 0 is never what is stored')
  assert.ok(r['011 15 5555-0403'].argentinas.includes('1155550403'), 'Buenos Aires: 011 15 … -> 11 …')
  assert.deepEqual(r['0379 4151234'], { exactas: [], argentinas: ['3794151234'] }, 'a "15" inside a complete number is part of the number, never dropped')
  assert.deepEqual(r['+54 379 4123456'], { exactas: ['543794123456'], argentinas: ['5493794123456'] }, 'the mobile 9 is added')
  assert.deepEqual(r['379'], { exactas: ['379'], argentinas: [] })
  assert.deepEqual(r['37'], { exactas: [], argentinas: [] }, 'too short to be a phone')
  assert.deepEqual(r['leo 379'], { exactas: [], argentinas: [] }, 'letters: a name, not a phone')
  assert.deepEqual(r['+34 600 111 222'], { exactas: ['34600111222'], argentinas: [] }, 'another country: exactly as typed')
  assert.deepEqual(r['0600 111 222'], { exactas: [], argentinas: ['600111222'] }, 'a rewriting from a national 0 only matches Argentine numbers')
  assert.deepEqual(r.nombre, { nombre: 'Joaquin Ferretto', telefonos: [], telefonosArgentinos: [] })
  assert.equal(r.numero.nombre, null)
  assert.deepEqual(r.vacio, [null, null, null])
})

test('ADMIN WhatsApp respuesta manual: taking a conversation silences the assistant, free text leaves only inside the 24 hour window, outside it only the approved template, the answer opens the window again and the conversation stays with the person; giving it back wakes the assistant', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const con = modulo('continuar_atencion_tus')
    const call = panel(con)
    const sin = panel(modulo(''))
    try {
      const W = '5493794555022'
      // Meta sends the profile name with every message.
      const decir = (texto, extra = {}) => say(W, texto, { name: 'Leo canteros', ...extra })
      await decir('hola')
      const id = await conversationOfId(W)
      const detalle = async () => (await call('GET', '/' + id)).body
      // 1. Before taking it: the assistant attends, nobody can write by hand.
      const antes = await detalle()
      out.antes = [antes.mode, antes.serviceWindowOpen, antes.operator, antes.templates.map((t) => t.name)]
      out.sinTomar = (await call('POST', '/' + id + '/reply', { text: 'Hola' })).body.code
      out.plantillaSinTomar = (await call('POST', '/' + id + '/template', { template: 'continuar_atencion_tus' })).body.code
      // 2. The operator takes it: persisted, with who took it.
      out.tomar = (await call('POST', '/' + id + '/takeover', {})).body.mode
      const tomada = await detalle()
      out.tomada = [tomada.mode, tomada.operator, (await conversationOf(W)).operatorId]
      // 3. The person writes: the message is kept, the assistant does NOT answer.
      let enviados = fakeWa.sent.length
      const llamadasModelo = chat.calls.length
      script = () => { throw new Error('the assistant must not run for a conversation a person attends') }
      await decir('¿hay alguien?')
      out.asistenteCallado = [fakeWa.sent.length - enviados, chat.calls.length - llamadasModelo, (await detalle()).messages.some((m) => m.text === '¿hay alguien?' && m.direction === 'inbound'), (await detalle()).mode]
      // 4. Free text inside the window: it leaves through Meta and is recorded as the operator's.
      enviados = fakeWa.sent.length
      const respuesta = await call('POST', '/' + id + '/reply', { text: 'Hola Leo, soy Ana de TUS.' })
      const guardado = [...waStore.state.mensajes.values()].find((m) => m.text === 'Hola Leo, soy Ana de TUS.')
      out.respuesta = { http: [respuesta.status, respuesta.body.status], meta: fakeWa.sent.slice(enviados).map((x) => [x.to === W, x.message.type, x.message.text]), guardado: [guardado.direction, guardado.actor, guardado.status, Boolean(guardado.wamid), guardado.conversationId === id, Boolean(guardado.createdAt)] }
      out.invalido = [(await call('POST', '/' + id + '/reply', { text: '   ' })).status, (await call('POST', '/' + id + '/reply', {})).status]
      // Inside the window a template is not offered: the operator simply writes.
      out.plantillaConVentana = (await call('POST', '/' + id + '/template', { template: 'continuar_atencion_tus' })).body.code
      // 5. Meta refuses a send: never reported as sent, recorded as failed, told to the operator.
      fakeWa.fallarProximo(new ErrorMetaWhatsapp('WHATSAPP_INVALID_REQUEST', 'refused'))
      const fallo = await call('POST', '/' + id + '/reply', { text: 'Mensaje que Meta rechaza' })
      const fallido = [...waStore.state.mensajes.values()].find((m) => m.text === 'Mensaje que Meta rechaza')
      out.fallo = { http: [fallo.status, fallo.body.code], guardado: [fallido.status, fallido.metadata.errorCode, fallido.wamid], enDetalle: (await detalle()).messages.filter((m) => m.text === 'Mensaje que Meta rechaza').map((m) => m.status) }
      // ...and trying again works, as a new message.
      const reintento = await call('POST', '/' + id + '/reply', { text: 'Mensaje que Meta rechaza' })
      out.reintento = [reintento.status, reintento.body.status, [...waStore.state.mensajes.values()].filter((m) => m.text === 'Mensaje que Meta rechaza').map((m) => m.status).sort()]

      // 6. More than 24 hours later: free text is refused; only an approved template is left.
      waAdvance(25 * 60 * 60 * 1000)
      const cerrada = await detalle()
      out.cerrada = [cerrada.mode, cerrada.serviceWindowOpen, cerrada.templates]
      enviados = fakeWa.sent.length
      out.textoCerrada = [(await call('POST', '/' + id + '/reply', { text: 'Seguís ahí?' })).body.code, fakeWa.sent.length - enviados]
      out.plantillaDesconocida = [(await call('POST', '/' + id + '/template', { template: 'turno_solicitud_recibida' })).body.code, (await call('POST', '/' + id + '/template', { template: 'no_existe' })).body.code, (await call('POST', '/' + id + '/template', {})).body.code]
      // Not approved in the configuration: not offered and not sendable.
      out.sinAprobar = [(await sin('GET', '/' + id)).body.templates, (await sin('POST', '/' + id + '/template', { template: 'continuar_atencion_tus' })).body.code, fakeWa.sent.length - enviados]
      const plantilla = await call('POST', '/' + id + '/template', { template: 'continuar_atencion_tus' })
      const salida = fakeWa.sent.at(-1)
      const meta = cuerpoMensajeMeta(W, salida.message).template
      const registro = [...waStore.state.mensajes.values()].find((m) => m.type === 'template' && m.conversationId === id)
      out.plantilla = { http: [plantilla.status, plantilla.body.status, plantilla.body.template], enviados: fakeWa.sent.length - enviados, meta: [meta.name, meta.language.code, meta.components.find((c) => c.type === 'body').parameters.map((p) => p.text), meta.components.filter((c) => c.type === 'button').map((c) => c.sub_type)], guardado: [registro.actor, registro.status, registro.direction] }
      out.sigueCerrada = (await detalle()).serviceWindowOpen
      // 7. The person taps "Continuar atención": kept, the window opens, the operator keeps it.
      enviados = fakeWa.sent.length
      await decir('Continuar atención')
      const reabierta = await detalle()
      out.reabierta = [reabierta.serviceWindowOpen, reabierta.mode, reabierta.operator, fakeWa.sent.length - enviados, reabierta.messages.at(-1).text]
      const libre = await call('POST', '/' + id + '/reply', { text: 'Hola Leo, decime en qué te puedo ayudar.' })
      out.libre = [libre.status, libre.body.status, fakeWa.sent.at(-1).message.text]
      // The same webhook delivered twice: one message.
      await deliver(inbound(W, 'una sola vez', { wamid: 'wamid.duplicado', name: 'Leo canteros' }))
      await deliver(inbound(W, 'una sola vez', { wamid: 'wamid.duplicado', name: 'Leo canteros' }))
      out.duplicado = [...waStore.state.mensajes.values()].filter((m) => m.text === 'una sola vez').length
      // Another administrator opens it: the state is the conversation's, not the browser's.
      const otro = (await call('GET', '/' + id, undefined, 'support-2')).body
      out.otroAdmin = [otro.mode, otro.operator, otro.messages.some((m) => m.text === 'Hola Leo, decime en qué te puedo ayudar.')]
      // 8. Given back: the assistant answers again.
      out.devolver = (await call('POST', '/' + id + '/release', {})).body.mode
      script = () => ({ content: 'Volví, soy el asistente de TUS.' })
      enviados = fakeWa.sent.length
      await decir('gracias')
      const final = await detalle()
      // Whatever it says, it is the assistant answering again (recorded as its own message).
      const ultimo = final.messages.at(-1)
      out.asistenteVuelve = [fakeWa.sent.length - enviados, ultimo.direction, ultimo.actor, final.mode, final.operator]
      out.auditoria = waStore.state.auditoria.filter((e) => e.conversationId === id && e.action.startsWith('support.') && e.action !== 'support.conversation_viewed').map((e) => [e.action, e.actorId])
    } finally { cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.antes, ['bot', true, null, ['continuar_atencion_tus']])
  assert.equal(r.sinTomar, 'TAKE_OVER_FIRST')
  assert.equal(r.plantillaSinTomar, 'TAKE_OVER_FIRST')
  assert.equal(r.tomar, 'human')
  assert.deepEqual(r.tomada, ['human', { id: 'operator-1', name: 'Ana Soporte' }, 'operator-1'], 'who took it is persisted and named')
  assert.deepEqual(r.asistenteCallado, [0, 0, true, 'human'], 'the person writes: the message is kept and the assistant sends nothing')
  assert.deepEqual(r.respuesta, { http: [202, 'sent'], meta: [[true, 'text', 'Hola Leo, soy Ana de TUS.']], guardado: ['outbound', 'operator:operator-1', 'sent', true, true, true] }, 'free text leaves through Meta and is recorded as the operator\'s')
  assert.deepEqual(r.invalido, [400, 400])
  assert.equal(r.plantillaConVentana, 'SERVICE_WINDOW_OPEN')
  assert.deepEqual(r.fallo, { http: [502, 'WHATSAPP_INVALID_REQUEST'], guardado: ['failed', 'WHATSAPP_INVALID_REQUEST', null], enDetalle: ['failed'] }, 'a send Meta refused is an error for the operator and a failed message in the record')
  assert.deepEqual(r.reintento, [202, 'sent', ['failed', 'sent']], 'the retry is a new message; the failed one stays as it was')
  assert.deepEqual(r.cerrada, ['human', false, [{ name: 'continuar_atencion_tus', body: 'Hola, {{1}}. Queremos continuar con tu solicitud en TUS. Respondé este mensaje y seguimos con la atención por acá.', buttons: ['Continuar atención'] }]])
  assert.deepEqual(r.textoCerrada, ['SERVICE_WINDOW_CLOSED', 0], 'outside the window free text is refused and nothing is sent')
  assert.deepEqual(r.plantillaDesconocida, ['TEMPLATE_NOT_APPROVED', 'TEMPLATE_NOT_APPROVED', 'TEMPLATE_NOT_APPROVED'], 'only a template meant for manual use, and approved')
  assert.deepEqual(r.sinAprobar, [[], 'TEMPLATE_NOT_APPROVED', 0], 'a template Meta has not approved is neither offered nor sent')
  assert.deepEqual(r.plantilla, { http: [202, 'sent', 'continuar_atencion_tus'], enviados: 1, meta: ['continuar_atencion_tus', 'es_AR', ['Leo'], ['quick_reply']], guardado: ['operator:operator-1', 'sent', 'outbound'] })
  assert.equal(r.sigueCerrada, false, 'sending a template does not open the window: the answer does')
  assert.deepEqual(r.reabierta, [true, 'human', { id: 'operator-1', name: 'Ana Soporte' }, 0, 'Continuar atención'], 'the answer opens the window; the conversation stays with the person and the assistant stays silent')
  assert.deepEqual(r.libre, [202, 'sent', 'Hola Leo, decime en qué te puedo ayudar.'])
  assert.equal(r.duplicado, 1, 'a webhook delivered twice is one message')
  assert.deepEqual(r.otroAdmin, ['human', { id: 'operator-1', name: 'Ana Soporte' }, true], 'another administrator sees the same state and messages')
  assert.equal(r.devolver, 'bot')
  assert.deepEqual(r.asistenteVuelve, [1, 'outbound', 'assistant', 'bot', null], 'given back: the assistant answers again')
  assert.deepEqual(r.auditoria, [['support.takeover', 'operator-1'], ['support.operator_reply', 'operator-1'], ['support.operator_reply', 'operator-1'], ['support.operator_reply', 'operator-1'], ['support.operator_template', 'operator-1'], ['support.operator_reply', 'operator-1'], ['support.returned_to_bot', 'operator-1']], 'every manual action is audited with who did it')
})

test('ADMIN WhatsApp pantalla: the search asks the server after a pause and goes back to the first page; Enter sends and Shift+Enter does not; a failed send keeps the text; only the templates the server offers can be sent', () => {
  const pantalla = readFileSync('apps/web/src/components/admin/admin-whatsapp.tsx', 'utf8')
  const cliente = readFileSync('apps/web/src/lib/tus-client.ts', 'utf8')
  assert.match(pantalla, /placeholder="Buscar por nombre o celular\.\.\."/u)
  assert.match(pantalla, /window\.setTimeout\(\(\) => \{ setBusqueda\(valor\); setPage\(1\) \}, 300\)/u, 'one request after the pause, back on the first page')
  assert.match(pantalla, /aria-label="Limpiar la búsqueda" onClick=\{\(\) => setSearch\(''\)\}/u)
  assert.match(pantalla, /role="status">No encontramos conversaciones con ese nombre o celular\.<\/p>/u, 'no result is a status, never an alert')
  assert.match(cliente, /\.\.\.\(search\.trim\(\) \? \{ search: search\.trim\(\) \} : \{\}\)/u, 'a blank search is the normal list')
  assert.match(pantalla, /if \(event\.key !== 'Enter' \|\| event\.shiftKey \|\| event\.nativeEvent\.isComposing\) return/u)
  assert.match(pantalla, /if \(await act\('reply', \{ text \}\)\) setReply\(''\)/u, 'the text is cleared only after the server sent it')
  assert.match(pantalla, /`Atendida por \$\{detail\.operator\?\.name \?\? 'una persona de TUS'\}`/u)
  assert.match(pantalla, /detail\.templates\.map\(\(template\) =>/u, 'only what the server lists as approved')
  assert.match(pantalla, /act\('template', \{ template: template\.name \}\)/u)
  assert.match(pantalla, /Contactar con plantilla/u)
  assert.doesNotMatch(pantalla, /continuar_atencion_tus/u, 'no template name is hard-coded in the screen')
})
