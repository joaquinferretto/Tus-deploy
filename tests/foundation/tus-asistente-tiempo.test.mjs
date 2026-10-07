import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTEXTO_SETUP } from './fixtures/asistente-contexto.mjs'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-TIEMPO-01. What a person says about WHEN is resolved by the backend's calendar, once,
// into absolute dates that stay in the conversation: "el próximo mes" is the next whole calendar
// month (never today + 30 days), "solo los viernes" narrows it, "después de las 15" narrows it
// again and "el segundo" picks from what was shown. The agenda read is the one real search, one
// call per day, never before today. No model: every case runs with a frozen clock.
//
// Clock: Wednesday 2026-10-07, 10:00 in Argentina. Gabriela: Wednesdays 09:00 and 16:00, Fridays
// 09:00, 15:30 and 17:00.

const COMO_ELEGIR = 'Podés decirme el número, el nombre o el horario que preferís.'

const SETUP = `${CONTEXTO_SETUP}
  waNow = Date.parse('2026-10-07T13:00:00.000Z')
  const GABRIELA = { id: 'perfil-gabriela', name: 'Gabriela', area: 'Centro', semana: { 3: ['09:00', '16:00'], 5: ['09:00', '15:30', '17:00'] }, precio: 20000 }
  AGENDA.push(GABRIELA)
  const tramo = (need) => need ? { profession: need.profession, providerName: need.providerName, day: need.day, since: need.since ?? null, until: need.until ?? null, weekdays: need.weekdays ?? null, time: need.time ? need.time.kind + ':' + (need.time.from ?? '') + '-' + (need.time.to ?? '') : null } : null
  async function conversacion(textos) {
    const w = nuevoContacto()
    const pasos = []
    for (const texto of textos) {
      const desde = dom.consultas.length
      const m = await whatsapp(w, texto)
      pasos.push({ texto, respuesta: m.text, dias: pedidas(desde).map(([dia]) => dia), consultas: pedidas(desde), need: tramo((await conversationOf(w)).state.need) })
    }
    return pasos
  }
`

const VIERNES_DE_NOVIEMBRE = ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']
const NOVIEMBRE = { profession: 'masaje', providerName: 'Gabriela', day: null, since: '2026-11-01', until: '2026-11-30' }

