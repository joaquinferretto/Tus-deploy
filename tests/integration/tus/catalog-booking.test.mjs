import assert from 'node:assert/strict'
import { test } from 'node:test'

const { InMemoryMarketplaceStore, MarketplaceError, TusMarketplaceService } = await import(
  '../../../apps/api/src/tus/catalog/index.ts'
)
const {
  InMemoryServiceCalendarStore,
  ServiceCalendarError,
  ServiceCalendarService,
  generateServiceSlots,
} = await import('../../../apps/api/src/tus/calendar/index.ts')

const merchantContext = {
  subjectId: 'merchant-user',
  sessionId: 'merchant-session',
  tenantId: 'merchant-tenant',
  roles: ['merchant'],
  permissions: ['tus:marketplace:write', 'tus:marketplace:read'],
  correlationId: 'corr-merchant',
}

function customerContext(subjectId = 'customer-user') {
  return {
    subjectId,
    sessionId: `${subjectId}-session`,
    tenantId: 'customer-tenant',
    roles: ['customer'],
    permissions: ['tus:marketplace:read'],
    correlationId: `corr-${subjectId}`,
  }
}

function operatorContext() {
  return {
    subjectId: 'operator-user',
    sessionId: 'operator-session',
    tenantId: 'merchant-tenant',
    roles: ['operator'],
    permissions: ['tus:calendar:write', 'tus:marketplace:read'],
    correlationId: 'corr-operator',
  }
}

async function createPublishedProduct() {
  const service = new TusMarketplaceService(new InMemoryMarketplaceStore())
  await service.onboard(merchantContext, {
    merchantId: 'merchant-1',
    cohort: 'repairs-trades',
    locationId: 'location-1',
    timezone: 'America/Argentina/Buenos_Aires',
    staffRoles: ['merchant'],
    operatingPolicyVersion: 'policy-1',
  })
  const listing = await service.createListing(merchantContext, {
    merchantId: 'merchant-1',
    kind: 'product',
    name: 'Copper fitting',
    description: 'A stock-controlled fitting',
    cohort: 'repairs-trades',
    locationId: 'location-1',
    currency: 'ars',
    price: 12.5,
    priceMinor: 1250n,
    stock: 1,
  })
  return { service, listing: await service.publishListing(merchantContext, listing.listingId) }
}

test('catalog keeps merchant ownership separate from customer tenant and snapshots exact money', async () => {
  const { service, listing } = await createPublishedProduct()
  assert.equal(listing.merchantId, 'merchant-1')
  assert.deepEqual(listing.priceSnapshot, { currency: 'ARS', minor: 1250n })

  const result = await service.checkout({
    tenantId: 'customer-tenant',
    actorId: 'customer-user',
    correlationId: 'corr-checkout',
    idempotencyKey: 'checkout-1',
    cartId: 'cart-1',
    requestHash: 'hash-1',
    createdAt: '2026-09-14T12:00:00.000Z',
    lines: [{
      lineId: 'line-1',
      listingId: listing.listingId,
      context: 'product',
      quantity: 1,
      availabilityVersion: 1,
      price: 12.5,
    }],
  })
  assert.equal(result.status, 'executed')
  assert.deepEqual(result.commitments[0].priceSnapshot, { currency: 'ARS', minor: 1250n })
  assert.equal(result.commitments[0].tenantId, 'customer-tenant')
  assert.equal((await service.discover()).items.length, 0)
})

test('catalog serializes stock races and replays one idempotent checkout', async () => {
  const { service, listing } = await createPublishedProduct()
  const checkout = (customer, key) => service.checkout({
    tenantId: customer,
    actorId: customer,
    correlationId: `corr-${key}`,
    idempotencyKey: key,
    cartId: `cart-${key}`,
    requestHash: `hash-${key}`,
    createdAt: '2026-09-14T12:00:00.000Z',
    lines: [{ lineId: `line-${key}`, listingId: listing.listingId, context: 'product', quantity: 1, availabilityVersion: 1, price: 12.5 }],
  })
  const results = await Promise.allSettled([checkout('customer-a', 'race-a'), checkout('customer-b', 'race-b')])
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1)
  assert.equal(results.filter((entry) => entry.status === 'rejected').length, 1)
  await assert.rejects(
    () => service.publishListing({ ...merchantContext, tenantId: 'other-tenant' }, listing.listingId),
    (error) => error instanceof MarketplaceError && error.code === 'FORBIDDEN',
  )
  const replay = await service.checkout({
    tenantId: 'customer-a', actorId: 'customer-a', correlationId: 'corr-replay', idempotencyKey: 'race-a', cartId: 'cart-race-a', requestHash: 'hash-race-a', createdAt: '2026-09-14T12:00:00.000Z',
    lines: [{ lineId: 'line-race-a', listingId: listing.listingId, context: 'product', quantity: 1, availabilityVersion: 1, price: 12.5 }],
  })
  assert.equal(replay.status, 'replay')
})

