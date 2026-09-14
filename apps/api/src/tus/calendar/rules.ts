const CALENDAR_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const

export type CalendarStatus = (typeof CALENDAR_STATUS)[keyof typeof CALENDAR_STATUS]

export interface HorarioTrabajoCalendario {
  weekday: number
  start: string
  end: string
}

export interface MoneySnapshot {
  currency: string
  minor: bigint
}

export interface Calendario {
  calendarId: string
  tenantId: string
  serviceId: string
  timezone: string
  status: CalendarStatus
  durationMinutes: number
  bufferMinutes: number
  capacity: number
  bookingCutoffMinutes: number
  cancellationWindowMinutes: number
  noShowAfterMinutes: number
  workingHours: HorarioTrabajoCalendario[]
  blackoutDates: string[]
  priceSnapshot?: MoneySnapshot
  policyVersion: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface EntradaCalendario {
  tenantId?: string
  calendarId: string
  serviceId: string
  timezone: string
  durationMinutes: number
  bufferMinutes?: number
  capacity: number
  bookingCutoffMinutes?: number
  cancellationWindowMinutes?: number
  noShowAfterMinutes?: number
  workingHours: HorarioTrabajoCalendario[]
  blackoutDates?: string[]
  priceSnapshot?: MoneySnapshot
  policyVersion?: string
}

export function validateCalendarInput(input: EntradaCalendario): void {
  if (!input.calendarId.trim() || !input.serviceId.trim()) throw new Error('calendarId and serviceId are required')
  if (!isValidTimezone(input.timezone)) throw new Error('timezone must be a valid IANA timezone')
  for (const [name, value] of [
    ['durationMinutes', input.durationMinutes],
    ['capacity', input.capacity],
    ['bufferMinutes', input.bufferMinutes ?? 0],
    ['bookingCutoffMinutes', input.bookingCutoffMinutes ?? 0],
    ['cancellationWindowMinutes', input.cancellationWindowMinutes ?? 0],
    ['noShowAfterMinutes', input.noShowAfterMinutes ?? 0],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || (name === 'durationMinutes' || name === 'capacity') && value < 1) {
      throw new Error(`${name} must be a valid positive integer`)
    }
  }
  if (input.workingHours.length === 0) throw new Error('working hours are required')
  for (const rule of input.workingHours) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6 || !isClock(rule.start) || !isClock(rule.end) || toMinutes(rule.end) <= toMinutes(rule.start)) {
      throw new Error('working hours contain an invalid interval')
    }
  }
  for (const date of input.blackoutDates ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))) throw new Error('blackout dates must be ISO calendar dates')
  }
  if (input.priceSnapshot !== undefined) {
    if (!/^[A-Z]{3}$/u.test(input.priceSnapshot.currency) || typeof input.priceSnapshot.minor !== 'bigint' || input.priceSnapshot.minor < 0n) throw new Error('price snapshot is invalid')
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format()
    return timezone.includes('/')
  } catch {
    return false
  }
}

export function isClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/u.test(value)
}

export function toMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function dateWeekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay()
}

export { CALENDAR_STATUS }
