import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// TURNOS-AGENDA-01 / TURNOS-SLOTS-01: weekly availability of a provider. The agenda says WHEN the
// provider works; the service says HOW LONG a turno lasts, and that duration (plus the rest after
// it) is also how often a turno starts. One pure generator (agendaDelDia) decides every start and
// its state; the API uses it for the day view, the weekly agenda, the assistant and the booking
// check. There is no interval to configure.

const SETUP = `
  const { agendaDelDia, pasoDeTurnos } = await import('./apps/api/src/tus/calendar/agenda.ts')
  const c = await import('./packages/contracts/src/tus-turnos.ts')
  // Sunday noon (Argentina) before the week of Monday 2026-10-19 .. Sunday 2026-10-25.
  const AHORA = Date.parse('2026-10-18T15:00:00.000Z')
  const SEMANA = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
  const LUNES = '2026-10-19'
  const a = (fecha, hora) => new Date(fecha + 'T' + hora + ':00.000-03:00')
  const dia = (fecha, reglas, duracion, extra = {}) => agendaDelDia({ fecha, reglas, duracionMinutos: duracion, bufferMinutos: 0, reservas: [], bloqueos: [], ahora: AHORA, ...extra })
  const semana = (reglas, duracion, extra) => SEMANA.map((fecha) => dia(fecha, reglas, duracion, extra))
  const horas = (d, estado = 'disponible') => d.franjas.filter((f) => f.estado === estado).map((f) => f.hora)
  const regla = (diaSemana, horaInicio, horaFin) => ({ diaSemana, horaInicio, horaFin })
  const lunes = (inicio, fin, duracion, extra) => dia(LUNES, [regla(1, inicio, fin)], duracion, extra)
`

test('TURNOS slots: the duration of the service is the step between starts — 15, 30, 45, 60 and 90 minutes; the screenshot case (09:00–14:00, 60 min) is exactly five turnos', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const de = (duracion) => horas(lunes('09:00', '14:00', duracion))
    console.log(JSON.stringify({ d15: de(15), d30: de(30), d45: de(45), d60: de(60), d90: de(90), d120: de(120), pasos: [pasoDeTurnos(60, 0), pasoDeTurnos(60, 15), pasoDeTurnos(45, null), pasoDeTurnos(30, -5)] }))
  `)
  assert.equal(r.d15.length, 20)
  assert.deepEqual(r.d15.slice(0, 5), ['09:00', '09:15', '09:30', '09:45', '10:00'])
  assert.equal(r.d15.at(-1), '13:45')
  assert.deepEqual(r.d30, ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30'])
  assert.deepEqual(r.d45, ['09:00', '09:45', '10:30', '11:15', '12:00', '12:45'])
  // The regression of the screenshot: "turnos de 60 min" are offered every 60 minutes.
  assert.deepEqual(r.d60, ['09:00', '10:00', '11:00', '12:00', '13:00'])
  for (const hora of ['09:15', '09:30', '09:45', '10:15', '10:30', '10:45', '13:15', '13:30', '13:45']) assert.ok(!r.d60.includes(hora), `${hora} is not a start of a 60 minute service`)
  assert.deepEqual(r.d90, ['09:00', '10:30', '12:00'])
  assert.deepEqual(r.d120, ['09:00', '11:00'])
  assert.deepEqual(r.pasos, [60, 75, 45, 30], 'step = duration + rest; no rest, the duration')
})

test('TURNOS slots: starts go from the REAL opening time (never rounded to the hour) and a turno that does not fit whole is not offered', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const sinEspacio = lunes('09:00', '09:45', 60)
    console.log(JSON.stringify({
      y30: horas(lunes('09:30', '14:30', 60)),
      y15: horas(lunes('08:15', '11:00', 45)),
      justo: horas(lunes('09:00', '12:00', 60)),
      sobra: horas(lunes('09:00', '12:30', 60)),
      exacto: horas(lunes('09:00', '10:00', 60)),
      sinEspacio: [sinEspacio.estado, sinEspacio.franjas.length],
      fines: lunes('09:30', '12:30', 60).franjas.map((f) => [f.hora, f.inicio, f.fin]),
    }))
  `)
  assert.deepEqual(r.y30, ['09:30', '10:30', '11:30', '12:30', '13:30'])
  assert.deepEqual(r.y15, ['08:15', '09:00', '09:45'], '10:30 would end at 11:15, after closing')
  assert.deepEqual(r.justo, ['09:00', '10:00', '11:00'], '12:00 would end at 13:00: it is not a turno')
  assert.deepEqual(r.sobra, ['09:00', '10:00', '11:00'], 'half an hour left over is not a turno of an hour')
  assert.deepEqual(r.exacto, ['09:00'])
  assert.deepEqual(r.sinEspacio, ['laboral', 0])
  assert.deepEqual(r.fines, [
    ['09:30', '2026-10-19T12:30:00.000Z', '2026-10-19T13:30:00.000Z'],
    ['10:30', '2026-10-19T13:30:00.000Z', '2026-10-19T14:30:00.000Z'],
    ['11:30', '2026-10-19T14:30:00.000Z', '2026-10-19T15:30:00.000Z'],
  ], 'each turno is the whole range of the service, in Argentina time')
})

