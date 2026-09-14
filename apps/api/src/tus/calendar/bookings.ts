import { randomUUID } from 'node:crypto'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import { generateServiceSlots, type Franja } from './slots.ts'
import { validateCalendarInput, type MoneySnapshot, type Calendario, type EntradaCalendario } from './rules.ts'

const BOOKING_STATUS = {
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  CANCELLED_LATE: 'cancelled-late',
  NO_SHOW: 'no-show',
} as const

type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS]

export interface Reserva {
  contractVersion: typeof TUS_CONTRACT_VERSION
  bookingId: string
  tenantId: string
  ownerTenantId: string
  serviceId: string
  calendarId: string
  customerId: string
  startsAt: string
  endsAt: string
  status: BookingStatus
  version: number
  priceSnapshot?: MoneySnapshot
  policyVersion: string
  createdAt: string
  updatedAt: string
}

export type ResultadoReserva =
  | Reserva
  | { status: 'replay'; booking: Reserva }
  | { status: 'rejected'; reason: 'capacity' }

export interface CalendarAuditRecord {
  auditId: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  resourceId: string
  outcome: 'allowed' | 'denied'
  createdAt: string
}

export interface CalendarOutboxRecord {
  eventId: string
  tenantId: string
  eventType: string
  aggregateId: string
  payload: { bookingId?: string; auditId: string }
  createdAt: string
}

interface IdempotencyRecord {
  requestHash: string
  response?: ResultadoReserva
}

export class ErrorCalendario extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ServiceCalendarError'
    this.status = status
    this.code = code
  }
}

export interface ServiceCalendarStorePort {
  calendars: {
    save(calendar: Calendario): Promise<void>
    find(calendarId: string): Promise<Calendario | null>
  }
  bookings: {
    save(booking: Reserva): Promise<void>
    find(bookingId: string): Promise<Reserva | null>
    forCalendar(calendarId: string): Promise<Reserva[]>
  }
  idempotency: {
    claim(input: { tenantId: string; key: string; requestHash: string }): Promise<{ status: 'claimed' | 'replay' | 'conflict' | 'in_progress'; response?: ResultadoReserva }>
    complete(input: { tenantId: string; key: string; response: ResultadoReserva }): Promise<void>
  }
  audit: { append(record: CalendarAuditRecord): Promise<void>; list(tenantId: string): CalendarAuditRecord[] }
  outbox: { append(record: CalendarOutboxRecord): Promise<void>; list(tenantId: string): CalendarOutboxRecord[] }
  transaction<T>(operation: (store: ServiceCalendarStorePort) => Promise<T>): Promise<T>
}

export class InMemoryServiceCalendarStore implements ServiceCalendarStorePort {
  private readonly calendarRecords = new Map<string, Calendario>()
  private readonly bookingRecords = new Map<string, Reserva>()
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>()
  private readonly auditRecords: CalendarAuditRecord[] = []
  private readonly outboxRecords: CalendarOutboxRecord[] = []
  private transactionTail: Promise<void> = Promise.resolve()

  readonly calendars = {
    save: async (calendar: Calendario) => { this.calendarRecords.set(calendar.calendarId, structuredClone(calendar)) },
    find: async (calendarId: string) => this.calendarRecords.has(calendarId) ? structuredClone(this.calendarRecords.get(calendarId)!) : null,
  }

  readonly bookings = {
    save: async (booking: Reserva) => { this.bookingRecords.set(booking.bookingId, structuredClone(booking)) },
    find: async (bookingId: string) => this.bookingRecords.has(bookingId) ? structuredClone(this.bookingRecords.get(bookingId)!) : null,
    forCalendar: async (calendarId: string) => [...this.bookingRecords.values()].filter((booking) => booking.calendarId === calendarId).map((booking) => structuredClone(booking)),
  }

  readonly idempotency = {
    claim: async ({ tenantId, key, requestHash }: { tenantId: string; key: string; requestHash: string }) => {
      const id = `${tenantId}:${key}`
      const current = this.idempotencyRecords.get(id)
      if (!current) { this.idempotencyRecords.set(id, { requestHash }); return { status: 'claimed' as const } }
      if (current.requestHash !== requestHash) return { status: 'conflict' as const }
      return current.response ? { status: 'replay' as const, response: structuredClone(current.response) } : { status: 'in_progress' as const }
    },
    complete: async ({ tenantId, key, response }: { tenantId: string; key: string; response: ResultadoReserva }) => {
      const current = this.idempotencyRecords.get(`${tenantId}:${key}`)
      if (!current) throw new ErrorCalendario(500, 'IDEMPOTENCY_MISSING', 'idempotency claim is missing')
      current.response = structuredClone(response)
    },
  }

