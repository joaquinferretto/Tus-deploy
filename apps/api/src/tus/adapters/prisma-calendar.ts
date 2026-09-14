import type { TusPrismaClient } from './prisma.ts'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import type { CalendarAuditRecord, CalendarOutboxRecord, Reserva, ServiceCalendarStorePort } from '../calendar/bookings.ts'
import type { Calendario, EntradaCalendario } from '../calendar/rules.ts'

export class PrismaServiceCalendarStore implements ServiceCalendarStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) { this.client = client }

  readonly calendars = {
    save: async (calendar: Calendario) => {
      await this.client.tusCalendar.upsert({ where: { id: calendar.calendarId }, create: calendarRow(calendar), update: calendarRow(calendar) })
      await this.client.tusCalendarRule.deleteMany({ where: { tenantId: calendar.tenantId, calendarId: calendar.calendarId } })
      if (calendar.workingHours.length > 0) await this.client.tusCalendarRule.createMany({ data: calendar.workingHours.map((rule) => ({ id: `${calendar.calendarId}-${rule.weekday}-${rule.start}`, tenantId: calendar.tenantId, calendarId: calendar.calendarId, weekday: rule.weekday, startsAt: rule.start, endsAt: rule.end, capacity: calendar.capacity, createdAt: new Date(calendar.createdAt), updatedAt: new Date(calendar.updatedAt) })) })
      await this.client.tusCalendarException.deleteMany({ where: { tenantId: calendar.tenantId, calendarId: calendar.calendarId } })
      if (calendar.blackoutDates.length > 0) await this.client.tusCalendarException.createMany({ data: calendar.blackoutDates.map((date) => ({ id: `${calendar.calendarId}-${date}`, tenantId: calendar.tenantId, calendarId: calendar.calendarId, startsAt: new Date(`${date}T00:00:00.000Z`), endsAt: new Date(`${date}T23:59:59.999Z`), reason: 'configured blackout', status: 'active', createdAt: new Date(calendar.createdAt) })) })
    },
    find: async (calendarId: string) => {
      const row = await this.client.tusCalendar.findUnique({ where: { id: calendarId } })
      if (!row) return null
      const rules = await this.client.tusCalendarRule.findMany({ where: { calendarId, tenantId: String(row['tenantId']) } })
      const exceptions = await this.client.tusCalendarException.findMany({ where: { calendarId, tenantId: String(row['tenantId']), status: 'active' } })
      return toCalendar(row, rules, exceptions)
    },
  }

  readonly bookings = {
    save: async (booking: Reserva) => { await this.client.tusBooking.upsert({ where: { id: booking.bookingId }, create: bookingRow(booking), update: bookingRow(booking) }) },
    find: async (bookingId: string) => { const row = await this.client.tusBooking.findUnique({ where: { id: bookingId } }); return row ? toBooking(row) : null },
    forCalendar: async (calendarId: string) => (await this.client.tusBooking.findMany({ where: { calendarId } })).map(toBooking),
  }

  readonly idempotency = {
    claim: async ({ tenantId, key, requestHash }: { tenantId: string; key: string; requestHash: string }): Promise<{ status: 'claimed' | 'replay' | 'conflict' | 'in_progress'; response?: Reserva | { status: 'replay'; booking: Reserva } | { status: 'rejected'; reason: 'capacity' } }> => {
      const existing = await this.client.idempotencyRecord.findUnique({ where: { tenantId_key: { tenantId, key } } })
      if (!existing) {
        try { await this.client.idempotencyRecord.create({ data: { id: `calendar-idempotency-${tenantId}-${key}`, tenantId, key, requestHash, status: 'pending', response: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 15 * 60_000) } }); return { status: 'claimed' as const } } catch { return this.idempotency.claim({ tenantId, key, requestHash }) }
      }
      if (existing.requestHash !== requestHash) return { status: 'conflict' as const }
      if (existing.status === 'completed' && existing.response) return { status: 'replay' as const, response: decodeResult(existing.response) }
      return { status: 'in_progress' as const }
    },
    complete: async ({ tenantId, key, response }: { tenantId: string; key: string; response: Reserva | { status: 'replay'; booking: Reserva } | { status: 'rejected'; reason: 'capacity' } }) => { await this.client.idempotencyRecord.update({ where: { tenantId_key: { tenantId, key } }, data: { status: 'completed', response: encodeResult(response) } }) },
  }

  readonly audit = {
    append: async (record: CalendarAuditRecord) => { await this.client.tusMarketplaceAudit.createMany({ data: [{ id: record.auditId, tenantId: record.tenantId, actorId: record.actorId, correlationId: record.correlationId, action: record.action, resourceType: 'calendar', resourceId: record.resourceId, outcome: record.outcome, createdAt: new Date(record.createdAt) }] }) },
    list: (_tenantId: string) => [] as CalendarAuditRecord[],
  }

  readonly outbox = {
    append: async (record: CalendarOutboxRecord) => { await this.client.outboxEvent.create({ data: { id: record.eventId, tenantId: record.tenantId, aggregateType: 'calendar', aggregateId: record.aggregateId, eventType: record.eventType, payload: record.payload, status: 'pending', availableAt: new Date(record.createdAt), createdAt: new Date(record.createdAt) } }) },
    list: (_tenantId: string) => [] as CalendarOutboxRecord[],
  }

  transaction<T>(operation: (store: ServiceCalendarStorePort) => Promise<T>): Promise<T> { return this.client.$transaction(async (client) => operation(new PrismaServiceCalendarStore(client))) }
}

