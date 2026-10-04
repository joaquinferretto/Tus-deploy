import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { GENERAL_SETUP } from './fixtures/asistente-general.mjs'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-GENERAL-01. The WhatsApp assistant is not "a massage bot": the same flow works for
// ANY service of the catalog, and no service is ever assumed. Availability is told with the real
// days of the calendar (Argentina), a time said on its own keeps the day that was shown, a number
// is the option at that place, and nothing already known is asked or listed again.
// Clock of the fixture: Tuesday 2026-10-06, 09:00 in Argentina (Thursday 8, Friday 9).

const COMO_ELEGIR = 'Podés decirme el número, el nombre o el horario que preferís.'
const PREGUNTA = '¿Qué servicio necesitás? Por ejemplo: Plomería, Electricidad, Aire acondicionado, Pintura, Albañilería, Cerrajería.'
const PLOMERIA = `Hay disponibilidad de Plomería:\n\nJueves 8\n1. Juan Pérez — Centro: 09:00, 09:45, 10:30, 12:00\n2. María Gómez — Barrio Sur: 09:45, 11:00, 14:00\n3. Pedro Díaz — Cambá Cuá: 09:45\n\nViernes 9\n4. Juan Pérez — Centro: 08:30\n5. Pedro Díaz — Cambá Cuá: 08:30, 09:30\n\n${COMO_ELEGIR}`

test('ASISTENTE general: no production code of the assistant names a trade; "Masaje" is never a literal, a default or a fallback', () => {
  const archivos = ['orquestador.ts', 'busqueda.ts', 'necesidad.ts', 'solicitud-turno.ts', 'herramientas.ts', 'modelo.ts', 'dominio.ts', 'composicion.ts', 'web.ts', 'ingreso.ts']
  for (const archivo of archivos) {
    const codigo = readFileSync(join(root, 'apps/api/src/tus/asistente', archivo), 'utf8')
      // Comments may give examples; code may not.
      .replace(/\/\/[^\n]*/gu, '')
    assert.doesNotMatch(codigo, /masaj|masseu/iu, `${archivo}: a trade name in code (regex, text or default)`)
  }
})

test('ASISTENTE general: with no service said, the service is asked (with real services of the catalog) and nothing is assumed or searched', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const out = {}
    for (const texto of ['Hola', 'Buenas tardes', 'Necesito ayuda', 'me podés ayudar?', 'necesito un astronauta', 'busco un domador de leones']) {
      const w = nuevoContacto()
      const m = await whatsapp(w, texto)
      const estado = await estadoDe(w)
      out[texto] = [m.text, estado.need?.profession ?? null, estado.offers?.items.length ?? 0]
    }
    out.consultas = dom.consultas.length
    // A greeting in the middle of a search opens a new conversation: the old service is dropped.
    const w = nuevoContacto()
    await whatsapp(w, 'Necesito una masajista')
    const saludo = await whatsapp(w, 'Hola')
    out.saludoTrasBusqueda = [saludo.text, (await estadoDe(w)).need ?? null]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.Hola, [`¡Hola! Soy el asistente de TUS. ${PREGUNTA}`, null, 0])
  assert.deepEqual(r['Buenas tardes'], [`¡Hola! Soy el asistente de TUS. ${PREGUNTA}`, null, 0])
  assert.deepEqual(r['Necesito ayuda'], [PREGUNTA, null, 0])
  assert.deepEqual(r['me podés ayudar?'], [PREGUNTA, null, 0])
  // A service TUS does not have is not turned into one that it has.
  assert.deepEqual(r['necesito un astronauta'], [`No encontré ese servicio en TUS. ${PREGUNTA}`, null, 0])
  assert.deepEqual(r['busco un domador de leones'], [`No encontré ese servicio en TUS. ${PREGUNTA}`, null, 0])
  assert.equal(r.consultas, 0, 'nothing was searched: there was no service to search')
  for (const [texto, [respuesta]] of Object.entries(r).filter(([, valor]) => Array.isArray(valor) && typeof valor[0] === 'string')) assert.doesNotMatch(respuesta, /Masaje|masajista/u, texto)
  assert.deepEqual(r.saludoTrasBusqueda, [`¡Hola! Soy el asistente de TUS. ${PREGUNTA}`, null])
})