  readonly audit = {
    append: async (record: CalendarAuditRecord) => { this.auditRecords.push(structuredClone(record)) },
    list: (tenantId: string) => this.auditRecords.filter((record) => record.tenantId === tenantId).map((record) => structuredClone(record)),
  }

  readonly outbox = {
    append: async (record: CalendarOutboxRecord) => { if (!this.outboxRecords.some((item) => item.eventId === record.eventId)) this.outboxRecords.push(structuredClone(record)) },
    list: (tenantId: string) => this.outboxRecords.filter((record) => record.tenantId === tenantId).map((record) => structuredClone(record)),
  }

  async transaction<T>(operation: (store: ServiceCalendarStorePort) => Promise<T>): Promise<T> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    const snapshot = this.snapshot()
    try { return await operation(this) } catch (error) { this.restore(snapshot); throw error } finally { release() }
  }

  private snapshot() {
    return {
      calendars: new Map([...this.calendarRecords].map(([key, value]) => [key, structuredClone(value)])),
      bookings: new Map([...this.bookingRecords].map(([key, value]) => [key, structuredClone(value)])),
      idempotency: new Map([...this.idempotencyRecords].map(([key, value]) => [key, structuredClone(value)])),
      audits: this.auditRecords.map((record) => structuredClone(record)),
      outbox: this.outboxRecords.map((record) => structuredClone(record)),
    }
  }

  private restore(snapshot: ReturnType<InMemoryServiceCalendarStore['snapshot']>): void {
    this.calendarRecords.clear(); this.bookingRecords.clear(); this.idempotencyRecords.clear(); this.auditRecords.length = 0; this.outboxRecords.length = 0
    for (const [key, value] of snapshot.calendars) this.calendarRecords.set(key, value)
    for (const [key, value] of snapshot.bookings) this.bookingRecords.set(key, value)
    for (const [key, value] of snapshot.idempotency) this.idempotencyRecords.set(key, value)
    this.auditRecords.push(...snapshot.audits); this.outboxRecords.push(...snapshot.outbox)
  }
}

export class ServiceCalendarService {
  private readonly store: ServiceCalendarStorePort
  private readonly now: () => number

  constructor(store: ServiceCalendarStorePort, now: () => number = () => Date.now()) {
    this.store = store
    this.now = now
  }

  async createCalendar(context: TusAuthenticatedTenantContext, input: EntradaCalendario): Promise<Calendario> {
    assertOperator(context)
    if (input.tenantId !== undefined && input.tenantId !== context.tenantId) throw new ErrorCalendario(403, 'FORBIDDEN', 'calendar tenant does not match authenticated session')
    try { validateCalendarInput(input) } catch (error) { throw new ErrorCalendario(400, 'INVALID_CALENDAR', error instanceof Error ? error.message : 'calendar is invalid') }
    const now = new Date(this.now()).toISOString()
    const calendar: Calendario = { ...input, tenantId: context.tenantId, status: 'active', bufferMinutes: input.bufferMinutes ?? 0, bookingCutoffMinutes: input.bookingCutoffMinutes ?? 0, cancellationWindowMinutes: input.cancellationWindowMinutes ?? 0, noShowAfterMinutes: input.noShowAfterMinutes ?? 0, workingHours: input.workingHours.map((rule) => ({ ...rule })), blackoutDates: [...(input.blackoutDates ?? [])], policyVersion: input.policyVersion ?? 'calendar-policy-1', version: 1, createdAt: now, updatedAt: now }
    await this.store.transaction(async (store) => { await store.calendars.save(calendar); await this.record(store, context, 'calendar.created', calendar.calendarId, now, 'calendar.created') })
    return calendar
  }

  async slots(context: TusAuthenticatedTenantContext, calendarId: string, date: string, now?: string): Promise<Franja[]> {
    assertRead(context)
    const calendar = await this.store.calendars.find(calendarId)
    if (!calendar) throw new ErrorCalendario(404, 'NOT_FOUND', 'calendar was not found')
    return generateSlotsOrThrow(calendar, date, now)
  }

