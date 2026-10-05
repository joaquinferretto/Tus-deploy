import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// MEMORIA-01 on a DISPOSABLE PostgreSQL 16 with every migration applied (TUS_TELEFONO_PG_URL, or
// TUS_IDENTITY_PG_URL / TUS_DIRECTORIO_PG_URL). Never a shared or production database.
const url = process.env.TUS_TELEFONO_PG_URL ?? process.env.TUS_IDENTITY_PG_URL ?? process.env.TUS_DIRECTORIO_PG_URL
const skip = !url && 'TUS_TELEFONO_PG_URL not set (disposable PostgreSQL 16 only)'

export const MEMORIA_PG_SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const { TransaccionAsistentePrisma } = await import('./apps/api/src/tus/adapters/prisma-asistente.ts')
  const { HistorialConversacional } = await import('./apps/api/src/tus/asistente/historial.ts')
  const { claveContactoWeb } = await import('./apps/api/src/tus/asistente/modelo.ts')
  const tx = new TransaccionAsistentePrisma(prisma)
  const historial = new HistorialConversacional(tx)
  const run = 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const codigo = async (operacion) => { try { await operacion(); return 'ok' } catch (error) { return error?.code ?? String(error?.message ?? error).slice(0, 80) } }
  let serie = 0
  // A contact with one active conversation. cuenta + canal 'web': the account's Web contact;
  // cuenta + canal 'whatsapp': a linked WhatsApp; no cuenta: nobody's.
  async function conversacion({ canal = 'web', cuenta = null } = {}) {
    serie += 1
    const ahora = new Date().toISOString()
    const contactId = run + '-contacto-' + serie; const conversationId = run + '-conversacion-' + serie
    const waId = canal === 'web' ? (cuenta ? claveContactoWeb({ accountId: cuenta }) : claveContactoWeb({ anonymousId: run + '-anon-' + serie })) : '549379' + String(Date.now()).slice(-6) + String(serie).padStart(2, '0')
    await tx.ejecutar(async (repos) => {
      await repos.contactos.crear({ contactId, channel: canal, waId, displayName: null, linkedAccountId: canal === 'whatsapp' ? cuenta : null, linkedTenantId: canal === 'whatsapp' && cuenta ? 'tenant-' + cuenta : null, linkedAt: canal === 'whatsapp' && cuenta ? ahora : null, blockedUntil: null, blockedReason: null, createdAt: ahora, lastInboundAt: null, version: 1 })
      await repos.conversaciones.crear({ conversationId, contactId, channel: canal, status: 'active', mode: 'bot', handoffReason: null, handoffAt: null, operatorId: null, openedAt: ahora, lastMessageAt: ahora, lastInboundAt: null, unreadCount: 0, summary: null, summaryMessageCount: 0, state: {}, version: 1 })
    })
    return { contactId, conversationId }
  }
  let mensajes = 0
  const mensaje = (c, text, extra = {}) => { mensajes += 1; return { messageId: run + '-mensaje-' + mensajes, conversationId: c.conversationId, contactId: c.contactId, wamid: null, direction: mensajes % 2 ? 'inbound' : 'outbound', type: 'text', text, status: 'processed', statusAt: null, externalTimestamp: null, replyToWamid: null, actor: mensajes % 2 ? 'contact' : 'assistant', metadata: {}, correlationId: 'corr', createdAt: new Date().toISOString(), ...extra } }
  const guardar = (c, text, extra) => tx.ejecutar((repos) => repos.mensajes.crear(mensaje(c, text, extra)))
