import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// TURNOS-INTERVALO-01. How long a service lasts and every how long one of its turnos can start are
// two data. On a DISPOSABLE PostgreSQL 16 with every migration applied (TUS_PERFIL_TURNOS_PG_URL):
// the real service generates the starts, refuses what is not one and never lets two turnos overlap.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

test('INTERVALO de turnos PostgreSQL: a service with no interval starts when the previous turno ends, as always; with 30 a 60 minute service starts every 30 and still occupies 60; a taken turno removes every start it overlaps; a time that is not a start is refused; two overlapping requests at once: one; the interval is per service and only 15, 30, 45 or 60', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const { leerConfiguracionServicio } = await import('./apps/api/src/tus/calendar/turnos-entrada.ts')
    const out = {}
    try {
      const p = await prestador('int', 'Intervalo ' + run, [['Masaje', 30000]])
      const fecha = c.sumarDias(lunes, 0)
      const local = (iso) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(11, 16)
      const libres = async () => (await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha })).slots
      const horas = async () => (await libres()).map((slot) => local(slot.inicio))
      const paso = (lista) => Math.min(...lista.slice(1).map((hora, i) => (Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3))) - (Number(lista[i].slice(0, 2)) * 60 + Number(lista[i].slice(3)))))
      const configurar = (intervaloInicioMinutos) => turnos.actualizarServicioPrestador({ perfilId: p.perfilId, oficioId: oficio.id, intervaloInicioMinutos })
      const fila = () => prisma.perfilServicio.findUnique({ where: { perfilId_oficioId: { perfilId: p.perfilId, oficioId: oficio.id } } })

      // ---- An existing service: nothing configured, the behaviour there was.
      const historico = await horas()
      out.historico = [(await fila()).intervaloInicioMinutos, paso(historico), historico[0], historico.length]
      // ---- Every 30 minutes; the service still lasts 60.
      await configurar(30)
      const cada30 = await libres()
      const h30 = cada30.map((slot) => local(slot.inicio))
      out.cada30 = [(await fila()).intervaloInicioMinutos, paso(h30), h30[0], h30.length > historico.length, cada30.every((slot) => Date.parse(slot.fin) - Date.parse(slot.inicio) === 60 * 60_000), historico.every((hora) => h30.includes(hora))]
      const semana = await turnos.agendaSemanal({ prestadorId: p.perfilId, oficioId: oficio.id, desde: fecha })
      out.semanaIgual = JSON.stringify(semana.dias[0].franjas.filter((f) => f.estado === 'disponible').map((f) => f.hora)) === JSON.stringify(h30)
      // ---- A turno at 10:00 takes 10:00-11:00: 09:30, 10:00 and 10:30 are gone, 09:00 and 11:00 stay.
      const ana = await cliente('ana'); const beto = await cliente('beto'); const caro = await cliente('caro'); const dani = await cliente('dani')
      const pedir = (cuenta, hora) => turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(0, hora), tarifaId: p.tarifas.Masaje, clienteId: cuenta.id, clienteTenantId: cuenta.tenantId })
      const diez = await pedir(ana, '10:00')
      const tras = await horas()
      out.ocupado = [local(diez.inicio), (Date.parse(diez.fin) - Date.parse(diez.inicio)) / 60_000, ['09:00', '09:30', '10:00', '10:30', '11:00'].map((hora) => tras.includes(hora))]
      // ---- Not a start, and a start that overlaps the turno taken.
      out.rechazos = [await codeOf(() => pedir(beto, '11:15')), await codeOf(() => pedir(beto, '10:30')), await codeOf(() => pedir(beto, '09:30'))]
      // ---- Two overlapping requests at the same time (11:00 and 11:30): exactly one.
      const carrera = await Promise.allSettled([pedir(beto, '11:00'), pedir(caro, '11:30')])
      out.carrera = [carrera.filter((x) => x.status === 'fulfilled').length, carrera.filter((x) => x.status === 'rejected').map((x) => x.reason?.code)]
      // (and two that do not overlap both enter)
      const sinChoque = await Promise.allSettled([pedir(dani, '14:00'), pedir(caro.id === 'x' ? caro : await cliente('eva'), '15:00')])
      out.sinChoque = sinChoque.map((x) => x.status)
      const solapadas = await db.query('SELECT count(*)::int AS n FROM reservas x JOIN reservas y ON x.calendario_id = y.calendario_id AND x.id < y.id AND x.fecha_inicio < y.fecha_fin AND y.fecha_inicio < x.fecha_fin WHERE x.tenant_id = $1 AND x.estado <> $2 AND y.estado <> $2', [p.tenantId, 'cancelled'])
      out.solapadas = solapadas.rows[0].n
      // ---- The other values, what is refused, and back to "when the previous one ends".
      await configurar(15); out.cada15 = paso(await horas())
      await configurar(45); out.cada45 = paso((await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: c.sumarDias(lunes, 1) })).slots.map((slot) => local(slot.inicio)))
      out.invalidos = [await codeOf(() => configurar(20)), await codeOf(() => configurar(0)), await codeOf(() => configurar(90)), (await fila()).intervaloInicioMinutos, await sqlError('UPDATE public."perfil_servicios" SET "intervalo_inicio_minutos" = 20 WHERE "perfil_id" = $1', [p.perfilId])]
      out.entrada = [leerConfiguracionServicio({ intervaloInicioMinutos: 30 }), leerConfiguracionServicio({ intervaloInicioMinutos: null }), leerConfiguracionServicio({ intervaloInicioMinutos: '30' }).ok, leerConfiguracionServicio({ intervaloInicioMinutos: 20 }).ok, leerConfiguracionServicio({ duracionMinutos: 90 })]
      await configurar(null)
      out.vuelve = [(await fila()).intervaloInicioMinutos, paso((await turnos.disponibilidadPublica({ prestadorId: p.perfilId, oficioId: oficio.id, fecha: c.sumarDias(lunes, 1) })).slots.map((slot) => local(slot.inicio)))]
      // ---- What the provider reads to configure it.
      await configurar(30)
      out.dto = (await prisma.perfilServicio.findMany({ where: { perfilId: p.perfilId } })).map((x) => [x.duracionMinutos, x.bufferMinutos, x.intervaloInicioMinutos])
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.historico.slice(0, 2), [null, 60], 'nothing configured: a 60 minute service starts every 60, as before the column existed')
  assert.deepEqual(r.cada30.slice(0, 2), [30, 30])
  assert.equal(r.cada30[2], r.historico[2], 'the first start is still the opening time')
  assert.deepEqual(r.cada30.slice(3), [true, true, true], 'more starts, each turno still 60 minutes, and every start there was is still one')
  assert.equal(r.semanaIgual, true, 'the weekly agenda and the availability of a day are the same starts (one generator)')
  assert.deepEqual(r.ocupado, ['10:00', 60, [true, false, false, false, true]], 'a 60 minute turno at 10:00 removes 09:30, 10:00 and 10:30; 09:00 and 11:00 stay')
  assert.equal(r.rechazos[0] !== 'none' && r.rechazos[1] !== 'none' && r.rechazos[2] !== 'none', true, `not a start, and two starts that overlap the turno taken, are refused (${r.rechazos})`)
  assert.equal(r.carrera[0], 1, `two overlapping requests at once: exactly one (${JSON.stringify(r.carrera)})`)
  assert.deepEqual(r.sinChoque, ['fulfilled', 'fulfilled'])
  assert.equal(r.solapadas, 0, 'no two turnos of the agenda overlap')
  assert.deepEqual([r.cada15, r.cada45], [15, 45])
  assert.deepEqual(r.invalidos, ['INVALID_PARAMS', 'INVALID_PARAMS', 'INVALID_PARAMS', 45, 'ck_perfil_servicios_intervalo_inicio'])
  assert.deepEqual(r.entrada, [{ ok: true, valor: { intervaloInicioMinutos: 30 } }, { ok: true, valor: { intervaloInicioMinutos: null } }, false, false, { ok: true, valor: { duracionMinutos: 90 } }])
  assert.deepEqual(r.vuelve, [null, 60])
  assert.deepEqual(r.dto, [[60, 0, 30]])
})

