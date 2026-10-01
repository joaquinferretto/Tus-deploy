import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// TURNOS-AGENDA-01: weekly availability of a provider. The interval says how often a turno may
// START; the duration belongs to the service. One pure generator (agendaDelDia) decides every
// start and its state; the API uses it for the day view, the weekly agenda and the booking check.

const SETUP = `
  const { agendaDelDia } = await import('./apps/api/src/tus/calendar/agenda.ts')
  const c = await import('./packages/contracts/src/tus-turnos.ts')
  // Sunday noon (Argentina) before the week of Monday 2026-10-19 .. Sunday 2026-10-25.
  const AHORA = Date.parse('2026-10-18T15:00:00.000Z')
  const SEMANA = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
  const a = (fecha, hora) => new Date(fecha + 'T' + hora + ':00.000-03:00')
  const dia = (fecha, reglas, general, duracion, extra = {}) => agendaDelDia({ fecha, reglas, intervaloGeneral: general, duracionMinutos: duracion, bufferMinutos: 0, reservas: [], bloqueos: [], ahora: AHORA, ...extra })
  const semana = (reglas, general, duracion, extra) => SEMANA.map((fecha) => dia(fecha, reglas, general, duracion, extra))
  const horas = (d, estado = 'disponible') => d.franjas.filter((f) => f.estado === estado).map((f) => f.hora)
  const regla = (diaSemana, horaInicio, horaFin, intervaloMinutos = null) => ({ diaSemana, horaInicio, horaFin, intervaloMinutos })
`

test('TURNOS agenda: the example week (general 1 hora, jueves 30 minutos, viernes 15 minutos, miércoles and the weekend off) generates exactly the expected starts', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const reglas = [regla(1, '10:00', '15:00'), regla(2, '10:00', '18:00'), regla(4, '14:00', '20:00', 30), regla(5, '09:00', '13:00', 15)]
    const dias = semana(reglas, 60, 15)
    console.log(JSON.stringify({
      estados: dias.map((d) => d.estado),
      diasSemana: dias.map((d) => d.diaSemana),
      lunes: horas(dias[0]), martes: horas(dias[1]), miercoles: dias[2].franjas.length, jueves: horas(dias[3]), viernes: horas(dias[4]), sabado: dias[5].franjas.length, domingo: dias[6].franjas.length,
      todas: dias.flatMap((d) => d.franjas).every((f) => f.estado === 'disponible'),
      instante: [dias[0].franjas[0].inicio, dias[0].franjas[0].fin],
    }))
  `)
  assert.deepEqual(r.estados, ['laboral', 'laboral', 'no_laboral', 'laboral', 'laboral', 'no_laboral', 'no_laboral'])
  assert.deepEqual(r.diasSemana, [1, 2, 3, 4, 5, 6, 0])
  assert.deepEqual(r.lunes, ['10:00', '11:00', '12:00', '13:00', '14:00'])
  assert.deepEqual(r.martes, ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'])
  assert.equal(r.miercoles, 0, 'a day off generates no turnos')
  assert.deepEqual(r.jueves, ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30'])
  assert.equal(r.viernes.length, 16)
  assert.deepEqual([r.viernes[0], r.viernes[1], r.viernes[2], r.viernes.at(-1)], ['09:00', '09:15', '09:30', '12:45'])
  assert.deepEqual([r.sabado, r.domingo], [0, 0])
  assert.equal(r.todas, true)
  assert.deepEqual(r.instante, ['2026-10-19T13:00:00.000Z', '2026-10-19T13:15:00.000Z'], 'agenda times are Argentina time (UTC-3)')
})

test('TURNOS agenda: every general interval (15, 30, 60, 90, 120 minutes) and a provider working every day or only some days', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const todos = [0, 1, 2, 3, 4, 5, 6].map((d) => regla(d, '10:00', '15:00'))
    const algunos = [regla(1, '10:00', '15:00'), regla(3, '10:00', '15:00'), regla(6, '10:00', '15:00')]
    const out = { porIntervalo: {}, etiquetas: c.INTERVALOS_TURNO.map(c.etiquetaIntervalo) }
    for (const intervalo of c.INTERVALOS_TURNO) out.porIntervalo[intervalo] = horas(dia('2026-10-19', todos, intervalo, 60))
    out.todosLosDias = semana(todos, 60, 60).map((d) => [d.estado, d.franjas.length])
    out.algunosDias = semana(algunos, 60, 60).map((d) => [d.estado, d.franjas.length])
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.porIntervalo[15].length, 17)
  assert.deepEqual([r.porIntervalo[15][0], r.porIntervalo[15][1], r.porIntervalo[15].at(-1)], ['10:00', '10:15', '14:00'])
  assert.deepEqual(r.porIntervalo[30], ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00'])
  assert.deepEqual(r.porIntervalo[60], ['10:00', '11:00', '12:00', '13:00', '14:00'])
  assert.deepEqual(r.porIntervalo[90], ['10:00', '11:30', '13:00'])
  assert.deepEqual(r.porIntervalo[120], ['10:00', '12:00', '14:00'])
  assert.deepEqual(r.etiquetas, ['15 minutos', '30 minutos', '1 hora', '1 hora 30 minutos', '2 horas'])
  assert.deepEqual(r.todosLosDias, Array(7).fill(['laboral', 5]))
  assert.deepEqual(r.algunosDias, [['laboral', 5], ['no_laboral', 0], ['laboral', 5], ['no_laboral', 0], ['no_laboral', 0], ['laboral', 5], ['no_laboral', 0]])
})

test('TURNOS agenda: the interval of one day or of several days is its own; the others keep the general one; hours differ per day; a day may have two ranges', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const base = [regla(1, '10:00', '12:00'), regla(2, '08:00', '10:00'), regla(3, '10:00', '12:00')]
    const unDia = base.map((item) => (item.diaSemana === 3 ? { ...item, intervaloMinutos: 30 } : item))
    const variosDias = base.map((item) => (item.diaSemana === 1 ? { ...item, intervaloMinutos: 15 } : item.diaSemana === 3 ? { ...item, intervaloMinutos: 120 } : item))
    const cortado = [regla(1, '09:00', '12:00'), regla(1, '16:00', '18:00')]
    console.log(JSON.stringify({
      unDia: semana(unDia, 60, 30).slice(0, 3).map((d) => horas(d)),
      variosDias: semana(variosDias, 60, 30).slice(0, 3).map((d) => horas(d)),
      // Changing the general interval moves only the days that use it.
      generalCambiado: semana(unDia, 120, 30).slice(0, 3).map((d) => horas(d)),
      cortado: horas(dia('2026-10-19', cortado, 60, 60)),
    }))
  `)
  assert.deepEqual(r.unDia, [['10:00', '11:00'], ['08:00', '09:00'], ['10:00', '10:30', '11:00', '11:30']])
  assert.deepEqual(r.variosDias, [['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30'], ['08:00', '09:00'], ['10:00']])
  assert.deepEqual(r.generalCambiado, [['10:00'], ['08:00'], ['10:00', '10:30', '11:00', '11:30']])
  assert.deepEqual(r.cortado, ['09:00', '10:00', '11:00', '16:00', '17:00'], 'nothing is offered between the two ranges')
})

