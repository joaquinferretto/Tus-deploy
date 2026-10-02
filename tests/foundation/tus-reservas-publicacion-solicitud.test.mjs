import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// TURNOS-SOLICITUD-01 for the reservation of a PUBLISHED SERVICE (POST /tus/v1/calendar/bookings,
// the screens /tus/mercado and /tus/calendario, and the works that link it). One meaning for every
// reservation a client makes: it is a REQUEST (pending) that holds its time; only the provider
// confirms it — by accepting the work the reservation belongs to — and a rejected or overdue
// request gives the time back. The whole application runs over real HTTP; the clock is the server's.
const SETUP = `
  const { createTusApplication } = await import('./apps/api/src/tus/composition/index.ts')
  const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
  const { InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
  const { createApp } = await import('./apps/api/src/server.ts')
  const HORA = 3_600_000
  // Monday 2026-09-14, 08:00 in Argentina. The clock of the server; the scenario moves it.
  let reloj = Date.parse('2026-09-14T11:00:00.000Z')
  const ahora = () => new Date(reloj).toISOString()
  const application = createTusApplication({ now: () => reloj })
  const provider = { sessionId: 'p', subjectId: 'provider-user', tenantId: 'provider-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read', 'tus:calendar:write', 'tus:calendar:read', 'tus:work:write', 'tus:work:read'], correlationId: 'corr-p' }
  const cliente = (n) => ({ sessionId: 'c' + n, subjectId: 'customer-user-' + n, tenantId: 'customer-tenant-' + n, roles: ['customer'], permissions: ['tus:marketplace:read', 'tus:checkout', 'tus:work:accept', 'tus:work:read'], correlationId: 'corr-c' + n })
  const ana = cliente(1)
  const beto = cliente(2)
  await application.marketplace.onboard(provider, { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
  const listing = await application.marketplace.createListing(provider, { merchantId: 'provider-1', kind: 'service', name: 'Repair', description: 'Scheduled repair', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, durationMinutes: 45, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
  const published = await application.marketplace.publishListing(provider, listing.listingId)
  await application.calendar.createCalendar(provider, { calendarId: 'calendar-1', prestadorId: 'provider-1', timezone: 'America/Argentina/Buenos_Aires', capacity: 1, granularityMinutes: 15, bufferMinutes: 0, workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }] })
  const calendarStore = application.calendar.store
  const sessions = new InMemoryTusSessionResolver()
  sessions.add('provider-token', provider); sessions.add('ana-token', ana); sessions.add('beto-token', beto)
  const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions, now: () => reloj }), tusRoutesEnabled: true }).listen(0)
  const base = 'http://127.0.0.1:' + server.address().port
  const post = async (token, path, body = {}, key) => {
    const response = await fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-correlation-id': 'corr-' + path, ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const franjas = async (fecha) => (await application.calendar.slotsForPublication(ana, published, 'calendar-1', fecha, ahora())).map((slot) => slot.slotId)
  let n = 0
  // What a client can do: POST /tus/v1/calendar/bookings.
  const pedir = (token, quien, slotId, extra = {}) => { n += 1; return post(token, '/tus/v1/calendar/bookings', { listingId: listing.listingId, customerId: quien.subjectId, slotId, requestHash: 'h-' + n, ...extra }, 'pedido-' + n) }
  const guardada = (id) => calendarStore.bookings.find(id)
  const compromiso = async (quien, booking) => { n += 1; return (await application.marketplace.checkout({ tenantId: quien.tenantId, actorId: quien.subjectId, correlationId: 'corr-checkout', idempotencyKey: 'checkout-' + n, requestHash: 'hc-' + n, cartId: 'cart-' + n, createdAt: ahora(), lines: [{ lineId: 'line-' + n, listingId: listing.listingId, context: 'service', quantity: 1, availabilityVersion: published.availabilityVersion, price: 1000, slotStart: booking.startsAt, slotEnd: booking.endsAt }] })).commitments[0] }
  // What the provider does: it accepts the work of that commitment, with its reservation.
  const aceptarTrabajo = (token, commitmentId, reservationId) => { n += 1; return post(token, '/tus/v1/work/commitments/' + commitmentId + '/accept', { reservationId, requestHash: 'client' }, 'accept-' + n) }
  const cancelar = (token, id) => post(token, '/tus/v1/calendar/bookings/' + id + '/cancel', { reason: 'test' })
`

