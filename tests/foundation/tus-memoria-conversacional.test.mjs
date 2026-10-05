import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// MEMORIA-01. Conversational memory of TUS, phase by phase (docs/MEMORIA_CONVERSACIONAL_TUS.md).
// In-memory stores and a scripted model: no network. The PostgreSQL side of each phase is in
// tus-memoria-conversacional-postgres.test.mjs.

export const MEMORIA_SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP}
  const { HistorialConversacional, cuentaDeContacto } = await import('./apps/api/src/tus/asistente/historial.ts')
  const { PROMPT_ENRUTADOR } = await import('./apps/api/src/tus/asistente/herramientas.ts')
  const { claveContactoWeb } = await import('./apps/api/src/tus/asistente/modelo.ts')
  script = (input) => input.messages[0].content === PROMPT_ENRUTADOR ? { content: JSON.stringify({ intent: 'saludo' }) } : { content: 'Respuesta ' + (chat.calls.length) }
  const sesion = (subjectId) => ({ subjectId, sessionId: 'sesion-' + subjectId, tenantId: 'tenant-' + subjectId, roles: ['owner'], permissions: ['tus:read'], correlationId: 'corr' })
  const VISITANTE = 'visitante-0123456789abcdef'
  const enviarWeb = (cuenta, text, extra = {}) => wa.asistenteWeb.enviar({ identidad: cuenta ? { context: sesion(cuenta), visitorId: null } : { context: null, visitorId: extra.visitante ?? VISITANTE }, text, correlationId: 'corr-memoria', ...(extra.clave ? { clientMessageId: extra.clave } : {}) })
  const historial = new HistorialConversacional(waTx)
  const codigo = async (operacion) => { try { await operacion(); return 'ok' } catch (error) { return error?.code ?? String(error?.message ?? error).slice(0, 80) } }
  // A WhatsApp conversation written straight into the store (the history layer is what is tested).
  let serie = 0
  async function conversacionWhatsapp(waId, { cuenta = null, identificada = null, textos = [] } = {}) {
    serie += 1
    const ahora = new Date(waClock()).toISOString()
    const contactId = 'contacto-' + serie; const conversationId = 'conversacion-' + serie
    await waTx.ejecutar(async (repos) => {
      await repos.contactos.crear({ contactId, channel: 'whatsapp', waId, displayName: null, linkedAccountId: cuenta, linkedTenantId: cuenta ? 'tenant-' + cuenta : null, linkedAt: cuenta ? ahora : null, blockedUntil: null, blockedReason: null, createdAt: ahora, lastInboundAt: null, version: 1 })
      await repos.conversaciones.crear({ conversationId, contactId, channel: 'whatsapp', status: 'active', mode: 'bot', handoffReason: null, handoffAt: null, operatorId: null, openedAt: ahora, lastMessageAt: ahora, lastInboundAt: null, unreadCount: 0, summary: null, summaryMessageCount: 0, state: {}, version: 1, identifiedAccountId: identificada, identifiedAt: identificada ? ahora : null })
      for (const [indice, text] of textos.entries()) await repos.mensajes.crear({ messageId: conversationId + '-m' + indice, conversationId, contactId, wamid: 'wamid-' + serie + '-' + indice, direction: indice % 2 ? 'outbound' : 'inbound', type: 'text', text, status: 'processed', statusAt: null, externalTimestamp: ahora, replyToWamid: null, actor: indice % 2 ? 'assistant' : 'contact', metadata: {}, correlationId: 'corr', createdAt: ahora })
    })
    return conversationId
  }
