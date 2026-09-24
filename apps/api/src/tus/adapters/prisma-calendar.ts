import type { TusPrismaClient } from './prisma.ts'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import type {
  CalendarAuditRecord,
  CalendarOutboxRecord,
  Reserva,
  ServiceCalendarStorePort,
} from '../calendar/bookings.ts'
import type { Calendario, EntradaCalendario } from '../calendar/rules.ts'

export class PrismaServiceCalendarStore implements ServiceCalendarStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  readonly calendars = {
    save: async (calendar: Calendario) => {
      await this.client.calendario.upsert({
        where: { id: calendar.calendarId },
        create: calendarRow(calendar),
        update: calendarRow(calendar),
      })
      await this.client.reglaCalendario.deleteMany({
        where: { tenantId: calendar.tenantId, calendarioId: calendar.calendarId },
      })
      if (calendar.workingHours.length > 0)
        await this.client.reglaCalendario.createMany({
          data: calendar.workingHours.map((rule) => ({
            id: `${calendar.calendarId}-${rule.weekday}-${rule.start}`,
            tenantId: calendar.tenantId,
            calendarioId: calendar.calendarId,
            diaSemana: rule.weekday,
            horaInicio: rule.start,
            horaFin: rule.end,
            capacidad: calendar.capacity,
            fechaCreacion: new Date(calendar.createdAt),
            fechaActualizacion: new Date(calendar.updatedAt),
          })),
        })
      await this.client.excepcionCalendario.deleteMany({
        where: { tenantId: calendar.tenantId, calendarioId: calendar.calendarId },
      })
      if (calendar.blackoutDates.length > 0)
        await this.client.excepcionCalendario.createMany({
          data: calendar.blackoutDates.map((date) => ({
            id: `${calendar.calendarId}-${date}`,
            tenantId: calendar.tenantId,
            calendarioId: calendar.calendarId,
            fechaInicio: new Date(`${date}T00:00:00.000Z`),
            fechaFin: new Date(`${date}T23:59:59.999Z`),
            motivo: 'configured blackout',
            estado: 'active',
            fechaCreacion: new Date(calendar.createdAt),
          })),
        })
    },
    find: async (calendarId: string) => {
      const row = await this.client.calendario.findUnique({ where: { id: calendarId } })
      if (!row) return null
      const rules = await this.client.reglaCalendario.findMany({
        where: { calendarioId: calendarId, tenantId: String(row['tenantId']) },
      })
      const exceptions = await this.client.excepcionCalendario.findMany({
        where: { calendarioId: calendarId, tenantId: String(row['tenantId']), estado: 'active' },
      })
      return toCalendar(row, rules, exceptions)
    },
    findPrimary: async (tenantId: string, prestadorId: string) => {
      const row = await this.client.calendario.findUnique({
        where: { tenantId_prestadorId: { tenantId, prestadorId } },
      })
      if (!row) return null
      const rules = await this.client.reglaCalendario.findMany({
        where: { calendarioId: String(row['id']), tenantId },
      })
      const exceptions = await this.client.excepcionCalendario.findMany({
        where: { calendarioId: String(row['id']), tenantId, estado: 'active' },
      })
      return toCalendar(row, rules, exceptions)
    },
  }

  readonly bookings = {
    save: async (booking: Reserva) => {
      await this.client.reserva.upsert({
        where: { id: booking.bookingId },
        create: bookingRow(booking),
        update: bookingRow(booking),
      })
    },
    find: async (bookingId: string) => {
      const row = await this.client.reserva.findUnique({ where: { id: bookingId } })
      return row ? toBooking(row) : null
    },
    forCalendar: async (calendarId: string) =>
      (await this.client.reserva.findMany({ where: { calendarioId: calendarId } })).map(toBooking),
    // WEB-08I: UPDATE sin cambio efectivo para tomar el lock de fila, igual que la vinculacion
    // WEB-08H. En Serializable, si la fila cambio desde el snapshot la transaccion falla (P2034)
    // y el reintento relee el vinculo ya confirmado.
    lockForChange: async (input: { ownerTenantId: string; bookingId: string }) => {
      await this.client.reserva.updateMany({
        where: { tenantId: input.ownerTenantId, reservaId: input.bookingId },
        data: { version: { increment: 0 } },
      })
    },
    linkedWorkId: async (input: { ownerTenantId: string; bookingId: string }) => {
      const row = await this.client.trabajo.findFirst({
        where: { reservaTenantId: input.ownerTenantId, reservaId: input.bookingId },
      })
      return row ? String(row['trabajoId']) : null
    },
  }

  readonly idempotency = {
    claim: async ({
      tenantId,
      key,
      requestHash,
    }: {
      tenantId: string
      key: string
      requestHash: string
    }): Promise<{
      status: 'claimed' | 'replay' | 'conflict' | 'in_progress'
      response?:
        | Reserva
        | { status: 'replay'; booking: Reserva }
        | { status: 'rejected'; reason: 'capacity' }
    }> => {
      const existing = await this.client.idempotencyRecord.findUnique({
        where: { tenantId_key: { tenantId, key } },
      })
      if (!existing) {
        try {
          await this.client.idempotencyRecord.create({
            data: {
              id: `calendar-idempotency-${tenantId}-${key}`,
              tenantId,
              key,
              requestHash,
              status: 'pending',
              response: null,
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 15 * 60_000),
            },
          })
          return { status: 'claimed' as const }
        } catch (error) {
          const raced = await this.client.idempotencyRecord.findUnique({
            where: { tenantId_key: { tenantId, key } },
          })
          if (!raced) throw error
          return claimExistingCalendarIdempotency(raced, requestHash)
        }
      }
      return claimExistingCalendarIdempotency(existing, requestHash)
    },
    complete: async ({
      tenantId,
      key,
      response,
    }: {
      tenantId: string
      key: string
      response:
        | Reserva
        | { status: 'replay'; booking: Reserva }
        | { status: 'rejected'; reason: 'capacity' }
    }) => {
      await this.client.idempotencyRecord.update({
        where: { tenantId_key: { tenantId, key } },
        data: { status: 'completed', response: encodeResult(response) },
      })
    },
  }

  readonly audit = {
    append: async (record: CalendarAuditRecord) => {
      await this.client.auditoriaMercadoServicios.createMany({
        data: [
          {
            id: record.auditId,
            tenantId: record.tenantId,
            actorId: record.actorId,
            correlacionId: record.correlationId,
            accion: record.action,
            tipoRecurso: 'calendar',
            recursoId: record.resourceId,
            resultado: record.outcome,
            fechaCreacion: new Date(record.createdAt),
          },
        ],
      })
    },
    list: (_tenantId: string) => [] as CalendarAuditRecord[],
  }

  readonly outbox = {
    append: async (record: CalendarOutboxRecord) => {
      await this.client.outboxEvent.create({
        data: {
          id: record.eventId,
          tenantId: record.tenantId,
          aggregateType: 'calendar',
          aggregateId: record.aggregateId,
          eventType: record.eventType,
          payload: record.payload,
          status: 'pending',
          availableAt: new Date(record.createdAt),
          createdAt: new Date(record.createdAt),
        },
      })
    },
    list: (_tenantId: string) => [] as CalendarOutboxRecord[],
  }

  async transaction<T>(operation: (store: ServiceCalendarStorePort) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.client.$transaction(
          async (client) => operation(new PrismaServiceCalendarStore(client)),
          { isolationLevel: 'Serializable' }
        )
      } catch (error) {
        if (!isSerializationFailure(error) || attempt === 2) throw error
      }
    }
    throw new Error('calendar transaction retry limit exceeded')
  }
}

