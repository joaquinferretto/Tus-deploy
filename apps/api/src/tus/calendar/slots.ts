import { dateWeekday, type Calendario, toMinutes } from './rules.ts'

export interface Franja {
  slotId: string
  calendarId: string
  serviceId: string
  timezone: string
  start: string
  end: string
  capacity: number
}

export interface SlotQuery {
  date: string
  now?: string
}

export function generateServiceSlots(calendar: Calendario, query: SlotQuery): Franja[] {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(query.date) || !Number.isFinite(Date.parse(`${query.date}T00:00:00.000Z`))) throw new Error('slot date must be an ISO calendar date')
  if (calendar.status !== 'active' || calendar.blackoutDates.includes(query.date)) return []
  const weekday = dateWeekday(query.date)
  const rules = calendar.workingHours.filter((rule) => rule.weekday === weekday)
  const slots: Franja[] = []
  for (const rule of rules) {
    const firstMinute = toMinutes(rule.start)
    const lastMinute = toMinutes(rule.end)
    const step = calendar.durationMinutes + calendar.bufferMinutes
    for (let minute = firstMinute; minute + calendar.durationMinutes <= lastMinute; minute += step) {
      const start = wallClockToInstant(query.date, minute, calendar.timezone)
      const end = new Date(start.getTime() + calendar.durationMinutes * 60_000)
      slots.push({
        slotId: `${calendar.calendarId}:${start.toISOString()}`,
        calendarId: calendar.calendarId,
        serviceId: calendar.serviceId,
        timezone: calendar.timezone,
        start: start.toISOString(),
        end: end.toISOString(),
        capacity: calendar.capacity,
      })
    }
  }
  return slots.sort((left, right) => Date.parse(left.start) - Date.parse(right.start))
}

function wallClockToInstant(date: string, minutes: number, timezone: string): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const desired = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60)
  let instant = desired
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
    const observed = Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']), Number(parts['hour']), Number(parts['minute']))
    instant += desired - observed
  }
  return new Date(instant)
}