`

test('MEMORIA fase 1 historial: every message has a stable, growing sequence; the history of an account is read by pages, in order, on both channels — and never anybody else\'s', () => {
  const r = runTypeScriptScenario(`${MEMORIA_SETUP}
    const out = {}
    // Account A: three exchanges on the Web and a linked WhatsApp. Account B: its own Web conversation.
    const a1 = await enviarWeb('cuenta-a', 'Hola, soy A')
    await enviarWeb('cuenta-a', 'Necesito un plomero')
    await enviarWeb('cuenta-a', 'Para el jueves')
    const b1 = await enviarWeb('cuenta-b', 'Hola, soy B')
    const anonimo = await enviarWeb(null, 'Hola, soy un visitante')
    const waA = await conversacionWhatsapp('5493794000001', { cuenta: 'cuenta-a', textos: ['wa uno', 'wa dos', 'wa tres'] })
    const waSuelto = await conversacionWhatsapp('5493794000002', { textos: ['sin vincular'] })
    const waIdentificado = await conversacionWhatsapp('5493794000003', { identificada: 'cuenta-a', textos: ['identificada por nombre y DNI'] })

    out.conversacionesA = (await historial.conversaciones('cuenta-a')).map((c) => [c.conversationId === a1.conversationId ? 'web-a' : c.conversationId === waA ? 'wa-a' : 'OTRA', c.channel]).sort()
    out.conversacionesB = (await historial.conversaciones('cuenta-b')).map((c) => c.conversationId === b1.conversationId)
    out.sinCuenta = [(await historial.conversaciones('')).length, (await historial.conversaciones('cuenta-inexistente')).length]

    // Order and pages (two by two, from the newest back).
    const todo = await historial.mensajes({ accountId: 'cuenta-a', conversationId: a1.conversationId })
    out.orden = todo.messages.map((m) => [m.direction, m.text])
    out.secuencias = todo.messages.map((m) => m.sequence)
    const p1 = await historial.mensajes({ accountId: 'cuenta-a', conversationId: a1.conversationId, limit: 2 })
    const p2 = await historial.mensajes({ accountId: 'cuenta-a', conversationId: a1.conversationId, limit: 2, before: p1.nextBefore })
    const p3 = await historial.mensajes({ accountId: 'cuenta-a', conversationId: a1.conversationId, limit: 2, before: p2.nextBefore })
    out.paginas = [p1.messages.map((m) => m.text), p2.messages.map((m) => m.text), p3.messages.map((m) => m.text), p3.nextBefore]
    out.paginasCubren = JSON.stringify([...p3.messages, ...p2.messages, ...p1.messages].map((m) => m.sequence)) === JSON.stringify(out.secuencias)
    out.limites = [(await historial.mensajes({ accountId: 'cuenta-a', conversationId: a1.conversationId, limit: 0 })).messages.length, (await historial.mensajes({ accountId: 'cuenta-a', conversationId: a1.conversationId, limit: 100000 })).messages.length]
    out.whatsappDeA = (await historial.mensajes({ accountId: 'cuenta-a', conversationId: waA })).messages.map((m) => m.text)

    // Isolation: every other conversation answers the same as one that does not exist.
    out.ajenas = [
      await codigo(() => historial.mensajes({ accountId: 'cuenta-a', conversationId: b1.conversationId })),
      await codigo(() => historial.mensajes({ accountId: 'cuenta-b', conversationId: a1.conversationId })),
      await codigo(() => historial.mensajes({ accountId: 'cuenta-b', conversationId: waA })),
      await codigo(() => historial.mensajes({ accountId: 'cuenta-a', conversationId: anonimo.conversationId })),
      await codigo(() => historial.mensajes({ accountId: 'cuenta-a', conversationId: waSuelto })),
      await codigo(() => historial.mensajes({ accountId: 'cuenta-a', conversationId: waIdentificado })),
      await codigo(() => historial.mensajes({ accountId: '', conversationId: a1.conversationId })),
      await codigo(() => historial.mensajes({ accountId: 'cuenta-a', conversationId: 'no-existe' })),
    ]
    out.cuentas = [
      cuentaDeContacto({ channel: 'web', waId: claveContactoWeb({ accountId: 'cuenta-a' }), linkedAccountId: null }),
      cuentaDeContacto({ channel: 'web', waId: claveContactoWeb({ anonymousId: VISITANTE }), linkedAccountId: null }),
      cuentaDeContacto({ channel: 'web', waId: 'web:acct:', linkedAccountId: 'cuenta-x' }),
      cuentaDeContacto({ channel: 'whatsapp', waId: '5493794000001', linkedAccountId: 'cuenta-a' }),
      cuentaDeContacto({ waId: '5493794000002', linkedAccountId: null }),
      // A WhatsApp number that merely LOOKS like a Web key is still a WhatsApp contact.
      cuentaDeContacto({ channel: 'whatsapp', waId: 'web:acct:cuenta-a', linkedAccountId: null }),
    ]
    // Every sequence of the store is unique and grows with the order of arrival.
    const todas = [...waStore.state.mensajes.values()].map((m) => m.sequence)
    out.unicas = new Set(todas).size === todas.length && todas.every((n) => Number.isInteger(n) && n > 0)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.conversacionesA, [['wa-a', 'whatsapp'], ['web-a', 'web']], 'the Web conversation of the account and its LINKED WhatsApp; not the unlinked one, not the one identified by name + document')
  assert.deepEqual(r.conversacionesB, [true])
  assert.deepEqual(r.sinCuenta, [0, 0])
  assert.deepEqual(r.orden.map((m) => m[0]), ['inbound', 'outbound', 'inbound', 'outbound', 'inbound', 'outbound'])
  assert.deepEqual(r.orden.filter((m) => m[0] === 'inbound').map((m) => m[1]), ['Hola, soy A', 'Necesito un plomero', 'Para el jueves'])
  assert.ok(r.secuencias.every((n, i) => i === 0 || n > r.secuencias[i - 1]), 'oldest first, by sequence')
  assert.deepEqual(r.paginas.slice(0, 3).map((p) => p.length), [2, 2, 2])
  assert.equal(r.paginas[0][0], 'Para el jueves', 'the first page is the newest exchange')
  assert.equal(r.paginas[2][0], 'Hola, soy A')
  assert.equal(r.paginas[3], null, 'nothing older than the last page')
  assert.equal(r.paginasCubren, true, 'the pages cover the history exactly once')
  assert.deepEqual(r.limites, [1, 6], 'the page size is bounded on both sides')
  assert.deepEqual(r.whatsappDeA, ['wa uno', 'wa dos', 'wa tres'])
  assert.deepEqual(r.ajenas, Array(8).fill('NOT_FOUND'), 'another account, an anonymous visitor, an unlinked WhatsApp, a name + document identification: all the same "not found"')
  assert.deepEqual(r.cuentas, ['cuenta-a', null, null, 'cuenta-a', null, null])
  assert.equal(r.unicas, true)
})