test('ASISTENTE general: the same flow for different services — plumbing, electricity, massage, gardening — each searched as itself, with general wording', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const out = {}
    const casos = {
      plomeria: 'Necesito un plomero',
      electricidad: 'Necesito un electricista',
      masaje: 'Necesito una masajista',
      jardineria: 'Busco alguien que me corte el pasto',
    }
    for (const [oficio, texto] of Object.entries(casos)) {
      const w = nuevoContacto()
      const desde = dom.consultas.length
      const m = await whatsapp(w, texto)
      out[oficio] = [m.text, [...new Set(dom.consultas.slice(desde).map((c) => c.profession))], (await estadoDe(w)).need.profession]
    }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.plomeria, [PLOMERIA, ['plomeria'], 'plomeria'])
  assert.deepEqual(r.electricidad, [`Hay disponibilidad de Electricidad el jueves 8:\n\n1. Laura Gómez — Centro: 14:00, 16:00\n2. Omar Ríos — San Benito: 09:00, 10:30\n\n${COMO_ELEGIR}`, ['electricidad'], 'electricidad'])
  assert.deepEqual(r.masaje, [`Hay disponibilidad de Masaje mañana miércoles 7:\n\n1. Melina — Barrio Sur: 09:00, 09:15, 09:30, 09:45\n2. Sabrina — San Benito: 09:45, 10:00\n3. Bongio — Centro: 09:45\n\n${COMO_ELEGIR}`, ['masaje'], 'masaje'], 'massage still works when it is what was asked')
  assert.deepEqual(r.jardineria, [`Hay disponibilidad de Jardinería el lunes 12:\n\n1. Rosa Vera — Laguna Seca: 10:00, 11:00\n\n${COMO_ELEGIR}`, ['jardineria'], 'jardineria'], 'a description of the need is resolved against the catalog, and next week is reached')
  for (const [oficio, [texto]] of Object.entries(r)) {
    assert.doesNotMatch(texto, /masajista|plomero|electricista|jardinero/iu, `${oficio}: professionals are named in general terms`)
    if (oficio !== 'masaje') assert.doesNotMatch(texto, /Masaje/u, `${oficio}: never massage`)
  }
})

