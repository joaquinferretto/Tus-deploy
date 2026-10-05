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

test('MEMORIA fase 3 resumen: incremental and versioned — each version says "up to message X", only what came after is summarized on top of the previous text, the originals stay, a failure is retried, and it can be regenerated', () => {
  const r = runTypeScriptScenario(`${MEMORIA_SETUP}
    const { ENCABEZADO_RESUMEN } = await import('./apps/api/src/tus/asistente/contexto.ts')
    const out = {}
    const esResumen = (input) => String(input.messages[0].content).startsWith('Resumí la conversación')
    const resumenes = []
    let fallar = false
    script = (input) => {
      if (input.messages[0].content === PROMPT_ENRUTADOR) return { content: JSON.stringify({ intent: 'saludo' }) }
      if (esResumen(input)) {
        if (fallar) throw new Error('modelo caido')
        resumenes.push({ anterior: input.messages.find((m) => String(m.content).startsWith('Resumen anterior:'))?.content ?? null, nuevos: input.messages.at(-1).content })
        return { content: JSON.stringify({ necesidad: 'resumen ' + resumenes.length }) }
      }
      return { content: 'Respuesta ' + chat.calls.length }
    }
    const hablar = async (desde, hasta) => { for (let i = desde; i <= hasta; i += 1) { await enviarWeb('cuenta-a', 'mensaje numero ' + i); waAdvance(6000) } }
    const versiones = async (id) => waTx.ejecutar((repos) => repos.resumenes.listar(id))
    // The summary runs when 24 messages are waiting (the answer of the turn is stored after it):
    // at the 13th message there are 25, and the 13 that left the recent window are summarized.
    await hablar(1, 12)
    const conversationId = (await enviarWeb('cuenta-a', 'mensaje numero 13')).conversationId; waAdvance(6000)
    const v1 = await versiones(conversationId)
    out.primera = v1.map((v) => [v.version, v.messageCount, v.fromSequence < v.throughSequence, v.text])
    out.primeraEntrada = [resumenes[0].anterior, resumenes[0].nuevos.includes('mensaje numero 1'), resumenes[0].nuevos.includes('mensaje numero 12')]
    // The model is down: nothing is stored, the turn is still answered; later the SAME range is tried again.
    fallar = true
    await hablar(14, 19)
    out.conFallo = [(await versiones(conversationId)).length, [...waStore.state.mensajes.values()].filter((m) => m.conversationId === conversationId && m.direction === 'outbound').length]
    fallar = false
    await hablar(20, 20)
    const v2 = await versiones(conversationId)
    out.segunda = v2.map((v) => [v.version, v.fromSequence, v.throughSequence])
    out.contiguas = v2[1].fromSequence > v2[0].throughSequence && v2[1].throughSequence > v2[1].fromSequence
    const ultimo = resumenes.at(-1)
    out.incremental = [ultimo.anterior.includes('resumen 1'), ultimo.nuevos.includes('mensaje numero 1\\n') || /mensaje numero 1(?!\\d)/u.test(ultimo.nuevos), /mensaje numero 1[0-9]/u.test(ultimo.nuevos)]
    // The context of the next turn carries the newest version, and the originals are all there.
    await hablar(21, 21)
    const ultimaLlamada = chat.calls.filter((call) => call.messages[0].content !== PROMPT_ENRUTADOR && !esResumen(call)).at(-1)
    const enContexto = ultimaLlamada.messages.find((m) => String(m.content).startsWith(ENCABEZADO_RESUMEN))
    const vigente = await waTx.ejecutar((repos) => repos.resumenes.vigente(conversationId))
    out.contexto = [Boolean(enContexto), enContexto.content.includes(vigente.text), vigente.version === (await versiones(conversationId)).length]
    out.originales = (await historial.mensajes({ accountId: 'cuenta-a', conversationId, limit: 200 })).messages.filter((m) => m.direction === 'inbound').map((m) => m.text).join('|') === Array.from({ length: 21 }, (_, i) => 'mensaje numero ' + (i + 1)).join('|')
    // Trace: every version knows its range; a repeated version is refused by the store.
    out.repetida = await codigo(() => waTx.ejecutar((repos) => repos.resumenes.crear({ ...vigente, summaryId: 'otro-id' })))
    // Regenerable from the original messages: a NEW version over the same reach; the others stay.
    const antes = (await versiones(conversationId)).length
    const regenerado = await wa.orquestador.regenerarResumen(conversationId)
    const despues = await versiones(conversationId)
    out.regenerado = [regenerado.version === antes + 1, regenerado.throughSequence === vigente.throughSequence, regenerado.fromSequence <= v1[0].fromSequence, despues.length === antes + 1, despues.slice(0, antes).map((v) => v.summaryId).join() === (await versiones(conversationId)).slice(0, antes).map((v) => v.summaryId).join()]
    out.sinResumenes = await wa.orquestador.regenerarResumen('conversacion-sin-resumen')
    out.metricas = [metrics.filter((m) => m.name === 'assistant.summary').length >= 2, metrics.some((m) => m.name === 'assistant.summary_skipped' && m.reason === 'failed'), !JSON.stringify(metrics.filter((m) => m.name.startsWith('assistant.summary'))).includes('mensaje numero')]
    // Another account never appears in a summary input.
    await enviarWeb('cuenta-b', 'dato privado de B')
    out.aislado = !resumenes.some((x) => x.nuevos.includes('privado de B'))
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.primera.length, 1)
  assert.deepEqual(r.primera[0].slice(0, 3), [1, 13, true], 'version 1 covers the 13 messages that left the recent window')
  assert.match(r.primera[0][3], /resumen 1/u)
  assert.deepEqual(r.primeraEntrada, [null, true, false], 'the first summary has no previous text and does not swallow the recent window')
  assert.equal(r.conFallo[0], 1, 'a failed attempt stores nothing')
  assert.ok(r.conFallo[1] >= 18, 'and the turns are still answered')
  assert.deepEqual(r.segunda.map((v) => v[0]), [1, 2], 'the retry stores the next version')
  assert.equal(r.contiguas, true, 'version 2 starts after the last message of version 1')
  assert.deepEqual(r.incremental, [true, false, true], 'the new version is built on the previous text plus ONLY the messages after it')
  assert.deepEqual(r.contexto, [true, true, true], 'the context uses the newest version')
  assert.equal(r.originales, true, 'the original messages are never replaced')
  assert.equal(r.repetida, 'P2002', 'one row per version')
  assert.deepEqual(r.regenerado, [true, true, true, true, true], 'regenerated from the originals as a new version; the previous ones stay')
  assert.equal(r.sinResumenes, null)
  assert.deepEqual(r.metricas, [true, true, true], 'counts and sizes only')
  assert.equal(r.aislado, true)
})

test('MEMORIA privacidad: passwords, verification codes, tokens, cookies, card data and authentication links never become memory', () => {
  const r = runTypeScriptScenario(`
    const { limpiarParaMemoria: l, sinSecretos } = await import('./apps/api/src/tus/asistente/modelo.ts')
    const casos = {
      contrasena: 'mi contraseña es hunter2secreta y quiero un plomero',
      clave: 'la clave: Abc12345',
      codigo: 'el código es 482913 gracias',
      verificar: 'VERIFICAR TUS 7K4M9QXR',
      enlace: 'entrá a https://tusservicios.shop/restablecer-contrasena?token=abc123DEF456 para cambiarla',
      enlaceVerificacion: 'https://tus.test/verificar-email?code=ZZZ999',
      bearer: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
      apiKey: 'usa gsk_abcdefghijklmnop1234 por favor',
      tarjeta: 'mi tarjeta es 4509 9535 6623 3704 y el cvv 123',
      dni: 'soy Juan Pérez, DNI 30.111.222, mail juan@example.com, cel 3794 123456',
      cookie: 'la cookie: tus_session=s%3Aabcdef123456',
    }
    const limpio = Object.fromEntries(Object.entries(casos).map(([k, v]) => [k, l(v)]))
    console.log(JSON.stringify({
      limpio,
      fugas: ['hunter2secreta', 'Abc12345', '482913', '7K4M9QXR', 'abc123DEF456', 'ZZZ999', 'eyJhbGci', 'gsk_abcdefghijklmnop1234', '4509', '3704', '30.111.222', 'juan@example.com', '3794 123456', 's%3Aabcdef123456'].filter((secreto) => Object.values(limpio).some((texto) => texto.includes(secreto))),
      conserva: [l('Necesito un plomero para el jueves a las 10 en el centro'), l('El turno sale $200 y la seña es de $100'), sinSecretos('mirá https://tusservicios.shop/ayuda/pagos')],
    }))
  `)
  assert.deepEqual(r.fugas, [], `nothing secret survives: ${JSON.stringify(r.limpio)}`)
  assert.match(r.limpio.contrasena, /quiero un plomero/u, 'the useful part of the message is kept')
  assert.deepEqual(r.conserva, ['Necesito un plomero para el jueves a las 10 en el centro', 'El turno sale $200 y la seña es de $100', 'mirá https://tusservicios.shop/ayuda/pagos'], 'ordinary text, prices and plain links are untouched')
})

// Deterministic embeddings for the memory tests: the direction of a vector is its topic.
const MEMORIA_SEMANTICA_SETUP = `${MEMORIA_SETUP}
  const { IndiceMemoriaEnMemoria, ServicioMemoriaSemantica, fragmentarConversacion } = await import('./apps/api/src/tus/asistente/memoria-semantica.ts')
  const { ENCABEZADO_RECUERDOS } = await import('./apps/api/src/tus/asistente/contexto.ts')
  const TEMAS = [/agua|plomer|canilla|ba[nñ]o/iu, /enchufe|electric|luz|cable/iu, /jard[ií]n|pasto|podar/iu]
  const temas = { id: 'temas', model: 'temas', version: 'temas-v1', dimensions: 4, embedded: [], embed: async (texts) => texts.map((text) => { temas.embedded.push(text); const v = TEMAS.map((patron) => (patron.test(text) ? 1 : 0)); return v.some(Boolean) ? [...v, 0] : [0, 0, 0, 1] }) }
  const indiceMemoria = new IndiceMemoriaEnMemoria()
  const conMemoria = crearModuloWhatsapp({ env: { ...waEnv, WHATSAPP_AI_MEMORY_MIN_SCORE: '0.5' }, transaction: waTx, accounts: accountResolver, application: tusApp, knowledgeIndex, memoryIndex: indiceMemoria, whatsapp: fakeWa, chat, embeddings: temas, transcriptor: null, now: waClock, metric: (name, fields) => metrics.push({ name, ...fields }) })
  const esResumen = (input) => String(input.messages[0].content).startsWith('Resumí la conversación')
  script = (input) => input.messages[0].content === PROMPT_ENRUTADOR ? { content: JSON.stringify({ intent: 'saludo' }) } : esResumen(input) ? { content: JSON.stringify({ necesidad: 'resumen' }) } : { content: 'Entendido.' }
  const decir = async (cuenta, text, extra = {}) => { const r = await conMemoria.asistenteWeb.enviar({ identidad: cuenta ? { context: sesion(cuenta), visitorId: null } : { context: null, visitorId: extra.visitante ?? VISITANTE }, text, correlationId: 'corr-memoria' }); waAdvance(6000); return r }
  // Thirteen messages on one topic: the summary step runs and what left the recent window becomes memory.
  const charlar = async (cuenta, frase, extra) => { let ultimo; for (let i = 1; i <= 13; i += 1) ultimo = await decir(cuenta, frase + ' (' + i + ')', extra); return ultimo.conversationId }
  const recuerdosDe = (llamada) => llamada.messages.find((m) => String(m.content).startsWith(ENCABEZADO_RECUERDOS))?.content ?? null
  const ultimaCharla = () => chat.calls.filter((call) => call.messages[0].content !== PROMPT_ENRUTADOR && !esResumen(call)).at(-1)
`

test('MEMORIA fase 4 semántica: stretches of old conversations become memories of the ACCOUNT; a related question brings a few of them back — never another account\'s, never for an anonymous visitor, never a secret', () => {
  const r = runTypeScriptScenario(`${MEMORIA_SEMANTICA_SETUP}
    const out = {}
    const convA = await charlar('cuenta-a', 'Tengo una pérdida de agua en el baño, mi contraseña es hunter2secreta y mi mail es ana@example.com')
    const convB = await charlar('cuenta-b', 'Se me quemó un enchufe y necesito un electricista, dato privado de B')
    const convAnonima = await charlar(null, 'Un visitante pregunta por una pérdida de agua')
    out.guardados = [(await indiceMemoria.deCuenta('cuenta-a')).length > 0, (await indiceMemoria.deCuenta('cuenta-b')).length > 0, indiceMemoria.filas.every((f) => ['cuenta-a', 'cuenta-b'].includes(f.fragment.accountId)), indiceMemoria.filas.some((f) => f.fragment.conversationId === convAnonima)]
    const deA = await indiceMemoria.deCuenta('cuenta-a')
    out.procedencia = deA.map((f) => [f.conversationId === convA, f.channel, f.fromSequence <= f.throughSequence, f.checksum.length, f.text.split('\\n').length > 1])
    out.sinSecretos = !JSON.stringify(indiceMemoria.filas).includes('hunter2secreta') && !JSON.stringify(indiceMemoria.filas).includes('ana@example.com') && !temas.embedded.some((t) => t.includes('hunter2secreta') || t.includes('ana@example.com'))
    // Later, in a NEW conversation of account A (the Web one was closed): a related question.
    await conMemoria.asistenteWeb.reiniciar({ context: sesion('cuenta-a'), visitorId: null })
    const nueva = await decir('cuenta-a', '¿Te acordás de lo del agua del baño?')
    const recuerdosA = recuerdosDe(ultimaCharla())
    out.recupera = [nueva.conversationId !== convA, Boolean(recuerdosA), /pérdida de agua/u.test(recuerdosA ?? ''), /enchufe|privado de B/u.test(recuerdosA ?? ''), (recuerdosA ?? '').split('\\n').length - 1 <= 3, /\\[\\d{4}-\\d{2}-\\d{2}, Web\\]/u.test(recuerdosA ?? '')]
    // The same account asking about something it never talked about: nothing is brought back.
    await decir('cuenta-a', 'Necesito alguien para podar el jardín')
    out.sinRelacion = recuerdosDe(ultimaCharla())
    // Account B asking about water: it has no memory of water, and never gets A's.
    await decir('cuenta-b', '¿Y lo de la pérdida de agua?')
    out.cuentaB = recuerdosDe(ultimaCharla())
    await decir('cuenta-b', 'Volviendo al enchufe quemado')
    const recuerdosB = recuerdosDe(ultimaCharla())
    out.propiosDeB = [/enchufe/u.test(recuerdosB ?? ''), /agua|baño/u.test(recuerdosB ?? '')]
    // An anonymous visitor asking the same: no account, no memory.
    await decir(null, '¿Te acordás de la pérdida de agua?', { visitante: 'visitante-otro-0123456789' })
    out.anonimo = recuerdosDe(ultimaCharla())
    const medidas = metrics.filter((m) => m.name.startsWith('assistant.memory'))
    out.metricas = [medidas.some((m) => m.name === 'assistant.memory_stored' && m.fragments > 0), medidas.some((m) => m.name === 'assistant.memory_retrieved' && m.retrieved > 0), medidas.some((m) => m.name === 'assistant.memory_retrieved' && m.discarded > 0), !JSON.stringify(medidas).includes('agua')]
    const contexto = metrics.filter((m) => m.name === 'assistant.context').at(-1)
    out.contexto = typeof contexto.tokensRecuerdos === 'number'
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.guardados, [true, true, true, false], 'memories exist for the two accounts and for nobody else: the anonymous conversation stores none')
  for (const fila of r.procedencia) assert.deepEqual(fila, [true, 'web', true, 64, true], 'each fragment knows its conversation, channel and message range, and holds several messages')
  assert.equal(r.sinSecretos, true, 'a password and an email never reach a fragment or the embeddings provider')
  assert.deepEqual(r.recupera, [true, true, true, false, true, true], 'a related question in a new conversation brings back a few memories of that account, with their origin')
  assert.equal(r.sinRelacion, null, 'below the threshold nothing is a memory')
  assert.equal(r.cuentaB, null, 'another account never receives them')
  assert.deepEqual(r.propiosDeB, [true, false])
  assert.equal(r.anonimo, null, 'no account, no memory')
  assert.deepEqual(r.metricas, [true, true, true, true], 'stored, retrieved and discarded are counted without content')
  assert.equal(r.contexto, true)
})

