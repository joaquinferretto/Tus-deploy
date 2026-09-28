import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// The support inbox reads contacts and last messages of a whole page in two batch queries: never a
// contact lookup or a message query per conversation (N+1).
test('WhatsApp support inbox on Prisma reads contacts and last messages in batch', () => {
  const result = runTypeScriptScenario(`
    const { TransaccionAsistentePrisma } = await import('./apps/api/src/tus/adapters/prisma-asistente.ts')
    const { ServicioSoporteWhatsapp } = await import('./apps/api/src/tus/asistente/soporte.ts')
    const calls = { contactsMany: 0, raw: 0, rawIds: null }
    const perRow = () => { throw new Error('per-conversation query') }
    const at = (minute) => new Date('2026-09-28T10:' + String(minute).padStart(2, '0') + ':00.000Z')
    const conversation = (id, contactId, minute) => ({ id, contactoId: contactId, estado: 'active', modo: 'human', motivoDerivacion: null, derivadaEn: null, operadorId: null, abiertaEn: at(0), ultimoMensajeEn: at(minute), ultimoEntranteEn: at(minute), noLeidos: 1, resumen: null, mensajesResumidos: 0, estadoConversacional: {}, version: 1 })
    const contact = (id, waId) => ({ id, waId, nombrePerfil: 'Contacto ' + id, cuentaVinculadaId: null, tenantVinculadoId: null, vinculadoEn: null, bloqueadoHasta: null, motivoBloqueo: null, fechaCreacion: at(0), ultimoEntranteEn: at(1), version: 1 })
    const message = (id, conversationId, text) => ({ id, conversacionId: conversationId, contactoId: 'x', wamid: null, direccion: 'inbound', tipo: 'text', texto: text, estado: 'received', estadoEn: null, fechaExterna: null, respondeAWamid: null, actor: 'contact', metadata: {}, correlacionId: 'c', fechaCreacion: at(5) })
    const client = {
      conversacionWhatsapp: { findMany: async () => [conversation('conv-1', 'contact-1', 9), conversation('conv-2', 'contact-2', 8), conversation('conv-3', 'contact-1', 7)], findFirst: perRow, count: async () => 3 },
      contactoWhatsapp: { findMany: async ({ where }) => { calls.contactsMany += 1; calls.contactIds = where.id.in; return [contact('contact-1', '5493794111111'), contact('contact-2', '5493794222222')] }, findFirst: perRow },
      mensajeConversacionWhatsapp: { findMany: perRow, findFirst: perRow },
      $queryRawUnsafe: async (sql, ids) => { calls.raw += 1; calls.rawIds = ids; calls.distinctOn = sql.includes('DISTINCT ON'); return [message('m-1', 'conv-1', 'hola'), message('m-2', 'conv-2', 'se rompió el caño')] },
    }
    client.$transaction = async (callback) => callback(client)
    const soporte = new ServicioSoporteWhatsapp(new TransaccionAsistentePrisma(client), null, null, () => Date.parse('2026-09-28T11:00:00.000Z'))
    const page = await soporte.pagina({ pagina: 1, tamano: 25 })
    console.log(JSON.stringify({ calls, total: page.total, items: page.items.map((item) => ({ id: item.conversationId, name: item.contact.displayName, preview: item.lastMessage?.preview ?? null })) }))
  `)
  assert.equal(result.calls.contactsMany, 1, 'one batch read of contacts')
  assert.deepEqual(result.calls.contactIds, ['contact-1', 'contact-2'], 'repeated contacts are read once')
  assert.equal(result.calls.raw, 1, 'one batch read of last messages')
  assert.equal(result.calls.distinctOn, true)
  assert.deepEqual(result.calls.rawIds, ['conv-1', 'conv-2', 'conv-3'])
  assert.equal(result.total, 3)
  assert.deepEqual(result.items, [
    { id: 'conv-1', name: 'Contacto contact-1', preview: 'hola' },
    { id: 'conv-2', name: 'Contacto contact-2', preview: 'se rompió el caño' },
    { id: 'conv-3', name: 'Contacto contact-1', preview: null },
  ])
})

test('in-memory last message per conversation matches ultimos(id, 1) and skips rate-limited messages', () => {
  const result = runTypeScriptScenario(`
    const { AlmacenAsistenteEnMemoria } = await import('./apps/api/src/tus/asistente/memoria.ts')
    const store = new AlmacenAsistenteEnMemoria()
    const repos = store.repositorios()
    const message = (id, conversationId, minute, status, text) => ({ messageId: id, conversationId, contactId: 'k', wamid: null, direction: 'inbound', type: 'text', text, status, statusAt: null, externalTimestamp: null, replyToWamid: null, actor: 'contact', metadata: {}, correlationId: 'c', createdAt: '2026-09-28T10:0' + minute + ':00.000Z' })
    await repos.mensajes.crear(message('a1', 'conv-a', 1, 'received', 'primero'))
    await repos.mensajes.crear(message('a2', 'conv-a', 2, 'received', 'último'))
    await repos.mensajes.crear(message('a3', 'conv-a', 3, 'rate_limited', 'limitado'))
    await repos.mensajes.crear(message('b1', 'conv-b', 1, 'received', 'solo'))
    const batch = await repos.mensajes.ultimoDeConversaciones(['conv-a', 'conv-b', 'conv-empty'])
    const single = [(await repos.mensajes.ultimos('conv-a', 1))[0]?.messageId, (await repos.mensajes.ultimos('conv-b', 1))[0]?.messageId]
    console.log(JSON.stringify({ batch: batch.map((m) => m.messageId), single }))
  `)
  assert.deepEqual(result.batch, ['a2', 'b1'])
  assert.deepEqual(result.batch, result.single)
})
