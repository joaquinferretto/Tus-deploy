import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTEXTO_SETUP } from './fixtures/asistente-contexto.mjs'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-CONTEXTO-03. Changes of mind once a professional was chosen, "lo antes posible" with a
// professional named in the first message, references to "la otra", zones and short answers. No
// model: the backend decides all of it. Clock: Friday 2026-09-25 09:00; nobody free today;
// Saturday Melina 09:00 / 10:15; Monday Bongio 09:30, Melina 10:15 / 11:00, Sabrina 16:00 / 19:00;
// Tuesday Bongio 18:30, Sabrina 18:00.

const SETUP = `${CONTEXTO_SETUP}
  MELINA.semana[6] = ['09:00', '10:15']
  const estado = async (w) => { const s = (await conversationOf(w)).state; return { need: s.need, suggestion: s.suggestion ? { kind: s.suggestion.kind, name: s.suggestion.name ?? null, start: s.suggestion.start ?? null } : null, offers: s.offers ? s.offers.items.map((i) => i.name) : null } }
  async function conversacion(textos, { vincular = false } = {}) {
    const w = nuevoContacto()
    const pasos = []
    for (const [indice, texto] of textos.entries()) {
      const desde = dom.consultas.length
      const m = await whatsapp(w, texto)
      pasos.push({ texto, respuesta: m.text, consultas: pedidas(desde), zonas: dom.consultas.slice(desde).map((c) => c.zone ?? null) })
      if (indice === 0 && vincular) await linkContact(w, 'customer-user')
    }
    return { w, pasos, estado: await estado(w) }
  }
`