  async book(context: TusAuthenticatedTenantContext, input: { calendarId: string; serviceId: string; customerId: string; slotId: string; idempotencyKey: string; requestHash: string; now: string }): Promise<ResultadoReserva> {
    assertCustomer(context)
    if (input.customerId !== context.subjectId) throw new ErrorCalendario(403, 'FORBIDDEN', 'customer does not match authenticated session')
    if (!input.idempotencyKey.trim() || !input.requestHash.trim()) throw new ErrorCalendario(400, 'INVALID', 'idempotencyKey and requestHash are required')
    return this.store.transaction(async (store) => {
      const claim = await store.idempotency.claim({ tenantId: context.tenantId, key: input.idempotencyKey, requestHash: input.requestHash })
      if (claim.status === 'replay') {
        const response = claim.response
        if (response && 'status' in response && response.status === 'rejected') return response
        const booking = response && 'bookingId' in response ? response : response && 'booking' in response ? response.booking : null
        if (!booking) throw new ErrorCalendario(500, 'IDEMPOTENCY_CORRUPT', 'replay response is invalid')
        return { status: 'replay' as const, booking }
      }
      if (claim.status === 'conflict') throw new ErrorCalendario(409, 'CONFLICT', 'idempotency key was already used for another request')
      if (claim.status === 'in_progress') throw new ErrorCalendario(409, 'IN_PROGRESS', 'the idempotent request is already in progress')
      const calendar = await store.calendars.find(input.calendarId)
      if (!calendar || calendar.serviceId !== input.serviceId || calendar.status !== 'active') throw new ErrorCalendario(404, 'NOT_FOUND', 'calendar was not found')
      const slotDate = input.slotId.slice(input.slotId.indexOf(':') + 1, input.slotId.indexOf(':') + 11)
      const slot = generateSlotsOrThrow(calendar, slotDate).find((candidate) => candidate.slotId === input.slotId)
      if (!slot) throw new ErrorCalendario(409, 'STALE_SLOT', 'requested slot is no longer available')
      const now = Date.parse(input.now)
      if (!Number.isFinite(now)) throw new ErrorCalendario(400, 'INVALID', 'now must be a valid timestamp')
      if (now > Date.parse(slot.start) - calendar.bookingCutoffMinutes * 60_000) throw new ErrorCalendario(409, 'BOOKING_CUTOFF', 'booking cutoff has passed')
      const active = (await store.bookings.forCalendar(calendar.calendarId)).filter((booking) => booking.status === BOOKING_STATUS.CONFIRMED && overlaps(slot.start, slot.end, booking.startsAt, booking.endsAt))
      if (active.length >= calendar.capacity) {
        const response = { status: 'rejected' as const, reason: 'capacity' as const }
        await store.idempotency.complete({ tenantId: context.tenantId, key: input.idempotencyKey, response })
        return response
      }
      const booking: Reserva = { contractVersion: TUS_CONTRACT_VERSION, bookingId: `booking-${context.tenantId}-${input.idempotencyKey}`, tenantId: context.tenantId, ownerTenantId: calendar.tenantId, serviceId: calendar.serviceId, calendarId: calendar.calendarId, customerId: input.customerId, startsAt: slot.start, endsAt: slot.end, status: BOOKING_STATUS.CONFIRMED, version: 1, ...(calendar.priceSnapshot === undefined ? {} : { priceSnapshot: structuredClone(calendar.priceSnapshot) }), policyVersion: calendar.policyVersion, createdAt: input.now, updatedAt: input.now }
      await store.bookings.save(booking)
      await this.record(store, context, 'booking.created', booking.bookingId, input.now, 'booking.created', booking.bookingId)
      const response: ResultadoReserva = booking
      await store.idempotency.complete({ tenantId: context.tenantId, key: input.idempotencyKey, response })
      return response
    })
  }

