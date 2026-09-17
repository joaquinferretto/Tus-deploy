import { TUS_CONTRACT_VERSION } from '@factory/contracts/tus'
import {
  type TusCalendarBooking,
  type TusCalendarBookingResponse,
  type TusCalendarSlot,
} from './tus-client'
import { createStableIdempotencyKey } from './tus-client'

export type TusReservaIntent = {
  idempotencyKey: string
  requestHash: string
  now: string
}

export function construirIntencionReserva(
  listingId: string,
  slot: Pick<TusCalendarSlot, 'slotId' | 'start' | 'end'>,
  intentId: string,
  now: string,
  calendarId?: string
): TusReservaIntent {
  const normalizedListingId = listingId.trim()
  const normalizedIntentId = intentId.trim()
  if (normalizedListingId.length === 0) throw new Error('listing id is required')
  if (normalizedIntentId.length === 0) throw new Error('booking intent id is required')
  return {
    idempotencyKey: createStableIdempotencyKey('booking', normalizedIntentId),
    requestHash: `publication:${normalizedListingId}:${calendarId ?? 'primary'}:${slot.slotId}:${slot.start}:${slot.end}`,
    now,
  }
}

export function construirIntencionReservaLegacy(
  calendarId: string,
  serviceId: string,
  slot: Pick<TusCalendarSlot, 'slotId' | 'start' | 'end'>,
  intentId: string,
  now: string
): TusReservaIntent {
  const normalizedCalendarId = calendarId.trim()
  const normalizedServiceId = serviceId.trim()
  const normalizedIntentId = intentId.trim()
  if (normalizedCalendarId.length === 0) throw new Error('calendar id is required')
  if (normalizedServiceId.length === 0) throw new Error('service id is required')
  if (normalizedIntentId.length === 0) throw new Error('booking intent id is required')
  return {
    idempotencyKey: createStableIdempotencyKey('booking', normalizedIntentId),
    requestHash: `calendar:${normalizedCalendarId}:${normalizedServiceId}:${slot.slotId}:${slot.start}:${slot.end}`,
    now,
  }
}

export function parseTusCalendarBookingResponse(payload: unknown): TusCalendarBookingResponse | { status: 'error'; reason: string } {
  const record = asRecord(payload)
  if (record['contractVersion'] !== undefined && record['contractVersion'] !== TUS_CONTRACT_VERSION) {
    return { status: 'error', reason: 'invalid_contract_version' }
  }
  if (record['status'] === 'replay' && isRecord(record['booking'])) {
    return { status: 'replay', booking: record['booking'] as unknown as TusCalendarBooking }
  }
  if (record['status'] === 'rejected' && record['reason'] === 'capacity') {
    return { status: 'rejected', reason: 'capacity' }
  }
  if (
    typeof record['bookingId'] === 'string' &&
    typeof record['calendarId'] === 'string' &&
    (typeof record['listingId'] === 'string' || typeof record['serviceId'] === 'string') &&
    typeof record['startsAt'] === 'string' &&
    typeof record['endsAt'] === 'string'
  ) {
    return record as unknown as TusCalendarBookingResponse
  }
  return { status: 'error', reason: 'invalid_server_response' }
}

export function mensajeErrorCalendario(code: string | undefined): string {
  if (code === 'BUDGET_REQUIRED') return 'Este servicio requiere un presupuesto antes de reservar un horario.'
  if (code === 'NOT_CONFIGURED') return 'Este servicio todavía no tiene una agenda activa configurada.'
  if (code === 'STALE_SLOT') return 'La franja dejó de estar disponible. Actualizá la disponibilidad.'
  if (code === 'BOOKING_CUTOFF') return 'El horario ya no puede reservarse porque pasó el límite de reserva.'
  if (code === 'SLOT_UNAVAILABLE') return 'La franja ya no tiene capacidad. Actualizá la disponibilidad.'
  if (code === 'CALENDAR_MISMATCH') return 'La agenda ya no coincide con la publicación. Actualizá la disponibilidad.'
  if (code === 'INCONSISTENT_CONFIGURATION') return 'La configuración del servicio no permite reservar este horario.'
  if (code === 'CONFLICT' || code === 'IN_PROGRESS') return 'La reserva tiene una solicitud en conflicto. Conservamos la intención original.'
  if (code === 'NOT_FOUND') return 'El calendario o servicio ya no está disponible para reservar.'
  return 'No pudimos confirmar la reserva. Revisá la disponibilidad e intentá nuevamente.'
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const tusCalendarModule = {
  construirIntencionReserva,
  construirIntencionReservaLegacy,
  mensajeErrorCalendario,
  parseTusCalendarBookingResponse,
}

export default tusCalendarModule
