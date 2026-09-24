import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const output = execFileSync(
    process.execPath,
    [tsxCli, '--eval', `(async () => {\n${FIXTURES}\n${source}\n})()`],
    { cwd: root, encoding: 'utf8' }
  )
  return JSON.parse(output.trim().split('\n').at(-1))
}

// Composicion en memoria real (la misma que usa la API sin PostgreSQL) + router HTTP.
const FIXTURES = `
  const { createTusApplication } = await import('./apps/api/src/tus/composition/index.ts')
  const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
  const { InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
  const { createApp } = await import('./apps/api/src/server.ts')
  const now = '2026-09-14T11:00:00.000Z'
  const application = createTusApplication({ now: () => Date.parse(now) })
  const provider = { sessionId: 'p', subjectId: 'provider-user', tenantId: 'provider-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read', 'tus:calendar:write', 'tus:calendar:read', 'tus:work:write', 'tus:work:read'], correlationId: 'corr-p' }
  const customer = { sessionId: 'c', subjectId: 'customer-user', tenantId: 'customer-tenant', roles: ['customer'], permissions: ['tus:marketplace:read', 'tus:checkout', 'tus:work:accept', 'tus:work:read'], correlationId: 'corr-c' }
  const foreign = { sessionId: 'f', subjectId: 'foreign-user', tenantId: 'foreign-tenant', roles: ['merchant'], permissions: ['tus:marketplace:read', 'tus:calendar:read', 'tus:calendar:write'], correlationId: 'corr-f' }
  await application.marketplace.onboard(provider, { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
  const listing = await application.marketplace.createListing(provider, { merchantId: 'provider-1', kind: 'service', name: 'Repair', description: 'Scheduled repair', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, durationMinutes: 45, capacity: 3, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
  const published = await application.marketplace.publishListing(provider, listing.listingId)
  await application.calendar.createCalendar(provider, { calendarId: 'calendar-1', prestadorId: 'provider-1', timezone: 'America/Argentina/Buenos_Aires', capacity: 3, granularityMinutes: 15, bufferMinutes: 0, workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }] })
  const slots = await application.calendar.slotsForPublication(customer, published, 'calendar-1', '2026-09-14', now)
  let seq = 0
  const book = async () => { seq += 1; return application.calendar.bookPublication(customer, published, { calendarId: 'calendar-1', customerId: customer.subjectId, slotId: slots[seq % slots.length].slotId, idempotencyKey: 'booking-' + seq, requestHash: 'hash-' + seq, now }) }
  const commit = async (cartId, booking) => (await application.marketplace.checkout({ tenantId: customer.tenantId, actorId: customer.subjectId, correlationId: 'corr-checkout', idempotencyKey: 'checkout-' + cartId, requestHash: 'h-' + cartId, cartId, createdAt: now, lines: [{ lineId: 'line-' + cartId, listingId: listing.listingId, context: 'service', quantity: 1, availabilityVersion: published.availabilityVersion, price: 1000, slotStart: booking.startsAt, slotEnd: booking.endsAt }] })).commitments[0]
  const accept = (commitmentId, reservationId, key) => application.acceptServiceCommitment(provider, { commitmentId, reservationId, idempotencyKey: key, requestHash: 'client', createdAt: now })
  const calendarStore = application.calendar.store
  const workRepos = application.work.transaction.repositories
  const counts = () => ({
    calendarAudit: calendarStore.audit.list(customer.tenantId).length + calendarStore.audit.list(provider.tenantId).length,
    calendarOutbox: calendarStore.outbox.list(customer.tenantId).length + calendarStore.outbox.list(provider.tenantId).length,
    workAudit: workRepos.work.snapshot().audits.size,
    workTransitions: workRepos.work.snapshot().transitions.size,
    workOutbox: workRepos.outbox.list(customer.tenantId).length,
    workIdempotency: workRepos.idempotency.snapshot().size,
  })
  const sessions = new InMemoryTusSessionResolver()
  sessions.add('provider-token', provider)
  sessions.add('customer-token', customer)
  sessions.add('foreign-token', foreign)
  const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions, now: () => Date.parse(now) }), tusRoutesEnabled: true }).listen(0)
  const base = 'http://127.0.0.1:' + server.address().port
  const post = async (token, path, body = {}, key) => {
    const response = await fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-correlation-id': 'corr-' + path, ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify({ now, ...body }) })
    return { status: response.status, body: await response.json() }
  }
  const providerWork = { tenantId: provider.tenantId, actorId: provider.subjectId, correlationId: 'corr-read' }
  const json = (value) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item))
  const codeOf = async (promise) => { try { await promise; return 'ok' } catch (error) { return error.code ?? 'unknown:' + error.message } }
`

