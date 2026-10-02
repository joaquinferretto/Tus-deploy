import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// The floating TUS assistant and the /asistente page.
//
// Contract change (ASISTENTE-WEB-01): the Web assistant used to answer from a list of regular
// expressions and fixed texts in the browser (features/home/assistant-service.ts: respond(),
// greeting()). That module was removed on purpose: the Web is now a channel of the SAME assistant
// as WhatsApp, so the message goes to the API and the model decides and writes the reply. The
// cases the old responder covered with patterns (guest search, "how does TUS work", publishing,
// applicants, provider on the map) are conversations with the model now; their behaviour is
// tested in tus-asistente-web.test.mjs (shared orchestrator + Web endpoint). What remains here is
// what the Web itself still guarantees.
const root = join(import.meta.dirname, '..', '..')
const read = (file) => readFileSync(join(root, file), 'utf8')

test('ASSISTANT: the browser decides nothing — no pattern responder, no canned answers; the search bar keeps its own shared search', () => {
  assert.equal(existsSync(join(root, 'apps/web/src/features/home/assistant-service.ts')), false, 'the regex responder is gone')
  const sources = ['apps/web/src/features/assistant/assistant-chat.tsx', 'apps/web/src/features/assistant/assistant-conversation.tsx', 'apps/web/src/features/assistant/use-assistant.ts', 'apps/web/src/features/home/assistant-widget.tsx'].map(read).join('\n')
  assert.doesNotMatch(sources, /assistant-service|respond\(|greeting\(|HOW_IT_WORKS|SEARCH_PROMPT/u)
  // A message is only transported: the text typed (or the text of a shortcut) goes to the API.
  assert.match(read('apps/web/src/features/assistant/use-assistant.ts'), /sendTurn\(input, \{/u)
  assert.match(read('apps/web/src/features/assistant/assistant-client.ts'), /`\$\{baseUrl\(\)\}\/tus\/v1\/asistente\/mensajes`/u)
  // The fixed texts left in the Web are loading, errors and the empty-conversation hint.
  const hook = read('apps/web/src/features/assistant/use-assistant.ts')
  assert.match(hook, /function errorText\(/u)
  assert.match(hook, /export function activityLabel\(/u)

  // The home search bar still interprets natural text with the API interpreter (unchanged).
  const result = runTypeScriptScenario(`
    const { searchServices } = await import('./apps/web/src/features/home/service-search.ts')
    const { interpretarNecesidad } = await import('./apps/api/src/tus/directorio/modelo.ts')
    const catalog = [{ id: 'plomeria', label: 'Plomería' }, { id: 'mecanica', label: 'Mecánica' }, { id: 'aire', label: 'Aire acondicionado' }, { id: 'otros', label: 'Otros oficios' }]
    const searched = []
    const deps = { catalog, interpret: async (text) => interpretarNecesidad(text), providers: async (filters) => { searched.push(filters.profession || filters.query); return filters.profession === 'plomeria' ? [{ id: 'ana' }, { id: 'beto' }, { id: 'caro' }] : [] } }
    const found = await searchServices('se rompió una cañería', deps)
    const ambiguous = await searchServices('se rompió el motor', deps)
    console.log(JSON.stringify({ kind: found.kind, providers: found.providers.length, ambiguous: ambiguous.kind === 'choose' ? ambiguous.options.map((o) => o.id) : ambiguous.kind, searched }))
  `)
  assert.equal(result.kind, 'category')
  assert.equal(result.providers, 3)
  assert.ok(result.ambiguous.includes('mecanica') && result.ambiguous.length > 1, 'ambiguous: asks, does not pick')
  assert.ok(result.searched.every((value) => value), 'every provider list came from the shared search')
})

test('ASSISTANT UI: on the home and public pages, real session, no human support, no raw URLs in the text', () => {
  const widget = read('apps/web/src/features/home/assistant-widget.tsx')
  const conversation = read('apps/web/src/features/assistant/assistant-conversation.tsx')
  const hook = read('apps/web/src/features/assistant/use-assistant.ts')
  assert.doesNotMatch(widget + conversation + hook, /soporte|una persona|un agente|operador/iu)
  assert.doesNotMatch(conversation + hook, /'[^']*https?:\/\/[^']*'/u, 'links are buttons built from API data, never raw URLs in a text')
  assert.match(widget, /useAccountView\(\)/u, 'session from the API')
  assert.match(conversation, /placeholder="Escribí tu consulta…"/u)
  assert.match(conversation, /withReturnTo\('\/sign-in', \(value\.kind === 'sign_in' && value\.returnTo\) \|\| pathname\)/u, 'signing in comes back to the same screen, or to the turno being requested when the API names it')
  assert.match(read('apps/web/src/features/home/site-page.tsx'), /<AssistantWidget \/>/u)
  assert.match(read('apps/web/src/features/home/home-page.tsx'), /<AssistantWidget \/>/u)
  assert.match(read('apps/web/src/features/home/home-page.tsx'), /get\('buscar'\)/u)
  // The widget never duplicates the conversation of the assistant page.
  assert.match(widget, /if \(pathname === '\/asistente'\) return null/u)
})
