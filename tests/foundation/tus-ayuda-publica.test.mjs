import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Ayuda pública del asistente Web: extractiva (sin LLM), solo conocimiento `public`, abstención
// cuando la evidencia es débil y degradación controlada si el índice falla.
const root = join(import.meta.dirname, '..', '..')

test('AYUDA service: validates, abstains, degrades, never leaks non-public chunks and strips Markdown', () => {
  const result = runTypeScriptScenario(`
    const { ServicioAyudaPublica, extracto } = await import('./apps/api/src/tus/asistente/ayuda.ts')
    const chunk = (documentId, visibility, text, heading = 'Doc > Sección') => ({ chunk: { chunkId: 'c-' + documentId, documentId, documentVersion: '1', chunkIndex: 0, heading, text, visibility, audience: 'all', language: 'es', active: true }, documentTitle: 'Doc ' + documentId, score: 0.9 })
    const queries = []
    const fixed = (value) => ({ buscar: async (q, actor) => { queries.push({ q, actor }); return value } })
    const metrics = []
    const ok = new ServicioAyudaPublica(fixed({ confidence: 'high', strategy: 'lexical', results: [
      chunk('a', 'public', '## Título\\n\\n**Importante**: podés [cancelar](https://x) desde Mis solicitudes.\\n- Paso uno\\n- Paso dos'),
      chunk('a', 'public', 'otro fragmento del mismo documento'),
      chunk('interno', 'internal-admin', 'dato interno'),
      chunk('b', 'public', 'segunda fuente'),
      chunk('c', 'public', 'tercera fuente'),
    ] }), (name, fields) => metrics.push({ name, ...fields }))
    const answered = await ok.responder('  ¿Puedo cancelar? escribime a laura@example.com o al 3794 123456 ')
    const invalid = [await ok.responder(''), await ok.responder('ok'), await ok.responder(null), await ok.responder('x'.repeat(301))]
    const low = await new ServicioAyudaPublica(fixed({ confidence: 'low', strategy: 'lexical', results: [] })).responder('¿Cuánto cobra Juan?')
    const onlyInternal = await new ServicioAyudaPublica(fixed({ confidence: 'high', strategy: 'lexical', results: [chunk('interno', 'internal-admin', 'x')] })).responder('soporte interno')
    const broken = await new ServicioAyudaPublica({ buscar: async () => { throw new Error('index down') } }).responder('¿Qué es TUS?')
    const missing = await new ServicioAyudaPublica(null).responder('¿Qué es TUS?')
    const long = extracto('Primera frase corta. ' + 'palabra '.repeat(120) + 'Última.', 120)
    console.log(JSON.stringify({ answered, invalid, low, onlyInternal, broken, missing, queries, metrics, long }))
  `)
  assert.equal(result.answered.status, 'answered')
  assert.deepEqual(result.answered.answers.map((a) => a.documentId), ['a', 'b'], 'one answer per document, at most two, never internal')
  assert.equal(result.answered.answers[0].excerpt, 'Importante: podés cancelar desde Mis solicitudes. Paso uno · Paso dos')
  assert.doesNotMatch(result.queries[0].q, /laura@example\.com|3794 123456/u, 'PII is redacted before retrieval (embeddings may be external)')
  assert.deepEqual(result.queries[0].actor, { linked: false, isProvider: false })
  assert.deepEqual(result.invalid.map((r) => r.status), ['invalid', 'invalid', 'invalid', 'invalid'])
  assert.equal(result.low.status, 'low_confidence')
  assert.equal(result.onlyInternal.status, 'low_confidence')
  assert.equal(result.broken.status, 'unavailable', 'a broken index degrades, it does not throw')
  assert.equal(result.missing.status, 'unavailable')
  assert.equal(result.metrics[0].name, 'rag.search')
  assert.equal(result.metrics[0].channel, 'web')
  assert.doesNotMatch(JSON.stringify(result.metrics), /cancelar|laura/u, 'metrics carry no user text')
  assert.ok(result.long.length <= 120)
  assert.ok(result.long.endsWith('.') || result.long.endsWith('…'))
})

