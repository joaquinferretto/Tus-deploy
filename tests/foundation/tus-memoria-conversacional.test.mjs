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
