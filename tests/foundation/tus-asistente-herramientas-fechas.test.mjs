import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { GENERAL_SETUP } from './fixtures/asistente-general.mjs'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-TOOLS-01. The model interprets language; the BACKEND knows. The current date, what a
// date expression means, the agenda of a professional, who is available, the first free turno,
// prices and requests are answered by tools over the backend, with an injected clock. Nothing is
// real because a model said it.
// Clock of the fixture: Tuesday 2026-10-06, 09:00 in Argentina.

const COMO_ELEGIR = 'Podés decirme el número, el nombre o el horario que preferís.'

test('FECHAS: the backend resolves "hoy", "mañana", "pasado mañana", weekdays, days of the month and weeks with a fixed clock; ambiguity is reported, never chosen', () => {
  const r = runTypeScriptScenario(`
    const { resolverExpresionFecha, fechaHoraActual, ZONA_HORARIA_TUS } = await import('./apps/api/src/tus/asistente/fechas.ts')
    const martes = Date.parse('2026-10-06T12:00:00.000Z')
    const ver = (expresion, ahora = martes) => { const x = resolverExpresionFecha(expresion, ahora); return [x.resolutionType, x.exactDate, x.fromDate, x.toDate, x.weekday, x.options.map((o) => o.date)] }
    const out = { zona: ZONA_HORARIA_TUS, ahora: fechaHoraActual(martes) }
    for (const expresion of ['hoy', 'mañana', 'pasado mañana', 'el jueves', 'este viernes', 'el martes', 'el martes que viene', 'el lunes que viene', 'el viernes que viene', 'el próximo viernes', 'el 12', 'el 12 de octubre', 'el 3', '12/10', 'la semana que viene', 'esta semana', 'el finde', 'mañana a la mañana', 'cuando puedas']) out[expresion] = ver(expresion)
    // D. Argentina near UTC midnight: 02:30 UTC of the 8th is 23:30 of Wednesday the 7th.
    const casiMedianoche = Date.parse('2026-10-08T02:30:00.000Z')
    out.medianoche = { ahora: fechaHoraActual(casiMedianoche), hoy: ver('hoy', casiMedianoche), manana: ver('mañana', casiMedianoche), pasado: ver('pasado mañana', casiMedianoche) }
    const yaJueves = Date.parse('2026-10-08T03:00:00.000Z')
    out.despues = { ahora: fechaHoraActual(yaJueves), manana: ver('mañana', yaJueves) }
    // The last day of a month and of a year.
    out.finDeMes = ver('mañana', Date.parse('2026-10-31T15:00:00.000Z'))
    out.finDeAnio = ver('pasado mañana', Date.parse('2026-12-31T02:00:00.000Z'))
    console.log(JSON.stringify(out))
  `)
  const exacta = (fecha, dia) => ['exact', fecha, fecha, fecha, dia, []]
  assert.equal(r.zona, 'America/Argentina/Buenos_Aires')
  assert.deepEqual(r.ahora, { timestamp: '2026-10-06T12:00:00.000Z', timezone: 'America/Argentina/Buenos_Aires', localDate: '2026-10-06', localTime: '09:00', weekday: 'martes' })
  assert.deepEqual(r.hoy, exacta('2026-10-06', 'martes'))
  assert.deepEqual(r['mañana'], exacta('2026-10-07', 'miércoles'), 'A')
  assert.deepEqual(r['pasado mañana'], exacta('2026-10-08', 'jueves'), 'B')
  assert.deepEqual(r['el jueves'], exacta('2026-10-08', 'jueves'), 'C')
  assert.deepEqual(r['este viernes'], exacta('2026-10-09', 'viernes'))
  assert.deepEqual(r['el martes'], exacta('2026-10-06', 'martes'), 'a weekday is its next occurrence, today included')
  assert.deepEqual(r['el martes que viene'], exacta('2026-10-13', 'martes'), 'said on a Tuesday, "que viene" is the Tuesday after')
  assert.deepEqual(r['el lunes que viene'], exacta('2026-10-12', 'lunes'), 'the coming Monday is already next week: no doubt')
  assert.deepEqual(r['el viernes que viene'], ['ambiguous', null, null, null, null, ['2026-10-09', '2026-10-16']], 'this week\'s Friday is still ahead: it may be that one or the next. Nothing is chosen')
  assert.deepEqual(r['el próximo viernes'], ['ambiguous', null, null, null, null, ['2026-10-09', '2026-10-16']])
  assert.deepEqual(r['el 12'], exacta('2026-10-12', 'lunes'))
  assert.deepEqual(r['el 12 de octubre'], exacta('2026-10-12', 'lunes'))
  assert.deepEqual(r['el 3'], exacta('2026-11-03', 'martes'), 'the 3rd already passed this month: the next one')
  assert.deepEqual(r['12/10'], exacta('2026-10-12', 'lunes'))
  assert.deepEqual(r['la semana que viene'], ['range', null, '2026-10-12', '2026-10-18', null, []])
  assert.deepEqual(r['esta semana'], ['range', null, '2026-10-06', '2026-10-11', null, []])
  assert.deepEqual(r['el finde'], ['range', null, '2026-10-10', '2026-10-11', null, []])
  assert.deepEqual(r['mañana a la mañana'], exacta('2026-10-07', 'miércoles'), '"a la mañana" is a part of the day; the other "mañana" is tomorrow')
  assert.deepEqual(r['cuando puedas'], ['unresolved', null, null, null, null, []], 'no date: said so, never guessed')
  assert.deepEqual([r.medianoche.ahora.localDate, r.medianoche.ahora.localTime, r.medianoche.ahora.weekday], ['2026-10-07', '23:30', 'miércoles'], 'D: still Wednesday in Argentina')
  assert.deepEqual([r.medianoche.hoy[1], r.medianoche.manana[1], r.medianoche.pasado[1]], ['2026-10-07', '2026-10-08', '2026-10-09'])
  assert.deepEqual([r.despues.ahora.localDate, r.despues.ahora.localTime, r.despues.manana[1]], ['2026-10-08', '00:00', '2026-10-09'], 'the day changes at midnight in Argentina, not in UTC')
  assert.equal(r.finDeMes[1], '2026-11-01')
  assert.equal(r.finDeAnio[1], '2027-01-01', '23:00 of December 30th in Argentina + 2 days')
})