test('FECHAS tiempo: months, parts of a month, weeks of a month and ranges are calendar stretches resolved with a frozen clock (month change, December to January, leap years, end of month)', () => {
  const r = runTypeScriptScenario(`
    const { resolverExpresionFecha, leerDiasDeSemana, normalizarTexto } = await import('./apps/api/src/tus/asistente/fechas.ts')
    const en = (fecha, hora = '13:00') => Date.parse(fecha + 'T' + hora + ':00.000Z')
    const ver = (expresion, ahora) => { const x = resolverExpresionFecha(expresion, ahora); return [x.resolutionType, x.fromDate, x.toDate, x.rule] }
    const miercoles = en('2026-10-07')
    const out = { zona: resolverExpresionFecha('hoy', miercoles).timezone }
    for (const e of ['el próximo mes', 'el mes que viene', 'este mes', 'a fin de mes', 'a principios de noviembre', 'la segunda semana de noviembre', 'entre el 10 y el 15', 'en noviembre', 'el 12 de noviembre', 'dentro de dos semanas', 'dentro de 3 días', 'la semana que viene', 'hoy', 'mañana', 'pasado mañana']) out[e] = ver(e, miercoles)
    out.diciembre = ver('el próximo mes', en('2026-12-20'))
    out.bisiesto = ver('el próximo mes', en('2028-01-31'))
    out.noBisiesto = ver('el próximo mes', en('2027-01-31'))
    out.ultimoDia = ver('el próximo mes', en('2026-10-31'))
    out.ultimoDiaEsteMes = ver('este mes', en('2026-10-31'))
    // 01:30 UTC of November 1st is still October 31st, 22:30, in Argentina.
    out.casiMedianoche = ver('el próximo mes', en('2026-11-01', '01:30'))
    out.yaNoviembre = ver('el próximo mes', en('2026-11-01', '03:30'))
    const dias = (texto) => leerDiasDeSemana(normalizarTexto(texto))?.dias ?? null
    out.semana = { solo: dias('Solo los viernes'), dos: dias('los martes y jueves'), uno: dias('el viernes'), finde: dias('solamente sábados y domingos') }
    console.log(JSON.stringify(out))
  `)
  const rango = (desde, hasta, regla) => ['range', desde, hasta, regla]
  assert.equal(r.zona, 'America/Argentina/Buenos_Aires')
  assert.deepEqual(r['el próximo mes'], rango('2026-11-01', '2026-11-30', 'proximo_mes'), 'the next whole calendar month, not today + 30 days')
  assert.deepEqual(r['el mes que viene'], rango('2026-11-01', '2026-11-30', 'proximo_mes'))
  assert.deepEqual(r['este mes'], rango('2026-10-07', '2026-10-31', 'este_mes'), 'what is left of this month: never a day before today')
  assert.deepEqual(r['a fin de mes'].slice(0, 3), ['range', '2026-10-25', '2026-10-31'])
  assert.deepEqual(r['a principios de noviembre'].slice(0, 3), ['range', '2026-11-01', '2026-11-10'])
  assert.deepEqual(r['la segunda semana de noviembre'].slice(0, 3), ['range', '2026-11-08', '2026-11-14'])
  assert.deepEqual(r['entre el 10 y el 15'].slice(0, 3), ['range', '2026-10-10', '2026-10-15'])
  assert.deepEqual(r['en noviembre'].slice(0, 3), ['range', '2026-11-01', '2026-11-30'])
  assert.deepEqual(r['el 12 de noviembre'].slice(0, 3), ['exact', '2026-11-12', '2026-11-12'], 'a day of a month is still one day')
  assert.deepEqual(r['dentro de dos semanas'].slice(0, 3), ['range', '2026-10-19', '2026-10-25'])
  assert.deepEqual(r['dentro de 3 días'].slice(0, 3), ['exact', '2026-10-10', '2026-10-10'])
  assert.deepEqual(r['la semana que viene'].slice(0, 3), ['range', '2026-10-12', '2026-10-18'])
  assert.deepEqual(r.hoy.slice(0, 2), ['exact', '2026-10-07'])
  assert.deepEqual(r['mañana'].slice(0, 2), ['exact', '2026-10-08'])
  assert.deepEqual(r['pasado mañana'].slice(0, 2), ['exact', '2026-10-09'])
  assert.deepEqual(r.diciembre.slice(0, 3), ['range', '2027-01-01', '2027-01-31'], 'December: January of the next year')
  assert.deepEqual(r.bisiesto.slice(0, 3), ['range', '2028-02-01', '2028-02-29'], 'leap year')
  assert.deepEqual(r.noBisiesto.slice(0, 3), ['range', '2027-02-01', '2027-02-28'])
  assert.deepEqual(r.ultimoDia.slice(0, 3), ['range', '2026-11-01', '2026-11-30'], 'the 31st: November, not December')
  assert.deepEqual(r.ultimoDiaEsteMes.slice(0, 3), ['range', '2026-10-31', '2026-10-31'])
  assert.deepEqual(r.casiMedianoche.slice(0, 3), ['range', '2026-11-01', '2026-11-30'], 'the month is the one of the Argentine calendar, not of UTC')
  assert.deepEqual(r.yaNoviembre.slice(0, 3), ['range', '2026-12-01', '2026-12-31'])
  assert.deepEqual(r.semana, { solo: [5], dos: [2, 4], uno: null, finde: [0, 6] }, '"el viernes" is one day, not a filter')
})