test('MEMORIA fase 4 servicio: the account restricts the search before the similarity; a threshold and a small top K choose; fragments are coherent stretches; a failure never breaks the turn', () => {
  const r = runTypeScriptScenario(`${MEMORIA_SEMANTICA_SETUP}
    const out = {}
    const mensaje = (n, text, direction = 'inbound') => ({ messageId: 'm' + n, conversationId: 'c', contactId: 'k', wamid: null, direction, type: 'text', text, status: 'processed', statusAt: null, externalTimestamp: null, replyToWamid: null, actor: 'contact', metadata: {}, correlationId: 'c', createdAt: new Date(waClock()).toISOString(), sequence: n })
    const largos = Array.from({ length: 9 }, (_, i) => mensaje(i + 1, 'pérdida de agua parte ' + (i + 1) + ' ' + 'x'.repeat(200), i % 2 ? 'outbound' : 'inbound'))
    const fragmentos = fragmentarConversacion([...largos, mensaje(10, null), { ...mensaje(11, 'sin secuencia'), sequence: undefined }])
    out.fragmentos = [fragmentos.length > 1, fragmentos.every((f) => f.text.length <= 900), fragmentos[0].fromSequence, fragmentos.at(-1).throughSequence, fragmentos.every((f, i) => i === 0 || f.fromSequence === fragmentos[i - 1].throughSequence + 1), fragmentos[0].text.startsWith('Usuario: '), fragmentos[0].text.includes('\\nTUS: ')]
    const indice = new IndiceMemoriaEnMemoria()
    const servicio = new ServicioMemoriaSemantica(indice, temas, { topK: 2, minScore: 0.5 }, waClock)
    const recordar = (accountId, conversationId, textos) => servicio.recordar({ accountId, conversationId, channel: 'whatsapp', mensajes: textos.map((t, i) => ({ ...mensaje(i + 1, t), conversationId })) })
    out.guardar = [await recordar('A', 'c1', ['pérdida de agua en la cocina']), await recordar('A', 'c1', ['pérdida de agua en la cocina']), await recordar('A', 'c2', ['canilla que gotea']), await recordar('A', 'c3', ['otra pérdida de agua, tercera vez']), await recordar('A', 'c4', ['enchufe quemado']), await recordar('B', 'c5', ['agua en el techo de B']), await recordar('', 'c6', ['agua sin cuenta'])]
    const agua = await servicio.recuperar({ accountId: 'A', consulta: 'tengo otra vez agua en el piso' })
    out.agua = [agua.recuerdos.length, agua.recuerdos.every((x) => /agua|canilla/u.test(x)), agua.recuerdos.some((x) => x.includes('de B')), agua.candidatos, agua.descartados, agua.recuerdos.every((x) => x.includes('WhatsApp'))]
    out.luz = (await servicio.recuperar({ accountId: 'A', consulta: 'la luz no anda' })).recuerdos.map((x) => x.includes('enchufe'))
    out.nada = (await servicio.recuperar({ accountId: 'A', consulta: 'hola buen día' })).recuerdos.length
    out.sinCuenta = [(await servicio.recuperar({ accountId: null, consulta: 'agua' })).recuerdos.length, (await servicio.recuperar({ accountId: '', consulta: 'agua' })).recuerdos.length, (await servicio.recuperar({ accountId: 'C', consulta: 'agua' })).recuerdos.length]
    // Whatever a store returned, a fragment of another account never goes on.
    const tramposo = { guardar: async () => 'guardado', deCuenta: async () => [], buscar: async () => [{ fragment: { ...indice.filas.find((f) => f.fragment.accountId === 'B').fragment }, score: 0.99 }] }
    out.defensa = (await new ServicioMemoriaSemantica(tramposo, temas, {}, waClock).recuperar({ accountId: 'A', consulta: 'agua' })).recuerdos.length
    // Failures: the provider is down.
    const caido = { ...temas, embed: async () => { throw new Error('caido') } }
    out.fallos = [(await new ServicioMemoriaSemantica(indice, caido, {}, waClock).recuperar({ accountId: 'A', consulta: 'agua' })).recuerdos.length, await new ServicioMemoriaSemantica(indice, caido, {}, waClock).recordar({ accountId: 'A', conversationId: 'c9', channel: 'web', mensajes: [mensaje(1, 'agua')] })]
    // An expired memory is not brought back.
    indice.filas.find((f) => f.fragment.conversationId === 'c4').fragment.expiresAt = new Date(waClock() - 1000).toISOString()
    out.vencido = (await servicio.recuperar({ accountId: 'A', consulta: 'la luz no anda' })).recuerdos.length
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.fragmentos, [true, true, 1, 9, true, true, true], 'several messages per fragment, cut at message boundaries, contiguous ranges; empty and unsaved messages are skipped')
  assert.deepEqual(r.guardar, [1, 0, 1, 1, 1, 1, 0], 'the same stretch is stored once; nothing is stored without an account')
  assert.deepEqual(r.agua, [2, true, false, 2, 0, true], 'top K = 2 of the account\'s own related memories')
  assert.deepEqual(r.luz, [true])
  assert.equal(r.nada, 0, 'nothing relevant: no memory')
  assert.deepEqual(r.sinCuenta, [0, 0, 0])
  assert.equal(r.defensa, 0, 'defence in depth: a foreign fragment is dropped even if a store returned it')
  assert.deepEqual(r.fallos, [0, 0], 'the memory failing never breaks the turn')
  assert.equal(r.vencido, 0)
})

test('MEMORIA fase 5 hechos: a closed list of facts with provenance — stored only when the person states a preference, updated without overwriting, forgotten on request, never for somebody without an account, never anything else', () => {
  const r = runTypeScriptScenario(`${MEMORIA_SETUP}
    const h = await import('./apps/api/src/tus/asistente/hechos.ts')
    const { ENCABEZADO_HECHOS } = await import('./apps/api/src/tus/asistente/contexto.ts')
    const out = {}
    const ahora = waClock()
    const detectar = (texto) => h.detectarHechos(texto, ahora).map((x) => [x.type, x.value])
    out.detecta = {
      horario: detectar('Yo siempre prefiero a la tarde'),
      zona: detectar('Vivo en el Centro'),
      contacto: detectar('Mejor escribime por WhatsApp'),
      llamada: detectar('prefiero que me llamen por teléfono'),
    }
    out.noDetecta = ['Necesito un plomero para mañana a la tarde', 'Busco electricista en el Centro', 'Mi DNI es 30111222', 'Mi contraseña es hunter2', 'Tengo tres hijos y un perro', 'Odio a mi vecino', 'hola', 'olvidá mi zona, vivo en el Centro'].map((t) => detectar(t).length)
    out.olvido = ['olvidá mi zona', 'ya no prefiero la tarde, borrá mi horario preferido', 'borrá mis preferencias', 'olvidate de mi contacto preferido por whatsapp', 'necesito un plomero', 'olvidé las llaves'].map((t) => { const x = h.detectarOlvido(t); return x === undefined ? 'nada' : x === null ? 'todo' : x })

    // Through the assistant, with its store.
    const almacen = new h.HechosEnMemoria()
    const mod = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, application: tusApp, knowledgeIndex, factStore: almacen, whatsapp: fakeWa, chat, embeddings, transcriptor: null, now: waClock, metric: (name, fields) => metrics.push({ name, ...fields }) })
    const decir = async (cuenta, text) => { const x = await mod.asistenteWeb.enviar({ identidad: cuenta ? { context: sesion(cuenta), visitorId: null } : { context: null, visitorId: VISITANTE }, text, correlationId: 'corr-hechos' }); waAdvance(6000); return x }
    const enContexto = () => chat.calls.filter((call) => call.messages[0].content !== PROMPT_ENRUTADOR).at(-1).messages.find((m) => String(m.content).startsWith(ENCABEZADO_HECHOS))?.content ?? null
    const primera = await decir('cuenta-a', 'Yo siempre prefiero a la tarde')
    out.guardado = almacen.filas.map((f) => [f.accountId, f.type, f.value, f.conversationId === primera.conversationId, f.sourceMessageId === primera.userMessage.id, f.channel, f.confidence, Boolean(f.expiresAt), f.invalidatedAt])
    out.mismoTurno = enContexto()
    await decir('cuenta-a', 'Vivo en el Centro')
    await decir('cuenta-a', 'Necesito un plomero')
    out.contexto = enContexto()
    // The same thing again changes nothing; a new value invalidates the old one and keeps it.
    await decir('cuenta-a', 'siempre prefiero a la tarde, ya te dije')
    const antes = almacen.filas.length
    await decir('cuenta-a', 'Ahora prefiero siempre a la noche')
    out.actualiza = [almacen.filas.length === antes + 1, almacen.filas.filter((f) => f.type === 'horario_preferido').map((f) => [f.value, f.invalidationReason]), (await almacen.activos('cuenta-a', new Date(waClock()).toISOString())).map((f) => f.type + '=' + f.value).sort()]
    // Other people.
    await decir('cuenta-b', 'hola, necesito un electricista')
    out.otraCuenta = enContexto()
    await decir(null, 'Vivo en el Centro y siempre prefiero a la tarde')
    out.anonimo = [enContexto(), almacen.filas.every((f) => f.accountId === 'cuenta-a')]
    // Nothing outside the closed list, however it is said.
    await decir('cuenta-a', 'Siempre pago con tarjeta 4509 9535 6623 3704 y mi clave es hunter2')
    out.fueraDeLista = [almacen.filas.every((f) => h.TIPOS_HECHO.includes(f.type)), JSON.stringify(almacen.filas).includes('hunter2') || JSON.stringify(almacen.filas).includes('4509')]
    // The person asks to forget.
    await decir('cuenta-a', 'olvidá mi zona')
    out.olvida = [(await almacen.activos('cuenta-a', new Date(waClock()).toISOString())).map((f) => f.type), almacen.filas.find((f) => f.type === 'zona_habitual').invalidationReason, enContexto()]
    // The service: invalidate, delete, history, expiry — always by account.
    const servicio = new h.ServicioHechos(almacen, waClock)
    out.ajeno = [await servicio.invalidar('cuenta-b', null, 'prueba'), await servicio.eliminar('cuenta-b', almacen.filas[0].factId), (await servicio.paraContexto('cuenta-b')).length, (await servicio.paraContexto(null)).length]
    out.historial = (await servicio.historial('cuenta-a')).length
    const activo = (await servicio.activos('cuenta-a'))[0]
    out.eliminar = [await servicio.eliminar('cuenta-a', activo.factId), (await servicio.activos('cuenta-a')).length]
    await servicio.registrar({ accountId: 'cuenta-a', conversationId: primera.conversationId, channel: 'web', messageId: null, text: 'Vivo en San Benito' })
    waAdvance(h.VIGENCIA_HECHO_MS + 1000)
    out.vencido = (await servicio.paraContexto('cuenta-a')).length
    out.metricas = [metrics.some((m) => m.name === 'assistant.facts' && m.stored > 0), metrics.some((m) => m.name === 'assistant.facts' && m.invalidated > 0), !JSON.stringify(metrics.filter((m) => m.name === 'assistant.facts')).includes('Centro')]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.detecta, { horario: [['horario_preferido', 'a la tarde']], zona: [['zona_habitual', 'Centro']], contacto: [['contacto_preferido', 'WhatsApp']], llamada: [['contacto_preferido', 'Llamada']] })
  assert.deepEqual(r.noDetecta, Array(8).fill(0), 'a one-off request, a document, a password or anything outside the list is not a fact')
  assert.deepEqual(r.olvido, ['zona_habitual', 'horario_preferido', 'todo', 'contacto_preferido', 'nada', 'nada'])
  assert.deepEqual(r.guardado, [['cuenta-a', 'horario_preferido', 'a la tarde', true, true, 'web', 0.8, true, null]], 'the fact keeps its account, conversation, source message, channel, confidence and expiry')
  assert.match(r.mismoTurno, /Horario preferido: a la tarde/u)
  assert.match(r.contexto, /Horario preferido: a la tarde/u)
  assert.match(r.contexto, /Zona habitual: Centro/u, 'the active facts of the account reach the context of later turns')
  assert.deepEqual(r.actualiza, [true, [['a la tarde', 'reemplazado'], ['a la noche', null]], ['horario_preferido=a la noche', 'zona_habitual=Centro']], 'a new value invalidates the old fact and keeps it; repeating the same one adds nothing')
  assert.equal(r.otraCuenta, null, 'another account has none of them')
  assert.deepEqual(r.anonimo, [null, true], 'no account: nothing stored, nothing used')
  assert.deepEqual(r.fueraDeLista, [true, false], 'only the closed list; never a card or a password')
  assert.deepEqual(r.olvida.slice(0, 2), [['horario_preferido'], 'pedido_del_titular'])
  assert.doesNotMatch(r.olvida[2] ?? '', /Zona habitual/u, 'a forgotten fact is not used again')
  assert.deepEqual(r.ajeno, [0, false, 0, 0], 'another account can neither invalidate, delete nor read them')
  assert.ok(r.historial >= 3, 'invalidated facts are kept as history')
  assert.deepEqual(r.eliminar, [true, 0])
  assert.equal(r.vencido, 0, 'an expired fact is not used')
  assert.deepEqual(r.metricas, [true, true, true])
})