test('TURNOS slots: several ranges in a day (no turno crosses the break), different hours per day, days off', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const reglas = [regla(1, '16:00', '20:00'), regla(1, '09:00', '12:00'), regla(2, '10:00', '15:00'), regla(4, '09:30', '11:30'), regla(5, '09:00', '13:00')]
    const s = semana(reglas, 60)
    console.log(JSON.stringify({ dias: s.map((d) => [d.estado, horas(d)]), cortado90: horas(dia(LUNES, reglas, 90)), todos: semana([0, 1, 2, 3, 4, 5, 6].map((d) => regla(d, '09:00', '11:00')), 60).map((d) => horas(d).length) }))
  `)
  assert.deepEqual(r.dias, [
    ['laboral', ['09:00', '10:00', '11:00', '16:00', '17:00', '18:00', '19:00']],
    ['laboral', ['10:00', '11:00', '12:00', '13:00', '14:00']],
    ['no_laboral', []],
    ['laboral', ['09:30', '10:30']],
    ['laboral', ['09:00', '10:00', '11:00', '12:00']],
    ['no_laboral', []],
    ['no_laboral', []],
  ])
  assert.deepEqual(r.cortado90, ['09:00', '10:30', '16:00', '17:30'], 'each range starts its own sequence; 10:30–12:00 fits, 12:00 would cross the break')
  assert.deepEqual(r.todos, [2, 2, 2, 2, 2, 2, 2])
})

test('TURNOS slots: a variant of another duration has its own turnos over the same agenda (30, 60, 90 minutes)', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const reservas = [{ inicio: a(LUNES, '10:00'), fin: a(LUNES, '11:00') }]
    console.log(JSON.stringify({
      v30: horas(lunes('09:00', '12:00', 30)), v60: horas(lunes('09:00', '12:00', 60)), v90: horas(lunes('09:00', '12:00', 90)),
      conReserva30: [horas(lunes('09:00', '12:00', 30, { reservas })), horas(lunes('09:00', '12:00', 30, { reservas }), 'ocupado')],
      conReserva90: [horas(lunes('09:00', '13:30', 90, { reservas })), horas(lunes('09:00', '13:30', 90, { reservas }), 'ocupado')],
    }))
  `)
  assert.deepEqual(r.v30, ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'])
  assert.deepEqual(r.v60, ['09:00', '10:00', '11:00'])
  assert.deepEqual(r.v90, ['09:00', '10:30'])
  assert.deepEqual(r.conReserva30, [['09:00', '09:30', '11:00', '11:30'], ['10:00', '10:30']], 'the half-hour variant fits right before and right after an hour already taken')
  assert.deepEqual(r.conReserva90, [['12:00'], ['09:00', '10:30']], 'a 90 minute turno needs its WHOLE range free: 09:00–10:30 and 10:30–12:00 both touch the reservation')
})

