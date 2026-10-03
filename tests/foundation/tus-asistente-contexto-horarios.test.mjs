import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTEXTO_SETUP } from './fixtures/asistente-contexto.mjs'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-CONTEXTO-02. Second pass: what is asked about the TIME is respected exactly (an exact
// time, "desde", "hasta", a range, a part of the day, "lo antes posible"), "cualquiera" combines
// with it, references resolve against what was shown (and are asked when they are ambiguous),
// prices follow the professional being talked about, proposals are accepted, rejected or
// replaced, and only typing slips are treated as unreadable. Every case checks the state, the
// query sent to the backend and the reply. No model: the backend decides all of it.
//
// Saturday 2026-09-26 ("mañana"): Bongio 10:00 and 19:00; Melina 09:15, 10:15 and 18:00;
// Sabrina 09:00, 09:30 and 18:30. Nobody today (Friday 25, 09:00).

const SETUP = `${CONTEXTO_SETUP}
  BONGIO.semana[6] = ['10:00', '19:00']
  MELINA.semana[6] = ['09:15', '10:15', '18:00']
  SABRINA.semana[6] = ['09:00', '09:30', '18:30']
  const MANANA = '2026-09-26'
  const estado = async (w) => { const s = (await conversationOf(w)).state; return { need: s.need, suggestion: s.suggestion ? { kind: s.suggestion.kind, name: s.suggestion.name ?? null, start: s.suggestion.start ?? null } : null, offers: s.offers ? s.offers.items.map((i) => i.name) : null } }
  // One conversation: its messages in order, each with the reply and the backend queries it made.
  async function conversacion(textos, { vincular = false } = {}) {
    const w = nuevoContacto()
    const pasos = []
    for (const [indice, texto] of textos.entries()) {
      const desde = dom.consultas.length
      const m = await whatsapp(w, texto)
      pasos.push({ texto, tipo: m.type, respuesta: m.text, consultas: pedidas(desde) })
      if (indice === 0 && vincular) await linkContact(w, 'customer-user')
    }
    return { w, pasos, estado: await estado(w) }
  }
  const hora = (iso) => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(11, 16)
`

test('ASISTENTE contexto 2: the time asked is a requirement — exact, from, until, range, part of the day — and only who fits is listed; nobody fitting says so and offers the closest', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // A. exact time, said with the service: only Melina has 09:15.
    out.A = await conversacion(['masajista mañana a las 09:15'])
    // Nobody at 11:00: said, and the closest real ones offered.
    out.nadie = await conversacion(['masajista mañana a las 11'])
    // R. "tipo 18" is the exact 18:00.
    out.R = await conversacion(['Necesito una masajista', 'mañana tipo 18'])
    // S, T, U: range, from, until (the day said before is kept).
    out.S = await conversacion(['Necesito una masajista para mañana', 'entre las 18 y las 20'])
    out.T = await conversacion(['Necesito una masajista para mañana', 'después de las 18'])
    out.U = await conversacion(['Necesito una masajista para mañana', 'antes de las 18'])
    // A part of the day stays a part of the day in the state; the backend gets its bounds.
    out.tarde = await conversacion(['Necesito una masajista para mañana', 'a la tarde'])
    console.log(JSON.stringify(out))
  `)
  const ultimo = (c) => c.pasos.at(-1)
  assert.equal(ultimo(r.A).respuesta, 'Encontré 1 profesional de Masaje con turno mañana a las 09:15:\n1. Melina — Barrio Sur: 09:15\n¿Con cuál querés solicitar el turno?', 'Sabrina (09:00, 09:30) and Bongio (10:00) are not listed under 09:15')
  assert.deepEqual(ultimo(r.A).consultas, [['2026-09-26', 'exact:09:15-']])
  assert.deepEqual(r.A.estado.need.time, { kind: 'exact', from: '09:15', to: null })
  assert.deepEqual(r.A.estado.offers, ['Melina'], '"la primera" now means Melina: the list shown is the list remembered')
  assert.match(ultimo(r.nadie).respuesta, /^No encontré turnos de Masaje mañana a las 11:00\. Lo más cercano mañana:\n/u, 'the time asked is not silently changed')
  assert.deepEqual(ultimo(r.nadie).consultas, [['2026-09-26', 'exact:11:00-']])
  assert.equal(ultimo(r.R).respuesta, 'Encontré 1 profesional de Masaje con turno mañana a las 18:00:\n1. Melina — Barrio Sur: 18:00\n¿Con cuál querés solicitar el turno?')
  assert.deepEqual(ultimo(r.R).consultas, [['2026-09-26', 'exact:18:00-']])
  assert.equal(ultimo(r.S).respuesta, 'Encontré 3 profesionales de Masaje con turno mañana entre las 18:00 y las 20:00:\n1. Bongio — Centro: 19:00\n2. Melina — Barrio Sur: 18:00\n3. Sabrina — San Benito: 18:30\n¿Con cuál querés solicitar el turno?')
  assert.deepEqual(ultimo(r.S).consultas, [['2026-09-26', 'between:18:00-20:00']])
  assert.deepEqual(r.S.estado.need.time, { kind: 'between', from: '18:00', to: '20:00' }, 'a range said with hours has no part of the day')
  assert.deepEqual(ultimo(r.T).consultas, [['2026-09-26', 'from:18:00-']])
  assert.deepEqual(r.T.estado.need.time, { kind: 'from', from: '18:00', to: null })
  assert.doesNotMatch(ultimo(r.T).respuesta, /09:|10:/u)
  assert.equal(ultimo(r.U).respuesta, 'Encontré 3 profesionales de Masaje con turno mañana antes de las 18:00:\n1. Bongio — Centro: 10:00\n2. Melina — Barrio Sur: 09:15, 10:15\n3. Sabrina — San Benito: 09:00, 09:30\nDecime con quién y a qué hora y te preparo la solicitud.')
  assert.deepEqual(ultimo(r.U).consultas, [['2026-09-26', 'until:-18:00']])
  assert.deepEqual(r.U.estado.need.time, { kind: 'until', from: null, to: '18:00' })
  assert.deepEqual(r.tarde.estado.need.time, { kind: 'between', from: '13:00', to: '20:00', part: 'tarde' }, 'the state says it was "a la tarde"')
  assert.deepEqual(ultimo(r.tarde).consultas, [['2026-09-26', 'between:13:00-20:00']], 'the backend gets only the bounds')
  for (const c of [r.R, r.S, r.T, r.U, r.tarde]) assert.doesNotMatch(ultimo(c).respuesta, /¿Para cuándo/u, 'the service and the day are never asked again')
})

test('ASISTENTE contexto 2: "cualquiera" combined with day, time, range and "lo antes posible" proposes ONE real start that respects all of it', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    out.B = await conversacion(['Necesito una masajista', 'cualquiera mañana a las 09:15'])
    out.C = await conversacion(['Necesito una masajista', 'cualquiera mañana después de las 18'])
    out.D = await conversacion(['Necesito una masajista', 'la primera que haya'])
    out.E = await conversacion(['Necesito una masajista', 'la primera que haya mañana'])
    out.F = await conversacion(['Necesito una masajista', 'lo antes posible con cualquiera'])
    out.V = await conversacion(['Necesito una masajista para mañana', 'me da igual quién'])
    out.W = await conversacion(['Necesito una masajista para mañana', 'no importa quién, pero a las 19'])
    out.anyNoFit = await conversacion(['Necesito una masajista para mañana', 'cualquiera a las 11'])
    console.log(JSON.stringify(out))
  `)
  const ultimo = (c) => c.pasos.at(-1)
  const propuesta = (cuando, nombre) => `La primera opción que encontré es ${cuando} con ${nombre}. ¿Querés esa?`
  assert.equal(ultimo(r.B).respuesta, propuesta('mañana a las 09:15', 'Melina'), 'anyone, but at 09:15: only Melina has it')
  assert.deepEqual(ultimo(r.B).consultas, [['2026-09-26', 'exact:09:15-']])
  assert.deepEqual([r.B.estado.need.anyProvider, r.B.estado.need.day, r.B.estado.need.time, r.B.estado.suggestion], [true, '2026-09-26', { kind: 'exact', from: '09:15', to: null }, { kind: 'offer', name: 'Melina', start: '2026-09-26T12:15:00.000Z' }])
  assert.equal(ultimo(r.C).respuesta, propuesta('mañana a las 18:00', 'Melina'))
  assert.deepEqual(ultimo(r.C).consultas, [['2026-09-26', 'from:18:00-']])
  assert.equal(ultimo(r.D).respuesta, 'Hoy no hay turnos libres. ' + propuesta('mañana a las 09:00', 'Sabrina'), '"la primera que haya": anyone, the first real start from now on')
  assert.deepEqual(ultimo(r.D).consultas.slice(0, 2).map((c) => c[0]), ['2026-09-25', '2026-09-26'])
  assert.deepEqual([r.D.estado.need.asap, r.D.estado.need.anyProvider], [true, true])
  assert.equal(ultimo(r.E).respuesta, propuesta('mañana a las 09:00', 'Sabrina'), 'from tomorrow: nothing to say about today')
  assert.deepEqual(ultimo(r.E).consultas, [['2026-09-26', null]])
  assert.equal(ultimo(r.F).respuesta, 'Hoy no hay turnos libres. ' + propuesta('mañana a las 09:00', 'Sabrina'))
  assert.equal(ultimo(r.V).respuesta, propuesta('mañana a las 09:00', 'Sabrina'))
  assert.deepEqual(ultimo(r.V).consultas, [['2026-09-26', null]])
  assert.equal(ultimo(r.W).respuesta, propuesta('mañana a las 19:00', 'Bongio'))
  assert.deepEqual(ultimo(r.W).consultas, [['2026-09-26', 'exact:19:00-']])
  assert.match(ultimo(r.anyNoFit).respuesta, /^No encontré turnos de Masaje mañana a las 11:00\. Lo más cercano mañana:/u, 'nobody at 11:00: no proposal is made up')
  assert.equal(r.anyNoFit.estado.suggestion, null)
})