test('RESERVA de una publicación: POST /tus/v1/calendar/bookings never creates a confirmed reservation — it is a pending request with a validity decided by the server, whatever the client sends', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const hoy = await franjas('2026-09-14')
      const proxima = await franjas('2026-09-21')
      // A. The client asks. H. The body tries to force the state, the validity, the clock, the price and the provider.
      const pedido = await pedir('ana-token', ana, hoy[0], { status: 'confirmed', estado: 'confirmed', requestExpiresAt: '2099-01-01T00:00:00.000Z', solicitudExpiraEn: '2099-01-01T00:00:00.000Z', now: '2020-01-01T00:00:00.000Z', ownerTenantId: 'customer-tenant-1', priceSnapshot: { minor: '1', currency: 'ARS' }, precioFinal: 1, version: 9, esInvitado: true })
      const fila = await guardada(pedido.body.bookingId)
      out.pedido = [pedido.status, pedido.body.status, fila.status, fila.requestExpiresAt === fila.startsAt, fila.ownerTenantId, fila.tenantId, fila.customerId, fila.version, fila.createdAt === ahora(), String(fila.priceSnapshot?.minor ?? fila.priceSnapshot?.amount ?? ''), 'priceSnapshot' in pedido.body]
      // A reservation far ahead: exactly 24 hours of validity, counted with the server clock.
      const lejos = await pedir('ana-token', ana, proxima[0])
      out.vigencia = [(Date.parse((await guardada(lejos.body.bookingId)).requestExpiresAt) - reloj) / HORA, lejos.body.status]
      // The same request again (same idempotency key) is the same request, still pending.
      const repetida = await post('ana-token', '/tus/v1/calendar/bookings', { listingId: listing.listingId, customerId: ana.subjectId, slotId: proxima[0], requestHash: 'h-' + n }, 'pedido-' + n)
      out.repetida = [repetida.status, repetida.body.status, repetida.body.booking.status]
      // Identity: another customer id, tenant or actor in the request is refused; nothing is stored.
      const antes = (await calendarStore.bookings.forCalendar('calendar-1')).length
      out.identidad = [
        (await pedir('ana-token', beto, hoy[1])).status,
        (await pedir('ana-token', ana, hoy[1], { tenantId: 'customer-tenant-2' })).status,
        (await pedir('ana-token', ana, hoy[1], { actorId: 'customer-user-2' })).status,
        (await pedir('', ana, hoy[1])).status,
        (await calendarStore.bookings.forCalendar('calendar-1')).length - antes,
      ]
      // E. Another client, the same time: the pending request holds it.
      const otro = await pedir('beto-token', beto, hoy[0])
      out.retiene = [otro.status, otro.body.status, otro.body.reason, (await franjas('2026-09-14')).includes(hoy[0])]
      // F. Nothing a client can call confirms it.
      const c = await compromiso(ana, fila)
      out.clienteNoConfirma = [
        (await aceptarTrabajo('ana-token', c.commitmentId, fila.bookingId)).status,
        (await aceptarTrabajo('beto-token', c.commitmentId, fila.bookingId)).status,
        (await post('ana-token', '/tus/v1/calendar/bookings/' + fila.bookingId + '/no-show', {})).status,
        (await guardada(fila.bookingId)).status,
      ]
      // One client cannot keep the agenda waiting with many requests.
      const mas = [await pedir('ana-token', ana, proxima[4]), await pedir('ana-token', ana, proxima[8])]
      out.limite = [mas.map((x) => x.status), mas.at(-1).body.code, (await pedir('beto-token', beto, proxima[8])).status]
      // H. Every reservation a client left in the agenda is a request: none was born confirmed.
      out.estados = [...new Set((await calendarStore.bookings.forCalendar('calendar-1')).map((b) => b.status))]
    } finally { server.close() }
    console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  `)
  assert.deepEqual(r.pedido, [201, 'pending', 'pending', true, 'provider-tenant', 'customer-tenant-1', 'customer-user-1', 1, true, '100000', false], 'pending; the validity ends with the reservation itself (sooner than 24 hours); the provider, the client, the price and the clock are the server\'s')
  assert.deepEqual(r.vigencia, [24, 'pending'])
  assert.deepEqual(r.repetida, [200, 'replay', 'pending'])
  assert.deepEqual(r.identidad, [403, 403, 403, 403, 0], 'the client of a request is the session; a different identity in the request is refused')
  assert.deepEqual(r.retiene, [409, 'rejected', 'capacity', false], 'a pending request holds its time: not offered, not taken')
  assert.deepEqual(r.clienteNoConfirma, [403, 403, 403, 'pending'], 'no client call confirms a request')
  assert.deepEqual(r.limite, [[201, 409], 'TOO_MANY_PENDING_REQUESTS', 201])
  assert.deepEqual(r.estados, ['pending'], 'no reservation of a client is born confirmed')
})

test('RESERVA de una publicación: only the provider confirms (accepting the work, in one transaction); it rejects by turning the request down; an overdue request expires, frees its time and can no longer be confirmed; the client withdraws its own', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const hoy = await franjas('2026-09-14')
      const proxima = await franjas('2026-09-21')
      // B + G. The provider accepts the work: the request becomes the confirmed reservation and the work exists.
      const pedido = await pedir('ana-token', ana, proxima[0])
      const c1 = await compromiso(ana, pedido.body)
      const aceptado = await aceptarTrabajo('provider-token', c1.commitmentId, pedido.body.bookingId)
      const confirmada = await guardada(pedido.body.bookingId)
      out.aceptada = [aceptado.status, aceptado.body.work.status, aceptado.body.work.reservaId === pedido.body.bookingId, confirmada.status, confirmada.version]
      out.sigueOcupado = [(await franjas('2026-09-21')).includes(proxima[0]), (await pedir('beto-token', beto, proxima[0])).status]
      // G. The work keeps working as before: cancelling it cancels its reservation with it.
      const cancelado = await post('provider-token', '/tus/v1/work/' + aceptado.body.work.trabajoId + '/cancel', { expectedVersion: aceptado.body.work.version, requestHash: 'h' }, 'cancel-1')
      out.trabajoCancelado = [cancelado.status, cancelado.body.work.status, (await guardada(pedido.body.bookingId)).status, (await franjas('2026-09-21')).includes(proxima[0])]

      // C. The provider turns a request down: rejected; the time is offered again; it cannot be confirmed later.
      const segundo = await pedir('ana-token', ana, proxima[3])
      const c2 = await compromiso(ana, segundo.body)
      const rechazo = await cancelar('provider-token', segundo.body.bookingId)
      out.rechazada = [rechazo.status, rechazo.body.status, (await franjas('2026-09-21')).includes(proxima[3]), (await aceptarTrabajo('provider-token', c2.commitmentId, segundo.body.bookingId)).body.code, (await guardada(segundo.body.bookingId)).status]
      const reuso = await pedir('beto-token', beto, proxima[3])
      out.reuso = [reuso.status, reuso.body.status]

      // The client withdraws its own request (never somebody else's): cancelled, and never confirmable.
      const tercero = await pedir('ana-token', ana, proxima[6])
      const c3 = await compromiso(ana, tercero.body)
      out.retiro = [(await cancelar('beto-token', tercero.body.bookingId)).status, (await cancelar('ana-token', tercero.body.bookingId)).body.status, (await aceptarTrabajo('provider-token', c3.commitmentId, tercero.body.bookingId)).body.code]

      // D. Nobody answers in time: the request stops holding its time and cannot be confirmed.
      const cuarto = await pedir('ana-token', ana, proxima[9])
      const c4 = await compromiso(ana, cuarto.body)
      reloj += 25 * HORA
      out.vencida = [(await guardada(cuarto.body.bookingId)).status, (await franjas('2026-09-21')).includes(proxima[9]), (await aceptarTrabajo('provider-token', c4.commitmentId, cuarto.body.bookingId)).body.code]
      // The next request for that time marks it expired and takes the time.
      const nuevo = await pedir('beto-token', beto, proxima[9])
      out.trasVencer = [nuevo.status, nuevo.body.status, (await guardada(cuarto.body.bookingId)).status]
      // A request for a time that already started is never confirmed either.
      const quinto = await pedir('ana-token', ana, (await franjas('2026-09-28'))[0])
      const c5 = await compromiso(ana, quinto.body)
      reloj = Date.parse(quinto.body.startsAt) + 60_000
      out.pasada = [(await aceptarTrabajo('provider-token', c5.commitmentId, quinto.body.bookingId)).body.code, (await guardada(quinto.body.bookingId)).status === 'confirmed']
      out.nuncaConfirmadaPorCliente = (await calendarStore.bookings.forCalendar('calendar-1')).filter((b) => b.status === 'confirmed').length
    } finally { server.close() }
    console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  `)
  assert.deepEqual(r.aceptada, [201, 'requested', true, 'confirmed', 2], 'the provider accepting the work is what confirms the reservation')
  assert.deepEqual(r.sigueOcupado, [false, 409])
  assert.deepEqual(r.trabajoCancelado, [200, 'cancelled', 'cancelled', true], 'Trabajos: the work and its reservation are still cancelled together')
  assert.deepEqual(r.rechazada, [200, 'rejected', true, 'INVALID_RESERVATION_LINK', 'rejected'])
  assert.deepEqual(r.reuso, [201, 'pending'])
  assert.deepEqual(r.retiro, [403, 'cancelled', 'INVALID_RESERVATION_LINK'])
  assert.deepEqual(r.vencida, ['pending', true, 'INVALID_RESERVATION_LINK'], 'overdue: its time is offered again and the provider can no longer confirm it')
  assert.deepEqual(r.trasVencer, [201, 'pending', 'expired'])
  assert.deepEqual(r.pasada, ['INVALID_RESERVATION_LINK', false])
  assert.equal(r.nuncaConfirmadaPorCliente, 0, 'the only confirmed reservation of the scenario was confirmed by the provider and then cancelled with its work')
})

