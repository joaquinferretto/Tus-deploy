import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// INTEGRIDAD-01: one pure rule prices a stay (apps/api/src/tus/alojamientos/cotizacion.ts). The
// days of the week of each tarifa are respected; a tarifa with a season is never applied on its
// own (the model has no dated seasons).

const SETUP = `
  const { cotizarEstadia, mejorCotizacion } = await import('./apps/api/src/tus/alojamientos/cotizacion.ts')
  const t = (id, modalidad, precio, extra = {}) => ({ id, modalidad, duracionHoras: null, precio: BigInt(precio), moneda: 'ARS', diasSemana: [0, 1, 2, 3, 4, 5, 6], temporada: null, minimoEstadia: 1, maximoEstadia: null, ...extra })
  // 2026-10-15 is a Thursday. Check-in 14:00 Argentina (17:00 UTC).
  const dia = (n) => new Date(Date.UTC(2026, 9, 15 + n, 17, 0, 0))
  const total = (c) => (c.ok ? c.total : c.motivo)
`

test('ALOJAMIENTOS cotización: every night is priced with the tarifa of its day of the week', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const tarifas = [t('base', 'noche', 10000), t('finde', 'noche', 15000, { diasSemana: [5, 6] })]
    const jueALun = cotizarEstadia(tarifas, dia(0), dia(4))
    console.log(JSON.stringify({
      jueALun: [total(jueALun), jueALun.tarifaId, jueALun.cantidadPeriodos, jueALun.modalidad, jueALun.moneda],
      soloFinde: total(cotizarEstadia(tarifas, dia(1), dia(3))),
      soloSemana: total(cotizarEstadia(tarifas, dia(4), dia(7))),
      // The client asks for the weekend tarifa: it only applies on its days.
      pideFinde: total(cotizarEstadia(tarifas, dia(0), dia(4), { tarifaId: 'finde' })),
      // The client asks for the base tarifa: it applies every day, so it is the one used.
      pideBase: total(cotizarEstadia(tarifas, dia(0), dia(4), { tarifaId: 'base' })),
      sinTarifaEseDia: total(cotizarEstadia([t('lmm', 'noche', 8000, { diasSemana: [1, 2, 3] })], dia(0), dia(2))),
      conTarifaEseDia: total(cotizarEstadia([t('lmm', 'noche', 8000, { diasSemana: [1, 2, 3] })], dia(4), dia(6))),
      mismaRespuesta: JSON.stringify(cotizarEstadia([...tarifas].reverse(), dia(0), dia(4))) === JSON.stringify(jueALun),
    }))
  `)
  assert.deepEqual(r.jueALun, [50000, 'base', 4, 'noche', 'ARS'], '10.000 + 15.000 + 15.000 + 10.000')
  assert.equal(r.soloFinde, 30000)
  assert.equal(r.soloSemana, 30000)
  assert.equal(r.pideFinde, 50000, 'the weekend tarifa cannot be stretched to weekdays')
  assert.equal(r.pideBase, 40000)
  assert.equal(r.sinTarifaEseDia, 'sin_tarifa_para_fecha')
  assert.equal(r.conTarifaEseDia, 16000)
  assert.equal(r.mismaRespuesta, true, 'the order of the tarifas does not change the price')
})

test('ALOJAMIENTOS cotización: seasons without dates are not applied; stay limits, hours, weeks and currencies', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const horas = (n) => new Date(dia(0).getTime() + n * 3600_000)
    console.log(JSON.stringify({
      estacionalIgnorada: total(cotizarEstadia([t('alta', 'noche', 1, { temporada: 'alta' }), t('base', 'noche', 10000)], dia(0), dia(2))),
      soloEstacional: total(cotizarEstadia([t('alta', 'noche', 1, { temporada: 'alta' })], dia(0), dia(2))),
      pideEstacional: total(cotizarEstadia([t('alta', 'noche', 1, { temporada: 'alta' }), t('base', 'noche', 10000)], dia(0), dia(2), { tarifaId: 'alta' })),
      sinTarifas: total(cotizarEstadia([], dia(0), dia(2))),
      minima: cotizarEstadia([t('base', 'noche', 10000, { minimoEstadia: 3 })], dia(0), dia(2)),
      maxima: cotizarEstadia([t('base', 'noche', 10000, { maximoEstadia: 2 })], dia(0), dia(5)),
      porHora: total(cotizarEstadia([t('h', 'por_hora', 3000, { duracionHoras: 1 })], dia(0), horas(3))),
      bloque: total(cotizarEstadia([t('b', 'bloque_horas', 8000, { duracionHoras: 4 })], dia(0), horas(6))),
      semana: total(cotizarEstadia([t('s', 'semana', 60000)], dia(0), dia(10), { modalidad: 'semana' })),
      modalidadPedida: total(cotizarEstadia([t('n', 'noche', 10000), t('s', 'semana', 60000)], dia(0), dia(7), { modalidad: 'semana' })),
      monedasMixtas: total(cotizarEstadia([t('ars', 'noche', 10000, { diasSemana: [0, 1, 2, 3, 4] }), t('usd', 'noche', 90, { diasSemana: [5, 6], moneda: 'USD' })], dia(0), dia(3))),
      mejor: (() => { const m = mejorCotizacion([t('n', 'noche', 10000), t('s', 'semana', 60000)], dia(0), dia(7)); return [m.total, m.modalidad] })(),
      mejorCorta: (() => { const m = mejorCotizacion([t('n', 'noche', 10000), t('s', 'semana', 60000)], dia(0), dia(2)); return [m.total, m.modalidad] })(),
      sinMejor: mejorCotizacion([t('alta', 'noche', 1, { temporada: 'alta' })], dia(0), dia(2)),
    }))
  `)
  assert.equal(r.estacionalIgnorada, 20000)
  assert.equal(r.soloEstacional, 'sin_tarifa')
  assert.equal(r.pideEstacional, 20000, 'asking for a seasonal tarifa does not apply it')
  assert.equal(r.sinTarifas, 'sin_tarifa')
  assert.deepEqual(r.minima, { ok: false, motivo: 'estadia_minima', limite: 3 })
  assert.deepEqual(r.maxima, { ok: false, motivo: 'estadia_maxima', limite: 2 })
  assert.equal(r.porHora, 9000)
  assert.equal(r.bloque, 16000, '6 hours in blocks of 4: two blocks')
  assert.equal(r.semana, 120000, '10 nights: two weeks')
  assert.equal(r.modalidadPedida, 60000)
  assert.equal(r.monedasMixtas, 'monedas_mixtas')
  assert.deepEqual(r.mejor, [60000, 'semana'])
  assert.deepEqual(r.mejorCorta, [20000, 'noche'])
  assert.equal(r.sinMejor, null)
})