test('ASISTENTE contexto 3: "lo antes posible" with a professional named in the same message searches HER agenda day by day; the first day anyone else is free is not hers', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    out.sabrina = await conversacion(['masajista el día más próximo con Sabrina'])
    out.bongio = await conversacion(['masajista lo antes posible con Bongio'])
    out.melina = await conversacion(['masajista lo antes posible con Melina'])
    console.log(JSON.stringify(out))
  `)
  const ultimo = (c) => c.pasos.at(-1)
  assert.equal(ultimo(r.sabrina).respuesta, 'La primera disponibilidad es el lunes 28 a las 16:00 con Sabrina. ¿Querés esa?', 'never "no turnos with Sabrina in 14 days" when she has Monday')
  assert.deepEqual(r.sabrina.estado.need.providerName, 'Sabrina')
  assert.deepEqual(r.sabrina.estado.suggestion, { kind: 'offer', name: 'Sabrina', start: '2026-09-28T19:00:00.000Z' })
  assert.deepEqual(ultimo(r.sabrina).consultas.at(-1), ['2026-09-28', null], 'the search went on until her first free day')
  assert.equal(ultimo(r.bongio).respuesta, 'La primera disponibilidad es el lunes 28 a las 09:30 con Bongio. ¿Querés esa?')
  assert.equal(ultimo(r.melina).respuesta, 'La primera disponibilidad es mañana sábado 26 a las 09:00 con Melina. ¿Querés esa?', 'when she is the first one free nothing else is searched')
  assert.deepEqual(ultimo(r.melina).consultas, [['2026-09-25', 'from:09:00-'], ['2026-09-26', null]])
})

test('ASISTENTE contexto 3: a window said after choosing a professional ("mejor a la tarde") is kept; "cualquiera", "sí" and "y con otra?" respect it; nothing is requested without the card', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const base = ['masajista lunes que viene', 'Melina', 'mejor a la tarde']
    out.cualquiera = await conversacion([...base, 'cualquiera'])
    out.si = await conversacion([...base, 'sí'])
    out.otra = await conversacion([...base, 'y con otra?'])
    out.desde = await conversacion(['masajista lunes que viene', 'Melina', 'después de las 15'])
    out.exacta = await conversacion(['masajista lunes que viene', 'Melina', 'a las 16'])
    out.reservas = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  const paso = (c, i) => c.pasos[i]
  assert.equal(paso(r.cualquiera, 1).respuesta, '¿A qué hora con Melina? Tiene: 10:15, 11:00.')
  assert.equal(paso(r.cualquiera, 2).respuesta, 'Melina no tiene turnos a la tarde el lunes 28. Tiene: 10:15, 11:00. ¿Querés alguno de esos o busco quién tiene a la tarde?')
  assert.deepEqual(paso(r.cualquiera, 2).consultas, [], 'her times were already known: nothing is searched to say it')
  assert.equal(paso(r.cualquiera, 3).respuesta, 'La primera disponibilidad es el lunes 28 a las 16:00 con Sabrina. ¿Querés esa?', 'never Bongio 09:30: the afternoon asked is kept')
  assert.deepEqual(paso(r.cualquiera, 3).consultas, [['2026-09-28', 'between:13:00-20:00']])
  assert.deepEqual(r.cualquiera.estado.need.time, { kind: 'between', from: '13:00', to: '20:00', part: 'tarde' })
  assert.equal(r.cualquiera.estado.need.day, '2026-09-28', 'the day is not lost')
  assert.match(paso(r.si, 3).respuesta, /^Encontré 1 profesional de Masaje con turno el lunes 28 a la tarde:\n1\. Sabrina — San Benito: 16:00, 19:00/u, '"sí" searches who has the afternoon')
  assert.equal(paso(r.otra, 3).respuesta, '¿Con cuál? 1. Bongio · 3. Sabrina', '"y con otra?" asks which of the others shown, numbered as shown')
  assert.match(paso(r.desde, 2).respuesta, /^Melina no tiene turnos desde las 15:00 el lunes 28\./u)
  assert.deepEqual(r.desde.estado.need.time, { kind: 'from', from: '15:00', to: null })
  assert.equal(paso(r.exacta, 2).respuesta, 'Melina no tiene turno a esa hora. Tiene: 10:15, 11:00. ¿Cuál preferís?', 'an exact time she does not have is answered with her own times, as before')
  assert.equal(r.reservas, 0)
})

test('ASISTENTE contexto 3: short answers keep the need — "ya", "la que sea", "desde las 10 hasta las 12", a typo of a listed name, a zone sent to the backend, "no" to a proposal keeps everything', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    out.ya = await conversacion(['Necesito una masajista', 'ya'])
    out.laQueSea = await conversacion(['Necesito una masajista para el lunes que viene', 'la que sea'])
    out.rango = await conversacion(['masajista lunes que viene', 'desde las 10 hasta las 12'])
    out.tipeo = await conversacion(['masajista lunes que viene', 'sabrna'])
    out.zona = await conversacion(['Necesito una masajista para el lunes que viene', 'en el centro'])
    out.no = await conversacion(['Necesito una masajista para el lunes que viene', 'cualquiera', 'no'])
    out.reservas = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  const ultimo = (c) => c.pasos.at(-1)
  assert.match(ultimo(r.ya).respuesta, /^La primera disponibilidad de Masaje es mañana sábado 26 a las 09:00 con Melina\.\n\nOpciones de ese día:\n1\. Melina — Barrio Sur: 09:00, 10:15/u)
  assert.equal(r.ya.estado.need.asap, true)
  assert.doesNotMatch(ultimo(r.ya).respuesta, /¿Para cuándo/u)
  assert.equal(ultimo(r.laQueSea).respuesta, 'La primera disponibilidad es el lunes 28 a las 09:30 con Bongio. ¿Querés esa?')
  assert.deepEqual(ultimo(r.rango).consultas, [['2026-09-28', 'between:10:00-12:00']])
  assert.match(ultimo(r.rango).respuesta, /^Encontré 1 profesional de Masaje con turno el lunes 28 entre las 10:00 y las 12:00:\n1\. Melina/u)
  assert.equal(ultimo(r.tipeo).respuesta, '¿A qué hora con Sabrina? Tiene: 16:00, 19:00.')
  assert.deepEqual(ultimo(r.zona).zonas, ['Centro'], 'the zone said is part of the search the backend runs')
  assert.equal(r.zona.estado.need.day, '2026-09-28')
  assert.equal(ultimo(r.no).respuesta, 'Dale. ¿Preferís otro día, otro horario u otro profesional?')
  assert.equal(r.no.estado.need.day, '2026-09-28')
  assert.equal(r.no.estado.suggestion, null)
  assert.equal(r.reservas, 0, 'nothing is requested without the confirmed card')
})