test('MEMORIA fase 1 idempotencia Web: the same client message key is one message — stored once, answered once — also under a race; another person may use the same key', () => {
  const r = runTypeScriptScenario(`${MEMORIA_SETUP}
    const out = {}
    const antes = chat.calls.length
    const primera = await enviarWeb('cuenta-a', 'Necesito un electricista', { clave: 'mensaje-0001' })
    const llamadas = chat.calls.length - antes
    const repetida = await enviarWeb('cuenta-a', 'Necesito un electricista', { clave: 'mensaje-0001' })
    out.mismo = [repetida.conversationId === primera.conversationId, repetida.userMessage.id === primera.userMessage.id, JSON.stringify(repetida.messages.map((m) => m.id)) === JSON.stringify(primera.messages.map((m) => m.id)), repetida.messages.length]
    out.sinSegundaLlamada = chat.calls.length - antes === llamadas
    const pagina = await historial.mensajes({ accountId: 'cuenta-a', conversationId: primera.conversationId })
    out.guardados = pagina.messages.map((m) => m.direction)
    // Another account and a visitor may use the very same key: it is theirs.
    const otra = await enviarWeb('cuenta-b', 'Hola', { clave: 'mensaje-0001' })
    const visitante = await enviarWeb(null, 'Hola', { clave: 'mensaje-0001' })
    out.otros = [otra.userMessage.id !== primera.userMessage.id, visitante.userMessage.id !== primera.userMessage.id, otra.conversationId !== primera.conversationId]
    // Without a key every message is a new one.
    const s1 = await enviarWeb('cuenta-a', 'Hola'); const s2 = await enviarWeb('cuenta-a', 'Hola')
    out.sinClave = s1.userMessage.id !== s2.userMessage.id
    out.invalida = [await codigo(() => enviarWeb('cuenta-a', 'Hola', { clave: 'corta' })), await codigo(() => enviarWeb('cuenta-a', 'Hola', { clave: 'con espacios y símbolos!' })), await codigo(() => wa.asistenteWeb.enviar({ identidad: { context: sesion('cuenta-a'), visitorId: null }, text: 'Hola', correlationId: 'c', clientMessageId: 12345678 }))]
    // Two copies of the same message at once: one is stored; the other gets the same exchange or is told it is being answered.
    const carrera = await Promise.all([1, 2, 3].map(() => enviarWeb('cuenta-c', 'Mensaje en carrera', { clave: 'mensaje-carrera-1' }).then((x) => x.userMessage.id, (e) => e.code)))
    const guardadosC = [...waStore.state.mensajes.values()].filter((m) => m.direction === 'inbound' && m.text === 'Mensaje en carrera')
    out.carrera = [guardadosC.length, carrera.every((x) => x === guardadosC[0]?.messageId || x === 'TURN_IN_PROGRESS'), carrera.filter((x) => x === guardadosC[0]?.messageId).length >= 1]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.mismo, [true, true, true, 1], 'the retry returns the exchange that was stored')
  assert.equal(r.sinSegundaLlamada, true, 'the model is not called again')
  assert.deepEqual(r.guardados, ['inbound', 'outbound'], 'one message, one answer')
  assert.deepEqual(r.otros, [true, true, true], 'the key is scoped to the person')
  assert.equal(r.sinClave, true)
  assert.deepEqual(r.invalida, ['INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT'])
  assert.deepEqual(r.carrera, [1, true, true], 'a race stores the message once')
})

test('MEMORIA fase 2 contexto: one constructor, a budget of TOKENS — the recent window is filled from the newest message back; long parts are cut, never the newest turn; the metrics carry sizes only', () => {
  const r = runTypeScriptScenario(`
    const c = await import('./apps/api/src/tus/asistente/contexto.ts')
    const P = { ...c.PRESUPUESTO_CONTEXTO_POR_DEFECTO, recientes: 100, porMensaje: 40, resumen: 20, recuerdos: 30, hechos: 10, actual: 15 }
    const texto = (n, letra = 'a') => letra.repeat(Math.floor(n * c.CARACTERES_POR_TOKEN))
    // Twelve messages of 30 tokens each: only the newest three fit in 100 tokens.
    const recientes = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + String(i).padStart(2, '0') + texto(29) }))
    const fijos = [{ role: 'system', content: texto(50, 's') }]
    const x = c.construirContexto({ fijos, resumen: texto(60, 'r'), recuerdos: [texto(20, 'x'), texto(20, 'y'), texto(5, 'z')], hechos: [texto(8, 'h'), texto(8, 'i')], recientes, actual: 'SECRETO-' + texto(40, 'q') }, P)
    const ventana = x.messages.filter((m) => m.role !== 'system').slice(0, -1)
    const out = {
      orden: x.messages.map((m) => m.role),
      ventana: ventana.map((m) => m.content.slice(0, 3)),
      tokensVentana: ventana.reduce((s, m) => s + c.estimarTokens(m.content), 0) <= P.recientes,
      resumen: [c.estimarTokens(x.messages[1].content.split('\\n')[1]) <= P.resumen, x.messages[1].content.startsWith(c.ENCABEZADO_RESUMEN)],
      recuerdos: x.messages[2].content.split('\\n').length - 1,
      hechos: x.messages[3].content.split('\\n').length - 1,
      actual: [x.messages.at(-1).role, c.estimarTokens(x.messages.at(-1).content) <= P.actual, x.messages.at(-1).content.startsWith('SECRETO-')],
      metricas: x.metricas,
      sinContenido: !JSON.stringify(x.metricas).includes('SECRETO') && Object.values(x.metricas).every((v) => typeof v === 'number' || typeof v === 'boolean'),
      total: x.metricas.tokensTotal === x.metricas.tokensFijos + x.metricas.tokensResumen + x.metricas.tokensRecuerdos + x.metricas.tokensHechos + x.metricas.tokensRecientes + x.metricas.tokensActual,
    }
    // One huge newest message: it is cut and kept; nothing older fits.
    const largo = c.ventanaReciente([{ role: 'user', content: 'viejo' }, { role: 'assistant', content: 'ULTIMO' + texto(500) }], { recientes: 30, porMensaje: 40 })
    out.largo = [largo.mensajes.length, largo.mensajes[0].content.startsWith('ULTIMO'), c.estimarTokens(largo.mensajes[0].content) <= 40, largo.omitidos, largo.recortados]
    // Short messages: more than twelve fit — the window is not a count of messages.
    const cortos = c.ventanaReciente(Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: 'ok ' + i })), c.PRESUPUESTO_CONTEXTO_POR_DEFECTO)
    out.cortos = [cortos.mensajes.length, cortos.mensajes.at(-1).content, cortos.mensajes[0].content]
    const vacio = c.construirContexto({ fijos: [], resumen: null, recuerdos: [], hechos: [], recientes: [], actual: 'hola' })
    out.vacio = [vacio.messages.map((m) => m.role), vacio.metricas.mensajesIncluidos, vacio.metricas.tokensResumen]
    out.estimacion = [c.estimarTokens(''), c.estimarTokens('a'), c.estimarTokens('a'.repeat(35)), c.estimarTokens('a'.repeat(36))]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.orden, ['system', 'system', 'system', 'system', 'assistant', 'user', 'assistant', 'user'], 'fixed instructions, summary, memories, facts, the recent window, the current message')
  assert.deepEqual(r.ventana, ['m09', 'm10', 'm11'], 'the newest messages, oldest first')
  assert.equal(r.tokensVentana, true)
  assert.deepEqual(r.resumen, [true, true], 'a long summary is cut to its budget')
  assert.equal(r.recuerdos, 1, 'memories are taken in order while they fit')
  assert.equal(r.hechos, 1)
  assert.deepEqual(r.actual, ['user', true, true], 'the current message is last and bounded')
  assert.deepEqual([r.metricas.mensajesIncluidos, r.metricas.mensajesOmitidos, r.metricas.recuerdosIncluidos, r.metricas.recuerdosOmitidos, r.metricas.hechosIncluidos, r.metricas.hechosOmitidos, r.metricas.resumenRecortado, r.metricas.actualRecortado], [3, 9, 1, 2, 1, 1, true, true], 'what was included and what was left out is measured')
  assert.equal(r.sinContenido, true, 'numbers and flags only')
  assert.equal(r.total, true)
  assert.deepEqual(r.largo, [1, true, true, 1, 1])
  assert.deepEqual(r.cortos, [40, 'ok 39', 'ok 0'], 'a budget of tokens, not a number of messages')
  assert.deepEqual(r.vacio, [['user'], 0, 0])
  assert.deepEqual(r.estimacion, [0, 1, 10, 11])
})

