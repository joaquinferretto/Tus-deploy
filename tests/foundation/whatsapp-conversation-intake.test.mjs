import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

const SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP.replace('const wa = crearModuloWhatsapp', `
  const searches = []
  let candidates = []
  const domain = { buscarPrestadores: async (filter) => { searches.push(filter); return { profession: filter.profession, providers: candidates } } }
  const wa = crearModuloWhatsapp`).replace('application: tusApp, knowledgeIndex', 'application: tusApp, domain, knowledgeIndex')}
  const collect = (problem, zone, question) => llamada('collect_service_request', { profession: 'plomeria', problem, zone, question })
  const search = () => llamada('search_providers', { profession: 'plomeria', query: 'pierde agua la cocina', zone: 'Ponce' })
`

test('WhatsApp intake: asks only missing facts, persists all three across turns, searches only when complete', () => {
  const result = runTypeScriptScenario(`${SETUP}
    script = () => ({ toolCalls: [collect(null, null, '¿Qué problema tenés y en qué barrio necesitás el servicio?')] })
    await say('5491155550701', 'hola necesito un plomero')
    const first = [lastSent().message.text, searches.length]
    script = ({ messages }) => {
      if (!JSON.stringify(messages).includes('plomeria')) throw new Error('lost profession')
      return { toolCalls: [collect('Pierde agua la pileta de la cocina', null, '¿En qué barrio estás?')] }
    }
    await say('5491155550701', 'Pierde agua la pileta de la cocina')
    const second = [lastSent().message.text, searches.length]
    script = ({ messages, tools }) => {
      if (!tools.includes('search_providers')) throw new Error('lost search intent')
      const used = messages.filter(m => m.role === 'tool')
      if (!used.length) return { toolCalls: [collect('Pierde agua la pileta de la cocina', 'Ponce', null)] }
      return { toolCalls: [search()] }
    }
    await say('5491155550701', 'Barrio Ponce')
    console.log(JSON.stringify({ first, second, last: lastSent().message.text, searches, state: (await conversationOf('5491155550701')).state }))
  `)
  assert.match(result.first[0], /problema.*barrio/u)
  assert.equal(result.first[1], 0)
  assert.deepEqual(result.second, ['¿En qué barrio estás?', 0])
  assert.equal(result.searches.length, 1)
  assert.equal(result.searches[0].profession, 'plomeria')
  assert.equal(result.searches[0].query, 'Pierde agua la pileta de la cocina')
  assert.equal(result.state.draft.zone, 'Ponce')
  assert.match(result.last, /No encontré prestadores compatibles/u)
})

test('WhatsApp complete need searches directly and renders only real provider data', () => {
  const result = runTypeScriptScenario(`${SETUP}
    candidates = [{ id: 'real-provider', displayName: 'Ana', profession: { title: 'Plomería' }, approximateArea: 'Ponce', distanceKm: null, verified: false, completedJobs: 0, availability: { label: 'Sin horarios publicados' } }]
    script = ({ messages }) => !messages.some(m => m.role === 'tool')
      ? { toolCalls: [collect('Pierde agua la cocina', 'Ponce', null)] }
      : { content: 'Inventado cobra 100 y tiene cinco estrellas', toolCalls: [search()] }
    await say('5491155550702', 'necesito un plomero en barrio Ponce porque pierde agua la cocina')
    console.log(JSON.stringify({ text: lastSent().message.text, searches, state: (await conversationOf('5491155550702')).state }))
  `)
  assert.equal(result.searches.length, 1)
  assert.match(result.text, /Ana/u)
  assert.doesNotMatch(result.text, /Inventado|100|estrellas|No encontré/u)
  assert.deepEqual(result.state.draft.candidates, [{ providerId: 'real-provider', name: 'Ana' }])
})

test('WhatsApp rejects premature searches and fabricated no-results; errors never offer human support or stop bot', () => {
  const result = runTypeScriptScenario(`${SETUP}
    script = () => ({ toolCalls: [search()] })
    await say('5491155550703', 'necesito un plomero')
    const early = lastSent().message.text
    script = () => ({ content: 'No encontré plomeros disponibles. Hablá con una persona.' })
    await say('5491155550703', 'busco un plomero')
    const invented = lastSent().message.text
    script = () => { throw new Error('provider unavailable') }
    await say('5491155550703', 'necesito un plomero')
    await say('5491155550703', 'necesito un plomero')
    const failed = lastSent().message.text
    await say('5491155550703', 'soporte')
    console.log(JSON.stringify({ early, invented, failed, searches, mode: (await conversationOf('5491155550703')).mode, support: lastSent().message.text }))
  `)
  assert.equal(result.searches.length, 0)
  for (const text of [result.early, result.invented, result.failed]) {
    assert.doesNotMatch(text, /no encontr|disponibles|soporte|persona/iu)
    assert.match(text, /Probá nuevamente/u)
  }
  assert.equal(result.mode, 'bot')
  assert.match(result.support, /no hay un operador humano/u)
})
