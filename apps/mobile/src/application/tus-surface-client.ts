import { TUS_CONTRACT_VERSION } from '@factory/contracts/tus'

import { readMobileRuntimeConfig, parseMobileRuntimeConfig, type MobileRuntimeConfig } from '../core/config/runtime-profile'

export interface MobileSurfaceContext {
  tenantId: string
  actorId: string
  correlationId: string
  accessToken?: string
}

export interface MobileSurfaceRequest<TBody = unknown> {
  method: 'GET' | 'POST'
  path: string
  context: MobileSurfaceContext
  body?: TBody
  idempotencyKey?: string
}

export interface MobileSurfaceTransport {
  request<TBody = unknown>(input: MobileSurfaceRequest<TBody>): Promise<unknown>
}

export interface MobileDeviceInput extends MobileSurfaceContext {
  deviceId: string
  label: string
  fingerprint: string
}

export interface MobilePosSessionInput extends MobileSurfaceContext {
  sessionId: string
  deviceId: string
  shiftId: string
}

export interface MobilePosRefundInput extends MobileSurfaceContext {
  refundId: string
  originalOperationId: string
  idempotencyKey: string
  amount: number
  reason: string
  expectedVersion: number
}

export interface MobileServiceSlotsInput extends MobileSurfaceContext {
  calendarId: string
  date: string
}

export interface MobileBookingInput extends MobileSurfaceContext {
  idempotencyKey: string
  requestHash: string
  calendarId: string
  serviceId: string
  customerId: string
  slotId: string
}

export interface MobilePaymentIntentInput extends MobileSurfaceContext {
  idempotencyKey: string
  requestHash: string
  commitmentId: string
  orderId?: string
  posOperationId?: string
}

export interface MobileSupportCaseInput extends MobileSurfaceContext {
  caseId: string
  commitmentId: string
  category: string
}

export interface MobileDiscoveryInput extends MobileSurfaceContext {
  locationId?: string
  cohort?: string
}

export interface MobileSurfaceFailure {
  status: 'denied' | 'unavailable' | 'error'
  retryable: boolean
  code?: string
}

export interface TusMobileSurfaceClient {
  registerDevice(input: MobileDeviceInput): Promise<unknown>
  openPosSession(input: MobilePosSessionInput): Promise<unknown>
  closePosSession(input: MobileSurfaceContext & { sessionId: string }): Promise<unknown>
  refundPos(input: MobilePosRefundInput): Promise<unknown>
  queryOperationStatus(input: MobileSurfaceContext & { operationId: string }): Promise<unknown>
  discoverOffers(input: MobileDiscoveryInput): Promise<unknown>
  listServiceSlots(input: MobileServiceSlotsInput): Promise<unknown>
  bookService(input: MobileBookingInput): Promise<unknown>
  createPaymentIntent(input: MobilePaymentIntentInput): Promise<unknown>
  listDeliveryTasks(input: MobileSurfaceContext): Promise<unknown>
  openSupportCase(input: MobileSupportCaseInput): Promise<unknown>
  classifyFailure(error: unknown): MobileSurfaceFailure
}