function claimExistingCalendarIdempotency(
  existing: { requestHash: string; status: string; response: unknown },
  requestHash: string
) {
  if (existing.requestHash !== requestHash) return { status: 'conflict' as const }
  if (existing.status === 'completed' && existing.response)
    return { status: 'replay' as const, response: decodeResult(existing.response) }
  return { status: 'in_progress' as const }
}

function isSerializationFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'
}

function calendarRow(calendar: Calendario): Record<string, unknown> {
  return {
    id: calendar.calendarId,
    tenantId: calendar.tenantId,
    prestadorId: calendar.prestadorId ?? null,
    servicioId: calendar.serviceId ?? null,
    nombre: calendar.prestadorId ?? calendar.serviceId ?? calendar.calendarId,
    zonaHoraria: calendar.timezone,
    estado: calendar.status,
    granularidadMinutos: calendar.granularityMinutes,
    bufferMinutos: calendar.bufferMinutes,
    fechaCreacion: new Date(calendar.createdAt),
    fechaActualizacion: new Date(calendar.updatedAt),
  }
}
function bookingRow(booking: Reserva): Record<string, unknown> {
  return {
    id: booking.bookingId,
    tenantId: booking.ownerTenantId,
    clienteTenantId: booking.tenantId,
    reservaId: booking.bookingId,
    servicioId: booking.serviceId ?? null,
    calendarioId: booking.calendarId,
    publicacionId: booking.listingId ?? null,
    clienteId: booking.customerId,
    fechaInicio: new Date(booking.startsAt),
    fechaFin: new Date(booking.endsAt),
    estado: booking.status,
    version: booking.version,
    fechaCreacion: new Date(booking.createdAt),
    fechaActualizacion: new Date(booking.updatedAt),
  }
}
function toCalendar(
  row: Record<string, unknown>,
  rules: Record<string, unknown>[],
  exceptions: Record<string, unknown>[]
): Calendario {
  const tenantId = String(row['tenantId'])
  const ruleCapacity = Number(rules[0]?.['capacidad'] ?? 1)
  const input: EntradaCalendario = {
    calendarId: String(row['id']),
    ...(row['prestadorId'] === null || row['prestadorId'] === undefined
      ? {}
      : { prestadorId: String(row['prestadorId']) }),
    ...(row['servicioId'] === null || row['servicioId'] === undefined
      ? {}
      : { serviceId: String(row['servicioId']) }),
    timezone: String(row['zonaHoraria']),
    durationMinutes: 60,
    granularityMinutes: Number(row['granularidadMinutos'] ?? 15),
    bufferMinutes: Number(row['bufferMinutos'] ?? 0),
    capacity: ruleCapacity,
    workingHours: rules.map((rule) => ({
      weekday: Number(rule['diaSemana']),
      start: String(rule['horaInicio']),
      end: String(rule['horaFin']),
    })),
    blackoutDates: exceptions.map((exception) =>
      new Date(String(exception['fechaInicio'])).toISOString().slice(0, 10)
    ),
  }
  return {
    ...input,
    tenantId,
    status: String(row['estado']) as Calendario['status'],
    durationMinutes: input.durationMinutes ?? 60,
    granularityMinutes: input.granularityMinutes ?? 15,
    bufferMinutes: input.bufferMinutes ?? 0,
    bookingCutoffMinutes: 0,
    cancellationWindowMinutes: 0,
    noShowAfterMinutes: 0,
    workingHours: input.workingHours,
    blackoutDates: input.blackoutDates ?? [],
    policyVersion: 'calendar-policy-1',
    version: 1,
    createdAt: new Date(String(row['fechaCreacion'])).toISOString(),
    updatedAt: new Date(String(row['fechaActualizacion'])).toISOString(),
  }
}
function toBooking(row: Record<string, unknown>): Reserva {
  const ownerTenantId = String(row['tenantId'])
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    bookingId: String(row['reservaId']),
    tenantId:
      row['clienteTenantId'] === null || row['clienteTenantId'] === undefined
        ? ownerTenantId
        : String(row['clienteTenantId']),
    ownerTenantId,
    ...(row['servicioId'] === null || row['servicioId'] === undefined
      ? {}
      : { serviceId: String(row['servicioId']) }),
    calendarId: String(row['calendarioId']),
    ...(row['publicacionId'] === null || row['publicacionId'] === undefined
      ? {}
      : { listingId: String(row['publicacionId']) }),
    customerId: String(row['clienteId']),
    startsAt: new Date(String(row['fechaInicio'])).toISOString(),
    endsAt: new Date(String(row['fechaFin'])).toISOString(),
    status: row['estado'] as Reserva['status'],
    version: Number(row['version']),
    policyVersion: 'calendar-policy-1',
    createdAt: new Date(String(row['fechaCreacion'])).toISOString(),
    updatedAt: new Date(String(row['fechaActualizacion'])).toISOString(),
  }
}
function encodeResult(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item))
  )
}
function decodeResult(
  value: unknown
): Reserva | { status: 'replay'; booking: Reserva } | { status: 'rejected'; reason: 'capacity' } {
  return JSON.parse(JSON.stringify(value), (key, item) =>
    key === 'minor' && typeof item === 'string' && /^\d+n$/u.test(item)
      ? BigInt(item.slice(0, -1))
      : item
  ) as Reserva | { status: 'replay'; booking: Reserva } | { status: 'rejected'; reason: 'capacity' }
}

export default { PrismaServiceCalendarStore }
