import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  return JSON.parse(execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  }).trim())
}

test('WEB-04 uses the real calendar slots and booking endpoints with bounded payloads', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const requests = []
    const client = createTusWebClient({ request: async (input) => {
      requests.push(input)
      return input.method === 'GET'
        ? { slots: [{ slotId: 'calendar-1:2026-09-20T14:00:00.000Z', calendarId: 'calendar-1', serviceId: 'service-1', timezone: 'America/Argentina/Buenos_Aires', start: '2026-09-20T14:00:00.000Z', end: '2026-09-20T15:30:00.000Z', capacity: 1 }] }
        : { contractVersion: '1.0.0', bookingId: 'booking-1', tenantId: 'customer-tenant', ownerTenantId: 'merchant-tenant', serviceId: 'service-1', calendarId: 'calendar-1', customerId: 'customer-user', startsAt: '2026-09-20T14:00:00.000Z', endsAt: '2026-09-20T15:30:00.000Z', status: 'confirmed', version: 1, policyVersion: 'calendar-policy-1', createdAt: '2026-09-16T12:00:00.000Z', updatedAt: '2026-09-16T12:00:00.000Z' }
    } })
    const context = { tenantId: 'customer-tenant', actorId: 'customer-user', correlationId: 'corr-calendar', accessToken: 'token' }
    const slots = await client.calendarSlots(context, 'calendar-1', '2026-09-20', '2026-09-16T12:00:00.000Z')
    const booking = await client.calendarBooking({ ...context, calendarId: 'calendar-1', serviceId: 'service-1', customerId: 'customer-user', slotId: slots.slots[0].slotId, idempotencyKey: 'tus:booking:intent-1', requestHash: 'calendar-hash', now: '2026-09-16T12:00:00.000Z' })
    console.log(JSON.stringify({ slots, booking, requests }))
  `)
  assert.equal(result.requests[0].path, '/tus/v1/calendar/calendar-1/slots?date=2026-09-20&now=2026-09-16T12%3A00%3A00.000Z')
  assert.equal(result.requests[0].method, 'GET')
  assert.equal(result.requests[1].path, '/tus/v1/calendar/bookings')
  assert.equal(result.requests[1].body.calendarId, 'calendar-1')
  assert.equal(result.requests[1].body.serviceId, 'service-1')
  assert.equal(result.requests[1].body.slotId, result.slots.slots[0].slotId)
  assert.equal(result.requests[1].body.idempotencyKey, 'tus:booking:intent-1')
  assert.equal(result.booking.bookingId, 'booking-1')
})

test('WEB-04 preserves calendar idempotency and distinguishes stale or unavailable slots', () => {
  const result = runTypeScriptScenario(`
    const { construirIntencionReserva, mensajeErrorCalendario, parseTusCalendarBookingResponse } = (await import('./apps/web/src/lib/tus-calendar.ts')).default
    const intent = construirIntencionReserva('calendar-1', 'service-1', { slotId: 'slot-1', start: '2026-09-20T14:00:00.000Z', end: '2026-09-20T15:30:00.000Z' }, 'intent-1', '2026-09-16T12:00:00.000Z')
    console.log(JSON.stringify({
      intent,
      replay: parseTusCalendarBookingResponse({ status: 'replay', booking: { bookingId: 'booking-1' } }),
      rejected: parseTusCalendarBookingResponse({ status: 'rejected', reason: 'capacity' }),
      stale: mensajeErrorCalendario('STALE_SLOT'),
      cutoff: mensajeErrorCalendario('BOOKING_CUTOFF'),
    }))
  `)
  assert.equal(result.intent.idempotencyKey, 'tus:booking:intent-1')
  assert.match(result.intent.requestHash, /calendar-1:service-1:slot-1/)
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.rejected.status, 'rejected')
  assert.match(result.stale, /disponible/i)
  assert.match(result.cutoff, /límite/i)
})
