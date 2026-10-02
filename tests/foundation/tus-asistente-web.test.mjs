import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-WEB-01. The Web assistant is a CHANNEL of the same assistant as WhatsApp: one
// orchestrator (model + tools + knowledge base + confirmations + memory), two presentations.
// Scripted model, in-memory stores, the canonical knowledge base and a recording domain port:
// no Groq, no network. The script tells the routing call (the model naming the area) from the
// conversation call (the model answering and asking for tools).
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

const SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP}
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { crearRouterAsistenteWeb } = await import('./apps/api/src/tus/asistente/http-web.ts')
  const { PROMPT_ENRUTADOR } = await import('./apps/api/src/tus/asistente/herramientas.ts')
  const { MENSAJES } = await import('./apps/api/src/tus/asistente/modelo.ts')
  // Recording domain port: what the tools REALLY asked the backend for.
  const dom = { buscar: [], turnos: [], reservas: [], trabajos: 0, servicios: 0 }
  const PRESTADORES = [
    { id: 'perfil-ana', displayName: 'Ana Gómez', profession: { id: 'plomeria', title: 'Plomería' }, approximateArea: 'Centro', distanceKm: null, verified: true, completedJobs: 12, availability: { label: 'Lunes a viernes de 9 a 18' } },
    { id: 'perfil-beto', displayName: 'Beto Ruiz', profession: { id: 'plomeria', title: 'Plomería' }, approximateArea: 'Centro', distanceKm: null, verified: false, completedJobs: 3, availability: { label: 'Sábados de 9 a 13' } },
  ]
  const dominio = {
    esPrestador: async () => false,
    buscarServicios: async () => { dom.servicios += 1; return [{ listingId: 'l-1', name: 'Destapaciones a domicilio', description: 'Cañerías', category: 'repairs-trades', priceMode: 'requires_budget', price: null, bookingMode: null, providerRef: 'p', zone: 'z' }] },
    servicio: async () => null,
    buscarPrestadores: async (filter) => { dom.buscar.push(filter); return { profession: filter.profession, providers: filter.zone === 'Luna' ? [] : PRESTADORES } },
    turnosDisponibles: async (providerId, oficioId, fecha) => { dom.turnos.push({ providerId, oficioId, fecha }); return { slots: ['13', '14'].map((h) => ({ inicio: fecha + 'T' + h + ':00:00.000Z', fin: fecha + 'T' + h + ':59:00.000Z', duracionMinutos: 60, disponible: true })), tarifas: [{ id: 'tar-1', nombre: 'Visita', duracionMinutos: 60, precio: 15000 }], mensaje: null } },
    reservarTurno: async (context, input) => { dom.reservas.push({ subjectId: context?.subjectId ?? null, tenantId: context?.tenantId ?? null, ...input }); return { id: 'res-1', prestadorNombre: 'Beto Ruiz', inicio: input.inicio, fin: input.inicio, precioFinal: 15000 } },
    trabajos: async () => { dom.trabajos += 1; return [] },
    solicitudes: async () => [],
  }
  // Same stores, same model, same knowledge index as the WhatsApp module of the fixture.
  const web = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat, embeddings, transcriptor: null, now: waClock, metric: (name, fields) => metrics.push({ name, ...fields }) })
  const sesiones = { resolve: async (token, correlationId) => token === 'tok-cliente' ? { subjectId: 'customer-user', sessionId: 'sesion-1', tenantId: 'customer-tenant', roles: ['owner'], permissions: ['tus:read'], correlationId } : null }
  const app = express()
  app.use(express.json())
  app.use(crearRouterAsistenteWeb({ servicio: web.asistenteWeb, sessions: sesiones, limitePorIp: (_request, _response, next) => next() }))
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = 'http://127.0.0.1:' + servidor.address().port
  const VISITANTE = 'visitante-0123456789abcdef'
  async function enviar(body, { token, stream = false, visitante = VISITANTE } = {}) {
    const response = await fetch(base + '/tus/v1/asistente/mensajes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-web', accept: stream ? 'application/x-ndjson' : 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ ...body, ...(visitante ? { visitorId: visitante } : {}) }),
    })
    const text = await response.text()
    return { status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), body: stream && response.status === 200 ? text.trim().split('\\n').map((line) => JSON.parse(line)) : JSON.parse(text) }
  }
  const esRuteo = (input) => input.messages[0].content === PROMPT_ENRUTADOR
  // intent: the label the model gives the message. pasos: what the model does next, by the number
  // of tool results it already has.
  const guion = (intent, pasos) => { script = (input) => esRuteo(input) ? { content: JSON.stringify({ intent }) } : pasos[Math.min(input.messages.filter((m) => m.role === 'tool').length, pasos.length - 1)] }
  const conversaciones = () => chat.calls.filter((call) => call.messages[0].content !== PROMPT_ENRUTADOR)
  const ultimaConversacion = () => conversaciones().at(-1)
  const sistema = (call) => call.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\\n')
  const cerrar = () => new Promise((resolve) => servidor.close(resolve))