test('TURNOS agenda: the interval is not the duration; a start exists only when start + duration of the service ends inside the working hours', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const reglas = [regla(1, '10:00', '15:00')]
    const out = { porDuracion: {} }
    for (const duracion of [15, 30, 60, 90, 120]) { const h = horas(dia('2026-10-19', reglas, 30, duracion)); out.porDuracion[duracion] = [h.length, h[0], h.at(-1)] }
    const d = dia('2026-10-19', reglas, 30, 60)
    out.unaHora = horas(d)
    out.fines = d.franjas.map((f) => (Date.parse(f.fin) - Date.parse(f.inicio)) / 60000)
    out.ultimoFin = d.franjas.at(-1).fin
    // A service longer than the working hours of the day never fits.
    const corto = dia('2026-10-19', [regla(1, '09:00', '10:00')], 15, 120)
    out.noEntra = [corto.estado, corto.franjas.length]
    out.justo = horas(dia('2026-10-19', [regla(1, '09:00', '10:00')], 15, 60))
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.porDuracion, { 15: [10, '10:00', '14:30'], 30: [10, '10:00', '14:30'], 60: [9, '10:00', '14:00'], 90: [8, '10:00', '13:30'], 120: [7, '10:00', '13:00'] })
  assert.deepEqual(r.unaHora, ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00'])
  assert.ok(!r.unaHora.includes('14:30'), '14:30 + 1 hour would end after 15:00')
  assert.ok(r.fines.every((minutos) => minutos === 60), 'every turno lasts what the service lasts')
  assert.equal(r.ultimoFin, '2026-10-19T18:00:00.000Z', 'the last turno ends exactly at closing time (15:00)')
  assert.deepEqual(r.noEntra, ['laboral', 0])
  assert.deepEqual(r.justo, ['09:00'])
})

