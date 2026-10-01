import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-CONV-01: every fact of a free-text message is read at once (trade, day, time, zone or
// "any zone", who travels, urgency). Dates are resolved with the clock passed in (the server's,
// in Argentina): nothing is invented. Pure function: no model, no database.

const SETUP = `
  const { extraerNecesidad, combinarNecesidad, faltantes, describirDia, describirVentana, enVentana } = await import('./apps/api/src/tus/asistente/necesidad.ts')
  const { catalogoVigente, establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  // The administered catalog of production also has Masaje and Gas.
  const base = catalogoVigente()
  establecerCatalogo({ ...base, oficios: [...base.oficios,
    { id: 'masaje', categoriaId: null, nombre: 'Masaje', profesion: 'Masajista', slug: 'masaje', descripcion: null, icono: 'herramienta', activo: true, orden: 20, sinonimos: ['masaje', 'masajes', 'masajista', 'masajeador', 'contractura', 'descontracturante'] },
    { id: 'gas', categoriaId: null, nombre: 'Gas', profesion: 'Gasista', slug: 'gas', descripcion: null, icono: 'herramienta', activo: true, orden: 21, sinonimos: ['gasista', 'gas', 'estufa', 'calefactor'] },
  ] })
  // Thursday 2026-10-01, 12:00 in Argentina (15:00 UTC).
  const AHORA = Date.parse('2026-10-01T15:00:00.000Z')
  const x = (texto) => extraerNecesidad(texto, AHORA)
`

test('ASISTENTE necesidad: the mandatory phrases give every fact in one pass (nothing left to ask with buttons)', () => {
  const r = runTypeScriptScenario(`${SETUP}
    console.log(JSON.stringify({
      f1: x('quiero una masajista para mañana a las 18 no me importa la zona voy yo'),
      f2: x('necesito un electricista mañana a las 10 en Centro'),
      f3: x('busco un plomero urgente ahora'),
      f4: x('quiero alguien que arregle el aire mañana después de las 17'),
      f5: x('necesito una masajista el sábado a la tarde, cualquier barrio'),
      f6: x('quiero un electricista'),
      f7: x('mañana a las 18'),
      f8: x('no me importa la zona'),
      e1: x('Necesito un electricista mañana a las 10, me da igual dónde, puedo ir yo.'),
      e2: x('Necesito alguien que me arregle el aire mañana después de las 17 en Centro.'),
      e4: x('Necesito un plomero urgente ahora, estoy en Centro.'),
      e5: x('Busco una masajista para el sábado a la tarde, no me importa el barrio.'),
      nada: [x('hola'), x('El segundo'), x('gracias'), x('')],
    }))
  `)
  assert.deepEqual(r.f1, { profession: 'masaje', anyZone: true, clientTravels: true, day: '2026-10-02', dayTo: null, time: { kind: 'exact', from: '18:00', to: null } })
  assert.deepEqual(r.f2, { profession: 'electricidad', zone: 'Centro', anyZone: false, day: '2026-10-02', dayTo: null, time: { kind: 'exact', from: '10:00', to: null } })
  assert.deepEqual(r.f3, { profession: 'plomeria', urgent: true, day: '2026-10-01', time: { kind: 'from', from: '12:00', to: null } }, '"ahora" is today from the current time of the server')
  assert.deepEqual(r.f4, { profession: 'aire', day: '2026-10-02', dayTo: null, time: { kind: 'from', from: '17:00', to: null } }, '"después de las 17" is a lower bound, not an exact time')
  assert.deepEqual(r.f5, { profession: 'masaje', anyZone: true, day: '2026-10-03', dayTo: null, time: { kind: 'between', from: '13:00', to: '20:00' } })
  assert.deepEqual(r.f6, { profession: 'electricidad' })
  assert.deepEqual(r.f7, { day: '2026-10-02', dayTo: null, time: { kind: 'exact', from: '18:00', to: null } }, 'an exact time stays exact')
  assert.deepEqual(r.f8, { anyZone: true })
  assert.deepEqual(r.e1, { profession: 'electricidad', anyZone: true, clientTravels: true, day: '2026-10-02', dayTo: null, time: { kind: 'exact', from: '10:00', to: null } })
  assert.deepEqual(r.e2, { profession: 'aire', zone: 'Centro', anyZone: false, day: '2026-10-02', dayTo: null, time: { kind: 'from', from: '17:00', to: null } })
  assert.deepEqual(r.e4, { profession: 'plomeria', zone: 'Centro', anyZone: false, urgent: true, day: '2026-10-01', time: { kind: 'from', from: '12:00', to: null } })
  assert.deepEqual(r.e5, { profession: 'masaje', anyZone: true, day: '2026-10-03', dayTo: null, time: { kind: 'between', from: '13:00', to: '20:00' } })
  assert.deepEqual(r.nada, [{}, {}, {}, {}], 'a message without facts adds nothing')
})

test('ASISTENTE necesidad: relative dates and times are resolved with the server clock in Argentina', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const dia = (texto) => { const d = x(texto); return [d.day ?? null, d.dayTo ?? null] }
    const hora = (texto) => x(texto).time ?? null
    console.log(JSON.stringify({
      dias: {
        hoy: dia('hoy'), manana: dia('mañana'), pasado: dia('pasado mañana'),
        esteViernes: dia('este viernes'), elJueves: dia('el jueves'), proximoLunes: dia('el próximo lunes'), juevesQueViene: dia('el jueves que viene'),
        finde: dia('este fin de semana'), fecha: dia('el 15/10'), fechaLarga: dia('el viernes 16 de octubre'), pasada: dia('el 3 de enero'),
        mananaALaManana: dia('mañana a la mañana'), soloFranja: dia('a la mañana'), estaNoche: dia('esta noche'),
      },
      horas: {
        exacta: hora('a las 18'), conMinutos: hora('a las 18:30'), hs: hora('18hs'), yMedia: hora('a las 9 y media'), seisTarde: hora('tipo 6 de la tarde'), seis: hora('a las 6'), nueveManana: hora('a las 9 de la mañana'), diez: hora('a las 10'),
        despues: hora('después de las 18'), aPartir: hora('a partir de las 17:30'), antes: hora('antes de las 12'), entre: hora('entre las 10 y las 14'), deA: hora('de 10 a 14 hs'),
        manana: hora('a la mañana'), mediodia: hora('al mediodía'), tarde: hora('a la tarde'), noche: hora('a la noche'),
      },
      // Late evening in Argentina is already the next day in UTC: the day is still today's.
      tarde: extraerNecesidad('mañana a las 9', Date.parse('2026-10-02T01:30:00.000Z')).day,
      textos: [describirDia('2026-10-01', null, AHORA), describirDia('2026-10-02', null, AHORA), describirDia('2026-10-03', '2026-10-04', AHORA), describirVentana({ kind: 'exact', from: '18:00', to: null }), describirVentana({ kind: 'from', from: '17:00', to: null }), describirVentana({ kind: 'between', from: '13:00', to: '20:00' }), describirVentana({ kind: 'between', from: '10:00', to: '14:00' })],
      ventana: [enVentana('18:00', { kind: 'exact', from: '18:00', to: null }), enVentana('18:30', { kind: 'exact', from: '18:00', to: null }), enVentana('18:30', { kind: 'from', from: '18:00', to: null }), enVentana('17:45', { kind: 'from', from: '18:00', to: null }), enVentana('13:59', { kind: 'between', from: '10:00', to: '14:00' }), enVentana('14:00', { kind: 'between', from: '10:00', to: '14:00' }), enVentana('07:00', null)],
    }))
  `)
  assert.deepEqual(r.dias, {
    hoy: ['2026-10-01', null], manana: ['2026-10-02', null], pasado: ['2026-10-03', null],
    esteViernes: ['2026-10-02', null], elJueves: ['2026-10-01', null], proximoLunes: ['2026-10-05', null], juevesQueViene: ['2026-10-08', null],
    finde: ['2026-10-03', '2026-10-04'], fecha: ['2026-10-15', null], fechaLarga: ['2026-10-16', null], pasada: ['2027-01-03', null],
    mananaALaManana: ['2026-10-02', null], soloFranja: [null, null], estaNoche: ['2026-10-01', null],
  })
  assert.deepEqual(r.horas, {
    exacta: { kind: 'exact', from: '18:00', to: null }, conMinutos: { kind: 'exact', from: '18:30', to: null }, hs: { kind: 'exact', from: '18:00', to: null }, yMedia: { kind: 'exact', from: '09:30', to: null },
    seisTarde: { kind: 'exact', from: '18:00', to: null }, seis: { kind: 'exact', from: '18:00', to: null }, nueveManana: { kind: 'exact', from: '09:00', to: null }, diez: { kind: 'exact', from: '10:00', to: null },
    despues: { kind: 'from', from: '18:00', to: null }, aPartir: { kind: 'from', from: '17:30', to: null }, antes: { kind: 'until', from: null, to: '12:00' }, entre: { kind: 'between', from: '10:00', to: '14:00' }, deA: { kind: 'between', from: '10:00', to: '14:00' },
    manana: { kind: 'between', from: '06:00', to: '12:00' }, mediodia: { kind: 'between', from: '12:00', to: '14:00' }, tarde: { kind: 'between', from: '13:00', to: '20:00' }, noche: { kind: 'between', from: '20:00', to: '23:59' },
  })
  assert.equal(r.tarde, '2026-10-02', '22:30 of Thursday in Argentina: "mañana" is Friday')
  assert.deepEqual(r.textos, ['hoy', 'mañana', 'el sábado 3/10 y el domingo 4/10', 'a las 18:00', 'desde las 17:00', 'a la tarde', 'entre las 10:00 y las 14:00'])
  assert.deepEqual(r.ventana, [true, false, true, false, true, false, true])
})

test('ASISTENTE necesidad: the zone is optional and "any zone" is understood in every usual way; typos and colloquial language still give the facts', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const zona = (texto) => { const d = x(texto); return [d.anyZone ?? null, d.clientTravels ?? null, d.zone ?? null] }
    console.log(JSON.stringify({
      cualquiera: ['no me importa la zona', 'me da igual dónde', 'cualquier barrio', 'sin importar el barrio', 'donde sea', 'en cualquier lado', 'no me importa el barrio'].map(zona),
      seTraslada: ['voy yo', 'me traslado', 'puedo ir hasta donde sea', 'yo voy', 'me acerco'].map(zona),
      nombrada: [zona('en Centro'), zona('voy yo hasta el Centro'), zona('en Centro, aunque me da igual la zona')],
      noEsZona: [zona('me da igual el horario'), zona('quiero un electricista')],
      erratas: [x('kiero una masagista pa mañana tipo 6 de la tarde, cualkier barrio'), x('nesesito un eletricista pasado mañana entre las 10 y las 14'), x('ando buscando plomro para el finde a la mañana'), x('un gasista el próximo lunes antes de las 12')],
      ambiguo: x('se rompió el motor'),
      presupuesto: x('necesito un plomero mañana, hasta 20.000 pesos').budgetMax,
    }))
  `)
  for (const item of r.cualquiera) assert.deepEqual(item, [true, null, null])
  for (const item of r.seTraslada) assert.deepEqual(item, [true, true, null], 'who travels does not need a zone')
  assert.deepEqual(r.nombrada, [[false, null, 'Centro'], [false, true, 'Centro'], [true, null, null]], 'a named zone is kept, unless the person says it does not matter')
  assert.deepEqual(r.noEsZona, [[null, null, null], [null, null, null]])
  assert.deepEqual(r.erratas[0], { profession: 'masaje', anyZone: true, day: '2026-10-02', dayTo: null, time: { kind: 'exact', from: '18:00', to: null } })
  assert.deepEqual(r.erratas[1], { profession: 'electricidad', day: '2026-10-03', dayTo: null, time: { kind: 'between', from: '10:00', to: '14:00' } })
  assert.deepEqual(r.erratas[2], { profession: 'plomeria', day: '2026-10-03', dayTo: '2026-10-04', time: { kind: 'between', from: '06:00', to: '12:00' } })
  assert.deepEqual(r.erratas[3], { profession: 'gas', day: '2026-10-05', dayTo: null, time: { kind: 'until', from: null, to: '12:00' } })
  assert.ok(r.ambiguo.alternatives.length > 1 && !r.ambiguo.profession, 'an ambiguous word offers its trades instead of guessing')
  assert.equal(r.presupuesto, 20000)
})