test('WEB-08I calendar cancels unlinked bookings and rejects linked ones without writing', () => {
  const result = runTypeScriptScenario(`
    try {
      const free = await book()
      const freeCancel = await post('customer-token', '/tus/v1/calendar/bookings/' + free.bookingId + '/cancel', { reason: 'no longer needed' })

      const linkedBooking = await book()
      const commitment = await commit('cart-linked', linkedBooking)
      const accepted = await accept(commitment.commitmentId, linkedBooking.bookingId, 'accept-linked')
      const other = await book()
      const before = { booking: await calendarStore.bookings.find(linkedBooking.bookingId), work: (await application.work.getWork(providerWork, accepted.work.trabajoId)).work, counts: counts() }
      const customerCancel = await post('customer-token', '/tus/v1/calendar/bookings/' + linkedBooking.bookingId + '/cancel', { reason: 'direct' })
      const providerCancel = await post('provider-token', '/tus/v1/calendar/bookings/' + linkedBooking.bookingId + '/cancel', { reason: 'direct' })
      const providerNoShow = await post('provider-token', '/tus/v1/calendar/bookings/' + linkedBooking.bookingId + '/no-show', { now: '2026-09-15T12:00:00.000Z' })
      const foreignLinked = await post('foreign-token', '/tus/v1/calendar/bookings/' + linkedBooking.bookingId + '/cancel', { reason: 'probe' })
      const foreignUnlinked = await post('foreign-token', '/tus/v1/calendar/bookings/' + other.bookingId + '/cancel', { reason: 'probe' })
      const after = { booking: await calendarStore.bookings.find(linkedBooking.bookingId), work: (await application.work.getWork(providerWork, accepted.work.trabajoId)).work, counts: counts() }
      console.log(JSON.stringify({
        freeCancel: { status: freeCancel.status, bookingStatus: freeCancel.body.status },
        customerCancel, providerCancel, providerNoShow,
        foreignLinked, foreignUnlinked,
        bookingUnchanged: json(before.booking) === json(after.booking),
        workUnchanged: JSON.stringify(before.work) === JSON.stringify(after.work),
        countsUnchanged: JSON.stringify(before.counts) === JSON.stringify(after.counts),
      }))
    } finally { server.close() }
  `)

  assert.deepEqual(result.freeCancel, { status: 200, bookingStatus: 'cancelled' })
  for (const response of [result.customerCancel, result.providerCancel, result.providerNoShow]) {
    assert.equal(response.status, 409)
    assert.equal(response.body.code, 'RESERVATION_LINKED_TO_WORK')
    assert.equal(JSON.stringify(response.body).includes('trabajo-'), false)
  }
  // A foreign tenant gets the same answer whether or not the booking is linked.
  assert.deepEqual(result.foreignLinked, result.foreignUnlinked)
  assert.equal(result.foreignLinked.status, 403)
  assert.equal(result.bookingUnchanged, true)
  assert.equal(result.workUnchanged, true)
  assert.equal(result.countsUnchanged, true)
})