export function createTusMobileSurfaceClient(transport: MobileSurfaceTransport): TusMobileSurfaceClient {
  return {
    registerDevice: ({ deviceId, label, fingerprint, ...context }) => transport.request({ method: 'POST', path: '/tus/v1/pos/devices', context, body: { deviceId, label, fingerprint } }),
    openPosSession: ({ sessionId, deviceId, shiftId, ...context }) => transport.request({ method: 'POST', path: '/tus/v1/pos/sessions', context, body: { sessionId, deviceId, shiftId } }),
    closePosSession: ({ sessionId, ...context }) => transport.request({ method: 'POST', path: `/tus/v1/pos/sessions/${encodeURIComponent(sessionId)}/close`, context }),
    refundPos: ({ refundId, originalOperationId, idempotencyKey, amount, reason, expectedVersion, ...context }) => transport.request({ method: 'POST', path: '/tus/v1/pos/refunds', context, idempotencyKey, body: { refundId, originalOperationId, idempotencyKey, amount, reason, expectedVersion } }),
    queryOperationStatus: ({ operationId, ...context }) => transport.request({ method: 'GET', path: `/tus/v1/pos/operations/${encodeURIComponent(operationId)}/status`, context }),
    discoverOffers: ({ locationId, cohort, ...context }) => transport.request({ method: 'GET', path: buildDiscoveryPath(locationId, cohort), context }),
    listServiceSlots: ({ calendarId, date, ...context }) => transport.request({ method: 'GET', path: `/tus/v1/calendar/${encodeURIComponent(calendarId)}/slots?date=${encodeURIComponent(date)}`, context }),
    bookService: ({ idempotencyKey, requestHash, calendarId, serviceId, customerId, slotId, ...context }) => transport.request({ method: 'POST', path: '/tus/v1/calendar/bookings', context, idempotencyKey, body: { requestHash, calendarId, serviceId, customerId, slotId } }),
    createPaymentIntent: ({ idempotencyKey, requestHash, commitmentId, orderId, posOperationId, ...context }) => transport.request({ method: 'POST', path: '/tus/v1/finance/payment-intents', context, idempotencyKey, body: { requestHash, commitmentId, ...(orderId === undefined ? {} : { orderId }), ...(posOperationId === undefined ? {} : { posOperationId }) } }),
    listDeliveryTasks: (context) => transport.request({ method: 'GET', path: '/tus/v1/delivery/tasks', context }),
    openSupportCase: ({ caseId, commitmentId, category, ...context }) => transport.request({ method: 'POST', path: '/tus/v1/support/cases', context, body: { caseId, commitmentId, category } }),
    classifyFailure,
  }
}

export class MobileSurfaceRequestError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super('The TUS mobile request was not confirmed.')
    this.name = 'MobileSurfaceRequestError'
  }
}

export function createTusMobileSurfaceFetchTransport(runtime?: MobileRuntimeConfig): MobileSurfaceTransport {
  const resolvedRuntime = runtime === undefined ? readMobileRuntimeConfig() : parseMobileRuntimeConfig(runtime)
  return {
    async request(input) {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-TUS-API-Version': 'v1',
        'X-TUS-Contract-Version': TUS_CONTRACT_VERSION,
        'X-Correlation-Id': input.context.correlationId,
      }
      if (input.context.accessToken !== undefined && input.context.accessToken.length > 0) headers.Authorization = `Bearer ${input.context.accessToken}`
      if (input.idempotencyKey !== undefined) headers['Idempotency-Key'] = input.idempotencyKey
      if (input.body !== undefined) headers['Content-Type'] = 'application/json'

      const response = await fetch(`${resolvedRuntime.apiUrl}${input.path}`, {
        method: input.method,
        headers,
        credentials: 'omit',
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      })
      const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
      if (!response.ok) {
        const record = asRecord(body)
        throw new MobileSurfaceRequestError(response.status, typeof record['code'] === 'string' ? record['code'] : undefined)
      }
      return body
    },
  }
}

function buildDiscoveryPath(locationId: string | undefined, cohort: string | undefined): string {
  const query = new URLSearchParams()
  if (locationId !== undefined) query.set('locationId', locationId)
  if (cohort !== undefined) query.set('cohort', cohort)
  const value = query.toString()
  return value.length === 0 ? '/tus/v1/marketplace/discovery' : `/tus/v1/marketplace/discovery?${value}`
}

function classifyFailure(error: unknown): MobileSurfaceFailure {
  const record = asRecord(error)
  const status = typeof record['status'] === 'number' ? record['status'] : undefined
  const code = typeof record['code'] === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(record['code']) ? record['code'] : undefined
  if (status === 401 || status === 403) return { status: 'denied', retryable: false, ...(code === undefined ? {} : { code }) }
  if (status === undefined || status === 408 || status === 429 || status >= 500) return { status: 'unavailable', retryable: true, ...(code === undefined ? {} : { code }) }
  return { status: 'error', retryable: false, ...(code === undefined ? {} : { code }) }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

export default { createTusMobileSurfaceClient, createTusMobileSurfaceFetchTransport }
