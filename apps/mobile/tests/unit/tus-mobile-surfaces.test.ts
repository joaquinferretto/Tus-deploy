import {
  createTusMobileSurfaceClient,
  createTusMobileSurfaceFetchTransport,
  type MobileSurfaceContext,
} from '../../src/application/tus-surface-client'
import { resolveMobileRuntimeConfig } from '../../src/core/config/runtime-profile'

const context: MobileSurfaceContext = {
  tenantId: 'tenant-arg',
  actorId: 'staff-arg',
  correlationId: 'corr-mobile',
  accessToken: 'example-mobile-token',
}

describe('TUS mobile contract surfaces', () => {
  it('registers a device and opens/closes a tenant-scoped POS session', async () => {
    const requests: Array<{ path: string; body?: unknown; idempotencyKey?: string }> = []
    const client = createTusMobileSurfaceClient({
      request: async (input) => {
        requests.push({ path: input.path, body: input.body, ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }) })
        return { deviceId: 'device-1', sessionId: input.path.includes('sessions') ? 'session-1' : undefined }
      },
    })

    await client.registerDevice({ ...context, deviceId: 'device-1', label: 'Counter iPhone', fingerprint: 'fp-1' })
    await client.openPosSession({ ...context, sessionId: 'session-1', deviceId: 'device-1', shiftId: 'shift-1' })
    await client.closePosSession({ ...context, sessionId: 'session-1' })

    expect(requests).toEqual([
      { path: '/tus/v1/pos/devices', body: { deviceId: 'device-1', label: 'Counter iPhone', fingerprint: 'fp-1' } },
      { path: '/tus/v1/pos/sessions', body: { sessionId: 'session-1', deviceId: 'device-1', shiftId: 'shift-1' } },
      { path: '/tus/v1/pos/sessions/session-1/close' },
    ])
  })

  it('keeps POS refunds compensating and status lookup read-only', async () => {
    const requests: Array<{ method: string; path: string; idempotencyKey?: string }> = []
    const client = createTusMobileSurfaceClient({
      request: async (input) => {
        requests.push({ method: input.method, path: input.path, ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }) })
        return { status: 'pending' }
      },
    })

    await client.refundPos({ ...context, refundId: 'refund-1', originalOperationId: 'operation-1', idempotencyKey: 'refund-key', amount: 100, reason: 'customer-request', expectedVersion: 1 })
    await client.queryOperationStatus({ ...context, operationId: 'operation-1' })

    expect(requests).toEqual([
      { method: 'POST', path: '/tus/v1/pos/refunds', idempotencyKey: 'refund-key' },
      { method: 'GET', path: '/tus/v1/pos/operations/operation-1/status' },
    ])
  })

  it('shapes calendar, product discovery, payment, delivery, and support requests without client authority fields', async () => {
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown>; idempotencyKey?: string }> = []
    const client = createTusMobileSurfaceClient({
      request: async (input) => {
        requests.push({ method: input.method, path: input.path, ...(input.body === undefined ? {} : { body: input.body as Record<string, unknown> }), ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }) })
        return { ok: true }
      },
    })

    await client.discoverOffers({ ...context, locationId: 'ba', cohort: 'repairs-trades' })
    await client.listServiceSlots({ ...context, calendarId: 'calendar-1', date: '2026-09-14' })
    await client.bookService({ ...context, idempotencyKey: 'booking-key', requestHash: 'booking-hash', calendarId: 'calendar-1', serviceId: 'service-1', customerId: 'customer-1', slotId: 'slot-1' })
    await client.createPaymentIntent({ ...context, idempotencyKey: 'payment-key', requestHash: 'payment-hash', commitmentId: 'commitment-1', orderId: 'order-1', posOperationId: 'operation-1' })
    await client.listDeliveryTasks(context)
    await client.openSupportCase({ ...context, caseId: 'case-1', commitmentId: 'commitment-1', category: 'delivery' })

    expect(requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: 'GET', path: '/tus/v1/marketplace/discovery?locationId=ba&cohort=repairs-trades' },
      { method: 'GET', path: '/tus/v1/calendar/calendar-1/slots?date=2026-09-14' },
      { method: 'POST', path: '/tus/v1/calendar/bookings' },
      { method: 'POST', path: '/tus/v1/finance/payment-intents' },
      { method: 'GET', path: '/tus/v1/delivery/tasks' },
      { method: 'POST', path: '/tus/v1/support/cases' },
    ])
    expect(requests[2]?.body).toEqual({ requestHash: 'booking-hash', calendarId: 'calendar-1', serviceId: 'service-1', customerId: 'customer-1', slotId: 'slot-1' })
    expect(requests[3]?.body).toEqual({ requestHash: 'payment-hash', commitmentId: 'commitment-1', orderId: 'order-1', posOperationId: 'operation-1' })
    expect(requests[5]?.body).toEqual({ caseId: 'case-1', commitmentId: 'commitment-1', category: 'delivery' })
  })

  it('classifies provider/database failures as unavailable without inventing success', () => {
    expect(() => createTusMobileSurfaceClient({ request: async () => { throw new Error('database unavailable') } })).not.toThrow()
    expect(createTusMobileSurfaceClient({ request: async () => ({ ok: true }) }).classifyFailure({ status: 503, code: 'READINESS_BLOCKED' })).toEqual({ status: 'unavailable', retryable: true, code: 'READINESS_BLOCKED' })
    expect(createTusMobileSurfaceClient({ request: async () => ({ ok: true }) }).classifyFailure({ status: 403, code: 'FORBIDDEN' })).toEqual({ status: 'denied', retryable: false, code: 'FORBIDDEN' })
  })

  it('uses the resolved API URL and bearer credential without sending client authority headers', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; headers: Record<string, string> }> = []
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) })
      return new Response(JSON.stringify({ status: 'pending' }), { status: 202 })
    }

    try {
      const transport = createTusMobileSurfaceFetchTransport(resolveMobileRuntimeConfig({ profile: 'staging' }))
      await transport.request({ method: 'GET', path: '/tus/v1/delivery/tasks', context: { ...context, tenantId: 'tenant-authoritative', actorId: 'actor-authoritative' } })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(requests[0]?.url).toBe('https://api-staging.example.invalid/tus/v1/delivery/tasks')
    expect(requests[0]?.headers).toMatchObject({ authorization: 'Bearer example-mobile-token', 'x-correlation-id': 'corr-mobile' })
    expect(requests[0]?.headers['x-tenant-id']).toBeUndefined()
    expect(requests[0]?.headers['x-actor-id']).toBeUndefined()
  })
})