test('WEB-08I work cancellation is the only path and cancels work and reservation together once', () => {
  const result = runTypeScriptScenario(`
    try {
      const booking = await book()
      const commitment = await commit('cart-cancel', booking)
      const accepted = await accept(commitment.commitmentId, booking.bookingId, 'accept-cancel')
      const workId = accepted.work.trabajoId
      const customerWorkCancel = await post('customer-token', '/tus/v1/work/' + workId + '/cancel', { expectedVersion: accepted.work.version, requestHash: 'h' }, 'customer-cancel')
      const cancelled = await post('provider-token', '/tus/v1/work/' + workId + '/cancel', { expectedVersion: accepted.work.version, requestHash: 'h' }, 'cancel-1')
      const afterFirst = { booking: await calendarStore.bookings.find(booking.bookingId), counts: counts() }
      const replay = await post('provider-token', '/tus/v1/work/' + workId + '/cancel', { expectedVersion: accepted.work.version, requestHash: 'other-client-hash' }, 'cancel-1')
      const otherKey = await post('provider-token', '/tus/v1/work/' + workId + '/cancel', { expectedVersion: cancelled.body.work.version, requestHash: 'h' }, 'cancel-2')
      const afterRetries = { booking: await calendarStore.bookings.find(booking.bookingId), counts: counts() }
      const calendarAfter = await post('customer-token', '/tus/v1/calendar/bookings/' + booking.bookingId + '/cancel', { reason: 'late' })
      const events = workRepos.outbox.list(customer.tenantId).filter((event) => event.eventType === 'tus.work.cancelled')
      const audits = [...workRepos.work.snapshot().audits.values()].filter((audit) => audit.action === 'reservation.cancelled')
      console.log(JSON.stringify({
        customerWorkCancel: customerWorkCancel.status,
        cancelled: { status: cancelled.status, workStatus: cancelled.body.work.status },
        bookingAfterFirst: { status: afterFirst.booking.status, version: afterFirst.booking.version },
        replay: { status: replay.status, replay: replay.body.status },
        otherKey: { status: otherKey.status, code: otherKey.body.code },
        bookingStable: json(afterFirst.booking) === json(afterRetries.booking),
        countsStable: JSON.stringify(afterFirst.counts) === JSON.stringify(afterRetries.counts),
        events: events.map((event) => ({ reservationId: event.payload.reservationId, reservationCancelled: event.payload.reservationCancelled })),
        reservationAudits: audits.length,
        bookingId: booking.bookingId,
        calendarAfter: calendarAfter.body.code,
      }))
    } finally { server.close() }
  `)

  assert.equal(result.customerWorkCancel, 403)
  assert.deepEqual(result.cancelled, { status: 200, workStatus: 'cancelled' })
  assert.deepEqual(result.bookingAfterFirst, { status: 'cancelled', version: 2 })
  assert.deepEqual(result.replay, { status: 200, replay: 'replay' })
  assert.deepEqual(result.otherKey, { status: 409, code: 'INVALID_STATE' })
  assert.equal(result.bookingStable, true)
  assert.equal(result.countsStable, true)
  assert.deepEqual(result.events, [{ reservationId: result.bookingId, reservationCancelled: true }])
  assert.equal(result.reservationAudits, 1)
  assert.equal(result.calendarAfter, 'RESERVATION_LINKED_TO_WORK')
})