test('ASISTENTE disponibilidad: real days of the calendar — several days, one day, nothing today, "lo antes posible", next week, never a bare "mañana"', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const out = {}
    // E. "lo antes posible": the first real turno, in time order, with its real day and professional.
    out.asap = (await whatsapp(nuevoContacto(), 'Necesito un plomero lo antes posible')).text
    out.primerTurno = (await whatsapp(nuevoContacto(), 'quiero el primer turno disponible de electricista')).text
    // D. Nothing today (Tuesday) nor tomorrow: said once, with the days that do have turnos.
    const w = nuevoContacto()
    const desde = dom.consultas.length
    out.hoy = (await whatsapp(w, 'Necesito un plomero para hoy')).text
    out.hoyPedidas = dom.consultas.slice(desde).map((c) => c.day)
    // G. "qué horarios tiene el jueves": the times of that day.
    out.jueves = (await whatsapp(nuevoContacto(), 'qué horarios hay de plomería el jueves')).text
    // H. The only turnos are a week away: the month is said, so the day cannot be misread.
    out.semanaQueViene = (await whatsapp(nuevoContacto(), 'necesito un cerrajero')).text
    // A part of the day with no day: only the days that have turnos then.
    out.tarde = (await whatsapp(nuevoContacto(), 'necesito un plomero a la tarde')).text
    // A service with professionals but nothing free in the two weeks walked.
    AGENDA.push({ id: 'perfil-lleno', name: 'Lleno', area: 'Centro', oficio: 'pintura', profesion: 'Pintor/a', semana: {}, precio: 200 })
    const d2 = dom.consultas.length
    out.sinNada = (await whatsapp(nuevoContacto(), 'necesito un pintor')).text
    out.sinNadaDias = dom.consultas.length - d2
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.asap, `La primera disponibilidad de Plomería es el jueves 8 a las 09:00 con Juan Pérez.\n\nOpciones de ese día:\n1. Juan Pérez — Centro: 09:00, 09:45, 10:30, 12:00\n2. María Gómez — Barrio Sur: 09:45, 11:00, 14:00\n3. Pedro Díaz — Cambá Cuá: 09:45\n\n${COMO_ELEGIR}`)
  assert.match(r.primerTurno, /^La primera disponibilidad de Electricidad es el jueves 8 a las 09:00 con Omar Ríos\./u, 'the earliest start, whoever has it')
  assert.equal(r.hoy, `Hoy martes 6 no hay turnos libres. ${PLOMERIA}`, 'a day with nothing is said once, together with the real days that have turnos')
  assert.deepEqual(r.hoyPedidas, ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'], 'the day asked, then the calendar forward: the following seven days, read from the backend')
  assert.equal(r.jueves, 'Encontré 3 profesionales de Plomería con turno el jueves 8:\n1. Juan Pérez — Centro: 09:00, 09:45, 10:30, 12:00\n2. María Gómez — Barrio Sur: 09:45, 11:00, 14:00\n3. Pedro Díaz — Cambá Cuá: 09:45\nDecime con quién y a qué hora y te preparo la solicitud.')
  assert.equal(r.semanaQueViene, 'La primera disponibilidad es el martes 13 de octubre a las 08:00 con Tito Sosa. ¿Querés esa?', 'today 08:00 already passed: the next real one, a week ahead, with its month')
  assert.equal(r.tarde, 'La primera disponibilidad es el jueves 8 a las 14:00 con María Gómez. ¿Querés esa?', 'one single turno fits: it is proposed as it is')
  assert.equal(r.sinNada, 'No encontré turnos libres de Pintura en los próximos 14 días.')
  assert.equal(r.sinNadaDias, 14)
  for (const texto of [r.asap, r.primerTurno, r.hoy, r.jueves, r.semanaQueViene, r.tarde]) {
    assert.doesNotMatch(texto, /mañana(?! (?:lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d)/u, '"mañana" is never said without its real day')
    assert.doesNotMatch(texto, /¿Para cuándo|¿Querés que busque otro día/u, 'the day is never asked')
  }
})

