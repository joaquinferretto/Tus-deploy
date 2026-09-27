import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Evaluación del conocimiento público (dataset en fixtures/rag-eval-tus.json, criterio en
// docs/rag/EVALUACION_CONOCIMIENTO_TUS.md) sobre el corpus REAL de docs/conocimiento. Sin
// proveedores externos: léxico (default productivo sin embeddings) e híbrido con embeddings
// locales deterministas. Mide: acierto del documento, respuesta/abstención correctas y ausencia de
// fuentes prohibidas.
const dataset = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/rag-eval-tus.json'), 'utf8'))

function evaluate(mode) {
  return runTypeScriptScenario(`
    const { readdirSync, readFileSync } = await import('node:fs')
    const k = await import('./apps/api/src/tus/asistente/conocimiento.ts')
    const { ServicioAyudaPublica } = await import('./apps/api/src/tus/asistente/ayuda.ts')
    const files = readdirSync('docs/conocimiento').map((name) => ({ path: 'docs/conocimiento/' + name, content: readFileSync('docs/conocimiento/' + name, 'utf8') }))
    const index = new k.IndiceConocimientoEnMemoria()
    const embeddings = ${mode === 'hybrid' ? 'new k.EmbeddingsLocalesHash()' : 'null'}
    await k.indexarConocimiento({ files, index, embeddings })
    const ayuda = new ServicioAyudaPublica(new k.RecuperadorConocimiento(index, embeddings))
    const cases = ${JSON.stringify(dataset.cases)}
    const results = []
    for (const item of cases) {
      const answer = await ayuda.responder(item.question)
      results.push({ question: item.question, status: answer.status, documents: answer.status === 'answered' ? answer.answers.map((a) => a.documentId) : [], sections: answer.status === 'answered' ? answer.answers.map((a) => a.section) : [] })
    }
    console.log(JSON.stringify(results))
  `)
}

function score(results) {
  const failures = []
  for (const [index, item] of dataset.cases.entries()) {
    const result = results[index]
    const forbidden = result.documents.filter((id) => dataset.forbiddenEverywhere.includes(id))
    if (forbidden.length > 0) failures.push(`${item.question}: forbidden ${forbidden.join(', ')}`)
    if (result.status !== item.expect) failures.push(`${item.question}: expected ${item.expect}, got ${result.status}`)
  }
  return failures
}

test('RAG EVAL lexical (production default): right document first, abstains on live data and weak matches', () => {
  const results = evaluate('lexical')
  const failures = score(results)
  for (const [index, item] of dataset.cases.entries()) {
    const result = results[index]
    if (item.topDocument && result.documents[0] !== item.topDocument) failures.push(`${item.question}: top ${result.documents[0]} instead of ${item.topDocument}`)
    if (item.anyDocument && !item.anyDocument.includes(result.documents[0])) failures.push(`${item.question}: top ${result.documents[0]} not in ${item.anyDocument}`)
    if (item.section && !result.sections[0]?.endsWith(item.section)) failures.push(`${item.question}: section ${result.sections[0]} instead of ${item.section}`)
    // Heading path limpio: nunca "Título > Título > ...".
    for (const section of result.sections) {
      const parts = section.split(' > ')
      if (new Set(parts).size !== parts.length) failures.push(`${item.question}: repeated heading in "${section}"`)
    }
  }
  assert.deepEqual(failures, [])
})

test('RAG EVAL hybrid (local deterministic embeddings): answers or abstains correctly and never cites forbidden sources', () => {
  const results = evaluate('hybrid')
  const failures = score(results)
  for (const [index, item] of dataset.cases.entries()) {
    const expected = item.topDocument ? [item.topDocument] : item.anyDocument
    if (expected && !results[index].documents.some((id) => expected.includes(id))) failures.push(`${item.question}: none of ${expected} in ${results[index].documents}`)
  }
  assert.deepEqual(failures, [])
})