test('ASISTENTE contexto 2: a professional by name with "lo antes posible" or a time; references "la primera/segunda/tercera", "la de Barrio Sur", "la otra"; ambiguous names are asked', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // G. "Melina lo antes posible" with the list of tomorrow on the table: her first start.
    out.G = await conversacion(['Necesito una masajista para mañana', 'Melina lo antes posible'], { vincular: true })
    // H. "Melina mañana a las 09:15" with Monday's list on the table: her own search.
    out.H = await conversacion([LUNES, 'Melina mañana a las 09:15'], { vincular: true })
    // L. ordinals and the zone of the list.
    out.L = await conversacion(['Necesito una masajista para mañana', 'la segunda'])
    out.tercera = await conversacion(['Necesito una masajista para mañana', 'la tercera'])
    out.barrio = await conversacion(['Necesito una masajista para mañana', 'la de Barrio Sur'])
    // M. "la otra": after choosing, another of the same list; with no list, asked.
    out.M = await conversacion(['Necesito una masajista para mañana', 'la segunda', 'la otra'])
    out.otraSinLista = await conversacion(['Necesito una masajista', 'la otra'])
    // P. typos: one clear match is taken, two possible ones are asked.
    out.P = await conversacion(['Necesito una masajista para mañana', 'melna'])
    // Q.
    out.Q = await conversacion(['masajsta'])
    // A service and a professional in the same first message.
    out.conNombre = await conversacion(['Quiero una masajista con Melina mañana'])
    // Two professionals called Melina: never guessed.
    AGENDA.push({ id: 'perfil-melina-m', name: 'Melina Martínez', area: 'Centro', semana: { 6: ['12:00'] }, precio: 22000 })
    out.dosMelinas = await conversacion(['Necesito una masajista para mañana', 'melna'])
    out.dosMelinasExacta = await conversacion(['Necesito una masajista para mañana', 'Melina'])
    out.completa = await conversacion(['Necesito una masajista para mañana', 'Melina Martínez'], { vincular: true })
    out.reservas = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  const ultimo = (c) => c.pasos.at(-1)
  assert.equal(ultimo(r.G).tipo, 'buttons')
  assert.deepEqual(ultimo(r.G).respuesta.split('\n').slice(1, 5), ['Prestador: Melina', 'Servicio: Masaje', 'Fecha: sábado 26 de septiembre', 'Horario: 09:15'], 'her first real start, no list again')
  assert.deepEqual(ultimo(r.G).consultas, [], 'the list shown was enough: no new search')
  assert.equal(ultimo(r.H).tipo, 'buttons')
  assert.deepEqual(ultimo(r.H).respuesta.split('\n').slice(3, 5), ['Fecha: sábado 26 de septiembre', 'Horario: 09:15'])
  assert.deepEqual(ultimo(r.H).consultas, [['2026-09-26', 'exact:09:15-']])
  assert.deepEqual([r.H.estado.need.providerName, r.H.estado.need.day], ['Melina', '2026-09-26'])
  assert.equal(ultimo(r.L).respuesta, '¿A qué hora con Melina? Tiene: 09:15, 10:15, 18:00.')
  assert.equal(ultimo(r.tercera).respuesta, '¿A qué hora con Sabrina? Tiene: 09:00, 09:30, 18:30.')
  assert.equal(ultimo(r.barrio).respuesta, '¿A qué hora con Melina? Tiene: 09:15, 10:15, 18:00.', '"la de Barrio Sur" is the one shown in Barrio Sur')
  assert.equal(ultimo(r.M).respuesta, '¿Con cuál? 1. Bongio · 3. Sabrina')
  assert.equal(ultimo(r.otraSinLista).respuesta, 'Todavía no te mostré profesionales de Masaje para elegir otra. ¿Para cuándo lo necesitás?')
  assert.equal(ultimo(r.P).respuesta, '¿A qué hora con Melina? Tiene: 09:15, 10:15, 18:00.')
  assert.equal(ultimo(r.Q).respuesta, '¿Para cuándo necesitás Masaje?')
  assert.equal(r.Q.estado.need.profession, 'masaje')
  assert.equal(ultimo(r.conNombre).respuesta, '¿A qué hora con Melina? Tiene: 09:15, 10:15, 18:00.', 'the name in the first message is resolved against the real result')
  assert.equal(r.conNombre.estado.need.providerName, 'Melina')
  assert.equal(ultimo(r.dosMelinas).respuesta, '¿Con cuál? 2. Melina (Barrio Sur) · 4. Melina Martínez (Centro)', 'one typo away from two: asked')
  assert.equal(ultimo(r.dosMelinasExacta).respuesta, '¿Con cuál? 2. Melina (Barrio Sur) · 4. Melina Martínez (Centro)', 'a first name two of them share: asked')
  assert.equal(ultimo(r.completa).tipo, 'buttons')
  assert.deepEqual(ultimo(r.completa).respuesta.split('\n').slice(1, 2), ['Prestador: Melina Martínez'], 'the full name names her (her only start: the card)')
  assert.equal(r.reservas, 0, 'nothing is requested without the confirmed card')
})