test('catalog separates merchant operations from customer reads by role', async () => {
  const { service } = await createPublishedProduct()
  await assert.rejects(() => service.merchantOperations(customerContext()), (error) => error instanceof MarketplaceError && error.code === 'FORBIDDEN')
})

function calendarInput(overrides = {}) {
  return {
    calendarId: 'calendar-1',
    serviceId: 'service-1',
    status: 'active',
    timezone: 'America/Argentina/Buenos_Aires',
    durationMinutes: 60,
    bufferMinutes: 15,
    capacity: 1,
    bookingCutoffMinutes: 30,
    cancellationWindowMinutes: 60,
    noShowAfterMinutes: 30,
    workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }],
    blackoutDates: [],
    ...overrides,
  }
}

test('calendar generates timezone-aware buffered slots and excludes blackout dates', () => {
  const calendar = calendarInput()
  const slots = generateServiceSlots(calendar, { date: '2026-09-14', now: '2026-09-14T11:00:00.000Z' })
  assert.deepEqual(slots.map((slot) => [slot.start, slot.end]), [
    ['2026-09-14T12:00:00.000Z', '2026-09-14T13:00:00.000Z'],
    ['2026-09-14T13:15:00.000Z', '2026-09-14T14:15:00.000Z'],
  ])
  assert.equal(generateServiceSlots({ ...calendar, blackoutDates: ['2026-09-14'] }, { date: '2026-09-14' }).length, 0)
})

test('booking rechecks cutoff/capacity, records late cancellation and operator no-show', async () => {
  const service = new ServiceCalendarService(new InMemoryServiceCalendarStore())
  await service.createCalendar(operatorContext(), calendarInput())
  const slot = (await service.slots(customerContext(), 'calendar-1', '2026-09-14', '2026-09-14T11:00:00.000Z'))[0]
  const command = { calendarId: 'calendar-1', serviceId: 'service-1', customerId: 'customer-user', slotId: slot.slotId, idempotencyKey: 'booking-1', requestHash: 'booking-hash', now: '2026-09-14T11:00:00.000Z' }
  const booking = await service.book(customerContext(), command)
  assert.equal(booking.status, 'confirmed')
  assert.equal((await service.book(customerContext('customer-2'), { ...command, customerId: 'customer-2', idempotencyKey: 'booking-2', requestHash: 'booking-hash-2' })).status, 'rejected')
  const replay = await service.book(customerContext(), command)
  assert.equal(replay.status, 'replay')
  const cancelled = await service.cancel(customerContext(), { bookingId: booking.bookingId, now: '2026-09-14T11:30:00.000Z', reason: 'late change' })
  assert.equal(cancelled.status, 'cancelled-late')

  const second = await service.book(customerContext('customer-3'), { ...command, customerId: 'customer-3', slotId: (await service.slots(customerContext(), 'calendar-1', '2026-09-14', '2026-09-14T11:00:00.000Z'))[1].slotId, idempotencyKey: 'booking-3', requestHash: 'booking-hash-3' })
  assert.equal(second.status, 'confirmed')
  const noShow = await service.markNoShow(operatorContext(), { bookingId: second.bookingId, now: '2026-09-14T15:00:00.000Z' })
  assert.equal(noShow.status, 'no-show')
  await assert.rejects(() => service.book(customerContext(), { ...command, idempotencyKey: 'booking-cutoff', requestHash: 'booking-cutoff', now: '2026-09-14T12:00:00.000Z' }), (error) => error instanceof ServiceCalendarError && error.code === 'BOOKING_CUTOFF')
})

test('calendar management is role- and tenant-scoped and preserves audit/outbox records', async () => {
  const store = new InMemoryServiceCalendarStore()
  const service = new ServiceCalendarService(store)
  await assert.rejects(() => service.createCalendar(customerContext(), calendarInput({ calendarId: 'customer-calendar' })), (error) => error instanceof ServiceCalendarError && error.code === 'FORBIDDEN')
  await assert.rejects(() => service.createCalendar(operatorContext(), calendarInput({ calendarId: 'foreign-calendar', tenantId: 'other-tenant' })), (error) => error instanceof ServiceCalendarError && error.code === 'FORBIDDEN')
  await assert.rejects(() => service.createCalendar(operatorContext(), calendarInput({ calendarId: 'bad-calendar', timezone: 'Not/AZone' })), (error) => error instanceof ServiceCalendarError && error.code === 'INVALID_CALENDAR')
  await service.createCalendar(operatorContext(), calendarInput({ priceSnapshot: { currency: 'ARS', minor: 2500n } }))
  assert.equal(store.audit.list('merchant-tenant').length, 1)
  assert.equal(store.outbox.list('merchant-tenant')[0].eventType, 'calendar.created')
})