test('TURNOS slots: a reservation takes its whole range, an exception blocks without touching the weekly hours, the past cannot be chosen, and the sequence never shifts', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const reglas = [regla(1, '09:00', '14:00'), regla(2, '09:00', '14:00')]
    const reservas = [{ inicio: a(LUNES, '10:00'), fin: a(LUNES, '11:00') }]
    const conReserva = dia(LUNES, reglas, 60, { reservas })
    // A turno taken before this rule existed, off the sequence (10:15–11:15).
    const fueraDeGrilla = dia(LUNES, reglas, 60, { reservas: [{ inicio: a(LUNES, '10:15'), fin: a(LUNES, '11:15') }] })
    const bloqueoMedio = dia(LUNES, reglas, 60, { bloqueos: [{ inicio: a(LUNES, '11:00'), fin: a(LUNES, '12:00') }] })
    const bloqueoParcial = dia(LUNES, reglas, 60, { bloqueos: [{ inicio: a(LUNES, '11:30'), fin: a(LUNES, '12:15') }] })
    const feriado = dia(LUNES, reglas, 60, { bloqueos: [{ inicio: a(LUNES, '00:00'), fin: a('2026-10-20', '00:00') }] })
    const vacaciones = semana(reglas, 60, { bloqueos: [{ inicio: a('2026-10-19', '00:00'), fin: a('2026-10-26', '00:00') }] })
    const ambos = dia(LUNES, reglas, 60, { reservas, bloqueos: [{ inicio: a(LUNES, '10:30'), fin: a(LUNES, '10:45') }] })
    // 09:20 of that very day: the first turno still ahead is 10:00. 09:30 is not a turno.
    const enCurso = dia(LUNES, reglas, 60, { ahora: a(LUNES, '09:20').getTime() })
    const ayer = dia(LUNES, reglas, 60, { ahora: a('2026-10-20', '09:00').getTime() })
    const descansoPasado = dia('2026-10-21', reglas, 60, { ahora: a('2026-10-22', '09:00').getTime() })
    console.log(JSON.stringify({
      conReserva: [horas(conReserva), horas(conReserva, 'ocupado')],
      fueraDeGrilla: [horas(fueraDeGrilla), horas(fueraDeGrilla, 'ocupado')],
      bloqueoMedio: [bloqueoMedio.estado, horas(bloqueoMedio), horas(bloqueoMedio, 'bloqueado')],
      bloqueoParcial: [horas(bloqueoParcial), horas(bloqueoParcial, 'bloqueado')],
      feriado: [feriado.estado, feriado.franjas.length, horas(feriado).length, horas(feriado, 'bloqueado').length],
      vacaciones: vacaciones.map((d) => d.estado),
      ambos: [horas(ambos, 'bloqueado'), horas(ambos, 'ocupado')],
      enCurso: [enCurso.estado, horas(enCurso, 'pasado'), horas(enCurso)],
      ayer: [ayer.estado, horas(ayer).length],
      descansoPasado: descansoPasado.estado,
      // The same rules are still there after the exceptions: nothing was rewritten.
      reglasIntactas: reglas.length === 2 && horas(dia('2026-10-20', reglas, 60)).length === 5,
    }))
  `)
  assert.deepEqual(r.conReserva, [['09:00', '11:00', '12:00', '13:00'], ['10:00']], '10:00 is taken; the others stay where they were')
  assert.deepEqual(r.fueraDeGrilla, [['09:00', '12:00', '13:00'], ['10:00', '11:00']], 'every turno that would overlap an existing reservation is taken, not only its own start')
  assert.deepEqual(r.bloqueoMedio, ['laboral', ['09:00', '10:00', '12:00', '13:00'], ['11:00']])
  assert.deepEqual(r.bloqueoParcial, [['09:00', '10:00', '13:00'], ['11:00', '12:00']], 'a block that touches part of a turno removes the whole turno')
  assert.deepEqual(r.feriado, ['bloqueado', 5, 0, 5])
  assert.deepEqual(r.vacaciones, ['bloqueado', 'bloqueado', 'no_laboral', 'no_laboral', 'no_laboral', 'no_laboral', 'no_laboral'])
  assert.deepEqual(r.ambos, [['10:00'], []], 'a block wins over a reservation in the same range')
  assert.deepEqual(r.enCurso, ['laboral', ['09:00'], ['10:00', '11:00', '12:00', '13:00']], 'the earliest turno ahead belongs to the sequence: 10:00, never 09:30')
  assert.deepEqual(r.ayer, ['pasado', 0])
  assert.equal(r.descansoPasado, 'pasado')
  assert.equal(r.reglasIntactas, true)
})

test('TURNOS slots: the rest between turnos is part of the step (60 + 15 → 09:00, 10:15, 11:30); the service must fit the hours, the rest after the last turno need not', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const descanso = { bufferMinutos: 15 }
    const reservas = [{ inicio: a(LUNES, '10:15'), fin: a(LUNES, '11:15') }]
    const conReserva = lunes('09:00', '14:00', 60, { ...descanso, reservas })
    // Without the rest in the step, a reservation would also take the turno right after it.
    const pegada = lunes('09:00', '14:00', 60, { ...descanso, reservas: [{ inicio: a(LUNES, '11:00'), fin: a(LUNES, '12:00') }] })
    console.log(JSON.stringify({
      largo: horas(lunes('09:00', '14:00', 60, descanso)),
      corto: horas(lunes('09:00', '12:00', 60, descanso)),
      ultimoJusto: horas(lunes('09:00', '11:15', 60, descanso)),
      d30: horas(lunes('09:00', '11:00', 30, { bufferMinutos: 10 })),
      conReserva: [horas(conReserva), horas(conReserva, 'ocupado')],
      pegada: [horas(pegada), horas(pegada, 'ocupado')],
    }))
  `)
  assert.deepEqual(r.largo, ['09:00', '10:15', '11:30', '12:45'])
  assert.deepEqual(r.corto, ['09:00', '10:15'], '11:30 would end at 12:30, after closing')
  assert.deepEqual(r.ultimoJusto, ['09:00', '10:15'], 'the last turno ends exactly at closing: its rest does not have to fit inside the working hours')
  assert.deepEqual(r.d30, ['09:00', '09:40', '10:20'])
  assert.deepEqual(r.conReserva, [['09:00', '11:30', '12:45'], ['10:15']], 'neighbours that keep the rest stay available')
  assert.deepEqual(r.pegada, [['09:00', '12:45'], ['10:15', '11:30']], 'a reservation off the sequence takes every turno that would not keep the rest around it')
})

