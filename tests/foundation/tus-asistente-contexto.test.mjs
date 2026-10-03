import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTEXTO_SETUP } from './fixtures/asistente-contexto.mjs'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-CONTEXTO-01. WhatsApp is a conversation, not a form: consecutive short messages build
// ONE need ("el lunes" + "lo antes posible" + "con cualquiera"), each message changes only what
// it says, and the backend acts on the structured state: the first real free turno, any
// professional, a professional named or pointed at ("Melina", "la segunda", "la otra"), the
// price of what is being talked about. Availability always comes from the backend search;
// nothing is requested without the explicit "sí". No model (chat: null): every decision here is
// the backend's.
//
// Clock of the fixture: Friday 2026-09-25, 09:00 in Argentina. "mañana" is Saturday 26, "el
// lunes que viene" Monday 28, "el martes" Tuesday 29. Nobody has a free turno today.

const SETUP = CONTEXTO_SETUP

test('ASISTENTE contexto: the 24 phrases become structured facts (first free turno, any professional, day, time); the zone phrases stay the zone', () => {
  const r = runTypeScriptScenario(`
    const { extraerNecesidad } = await import('./apps/api/src/tus/asistente/necesidad.ts')
    const { profesionalNombrado } = await import('./apps/api/src/tus/asistente/busqueda.ts')
    const { catalogoVigente, establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
    const catalogo = catalogoVigente()
    establecerCatalogo({ ...catalogo, oficios: [...catalogo.oficios, { id: 'masaje', categoriaId: null, nombre: 'Masaje', profesion: 'Masajista', slug: 'masaje', descripcion: null, icono: 'herramienta', activo: true, orden: 20, sinonimos: ['masaje', 'masajes', 'masajista', 'contractura'] }] })
    const ahora = Date.parse('2026-09-25T12:00:00.000Z')
    const frases = ['Necesito una masajista', 'El lunes que viene', 'Lo antes posible', 'Quiero una que venga ya', 'Cualquiera', 'La que sea', 'Me da igual quién', 'Melina ya mismo', 'Quiero a Melina mañana', 'El día más próximo', '¿Cuánto sale?', 'Ysk', 'masajsta', 'melna', 'la segunda', 'la otra', 'no importa quién, buscame una', 'mañana a la tarde cualquiera', 'lunes después de las 18', 'no mejor el martes', 'ahora', 'lo antes posible con Melina', 'la que esté disponible primero', 'buscame cualquiera para el primer horario que haya', 'Quiero saber cuánto antes una masajista cuando puede ser', 'lunes q viene', 'me da igual dónde', 'no me importa la zona', 'en cualquier barrio', 'cuando haya', 'apenas haya', 'la primera que tenga', 'necesito una urgente', 'asignáme una', 'el que esté disponible', 'mandame cualquiera']
    const out = {}
    for (const f of frases) out[f] = extraerNecesidad(f, ahora)
    const candidatos = [{ name: 'Bongio' }, { name: 'Melina' }, { name: 'Sabrina' }]
    out.nombres = ['melna', 'con Melina', 'la melina', 'quiero a sabrina', 'bongi', 'mel'].map((t) => profesionalNombrado(t, candidatos)?.name ?? null)
    out.ambiguo = profesionalNombrado('melna', [{ name: 'Melina' }, { name: 'Melena' }])
    console.log(JSON.stringify(out))
  `)
  const lunes = '2026-09-28'
  const esperado = {
    'Necesito una masajista': { profession: 'masaje' },
    'El lunes que viene': { day: lunes, dayTo: null },
    'Lo antes posible': { asap: true },
    'Quiero una que venga ya': { urgent: true, asap: true, anyProvider: true },
    Cualquiera: { anyProvider: true },
    'La que sea': { anyProvider: true },
    'Me da igual quién': { anyProvider: true },
    'Melina ya mismo': { urgent: true, asap: true },
    'Quiero a Melina mañana': { day: '2026-09-26', dayTo: null },
    'El día más próximo': { asap: true },
    '¿Cuánto sale?': {},
    Ysk: {},
    masajsta: { profession: 'masaje' },
    melna: {},
    'la segunda': {},
    'la otra': {},
    'no importa quién, buscame una': { anyProvider: true },
    'mañana a la tarde cualquiera': { day: '2026-09-26', dayTo: null, time: { kind: 'between', from: '13:00', to: '20:00', part: 'tarde' }, anyProvider: true },
    'lunes después de las 18': { day: lunes, dayTo: null, time: { kind: 'from', from: '18:00', to: null } },
    'no mejor el martes': { day: '2026-09-29', dayTo: null },
    ahora: { urgent: true, asap: true },
    'lo antes posible con Melina': { asap: true },
    'la que esté disponible primero': { asap: true, anyProvider: true },
    'buscame cualquiera para el primer horario que haya': { asap: true, anyProvider: true },
    'Quiero saber cuánto antes una masajista cuando puede ser': { profession: 'masaje', asap: true },
    'lunes q viene': { day: lunes, dayTo: null },
    'me da igual dónde': { anyZone: true },
    'no me importa la zona': { anyZone: true },
    'en cualquier barrio': { anyZone: true },
    'cuando haya': { asap: true },
    'apenas haya': { asap: true },
    'la primera que tenga': { asap: true, anyProvider: true },
    'necesito una urgente': { urgent: true, asap: true },
    'asignáme una': { anyProvider: true },
    'el que esté disponible': { anyProvider: true },
    'mandame cualquiera': { anyProvider: true },
  }
  for (const [frase, datos] of Object.entries(esperado)) assert.deepEqual(r[frase], datos, frase)
  assert.deepEqual(r.nombres, ['Melina', 'Melina', 'Melina', 'Sabrina', 'Bongio', null], 'a first name, one typo of it, never a fragment too short to tell')
  assert.equal(r.ambiguo, null, 'two professionals one typo away: nobody is guessed')
})