test('AYUDA HTTP: POST /tus/v1/asistente/ayuda answers without a session, 422 on bad input, 503 when unavailable', () => {
  const result = runTypeScriptScenario(`
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { crearRouterAyuda } = await import('./apps/api/src/tus/asistente/http-ayuda.ts')
    const { ServicioAyudaPublica } = await import('./apps/api/src/tus/asistente/ayuda.ts')
    const retriever = { buscar: async () => ({ confidence: 'high', strategy: 'lexical', results: [{ chunk: { chunkId: 'c1', documentId: 'que-es-tus', documentVersion: '1', chunkIndex: 0, heading: 'Qué es TUS', text: 'TUS conecta clientes con prestadores.', visibility: 'public', audience: 'all', language: 'es', active: true }, documentTitle: 'Qué es TUS', score: 1 }] }) }
    const serve = async (ayuda, run) => {
      const app = express(); app.use(express.json()); app.use(crearRouterAyuda({ ayuda }))
      const server = app.listen(0)
      try { return await run('http://127.0.0.1:' + server.address().port + '/tus/v1/asistente/ayuda') } finally { server.close() }
    }
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const ok = await serve(new ServicioAyudaPublica(retriever), async (url) => { const r = await post(url, { question: '¿Qué es TUS?' }); return [r.status, r.headers.get('cache-control'), await r.json()] })
    const bad = await serve(new ServicioAyudaPublica(retriever), async (url) => (await post(url, { question: 'x' })).status)
    const down = await serve(new ServicioAyudaPublica({ buscar: async () => { throw new Error('down') } }), async (url) => (await post(url, { question: '¿Qué es TUS?' })).status)
    const none = await serve(null, async (url) => (await post(url, { question: '¿Qué es TUS?' })).status)
    console.log(JSON.stringify({ ok, bad, down, none }))
  `)
  assert.equal(result.ok[0], 200)
  assert.equal(result.ok[1], 'no-store')
  assert.deepEqual(result.ok[2], { status: 'answered', strategy: 'lexical', answers: [{ documentId: 'que-es-tus', documentTitle: 'Qué es TUS', section: 'Qué es TUS', excerpt: 'TUS conecta clientes con prestadores.' }] })
  assert.equal(result.bad, 422)
  assert.equal(result.down, 503)
  assert.equal(result.none, 503)
})

test('RAG chunker v2: heading path never repeats the title, levels reset, and the chunker version forces one reindex', () => {
  const result = runTypeScriptScenario(`
    const k = await import('./apps/api/src/tus/asistente/conocimiento.ts')
    const doc = { documentId: 'x', version: '1', title: 'Cómo funciona TUS', source: '', visibility: 'public', audience: 'all', language: 'es', active: true, checksum: '', updatedAt: '' }
    const body = '# Cómo funciona TUS\\n\\nintro\\n\\n## Paso uno\\n\\nuno\\n\\n### Detalle\\n\\ndetalle\\n\\n## Paso dos\\n\\ndos'
    const headings = k.fragmentarMarkdown(doc, body).map((c) => c.heading)
    const file = { path: 'docs/conocimiento/xyz.md', content: '---\\nid: xyz\\ntitle: X\\nversion: 1\\nvisibility: public\\naudience: all\\nlanguage: es\\n---\\n\\n# X\\n\\ntexto' }
    const parsed = k.parsearDocumentoConocimiento(file)
    const withoutChunker = k.checksumConocimiento('X\\n1\\npublic\\nall\\n' + parsed.body)
    console.log(JSON.stringify({ headings, version: k.VERSION_CHUNKER, checksumChanged: parsed.document.checksum !== withoutChunker, ranking: [k.rankingLexico(0.25, 1, true), k.rankingLexico(0.5, 1, true), k.rankingLexico(1, 0, false)] }))
  `)
  assert.deepEqual(result.headings, ['Cómo funciona TUS', 'Cómo funciona TUS > Paso uno', 'Cómo funciona TUS > Paso uno > Detalle', 'Cómo funciona TUS > Paso dos'])
  assert.equal(result.version, 'markdown-headings-v2')
  assert.equal(result.checksumChanged, true)
  assert.deepEqual(result.ranking, [0.25, 2, 1], 'boosts only reorder matches above the lexical threshold')
})

test('AYUDA wiring: mounted with the TUS routes, knowledge indexed on Hostinger deploy as an optional step, Web renders plain text', () => {
  const server = readFileSync(join(root, 'apps/api/src/server.ts'), 'utf8')
  assert.match(server, /app\.use\(crearRouterAyuda\(\{ ayuda: whatsapp\?\.ayuda \?\? null \}\)\)/u)
  const postinstall = readFileSync(join(root, 'scripts/hostinger-postinstall.mjs'), 'utf8')
  const migrate = postinstall.indexOf("'scripts/db/migrate-deploy.mjs'")
  const ingest = postinstall.indexOf("'apps/api/src/tus/asistente/cli.ts', 'ingest'")
  assert.ok(migrate > 0 && ingest > migrate, 'knowledge is indexed after migrations')
  assert.doesNotMatch(postinstall.slice(ingest), /process\.exit\(ingest/u, 'a failed ingest does not stop the deploy (optional dependency)')
  // The extractive help is no longer called by the browser: it is the assistant's safe fallback
  // in the API when the model is unavailable (ASISTENTE-WEB-01).
  assert.match(server, /app\.use\(crearRouterAsistenteWeb\(\{ servicio: whatsapp\?\.asistenteWeb \?\? null, sessions \}\)\)/u)
  const asistenteWeb = readFileSync(join(root, 'apps/api/src/tus/asistente/web.ts'), 'utf8')
  assert.match(asistenteWeb, /this\.deps\.ayuda\.responder\(text\)/u)
  assert.match(asistenteWeb, /help\.status !== 'answered'/u, 'only a confident extract is shown')
  const conversation = readFileSync(join(root, 'apps/web/src/features/assistant/assistant-conversation.tsx'), 'utf8')
  assert.doesNotMatch(conversation, /dangerouslySetInnerHTML/u, 'replies are rendered as plain text')
})