test('MEMORIA fase 2 orquestador: the model receives the context of the constructor — its own conversation only, the window chosen by tokens — and the turn reports its sizes without content', () => {
  const r = runTypeScriptScenario(`${MEMORIA_SETUP}
    const out = {}
    const conversacion = (llamada) => llamada.messages.filter((m) => m.role !== 'system')
    const charla = () => chat.calls.filter((call) => call.messages[0].content !== PROMPT_ENRUTADOR).at(-1)
    // Twenty short exchanges of account A: more than the old fixed window of twelve messages.
    for (let i = 1; i <= 20; i += 1) { await enviarWeb('cuenta-a', 'mensaje A ' + i); waAdvance(6000) }
    await enviarWeb('cuenta-b', 'mensaje privado de B con un dato-de-b')
    await enviarWeb('cuenta-a', 'pregunta final de A')
    const deA = conversacion(charla())
    out.ventana = [deA.length > 13, deA.at(-1).content, deA[0].content, deA.some((m) => /dato-de-b|privado de B/u.test(m.content))]
    // A long answer is cut to the per-message limit, and the turn after it still reaches the model.
    const guion = script
    script = (input) => input.messages[0].content === PROMPT_ENRUTADOR ? guion(input) : { content: 'x'.repeat(3900) }
    await enviarWeb('cuenta-c', 'contame todo')
    script = guion
    await enviarWeb('cuenta-c', 'y la última')
    const deC = conversacion(charla())
    out.largo = [deC.map((m) => m.role), deC[1].content.length < 1100, deC.at(-1).content]
    const medidas = metrics.filter((m) => m.name === 'assistant.context')
    const ultima = medidas.at(-1)
    out.metrica = [medidas.length >= 3, ultima.channel, typeof ultima.tokensTotal, ultima.mensajesIncluidos, ultima.mensajesRecortados, ultima.tokensTotal === ultima.tokensFijos + ultima.tokensResumen + ultima.tokensRecuerdos + ultima.tokensHechos + ultima.tokensRecientes + ultima.tokensActual]
    out.sinContenido = !JSON.stringify(medidas).includes('mensaje A') && !JSON.stringify(medidas).includes('xxxx')
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.ventana[0], true, 'more than twelve short messages reach the model: the limit is tokens')
  assert.equal(r.ventana[1], 'pregunta final de A', 'the current message is last')
  assert.match(r.ventana[2], /^mensaje A |^Respuesta /u)
  assert.equal(r.ventana[3], false, 'nothing of another account is ever in the context')
  assert.deepEqual(r.largo, [['user', 'assistant', 'user'], true, 'y la última'], 'a long message is cut to its limit; the turn after it is intact')
  assert.deepEqual(r.metrica, [true, 'web', 'number', 2, 1, true])
  assert.equal(r.sinContenido, true, 'the metric never carries the text of a message')
})