test('ASISTENTE disponibilidad: "¿qué días atiende?" answers the days (no times), in general or for one professional; "¿qué horarios?" answers the times', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const out = {}
    const w = nuevoContacto()
    await whatsapp(w, 'Necesito un plomero')
    out.dias = (await whatsapp(w, '¿Qué días atienden?')).text
    // One professional chosen: HIS calendar.
    await whatsapp(w, 'María')
    out.diasDeMaria = (await whatsapp(w, '¿y qué días atiende?')).text
    out.diasDeJuan = (await whatsapp(w, 'qué días atiende Juan?')).text
    // One day only: "sí" shows its times.
    const e = nuevoContacto()
    await whatsapp(e, 'Necesito un electricista')
    out.unDia = (await whatsapp(e, 'qué días hay?')).text
    out.unDiaSi = (await whatsapp(e, 'sí')).text
    // "qué horarios" with no day known: the next days, compact. With the day known: that day.
    const h = nuevoContacto()
    await whatsapp(h, 'Necesito un plomero lo antes posible')
    out.horariosSinDia = (await whatsapp(h, '¿qué horarios hay?')).text
    await whatsapp(h, 'el viernes')
    out.horariosConDia = (await whatsapp(h, 'qué horarios hay?')).text
    // The service is not known: the service is asked, the days of nothing are not made up.
    out.sinServicio = (await whatsapp(nuevoContacto(), '¿qué días atienden?')).text
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.dias, 'Esta semana hay disponibilidad de Plomería el jueves 8 y el viernes 9. ¿Qué día preferís?')
  assert.doesNotMatch(r.dias, /\d\d:\d\d/u, 'only days were asked: no times')
  assert.equal(r.diasDeMaria, 'Esta semana María Gómez tiene disponibilidad de Plomería el jueves 8. ¿Te muestro los horarios de ese día?', 'the chosen professional: her own calendar')
  assert.equal(r.diasDeJuan, 'Esta semana Juan Pérez tiene disponibilidad de Plomería el jueves 8 y el viernes 9. ¿Qué día preferís?')
  assert.equal(r.unDia, 'Esta semana hay disponibilidad de Electricidad el jueves 8. ¿Te muestro los horarios de ese día?')
  assert.equal(r.unDiaSi, 'Encontré 2 profesionales de Electricidad con turno el jueves 8:\n1. Laura Gómez — Centro: 14:00, 16:00\n2. Omar Ríos — San Benito: 09:00, 10:30\nDecime con quién y a qué hora y te preparo la solicitud.')
  assert.equal(r.horariosSinDia, PLOMERIA)
  assert.equal(r.horariosConDia, 'Encontré 2 profesionales de Plomería con turno el viernes 9:\n1. Juan Pérez — Centro: 08:30\n2. Pedro Díaz — Cambá Cuá: 08:30, 09:30\nDecime con quién y a qué hora y te preparo la solicitud.')
  assert.match(r.sinServicio, /¿Qué servicio necesitás\?/u)
})

// The conversation of the screenshot, as a permanent regression: a list for a day, a time on its
// own, then a number. The time keeps the DAY THAT WAS SHOWN (never "hoy"), the number is the
// option at that place, and service, day, time and professional reach the request with its price.
test('ASISTENTE regresión de la captura: list for tomorrow -> "9:45" keeps that day -> "2" is the second option -> price $200 and the request goes on', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const out = {}
    const w = nuevoContacto()
    out.lista = (await whatsapp(w, 'Quiero una masajista lo antes posible')).text
    await linkContact(w, 'customer-user')
    const desde = dom.consultas.length
    out.hora = (await whatsapp(w, '9:45')).text
    out.horaPedidas = dom.consultas.slice(desde).map((c) => [c.day, c.time?.kind, c.time?.from])
    const need = (await estadoDe(w)).need
    out.estadoTrasHora = [need.profession, need.day, need.time, need.asap]
    const antes = dom.consultas.length
    const tarjeta = await whatsapp(w, '2')
    out.tarjeta = [tarjeta.type, tarjeta.text]
    out.sinNuevaBusqueda = dom.consultas.length - antes
    out.sinReservaAun = dom.reservas.length
    await whatsapp(w, 'sí')
    out.reserva = dom.reservas.map((x) => [x.subjectId, x.providerId, x.oficioId, x.inicio === iso('2026-10-07', '09:45')])
    // The same with an unlinked WhatsApp: the choice and its price are told, the link is asked.
    const u = nuevoContacto()
    await charla(u, ['Quiero una masajista lo antes posible', '9:45'])
    const sinVinculo = await whatsapp(u, '2')
    out.sinVinculo = [sinVinculo.type, sinVinculo.text.split('\\n').slice(0, 2)]
    out.reservasSinVinculo = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.lista, `La primera disponibilidad de Masaje es mañana miércoles 7 a las 09:00 con Melina.\n\nOpciones de ese día:\n1. Melina — Barrio Sur: 09:00, 09:15, 09:30, 09:45\n2. Sabrina — San Benito: 09:45, 10:00\n3. Bongio — Centro: 09:45\n\n${COMO_ELEGIR}`)
  assert.equal(r.hora, 'Encontré 3 profesionales de Masaje con turno mañana miércoles 7 a las 09:45:\n1. Melina — Barrio Sur: 09:45\n2. Sabrina — San Benito: 09:45\n3. Bongio — Centro: 09:45\n¿Con cuál querés solicitar el turno?')
  assert.doesNotMatch(r.hora, /[Hh]oy/u, '"9:45" is 9:45 of the day that was shown, never today')
  assert.deepEqual(r.horaPedidas, [['2026-10-07', 'exact', '09:45']], 'the backend was asked for the day shown, and only for it')
  assert.deepEqual(r.estadoTrasHora, ['masaje', '2026-10-07', { kind: 'exact', from: '09:45', to: null }, false], 'service, day and time are structured state')
  assert.equal(r.tarjeta[0], 'buttons')
  assert.equal(r.tarjeta[1], 'Vas a solicitar:\nPrestador: Sabrina\nServicio: Masaje\nFecha: miércoles 7 de octubre\nHorario: 09:45\nPrecio: $200\nSeña: $100 (se abona cuando el prestador acepte)\nLa solicitud queda pendiente hasta que el prestador la acepte. El turno se confirma después del pago de la seña.\n¿Querés solicitar este turno?', '"2" is the second option shown, with the day, the time and the real price')
  assert.equal(r.sinNuevaBusqueda, 0, 'choosing a number does not search professionals again')
  assert.equal(r.sinReservaAun, 0)
  assert.deepEqual(r.reserva, [['customer-user', 'perfil-sabrina', 'masaje', true]])
  assert.deepEqual(r.sinVinculo, ['cta_url', ['Perfecto: Sabrina, mañana miércoles 7 a las 09:45.', 'El servicio cuesta $200 y la seña es de $100.']], 'a personal action needs the account: said with what was chosen and its price')
  assert.equal(r.reservasSinVinculo, 1, 'nothing is requested for an unlinked WhatsApp')
})