test('TOOLS: get_current_datetime, resolve_date_expression and get_provider_availability answer from the backend with the injected clock; strict schemas; nothing of the past, nothing invented', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const { validarYEjecutar, HERRAMIENTAS, seleccionarHerramientas, definicionChat } = await import('./apps/api/src/tus/asistente/herramientas.ts')
    const actor = { contactId: 'c', conversationId: 'v', context: null, isProvider: false }
    const tool = async (name, args, now = waClock) => validarYEjecutar({ name, rawArguments: JSON.stringify(args), actor, domain: dominio, allowed: new Set(HERRAMIENTAS.map((t) => t.name)), timeoutMs: 5000, now })
    const out = {}
    out.nombres = HERRAMIENTAS.map((t) => t.name)
    out.buscar = seleccionarHerramientas('buscar', actor).map((t) => t.name)
    out.reserva = seleccionarHerramientas('reserva', actor).map((t) => t.name)
    out.ahora = await tool('get_current_datetime', {})
    out.manana = (await tool('resolve_date_expression', { expression: 'mañana' })).data
    out.ambigua = (await tool('resolve_date_expression', { expression: 'el viernes que viene' })).data.resolutionType
    // The clock is the one injected, not the machine's.
    out.otroReloj = (await tool('resolve_date_expression', { expression: 'mañana' }, () => Date.parse('2030-01-01T15:00:00.000Z'))).data.exactDate
    const dias = (x) => x.data.days.map((d) => [d.date, d.weekday, d.slots.map((s) => s.time)])
    const juan = await tool('get_provider_availability', { providerId: 'perfil-juan', profession: 'plomeria', fromDate: '2026-10-06', toDate: '2026-10-12', timeFrom: null, timeTo: null, daysOnly: null })
    out.juan = [juan.data.provider, juan.data.timezone, juan.data.takesAppointments, dias(juan)]
    out.juanIso = juan.data.days[0].slots[1].startsAt
    out.juanTarde = dias(await tool('get_provider_availability', { providerId: 'perfil-juan', profession: 'plomeria', fromDate: '2026-10-06', toDate: '2026-10-12', timeFrom: '10:00', timeTo: '13:00', daysOnly: null }))
    // Today's 08:00 of Tito already passed (it is 09:00): the past is never offered.
    out.tito = dias(await tool('get_provider_availability', { providerId: 'perfil-tito', profession: 'cerrajeria', fromDate: '2026-10-06', toDate: '2026-10-13', timeFrom: null, timeTo: null, daysOnly: null }))
    // A range in the past starts today; a long one is capped.
    const largo = await tool('get_provider_availability', { providerId: 'perfil-juan', profession: 'plomeria', fromDate: '2026-09-01', toDate: '2027-01-01', timeFrom: null, timeTo: null, daysOnly: null })
    out.largo = [largo.data.fromDate, largo.data.toDate]
    // A professional that is not of that service, or does not exist: no day, nothing made up.
    out.otroServicio = dias(await tool('get_provider_availability', { providerId: 'perfil-juan', profession: 'electricidad', fromDate: '2026-10-06', toDate: null, timeFrom: null, timeTo: null, daysOnly: null }))
    out.inexistente = dias(await tool('get_provider_availability', { providerId: 'perfil-nadie', profession: 'plomeria', fromDate: '2026-10-06', toDate: null, timeFrom: null, timeTo: null, daysOnly: null }))
    // Strict schemas: a date that is not a date, a trade that is not in the catalog, an extra field.
    out.invalidos = [
      (await tool('get_provider_availability', { providerId: 'perfil-juan', profession: 'plomeria', fromDate: 'mañana', toDate: null, timeFrom: null, timeTo: null, daysOnly: null })).error,
      (await tool('get_provider_availability', { providerId: 'perfil-juan', profession: 'astronautica', fromDate: '2026-10-06', toDate: null, timeFrom: null, timeTo: null, daysOnly: null })).error,
      (await tool('get_current_datetime', { timezone: 'UTC' })).error,
      (await tool('find_earliest_availability', { profession: 'inventado', providerId: null, when: null })).error,
    ]
    // The model sees the CURRENT catalog as the only possible services.
    out.enum = definicionChat(HERRAMIENTAS.find((t) => t.name === 'find_earliest_availability')).function.parameters.properties.profession.anyOf[0].enum.includes('jardineria')
    console.log(JSON.stringify(out))
  `)
  for (const nombre of ['get_current_datetime', 'resolve_date_expression', 'get_provider_availability', 'find_earliest_availability', 'find_appointments', 'search_services', 'search_providers', 'get_available_slots', 'book_appointment', 'get_pending_payments', 'verify_payment_status']) assert.ok(r.nombres.includes(nombre), `${nombre} is a tool of the assistant`)
  assert.equal(new Set(r.nombres).size, r.nombres.length, 'no duplicated tool')
  for (const nombre of ['get_current_datetime', 'resolve_date_expression', 'get_provider_availability', 'find_earliest_availability', 'find_appointments', 'book_appointment']) {
    assert.ok(r.buscar.includes(nombre), `${nombre} offered when searching`)
    assert.ok(r.reserva.includes(nombre), `${nombre} offered when booking`)
  }
  assert.deepEqual(r.ahora, { ok: true, data: { timestamp: '2026-10-06T12:00:00.000Z', timezone: 'America/Argentina/Buenos_Aires', localDate: '2026-10-06', localTime: '09:00', weekday: 'martes' } })
  assert.deepEqual([r.manana.resolutionType, r.manana.exactDate, r.manana.weekday, r.manana.timezone], ['exact', '2026-10-07', 'miércoles', 'America/Argentina/Buenos_Aires'])
  assert.equal(r.ambigua, 'ambiguous')
  assert.equal(r.otroReloj, '2030-01-02', 'the date comes from the injected clock')
  assert.deepEqual(r.juan, ['Juan Pérez', 'America/Argentina/Buenos_Aires', true, [['2026-10-08', 'jueves', ['09:00', '09:45', '10:30', '12:00']], ['2026-10-09', 'viernes', ['08:30']]]])
  assert.equal(r.juanIso, '2026-10-08T12:45:00.000Z', 'each time carries its exact start')
  assert.deepEqual(r.juanTarde, [['2026-10-08', 'jueves', ['10:30', '12:00']]])
  assert.deepEqual(r.tito, [['2026-10-13', 'martes', ['08:00']]], 'today 08:00 is the past at 09:00')
  assert.deepEqual(r.largo, ['2026-10-06', '2026-10-19'], 'from today, 14 days at most')
  assert.deepEqual(r.otroServicio, [])
  assert.deepEqual(r.inexistente, [])
  assert.deepEqual(r.invalidos, ['INVALID_ARGUMENTS', 'INVALID_ARGUMENTS', 'INVALID_ARGUMENTS', 'INVALID_ARGUMENTS'])
  assert.equal(r.enum, true)
})

test('MODELO + TOOLS (WhatsApp): the model only says WHAT to ask; days, times, the first turno and the request are the backend\'s — an invented or taken start is refused', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const conModelo = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat, embeddings, transcriptor: null, now: waClock, metric: (name, fields) => metrics.push({ name, ...fields }) })
    const colaModelo = conModelo.crearWorker({ owner: 'tools' })
    async function decir(waId, text) {
      await conModelo.ingreso.procesar(parsearWebhookMeta(inbound(waId, text), PHONE_ID), 'corr-tools')
      for (let i = 0; i < 5; i += 1) if ((await colaModelo.procesarSiguiente()).outcome === 'idle') break
      waAdvance(6000)
      return lastSent().message
    }
    // A message the fixed rules cannot read: only the model can say what is being asked.
    const VAGO = 'che, necesito que alguien me dé una mano con eso que te conté'
    const una = (toolCall, despues = 'no debería usarse') => (input) => input.messages.some((m) => m.role === 'tool') ? { content: despues } : { toolCalls: [toolCall] }
    const out = {}
    // E / F. The agenda of one professional: asked by the model, read and rendered by the backend.
    let w = nuevoContacto()
    script = una(llamada('get_provider_availability', { providerId: 'perfil-juan', profession: 'plomeria', fromDate: '2026-10-06', toDate: '2026-10-12', timeFrom: null, timeTo: null, daysOnly: true }), 'Juan puede todos los días a las 7:00')
    out.dias = (await decir(w, VAGO)).text
    script = una(llamada('get_provider_availability', { providerId: 'perfil-juan', profession: 'plomeria', fromDate: '2026-10-08', toDate: '2026-10-08', timeFrom: null, timeTo: null, daysOnly: null }), 'Juan tiene 09:00 y también 17:00')
    out.jueves = (await decir(w, VAGO)).text
    const estado = await estadoDe(w)
    out.estado = [estado.need.profession, estado.need.providerName, estado.chosenProviderId, estado.offers.items.map((i) => [i.day, i.starts.length])]
    // H. A time on its own afterwards keeps the day and the professional, with no model at all.
    await linkContact(w, 'customer-user')
    script = () => { throw new Error('the model must not be called for a time of the options shown') }
    const tarjeta = await decir(w, '9:45')
    out.tarjeta = [tarjeta.type, tarjeta.text.split('\\n').slice(1, 6)]
    // G. The first free turno, in time order, whoever has it.
    w = nuevoContacto()
    const desde = dom.consultas.length
    script = una(llamada('find_earliest_availability', { profession: 'electricidad', providerId: null, when: null }), 'El primero es hoy a las 8')
    out.primero = (await decir(w, VAGO)).text.split('\\n')[0]
    out.primeroPedidas = dom.consultas.slice(desde).map((c) => c.day)
    //    ...of one professional, and with a part of the day (its bounds are the backend's).
    w = nuevoContacto()
    script = una(llamada('find_earliest_availability', { profession: 'electricidad', providerId: 'perfil-laura', when: 'a la tarde' }))
    out.primeroDeLaura = (await decir(w, VAGO)).text
    out.franja = dom.consultas.at(-1).time
    //    A professional id the backend does not know is not a professional.
    w = nuevoContacto()
    script = una(llamada('find_earliest_availability', { profession: 'electricidad', providerId: 'perfil-inventado', when: null }))
    out.idInventado = (await decir(w, VAGO)).text.split('\\n')[0]
    // An ambiguous date passed by the model is not resolved by anyone: the person is asked.
    w = nuevoContacto()
    script = una(llamada('find_appointments', { profession: 'plomeria', when: 'el viernes que viene', zone: null, anyZone: null }))
    out.ambigua = (await decir(w, VAGO)).text
    script = () => { throw new Error('the model must not be called to read the answer') }
    out.ambiguaElegida = (await decir(w, 'el 9')).text.split('\\n')[0]
    // K. The model asks to book a start that does not exist: refused, the real ones offered.
    w = nuevoContacto()
    await decir(w, 'Necesito un electricista')
    await linkContact(w, 'customer-user')
    script = una(llamada('book_appointment', { providerId: 'perfil-laura', profession: 'electricidad', startsAt: iso('2026-10-08', '13:00') }))
    out.inventado = (await decir(w, VAGO)).text
    //    ...or one in the past, or one that was taken meanwhile (J).
    script = una(llamada('book_appointment', { providerId: 'perfil-laura', profession: 'electricidad', startsAt: iso('2026-10-05', '14:00') }))
    out.pasado = (await decir(w, VAGO)).text
    ocupados.add(iso('2026-10-08', '16:00'))
    script = una(llamada('book_appointment', { providerId: 'perfil-laura', profession: 'electricidad', startsAt: iso('2026-10-08', '16:00') }))
    out.ocupado = (await decir(w, VAGO)).text
    ocupados.clear()
    out.reservas = dom.reservas.length
    out.bloqueos = metrics.filter((m) => m.name === 'assistant.invented_time_blocked').length
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.dias, 'Esta semana Juan Pérez tiene disponibilidad de Plomería el jueves 8 y el viernes 9. ¿Qué día preferís?', 'E: the real days, written by the backend (not the model\'s "todos los días")')
  assert.doesNotMatch(r.dias, /\d\d:\d\d|7:00/u, 'days were asked: no times, and none invented')
  assert.equal(r.jueves, `Hay disponibilidad de Plomería con Juan Pérez el jueves 8:\n\n1. Juan Pérez: 09:00, 09:45, 10:30, 12:00\n\n${COMO_ELEGIR}`, 'F: the real times of Thursday; the model\'s 17:00 never reaches the person')
  assert.deepEqual(r.estado, ['plomeria', 'Juan Pérez', 'perfil-juan', [['2026-10-08', 4]]], 'what the tool returned is the structured state')
  assert.deepEqual(r.tarjeta, ['buttons', ['Prestador: Juan Pérez', 'Servicio: Plomería', 'Fecha: jueves 8 de octubre', 'Horario: 09:45', 'Precio: $200']], 'H: "9:45" is Thursday 9:45 with Juan; the price is the backend\'s')
  assert.equal(r.primero, 'La primera disponibilidad de Electricidad es el jueves 8 a las 09:00 con Omar Ríos.', 'G: the first real start in time order')
  assert.deepEqual(r.primeroPedidas, ['2026-10-06', '2026-10-07', '2026-10-08'], 'the backend walked the calendar; nobody was told "hoy no hay"')
  assert.equal(r.primeroDeLaura, 'La primera disponibilidad es el jueves 8 a las 14:00 con Laura Gómez. ¿Querés esa?')
  assert.deepEqual(r.franja, { kind: 'between', from: '13:00', to: '20:00' }, '"a la tarde" has the bounds the backend defines')
  assert.equal(r.idInventado, 'La primera disponibilidad de Electricidad es el jueves 8 a las 09:00 con Omar Ríos.', 'an unknown id is ignored: the real professionals of the service')
  assert.equal(r.ambigua, '¿El viernes 9 o el viernes 16 de octubre?')
  assert.equal(r.ambiguaElegida, 'Encontré 2 profesionales de Plomería con turno el viernes 9:')
  assert.equal(r.inventado, 'Ese horario no está disponible. El siguiente turno libre con Laura Gómez es el jueves 8 a las 14:00. ¿Querés ese?', 'K: 13:00 is not a start of her agenda')
  assert.match(r.pasado, /^Ese horario no está disponible\./u)
  assert.equal(r.ocupado, 'Ese horario no está disponible. El siguiente turno libre con Laura Gómez es el jueves 8 a las 14:00. ¿Querés ese?', 'J: taken meanwhile')
  assert.equal(r.reservas, 0, 'nothing was requested')
})

test('MODELO: a reply may only mention times the tools returned ("también hay a las 10" is dropped)', () => {
  const r = runTypeScriptScenario(`
    const { horasInventadas } = await import('./apps/api/src/tus/asistente/orquestador.ts')
    const reales = new Set(['09:00', '09:30', '16:00'])
    const casos = ['Tenés 09:00 y 09:30.', 'Hay lugar a las 9:30 y a las 16.', 'Tenés 09:00 y también hay 10:00.', 'Podés venir a las 10.', 'A las 16 con Laura, sale $200.', 'El jueves 8 hay dos turnos.', 'Te queda a las 9.30 o 21.15']
    console.log(JSON.stringify(Object.fromEntries(casos.map((texto) => [texto, horasInventadas(texto, reales)]))))
  `)
  assert.deepEqual(r, {
    'Tenés 09:00 y 09:30.': false,
    'Hay lugar a las 9:30 y a las 16.': false,
    'Tenés 09:00 y también hay 10:00.': true,
    'Podés venir a las 10.': true,
    'A las 16 con Laura, sale $200.': false,
    'El jueves 8 hay dos turnos.': false,
    'Te queda a las 9.30 o 21.15': true,
  })
})

// The conversation of the request, end to end, WITHOUT a model: every date, day, time, option,
// price and the request itself come from the backend.
test('CONVERSACIÓN COMPLETA: electricista -> qué días -> jueves -> 16 -> la segunda -> revalidation -> price -> request, with no model and nothing invented', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    AGENDA.push({ id: 'perfil-nico', name: 'Nicolás Paz', area: 'Molina Punta', oficio: 'electricidad', profesion: 'Electricista', semana: { 4: ['16:00'], 5: ['10:00'] }, precio: 200 })
    const out = {}
    const w = nuevoContacto()
    const pasos = []
    for (const texto of ['Necesito un electricista', '¿Qué días hay?', 'jueves', '16', 'la segunda']) {
      const desde = dom.consultas.length
      const m = await whatsapp(w, texto)
      if (texto === 'Necesito un electricista') await linkContact(w, 'customer-user')
      pasos.push({ texto, tipo: m.type, respuesta: m.text, consultas: dom.consultas.slice(desde).map((c) => [c.profession, c.day, c.time?.from ?? null]) })
    }
    out.pasos = pasos
    const estado = await estadoDe(w)
    out.estado = [estado.need.profession, estado.need.day, estado.need.time, estado.chosenProviderId]
    out.antes = dom.reservas.length
    // The start is taken between the card and the "sí": nothing is requested, alternatives offered.
    alReservar.add(iso('2026-10-08', '16:00'))
    ocupados.add(iso('2026-10-08', '16:00'))
    out.ocupado = (await whatsapp(w, 'sí')).text
    out.trasOcupado = dom.reservas.length
    alReservar.clear(); ocupados.clear()
    // A fresh conversation reaches the request.
    const z = nuevoContacto()
    await whatsapp(z, 'Necesito un electricista')
    await linkContact(z, 'customer-user')
    await charla(z, ['jueves', '16', 'la segunda'])
    out.listo = (await whatsapp(z, 'sí')).text
    out.reserva = dom.reservas.map((x) => [x.subjectId, x.providerId, x.oficioId, x.inicio === iso('2026-10-08', '16:00')])
    console.log(JSON.stringify(out))
  `)
  const [necesito, dias, jueves, hora, segunda] = r.pasos
  assert.equal(necesito.respuesta.split('\n')[0], 'Hay disponibilidad de Electricidad:')
  assert.equal(dias.respuesta, 'Esta semana hay disponibilidad de Electricidad el jueves 8 y el viernes 9. ¿Qué día preferís?')
  assert.equal(jueves.respuesta, 'Encontré 3 profesionales de Electricidad con turno el jueves 8:\n1. Laura Gómez — Centro: 14:00, 16:00\n2. Omar Ríos — San Benito: 09:00, 10:30\n3. Nicolás Paz — Molina Punta: 16:00\nDecime con quién y a qué hora y te preparo la solicitud.')
  assert.deepEqual(jueves.consultas, [['electricidad', '2026-10-08', null]], 'Thursday is the backend\'s Thursday')
  assert.equal(hora.respuesta, 'Encontré 2 profesionales de Electricidad con turno el jueves 8 a las 16:00:\n1. Laura Gómez — Centro: 16:00\n2. Nicolás Paz — Molina Punta: 16:00\n¿Con cuál querés solicitar el turno?', '"16" is 16:00 of the Thursday shown; only who has it')
  assert.deepEqual(hora.consultas, [['electricidad', '2026-10-08', '16:00']])
  assert.equal(segunda.tipo, 'buttons')
  assert.deepEqual(segunda.respuesta.split('\n').slice(1, 7), ['Prestador: Nicolás Paz', 'Servicio: Electricidad', 'Fecha: jueves 8 de octubre', 'Horario: 16:00', 'Precio: $200', 'Seña: $100 (se abona cuando el prestador acepte)'], 'option 2 of the list shown, with the backend\'s price and deposit')
  assert.deepEqual(segunda.consultas, [], 'choosing does not search again')
  assert.deepEqual(r.estado, ['electricidad', '2026-10-08', { kind: 'exact', from: '16:00', to: null }, 'perfil-nico'])
  assert.equal(r.antes, 0, 'nothing requested before the "sí"')
  assert.match(r.ocupado, /^Ese horario acaba de dejar de estar disponible\./u)
  assert.equal(r.trasOcupado, 0, 'a start taken meanwhile is never requested')
  assert.match(r.listo, /solicitud|Solicitud|pendiente/u)
  assert.deepEqual(r.reserva, [['customer-user', 'perfil-nico', 'electricidad', true]], 'the request is the backend\'s, for the linked account')
})

