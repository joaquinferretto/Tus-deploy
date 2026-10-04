import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// INTEGRIDAD-01 (independent audit of the database, 2026-10): every confirmed finding reproduced
// on a DISPOSABLE PostgreSQL 16 with every migration applied (TUS_PERFIL_TURNOS_PG_URL). Never a
// shared or production database. Real Prisma, real services, real constraints, real concurrency.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const run = 'i' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const code = async (operation) => { try { await operation(); return 'ok' } catch (error) { return error?.code ?? error?.codigo ?? String(error?.message ?? error).slice(0, 120) } }
  // SQLSTATE or constraint of a statement the database must refuse.
  const sql = async (statement, ...values) => { try { await prisma.$executeRawUnsafe(statement, ...values); return 'accepted' } catch (error) { const text = String(error?.message ?? error); return text.match(/(ck_[a-z_]+|fk_[a-z_]+|uq_[a-z_]+|ex_[a-z_]+)/u)?.[1] ?? text.match(/(23505|23503|23514|23P01)/u)?.[1] ?? text.slice(0, 160) } }
  // Open several connections first, so "at the same time" really runs side by side.
  const calentar = () => Promise.all(Array.from({ length: 8 }, () => prisma.$queryRawUnsafe('select 1 as ok from pg_sleep(0.05)')))
  const dia = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