test('WEB-08I linking a work and cancelling its booking never both succeed in memory', () => {
  const result = runTypeScriptScenario(`
    try {
      const scenario = async (label, run) => {
        const booking = await book()
        const commitment = await commit('cart-' + label, booking)
        const acceptRun = () => codeOf(accept(commitment.commitmentId, booking.bookingId, 'accept-' + label))
        const cancelRun = () => codeOf(application.calendar.cancel(customer, { bookingId: booking.bookingId, now, reason: label }))
        const [acceptOutcome, cancelOutcome] = await run(acceptRun, cancelRun)
        const stored = await calendarStore.bookings.find(booking.bookingId)
        const linked = await workRepos.work.findByReservation({ prestadorTenantId: provider.tenantId, reservationId: booking.bookingId })
        return { acceptOutcome, cancelOutcome, bookingStatus: stored.status, linked: Boolean(linked) }
      }
      const raced = []
      for (let index = 0; index < 6; index += 1)
        raced.push(await scenario('race-' + index, (a, c) => index % 2 === 0 ? Promise.all([a(), c()]) : Promise.all([c(), a()]).then(([x, y]) => [y, x])))
      const workFirst = await scenario('work-first', async (a, c) => { const x = await a(); return [x, await c()] })
      const cancelFirst = await scenario('cancel-first', async (a, c) => { const y = await c(); return [await a(), y] })
      console.log(JSON.stringify({ raced, workFirst, cancelFirst }))
    } finally { server.close() }
  `)

  for (const outcome of [...result.raced, result.workFirst, result.cancelFirst]) {
    // Exactly one of the two operations wins and the stored state matches the winner.
    assert.equal(
      [outcome.acceptOutcome, outcome.cancelOutcome].filter((code) => code === 'ok').length,
      1
    )
    assert.equal(outcome.linked, outcome.acceptOutcome === 'ok')
    assert.equal(outcome.bookingStatus, outcome.linked ? 'confirmed' : 'cancelled')
  }
  assert.deepEqual(result.workFirst, {
    acceptOutcome: 'ok',
    cancelOutcome: 'RESERVATION_LINKED_TO_WORK',
    bookingStatus: 'confirmed',
    linked: true,
  })
  assert.deepEqual(result.cancelFirst, {
    acceptOutcome: 'INVALID_RESERVATION_LINK',
    cancelOutcome: 'ok',
    bookingStatus: 'cancelled',
    linked: false,
  })
})

test('WEB-08I Prisma adapters lock the booking row and cancel the linked reservation in the work transaction', () => {
  const output = execFileSync(
    process.execPath,
    [
      tsxCli,
      '--eval',
      `(async () => {
        const { PrismaServiceCalendarStore } = await import('./apps/api/src/tus/adapters/prisma-calendar.ts')
        const { PrismaTrabajoReservaStore } = await import('./apps/api/src/tus/adapters/prisma-work.ts')
        const calls = []
        const client = {
          reserva: { updateMany: async (input) => (calls.push(['reserva.updateMany', input]), { count: 1 }) },
          trabajo: { findFirst: async (input) => (calls.push(['trabajo.findFirst', input]), input.where.reservaId === 'linked' ? { trabajoId: 'trabajo-1' } : null) },
        }
        const calendar = new PrismaServiceCalendarStore(client)
        await calendar.bookings.lockForChange({ ownerTenantId: 'provider-tenant', bookingId: 'linked' })
        const linked = await calendar.bookings.linkedWorkId({ ownerTenantId: 'provider-tenant', bookingId: 'linked' })
        const free = await calendar.bookings.linkedWorkId({ ownerTenantId: 'provider-tenant', bookingId: 'free' })
        const cancelled = await new PrismaTrabajoReservaStore(client).cancelForWork({ ownerTenantId: 'provider-tenant', reservationId: 'linked', updatedAt: '2026-09-24T10:00:00.000Z' })
        console.log(JSON.stringify({ calls, linked, free, cancelled }))
      })()`,
    ],
    { cwd: root, encoding: 'utf8' }
  )
  const result = JSON.parse(output.trim())
  assert.deepEqual(result.calls[0], [
    'reserva.updateMany',
    {
      where: { tenantId: 'provider-tenant', reservaId: 'linked' },
      data: { version: { increment: 0 } },
    },
  ])
  assert.deepEqual(result.calls[1][1], {
    where: { reservaTenantId: 'provider-tenant', reservaId: 'linked' },
  })
  assert.equal(result.linked, 'trabajo-1')
  assert.equal(result.free, null)
  assert.deepEqual(result.calls[3], [
    'reserva.updateMany',
    {
      where: { tenantId: 'provider-tenant', reservaId: 'linked', estado: 'confirmed' },
      data: {
        estado: 'cancelled',
        version: { increment: 1 },
        fechaActualizacion: '2026-09-24T10:00:00.000Z',
      },
    },
  ])
  assert.equal(result.cancelled, true)
})