test('RESERVA de una publicación, concurrency: several clients asking for the same time at once leave one request; several acceptances of the same work confirm it once', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const proxima = await franjas('2026-09-21')
      const clientes = [ana, beto, cliente(3), cliente(4), cliente(5)]
      clientes.slice(2).forEach((quien, i) => sessions.add('c' + (i + 3) + '-token', quien))
      const tokens = ['ana-token', 'beto-token', 'c3-token', 'c4-token', 'c5-token']
      const carrera = await Promise.all(clientes.map((quien, i) => pedir(tokens[i], quien, proxima[0])))
      const vigentes = (await calendarStore.bookings.forCalendar('calendar-1')).filter((b) => b.status === 'pending' || b.status === 'confirmed')
      out.carrera = [carrera.filter((x) => x.status === 201).length, carrera.filter((x) => x.status === 409).length, vigentes.length, vigentes[0].status]
      const ganador = carrera.findIndex((x) => x.status === 201)
      const c = await compromiso(clientes[ganador], carrera[ganador].body)
      const aceptaciones = await Promise.all([1, 2, 3, 4].map(() => aceptarTrabajo('provider-token', c.commitmentId, carrera[ganador].body.bookingId)))
      const final = await guardada(carrera[ganador].body.bookingId)
      out.aceptaciones = [aceptaciones.filter((x) => x.status === 201).length, aceptaciones.filter((x) => x.status !== 201).map((x) => x.body.code ?? x.status).sort(), final.status, final.version]
    } finally { server.close() }
    console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  `)
  assert.deepEqual(r.carrera, [1, 4, 1, 'pending'], 'five clients, one time: one pending request')
  assert.equal(r.aceptaciones[0], 1, 'the work is created once')
  assert.deepEqual([r.aceptaciones[2], r.aceptaciones[3]], ['confirmed', 2], 'confirmed once: a single change of state')
})

// ---- The same rules with the REAL adapters on a DISPOSABLE PostgreSQL 16 (TUS_PERFIL_TURNOS_PG_URL,
// every migration applied; never a shared or production database): the request is stored pending
// with its validity (ck_reservas_solicitud_vigencia), ex_reservas_sin_solapamiento keeps one live
// reservation per time, and the acceptance of the work is the conditional UPDATE that confirms it.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

test('RESERVA de una publicación PostgreSQL: the request is stored pending; accepting the work confirms it once; an overdue or blocked request is not confirmed; the provider also answers it from its agenda of turnos; concurrent requests leave one', { skip, timeout: 240000 }, () => {
  const r = runTypeScriptScenario(`
    const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
    const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
    const { PrismaServiceCalendarStore } = await import('./apps/api/src/tus/adapters/prisma-calendar.ts')
    const { PrismaMarketplaceStore } = await import('./apps/api/src/tus/adapters/prisma-marketplace.ts')
    const { PrismaTrabajoReservaStore } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
    const { ServiceCalendarService } = await import('./apps/api/src/tus/calendar/bookings.ts')
    const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
    const run = 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
    const out = {}
    try {
      const ahora = new Date()
      const provider = { sessionId: 'p', subjectId: run + '-provider-user', tenantId: run + '-provider', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read', 'tus:calendar:write', 'tus:calendar:read'], correlationId: 'corr-p' }
      const cliente = (n) => ({ sessionId: 'c' + n, subjectId: run + '-customer-' + n, tenantId: run + '-customer-tenant-' + n, roles: ['customer'], permissions: ['tus:marketplace:read'], correlationId: 'corr-c' + n })
      const clientes = [1, 2, 3, 4].map(cliente)
      for (const t of [provider.tenantId, ...clientes.map((c) => c.tenantId)]) await prisma.tusTenant.create({ data: { id: t, slug: t, name: t, status: 'active', createdAt: ahora, updatedAt: ahora } })
      const merchantId = run + '-m'
      await prisma.prestador.create({ data: { id: run + '-p', tenantId: provider.tenantId, prestadorId: merchantId, cohorte: 'repairs-trades', ubicacionId: 'ubicacion', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', fechaCreacion: ahora, fechaActualizacion: ahora } })
      const listingId = run + '-listing'
      const todos = [0, 1, 2, 3, 4, 5, 6]
      await prisma.publicacion.create({ data: { id: listingId, versionContrato: '1.0.0', tenantId: provider.tenantId, prestadorId: merchantId, tipo: 'service', nombre: 'Repair', descripcion: 'Scheduled repair', cohorte: 'repairs-trades', ubicacionId: 'ubicacion', moneda: 'ARS', precio: 100000n, versionDisponibilidad: 1, publicada: true, versionPolitica: 'policy-1', duracionMinutos: 45, capacidad: 1, horarioTrabajo: todos.map((day) => ({ day, start: '09:00', end: '18:00' })), fechaCreacion: ahora, fechaActualizacion: ahora } })
      const published = await new PrismaMarketplaceStore(prisma).listings.find(listingId)
      const calendar = new ServiceCalendarService(new PrismaServiceCalendarStore(prisma))
      const calendarId = run + '-cal'
      await calendar.createCalendar(provider, { calendarId, prestadorId: merchantId, timezone: 'America/Argentina/Buenos_Aires', capacity: 1, granularityMinutes: 15, bufferMinutes: 0, workingHours: todos.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })) })
      const dia = new Date(Date.now() + 4 * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10)
      const franjas = async () => (await calendar.slotsForPublication(clientes[0], published, calendarId, dia, new Date().toISOString())).map((slot) => slot.slotId)
      const libres = await franjas()
      let n = 0
      const pedir = async (quien, slotId) => { n += 1; try { const x = await calendar.bookPublication(quien, published, { calendarId, customerId: quien.subjectId, slotId, idempotencyKey: 'k' + n, requestHash: 'h' + n, now: new Date().toISOString() }); return 'bookingId' in x ? x : 'rejected:' + x.reason } catch (e) { return 'error:' + (e?.code ?? String(e?.message ?? e).slice(0, 60)) } }
      const fila = (id) => prisma.reserva.findUnique({ where: { id } })
      const vivas = (inicio) => prisma.reserva.count({ where: { calendarioId: calendarId, fechaInicio: inicio, estado: { in: ['pending', 'confirmed'] } } })
      const reservas = new PrismaTrabajoReservaStore(prisma)
      const aceptarTrabajo = (booking, quien) => reservas.lockForWork({ ownerTenantId: provider.tenantId, reservationId: booking.bookingId, customerTenantId: quien.tenantId, listingId, acceptedAt: new Date().toISOString() })

      // A. The request, as PostgreSQL holds it.
      const pedido = await pedir(clientes[0], libres[0])
      const guardada = await fila(pedido.bookingId)
      out.pedido = [pedido.status, guardada.estado, guardada.clienteId === clientes[0].subjectId, guardada.clienteTenantId === clientes[0].tenantId, guardada.tenantId === provider.tenantId, guardada.publicacionId === listingId, Math.round((guardada.solicitudExpiraEn.getTime() - guardada.fechaCreacion.getTime()) / 3_600_000), guardada.clienteNombre, guardada.clienteEmail]
      // E. It holds its time: another client is refused, the time is not offered.
      out.retiene = [await pedir(clientes[1], libres[0]), (await franjas()).includes(libres[0])]
      // The provider sees it among the requests of its agenda (the same table, the same state).
      const turnos = new ServicioTurnos(prisma)
      out.enPanel = (await turnos.solicitudesPrestador(provider.tenantId)).map((item) => [item.id === pedido.bookingId, item.estado, item.duracionMinutos])
      // A wrong client or provider never links (and never confirms).
      out.ajena = [await reservas.lockForWork({ ownerTenantId: provider.tenantId, reservationId: pedido.bookingId, customerTenantId: clientes[1].tenantId, listingId, acceptedAt: new Date().toISOString() }), await reservas.lockForWork({ ownerTenantId: clientes[0].tenantId, reservationId: pedido.bookingId, customerTenantId: clientes[0].tenantId, listingId, acceptedAt: new Date().toISOString() }), (await fila(pedido.bookingId)).estado]
      // B. Several acceptances of the work at once: confirmed once.
      const aceptaciones = await Promise.all([1, 2, 3, 4].map(() => aceptarTrabajo(pedido, clientes[0])))
      const confirmada = await fila(pedido.bookingId)
      out.aceptada = [aceptaciones, confirmada.estado, confirmada.version]
      out.confirmadaRetiene = [await pedir(clientes[1], libres[0]), (await franjas()).includes(libres[0])]

      // D. Overdue: not confirmed by the work, not listed, its time offered again and taken by another request.
      const vieja = await pedir(clientes[0], libres[4])
      await prisma.reserva.update({ where: { id: vieja.bookingId }, data: { solicitudExpiraEn: new Date(Date.now() - 1000) } })
      out.vencida = [await aceptarTrabajo(vieja, clientes[0]), (await fila(vieja.bookingId)).estado, (await turnos.solicitudesPrestador(provider.tenantId)).some((item) => item.id === vieja.bookingId), (await franjas()).includes(libres[4])]
      const nueva = await pedir(clientes[1], libres[4])
      out.trasVencer = [nueva.status, (await fila(vieja.bookingId)).estado, await vivas((await fila(nueva.bookingId)).fechaInicio)]

      // The provider blocked that time after the request: accepting the work confirms nothing.
      const bloqueada = await pedir(clientes[2], libres[8])
      const filaBloqueada = await fila(bloqueada.bookingId)
      await prisma.excepcionCalendario.create({ data: { id: run + '-exc', tenantId: provider.tenantId, calendarioId: calendarId, fechaInicio: filaBloqueada.fechaInicio, fechaFin: filaBloqueada.fechaFin, motivo: 'Trámite', estado: 'active', fechaCreacion: new Date() } })
      out.bloqueada = [await aceptarTrabajo(bloqueada, clientes[2]), (await fila(bloqueada.bookingId)).estado]
      await prisma.excepcionCalendario.update({ where: { id: run + '-exc' }, data: { estado: 'cancelled' } })

      // C. The provider answers from its agenda of turnos: reject frees the time, accept confirms.
      const rechazada = await turnos.rechazarSolicitud({ prestadorTenantId: provider.tenantId, reservaId: bloqueada.bookingId })
      out.rechazada = [rechazada.estado, await aceptarTrabajo(bloqueada, clientes[2]), (await franjas()).includes(libres[8])]
      const porAgenda = await turnos.aceptarSolicitud({ prestadorTenantId: provider.tenantId, reservaId: nueva.bookingId })
      out.porAgenda = [porAgenda.estado, await aceptarTrabajo(nueva, clientes[1]), (await fila(nueva.bookingId)).version]

      // E. Four clients, the same time, at once: one pending request; nobody gets an internal error.
      await Promise.all(Array.from({ length: 6 }, () => prisma.$queryRawUnsafe('select 1 as ok from pg_sleep(0.05)')))
      const carrera = await Promise.all(clientes.map((quien) => pedir(quien, libres[12])))
      const ganadoras = carrera.filter((x) => typeof x === 'object')
      out.carrera = [ganadoras.length, ganadoras[0]?.status, carrera.filter((x) => typeof x === 'string'), ganadoras[0] ? await vivas((await fila(ganadoras[0].bookingId)).fechaInicio) : -1]
      // H. Nothing a client did left a confirmed reservation: only the provider's answers did.
      out.confirmadas = (await prisma.reserva.findMany({ where: { calendarioId: calendarId, estado: 'confirmed' } })).map((x) => x.id).sort().join() === [pedido.bookingId, nueva.bookingId].sort().join()
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  `)
  assert.deepEqual(r.pedido, ['pending', 'pending', true, true, true, true, 24, null, null], 'stored pending, for the session client, 24 hours of validity, no copied contact')
  assert.deepEqual(r.retiene, ['rejected:capacity', false])
  assert.deepEqual(r.enPanel, [[true, 'pending', 45]], 'the provider sees it as a request of its agenda')
  assert.deepEqual(r.ajena, [false, false, 'pending'], 'another client or another provider links nothing and confirms nothing')
  assert.deepEqual(r.aceptada, [[true, true, true, true], 'confirmed', 2], 'four acceptances at once: one change of state')
  assert.deepEqual(r.confirmadaRetiene, ['rejected:capacity', false])
  assert.deepEqual(r.vencida, [false, 'pending', false, true], 'overdue: not confirmed, not listed, its time is offered')
  assert.deepEqual(r.trasVencer, ['pending', 'expired', 1], 'the next request marks it expired and is the only live reservation of that time')
  assert.deepEqual(r.bloqueada, [false, 'pending'], 'a time blocked meanwhile is not confirmed')
  assert.deepEqual(r.rechazada, ['rejected', false, true])
  assert.deepEqual(r.porAgenda, ['confirmed', true, 2], 'accepted in the agenda: confirmed; the work then only locks it')
  assert.deepEqual([r.carrera[0], r.carrera[1], r.carrera[3]], [1, 'pending', 1], 'four clients at once: one request')
  assert.ok(r.carrera[2].length === 3 && r.carrera[2].every((x) => x === 'rejected:capacity' || x === 'error:SLOT_OCCUPIED' || x === 'error:CONCURRENT_MODIFICATION'), 'the others get a conflict they can act on, never an internal error: ' + r.carrera[2])
  assert.equal(r.confirmadas, true, 'every confirmed reservation was confirmed by the provider')
})

test('RESERVAS, one meaning in the whole code: the only writers of a confirmed reservation are the provider (manual turno, accepting a request, accepting a work) and the administration; the clock of a reservation is the server\'s', () => {
  const root = join(import.meta.dirname, '..', '..')
  // Line endings differ between checkouts: the patterns below are written for LF.
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const bookings = read('apps/api/src/tus/calendar/bookings.ts')
  assert.match(bookings, /\/\/ A REQUEST: nothing sent by the client can make it confirmed\. The provider confirms it\.\n\s+status: BOOKING_STATUS\.PENDING,\n\s+requestExpiresAt: new Date\(Math\.min\(serverNow \+ HORAS_VIGENCIA_SOLICITUD_TURNO \* 3_600_000, Date\.parse\(slot\.start\)\)\)\.toISOString\(\),/u, 'the booking of a client is born pending, with a validity computed from the server clock')
  assert.doesNotMatch(bookings, /status: BOOKING_STATUS\.CONFIRMED,/u, 'the booking service never writes a confirmed reservation')
  // Every place that writes "confirmed" on a reservation, in the whole API.
  const escritores = [
    ['apps/api/src/tus/calendar/turnos-service.ts', /estado: solicitud \? 'pending' : 'confirmed'|estado: 'confirmed',|pasar\('confirmed'\)/gu, 4],
    ['apps/api/src/tus/adapters/prisma-work.ts', /data: \{ estado: 'confirmed'/gu, 2],
    ['apps/api/src/tus/adapters/prisma-calendar.ts', /estado: 'confirmed'/gu, 0],
    ['apps/api/src/tus/calendar/turnos-http.ts', /estado: 'confirmed'/gu, 0],
    ['apps/api/src/tus/http/router.ts', /estado: 'confirmed'|status: 'confirmed'/gu, 0],
  ]
  for (const [archivo, patron, cantidad] of escritores) assert.equal((read(archivo).match(patron) ?? []).length, cantidad, archivo + ': writers of a confirmed reservation')
  const turnos = read('apps/api/src/tus/calendar/turnos-service.ts')
  // The one creation that can be born confirmed is reached only by the administration.
  assert.equal((turnos.match(/this\.crearTurno\(/gu) ?? []).length, 2)
  assert.match(turnos, /async solicitarTurno\(input: EntradaSolicitudTurno\): Promise<DetalleTurno> \{\n\s+const turno = await this\.crearTurno\(\{ \.\.\.input \}, true\)/u)
  assert.equal((read('apps/api/src/tus/calendar/turnos-http.ts').match(/servicio\.reservarTurno\(/gu) ?? []).length, 0, 'no HTTP route books a confirmed turno for a client')
  assert.match(read('apps/api/src/tus/asistente/dominio.ts'), /this\.compartidos\.turnos\.solicitarTurno\(/u, 'the assistant (Web and WhatsApp) requests')
  // The clock of the three booking writes is the server's.
  const router = read('apps/api/src/tus/http/router.ts')
  const rutas = router.slice(router.indexOf("router.post('/tus/v1/calendar/bookings'"), router.indexOf("'/tus/v1/calendar/bookings/:bookingId/no-show'") + 900)
  assert.doesNotMatch(rutas, /readString\(body, 'now'\)/u, 'a now sent by the client is never read by the booking routes')
  assert.equal((rutas.match(/now: new Date\(now\(\)\)\.toISOString\(\),/gu) ?? []).length, 3)
})