`

test('INTEGRIDAD turnos: the rest time (buffer) protects both sides of a reservation and holds under concurrency; every writer of an agenda is serialized on its calendar', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
    const c = await import('./packages/contracts/src/tus-turnos.ts')
    const turnos = new ServicioTurnos(prisma)
    const out = {}
    try {
      const [oficio, corto] = await prisma.oficioServicio.findMany({ where: { activo: true }, orderBy: { orden: 'asc' }, take: 2 })
      const tenantId = run + '-tenant'; const prestadorId = run + '-prestador'; const ahora = new Date()
      await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: 'Buffer', status: 'active', createdAt: ahora, updatedAt: ahora } })
      await prisma.prestador.create({ data: { id: run + '-p', tenantId, prestadorId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
      // Two services on ONE agenda, both with 30 minutes of rest between turnos: 60 minutes (a turno
      // every 90: 08:00, 09:30, 11:00...) and 45 minutes (every 75: 08:00, 09:15, 10:30, 11:45...).
      // Each sequence keeps its own rest; the rest between turnos of DIFFERENT services is what the
      // booking check and the lock of the calendar protect.
      const perfil = await prisma.perfilPublicoPrestador.create({ data: { id: run + '-perfil', tenantId, prestadorId, nombrePublico: 'Buffer ' + run, oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, bufferMinutos: 30, precioBase: 1000n }, { oficioId: corto.id, duracionMinutos: 45, bufferMinutos: 30, precioBase: 1000n }] } } })
      await turnos.guardarDisponibilidadSemanal(tenantId, { intervaloGeneral: 15, horarios: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio: '08:00', horaFin: '20:00' })) })
      const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
      const fecha = (n) => c.sumarDias(hoy, n)
      const a = (n, hora) => new Date(fecha(n) + 'T' + hora + ':00.000-03:00').toISOString()
      const reservar = (n, hora, servicio = oficio) => turnos.reservarTurno({ prestadorId: perfil.id, oficioId: servicio.id, inicio: a(n, hora), clienteNombre: 'Cliente' }).then(() => 'ok', (e) => e.code)
      const libres = async (n, servicio = oficio) => (await turnos.disponibilidadPublica({ prestadorId: perfil.id, oficioId: servicio.id, fecha: fecha(n) })).slots.map((s) => s.inicio)

      // The step is duration + rest, from the opening time; a start off that sequence is not a turno.
      const hora = (iso) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(11, 16)
      out.secuencias = [(await libres(2)).map(hora), (await libres(2, corto)).map(hora).slice(0, 5)]
      out.fueraDeSecuencia = [await reservar(2, '10:00'), await reservar(2, '09:00', corto)]
      // Sequential, both orders: the 45 minute turno of 10:30 starts right when the 60 minute one of
      // 09:30 ends, with no rest between them.
      out.despues = [await reservar(2, '09:30'), await reservar(2, '10:30', corto), await reservar(2, '11:45', corto)]
      out.antes = [await reservar(3, '10:30', corto), await reservar(3, '09:30'), await reservar(3, '08:00')]
      const d2 = await libres(2)
      out.ofrecidos = ['08:00', '09:30', '11:00', '12:30', '14:00'].map((h) => d2.includes(a(2, h)))

      // Concurrent: two turnos of different services that do not overlap (PostgreSQL's exclusion
      // constraint allows both) but break the rest time whichever goes first. Exactly one may be
      // stored, on every day.
      await calentar()
      const carreras = []
      for (let n = 5; n < 13; n += 1) carreras.push((await Promise.all([reservar(n, '09:30'), reservar(n, '10:30', corto)])).sort().join('+'))
      out.carreras = [...new Set(carreras)]
      out.filas = await prisma.reserva.count({ where: { tenantId, fechaInicio: { gte: new Date(a(5, '00:00')) } } })

      // A block and a change of the weekly hours go through the same lock and still work.
      await turnos.bloquearHorario({ prestadorTenantId: tenantId, inicio: a(14, '00:00'), fin: a(15, '00:00'), motivo: 'Feriado' })
      out.trasBloqueo = await reservar(14, '09:30')
      await turnos.guardarDisponibilidadSemanal(tenantId, { intervaloGeneral: 60, horarios: [] })
      out.sinHorarios = await reservar(16, '09:30')
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.secuencias, [['08:00', '09:30', '11:00', '12:30', '14:00', '15:30', '17:00', '18:30'], ['08:00', '09:15', '10:30', '11:45', '13:00']], 'a turno every duration + rest, from the opening time')
  assert.deepEqual(r.fueraDeSecuencia, ['SLOT_NOT_AVAILABLE', 'SLOT_NOT_AVAILABLE'], 'a start that is not a turno of that service cannot be booked')
  assert.deepEqual(r.despues, ['ok', 'SLOT_OCCUPIED', 'ok'], 'no turno starts inside the rest time AFTER a reservation')
  assert.deepEqual(r.antes, ['ok', 'SLOT_OCCUPIED', 'ok'], 'no turno ends inside the rest time BEFORE a reservation')
  assert.deepEqual(r.ofrecidos, [true, false, false, false, true], 'the agenda offers only turnos that respect the rest time on both sides (09:30 is taken, 11:00 overlaps the 11:45 one, 12:30 starts right when it ends)')
  assert.deepEqual(r.carreras, ['SLOT_OCCUPIED+ok'], 'two simultaneous turnos never break the rest time')
  assert.equal(r.filas, 8)
  assert.equal(r.trasBloqueo, 'SLOT_NOT_AVAILABLE')
  assert.equal(r.sinHorarios, 'SLOT_NOT_AVAILABLE')
})

test('INTEGRIDAD alojamientos: the database refuses impossible rows; an expired hold frees its dates; reservations and manual blocks never coexist; ratings stay exact under concurrency', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const { AlojamientosService } = await import('./apps/api/src/tus/alojamientos/alojamientos-service.ts')
    const aloj = new AlojamientosService(prisma)
    const out = {}
    try {
      const nuevo = (slug) => aloj.crearAlojamiento({ tipoId: 'tipo-cabana', nombre: 'Cabañas ' + slug, slug, direccion: 'Ruta 12 km 5', latitud: -27.47, longitud: -58.83 })
      const A = await nuevo(run + '-a'); const B = await nuevo(run + '-b')
      const U = await aloj.crearUnidad({ alojamientoId: A.id, nombre: 'Cabaña 1', capacidadPersonas: 4 })
      const UB = await aloj.crearUnidad({ alojamientoId: B.id, nombre: 'Cabaña B', capacidadPersonas: 2 })
      const T = await aloj.crearTarifa({ unidadId: U.id, modalidad: 'noche', precio: 50000 })
      await aloj.crearTarifa({ unidadId: UB.id, modalidad: 'noche', precio: 900, moneda: 'USD' })
      const rango = (n, noches = 2) => ({ fechaInicio: dia(n) + 'T17:00:00.000Z', fechaFin: dia(n + noches) + 'T13:00:00.000Z' })
      const hold = (unidadId, n, extra = {}) => aloj.crearHoldReserva({ unidadId, ...rango(n), clienteNombre: 'Cliente', ...extra })

      // ---- the owner of an alojamiento is a real account
      const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
      const duena = (await createPrismaAuthService(prisma).service.registerAccount({ email: run + '-duena@example.com', password: 'una frase larga y segura 2026', displayName: 'Dueña ' + run })).created.account
      out.propietario = [
        await code(() => aloj.crearAlojamiento({ propietarioId: 'cuenta-que-no-existe', tipoId: 'tipo-cabana', nombre: 'Sin dueña', slug: run + '-sin', direccion: 'x', latitud: -27.4, longitud: -58.8 })),
        await code(() => aloj.crearAlojamiento({ propietarioId: duena.id, tipoId: 'tipo-cabana', nombre: 'Con dueña', slug: run + '-con', direccion: 'x', latitud: -27.4, longitud: -58.8 })),
        await sql("UPDATE alojamientos SET propietario_id = 'cuenta-que-no-existe' WHERE id = $1", A.id),
        (await prisma.alojamiento.findUnique({ where: { id: A.id } })).propietarioId,
      ]

      // ---- a public address identifies ONE alojamiento
      out.slugRepetido = await code(() => nuevo(run + '-a'))
      out.slugRepetidoSql = await sql('UPDATE alojamientos SET slug = $1 WHERE id = $2', run + '-a', B.id)

      // ---- rows the database itself refuses (whatever code writes them)
      out.rechazos = {
        latitud: await sql('UPDATE alojamientos SET latitud = 999 WHERE id = $1', A.id),
        estadoAlojamiento: await sql("UPDATE alojamientos SET estado = 'cualquiera' WHERE id = $1", A.id),
        rating: await sql('UPDATE alojamientos SET rating_promedio = 7 WHERE id = $1', A.id),
        capacidad: await sql('UPDATE unidades_alojamiento SET capacidad_personas = 0 WHERE id = $1', U.id),
        estadoUnidad: await sql("UPDATE unidades_alojamiento SET estado = 'rota' WHERE id = $1", U.id),
        precio: await sql('UPDATE tarifas_alojamiento SET precio = -1 WHERE id = $1', T.id),
        modalidad: await sql("UPDATE tarifas_alojamiento SET modalidad = 'quincena' WHERE id = $1", T.id),
        diasSemana: await sql('UPDATE tarifas_alojamiento SET dias_semana = ARRAY[1, 9] WHERE id = $1', T.id),
        diasVacios: await sql('UPDATE tarifas_alojamiento SET dias_semana = ARRAY[]::integer[] WHERE id = $1', T.id),
        moneda: await sql("UPDATE tarifas_alojamiento SET moneda = 'pesos' WHERE id = $1", T.id),
        estadia: await sql('UPDATE tarifas_alojamiento SET minimo_estadia = 5, maximo_estadia = 2 WHERE id = $1', T.id),
        bloqueoInvertido: await sql("INSERT INTO bloqueos_unidad_alojamiento (id, unidad_id, fecha_inicio, fecha_fin, motivo) VALUES ($1, $2, now() + interval '3 day', now() + interval '2 day', 'x')", run + '-blk-x', U.id),
      }
      const h0 = await hold(U.id, 200)
      out.rechazosReserva = {
        fechas: await sql("UPDATE reservas_alojamiento SET fecha_fin = fecha_inicio - interval '1 hour' WHERE id = $1", h0.id),
        estado: await sql("UPDATE reservas_alojamiento SET estado = 'paid' WHERE id = $1", h0.id),
        personas: await sql('UPDATE reservas_alojamiento SET cantidad_personas = 0 WHERE id = $1', h0.id),
        precio: await sql('UPDATE reservas_alojamiento SET precio_final_snapshot = -5 WHERE id = $1', h0.id),
        holdSinVencimiento: await sql('UPDATE reservas_alojamiento SET hold_expiracion = NULL WHERE id = $1', h0.id),
        // The unit of the reservation must belong to the alojamiento of the reservation.
        otroAlojamiento: await sql('UPDATE reservas_alojamiento SET alojamiento_id = $1 WHERE id = $2', B.id, h0.id),
      }

      // ---- expired hold: shown as available AND bookable (it used to answer 409 until a sweep ran)
      const h1 = await hold(U.id, 10)
      out.holdActivo = await code(() => hold(U.id, 10))
      await prisma.reservaAlojamiento.update({ where: { id: h1.id }, data: { holdExpiracion: new Date(Date.now() - 60_000) } })
      const busqueda = await aloj.buscarAlojamientosPublico({ checkIn: rango(10).fechaInicio, checkOut: rango(10).fechaFin })
      out.vencidoSeOfrece = busqueda.some((item) => item.id === A.id)
      const h2 = await hold(U.id, 10).then((x) => x, (e) => ({ error: e.codigo ?? String(e.message).slice(0, 80) }))
      out.vencidoSeReserva = h2.error ?? 'ok'
      out.vencidoQuedaExpirado = (await prisma.reservaAlojamiento.findUnique({ where: { id: h1.id } })).estado
      // A payment that arrives for a hold that already lost its dates is not confirmed.
      out.confirmarVencido = await code(() => aloj.confirmarReserva({ reservaId: h1.id, paymentId: 'pay-tarde' }))
      const revisado = await prisma.reservaAlojamiento.findUnique({ where: { id: h1.id } })
      out.vencidoEnRevision = [revisado.estado, revisado.paymentId, revisado.pagoEnRevisionDesde !== null]
      out.confirmar = await aloj.confirmarReserva({ reservaId: h2.id, paymentId: 'pay-1' }).then((x) => [x.estado, x.holdExpiracion], (e) => e.codigo)
      // The hold ran out of time and nobody took its dates yet: the late payment does not confirm
      // it either. It is recorded for reconciliation, the dates are free, and booking them again
      // leaves exactly one live reservation.
      const h5 = await hold(U.id, 150)
      await prisma.reservaAlojamiento.update({ where: { id: h5.id }, data: { holdExpiracion: new Date(Date.now() - 60_000) } })
      out.pagoTardio = [await code(() => aloj.confirmarReserva({ reservaId: h5.id, paymentId: 'pay-tarde-2' })), await code(() => aloj.confirmarReserva({ reservaId: h5.id, paymentId: 'pay-tarde-2' }))]
      const tardio = await prisma.reservaAlojamiento.findUnique({ where: { id: h5.id } })
      out.pagoTardioQueda = [tardio.estado, tardio.paymentId, tardio.pagoEnRevisionDesde !== null]
      out.fechasLibresTrasPagoTardio = await code(() => hold(U.id, 150))
      out.vivasEnEseRango = await prisma.reservaAlojamiento.count({ where: { unidadId: U.id, estado: { in: ['pending_payment', 'confirmed', 'checked_in'] }, fechaInicio: { lt: new Date(rango(150).fechaFin) }, fechaFin: { gt: new Date(rango(150).fechaInicio) } } })
      out.enRevision = (await aloj.pagosEnRevision()).filter((pago) => [h1.id, h5.id].includes(pago.reservaId)).map((pago) => [pago.estado, pago.paymentId, pago.monto > 0]).sort()
      // The same payment notified again after check-in is not a new payment.
      await aloj.actualizarEstadoReserva(h2.id, 'checked_in')
      out.avisoRepetido = await aloj.confirmarReserva({ reservaId: h2.id, paymentId: 'pay-1' }).then(() => 'ok', (e) => e.codigo)
      out.confirmarDosVeces = await aloj.confirmarReserva({ reservaId: h2.id, paymentId: 'pay-1' }).then((x) => x.estado, (e) => e.codigo)

      // ---- capacity and currency
      out.capacidad = await code(() => hold(U.id, 20, { cantidadPersonas: 5 }))
      out.capacidadJusta = await code(() => hold(U.id, 20, { cantidadPersonas: 4 }))
      out.moneda = (await hold(UB.id, 20)).moneda

      // ---- the price respects the days of each tarifa: weeknights 10.000, Friday and Saturday
      // nights 15.000; a seasonal tarifa (no dated seasons in the model) is never applied alone.
      const UW = await aloj.crearUnidad({ alojamientoId: A.id, nombre: 'Cabaña finde', capacidadPersonas: 2 })
      await aloj.crearTarifa({ unidadId: UW.id, modalidad: 'noche', precio: 10000 })
      await aloj.crearTarifa({ unidadId: UW.id, modalidad: 'noche', precio: 15000, diasSemana: [5, 6] })
      const estacional = await aloj.crearTarifa({ unidadId: UW.id, modalidad: 'noche', precio: 1 })
      await prisma.tarifaAlojamiento.update({ where: { id: estacional.id }, data: { temporada: 'baja' } })
      // A Thursday about 400 days ahead, check-in 14:00 Argentina.
      const jueves = (() => { const d = new Date(Date.now() + 400 * 86400_000); while (new Date(d.getTime() - 3 * 3600_000).getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
      const mas = (n) => new Date(new Date(jueves + 'T17:00:00.000Z').getTime() + n * 86400_000).toISOString()
      const finde = await aloj.crearHoldReserva({ unidadId: UW.id, fechaInicio: mas(0), fechaFin: mas(4), clienteNombre: 'Cliente' })
      const semana = await aloj.crearHoldReserva({ unidadId: UW.id, fechaInicio: mas(4), fechaFin: mas(7), clienteNombre: 'Cliente' })
      const detalle = await aloj.obtenerDetallePublico(A.id, { checkIn: mas(14), checkOut: mas(18) })
      out.precioPorDia = [finde.precioFinalSnapshot, semana.precioFinalSnapshot, detalle.unidades.find((u) => u.id === UW.id)?.precioCalculado?.total]
      const UX = await aloj.crearUnidad({ alojamientoId: A.id, nombre: 'Solo lunes a miércoles', capacidadPersonas: 2 })
      await aloj.crearTarifa({ unidadId: UX.id, modalidad: 'noche', precio: 8000, diasSemana: [1, 2, 3] })
      out.sinTarifaEseDia = [await code(() => aloj.crearHoldReserva({ unidadId: UX.id, fechaInicio: mas(0), fechaFin: mas(2), clienteNombre: 'Cliente' })), await code(() => aloj.crearHoldReserva({ unidadId: UX.id, fechaInicio: mas(4), fechaFin: mas(6), clienteNombre: 'Cliente' }))]

      // ---- reservations and manual blocks never coexist
      const bloquear = (unidadId, n) => aloj.crearBloqueoUnidad({ unidadId, ...rango(n), motivo: 'Mantenimiento' })
      out.bloqueoSobreReserva = await code(() => bloquear(U.id, 10))
      out.bloqueoInvalido = await code(() => aloj.crearBloqueoUnidad({ unidadId: U.id, fechaInicio: rango(30).fechaFin, fechaFin: rango(30).fechaInicio, motivo: 'x' }))
      out.bloqueoLibre = await code(() => bloquear(U.id, 30))
      out.reservaSobreBloqueo = await code(() => hold(U.id, 30))
      // A block over an expired hold is fine: the hold no longer keeps the dates.
      const h3 = await hold(U.id, 40)
      await prisma.reservaAlojamiento.update({ where: { id: h3.id }, data: { holdExpiracion: new Date(Date.now() - 60_000) } })
      out.bloqueoSobreVencido = await code(() => bloquear(U.id, 40))
      // At the same time, on free dates: a hold and a block for the same range. Exactly one wins.
      await calentar()
      const carreras = []
      for (let n = 60; n < 100; n += 5) carreras.push((await Promise.all([hold(U.id, n).then(() => 'reserva', (e) => e.codigo), bloquear(U.id, n).then(() => 'bloqueo', (e) => e.codigo)])).sort().join('+'))
      out.carreras = [...new Set(carreras)].sort()
      const solapados = await prisma.$queryRawUnsafe("SELECT count(*)::int AS n FROM reservas_alojamiento r JOIN bloqueos_unidad_alojamiento b ON b.unidad_id = r.unidad_id AND b.fecha_inicio < r.fecha_fin AND b.fecha_fin > r.fecha_inicio WHERE r.unidad_id = $1 AND r.estado IN ('pending_payment', 'confirmed', 'checked_in') AND (r.estado <> 'pending_payment' OR r.hold_expiracion > now())", U.id)
      out.coexisten = solapados[0].n
      // Two holds for the same dates at once: one (the existing exclusion constraint).
      const dobles = await Promise.all([hold(U.id, 120), hold(U.id, 120)].map((p) => p.then(() => 'ok', (e) => e.codigo)))
      out.dobles = dobles.sort()

      // ---- state changes follow the life of a reservation
      out.transiciones = [
        await code(async () => aloj.actualizarEstadoReserva((await hold(U.id, 140)).id, 'completed')),
        await code(async () => { const h = await hold(U.id, 145); await aloj.confirmarReserva({ reservaId: h.id, paymentId: 'pay-t' }); await aloj.actualizarEstadoReserva(h.id, 'checked_in') }),
        await code(() => aloj.actualizarEstadoReserva(h2.id, 'completed')),
        await code(() => aloj.actualizarEstadoReserva(h2.id, 'cancelled')),
        await code(() => aloj.actualizarEstadoReserva(h1.id, 'checked_in')),
      ]

      // ---- ratings: six guests rate at the same time; the aggregate counts every one of them
      const puntuaciones = [5, 4, 3, 5, 2, 5]
      const estadias = []
      for (let i = 0; i < puntuaciones.length; i += 1) {
        const h = await hold(U.id, 300 + i * 5)
        await aloj.confirmarReserva({ reservaId: h.id, paymentId: 'pay-r' + i })
        await aloj.actualizarEstadoReserva(h.id, 'checked_in')
        await aloj.actualizarEstadoReserva(h.id, 'completed')
        estadias.push(h.id)
      }
      await calentar()
      const calificadas = await Promise.all(estadias.map((reservaId, i) => code(() => aloj.calificarAlojamiento({ reservaId, puntuacion: puntuaciones[i] }))))
      const ficha = await prisma.alojamiento.findUnique({ where: { id: A.id } })
      out.rating = [calificadas.every((x) => x === 'ok'), ficha.ratingCantidad, Math.round(ficha.ratingPromedio * 100) / 100]
      const repetida = await Promise.all([1, 2, 3].map(() => code(() => aloj.calificarAlojamiento({ reservaId: h2.id, puntuacion: 1 }))))
      out.repetida = repetida.sort()
      out.ratingFinal = (await prisma.alojamiento.findUnique({ where: { id: A.id } })).ratingCantidad
      out.calificacionCruzada = await sql('UPDATE calificaciones_alojamiento SET alojamiento_id = $1 WHERE reserva_id = $2', B.id, estadias[0])
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.propietario.slice(0, 3), ['OWNER_NOT_FOUND', 'ok', 'fk_alojamientos_propietario'], 'the owner is a real account')
  assert.equal(r.propietario[3], null, 'an alojamiento without owner is managed by the platform')
  assert.equal(r.slugRepetido, 'SLUG_TAKEN')
  assert.equal(r.slugRepetidoSql, '23505', 'unique_violation (uq_alojamientos_slug)')
  assert.deepEqual(r.rechazos, {
    latitud: 'ck_alojamientos_punto',
    estadoAlojamiento: 'ck_alojamientos_estado',
    rating: 'ck_alojamientos_rating',
    capacidad: 'ck_unidades_alojamiento_capacidad',
    estadoUnidad: 'ck_unidades_alojamiento_estado',
    precio: 'ck_tarifas_alojamiento_precio',
    modalidad: 'ck_tarifas_alojamiento_modalidad',
    diasSemana: 'ck_tarifas_alojamiento_dias_semana',
    diasVacios: 'ck_tarifas_alojamiento_dias_semana',
    moneda: 'ck_tarifas_alojamiento_moneda',
    estadia: 'ck_tarifas_alojamiento_estadia',
    bloqueoInvertido: 'ck_bloqueos_unidad_alojamiento_rango',
  })
  assert.deepEqual(r.rechazosReserva, {
    fechas: 'ck_reservas_alojamiento_rango',
    estado: 'ck_reservas_alojamiento_estado',
    personas: 'ck_reservas_alojamiento_personas',
    precio: 'ck_reservas_alojamiento_precios',
    holdSinVencimiento: 'ck_reservas_alojamiento_hold',
    otroAlojamiento: 'fk_reservas_alojamiento_unidad_alojamiento',
  })
  assert.equal(r.holdActivo, 'SLOT_OCCUPIED', 'a live hold keeps its dates')
  assert.equal(r.vencidoSeOfrece, true)
  assert.equal(r.vencidoSeReserva, 'ok', 'what is shown as available can be booked')
  assert.equal(r.vencidoQuedaExpirado, 'expired')
  assert.equal(r.confirmarVencido, 'PAYMENT_REQUIRES_REVIEW', 'a payment for an expired reservation is never confirmed')
  assert.deepEqual(r.vencidoEnRevision, ['expired', 'pay-tarde', true], 'the payment is kept for reconciliation')
  assert.deepEqual(r.pagoTardio, ['PAYMENT_REQUIRES_REVIEW', 'PAYMENT_REQUIRES_REVIEW'])
  assert.deepEqual(r.pagoTardioQueda, ['expired', 'pay-tarde-2', true])
  assert.equal(r.fechasLibresTrasPagoTardio, 'ok')
  assert.equal(r.vivasEnEseRango, 1, 'a late payment never produces a second reservation of the same dates')
  assert.deepEqual(r.enRevision, [['expired', 'pay-tarde', true], ['expired', 'pay-tarde-2', true]])
  assert.equal(r.avisoRepetido, 'ok')
  assert.deepEqual(r.precioPorDia, [50000, 30000, 50000], 'Thursday to Monday: 10.000 + 15.000 + 15.000 + 10.000; the seasonal tarifa of 1 is never used')
  assert.deepEqual(r.sinTarifaEseDia, ['NO_TARIFF_FOR_DATE', 'ok'])
  assert.deepEqual(r.confirmar, ['confirmed', null])
  assert.equal(r.confirmarDosVeces, 'confirmed', 'confirming twice is idempotent')
  assert.equal(r.capacidad, 'CAPACITY_EXCEEDED')
  assert.equal(r.capacidadJusta, 'ok')
  assert.equal(r.moneda, 'USD', 'the reservation keeps the currency of its tarifa')
  assert.equal(r.bloqueoSobreReserva, 'UNIT_HAS_RESERVATIONS')
  assert.equal(r.bloqueoInvalido, 'BAD_REQUEST')
  assert.equal(r.bloqueoLibre, 'ok')
  assert.equal(r.reservaSobreBloqueo, 'UNIT_BLOCKED')
  assert.equal(r.bloqueoSobreVencido, 'ok')
  assert.ok(r.carreras.length > 0 && r.carreras.every((x) => x === 'UNIT_BLOCKED+bloqueo' || x === 'UNIT_HAS_RESERVATIONS+reserva'), `a hold and a block for the same dates: ${JSON.stringify(r.carreras)}`)
  assert.equal(r.coexisten, 0, 'no live reservation overlaps a block')
  assert.deepEqual(r.dobles, ['SLOT_OCCUPIED', 'ok'])
  assert.deepEqual(r.transiciones, ['ok', 'ok', 'ok', 'INVALID_STATE', 'INVALID_STATE'], 'a live reservation advances (also one paid at the place); a completed or expired one never comes back to life')
  assert.deepEqual(r.rating, [true, 6, 4])
  assert.deepEqual(r.repetida, ['ALREADY_RATED', 'ALREADY_RATED', 'ok'], 'one reservation is rated once, also when three requests arrive together')
  assert.equal(r.ratingFinal, 7)
  assert.equal(r.calificacionCruzada, 'fk_calificaciones_alojamiento_reserva_alojamiento')
})

test('INTEGRIDAD tarifas de prestadores y geografía: a tarifa belongs to a service the profile really offers and is replaced atomically; the province of a locality cannot contradict its reference; a barrio and its zona share the locality', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
    const turnos = new ServicioTurnos(prisma)
    const out = {}
    try {
      const [oficio, otroOficio] = await prisma.oficioServicio.findMany({ where: { activo: true }, orderBy: { orden: 'asc' }, take: 2 })
      const tenantId = run + '-tenant'; const prestadorId = run + '-prestador'; const ahora = new Date()
      await prisma.tusTenant.create({ data: { id: tenantId, slug: tenantId, name: 'Tarifas', status: 'active', createdAt: ahora, updatedAt: ahora } })
      await prisma.prestador.create({ data: { id: run + '-p', tenantId, prestadorId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
      const perfil = await prisma.perfilPublicoPrestador.create({ data: { id: run + '-perfil', tenantId, prestadorId, nombrePublico: 'Tarifas ' + run, oficio: oficio.id, zona: 'Centro', visible: true, fechaCreacion: ahora, fechaActualizacion: ahora, servicios: { create: [{ oficioId: oficio.id, duracionMinutos: 60, precioBase: 1000n }] } } })
      const guardar = (oficioId, tarifas) => turnos.guardarTarifasPrestador({ tenantId, perfilId: perfil.id, oficioId, tarifas })
      const nombres = async () => (await prisma.tarifaServicioPrestador.findMany({ where: { perfilId: perfil.id }, orderBy: { orden: 'asc' } })).map((t) => t.nombre)
      const base = [{ nombre: '30 minutos', duracionMinutos: 30, precio: 8000n }, { nombre: '60 minutos', duracionMinutos: 60, precio: 15000n }]

      out.guardadas = (await guardar(oficio.id, base)).map((t) => [t.nombre, t.duracionMinutos, t.precio])
      // A service the profile does not offer has no tarifas (service and database).
      out.servicioNoOfrecido = await code(() => guardar(otroOficio.id, base))
      out.servicioNoOfrecidoSql = await sql("INSERT INTO tarifas_servicio_prestador (id, tenant_id, perfil_id, oficio_id, nombre, duracion_minutos, precio, activo, orden, fecha_creacion, fecha_actualizacion) VALUES ($1, $2, $3, $4, 'x', 30, 100, true, 0, now(), now())", run + '-tar-x', tenantId, perfil.id, otroOficio.id)
      out.rechazosSql = [
        await sql('UPDATE tarifas_servicio_prestador SET duracion_minutos = 0 WHERE perfil_id = $1', perfil.id),
        await sql('UPDATE tarifas_servicio_prestador SET precio = -1 WHERE perfil_id = $1', perfil.id),
      ]
      // Invalid input or a failure half way never loses the tarifas that were there.
      out.invalidas = [
        await code(() => guardar(oficio.id, [{ nombre: 'Nueva', duracionMinutos: 45, precio: 9000n }, { nombre: '', duracionMinutos: 30, precio: 100n }])),
        await code(() => guardar(oficio.id, [{ nombre: 'Nueva', duracionMinutos: 0, precio: 9000n }])),
        await code(() => guardar(oficio.id, [{ nombre: 'Nueva', duracionMinutos: 45, precio: -1n }])),
      ]
      out.falloEnBase = (await code(() => guardar(oficio.id, [{ nombre: 'Nueva', duracionMinutos: 45, precio: 9000n }, { nombre: 'Enorme', duracionMinutos: 45, precio: 2n ** 70n }]))) !== 'ok'
      out.intactas = await nombres()
      // The id of a tarifa is kept when the provider edits it; an id of somebody else is not taken.
      const [primera] = await prisma.tarifaServicioPrestador.findMany({ where: { perfilId: perfil.id }, orderBy: { orden: 'asc' } })
      const editadas = await guardar(oficio.id, [{ id: primera.id, nombre: '30 minutos', duracionMinutos: 30, precio: 8500n }, { id: 'tar-de-otro', nombre: 'Otra', duracionMinutos: 90, precio: 20000n }])
      out.ids = [editadas[0].id === primera.id, editadas[1].id !== 'tar-de-otro']
      // Several saves at once: the result is exactly one of them, never a mix.
      await calentar()
      const juegos = [1, 2, 3, 4, 5, 6].map((n) => Array.from({ length: n }, (_, i) => ({ nombre: 'Juego ' + n + ' #' + i, duracionMinutos: 30, precio: 1000n })))
      const simultaneas = await Promise.all(juegos.map((juego) => code(() => guardar(oficio.id, juego))))
      const finales = await nombres()
      const juego = Number(finales[0]?.split(' ')[1])
      out.simultaneas = [simultaneas.every((x) => x === 'ok'), finales.length === juego, finales.every((nombre) => nombre.startsWith('Juego ' + juego + ' '))]
      // A service cannot be removed leaving its tarifas behind; the directory removes both together.
      out.quitarServicioConTarifas = await sql('DELETE FROM perfil_servicios WHERE perfil_id = $1 AND oficio_id = $2', perfil.id, oficio.id)
      const { AlmacenPerfilesPrisma } = await import('./apps/api/src/tus/directorio/almacenes.ts')
      const almacen = new AlmacenPerfilesPrisma(prisma)
      const actual = await almacen.porTenant(tenantId)
      await almacen.guardar({ ...actual, oficio: otroOficio.id, oficios: [otroOficio.id], actualizadoEn: Date.now() })
      out.trasQuitarServicio = [(await nombres()).length, (await prisma.perfilServicio.findMany({ where: { perfilId: perfil.id } })).map((s) => s.oficioId === otroOficio.id)]
      // Deleting the whole profile still works (services and tarifas go with it).
      await guardar(otroOficio.id, base)
      out.borrarPerfil = await sql('DELETE FROM perfiles_publicos_prestador WHERE id = $1', perfil.id)

      // ---- geography
      const texto = async (id) => (await prisma.localidad.findUnique({ where: { id } })).provincia
      await sql("UPDATE localidades SET provincia = 'Chaco' WHERE id = 'corrientes-capital'")
      out.provinciaTexto = await texto('corrientes-capital')
      const loc = run + '-loc'
      await sql("INSERT INTO localidades (id, nombre, provincia, provincia_id, activo, orden, cobertura, creado_en, actualizado_en) VALUES ($1, $2, 'Cualquiera', 'ar-h', true, 999, false, now(), now())", loc, 'Pueblo ' + run)
      out.provinciaAlInsertar = await texto(loc)
      await sql("UPDATE localidades SET provincia_id = 'ar-w' WHERE id = $1", loc)
      out.provinciaAlMover = await texto(loc)
      out.provinciaInexistente = await sql("UPDATE localidades SET provincia_id = 'no-existe' WHERE id = $1", loc)
      // A zona of one locality, a barrio of another.
      const zona = run + '-zona'
      await sql("INSERT INTO zonas_ubicacion (id, localidad_id, nombre, slug, activo, orden, creado_en, actualizado_en) VALUES ($1, 'corrientes-capital', $2, $1, true, 999, now(), now())", zona, 'Zona ' + run.slice(-6))
      out.barrioOtraLocalidad = await sql("INSERT INTO barrios (id, localidad_id, zona_id, nombre, slug, activo, orden, creado_en, actualizado_en) VALUES ($1, $2, $3, 'Barrio X', $1, true, 999, now(), now())", run + '-barrio-x', loc, zona)
      out.barrioMismaLocalidad = await sql("INSERT INTO barrios (id, localidad_id, zona_id, nombre, slug, activo, orden, creado_en, actualizado_en) VALUES ($1, 'corrientes-capital', $2, 'Barrio Y', $1, true, 999, now(), now())", run + '-barrio-y', zona)
      out.barrioSinZona = await sql("INSERT INTO barrios (id, localidad_id, nombre, slug, activo, orden, creado_en, actualizado_en) VALUES ($1, $2, 'Barrio Z', $1, true, 999, now(), now())", run + '-barrio-z', loc)
      await prisma.barrio.deleteMany({ where: { id: { startsWith: run } } })
      await prisma.zonaUbicacion.deleteMany({ where: { id: zona } })
      await prisma.localidad.deleteMany({ where: { id: loc } })
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out, (_, value) => (typeof value === 'bigint' ? Number(value) : value)))
  `)
  assert.deepEqual(r.guardadas, [['30 minutos', 30, 8000], ['60 minutos', 60, 15000]])
  assert.equal(r.servicioNoOfrecido, 'NOT_FOUND')
  assert.equal(r.servicioNoOfrecidoSql, 'fk_tarifas_servicio_perfil_servicio')
  assert.deepEqual(r.rechazosSql, ['ck_tarifas_servicio_prestador_duracion', 'ck_tarifas_servicio_prestador_precio'])
  assert.deepEqual(r.invalidas, ['INVALID_PARAMS', 'INVALID_PARAMS', 'INVALID_PARAMS'])
  assert.equal(r.falloEnBase, true)
  assert.deepEqual(r.intactas, ['30 minutos', '60 minutos'], 'a failed save leaves the previous tarifas untouched')
  assert.deepEqual(r.ids, [true, true])
  assert.deepEqual(r.simultaneas, [true, true, true], 'simultaneous saves never mix their tarifas')
  assert.equal(r.quitarServicioConTarifas, 'fk_tarifas_servicio_perfil_servicio')
  assert.deepEqual(r.trasQuitarServicio, [0, [true]])
  assert.equal(r.borrarPerfil, 'accepted')
  assert.equal(r.provinciaTexto, 'Corrientes', 'the province name follows provincia_id')
  assert.equal(r.provinciaAlInsertar, 'Chaco')
  assert.equal(r.provinciaAlMover, 'Corrientes')
  assert.equal(r.provinciaInexistente, 'fk_localidades_provincia')
  assert.equal(r.barrioOtraLocalidad, 'fk_barrios_zona_localidad')
  assert.equal(r.barrioMismaLocalidad, 'accepted')
  assert.equal(r.barrioSinZona, 'accepted')
})