test('ASISTENTE tiempo: "el próximo mes" walks the real agenda of the whole next month; "solo los viernes", "después de las 15" and "el segundo" keep the professional, the service and the month', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    out.A = await conversacion(['Quiero un turno de masajes', 'Con Gabriela para el próximo mes', 'Solo los viernes', 'Después de las 15', 'El segundo', '17'])
    out.reservas = dom.reservas
    console.log(JSON.stringify(out))
  `)
  const [, mes, viernes, tarde, segundo, hora] = r.A

  // "El próximo mes": November, from its first day; nothing of October is read or offered.
  assert.deepEqual(mes.need, { ...NOVIEMBRE, weekdays: null, time: null })
  assert.ok(mes.dias.length > 0 && mes.dias.every((dia) => dia >= '2026-11-01' && dia <= '2026-11-30'), `the agenda is read only inside November: ${mes.dias}`)
  assert.equal(mes.respuesta, `Hay disponibilidad de Masaje con Gabriela en noviembre:\n\nMiércoles 4 de noviembre\n1. Gabriela — Centro: 09:00, 16:00\n\nViernes 6 de noviembre\n2. Gabriela — Centro: 09:00, 15:30, 17:00\n\nMiércoles 11 de noviembre\n3. Gabriela — Centro: 09:00, 16:00\n\n${COMO_ELEGIR}`, 'dates are shown at once; no time is asked first')

  // "Solo los viernes": the four Fridays of November, one agenda read each.
  assert.deepEqual(viernes.need, { ...NOVIEMBRE, weekdays: [5], time: null })
  assert.deepEqual(viernes.dias, VIERNES_DE_NOVIEMBRE)
  assert.match(viernes.respuesta, /^Hay disponibilidad de Masaje con Gabriela los viernes en noviembre:\n\nViernes 6 de noviembre\n1\. Gabriela — Centro: 09:00, 15:30, 17:00\n\nViernes 13 de noviembre\n2\./u)

  // "Después de las 15": same professional, same month, same Fridays; only the times change.
  assert.deepEqual(tarde.need, { ...NOVIEMBRE, weekdays: [5], time: 'from:15:00-' })
  assert.deepEqual(tarde.consultas, VIERNES_DE_NOVIEMBRE.map((dia) => [dia, 'from:15:00-']))
  assert.equal(tarde.respuesta, `Hay disponibilidad de Masaje con Gabriela los viernes en noviembre desde las 15:00:\n\n${VIERNES_DE_NOVIEMBRE.map((dia, i) => `Viernes ${Number(dia.slice(8))} de noviembre\n${i + 1}. Gabriela — Centro: 15:30, 17:00`).join('\n\n')}\n\n${COMO_ELEGIR}`)

  // "El segundo": the second option shown (Friday 13), told back with its day.
  assert.equal(segundo.respuesta, '¿A qué hora el viernes 13 de noviembre con Gabriela? Tiene: 15:30, 17:00.')
  assert.deepEqual(segundo.dias, [], 'choosing among what was shown is not a new search')
  assert.match(hora.respuesta, /viernes 13 de noviembre/u)
  assert.match(hora.respuesta, /17:00/u)
  for (const paso of r.A) assert.doesNotMatch(paso.respuesta ?? '', /octubre|hoy|mañana (mi|ju)/u, `nothing of today's agenda is shown: ${paso.respuesta}`)
})