test('MEMORIA fase 6 estado real: "¿ya aceptó?" and "¿a qué hora viene?" are resolved with the context and answered from the REAL turno of the account — never from a memory, never for another account, never without an account', () => {
  const r = runTypeScriptScenario(`${MEMORIA_SETUP}
    const e = await import('./apps/api/src/tus/asistente/estado-real.ts')
    const { horaLocal } = await import('./apps/api/src/tus/asistente/busqueda.ts')
    const out = {}
    out.detecta = ['¿Ya aceptó?', 'ya me aceptaron?', 'me respondió?', '¿A qué hora viene?', 'cuándo es mi turno', '¿cómo va mi turno?', 'qué pasó con lo del turno'].map(e.detectarConsultaOperativa)
    out.noDetecta = ['¿Cómo veo mis turnos?', 'Necesito un turno con un plomero', '¿A qué hora atiende Juan?', '¿Ya pagué?', '¿aceptó el presupuesto?', 'hola', '¿cuándo puedo pedir un turno?', 'Juan Pérez, 12345678'].map(e.detectarConsultaOperativa)

    // The real state: what TUS holds, per account. The test changes it like the provider would.
    const en = (horas) => new Date(waClock() + horas * 3600_000).toISOString()
    const REAL = { 'cuenta-a': [{ id: 't1', providerName: 'Juan Pérez', service: 'Plomería', startsAt: en(26), status: 'pending', statusLabel: 'Pendiente' }], 'cuenta-b': [] }
    const consultas = []
    let caido = false
    const dominioReal = new Proxy({ esPrestador: async () => false, misTurnos: async (context) => { consultas.push(context.subjectId); if (caido) throw new Error('caido'); return (REAL[context.subjectId] ?? []).map((t) => ({ ...t })) } }, { get: (target, prop) => target[prop] ?? (async () => []) })
    const mod = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, domain: dominioReal, knowledgeIndex, whatsapp: fakeWa, chat, embeddings, transcriptor: null, now: waClock, metric: (name, fields) => metrics.push({ name, ...fields }) })
    const decir = async (cuenta, text, visitante) => { const x = await mod.asistenteWeb.enviar({ identidad: cuenta ? { context: sesion(cuenta), visitorId: null } : { context: null, visitorId: visitante ?? VISITANTE }, text, correlationId: 'corr-real' }); waAdvance(6000); return x.messages[0] }
    const hora = horaLocal(REAL['cuenta-a'][0].startsAt)

    // What the conversation "remembers" is wrong on purpose: 16:00. The reservation says otherwise.
    await decir('cuenta-a', 'Pedí un turno con el plomero Juan y creo que era a las 16:00')
    const pendiente = await decir('cuenta-a', '¿Ya aceptó?')
    out.pendiente = [pendiente.text.startsWith('Todavía no respondió tu solicitud.'), pendiente.text.includes('de Plomería con Juan Pérez'), pendiente.text.includes('a las ' + hora), pendiente.text.includes('16:00')]
    // The provider accepts: the same question, the new REAL state.
    REAL['cuenta-a'][0].status = 'awaiting_payment'
    out.aceptado = (await decir('cuenta-a', '¿Ya aceptó?')).text.startsWith('Ya aceptó tu solicitud. Falta pagar la seña')
    REAL['cuenta-a'][0].status = 'confirmed'
    const horario = await decir('cuenta-a', '¿A qué hora viene?')
    out.horario = [horario.text, horario.text.includes('a las ' + hora) && !horario.text.includes('16:00')]
    REAL['cuenta-a'][0].status = 'rejected'
    out.rechazado = (await decir('cuenta-a', 'me respondió?')).text.startsWith('No pudo aceptar ese turno.')
    REAL['cuenta-a'][0].status = 'confirmed'
    out.modeloNoInterviene = chat.calls.filter((call) => call.messages.some((m) => /Ya aceptó|A qué hora viene/u.test(String(m.content)) && m.role === 'user')).length

    // Two turnos: without a hint the person is asked; talking about one of them resolves it.
    REAL['cuenta-c'] = [{ id: 't2', providerName: 'Juan Pérez', service: 'Plomería', startsAt: en(30), status: 'pending', statusLabel: 'Pendiente' }, { id: 't3', providerName: 'Laura Gómez', service: 'Electricidad', startsAt: en(50), status: 'confirmed', statusLabel: 'Confirmado' }]
    const ambiguo = await decir('cuenta-c', '¿Ya aceptó?')
    out.ambiguo = [ambiguo.text.startsWith('¿De cuál turno?'), ambiguo.text.includes('Juan Pérez') && ambiguo.text.includes('Laura Gómez')]
    await decir('cuenta-c', 'Te hablo del turno con Laura, la electricista')
    const resuelto = await decir('cuenta-c', '¿ya confirmó?')
    out.resuelto = [resuelto.text.includes('Laura Gómez'), resuelto.text.includes('Juan'), resuelto.text.startsWith('Ya está confirmado.')]

    // Other people.
    out.sinTurnos = (await decir('cuenta-b', '¿Ya aceptó?')).text
    const antes = consultas.length
    const anonimo = await decir(null, '¿Ya aceptó?', 'visitante-real-0123456789')
    out.anonimo = [anonimo.attachment?.kind ?? null, consultas.length === antes, /Juan|Plomería/u.test(anonimo.text)]
    out.soloPropios = consultas.every((id) => ['cuenta-a', 'cuenta-b', 'cuenta-c'].includes(id)) && !(await decir('cuenta-b', 'cuándo es mi turno')).text.includes('Juan')
    caido = true
    out.caido = (await decir('cuenta-a', '¿Ya aceptó?')).text
    caido = false

    // Pure choice: one live turno; hints by strength; the past is never "the turno".
    const T = (id, providerName, service, horas, status = 'pending') => ({ id, providerName, service, startsAt: en(horas), status, statusLabel: status })
    const elegir = (turnos, pistas = {}) => { const x = e.elegirTurnoReferido(turnos, { fuertes: [], recientes: [], memoria: [], ...pistas }, waClock()); return [x.elegido?.id ?? null, x.candidatos.length] }
    out.eleccion = [
      elegir([]), elegir([T('p', 'Ana', 'Masaje', -5)]), elegir([T('a', 'Ana', 'Masaje', 5)]),
      elegir([T('a', 'Ana Ruiz', 'Masaje', 5), T('b', 'Beto Díaz', 'Plomería', 9)]),
      elegir([T('a', 'Ana Ruiz', 'Masaje', 5), T('b', 'Beto Díaz', 'Plomería', 9)], { memoria: ['hablamos de la plomería de la cocina'] }),
      elegir([T('a', 'Ana Ruiz', 'Masaje', 5), T('b', 'Beto Díaz', 'Plomería', 9)], { memoria: ['plomería'], fuertes: ['Ana Ruiz'] }),
      elegir([T('a', 'Ana Ruiz', 'Masaje', 5, 'rejected'), T('b', 'Beto Díaz', 'Plomería', 9)]),
      elegir([T('a', 'Ana Ruiz', 'Masaje', 5), T('b', 'Beto Díaz', 'Plomería', 9)], { recientes: ['ana y beto'] }),
    ]
    out.metricas = [metrics.some((m) => m.name === 'assistant.real_state' && m.outcome === 'resolved'), metrics.some((m) => m.name === 'assistant.real_state' && m.outcome === 'ambiguous'), !JSON.stringify(metrics.filter((m) => m.name === 'assistant.real_state')).includes('Juan')]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.detecta, ['aceptacion', 'aceptacion', 'aceptacion', 'horario', 'horario', 'estado', 'estado'])
  assert.deepEqual(r.noDetecta, Array(8).fill(null), 'help, a new request, the availability of a professional, payments and budgets are other things')
  assert.deepEqual(r.pendiente, [true, true, true, false], 'the state and the time come from the reservation; the "16:00" of the conversation is never repeated')
  assert.equal(r.aceptado, true, 'the same question after the provider accepted: the new real state')
  assert.equal(r.horario[1], true, `the real time: ${r.horario[0]}`)
  assert.equal(r.rechazado, true)
  assert.equal(r.modeloNoInterviene, 0, 'no model writes an operational state')
  assert.deepEqual(r.ambiguo, [true, true], 'several turnos and no hint: the person is asked which')
  assert.deepEqual(r.resuelto, [true, false, true], 'the conversation says which turno; TUS says its state')
  assert.equal(r.sinTurnos, 'No encontré turnos tuyos pendientes ni próximos.')
  assert.deepEqual(r.anonimo, ['sign_in', true, false], 'no account: the person is asked to sign in and nothing is read')
  assert.equal(r.soloPropios, true, 'each account only ever gets its own turnos')
  assert.equal(r.caido, 'No pude consultar tus turnos en este momento. Probá de nuevo en unos minutos.', 'when TUS cannot be read nothing is invented')
  assert.deepEqual(r.eleccion, [[null, 0], [null, 0], ['a', 1], [null, 2], ['b', 2], ['a', 2], ['b', 1], [null, 2]], 'one live turno is the one; otherwise the strongest hint that points at exactly one; a tie is ambiguous')
  assert.deepEqual(r.metricas, [true, true, true])
})