`

test('ASISTENTE WEB knowledge: "¿Cómo funciona TUS?" reaches the model with the retrieved documents; the reply is the model\'s and carries its sources; nothing reliable -> the model is told to say so', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      guion('conocimiento', [{ content: 'TUS conecta clientes con prestadores: buscás, elegís y coordinás.' }])
      const r = await enviar({ text: '¿Cómo funciona TUS?' })
      const call = ultimaConversacion()
      out.status = r.status
      out.reply = r.body.messages.map((m) => [m.role, m.text, m.attachment?.kind ?? null, m.fallback ?? false])
      out.sources = r.body.messages[0].attachment?.sources?.length > 0
      out.modelGotMessage = call.messages.at(-1)
      out.modelGotDocuments = /Información de referencia de TUS/u.test(sistema(call)) && /<documento/u.test(sistema(call))
      out.tools = call.tools
      out.routingCalls = chat.calls.filter(esRuteo).length
      out.activity = r.body.activity.map((a) => a.type + (a.phase ? ':' + a.phase : a.intent ? ':' + a.intent : ''))
      out.degraded = r.body.degraded
      out.cache = r.cache
      // A knowledge question the knowledge base cannot support.
      guion('conocimiento', [{ content: 'No tengo información suficiente para asegurarte eso.' }])
      const none = await enviar({ text: '¿Cuál es la política de TUS sobre criptomonedas marcianas zxqv?' })
      const noDocs = ultimaConversacion()
      out.noDocsInstruction = /no tiene información confiable/u.test(sistema(noDocs))
      out.noDocsNoReference = !/Información de referencia de TUS/u.test(sistema(noDocs))
      out.noDocsReply = none.body.messages.map((m) => [m.text, m.attachment?.kind ?? null])
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.status, 200)
  assert.deepEqual(result.reply, [['assistant', 'TUS conecta clientes con prestadores: buscás, elegís y coordinás.', 'sources', false]], 'the text is exactly what the model wrote')
  assert.equal(result.sources, true)
  assert.deepEqual(result.modelGotMessage, { role: 'user', content: '¿Cómo funciona TUS?' }, 'natural language reaches the model')
  assert.equal(result.modelGotDocuments, true, 'RAG feeds the model')
  assert.deepEqual(result.tools, [], 'knowledge is answered from documents, not from data tools')
  assert.equal(result.routingCalls, 1, 'the model also decided what the message is about')
  assert.deepEqual(result.activity, ['routing:conocimiento', 'knowledge:start', 'knowledge:end'])
  assert.equal(result.degraded, false)
  assert.equal(result.cache, 'private, no-store')
  assert.equal(result.noDocsInstruction, true, 'without documents the model is told not to improvise')
  assert.equal(result.noDocsNoReference, true)
  assert.deepEqual(result.noDocsReply, [['No tengo información suficiente para asegurarte eso.', null]], 'no sources are attached to an unsupported answer')
})

test('ASISTENTE WEB tools: "arreglar una canilla" -> the model asks the backend for providers; cards are the tool result; "el segundo" uses the memory; slots come from the backend', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // Turn 1: the model deduces the trade and searches real providers.
      guion('buscar', [
        { toolCalls: [llamada('collect_service_request', { profession: 'plomeria', problem: 'Canilla que gotea', zone: 'Centro', question: null })] },
        { toolCalls: [llamada('search_providers', { query: 'canilla', profession: 'plomeria', zone: 'Centro' })] },
        { content: 'Encontré dos plomeros en Centro. ¿Con cuál querés seguir?' },
      ])
      const t1 = await enviar({ text: 'Necesito ayuda para arreglar una canilla en el Centro' })
      out.t1Text = t1.body.messages[0].text
      out.t1Attachment = t1.body.messages[0].attachment
      out.t1ModelGotMessage = conversaciones()[0].messages.at(-1).content
      out.t1ToolResultToModel = ultimaConversacion().messages.filter((m) => m.role === 'tool').map((m) => m.name)
      out.t1Search = dom.buscar
      out.t1Activity = t1.body.activity.filter((a) => a.type === 'tool').map((a) => a.tool + ':' + a.phase)
      // Turn 2: "El segundo" only makes sense with the conversation memory.
      guion('buscar', [
        { toolCalls: [llamada('get_available_slots', { providerId: 'perfil-beto', profession: 'plomeria', date: '2026-09-26' })] },
        { content: 'Beto tiene estos horarios el sábado. ¿Cuál te queda mejor?' },
      ])
      const t2 = await enviar({ text: 'El segundo' })
      const call2 = conversaciones().find((call) => call.messages.at(-1).content === 'El segundo')
      out.t2History = call2.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => m.content)
      out.t2CandidatesInContext = /"candidates":\\[\\{"providerId":"perfil-ana","name":"Ana Gómez"\\},\\{"providerId":"perfil-beto","name":"Beto Ruiz"\\}\\]/u.test(sistema(call2))
      out.t2Slots = dom.turnos
      out.t2Attachment = t2.body.messages[0].attachment
      out.t2Text = t2.body.messages[0].text
      // A service search is also a tool call.
      guion('otro', [{ toolCalls: [llamada('search_services', { query: 'destapaciones', category: null })] }, { content: 'Hay un servicio de destapaciones a domicilio publicado.' }])
      const t3 = await enviar({ text: '¿Qué servicios de destapación hay?' }, { visitante: 'visitante-servicios-000001' })
      out.t3 = [t3.body.messages[0].text, dom.servicios, t3.body.activity.filter((a) => a.type === 'tool').map((a) => a.tool + ':' + a.phase + (a.ok === undefined ? '' : ':' + a.ok))]
      // History endpoint: the conversation as stored (same memory the orchestrator reads).
      const history = await (await fetch(base + '/tus/v1/asistente/historial?visitorId=' + VISITANTE, { headers: { 'x-correlation-id': 'c' } })).json()
      out.history = history.messages.map((m) => [m.role, m.text.slice(0, 24), m.attachment?.kind ?? null])
      out.historyNoVisitor = (await fetch(base + '/tus/v1/asistente/historial', { headers: { 'x-correlation-id': 'c' } })).status
      // The WhatsApp support inbox never lists Web conversations (shared tables, own channel).
      out.inbox = (await web.soporte.listar({})).length
      const stored = await waStore.repositorios().conversaciones.listar({ channel: 'web' })
      out.webConversations = stored.length
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(result.t1Text, 'Encontré dos plomeros en Centro. ¿Con cuál querés seguir?', 'the reply is written by the model from the tool result')
  assert.equal(result.t1ModelGotMessage, 'Necesito ayuda para arreglar una canilla en el Centro')
  assert.deepEqual(result.t1ToolResultToModel, ['collect_service_request', 'search_providers'], 'tool results go back to the model')
  assert.deepEqual(result.t1Search, [{ query: 'Canilla que gotea', profession: 'plomeria', zone: 'Centro' }], 'the backend ran the real search with the collected need')
  assert.deepEqual(result.t1Activity, ['collect_service_request:start', 'collect_service_request:end', 'search_providers:start', 'search_providers:end'])
  assert.equal(result.t1Attachment.kind, 'providers')
  assert.deepEqual(result.t1Attachment.providers.map((p) => [p.providerId, p.name, p.verified, p.completedJobs]), [['perfil-ana', 'Ana Gómez', true, 12], ['perfil-beto', 'Beto Ruiz', false, 3]], 'cards are exactly the providers the tool returned')
  assert.deepEqual(result.t2History, ['Necesito ayuda para arreglar una canilla en el Centro', 'Encontré dos plomeros en Centro. ¿Con cuál querés seguir?', 'El segundo'], 'the model receives the previous turns')
  assert.equal(result.t2CandidatesInContext, true, 'the shown providers are in the conversation context')
  assert.deepEqual(result.t2Slots, [{ providerId: 'perfil-beto', oficioId: 'plomeria', fecha: '2026-09-26' }], '"el segundo" is the second provider shown')
  assert.equal(result.t2Attachment.kind, 'slots')
  assert.deepEqual(result.t2Attachment.slots.map((s) => s.startsAt), ['2026-09-26T13:00:00.000Z', '2026-09-26T14:00:00.000Z'], 'slots are the ones the backend returned')
  assert.equal(result.t2Text, 'Beto tiene estos horarios el sábado. ¿Cuál te queda mejor?')
  assert.deepEqual(result.t3, ['Hay un servicio de destapaciones a domicilio publicado.', 1, ['search_services:start', 'search_services:end:true']])
  assert.deepEqual(result.history.slice(0, 4), [['user', 'Necesito ayuda para arre', null], ['assistant', 'Encontré dos plomeros en', 'providers'], ['user', 'El segundo', null], ['assistant', 'Beto tiene estos horario', 'slots']])
  assert.equal(result.historyNoVisitor, 400, 'without a session the visitor id is required')
  assert.equal(result.inbox, 0, 'Web conversations are not in the WhatsApp inbox')
  assert.equal(result.webConversations, 2)
})

test('ASISTENTE WEB booking and identity: the confirmation is bound to the session account; the model never decides who the user is; a visitor cannot book', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // A visitor (no session) asks to book: no reservation, sign-in offered.
      guion('reserva', [{ toolCalls: [llamada('book_appointment', { providerId: 'perfil-beto', profession: 'plomeria', startsAt: '2026-09-26T13:00:00.000Z', clientName: 'Soy Otro' })] }])
      // (Its own visitor: what it says is not part of the signed-in conversation below.)
      const anon = await enviar({ text: 'Quiero reservar mañana a las 10 con Beto' }, { visitante: 'visitante-anonimo-0000000001' })
      out.anon = [anon.body.authenticated, anon.body.messages[0].attachment?.kind, anon.body.messages[0].actions ?? null, dom.reservas.length]
      out.anonTools = ultimaConversacion().tools
      // Signed in: the same request prepares a confirmation card.
      const session = { token: 'tok-cliente' }
      guion('buscar', [
        { toolCalls: [llamada('collect_service_request', { profession: 'plomeria', problem: 'Canilla que gotea', zone: 'Centro', question: null })] },
        { toolCalls: [llamada('search_providers', { query: 'canilla', profession: 'plomeria', zone: 'Centro' })] },
        { content: 'Encontré dos plomeros.' },
      ])
      await enviar({ text: 'Necesito un plomero en Centro, gotea la canilla' }, session)
      guion('reserva', [{ toolCalls: [llamada('book_appointment', { providerId: 'perfil-beto', profession: 'plomeria', startsAt: '2026-09-26T13:00:00.000Z', clientName: 'Soy Otro' })] }])
      const card = await enviar({ text: 'Quiero reservar mañana a las 10 con el segundo' }, session)
      out.cardAuthenticated = card.body.authenticated
      out.cardTools = ultimaConversacion().tools
      out.cardText = card.body.messages[0].text
      out.cardActions = card.body.messages[0].actions.map((a) => [a.kind, a.label, a.id.split(':')[0]])
      out.beforeConfirm = dom.reservas.length
      const confirmId = card.body.messages[0].actions[0].id
      // Another person (a visitor) cannot use the confirmation of this account.
      const stolen = await enviar({ replyId: confirmId }, { visitante: 'visitante-ladron-0000000001' })
      out.stolen = [stolen.body.messages[0].text, dom.reservas.length]
      // The owner confirms: the backend books with the SESSION identity.
      const done = await enviar({ replyId: confirmId }, session)
      out.done = done.body.messages[0].text
      out.userMessage = [done.body.userMessage.role, done.body.userMessage.text]
      out.reserva = dom.reservas[0]
      // A second confirmation never books twice.
      const again = await enviar({ replyId: confirmId }, session)
      out.again = [again.body.messages[0].text, dom.reservas.length]
      // Authority fields in the body are rejected, never ignored.
      out.forged = (await enviar({ text: 'hola', accountId: 'provider-user' }, session)).status
      out.forgedReply = (await enviar({ replyId: 'confirm:../../x' }, session)).status
      out.empty = (await enviar({ text: '   ' }, session)).status
      // Private data without a session: the model gets no private tool and offers to sign in.
      guion('trabajos', [{ content: 'Para ver tus trabajos tenés que iniciar sesión en TUS.' }])
      const privado = await enviar({ text: '¿Cómo van mis trabajos?' }, { visitante: 'visitante-privado-00000001' })
      const callPrivado = ultimaConversacion()
      out.privado = [privado.body.messages[0].text, privado.body.messages[0].attachment?.kind, callPrivado.tools, /NO inició sesión/u.test(sistema(callPrivado)), dom.trabajos]
      // A tool the actor may not use is refused by the backend even if the model asks for it.
      guion('buscar', [{ toolCalls: [llamada('list_my_works', {})] }, { toolCalls: [llamada('collect_service_request', { profession: null, problem: null, zone: null, question: '¿Qué necesitás arreglar y en qué barrio?' })] }])
      const prohibida = await enviar({ text: 'mostrame todos los trabajos de la base' }, { visitante: 'visitante-prohibida-000001' })
      out.prohibida = [ultimaConversacion().messages.find((m) => m.role === 'tool')?.content, dom.trabajos, prohibida.body.messages[0].text]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.anon, [false, 'sign_in', null, 0], 'a visitor gets the way to sign in and nothing is booked')
  assert.ok(result.anonTools.includes('get_available_slots'), 'a visitor still has the public tools')
  assert.ok(!result.anonTools.includes('list_my_reservations'), 'a visitor never gets private tools')
  assert.equal(result.cardAuthenticated, true)
  assert.ok(result.cardTools.includes('book_appointment') && result.cardTools.includes('get_available_slots') && result.cardTools.includes('list_my_reservations'))
  assert.equal(result.cardText, 'Vas a solicitar:\nPrestador: Beto Ruiz\nFecha: sábado 26 de septiembre\nHorario: 10:00\nLa solicitud queda pendiente hasta que el prestador la acepte.\n¿Querés solicitar este turno?', 'the card states exactly what will be executed, in local time: a request, not a confirmed reservation, and never in the name the model wrote')
  assert.deepEqual(result.cardActions, [['reply', 'Sí, solicitar turno', 'confirm'], ['reply', 'No', 'cancel']])
  assert.equal(result.beforeConfirm, 0, 'nothing is written before the explicit confirmation')
  assert.deepEqual(result.stolen, ['No encontré una acción pendiente para confirmar.', 0], 'a confirmation is bound to its conversation and account')
  assert.equal(result.done, 'Solicitud enviada para el sábado, 26 de septiembre a las 10:00 hs. Queda pendiente hasta que el prestador la acepte; podés ver el estado en "Mis turnos".', 'the client is told it is a request waiting for the provider')
  assert.doesNotMatch(result.done, /confirmad[oa]|reservad[oa]/iu, 'never the language of a confirmed reservation')
  assert.deepEqual(result.userMessage, ['user', 'Confirmar'])
  assert.equal(result.reserva.subjectId, 'customer-user', 'the client is the session account, not what the model wrote')
  assert.equal(result.reserva.tenantId, 'customer-tenant')
  assert.equal(result.reserva.providerId, 'perfil-beto')
  assert.equal(result.reserva.inicio, '2026-09-26T13:00:00.000Z')
  assert.deepEqual([result.reserva.clienteNombre, result.reserva.clienteTelefono, result.reserva.clienteEmail], [undefined, undefined, undefined], 'no name or contact travels from the conversation: they are those of the account')
  assert.deepEqual(result.again, ['Esa acción ya fue procesada; no la repito.', 1], 'a repeated confirmation does not book again')
  assert.equal(result.forged, 422)
  assert.equal(result.forgedReply, 422)
  assert.equal(result.empty, 422)
  assert.deepEqual(result.privado, ['Para ver tus trabajos tenés que iniciar sesión en TUS.', 'sign_in', [], true, 0], 'private areas: no private tool, the model explains, the backend never reads the data')
  assert.match(result.prohibida[0], /TOOL_NOT_AVAILABLE|LINK_REQUIRED/u, 'the backend refuses the tool')
  assert.equal(result.prohibida[1], 0, 'the private read never ran')
  assert.equal(result.prohibida[2], '¿Qué necesitás arreglar y en qué barrio?')
})

test('ASISTENTE WEB safety: model down -> safe fallback (extractive help or a fixed text), never invented data; the model cannot answer a search without the tool; streaming emits the real steps', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // The model fails on every call: a knowledge question falls back to the extractive help.
      script = () => { throw new Error('model down') }
      const caida = await enviar({ text: '¿Cómo funciona TUS?' })
      out.caida = [caida.status, caida.body.degraded, caida.body.messages.map((m) => [m.fallback ?? false, m.attachment?.kind ?? null, /esto es lo que dice la ayuda de TUS/u.test(m.text)])]
      // Anything else: the fixed, honest text. No provider, slot or price appears.
      const caidaBusqueda = await enviar({ text: 'Necesito un plomero en Centro' }, { visitante: 'visitante-caida-0000000001' })
      out.caidaBusqueda = [caidaBusqueda.body.messages.map((m) => [m.text, m.attachment ?? null]), dom.buscar.length]
      // The model "answers" a search from its own head: the backend does not pass it on.
      guion('buscar', [{ content: 'Te recomiendo a Carlos Inventado, cobra $5000 y está libre hoy a las 15.' }])
      const inventado = await enviar({ text: 'Busco electricista en Centro' }, { visitante: 'visitante-invento-000000001' })
      out.inventado = inventado.body.messages.map((m) => [/Carlos Inventado/u.test(m.text), m.attachment ?? null])
      out.inventadoSearches = dom.buscar.length
      // "Quiero reservar mañana": the booking tools are offered to the model.
      guion('reserva', [{ content: '¿Con qué profesional y para qué servicio querés el turno?' }])
      const reservar = await enviar({ text: 'Quiero reservar mañana' }, { visitante: 'visitante-reserva-000000001' })
      out.reservar = [reservar.body.messages[0].text, ultimaConversacion().tools]
      // Streaming: one NDJSON line per real step, then the message, then done.
      guion('buscar', [
        { toolCalls: [llamada('collect_service_request', { profession: 'plomeria', problem: 'Pierde agua', zone: 'Centro', question: null })] },
        { toolCalls: [llamada('search_providers', { query: 'pérdida', profession: 'plomeria', zone: 'Centro' })] },
        { content: 'Encontré dos plomeros.' },
      ])
      const stream = await enviar({ text: 'Necesito ayuda para arreglar una pérdida de agua en Centro' }, { stream: true, visitante: 'visitante-stream-0000000001' })
      out.streamType = stream.type
      out.stream = stream.body.map((e) => e.type + (e.activity ? ':' + e.activity.type + (e.activity.tool ? ':' + e.activity.tool + ':' + e.activity.phase : '') : ''))
      out.streamMessage = stream.body.find((e) => e.type === 'message').message.attachment.kind
      // An invalid request never opens a stream.
      const invalid = await enviar({ text: '' }, { stream: true })
      out.invalidStream = [invalid.status, invalid.body.code]
      // Per-conversation limit (cost control): the 13th message of a minute is refused.
      guion('saludo', [{ content: 'Hola.' }])
      let last = 0
      for (let i = 0; i < 13; i += 1) last = (await enviar({ text: 'hola ' + i }, { visitante: 'visitante-limite-0000000001' })).status
      out.limite = last
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(result.caida, [200, true, [[true, 'sources', true]]], 'model down: extractive public help, marked as fallback')
  assert.deepEqual(result.caidaBusqueda, [[['¿Para cuándo necesitás Plomería?', null]], 0], 'model down on a search: the one question that is missing, no data, no search')
  assert.deepEqual(result.inventado, [[false, null]], 'a search answered without the tool never reaches the user')
  assert.equal(result.inventadoSearches, 0)
  assert.equal(result.reservar[0], '¿Con qué profesional y para qué servicio querés el turno?')
  assert.ok(result.reservar[1].includes('get_available_slots') && result.reservar[1].includes('book_appointment'))
  assert.match(result.streamType, /^application\/x-ndjson/u)
  assert.deepEqual(result.stream, [
    'accepted',
    'activity:routing',
    'activity:tool:collect_service_request:start',
    'activity:tool:collect_service_request:end',
    'activity:tool:search_providers:start',
    'activity:tool:search_providers:end',
    'message',
    'done',
  ])
  assert.equal(result.streamMessage, 'providers')
  assert.deepEqual(result.invalidStream, [422, 'INVALID_REQUEST'])
  assert.equal(result.limite, 429)
})

test('ASISTENTE one brain: WhatsApp and the Web run the same orchestrator, tools and memory; signing in keeps the visitor conversation; the Web UI holds no decision logic', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const { OrquestadorConversacion, promptSistema, VERSION_PROMPT_SISTEMA } = await import('./apps/api/src/tus/asistente/orquestador.ts')
    const out = {}
    try {
      // The same question through WhatsApp: same tool, same backend search.
      script = ({ messages }) => !messages.some((m) => m.role === 'tool')
        ? { toolCalls: [llamada('collect_service_request', { profession: 'plomeria', problem: 'Canilla que gotea', zone: 'Centro', question: null })] }
        : { toolCalls: [llamada('search_providers', { query: 'canilla', profession: 'plomeria', zone: 'Centro' })] }
      const waWeb = web.crearWorker({ owner: 'w' })
      await web.ingreso.procesar(parsearWebhookMeta(inbound('5491155550999', 'Necesito ayuda para arreglar una canilla en el Centro'), PHONE_ID), 'corr-wa')
      for (let i = 0; i < 4; i += 1) if ((await waWeb.procesarSiguiente()).outcome === 'idle') break
      out.whatsappText = lastSent().message.text
      out.whatsappSearch = dom.buscar[0]
      out.whatsappRoutingCalls = chat.calls.filter(esRuteo).length
      chat.calls.length = 0
      guion('buscar', [
        { toolCalls: [llamada('collect_service_request', { profession: 'plomeria', problem: 'Canilla que gotea', zone: 'Centro', question: null })] },
        { toolCalls: [llamada('search_providers', { query: 'canilla', profession: 'plomeria', zone: 'Centro' })] },
        { content: 'Encontré dos plomeros.' },
      ])
      const anon = await enviar({ text: 'Necesito ayuda para arreglar una canilla en el Centro' })
      out.webSearch = dom.buscar[1]
      out.sameSystemRules = promptSistema('web').split('\\n').slice(1).join('\\n') === promptSistema('whatsapp').split('\\n').slice(1).join('\\n')
      out.webPrompt = conversaciones()[0].messages[0].content === promptSistema('web')
      out.sameOrchestrator = web.orquestador instanceof OrquestadorConversacion
      out.version = VERSION_PROMPT_SISTEMA
      // Signing in: the conversation started as a visitor continues under the account.
      guion('saludo', [{ content: 'Seguimos.' }])
      const afterLogin = await enviar({ text: 'Ya inicié sesión' }, { token: 'tok-cliente' })
      out.sameConversation = afterLogin.body.conversationId === anon.body.conversationId
      const contacto = await waStore.repositorios().contactos.buscarPorWaId('web:acct:customer-user')
      out.adopted = [contacto?.channel, contacto?.linkedAccountId ?? null]
      out.anonGone = (await waStore.repositorios().contactos.buscarPorWaId('web:anon:' + VISITANTE)) === null
      out.audit = waStore.state.auditoria.filter((e) => e.action === 'assistant.tools_used').map((e) => [e.metadata.channel, e.metadata.waId ?? null]).slice(-1)[0]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.match(result.whatsappText, /^Encontré estos prestadores compatibles:\n1\. Ana Gómez — Plomería, Centro\./u, 'WhatsApp renders the same tool result as text')
  assert.deepEqual(result.whatsappSearch, result.webSearch, 'both channels asked the backend the same thing')
  assert.equal(result.whatsappRoutingCalls, 0, 'WhatsApp keeps its routing without an extra model call')
  assert.equal(result.sameSystemRules, true, 'one set of rules; only the channel presentation line differs')
  assert.equal(result.webPrompt, true)
  assert.equal(result.sameOrchestrator, true)
  assert.equal(result.version, 'tus-asistente-v5')
  assert.equal(result.sameConversation, true)
  assert.deepEqual(result.adopted, ['web', null], 'a Web contact is never a linked WhatsApp number')
  assert.equal(result.anonGone, true)
  assert.deepEqual(result.audit, ['web', null], 'the audit names the channel and never logs a Web contact key')

  const conversation = read('apps/web/src/features/assistant/assistant-conversation.tsx')
  const hook = read('apps/web/src/features/assistant/use-assistant.ts')
  const client = read('apps/web/src/features/assistant/assistant-client.ts')
  const chat = read('apps/web/src/features/assistant/assistant-chat.tsx')
  const widget = read('apps/web/src/features/home/assistant-widget.tsx')
  // The Web only transports and renders: no step machine, no pattern matching on the message.
  for (const [name, source] of [['conversation', conversation], ['hook', hook], ['chat', chat], ['widget', widget]]) {
    assert.doesNotMatch(source, /type Step|setStep\(|\.test\(|new RegExp|\.match\(/u, `${name} has no decision logic`)
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|alert\(|confirm\(/u, name)
  }
  assert.match(client, /\/tus\/v1\/asistente\/mensajes/u)
  assert.match(client, /application\/x-ndjson/u)
  assert.match(chat + widget, /useAssistant\(/u, 'the page and the floating window are the same conversation')
  assert.match(conversation, /assistant\.send\(/u, 'shortcuts send text to the assistant like a typed message')
  assert.equal(read('apps/api/src/tus/asistente/web.ts').includes('this.deps.orquestador.responder('), true, 'the Web service delegates the turn to the shared orchestrator')
  assert.match(read('apps/api/src/server.ts'), /crearRouterAsistenteWeb\(\{ servicio: whatsapp\?\.asistenteWeb \?\? null, sessions \}\)/u)
  assert.doesNotMatch(read('apps/api/src/tus/asistente/web.ts'), /new OrquestadorConversacion|GroqChatProvider|RecuperadorConocimiento/u, 'no second orchestrator, model client or retriever')
})

// The multi-turn conversation ("Necesito un electricista" -> "Para mañana" -> "A la tarde" ->
// "El segundo"), on the Web and on WhatsApp, lives in tus-asistente-conversacional.test.mjs: since
// ASISTENTE-CONV-01 the facts of each message are accumulated by the backend and the search runs
// as soon as trade and day are known, instead of asking for problem and neighbourhood first.