test('ASISTENTE tiempo: a stretch never shows past days or hours, skips what the agenda does not offer (taken turnos, a day off) and says so when it has nothing', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // "Este mes" on Wednesday 7 at 10:00: today only what is still ahead (09:00 is gone).
    out.esteMes = await conversacion(['Quiero una masajista con Gabriela este mes'])
    // A turno taken (Friday 6 at 15:30) and a whole day off (Friday 13) are not offered.
    ocupados.add(iso('2026-11-06', '15:30'))
    for (const h of ['09:00', '15:30', '17:00']) ocupados.add(iso('2026-11-13', h))
    out.ocupado = await conversacion(['Quiero una masajista con Gabriela el próximo mes', 'solo los viernes después de las 15'])
    // Nothing in the stretch asked: said for that stretch, and nothing outside it is read.
    out.nada = await conversacion(['Quiero una masajista con Gabriela la segunda semana de noviembre', 'solo los lunes'])
    // An exact day said afterwards replaces the stretch.
    out.dia = await conversacion(['Quiero una masajista con Gabriela el próximo mes', 'mejor el viernes 20 de noviembre'])
    // A new stretch replaces the old one and its days of the week.
    out.otro = await conversacion(['Quiero una masajista con Gabriela el próximo mes', 'solo los viernes', 'mejor en diciembre'])
    // December: "el próximo mes" is January of the next year.
    waNow = Date.parse('2026-12-20T13:00:00.000Z')
    out.enero = await conversacion(['Quiero una masajista con Gabriela el próximo mes'])
    console.log(JSON.stringify(out))
  `)
  const ultimo = (pasos) => pasos.at(-1)

  assert.deepEqual(ultimo(r.esteMes).need, { profession: 'masaje', providerName: 'Gabriela', day: null, since: '2026-10-07', until: '2026-10-31', weekdays: null, time: null })
  assert.deepEqual(ultimo(r.esteMes).consultas[0], ['2026-10-07', 'from:10:00-'], 'today is read from the current time on')
  assert.ok(ultimo(r.esteMes).dias.every((dia) => dia >= '2026-10-07' && dia <= '2026-10-31'))
  assert.match(ultimo(r.esteMes).respuesta, /^Hay disponibilidad de Masaje con Gabriela desde hoy hasta el sábado 31 de octubre:\n\nMiércoles 7\n1\. Gabriela — Centro: 16:00\n/u, 'the 09:00 of today is already past')

  assert.equal(ultimo(r.ocupado).respuesta, `Hay disponibilidad de Masaje con Gabriela los viernes en noviembre desde las 15:00:\n\nViernes 6 de noviembre\n1. Gabriela — Centro: 17:00\n\nViernes 20 de noviembre\n2. Gabriela — Centro: 15:30, 17:00\n\nViernes 27 de noviembre\n3. Gabriela — Centro: 15:30, 17:00\n\n${COMO_ELEGIR}`, 'the taken turno and the day off come from the agenda, not from the assistant')

  assert.deepEqual(ultimo(r.nada).need, { profession: 'masaje', providerName: 'Gabriela', day: null, since: '2026-11-08', until: '2026-11-14', weekdays: [1], time: null })
  assert.deepEqual(ultimo(r.nada).dias, ['2026-11-09'], 'only the Monday of that week is read')
  assert.equal(ultimo(r.nada).respuesta, 'No encontré turnos libres de Masaje con Gabriela los lunes entre el domingo 8 de noviembre y el sábado 14 de noviembre. ¿Querés que busque en otras fechas?')

  assert.deepEqual(ultimo(r.dia).need, { profession: 'masaje', providerName: 'Gabriela', day: '2026-11-20', since: null, until: null, weekdays: null, time: null })
  assert.deepEqual(ultimo(r.dia).dias, ['2026-11-20'])

  assert.deepEqual(ultimo(r.otro).need, { profession: 'masaje', providerName: 'Gabriela', day: null, since: '2026-12-01', until: '2026-12-31', weekdays: null, time: null })
  assert.ok(ultimo(r.otro).dias.every((dia) => dia >= '2026-12-01' && dia <= '2026-12-31'))

  assert.deepEqual(ultimo(r.enero).need, { profession: 'masaje', providerName: 'Gabriela', day: null, since: '2027-01-01', until: '2027-01-31', weekdays: null, time: null })
  assert.ok(ultimo(r.enero).dias.every((dia) => dia >= '2027-01-01' && dia <= '2027-01-31'))
  assert.match(ultimo(r.enero).respuesta, /^Hay disponibilidad de Masaje con Gabriela en enero de 2027:/u)
})
