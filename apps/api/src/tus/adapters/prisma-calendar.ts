import type { TusPrismaClient } from './prisma.ts'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import type { CalendarAuditRecord, CalendarOutboxRecord, Reserva, ServiceCalendarStorePort } from '../calendar/bookings.ts'
import type { Calendario, EntradaCalendario } from '../calendar/rules.ts'

export class PrismaServiceCalendarStore implements ServiceCalendarStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) { this.client = client }

  readonly calendars = {
    save: async (calendar: Calendario) => {
      await this.client.calendario.upsert({ where: { id: calendar.calendarId }, create: calendarRow(calendar), update: calendarRow(calendar) })
      await this.client.reglaCalendario.deleteMany({ where: { tenantId: calendar.tenantId, calendarioId: calendar.calendarId } })
      if (calendar.workingHours.length > 0) await this.client.reglaCalendario.createMany({ data: calendar.workingHours.map((rule) => ({ id: `${calendar.calendarId}-${rule.weekday}-${rule.start}`, tenantId: calendar.tenantId, calendarioId: calendar.calendarId, diaSemana: rule.weekday, horaInicio: rule.start, horaFin: rule.end, capacidad: calendar.capacity, fechaCreacion: new Date(calendar.createdAt), fechaActualizacion: new Date(calendar.updatedAt) })) })
      await this.client.excepcionCalendario.deleteMany({ where: { tenantId: calendar.tenantId, calendarioId: calendar.calendarId } })
      if (calendar.blackoutDates.length > 0) await this.client.excepcionCalendario.createMany({ data: calendar.blackoutDates.map((date) => ({ id: `${calendar.calendarId}-${date}`, tenantId: calendar.tenantId, calendarioId: calendar.calendarId, fechaInicio: new Date(`${date}T00:00:00.000Z`), fechaFin: new Date(`${date}T23:59:59.999Z`), motivo: 'configured blackout', estado: 'active', fechaCreacion: new Date(calendar.createdAt) })) })
    },
    find: async (calendarId: string) => {
      const row = await this.client.calendario.findUnique({ where: { id: calendarId } })
      if (!row) return null
      const rules = await this.client.reglaCalendario.findMany({ where: { calendarioId: calendarId, tenantId: String(row['tenantId']) } })
      const exceptions = await this.client.excepcionCalendario.findMany({ where: { calendarioId: calendarId, tenantId: String(row['tenantId']), estado: 'active' } })
      return toCalendar(row, rules, exceptions)
    },
  }

  readonly bookings = {
    save: async (booking: Reserva) => { await this.client.reserva.upsert({ where: { id: booking.bookingId }, create: bookingRow(booking), update: bookingRow(booking) }) },
    find: async (bookingId: string) => { const row = await this.client.reserva.findUnique({ where: { id: bookingId } }); return row ? toBooking(row) : null },
    forCalendar: async (calendarId: string) => (await this.client.reserva.findMany({ where: { calendarioId: calendarId } })).map(toBooking),
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
    append: async (record: CalendarAuditRecord) => { await this.client.auditoriaMercadoServicios.createMany({ data: [{ id: record.auditId, tenantId: record.tenantId, actorId: record.actorId, correlacionId: record.correlationId, accion: record.action, tipoRecurso: 'calendar', recursoId: record.resourceId, resultado: record.outcome, fechaCreacion: new Date(record.createdAt) }] }) },
    list: (_tenantId: string) => [] as CalendarAuditRecord[],
  }

  readonly outbox = {
    append: async (record: CalendarOutboxRecord) => { await this.client.outboxEvent.create({ data: { id: record.eventId, tenantId: record.tenantId, aggregateType: 'calendar', aggregateId: record.aggregateId, eventType: record.eventType, payload: record.payload, status: 'pending', availableAt: new Date(record.createdAt), createdAt: new Date(record.createdAt) } }) },
    list: (_tenantId: string) => [] as CalendarOutboxRecord[],
  }

  transaction<T>(operation: (store: ServiceCalendarStorePort) => Promise<T>): Promise<T> { return this.client.$transaction(async (client) => operation(new PrismaServiceCalendarStore(client))) }
}

function calendarRow(calendar: Calendario): Record<string, unknown> { return { id: calendar.calendarId, tenantId: calendar.tenantId, servicioId: calendar.serviceId, nombre: calendar.serviceId, zonaHoraria: calendar.timezone, estado: calendar.status, fechaCreacion: new Date(calendar.createdAt), fechaActualizacion: new Date(calendar.updatedAt) } }
function bookingRow(booking: Reserva): Record<string, unknown> { return { id: booking.bookingId, tenantId: booking.ownerTenantId, reservaId: booking.bookingId, servicioId: booking.serviceId, calendarioId: booking.calendarId, clienteId: booking.customerId, fechaInicio: new Date(booking.startsAt), fechaFin: new Date(booking.endsAt), estado: booking.status, version: booking.version, fechaCreacion: new Date(booking.createdAt), fechaActualizacion: new Date(booking.updatedAt) } }
function toCalendar(row: Record<string, unknown>, rules: Record<string, unknown>[], exceptions: Record<string, unknown>[]): Calendario {
  const tenantId = String(row['tenantId'])
  const ruleCapacity = Number(rules[0]?.['capacidad'] ?? 1)
  const input: EntradaCalendario = { calendarId: String(row['id']), serviceId: String(row['servicioId']), timezone: String(row['zonaHoraria']), durationMinutes: 60, capacity: ruleCapacity, workingHours: rules.map((rule) => ({ weekday: Number(rule['diaSemana']), start: String(rule['horaInicio']), end: String(rule['horaFin']) })), blackoutDates: exceptions.map((exception) => new Date(String(exception['fechaInicio'])).toISOString().slice(0, 10)) }
  return { ...input, tenantId, status: String(row['estado']) as Calendario['status'], bufferMinutes: 0, bookingCutoffMinutes: 0, cancellationWindowMinutes: 0, noShowAfterMinutes: 0, workingHours: input.workingHours, blackoutDates: input.blackoutDates ?? [], policyVersion: 'calendar-policy-1', version: 1, createdAt: new Date(String(row['fechaCreacion'])).toISOString(), updatedAt: new Date(String(row['fechaActualizacion'])).toISOString() }
}
function toBooking(row: Record<string, unknown>): Reserva { return { contractVersion: TUS_CONTRACT_VERSION, bookingId: String(row['reservaId']), tenantId: String(row['tenantId']), ownerTenantId: String(row['tenantId']), serviceId: String(row['servicioId']), calendarId: String(row['calendarioId']), customerId: String(row['clienteId']), startsAt: new Date(String(row['fechaInicio'])).toISOString(), endsAt: new Date(String(row['fechaFin'])).toISOString(), status: row['estado'] as Reserva['status'], version: Number(row['version']), policyVersion: 'calendar-policy-1', createdAt: new Date(String(row['fechaCreacion'])).toISOString(), updatedAt: new Date(String(row['fechaActualizacion'])).toISOString() } }
function encodeResult(value: unknown): unknown { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? `${item}n` : item)) }
function decodeResult(value: unknown): Reserva | { status: 'replay'; booking: Reserva } | { status: 'rejected'; reason: 'capacity' } { return JSON.parse(JSON.stringify(value), (key, item) => key === 'minor' && typeof item === 'string' && /^\d+n$/u.test(item) ? BigInt(item.slice(0, -1)) : item) as Reserva | { status: 'replay'; booking: Reserva } | { status: 'rejected'; reason: 'capacity' } }

export default { PrismaServiceCalendarStore }