function calendarRow(calendar: Calendario): Record<string, unknown> { return { id: calendar.calendarId, tenantId: calendar.tenantId, serviceId: calendar.serviceId, name: calendar.serviceId, timezone: calendar.timezone, status: calendar.status, createdAt: new Date(calendar.createdAt), updatedAt: new Date(calendar.updatedAt) } }
function bookingRow(booking: Reserva): Record<string, unknown> { return { id: booking.bookingId, tenantId: booking.ownerTenantId, bookingId: booking.bookingId, serviceId: booking.serviceId, calendarId: booking.calendarId, customerId: booking.customerId, startsAt: new Date(booking.startsAt), endsAt: new Date(booking.endsAt), status: booking.status, version: booking.version, createdAt: new Date(booking.createdAt), updatedAt: new Date(booking.updatedAt) } }
function toCalendar(row: Record<string, unknown>, rules: Record<string, unknown>[], exceptions: Record<string, unknown>[]): Calendario {
  const tenantId = String(row['tenantId'])
  const ruleCapacity = Number(rules[0]?.['capacity'] ?? 1)
  const input: EntradaCalendario = { calendarId: String(row['id']), serviceId: String(row['serviceId']), timezone: String(row['timezone']), durationMinutes: 60, capacity: ruleCapacity, workingHours: rules.map((rule) => ({ weekday: Number(rule['weekday']), start: String(rule['startsAt']), end: String(rule['endsAt']) })), blackoutDates: exceptions.map((exception) => new Date(String(exception['startsAt'])).toISOString().slice(0, 10)) }
  return { ...input, tenantId, status: String(row['status']) as Calendario['status'], bufferMinutes: 0, bookingCutoffMinutes: 0, cancellationWindowMinutes: 0, noShowAfterMinutes: 0, workingHours: input.workingHours, blackoutDates: input.blackoutDates ?? [], policyVersion: 'calendar-policy-1', version: 1, createdAt: new Date(String(row['createdAt'])).toISOString(), updatedAt: new Date(String(row['updatedAt'])).toISOString() }
}
function toBooking(row: Record<string, unknown>): Reserva { return { contractVersion: TUS_CONTRACT_VERSION, bookingId: String(row['bookingId']), tenantId: String(row['tenantId']), ownerTenantId: String(row['tenantId']), serviceId: String(row['serviceId']), calendarId: String(row['calendarId']), customerId: String(row['customerId']), startsAt: new Date(String(row['startsAt'])).toISOString(), endsAt: new Date(String(row['endsAt'])).toISOString(), status: row['status'] as Reserva['status'], version: Number(row['version']), policyVersion: 'calendar-policy-1', createdAt: new Date(String(row['createdAt'])).toISOString(), updatedAt: new Date(String(row['updatedAt'])).toISOString() } }
function encodeResult(value: unknown): unknown { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? `${item}n` : item)) }
function decodeResult(value: unknown): Reserva | { status: 'replay'; booking: Reserva } | { status: 'rejected'; reason: 'capacity' } { return JSON.parse(JSON.stringify(value), (key, item) => key === 'minor' && typeof item === 'string' && /^\d+n$/u.test(item) ? BigInt(item.slice(0, -1)) : item) as Reserva | { status: 'replay'; booking: Reserva } | { status: 'rejected'; reason: 'capacity' } }

export default { PrismaServiceCalendarStore }