test('TURNOS agenda: a reservation takes its whole duration (plus the rest time), an exception blocks without touching the weekly hours, the past cannot be chosen', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const reglas = [regla(1, '10:00', '15:00'), regla(2, '10:00', '15:00')]
    const lunes = '2026-10-19'
    const reservas = [{ inicio: a(lunes, '11:00'), fin: a(lunes, '12:00') }]
    const conReserva = dia(lunes, reglas, 30, 60, { reservas })
    const conDescanso = dia(lunes, reglas, 30, 60, { reservas, bufferMinutos: 15 })
    const corta = dia(lunes, reglas, 30, 30, { reservas })
    const feriado = dia(lunes, reglas, 30, 60, { bloqueos: [{ inicio: a(lunes, '00:00'), fin: a('2026-10-20', '00:00') }] })
    const vacaciones = semana(reglas, 30, 60, { bloqueos: [{ inicio: a('2026-10-19', '00:00'), fin: a('2026-10-26', '00:00') }] })
    const horarioEspecial = dia(lunes, reglas, 30, 60, { bloqueos: [{ inicio: a(lunes, '13:00'), fin: a(lunes, '15:00') }] })
    const ambos = dia(lunes, reglas, 30, 60, { reservas, bloqueos: [{ inicio: a(lunes, '11:30'), fin: a(lunes, '12:00') }] })
    const enCurso = dia(lunes, reglas, 30, 60, { ahora: a(lunes, '12:10').getTime() })
    const ayer = dia(lunes, reglas, 30, 60, { ahora: a('2026-10-20', '09:00').getTime() })
    const descansoPasado = dia('2026-10-21', reglas, 30, 60, { ahora: a('2026-10-22', '09:00').getTime() })
    console.log(JSON.stringify({
      ocupadas: horas(conReserva, 'ocupado'), libres: horas(conReserva),
      conDescanso: horas(conDescanso, 'ocupado'),
      corta: horas(corta, 'ocupado'),
      feriado: [feriado.estado, feriado.franjas.length, horas(feriado).length, horas(feriado, 'bloqueado').length],
      vacaciones: vacaciones.map((d) => d.estado),
      horarioEspecial: [horarioEspecial.estado, horas(horarioEspecial), horas(horarioEspecial, 'bloqueado')],
      ambos: [horas(ambos, 'bloqueado'), horas(ambos, 'ocupado')],
      enCurso: [enCurso.estado, horas(enCurso, 'pasado'), horas(enCurso)],
      ayer: [ayer.estado, horas(ayer).length],
      descansoPasado: descansoPasado.estado,
      // The same rules are still there after the exceptions: nothing was rewritten.
      reglasIntactas: reglas.length === 2 && horas(dia('2026-10-20', reglas, 30, 60)).length === 9,
    }))
  `)
  assert.deepEqual(r.ocupadas, ['10:30', '11:00', '11:30'], 'every start that would overlap the reservation is taken, not only its own start')
  assert.deepEqual(r.libres, ['10:00', '12:00', '12:30', '13:00', '13:30', '14:00'])
  assert.deepEqual(r.conDescanso, ['10:00', '10:30', '11:00', '11:30', '12:00'], 'the rest time is respected before and after a reservation')
  assert.deepEqual(r.corta, ['11:00', '11:30'], 'a shorter service fits right before the reservation')
  assert.deepEqual(r.feriado, ['bloqueado', 9, 0, 9])
  assert.deepEqual(r.vacaciones, ['bloqueado', 'bloqueado', 'no_laboral', 'no_laboral', 'no_laboral', 'no_laboral', 'no_laboral'])
  assert.deepEqual(r.horarioEspecial, ['laboral', ['10:00', '10:30', '11:00', '11:30', '12:00'], ['12:30', '13:00', '13:30', '14:00']])
  assert.deepEqual(r.ambos, [['11:00', '11:30'], ['10:30']], 'a block wins over a reservation in the same range')
  assert.deepEqual(r.enCurso, ['laboral', ['10:00', '10:30', '11:00', '11:30', '12:00'], ['12:30', '13:00', '13:30', '14:00']])
  assert.deepEqual(r.ayer, ['pasado', 0])
  assert.equal(r.descansoPasado, 'pasado')
  assert.equal(r.reglasIntactas, true)
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
