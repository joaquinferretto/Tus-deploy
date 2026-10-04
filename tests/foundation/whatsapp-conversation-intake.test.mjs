import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

const SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP.replace('const wa = crearModuloWhatsapp', `
  const searches = []
  let candidates = []
  const availability = []
  const domain = {
    buscarPrestadores: async (filter) => { searches.push(filter); return { profession: filter.profession, providers: candidates } },
    // Real availability for a need. The same providers as the directory search above (in TUS both
    // read the same directory): none of them takes turnos online, they work by request.
    buscarDisponibilidad: async (consulta) => {
      availability.push(consulta)
      const providers = candidates.map((c) => ({ providerId: c.id, name: c.displayName, profession: c.profession.title, area: c.approximateArea, verified: c.verified, completedJobs: c.completedJobs, takesAppointments: false, durationMinutes: null, tariffs: [], matches: [], nearby: [] }))
      return { profession: consulta.profession, outcome: providers.length ? 'no_appointments' : 'no_providers', zoneRelaxed: false, providers }
    },
  }
  const wa = crearModuloWhatsapp`).replace('application: tusApp, knowledgeIndex', 'application: tusApp, domain, knowledgeIndex')}
  const collect = (problem, zone, question) => llamada('collect_service_request', { profession: 'plomeria', problem, zone, question })
  const search = () => llamada('search_providers', { profession: 'plomeria', query: 'pierde agua la cocina', zone: 'Ponce' })
`

test('WhatsApp intake: asks nothing that is not needed (never the day nor the zone), keeps every fact across turns, searches as soon as the trade is known', () => {
  const result = runTypeScriptScenario(`${SETUP}
    // The trade is in the message: the backend searches at once, the model is not needed.
    script = () => { throw new Error('the model must not be called when the message names the trade') }
    await say('5491155550701', 'hola necesito un plomero')
    const first = [lastSent().message.text, searches.length, availability.length]
    // From here on the model is not needed: the message itself completes the need.
    script = () => { throw new Error('the model must not be called for a complete need') }
    await say('5491155550701', 'Pierde agua la pileta de la cocina, mañana a la tarde')
    const second = [lastSent().message.text, availability.length]
    // A neighbourhood the catalog does not list by name: the model reads it and passes it on.
    script = () => ({ toolCalls: [llamada('find_appointments', { profession: null, when: null, zone: 'Ponce', anyZone: null })] })
    await say('5491155550701', 'Barrio Ponce')
    console.log(JSON.stringify({ first, second, last: lastSent().message.text, availability, searches, state: (await conversationOf('5491155550701')).state }))
  `)
  // Contract changed on purpose: the day is no longer asked. With the trade alone the backend
  // walks the calendar from today; here nobody offers the trade and that is said at once.
  assert.deepEqual(result.first, ['Todavía no hay profesionales de Plomería publicados en TUS.', 0, 1], 'the trade alone is searched: no question about the day, the problem or the neighbourhood')
  assert.doesNotMatch(result.first[0], /cuándo|problema|barrio|zona/iu)
  assert.deepEqual([result.availability[0].profession, result.availability[0].day, result.availability[0].zone], ['plomeria', '2026-09-25', null], 'from today, without a zone')
  assert.deepEqual(result.second, ['Todavía no hay profesionales de Plomería publicados en TUS.', 2], 'trade + day: the search runs without a zone')
  assert.deepEqual(result.availability[1], { profession: 'plomeria', day: '2026-09-26', dayTo: null, time: { kind: 'between', from: '13:00', to: '20:00' }, zone: null })
  assert.deepEqual(result.availability[2], { profession: 'plomeria', day: '2026-09-26', dayTo: null, time: { kind: 'between', from: '13:00', to: '20:00' }, zone: 'Ponce' }, 'a zone said later narrows the same need')
  assert.equal(result.searches.length, 0)
  assert.deepEqual([result.state.need.profession, result.state.need.day, result.state.need.zone], ['plomeria', '2026-09-26', 'Ponce'])
  assert.match(result.last, /Todavía no hay profesionales de Plomería publicados en TUS que atiendan en Ponce/u)
})

test('WhatsApp complete need searches directly and renders only real provider data', () => {
  const result = runTypeScriptScenario(`${SETUP}
    candidates = [{ id: 'real-provider', displayName: 'Ana', profession: { title: 'Plomería' }, approximateArea: 'Ponce', distanceKm: null, verified: false, completedJobs: 0, availability: { label: 'Sin horarios publicados' } }]
    // A model that would embellish is never asked: the backend reads the trade and searches itself.
    script = () => ({ content: 'Inventado cobra 100 y tiene cinco estrellas' })
    await say('5491155550702', 'necesito un plomero en barrio Ponce porque pierde agua la cocina')
    console.log(JSON.stringify({ text: lastSent().message.text, searches, availability, calls: chat.calls.length, state: (await conversationOf('5491155550702')).state }))
  `)
  assert.equal(result.availability.length, 1, 'one real search, by the backend')
  assert.equal(result.calls, 0, 'the model was not needed')
  assert.equal(result.text, 'Encontré 1 profesional de Plomería. No toman turnos online: se coordina enviándoles una solicitud.\n1. Ana — Ponce\n¿A cuál querés enviársela?')
  assert.doesNotMatch(result.text, /Inventado|100|estrellas|No encontré/u)
  assert.deepEqual(result.state.draft.candidates, [{ providerId: 'real-provider', name: 'Ana' }])
})

test('WhatsApp: a search needs only the trade; a fabricated no-result never reaches the user; a failing model changes nothing, and never ends in human support', () => {
  const result = runTypeScriptScenario(`${SETUP}
    script = ({ messages }) => messages.some((m) => m.role === 'tool') ? { content: 'no debería usarse' } : { toolCalls: [search()] }
    await say('5491155550703', 'necesito un plomero')
    const searched = [lastSent().message.text, availability.length, availability[0]]
    script = () => ({ content: 'No encontré plomeros disponibles. Hablá con una persona.' })
    await say('5491155550703', 'busco un plomero')
    const invented = lastSent().message.text
    script = () => { throw new Error('provider unavailable') }
    await say('5491155550703', 'necesito un plomero')
    await say('5491155550703', 'necesito un plomero')
    const failed = lastSent().message.text
    await say('5491155550703', 'soporte')
    console.log(JSON.stringify({ searched, invented, failed, searches: searches.length, calls: chat.calls.length, mode: (await conversationOf('5491155550703')).mode, support: lastSent().message.text }))
  `)
  const SIN_PLOMEROS = 'Todavía no hay profesionales de Plomería publicados en TUS.'
  assert.equal(result.searched[0], SIN_PLOMEROS, 'a real search with no providers says so (rendered by the backend)')
  assert.equal(result.searched[1], 1, 'the trade alone is enough to search')
  assert.equal(result.searched[2].profession, 'plomeria')
  assert.equal(result.calls, 0, 'the model (inventing, or down) is never part of a search whose trade the message names')
  for (const text of [result.invented, result.failed]) {
    assert.doesNotMatch(text, /soporte|persona|cuándo/iu)
    assert.equal(text, SIN_PLOMEROS, 'the real result of the backend, whatever the model would have said')
  }
  assert.equal(result.mode, 'bot')
  assert.match(result.support, /no hay un operador humano/u)
})