test('ASISTENTE selección: "1/2/3", "la segunda", a name, "el de Barrio Sur", "2 a las 16", "la otra" resolve against the options really shown, for any service', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const out = {}
    const nuevo = async (texto) => { const w = nuevoContacto(); await whatsapp(w, texto); await linkContact(w, 'customer-user'); return w }
    const resumen = (m) => [m.type, m.type === 'buttons' ? m.text.split('\\n').slice(1, 5).join(' | ') : m.text]
    // A number in a listing of several days is one professional ON one day.
    out.cuatro = resumen(await whatsapp(await nuevo('Necesito un plomero'), '4'))
    out.cinco = resumen(await whatsapp(await nuevo('Necesito un plomero'), '5'))
    out.tres = resumen(await whatsapp(await nuevo('Necesito un plomero'), 'el 3'))
    // Number and time together.
    out.numeroYHora = resumen(await whatsapp(await nuevo('Necesito un electricista'), '1 a las 16'))
    out.numeroSinEsaHora = resumen(await whatsapp(await nuevo('Necesito un electricista'), '2 a las 16'))
    // Ordinals, names and zones.
    out.segunda = resumen(await whatsapp(await nuevo('Necesito un plomero'), 'la segunda'))
    out.nombre = resumen(await whatsapp(await nuevo('Necesito un plomero'), 'con Pedro'))
    out.zona = resumen(await whatsapp(await nuevo('Necesito un plomero'), 'el de Barrio Sur'))
    out.nombreYDia = resumen(await whatsapp(await nuevo('Necesito un plomero'), 'Juan el viernes'))
    // "esa" / "sí, esa" accept what was proposed; "no, la segunda" drops it and takes the second.
    let w = await nuevo('necesito un plomero, cualquiera, lo antes posible')
    out.esa = resumen(await whatsapp(w, 'sí, esa'))
    w = await nuevo('Necesito un plomero para el jueves')
    await whatsapp(w, 'cualquiera')
    out.noLaSegunda = resumen(await whatsapp(w, 'no, la segunda'))
    // "la otra" after choosing one of two.
    w = await nuevo('Necesito un electricista')
    await whatsapp(w, 'Laura')
    out.laOtra = resumen(await whatsapp(w, 'la otra'))
    // "el de las 9:45" when only one has it on the day shown.
    w = await nuevo('Necesito un plomero para el viernes')
    out.elDeLas = resumen(await whatsapp(w, 'el de las 9:30'))
    out.reservas = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.cuatro, ['buttons', 'Prestador: Juan Pérez | Servicio: Plomería | Fecha: viernes 9 de octubre | Horario: 08:30'], 'option 4 is Juan on FRIDAY, not Juan on Thursday')
  assert.deepEqual(r.cinco, ['text', '¿A qué hora con Pedro Díaz? Tiene: 08:30, 09:30.'], 'option 5 is Pedro on Friday: only that day\'s times')
  assert.deepEqual(r.tres, ['buttons', 'Prestador: Pedro Díaz | Servicio: Plomería | Fecha: jueves 8 de octubre | Horario: 09:45'])
  assert.deepEqual(r.numeroYHora, ['buttons', 'Prestador: Laura Gómez | Servicio: Electricidad | Fecha: jueves 8 de octubre | Horario: 16:00'])
  assert.deepEqual(r.numeroSinEsaHora, ['text', 'Omar Ríos no tiene turno a esa hora. Tiene: 09:00, 10:30. ¿Cuál preferís?'], 'a time the option does not have is said, never moved to another professional')
  assert.deepEqual(r.segunda, ['text', '¿A qué hora con María Gómez? Tiene: 09:45, 11:00, 14:00.'])
  assert.deepEqual(r.nombre, ['text', '¿A qué hora con Pedro Díaz? Tiene: jueves 8: 09:45 · viernes 9: 08:30, 09:30.'], 'a name is the professional on every day listed: each day with its times')
  assert.deepEqual(r.zona, ['text', '¿A qué hora con María Gómez? Tiene: 09:45, 11:00, 14:00.'])
  assert.deepEqual(r.nombreYDia, ['buttons', 'Prestador: Juan Pérez | Servicio: Plomería | Fecha: viernes 9 de octubre | Horario: 08:30'])
  assert.deepEqual(r.esa, ['buttons', 'Prestador: Juan Pérez | Servicio: Plomería | Fecha: jueves 8 de octubre | Horario: 09:00'])
  assert.deepEqual(r.noLaSegunda, ['text', '¿A qué hora con María Gómez? Tiene: 09:45, 11:00, 14:00.'])
  assert.deepEqual(r.laOtra, ['text', '¿A qué hora con Omar Ríos? Tiene: 09:00, 10:30.'])
  assert.deepEqual(r.elDeLas, ['buttons', 'Prestador: Pedro Díaz | Servicio: Plomería | Fecha: viernes 9 de octubre | Horario: 09:30'])
  assert.equal(r.reservas, 0, 'nothing is requested before the card is confirmed')
})