test('INTERVALO de turnos, generador, migración y pantalla: the pure agenda with and without an interval; the migration is additive and leaves every service as it was; the screen names the two things apart and the Web never computes a start', () => {
  const r = runTypeScriptScenario(`
    const { agendaDelDia, pasoDeTurnos } = await import('./apps/api/src/tus/calendar/agenda.ts')
    const dia = (extra) => agendaDelDia({ fecha: '2030-01-07', reglas: [{ diaSemana: 1, horaInicio: '09:30', horaFin: '12:00' }], duracionMinutos: 60, bufferMinutos: 0, reservas: [], bloqueos: [], ahora: 0, ...extra }).franjas.map((f) => f.hora + (f.estado === 'disponible' ? '' : '!'))
    const t = (desde, hasta) => ({ inicio: new Date('2030-01-07T' + desde + ':00.000-03:00'), fin: new Date('2030-01-07T' + hasta + ':00.000-03:00') })
    console.log(JSON.stringify({
      sin: dia({}), conDescanso: dia({ bufferMinutos: 15 }), cada30: dia({ intervaloMinutos: 30 }), cada15de120: dia({ intervaloMinutos: 60, duracionMinutos: 120 }),
      ocupado: dia({ intervaloMinutos: 30, reservas: [t('10:30', '11:30')] }), bloqueado: dia({ intervaloMinutos: 30, bloqueos: [t('09:30', '10:00')] }),
      pasos: [pasoDeTurnos(60, 0), pasoDeTurnos(60, 15), pasoDeTurnos(60, 15, 30), pasoDeTurnos(60, 0, null), pasoDeTurnos(60, 0, 0)],
    }))
  `)
  assert.deepEqual(r.sin, ['09:30', '10:30'], 'no interval: one start every duration')
  assert.deepEqual(r.conDescanso, ['09:30', '10:45'])
  assert.deepEqual(r.cada30, ['09:30', '10:00', '10:30', '11:00'], 'every 30: the last start is the last one whose 60 minutes still fit')
  assert.deepEqual(r.cada15de120, ['09:30'], 'a 120 minute service every 60: only the starts that fit whole')
  assert.deepEqual(r.ocupado, ['09:30', '10:00!', '10:30!', '11:00!'], 'a turno 10:30-11:30 takes every start that overlaps it')
  assert.deepEqual(r.bloqueado, ['09:30!', '10:00', '10:30', '11:00'])
  assert.deepEqual(r.pasos, [60, 75, 30, 60, 60])
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const sql = read('apps/api/prisma/migrations/20261122100000_tus_servicio_intervalo_inicio/migration.sql').replace(/^--.*$/gmu, '')
  assert.match(sql, /ADD COLUMN "intervalo_inicio_minutos" integer;/u)
  assert.match(sql, /CHECK \("intervalo_inicio_minutos" IS NULL OR "intervalo_inicio_minutos" IN \(15, 30, 45, 60\)\)/u)
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE|TRUNCATE|NOT NULL|DEFAULT/iu, 'nullable and with no default: every existing service keeps its behaviour')
  const pantalla = read('apps/web/src/features/provider/provider-availability.tsx')
  for (const texto of ['Duración del servicio', 'Cada cuánto puede comenzar un turno', 'Cuando termina el anterior', 'Cada {opcion} minutos']) assert.ok(pantalla.includes(texto), texto)
  assert.match(pantalla, /INTERVALOS_INICIO_TURNO\.map\(/u)
  // The Web shows the starts the API gives: it never generates them.
  for (const archivo of ['apps/web/src/features/provider/provider-availability.tsx', 'apps/web/src/features/turnos/agenda-semanal.tsx', 'apps/web/src/features/directory/turno-booking.tsx']) assert.doesNotMatch(read(archivo), /iniciosDeFranja|pasoDeTurnos/u, archivo)
  // One generator in the API.
  const servicio = read('apps/api/src/tus/calendar/turnos-service.ts')
  assert.equal([...servicio.matchAll(/agendaDelDia\(/gu)].length, 2, 'both in agendaDias')
  assert.match(servicio, /const base = \{ reglas, duracionMinutos: duracion, bufferMinutos: buffer, intervaloMinutos: intervalo, ahora \}/u)
})