test('ARQUITECTURA: no date arithmetic and no machine clock inside the assistant outside its calendar module; prompts carry no hardcoded date, time or price', () => {
  const dir = join(root, 'apps/api/src/tus/asistente')
  const leer = (archivo) => readFileSync(join(dir, archivo), 'utf8').replace(/\/\/[^\n]*/gu, '')
  // The conversation, the tools and the texts read the clock they are given.
  for (const archivo of ['orquestador.ts', 'busqueda.ts', 'necesidad.ts', 'herramientas.ts', 'solicitud-turno.ts']) {
    const codigo = leer(archivo)
    assert.doesNotMatch(codigo, /Date\.now\(\)/u, `${archivo}: reads the machine clock instead of the injected one`)
    assert.doesNotMatch(codigo, /new Date\(\)/u, `${archivo}: builds "now" by itself`)
  }
  // The only place that knows what a date expression means.
  assert.match(leer('fechas.ts'), /export function leerFecha/u)
  for (const archivo of ['orquestador.ts', 'busqueda.ts', 'necesidad.ts', 'herramientas.ts']) assert.doesNotMatch(leer(archivo), /pasado manana|fin de semana\|finde/u, `${archivo}: resolves a date expression outside fechas.ts`)
  const orquestador = leer('orquestador.ts')
  const prompt = /const REGLAS_PROMPT_SISTEMA = \[([\s\S]*?)\n\]/u.exec(orquestador)[1]
  assert.doesNotMatch(prompt, /20\d\d-\d\d-\d\d|\$ ?\d|\b\d{1,2}:\d{2}\b/u, 'no date, price or time is written into the system prompt')
  assert.match(prompt, /get_current_datetime y resolve_date_expression/u)
  assert.match(prompt, /Solo existen los días y horarios que devolvió una herramienta/u)
})