test('ASISTENTE sin repetición: each turn moves the conversation forward — the service, the days, "no hay hoy" and the professionals are never asked or listed again', () => {
  const r = runTypeScriptScenario(`${GENERAL_SETUP}
    const out = {}
    const w = nuevoContacto()
    const pasos = []
    for (const texto of ['Hola', 'Necesito un plomero', '¿Qué días atienden?', 'El jueves', '9:45', 'la segunda']) {
      const desde = dom.consultas.length
      const m = await whatsapp(w, texto)
      if (texto === 'Necesito un plomero') await linkContact(w, 'customer-user')
      pasos.push({ texto, tipo: m.type, respuesta: m.text, consultas: dom.consultas.length - desde })
    }
    out.pasos = pasos
    const estado = await estadoDe(w)
    out.estado = [estado.need.profession, estado.need.day, estado.need.time?.from ?? null, estado.chosenProviderId]
    // An availability that changed between the list and the choice is said as what happened.
    const z = nuevoContacto()
    await whatsapp(z, 'Necesito un electricista')
    await linkContact(z, 'customer-user')
    ocupados.add(iso('2026-10-08', '16:00'))
    out.yaNoDisponible = (await whatsapp(z, '1 a las 16')).text
    console.log(JSON.stringify(out))
  `)
  const respuestas = r.pasos.map((paso) => paso.respuesta)
  // Caso 1..6 of the conversational validation, as one conversation.
  assert.equal(respuestas[0], `¡Hola! Soy el asistente de TUS. ${PREGUNTA}`, 'caso 1: "Hola" asks the service')
  assert.equal(respuestas[1], PLOMERIA, 'caso 2: the real days with turnos')
  assert.equal(respuestas[2], 'Esta semana hay disponibilidad de Plomería el jueves 8 y el viernes 9. ¿Qué día preferís?', 'caso 3: the real days, and only the days')
  assert.equal(respuestas[3], 'Encontré 3 profesionales de Plomería con turno el jueves 8:\n1. Juan Pérez — Centro: 09:00, 09:45, 10:30, 12:00\n2. María Gómez — Barrio Sur: 09:45, 11:00, 14:00\n3. Pedro Díaz — Cambá Cuá: 09:45\nDecime con quién y a qué hora y te preparo la solicitud.', 'caso 4: the times of Thursday')
  assert.equal(respuestas[4], 'Encontré 3 profesionales de Plomería con turno el jueves 8 a las 09:45:\n1. Juan Pérez — Centro: 09:45\n2. María Gómez — Barrio Sur: 09:45\n3. Pedro Díaz — Cambá Cuá: 09:45\n¿Con cuál querés solicitar el turno?', 'caso 5: "9:45" keeps Thursday')
  assert.equal(r.pasos[5].tipo, 'buttons', 'caso 6: "la segunda" is the second professional, with everything kept')
  assert.deepEqual(respuestas[5].split('\n').slice(1, 7), ['Prestador: María Gómez', 'Servicio: Plomería', 'Fecha: jueves 8 de octubre', 'Horario: 09:45', 'Precio: $200', 'Seña: $100 (se abona cuando el prestador acepte)'])
  assert.deepEqual(r.estado, ['plomeria', '2026-10-08', '09:45', 'perfil-maria'])
  assert.equal(r.pasos[5].consultas, 0, 'the professionals are not searched again after one is chosen')
  // The service is asked once; once it is known, no reply asks for it or for the day again.
  assert.equal(respuestas.filter((texto) => /¿Qué servicio necesitás/u.test(texto)).length, 1)
  for (const texto of respuestas.slice(1)) assert.doesNotMatch(texto, /¿Qué servicio|¿Para cuándo|no hay turnos|vincular/iu)
  // The two days are listed in full once; after "el jueves" Friday is not mentioned again.
  for (const texto of respuestas.slice(3)) assert.doesNotMatch(texto, /[Vv]iernes/u)
  // After the time is known, the other times are not listed again.
  for (const texto of respuestas.slice(4)) assert.doesNotMatch(texto, /09:00|10:30|11:00|14:00/u)
  assert.equal(new Set(respuestas).size, respuestas.length, 'no reply is repeated')
  assert.equal(r.yaNoDisponible, 'Ese horario acaba de dejar de estar disponible. El siguiente turno libre con Laura Gómez es el jueves 8 a las 14:00. ¿Querés ese?')
})