`

test('MEMORIA fase 1 PostgreSQL: the sequence is assigned by the database, unique under concurrency and never changed by an update; pages are stable; an account only reads its own conversations', { skip, timeout: 180000 }, () => {
  const r = runTypeScriptScenario(`${MEMORIA_PG_SETUP}
    const out = {}
    try {
      const A = run + '-cuenta-a'; const B = run + '-cuenta-b'
      const webA = await conversacion({ cuenta: A }); const waA = await conversacion({ canal: 'whatsapp', cuenta: A })
      const webB = await conversacion({ cuenta: B }); const anonimo = await conversacion(); const waSuelto = await conversacion({ canal: 'whatsapp' })
      for (let i = 1; i <= 7; i += 1) await guardar(webA, 'A web ' + i)
      // Thirty messages written at once, on several conversations.
      await Promise.all(Array.from({ length: 30 }, (_, i) => guardar([webA, waA, webB, anonimo, waSuelto][i % 5], 'concurrente ' + i)))
      const filas = await prisma.mensajeConversacionWhatsapp.findMany({ where: { id: { startsWith: run } }, select: { id: true, secuencia: true, conversacionId: true } })
      out.secuencias = [filas.length, new Set(filas.map((f) => String(f.secuencia))).size, filas.every((f) => f.secuencia > 0n)]
      // The column: NOT NULL, a default from the sequence, unique, indexed with the conversation.
      const columna = await prisma.$queryRawUnsafe("SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'mensajes_conversacion_whatsapp' AND column_name = 'secuencia'")
      const indices = await prisma.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE tablename = 'mensajes_conversacion_whatsapp' AND indexname LIKE '%secuencia%' ORDER BY indexname")
      out.columna = [columna[0].is_nullable, /nextval/u.test(columna[0].column_default), indices.map((i) => i.indexname)]
      out.sinSecuencia = await codigo(() => prisma.$executeRawUnsafe('UPDATE public."mensajes_conversacion_whatsapp" SET "secuencia" = NULL WHERE "id" = $1', filas[0].id)).then((c) => c !== 'ok')
      out.repetida = await codigo(() => prisma.$executeRawUnsafe('UPDATE public."mensajes_conversacion_whatsapp" SET "secuencia" = $1 WHERE "id" = $2', filas[1].secuencia, filas[0].id)).then((c) => c !== 'ok')
      // Updating a message (a status change) keeps its place.
      const primero = (await historial.mensajes({ accountId: A, conversationId: webA.conversationId, limit: 200 })).messages[0]
      await tx.ejecutar((repos) => repos.mensajes.actualizar({ ...primero, status: 'processed', text: primero.text }))
      const despues = (await historial.mensajes({ accountId: A, conversationId: webA.conversationId, limit: 200 })).messages
      out.estable = [despues[0].messageId === primero.messageId, despues[0].sequence === primero.sequence, despues.slice(0, 7).map((m) => m.text), despues.every((m, i) => i === 0 || m.sequence > despues[i - 1].sequence)]
      // Pages of 5 walk the whole conversation once, in order.
      const recorridas = []
      for (let antes = null, vueltas = 0; vueltas < 10; vueltas += 1) {
        const pagina = await historial.mensajes({ accountId: A, conversationId: webA.conversationId, limit: 5, before: antes })
        recorridas.unshift(...pagina.messages.map((m) => m.sequence))
        if (pagina.nextBefore === null) break
        antes = pagina.nextBefore
      }
      out.paginas = JSON.stringify(recorridas) === JSON.stringify(despues.map((m) => m.sequence))
      // Isolation.
      out.conversaciones = [(await historial.conversaciones(A)).map((c) => c.channel).sort(), (await historial.conversaciones(B)).length, (await historial.conversaciones(run + '-nadie')).length]
      out.ajenas = [
        await codigo(() => historial.mensajes({ accountId: A, conversationId: webB.conversationId })),
        await codigo(() => historial.mensajes({ accountId: B, conversationId: waA.conversationId })),
        await codigo(() => historial.mensajes({ accountId: A, conversationId: anonimo.conversationId })),
        await codigo(() => historial.mensajes({ accountId: A, conversationId: waSuelto.conversationId })),
        await codigo(() => historial.mensajes({ accountId: '', conversationId: webA.conversationId })),
      ]
      // The idempotency key of a Web message is unique in the table.
      await guardar(webA, 'con clave', { wamid: 'web:' + webA.contactId + ':clave-0001' })
      out.claveRepetida = await codigo(() => guardar(webA, 'con clave otra vez', { wamid: 'web:' + webA.contactId + ':clave-0001' }))
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.secuencias, [37, 37, true], 'one sequence per message, unique also when written at once')
  assert.deepEqual(r.columna, ['NO', true, ['ix_mensajes_conversacion_whatsapp_secuencia', 'uq_mensajes_conversacion_whatsapp_secuencia']])
  assert.equal(r.sinSecuencia, true, 'the database refuses a message without a sequence')
  assert.equal(r.repetida, true, 'the database refuses a repeated sequence')
  assert.deepEqual(r.estable.slice(0, 2), [true, true], 'an update never moves a message')
  assert.deepEqual(r.estable[2], [1, 2, 3, 4, 5, 6, 7].map((n) => 'A web ' + n))
  assert.equal(r.estable[3], true)
  assert.equal(r.paginas, true, 'pages cover the conversation exactly once, in order')
  assert.deepEqual(r.conversaciones, [['web', 'whatsapp'], 1, 0])
  assert.deepEqual(r.ajenas, Array(5).fill('NOT_FOUND'))
  assert.equal(r.claveRepetida, 'P2002')
})