test('ASISTENTE necesidad: facts accumulate across messages; only the trade and the day are needed to search, never the zone', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const pasos = []
    let need = null
    for (const texto of ['quiero un electricista', 'mañana a las 18', 'no me importa la zona']) { need = combinarNecesidad(need, x(texto)); pasos.push([need.profession, need.day, need.time?.from ?? null, need.zone, need.anyZone, faltantes(need)]) }
    const masaje = combinarNecesidad(combinarNecesidad(null, x('Quiero una masajista.')), x('Mañana a las 18, no me importa la zona.'))
    // Changing the day keeps the time; changing the time keeps the day.
    const otroDia = combinarNecesidad(masaje, x('mejor el sábado'))
    const otraHora = combinarNecesidad(masaje, x('mejor a las 19'))
    // A zone named later replaces "any zone", and the other way round.
    const conZona = combinarNecesidad(masaje, x('en Centro'))
    const sinZona = combinarNecesidad(conZona, x('me da igual dónde'))
    // A different trade is a new need: its day and time are not inherited.
    const otroOficio = combinarNecesidad(masaje, x('ahora necesito un plomero'))
    console.log(JSON.stringify({
      pasos,
      masaje: [masaje.profession, masaje.day, masaje.time, masaje.anyZone, faltantes(masaje)],
      otroDia: [otroDia.day, otroDia.time.from], otraHora: [otraHora.day, otraHora.time.from],
      conZona: [conZona.zone, conZona.anyZone], sinZona: [sinZona.zone, sinZona.anyZone],
      otroOficio: [otroOficio.profession, otroOficio.day, otroOficio.time, otroOficio.anyZone],
      soloDia: faltantes(combinarNecesidad(null, x('mañana a las 18'))),
    }))
  `)
  assert.deepEqual(r.pasos, [
    ['electricidad', null, null, null, false, ['day']],
    ['electricidad', '2026-10-02', '18:00', null, false, []],
    ['electricidad', '2026-10-02', '18:00', null, true, []],
  ])
  assert.deepEqual(r.masaje, ['masaje', '2026-10-02', { kind: 'exact', from: '18:00', to: null }, true, []], 'the trade said before is not asked again')
  assert.deepEqual(r.otroDia, ['2026-10-03', '18:00'])
  assert.deepEqual(r.otraHora, ['2026-10-02', '19:00'])
  assert.deepEqual(r.conZona, ['Centro', false])
  assert.deepEqual(r.sinZona, [null, true])
  assert.deepEqual(r.otroOficio, ['plomeria', '2026-10-01', { kind: 'from', from: '12:00', to: null }, true])
  assert.deepEqual(r.soloDia, ['profession'])
})