test('ASISTENTE contexto 2: price in context ("¿cuánto sale?", "¿y con Melina?", "¿cuánto me sale con ella?", "¿cuánto pago?") never goes to the account or payment flow', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    out.I = await conversacion(['Necesito una masajista para mañana', '¿cuánto sale?', '¿y con Melina?', '¿y el precio?'])
    out.conElla = await conversacion(['Quiero una masajista con Melina mañana', '¿Cuánto sale?', '¿cuánto me sale con ella?', '¿cuánto sería?', '¿cuánto pago?'])
    out.propuesta = await conversacion(['Necesito una masajista para mañana', 'cualquiera', '¿cuánto cuesta?'])
    out.consultasPrecio = dom.precios
    console.log(JSON.stringify(out))
  `)
  const [, i, j, k] = r.I.pasos
  assert.match(i.respuesta, /^Los precios de Masaje dependen del profesional:\n1\. Bongio: \$ ?18\.000\n2\. Melina: \$ ?20\.000\n3\. Sabrina: todavía sin precio publicado$/u)
  assert.deepEqual(i.consultas, [], 'a price question is not a new availability search')
  assert.match(j.respuesta, /^Masaje con Melina: \$ ?20\.000\.$/u, '"¿y con Melina?" right after a price')
  assert.match(k.respuesta, /^Los precios de Masaje/u)
  for (const p of r.conElla.pasos.slice(1)) {
    assert.equal(p.tipo, 'text')
    assert.match(p.respuesta, /^Masaje con Melina: \$ ?20\.000\.$/u, p.texto)
  }
  assert.equal(r.propuesta.pasos[2].respuesta, 'El servicio de Masaje todavía no tiene un precio publicado con Sabrina.', 'the price of the professional proposed (she has none)')
  for (const c of [r.I, r.conElla, r.propuesta]) for (const p of c.pasos) assert.doesNotMatch(p.respuesta, /vincul|iniciar sesión|link de pago/iu, p.texto)
})

test('ASISTENTE contexto 2: changes of mind change only what they say (K); proposals: "sí" accepts, "no" drops, "no, mejor la segunda" replaces, "esa misma" accepts', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // Sabrina publishes a price here, so a proposal of hers can become a request card.
    SABRINA.precio = 15000
    // K: lunes -> "no mejor el martes" -> "lo antes posible" -> "cualquiera".
    out.K = await conversacion(['Quiero una masajista el lunes', 'no mejor el martes', 'lo antes posible', 'cualquiera'])
    out.Kestados = []
    // The states after each step (re-run the same messages one by one on a new contact).
    const w = nuevoContacto()
    for (const t of ['Quiero una masajista el lunes', 'no mejor el martes', 'lo antes posible', 'cualquiera']) { await whatsapp(w, t); const n = (await conversationOf(w)).state.need; out.Kestados.push([n.profession, n.day, n.asap, n.anyProvider]) }
    out.si = await conversacion(['Necesito una masajista para mañana', 'cualquiera', 'sí'], { vincular: true })
    out.no = await conversacion(['Necesito una masajista para mañana', 'cualquiera', 'no'])
    out.reemplazo = await conversacion(['Necesito una masajista para mañana', 'cualquiera', 'no, mejor la segunda'])
    out.esaMisma = await conversacion(['Necesito una masajista para mañana', 'cualquiera', 'esa misma'], { vincular: true })
    out.reservas = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.Kestados, [['masaje', '2026-09-28', false, false], ['masaje', '2026-09-29', false, false], ['masaje', '2026-09-29', true, false], ['masaje', '2026-09-29', true, true]], 'each message changes only what it says')
  assert.deepEqual(r.K.pasos.map((p) => p.consultas.map((c) => c[0])), [['2026-09-28'], ['2026-09-29'], ['2026-09-29'], ['2026-09-29']], '"lo antes posible" after "el martes" searches from Tuesday')
  assert.equal(r.K.pasos[3].respuesta, 'La primera opción que encontré es el martes 29/9 a las 18:00 con Sabrina. ¿Querés esa?')
  assert.equal(r.si.pasos[2].tipo, 'buttons', '"sí" accepts the proposal: the request card')
  assert.deepEqual(r.si.pasos[2].respuesta.split('\n').slice(1, 2), ['Prestador: Sabrina'])
  assert.equal(r.no.pasos[2].respuesta, 'Dale. ¿Preferís otro día, otro horario u otra profesional?')
  assert.deepEqual([r.no.estado.suggestion, r.no.estado.need.profession, r.no.estado.need.day], [null, 'masaje', '2026-09-26'], 'the proposal is dropped, the need stays')
  assert.equal(r.reemplazo.pasos[2].respuesta, '¿A qué hora con Melina? Tiene: 09:15, 10:15, 18:00.', '"no, mejor la segunda" drops the proposal and chooses from the list shown')
  assert.equal(r.reemplazo.estado.suggestion, null)
  assert.equal(r.esaMisma.pasos[2].tipo, 'buttons')
  assert.equal(r.reservas, 0, 'a card is not a request: nothing was requested')
})

test('ASISTENTE contexto 2: only typing slips are unreadable ("asd", "ysk"); places, names and words are not (Barrio Ponce, Santa Ana, Rosa); the clarification offers what is known and "sí" searches it again', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    out.N = await conversacion(['Necesito una masajista para mañana', 'asd', 'sí'])
    out.ysk = await conversacion(['Necesito una masajista', 'Ysk'])
    out.sinDia = await conversacion(['Necesito una masajista', 'qwe'])
    out.O = await conversacion(['Necesito una masajista para mañana', 'Barrio Ponce'])
    out.santaAna = await conversacion(['Necesito una masajista para mañana', 'Santa Ana'])
    out.rosa = await conversacion(['Necesito una masajista para mañana', 'Rosa'])
    out.melina = await conversacion(['Necesito una masajista para mañana', 'Melina'])
    console.log(JSON.stringify(out))
  `)
  const NO_ENTENDI = /^No llegué a entender ese mensaje 😅\./u
  assert.equal(r.N.pasos[1].respuesta, 'No llegué a entender ese mensaje 😅. Si querés, sigo buscando turnos de Masaje mañana.', 'what is known, not the last question')
  assert.deepEqual(r.N.pasos[1].consultas, [])
  assert.match(r.N.pasos[2].respuesta, /^Encontré 3 profesionales de Masaje con turno mañana:/u, '"sí" searches the same need again')
  assert.deepEqual(r.N.pasos[2].consultas, [['2026-09-26', null]])
  assert.equal(r.ysk.pasos[1].respuesta, 'No llegué a entender ese mensaje 😅. ¿Querés que busque el primer turno libre de Masaje con cualquier profesional?')
  assert.match(r.sinDia.pasos[1].respuesta, NO_ENTENDI)
  for (const c of [r.O, r.santaAna, r.rosa]) assert.doesNotMatch(c.pasos[1].respuesta, NO_ENTENDI, c.pasos[1].texto + ' is not a typing slip')
  assert.equal(r.melina.pasos[1].respuesta, '¿A qué hora con Melina? Tiene: 09:15, 10:15, 18:00.', 'a professional listed is a choice')
})

