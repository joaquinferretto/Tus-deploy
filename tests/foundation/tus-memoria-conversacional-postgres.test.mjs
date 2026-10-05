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

test('MEMORIA fase 3 PostgreSQL: summary versions are added, never overwritten; two workers on the same step store exactly one; the database refuses an impossible range; the messages are untouched', { skip, timeout: 180000 }, () => {
  const r = runTypeScriptScenario(`${MEMORIA_PG_SETUP}
    const out = {}
    try {
      const c = await conversacion({ cuenta: run + '-cuenta-r' })
      for (let i = 1; i <= 10; i += 1) await guardar(c, 'mensaje ' + i)
      const todos = await tx.ejecutar((repos) => repos.mensajes.posteriores(c.conversationId, { after: 0, limit: 100 }))
      out.posteriores = [todos.length, todos.every((m, i) => i === 0 || m.sequence > todos[i - 1].sequence), (await tx.ejecutar((repos) => repos.mensajes.posteriores(c.conversationId, { after: todos[5].sequence, limit: 100 }))).map((m) => m.text)]
      const resumen = (version, desde, hasta, extra = {}) => ({ summaryId: run + '-resumen-' + version + '-' + Math.random().toString(36).slice(2, 8), conversationId: c.conversationId, version, fromSequence: desde, throughSequence: hasta, messageCount: 3, text: 'resumen v' + version, model: 'modelo-prueba', createdAt: new Date().toISOString(), ...extra })
      out.vacio = await tx.ejecutar((repos) => repos.resumenes.vigente(c.conversationId))
      await tx.ejecutar((repos) => repos.resumenes.crear(resumen(1, todos[0].sequence, todos[2].sequence)))
      // Two workers summarizing the same step at once: one row.
      const carrera = await Promise.all([1, 2, 3].map(() => tx.ejecutar((repos) => repos.resumenes.crear(resumen(2, todos[3].sequence, todos[5].sequence))).then(() => 'ok', (e) => e.code)))
      out.carrera = [...carrera].sort()
      const lista = await tx.ejecutar((repos) => repos.resumenes.listar(c.conversationId))
      const vigente = await tx.ejecutar((repos) => repos.resumenes.vigente(c.conversationId))
      out.versiones = [lista.map((v) => [v.version, v.fromSequence === todos[v.version === 1 ? 0 : 3].sequence, v.throughSequence === todos[v.version === 1 ? 2 : 5].sequence, v.text, v.model]), vigente.version, typeof vigente.throughSequence]
      // The database holds the invariants whatever code writes.
      out.checks = [
        await codigo(() => tx.ejecutar((repos) => repos.resumenes.crear(resumen(3, todos[6].sequence, todos[5].sequence)))),
        await codigo(() => tx.ejecutar((repos) => repos.resumenes.crear(resumen(0, todos[6].sequence, todos[7].sequence)))),
        await codigo(() => tx.ejecutar((repos) => repos.resumenes.crear(resumen(3, todos[6].sequence, todos[7].sequence, { text: '' })))),
        await codigo(() => tx.ejecutar((repos) => repos.resumenes.crear(resumen(3, todos[6].sequence, todos[7].sequence, { conversationId: run + '-no-existe' })))),
      ].map((x) => x !== 'ok')
      // A conversation with summaries cannot be deleted from under them (no orphan rows).
      out.restrict = await prisma.conversacionWhatsapp.delete({ where: { id: c.conversationId } }).then(() => 'ok', (e) => e.code ?? 'error')
      out.mensajesIntactos = (await tx.ejecutar((repos) => repos.mensajes.posteriores(c.conversationId, { after: 0, limit: 100 }))).map((m) => m.text).join('|') === todos.map((m) => m.text).join('|')
      // Another conversation has its own versions.
      const otra = await conversacion({ cuenta: run + '-cuenta-s' })
      out.otra = [await tx.ejecutar((repos) => repos.resumenes.vigente(otra.conversationId)), (await tx.ejecutar((repos) => repos.resumenes.listar(otra.conversationId))).length]
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.posteriores, [10, true, ['mensaje 7', 'mensaje 8', 'mensaje 9', 'mensaje 10']], 'what a summary has not covered yet, in order')
  assert.equal(r.vacio, null)
  assert.deepEqual(r.carrera, ['P2002', 'P2002', 'ok'], 'exactly one of three simultaneous writers of version 2')
  assert.deepEqual(r.versiones, [[[1, true, true, 'resumen v1', 'modelo-prueba'], [2, true, true, 'resumen v2', 'modelo-prueba']], 2, 'number'], 'both versions are kept; the newest is the current one')
  assert.deepEqual(r.checks, [true, true, true, true], 'an inverted range, version 0, an empty text and an unknown conversation are refused')
  assert.notEqual(r.restrict, 'ok', 'the conversation cannot disappear from under its summaries')
  assert.equal(r.mensajesIntactos, true)
  assert.deepEqual(r.otra, [null, 0])
})

test('MEMORIA fase 4 PostgreSQL: fragments and their vectors (pgvector, the existing RagEmbedding) are written together; the search is restricted to the account in SQL, before the similarity; an expired or foreign fragment never comes back', { skip, timeout: 180000 }, () => {
  const r = runTypeScriptScenario(`${MEMORIA_PG_SETUP}
    const { IndiceMemoriaPrisma } = await import('./apps/api/src/tus/adapters/prisma-asistente.ts')
    const { ServicioMemoriaSemantica } = await import('./apps/api/src/tus/asistente/memoria-semantica.ts')
    const { DIMENSION_EMBEDDINGS } = await import('./apps/api/src/tus/asistente/conocimiento.ts')
    const out = {}
    try {
      const indice = new IndiceMemoriaPrisma(prisma)
      // A unit vector on one axis per topic (1024 dimensions, like the column).
      const eje = (n, mezcla = 0) => { const v = new Array(DIMENSION_EMBEDDINGS).fill(0); v[n] = 1; if (mezcla) v[mezcla] = 0.4; return v }
      const A = run + '-cuenta-a'; const B = run + '-cuenta-b'
      const cA = await conversacion({ cuenta: A }); const cB = await conversacion({ cuenta: B })
      let n = 0
      const fragmento = (cuenta, c, desde, hasta, text, extra = {}) => ({ fragmentId: run + '-fragmento-' + (n += 1), accountId: cuenta, conversationId: c.conversationId, channel: 'web', fromSequence: desde, throughSequence: hasta, text, checksum: 'c'.repeat(64), createdAt: new Date().toISOString(), expiresAt: null, ...extra })
      const E = { model: 'modelo-prueba', version: 'prueba-v1' }
      out.guardar = [
        await indice.guardar(fragmento(A, cA, 1, 4, 'A: pérdida de agua'), eje(1), E),
        await indice.guardar(fragmento(A, cA, 1, 4, 'A: repetido'), eje(1), E),
        await indice.guardar(fragmento(A, cA, 5, 8, 'A: enchufe quemado'), eje(2), E),
        await indice.guardar(fragmento(A, cA, 9, 12, 'A: vencido sobre agua', { expiresAt: new Date(Date.now() - 60000).toISOString() }), eje(1, 3), E),
        await indice.guardar(fragmento(B, cB, 1, 4, 'B: agua, secreto de B'), eje(1), E),
      ]
      const buscar = (cuenta, vector, limit = 5) => indice.buscar({ accountId: cuenta, vector, embeddingVersion: E.version, limit, now: new Date().toISOString() })
      const deA = await buscar(A, eje(1))
      out.deA = deA.map((x) => [x.fragment.text, Math.round(x.score * 100) / 100, x.fragment.accountId === A, x.fragment.conversationId === cA.conversationId, x.fragment.fromSequence, x.fragment.throughSequence])
      out.deB = (await buscar(B, eje(1))).map((x) => x.fragment.text)
      out.nadie = [(await buscar(run + '-otra', eje(1))).length, (await buscar('', eje(1))).length]
      out.topK = (await buscar(A, eje(1), 1)).length
      out.otraVersion = (await indice.buscar({ accountId: A, vector: eje(1), embeddingVersion: 'otra-version', limit: 5, now: new Date().toISOString() })).length
      // Both rows or none: a vector of the wrong size stores nothing.
      out.dimension = await codigo(() => indice.guardar(fragmento(A, cA, 20, 21, 'A: vector corto'), [1, 0, 0], E)).then((c) => c !== 'ok')
      const filas = await prisma.$queryRawUnsafe('SELECT (SELECT count(*)::int FROM public."fragmentos_memoria" WHERE "cuenta_id" = $1) AS fragmentos, (SELECT count(*)::int FROM public."RagEmbedding" WHERE "tenantId" = $2 AND "workspaceId" = $1) AS vectores', A, 'tus-memoria')
      out.filas = [filas[0].fragmentos, filas[0].vectores]
      out.deCuenta = [(await indice.deCuenta(A)).length, (await indice.deCuenta(B)).map((f) => f.text)]
      // The database holds the invariants.
      out.checks = [
        await codigo(() => prisma.$executeRawUnsafe('INSERT INTO public."fragmentos_memoria" ("id","cuenta_id","conversacion_id","canal","desde_secuencia","hasta_secuencia","texto","checksum","fecha_creacion") VALUES ($1,$2,$3,$4,5,1,$5,$6,now())', run + '-x1', A, cA.conversationId, 'web', 'x', 'c')),
        await codigo(() => prisma.$executeRawUnsafe('INSERT INTO public."fragmentos_memoria" ("id","cuenta_id","conversacion_id","canal","desde_secuencia","hasta_secuencia","texto","checksum","fecha_creacion") VALUES ($1,$2,$3,$4,30,31,$5,$6,now())', run + '-x2', '', cA.conversationId, 'web', 'x', 'c')),
        await codigo(() => prisma.$executeRawUnsafe('INSERT INTO public."fragmentos_memoria" ("id","cuenta_id","conversacion_id","canal","desde_secuencia","hasta_secuencia","texto","checksum","fecha_creacion") VALUES ($1,$2,$3,$4,30,31,$5,$6,now())', run + '-x3', A, cA.conversationId, 'sms', 'x', 'c')),
        await codigo(() => prisma.$executeRawUnsafe('INSERT INTO public."fragmentos_memoria" ("id","cuenta_id","conversacion_id","canal","desde_secuencia","hasta_secuencia","texto","checksum","fecha_creacion") VALUES ($1,$2,$3,$4,30,31,$5,$6,now())', run + '-x4', A, run + '-no-existe', 'web', 'x', 'c')),
      ].map((c) => c !== 'ok')
      const indices = await prisma.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE indexname IN ('ix_rag_embedding_tenant_workspace', 'ix_fragmentos_memoria_cuenta', 'uq_fragmentos_memoria_rango') ORDER BY 1")
      out.indices = indices.map((i) => i.indexname)
      // The knowledge base is untouched: its tenant has no memory vectors and memory has none of its own.
      out.conocimiento = (await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM public."RagEmbedding" WHERE "tenantId" = $1 AND "workspaceId" IN ($2, $3)', 'tus-platform', A, B))[0].n
      // End to end with the service (threshold + own account only).
      const proveedor = { id: 'p', model: E.model, version: E.version, dimensions: DIMENSION_EMBEDDINGS, embed: async (texts) => texts.map((t) => (/agua/u.test(t) ? eje(1) : /enchufe/u.test(t) ? eje(2) : eje(9))) }
      const servicio = new ServicioMemoriaSemantica(indice, proveedor, { topK: 3, minScore: 0.5 })
      out.servicio = [(await servicio.recuperar({ accountId: A, consulta: 'otra vez agua' })).recuerdos.map((x) => x.replace(/^\\[[^\\]]+\\] /u, '')), (await servicio.recuperar({ accountId: B, consulta: 'otra vez agua' })).recuerdos.length, (await servicio.recuperar({ accountId: A, consulta: 'el jardín' })).recuerdos.length, (await servicio.recuperar({ accountId: null, consulta: 'agua' })).recuerdos.length]
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.guardar, ['guardado', 'existente', 'guardado', 'guardado', 'guardado'], 'the same stretch of a conversation is stored once')
  assert.deepEqual(r.deA, [['A: pérdida de agua', 1, true, true, 1, 4], ['A: enchufe quemado', 0, true, true, 5, 8]], 'only fragments of that account, best first, with their origin; the expired one is not returned')
  assert.deepEqual(r.deB, ['B: agua, secreto de B'], 'the other account only sees its own')
  assert.deepEqual(r.nadie, [0, 0], 'an unknown or empty account gets nothing')
  assert.equal(r.topK, 1)
  assert.equal(r.otraVersion, 0, 'vectors of another embeddings version are never compared')
  assert.equal(r.dimension, true)
  assert.deepEqual(r.filas, [3, 3], 'a fragment and its vector exist together: the refused one left neither')
  assert.deepEqual(r.deCuenta, [3, ['B: agua, secreto de B']])
  assert.deepEqual(r.checks, [true, true, true, true], 'an inverted range, an empty account, an unknown channel and an unknown conversation are refused')
  assert.deepEqual(r.indices, ['ix_fragmentos_memoria_cuenta', 'ix_rag_embedding_tenant_workspace', 'uq_fragmentos_memoria_rango'])
  assert.equal(r.conocimiento, 0)
  assert.deepEqual(r.servicio, [['A: pérdida de agua'], 1, 0, 0], 'threshold applied; B gets only its own fragment; no account, no memory')
})

test('MEMORIA fase 5 PostgreSQL: one active fact per type and account, also under a race; a new value invalidates and keeps the old one; the database refuses a type outside the list; another account cannot touch them', { skip, timeout: 180000 }, () => {
  const r = runTypeScriptScenario(`${MEMORIA_PG_SETUP}
    const { HechosPrisma } = await import('./apps/api/src/tus/adapters/prisma-asistente.ts')
    const { ServicioHechos } = await import('./apps/api/src/tus/asistente/hechos.ts')
    const out = {}
    try {
      const almacen = new HechosPrisma(prisma)
      const servicio = new ServicioHechos(almacen)
      const A = run + '-cuenta-a'; const B = run + '-cuenta-b'
      const c = await conversacion({ cuenta: A })
      const decir = (cuenta, text) => servicio.registrar({ accountId: cuenta, conversationId: c.conversationId, channel: 'web', messageId: run + '-m', text })
      out.guardar = [await decir(A, 'Vivo en el Centro'), await decir(A, 'vivo en el Centro'), await decir(A, 'Siempre prefiero a la tarde'), await decir(B, 'Vivo en San Benito')]
      out.activos = (await servicio.activos(A)).map((h) => [h.type, h.value, h.conversationId === c.conversationId, h.sourceMessageId === run + '-m', h.channel, h.confidence, Boolean(h.expiresAt)])
      out.contexto = [await servicio.paraContexto(A), await servicio.paraContexto(B), await servicio.paraContexto(run + '-nadie')]
      // A new value: the old row stays, invalidated.
      await decir(A, 'Ahora vivo en San Benito')
      out.reemplazo = (await servicio.historial(A)).filter((h) => h.type === 'zona_habitual').map((h) => [h.value, h.invalidationReason])
      // Five writers of the same type at once: exactly one active row afterwards.
      const hecho = (valor) => ({ factId: run + '-hecho-' + Math.random().toString(36).slice(2, 10), accountId: A, type: 'contacto_preferido', value: valor, conversationId: c.conversationId, sourceMessageId: null, channel: 'web', confidence: 0.8, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: null, invalidatedAt: null, invalidationReason: null })
      const carrera = await Promise.all(['WhatsApp', 'Llamada', 'Web', 'WhatsApp', 'Llamada'].map((v) => almacen.guardar(hecho(v)).then((x) => x, (e) => 'error:' + String(e?.code ?? e?.message).slice(0, 60))))
      const filas = await prisma.$queryRawUnsafe('SELECT count(*) FILTER (WHERE "invalidado_en" IS NULL)::int AS activos, count(*)::int AS total FROM public."hechos_memoria" WHERE "cuenta_id" = $1 AND "tipo" = $2', A, 'contacto_preferido')
      out.carrera = [carrera.some((x) => String(x).startsWith('error')), filas[0].activos, filas[0].total >= 1]
      // The database itself.
      const insertar = (tipo, cuenta, extra = '') => codigo(() => prisma.$executeRawUnsafe('INSERT INTO public."hechos_memoria" ("id","cuenta_id","tipo","valor","canal","fecha_creacion","fecha_actualizacion"' + (extra ? ',"invalidado_en"' : '') + ') VALUES ($1,$2,$3,$4,$5,now(),now()' + (extra ? ',now()' : '') + ')', run + '-x-' + Math.random().toString(36).slice(2, 8), cuenta, tipo, 'valor', 'web'))
      out.checks = [await insertar('numero_de_tarjeta', A), await insertar('zona_habitual', ''), await insertar('zona_habitual', A), await insertar('zona_habitual', run + '-otra', 'invalidada-sin-motivo')].map((x) => x !== 'ok')
      // Another account.
      const propio = (await servicio.activos(A))[0]
      out.ajeno = [await servicio.invalidar(B, 'horario_preferido', 'prueba'), await servicio.eliminar(B, propio.factId), (await servicio.activos(A)).length >= 3]
      out.olvidar = [await decir(A, 'olvidá mi zona'), (await servicio.activos(A)).map((h) => h.type).sort()]
      out.eliminar = [await servicio.eliminar(A, propio.factId), (await servicio.historial(A)).some((h) => h.factId === propio.factId)]
      // Deleting the conversation of origin (later phases) does not delete the fact: it loses the link.
      out.fk = (await prisma.$queryRawUnsafe("SELECT confdeltype FROM pg_constraint WHERE conname = 'fk_hechos_memoria_conversacion'"))[0].confdeltype
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.guardar, [{ guardados: 1, invalidados: 0 }, { guardados: 0, invalidados: 0 }, { guardados: 1, invalidados: 0 }, { guardados: 1, invalidados: 0 }])
  assert.deepEqual(r.activos, [['horario_preferido', 'a la tarde', true, true, 'web', 0.8, true], ['zona_habitual', 'Centro', true, true, 'web', 0.9, true]])
  assert.deepEqual(r.contexto, [['Horario preferido: a la tarde', 'Zona habitual: Centro'], ['Zona habitual: San Benito'], []])
  assert.deepEqual(r.reemplazo, [['Centro', 'reemplazado'], ['San Benito', null]], 'the old value is kept, invalidated')
  assert.deepEqual(r.carrera, [false, 1, true], 'five simultaneous writers: no error and exactly one active fact')
  assert.deepEqual(r.checks, [true, true, true, true], 'a type outside the list, an empty account, a second active fact of a type and an invalidation without reason are refused')
  assert.deepEqual(r.ajeno, [0, false, true], 'another account can neither invalidate nor delete them')
  assert.deepEqual(r.olvidar, [{ guardados: 0, invalidados: 1 }, ['contacto_preferido', 'horario_preferido']])
  assert.deepEqual(r.eliminar, [true, false])
  assert.equal(r.fk, 'n', 'ON DELETE SET NULL')
})