test('TURNOS agenda: one validation for API and Web (hours, overlap, one interval per day from the allowed list) and week helpers', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const v = (input) => { const result = c.validarHorariosSemanales(input); return result.ok ? result.valor : result.motivo }
    console.log(JSON.stringify({
      ok: v([{ diaSemana: 5, horaInicio: '09:00', horaFin: '13:00', intervaloMinutos: 15 }, { diaSemana: 1, horaInicio: '10:00', horaFin: '15:00' }]),
      intervaloRaro: v([{ diaSemana: 1, horaInicio: '10:00', horaFin: '15:00', intervaloMinutos: 45 }]),
      intervaloTexto: v([{ diaSemana: 1, horaInicio: '10:00', horaFin: '15:00', intervaloMinutos: '30' }]),
      dosIntervalosUnDia: v([{ diaSemana: 1, horaInicio: '09:00', horaFin: '12:00', intervaloMinutos: 30 }, { diaSemana: 1, horaInicio: '16:00', horaFin: '18:00', intervaloMinutos: 60 }]),
      mismoIntervaloUnDia: Array.isArray(v([{ diaSemana: 1, horaInicio: '09:00', horaFin: '12:00', intervaloMinutos: 30 }, { diaSemana: 1, horaInicio: '16:00', horaFin: '18:00', intervaloMinutos: 30 }])),
      solapados: v([{ diaSemana: 1, horaInicio: '09:00', horaFin: '12:00' }, { diaSemana: 1, horaInicio: '11:00', horaFin: '13:00' }]),
      rango: v([{ diaSemana: 1, horaInicio: '15:00', horaFin: '10:00' }]),
      formato: v([{ diaSemana: 7, horaInicio: '10:00', horaFin: '15:00' }]),
      semanaVacia: v([]),
      esIntervalo: [15, 30, 60, 90, 120, 45, 0, '60', null].map(c.esIntervaloTurno),
      lunes: ['2026-10-19', '2026-10-21', '2026-10-25', '2026-11-01'].map(c.lunesDe),
      suma: [c.sumarDias('2026-10-26', 7), c.sumarDias('2026-10-26', -7), c.sumarDias('2026-12-28', 7)],
      inicios: c.iniciosDeFranja('10:00', '15:00', 90, 60),
      iniciosInvalidos: c.iniciosDeFranja('10:00', '15:00', 0, 60),
    }))
  `)
  assert.deepEqual(r.ok, [{ diaSemana: 1, horaInicio: '10:00', horaFin: '15:00', intervaloMinutos: null }, { diaSemana: 5, horaInicio: '09:00', horaFin: '13:00', intervaloMinutos: 15 }])
  assert.equal(r.intervaloRaro, 'intervalo')
  assert.equal(r.intervaloTexto, 'intervalo')
  assert.equal(r.dosIntervalosUnDia, 'intervalo')
  assert.equal(r.mismoIntervaloUnDia, true)
  assert.equal(r.solapados, 'solapados')
  assert.equal(r.rango, 'rango')
  assert.equal(r.formato, 'formato')
  assert.deepEqual(r.semanaVacia, [], 'a provider may work no day at all')
  assert.deepEqual(r.esIntervalo, [true, true, true, true, true, false, false, false, false])
  assert.deepEqual(r.lunes, ['2026-10-19', '2026-10-19', '2026-10-19', '2026-10-26'])
  assert.deepEqual(r.suma, ['2026-11-02', '2026-10-19', '2027-01-04'])
  assert.deepEqual(r.inicios, ['10:00', '11:30', '13:00'])
  assert.deepEqual(r.iniciosInvalidos, [])
})