test('ASISTENTE contexto CASO A: "cuánto antes" + "el día más próximo" + "lo antes posible" keep masaje and search forward from today; "¿otro día?" is never asked again', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const wa = nuevoContacto()
      const desde = dom.consultas.length
      const respuestas = []
      for (const t of ['Quiero saber cuánto antes una masajista cuando puede ser', 'El día más próximo', 'Lo antes posible']) respuestas.push((await whatsapp(wa, t)).text)
      out.respuestas = respuestas
      out.pedidas = pedidas(desde)
      const need = await necesidad(wa)
      out.estado = [need.profession, need.asap, need.day]
      // The screenshot conversation: a day with nothing, then the same short messages.
      const wa2 = nuevoContacto()
      const desde2 = dom.consultas.length
      const segunda = []
      for (const t of ['Quiero una masajista para hoy', 'El día más próximo', 'Lo antes posible']) segunda.push((await whatsapp(wa2, t)).text)
      out.segunda = segunda
      out.pedidas2 = pedidas(desde2)
    } finally {}
    console.log(JSON.stringify(out))
  `)
  const PRIMERA = 'Hoy no hay turnos libres. La primera disponibilidad de Masaje es mañana:\n1. Melina — Barrio Sur: 09:00, 10:15\nDecime con quién y a qué hora y te preparo la solicitud.'
  assert.deepEqual(r.respuestas, [PRIMERA, PRIMERA, PRIMERA], 'each message is the same need: the first real availability, never a question already answered')
  for (const texto of [...r.respuestas, ...r.segunda.slice(1)]) assert.doesNotMatch(texto, /¿Querés que busque otro día\?/u)
  assert.deepEqual(r.pedidas.slice(0, 2), [['2026-09-25', 'from:09:00-'], ['2026-09-26', null]], 'today from now, then tomorrow, from the backend')
  assert.deepEqual(r.estado, ['masaje', true, null])
  assert.match(r.segunda[0], /sin turnos libres hoy\. ¿Querés que busque otro día\?$/u, 'a day with nothing is said once')
  assert.equal(r.segunda[1], PRIMERA, '"el día más próximo" answers that question with the first free day')
  assert.equal(r.segunda[2], PRIMERA)
})

test('ASISTENTE contexto CASO B and "cualquiera": anyone with a free turno gets ONE concrete proposal; "sí" prepares the request card; nothing is requested before the card is confirmed', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = { cualquiera: {} }
    try {
      // CASO B, with the service said before.
      const wa = nuevoContacto()
      out.primero = (await whatsapp(wa, 'Necesito una masajista')).text
      await linkContact(wa, 'customer-user')
      const desde = dom.consultas.length
      out.ya = (await whatsapp(wa, 'Quiero una que venga ya')).text
      out.pedidas = pedidas(desde)
      const sugerida = (await conversationOf(wa)).state.suggestion
      out.sugerencia = [sugerida.kind, sugerida.name, sugerida.start === iso('2026-09-26', '09:00')]
      const tarjeta = await whatsapp(wa, 'sí')
      out.tarjeta = [tarjeta.type, tarjeta.text.split('\\n').slice(1, 4), dom.reservas.length]
      const listo = await whatsapp(wa, 'sí')
      out.listo = [dom.reservas.length, dom.reservas.at(-1)?.providerId, dom.reservas.at(-1)?.inicio === iso('2026-09-26', '09:00')]
      // Every "anyone" phrase after a list for Monday: the first start of that day, whoever it is.
      for (const t of ['Cualquiera', 'La que sea', 'Me da igual quién', 'no importa quién, buscame una', 'la que esté disponible primero', 'buscame cualquiera para el primer horario que haya', 'el que esté disponible']) {
        const w = nuevoContacto()
        await whatsapp(w, LUNES)
        out.cualquiera[t] = (await whatsapp(w, t)).text
      }
      // "mañana a la tarde cualquiera": nobody has an afternoon turno tomorrow; the real nearby ones.
      const w2 = nuevoContacto()
      await whatsapp(w2, 'Necesito una masajista')
      const d2 = dom.consultas.length
      out.tarde = (await whatsapp(w2, 'mañana a la tarde cualquiera')).text
      out.tardePedida = pedidas(d2)
      // "no": the proposal is dropped, the need stays.
      const w3 = nuevoContacto()
      await whatsapp(w3, LUNES)
      await whatsapp(w3, 'cualquiera')
      out.no = (await whatsapp(w3, 'no')).text
      out.noEstado = [(await conversationOf(w3)).state.suggestion, (await necesidad(w3)).profession]
    } finally {}
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.primero, '¿Para cuándo necesitás Masaje?')
  assert.equal(r.ya, 'Hoy no hay turnos libres. La primera opción que encontré es mañana a las 09:00 con Melina. ¿Querés esa?', 'masaje + ASAP + anyone: not "¿qué día?"')
  assert.deepEqual(r.pedidas, [['2026-09-25', 'from:09:00-'], ['2026-09-26', null]])
  assert.deepEqual(r.sugerencia, ['offer', 'Melina', true])
  assert.deepEqual(r.tarjeta, ['buttons', ['Prestador: Melina', 'Servicio: Masaje', 'Fecha: sábado 26 de septiembre'], 0], 'the request card; nothing requested yet')
  assert.deepEqual(r.listo, [1, 'perfil-melina', true], 'only the confirmed card requests the turno')
  const LUNES_BONGIO = 'La primera opción que encontré es el lunes 28/9 a las 09:30 con Bongio. ¿Querés esa?'
  for (const [frase, texto] of Object.entries(r.cualquiera)) assert.equal(texto, LUNES_BONGIO, frase)
  assert.match(r.tarde, /^No encontré turnos de Masaje mañana a la tarde\. Lo más cercano mañana:\n1\. Melina/u, 'nobody fits: the real nearby turnos, nothing invented')
  assert.deepEqual(r.tardePedida, [['2026-09-26', 'between:13:00-20:00']])
  assert.equal(r.no, 'Dale. ¿Preferís otro día, otro horario u otra profesional?')
  assert.deepEqual(r.noEstado, [null, 'masaje'])
})

test('ASISTENTE contexto CASO C and references: "Melina ya mismo", "melna", "la segunda", "la otra", "quiero a Melina mañana", "lo antes posible con Melina" use the list shown and never show it again', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const nuevo = async () => { const w = nuevoContacto(); out.lista = (await whatsapp(w, LUNES)).text; await linkContact(w, 'customer-user'); return w }
      let w = await nuevo()
      const ya = await whatsapp(w, 'Melina ya mismo')
      out.yaMismo = [ya.type, ya.text.split('\\n').slice(1, 5)]
      w = await nuevo()
      out.melna = (await whatsapp(w, 'melna')).text
      w = await nuevo()
      out.segunda = (await whatsapp(w, 'la segunda')).text
      out.otraDeTres = (await whatsapp(w, 'la otra')).text
      w = await nuevo()
      const antes = await whatsapp(w, 'lo antes posible con Melina')
      out.antesConMelina = [antes.type, antes.text.split('\\n').slice(3, 5)]
      w = await nuevo()
      const d = dom.consultas.length
      out.manana = (await whatsapp(w, 'Quiero a Melina mañana')).text
      out.mananaPedida = pedidas(d)
      out.mananaEstado = [(await necesidad(w)).providerName, (await necesidad(w)).day]
      // Two professionals listed: "no esa, la otra" is the other one.
      const w2 = nuevoContacto()
      out.martes = (await whatsapp(w2, 'Quiero una masajista para el martes')).text
      await linkContact(w2, 'customer-user')
      // Sabrina has no published price: with deposits a turno needs one (said, nothing prepared).
      out.segundaSinPrecio = (await whatsapp(w2, 'la segunda')).text
      const otra = await whatsapp(w2, 'no esa, la otra')
      out.otra = [otra.type, otra.text.split('\\n')[1], otra.text.split('\\n')[4]]
      out.reservas = dom.reservas.length
    } finally {}
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.lista, 'Encontré 3 profesionales de Masaje con turno el lunes 28/9:\n1. Bongio — Centro: 09:30\n2. Melina — Barrio Sur: 10:15, 11:00\n3. Sabrina — San Benito: 16:00, 19:00\nDecime con quién y a qué hora y te preparo la solicitud.')
  assert.deepEqual(r.yaMismo, ['buttons', ['Prestador: Melina', 'Servicio: Masaje', 'Fecha: lunes 28 de septiembre', 'Horario: 10:15']], 'Melina + her first start of that day: the card, without listing the three again')
  assert.equal(r.melna, '¿A qué hora con Melina? Tiene: 10:15, 11:00.', 'a typo of a name listed')
  assert.equal(r.segunda, '¿A qué hora con Melina? Tiene: 10:15, 11:00.')
  assert.equal(r.otraDeTres, '¿Con cuál? 1. Bongio · 3. Sabrina', 'three listed: which of the others, numbered as shown')
  assert.deepEqual(r.antesConMelina, ['buttons', ['Fecha: lunes 28 de septiembre', 'Horario: 10:15']])
  assert.equal(r.manana, '¿A qué hora con Melina? Tiene: 09:00, 10:15.', 'another day for her: her real times of that day')
  assert.deepEqual(r.mananaPedida, [['2026-09-26', null]])
  assert.deepEqual(r.mananaEstado, ['Melina', '2026-09-26'])
  assert.equal(r.martes, 'Encontré 2 profesionales de Masaje con turno el martes 29/9:\n1. Bongio — Centro: 18:30\n2. Sabrina — San Benito: 18:00\n¿Con cuál querés solicitar el turno?')
  assert.equal(r.segundaSinPrecio, 'El servicio Masaje todavía no tiene un precio publicado. Para solicitar un turno con seña, el prestador debe configurar el precio.')
  assert.deepEqual(r.otra, ['buttons', 'Prestador: Bongio', 'Horario: 18:30'], '"la otra" after choosing Sabrina is Bongio')
  assert.equal(r.reservas, 0, 'nothing was requested without the explicit confirmation')
})

test('ASISTENTE contexto CASO D price, CASO E unreadable message, changes of mind and combined messages', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // CASO D: the price of the service being talked about, never the account flow.
      let w = nuevoContacto()
      await whatsapp(w, LUNES)
      const d = dom.consultas.length
      const precio = await whatsapp(w, 'Y cuánto es el precio?')
      out.precio = [precio.type, precio.text, dom.consultas.length - d]
      await whatsapp(w, 'la segunda')
      out.precioMelina = (await whatsapp(w, '¿Cuánto sale?')).text
      // CASO E: an unreadable message gets a short question built from the state; "sí" acts on it.
      w = nuevoContacto()
      const pregunta = (await whatsapp(w, 'Necesito una masajista')).text
      const ysk = (await whatsapp(w, 'Ysk')).text
      out.ysk = [pregunta, ysk]
      out.yskSi = (await whatsapp(w, 'sí')).text
      // Combined: "el lunes" + "lo antes posible" + "con cualquiera" is ONE need.
      w = nuevoContacto()
      const pasos = []
      for (const t of ['Necesito una masajista', 'El lunes', 'Lo antes posible', 'Con cualquiera']) pasos.push((await whatsapp(w, t)).text.split('\\n')[0])
      out.combinado = pasos
      const need = await necesidad(w)
      out.combinadoEstado = [need.profession, need.day, need.asap, need.anyProvider]
      // "no mejor el martes": only the day changes; "cualquiera" is kept.
      out.martes = (await whatsapp(w, 'no mejor el martes')).text
      // "lunes después de las 18": a lower bound on that day.
      w = nuevoContacto()
      await whatsapp(w, 'Necesito una masajista')
      const d2 = dom.consultas.length
      out.despues18 = (await whatsapp(w, 'lunes después de las 18')).text
      out.despues18Pedida = pedidas(d2)
      // "ahora" with the service known: the first free turno from this moment on.
      w = nuevoContacto()
      await whatsapp(w, 'Necesito una masajista')
      const d3 = dom.consultas.length
      out.ahora = (await whatsapp(w, 'ahora')).text.split('\\n')[0]
      out.ahoraPedida = pedidas(d3).slice(0, 2)
    } finally {}
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.precio[0], 'text')
  assert.match(r.precio[1], /^Los precios de Masaje dependen del profesional:\n1\. Bongio: \$ ?18\.000\n2\. Melina: \$ ?20\.000\n3\. Sabrina: todavía sin precio publicado$/u, 'real prices of the professionals listed, and which one has none')
  assert.equal(r.precio[2], 0, 'a price question is not a new search')
  assert.match(r.precioMelina, /^Masaje con Melina: \$ ?20\.000\.$/u, 'the professional chosen')
  assert.equal(r.ysk[0], '¿Para cuándo necesitás Masaje?')
  assert.equal(r.ysk[1], 'No llegué a entender ese mensaje 😅. ¿Querés que busque el primer turno libre de Masaje con cualquier profesional?', 'not the last question again: a short question from the state')
  assert.equal(r.yskSi, 'Hoy no hay turnos libres. La primera opción que encontré es mañana a las 09:00 con Melina. ¿Querés esa?')
  assert.deepEqual(r.combinado, [
    '¿Para cuándo necesitás Masaje?',
    'Encontré 3 profesionales de Masaje con turno el lunes 28/9:',
    'La primera disponibilidad de Masaje es el lunes 28/9:',
    'La primera opción que encontré es el lunes 28/9 a las 09:30 con Bongio. ¿Querés esa?',
  ], 'each message adds to the same need; nothing is asked twice')
  assert.deepEqual(r.combinadoEstado, ['masaje', '2026-09-28', true, true])
  assert.equal(r.martes, 'La primera opción que encontré es el martes 29/9 a las 18:00 con Sabrina. ¿Querés esa?')
  // Only who fits the window is listed (ASISTENTE-CONTEXTO-02).
  assert.equal(r.despues18, 'Encontré 1 profesional de Masaje con turno el lunes 28/9 desde las 18:00:\n1. Sabrina — San Benito: 19:00\n¿Con cuál querés solicitar el turno?')
  assert.deepEqual(r.despues18Pedida, [['2026-09-28', 'from:18:00-']])
  assert.equal(r.ahora, 'Hoy no hay turnos libres. La primera disponibilidad de Masaje es mañana:')
  // The fixture clock moves six seconds per message: "now" is still 09:0x.
  assert.equal(r.ahoraPedida[0][0], '2026-09-25')
  assert.match(r.ahoraPedida[0][1], /^from:09:0\d-$/u, 'today, from the current time')
  assert.deepEqual(r.ahoraPedida[1], ['2026-09-26', null])
})

test('ASISTENTE contexto: a start taken meanwhile is never requested; the list is re-read before preparing (stale list) and a 409 SLOT_OCCUPIED proposes the next real start', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // Stale list: Bongio's 09:30 was taken after the list was shown.
      let w = nuevoContacto()
      await whatsapp(w, LUNES)
      await linkContact(w, 'customer-user')
      ocupados.add(iso('2026-09-28', '09:30'))
      out.vieja = (await whatsapp(w, 'la primera')).text
      out.viejaSi = (await whatsapp(w, 'sí')).text.split('\\n').slice(1, 5)
      ocupados.clear()
      // 409 between the card and the "sí": nothing requested, the next start of Melina proposed.
      w = nuevoContacto()
      await whatsapp(w, LUNES)
      await linkContact(w, 'customer-user')
      await whatsapp(w, 'la segunda')
      await whatsapp(w, '10:15')
      alReservar.add(iso('2026-09-28', '10:15'))
      ocupados.add(iso('2026-09-28', '10:15'))
      const antes = dom.reservas.length
      out.ocupado = (await whatsapp(w, 'sí')).text
      out.nadaPedido = dom.reservas.length - antes
      const tarjeta = await whatsapp(w, 'sí')
      out.siguiente = tarjeta.text.split('\\n').slice(3, 5)
      await whatsapp(w, 'sí')
      out.pedido = [dom.reservas.length - antes, dom.reservas.at(-1).inicio === iso('2026-09-28', '11:00')]
    } finally {}
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.vieja, 'Quiero verificar nuevamente porque la disponibilidad cambió: ese horario ya no está libre. El siguiente turno libre con Bongio es el martes 29/9 a las 18:30. ¿Querés ese?')
  assert.deepEqual(r.viejaSi, ['Prestador: Bongio', 'Servicio: Masaje', 'Fecha: martes 29 de septiembre', 'Horario: 18:30'])
  assert.equal(r.ocupado, 'Ese horario acaba de ocuparse. Busco el siguiente disponible. El siguiente turno libre con Melina es el lunes 28/9 a las 11:00. ¿Querés ese?')
  assert.equal(r.nadaPedido, 0, 'the 409 requested nothing')
  assert.deepEqual(r.siguiente, ['Fecha: lunes 28 de septiembre', 'Horario: 11:00'])
  assert.deepEqual(r.pedido, [1, true], 'only the confirmed next start is requested')
})