test('ASISTENTE fechas: the calendar is Argentina\'s — just before and after midnight, a weekend, next week', () => {
  const r = runTypeScriptScenario(`
    const { describirDia, nombreDia, hoyArgentina, horaArgentina, extraerNecesidad, lunesDe } = await import('./apps/api/src/tus/asistente/necesidad.ts')
    const { textoDias, horasDe, diaLocal, horaLocal } = await import('./apps/api/src/tus/asistente/busqueda.ts')
    const at = (iso) => Date.parse(iso)
    // 02:30 UTC of the 8th is still 23:30 of Wednesday the 7th in Argentina.
    const antes = at('2026-10-08T02:30:00.000Z')
    // 03:00 UTC is 00:00 of Thursday the 8th.
    const despues = at('2026-10-08T03:00:00.000Z')
    const sabado = at('2026-10-10T15:00:00.000Z')
    console.log(JSON.stringify({
      antes: [hoyArgentina(antes), horaArgentina(antes), describirDia('2026-10-07', null, antes), describirDia('2026-10-08', null, antes), extraerNecesidad('mañana', antes).day, extraerNecesidad('hoy', antes).day],
      despues: [hoyArgentina(despues), horaArgentina(despues), describirDia('2026-10-08', null, despues), describirDia('2026-10-09', null, despues), extraerNecesidad('mañana', despues).day, extraerNecesidad('hoy', despues).day],
      // A start at 23:30 local is that local day, not the next (UTC) one.
      inicio: [diaLocal('2026-10-09T02:30:00.000Z'), horaLocal('2026-10-09T02:30:00.000Z')],
      finDeSemana: [describirDia('2026-10-10', '2026-10-11', sabado), extraerNecesidad('el finde', at('2026-10-06T12:00:00.000Z')).day, extraerNecesidad('el finde', at('2026-10-06T12:00:00.000Z')).dayTo],
      proximaSemana: [nombreDia('2026-10-12', at('2026-10-06T12:00:00.000Z')), nombreDia('2026-10-13', at('2026-10-06T12:00:00.000Z')), nombreDia('2026-11-02', at('2026-10-29T12:00:00.000Z')), extraerNecesidad('el lunes que viene', at('2026-10-06T12:00:00.000Z')).day],
      lunes: [lunesDe('2026-10-06'), lunesDe('2026-10-11'), lunesDe('2026-10-12')],
      dias: [textoDias('plomeria', ['2026-10-08', '2026-10-09'], at('2026-10-06T12:00:00.000Z')), textoDias('plomeria', ['2026-10-10', '2026-10-12'], sabado), textoDias('plomeria', [], sabado)],
      horas: [horasDe(['2026-10-08T12:00:00.000Z', '2026-10-08T13:30:00.000Z'], at('2026-10-06T12:00:00.000Z')), horasDe(['2026-10-08T12:45:00.000Z', '2026-10-09T11:30:00.000Z'], at('2026-10-06T12:00:00.000Z'))],
    }))
  `)
  assert.deepEqual(r.antes, ['2026-10-07', '23:30', 'hoy miércoles 7', 'mañana jueves 8', '2026-10-08', '2026-10-07'], '23:30 in Argentina: still Wednesday, though it is already Thursday in UTC')
  assert.deepEqual(r.despues, ['2026-10-08', '00:00', 'hoy jueves 8', 'mañana viernes 9', '2026-10-09', '2026-10-08'], 'midnight in Argentina: the day changes there, not at UTC midnight')
  assert.deepEqual(r.inicio, ['2026-10-08', '23:30'])
  assert.deepEqual(r.finDeSemana, ['hoy sábado 10 y mañana domingo 11', '2026-10-10', '2026-10-11'])
  assert.deepEqual(r.proximaSemana, ['lunes 12', 'martes 13 de octubre', 'lunes 2 de noviembre', '2026-10-12'], 'a week or more ahead, or another month: the month is said')
  assert.deepEqual(r.lunes, ['2026-10-05', '2026-10-05', '2026-10-12'], 'weeks run Monday to Sunday')
  assert.deepEqual(r.dias, [
    'Esta semana hay disponibilidad de Plomería el jueves 8 y el viernes 9. ¿Qué día preferís?',
    'En los próximos días hay disponibilidad de Plomería hoy sábado 10 y el lunes 12. ¿Qué día preferís?',
    'No encontré días con turnos libres de Plomería en los próximos 14 días.',
  ])
  assert.deepEqual(r.horas, ['09:00, 10:30', 'jueves 8: 09:45 · viernes 9: 08:30'])
})