  async cancel(context: TusAuthenticatedTenantContext, input: { bookingId: string; now: string; reason: string; expectedVersion?: number }): Promise<Reserva> {
    assertRead(context)
    return this.store.transaction(async (store) => {
      const booking = await store.bookings.find(input.bookingId)
      if (!booking || booking.tenantId !== context.tenantId && booking.ownerTenantId !== context.tenantId) throw new ErrorCalendario(403, 'FORBIDDEN', 'booking is outside the authenticated scope')
      if (booking.tenantId === context.tenantId && booking.customerId !== context.subjectId && !isOperator(context)) throw new ErrorCalendario(403, 'FORBIDDEN', 'booking is not owned by the authenticated customer')
      if (input.expectedVersion !== undefined && input.expectedVersion !== booking.version) throw new ErrorCalendario(409, 'STALE_VERSION', 'booking version is stale')
      if (booking.status !== BOOKING_STATUS.CONFIRMED) return booking
      const calendar = await store.calendars.find(booking.calendarId)
      if (!calendar) throw new ErrorCalendario(409, 'STALE_BOOKING', 'booking calendar is unavailable')
      const late = Date.parse(input.now) > Date.parse(booking.startsAt) - calendar.cancellationWindowMinutes * 60_000
      const updated = { ...booking, status: late ? BOOKING_STATUS.CANCELLED_LATE : BOOKING_STATUS.CANCELLED, version: booking.version + 1, updatedAt: input.now }
      await store.bookings.save(updated)
      await this.record(store, context, late ? 'booking.cancelled_late' : 'booking.cancelled', booking.bookingId, input.now, 'booking.cancelled', booking.bookingId)
      return updated
    })
  }

  async markNoShow(context: TusAuthenticatedTenantContext, input: { bookingId: string; now: string }): Promise<Reserva> {
    assertOperator(context)
    return this.store.transaction(async (store) => {
      const booking = await store.bookings.find(input.bookingId)
      if (!booking || booking.ownerTenantId !== context.tenantId) throw new ErrorCalendario(403, 'FORBIDDEN', 'booking is outside the operator tenant')
      const calendar = await store.calendars.find(booking.calendarId)
      if (!calendar || Date.parse(input.now) < Date.parse(booking.endsAt) + calendar.noShowAfterMinutes * 60_000) throw new ErrorCalendario(409, 'NO_SHOW_TOO_EARLY', 'no-show evidence window has not opened')
      if (booking.status !== BOOKING_STATUS.CONFIRMED) return booking
      const updated = { ...booking, status: BOOKING_STATUS.NO_SHOW, version: booking.version + 1, updatedAt: input.now }
      await store.bookings.save(updated)
      await this.record(store, context, 'booking.no_show', booking.bookingId, input.now, 'booking.no_show', booking.bookingId)
      return updated
    })
  }

  private async record(store: ServiceCalendarStorePort, context: TusAuthenticatedTenantContext, action: string, resourceId: string, createdAt: string, eventType: string, bookingId?: string): Promise<void> {
    const audit = { auditId: randomUUID(), tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, action, resourceId, outcome: 'allowed' as const, createdAt }
    await store.audit.append(audit)
    await store.outbox.append({ eventId: `calendar-outbox-${audit.auditId}`, tenantId: context.tenantId, eventType, aggregateId: resourceId, payload: { auditId: audit.auditId, ...(bookingId === undefined ? {} : { bookingId }) }, createdAt })
  }
}

function assertRead(context: TusAuthenticatedTenantContext): void { if (!hasPermission(context, 'tus:marketplace:read') && !hasPermission(context, 'tus:calendar:read')) throw new ErrorCalendario(403, 'FORBIDDEN', 'calendar read is not authorized') }
function assertCustomer(context: TusAuthenticatedTenantContext): void { assertRead(context); if (!context.roles.includes('customer')) throw new ErrorCalendario(403, 'FORBIDDEN', 'customer role is required') }
function assertOperator(context: TusAuthenticatedTenantContext): void { if (!isOperator(context)) throw new ErrorCalendario(403, 'FORBIDDEN', 'merchant or operator role is required') }
function isOperator(context: TusAuthenticatedTenantContext): boolean { return context.roles.some((role) => ['merchant', 'operator', 'owner', 'admin'].includes(role)) && (hasPermission(context, 'tus:calendar:write') || hasPermission(context, 'tus:marketplace:write')) }
function hasPermission(context: TusAuthenticatedTenantContext, permission: string): boolean { return context.permissions.includes(permission) || context.permissions.includes('tus:*') }
function overlaps(start: string, end: string, otherStart: string, otherEnd: string): boolean { return Date.parse(start) < Date.parse(otherEnd) && Date.parse(end) > Date.parse(otherStart) }

function generateSlotsOrThrow(calendar: Calendario, date: string, now?: string): Franja[] {
  try { return generateServiceSlots(calendar, { date, ...(now === undefined ? {} : { now }) }) } catch (error) { throw new ErrorCalendario(400, 'INVALID_DATE', error instanceof Error ? error.message : 'slot date is invalid') }
}

export { BOOKING_STATUS }

export const ServiceCalendarError = ErrorCalendario