test('ASISTENTE contexto 2: the extractor keeps the kinds of time apart and "la primera que haya" is anyone + first', () => {
  const r = runTypeScriptScenario(`
    const { extraerNecesidad, limitesVentana } = await import('./apps/api/src/tus/asistente/necesidad.ts')
    const ahora = Date.parse('2026-09-25T12:00:00.000Z')
    const out = {}
    for (const f of ['a las 18:00', 'después de las 18', 'antes de las 18', 'entre las 18 y las 20', 'a la tarde', 'lo antes posible', 'cuando haya', 'la primera que haya', 'la primera que haya mañana', 'me da igual quién, pero a las 10', 'cualquiera mañana a las 09:15', 'cualquiera lo antes posible']) out[f] = extraerNecesidad(f, ahora)
    out.limites = limitesVentana(out['a la tarde'].time)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r['a las 18:00'], { time: { kind: 'exact', from: '18:00', to: null } })
  assert.deepEqual(r['después de las 18'], { time: { kind: 'from', from: '18:00', to: null } })
  assert.deepEqual(r['antes de las 18'], { time: { kind: 'until', from: null, to: '18:00' } })
  assert.deepEqual(r['entre las 18 y las 20'], { time: { kind: 'between', from: '18:00', to: '20:00' } })
  assert.deepEqual(r['a la tarde'], { time: { kind: 'between', from: '13:00', to: '20:00', part: 'tarde' } })
  assert.deepEqual(r.limites, { kind: 'between', from: '13:00', to: '20:00' })
  assert.deepEqual(r['lo antes posible'], { asap: true })
  assert.deepEqual(r['cuando haya'], { asap: true })
  assert.deepEqual(r['la primera que haya'], { asap: true, anyProvider: true })
  assert.deepEqual(r['la primera que haya mañana'], { day: '2026-09-26', dayTo: null, asap: true, anyProvider: true })
  assert.deepEqual(r['me da igual quién, pero a las 10'], { time: { kind: 'exact', from: '10:00', to: null }, anyProvider: true })
  assert.deepEqual(r['cualquiera mañana a las 09:15'], { day: '2026-09-26', dayTo: null, time: { kind: 'exact', from: '09:15', to: null }, anyProvider: true })
  assert.deepEqual(r['cualquiera lo antes posible'], { asap: true, anyProvider: true })
})
