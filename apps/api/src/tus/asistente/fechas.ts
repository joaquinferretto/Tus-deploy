import { sinAcentos } from '../texto.ts'

// The clock and the calendar of the assistant. Every date the assistant uses is resolved HERE, by
// the backend, with the official time of TUS in Argentina: "today", the weekday of a date, what
// "mañana" or "el jueves" mean. A model never computes any of it: it passes the words the person
// said and gets the date back (tools get_current_datetime and resolve_date_expression).

// Official timezone of TUS. Argentina has no daylight saving: UTC-3 all year.
export const ZONA_HORARIA_TUS = 'America/Argentina/Buenos_Aires'

// The one clock: production passes the real one, tests a fixed one.
export type Reloj = () => number
export const relojSistema: Reloj = () => Date.now()

const HORA_MS = 3_600_000
export const DIA_MS = 24 * HORA_MS
export const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export const hoyArgentina = (ahora: number): string => new Date(ahora - 3 * HORA_MS).toISOString().slice(0, 10)
export const horaArgentina = (ahora: number): string => new Date(ahora - 3 * HORA_MS).toISOString().slice(11, 16)
export const sumarDias = (fecha: string, dias: number): string => new Date(Date.parse(`${fecha}T12:00:00.000Z`) + dias * DIA_MS).toISOString().slice(0, 10)
export const diaSemana = (fecha: string): number => new Date(`${fecha}T12:00:00.000Z`).getUTCDay()
// Monday of the week a day belongs to (weeks run Monday to Sunday).
export const lunesDe = (fecha: string): string => sumarDias(fecha, -((diaSemana(fecha) + 6) % 7))
export const nombreDiaSemana = (fecha: string): string => NOMBRES_DIA[diaSemana(fecha)]!

// Lowercase, no accents, punctuation as spaces; the colon of a time ("18:30") is kept, and
// "9.30", "9,30" and "9h30" are the same time.
export function normalizarTexto(texto: string): string {
  return sinAcentos(texto.toLowerCase().slice(0, 600))
    .replace(/(\d)[.,h](\d{2})\b/gu, '$1:$2')
    .replace(/[^a-z0-9ñ:/\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    // How it is written on a phone: "lunes q viene", "x la tarde".
    .replace(/\bq\b/gu, 'que')
    .replace(/\bx\b/gu, 'por')
}

// What get_current_datetime answers: the server's clock, in TUS's timezone.
export function fechaHoraActual(ahora: number) {
  const fecha = hoyArgentina(ahora)
  return { timestamp: new Date(ahora).toISOString(), timezone: ZONA_HORARIA_TUS, localDate: fecha, localTime: horaArgentina(ahora), weekday: nombreDiaSemana(fecha) }
}

// A date read from a (normalised) text.
//   exact: one day (`day`), or the two days of a weekend (`day` and `dayTo`).
//   range: from `day` to `dayTo`, every day in between ("la semana que viene").
//   ambiguous: two reasonable days (`options`); nothing is chosen, the person is asked.
export interface FechaLeida {
  tipo: 'exact' | 'range' | 'ambiguous'
  day: string | null
  dayTo: string | null
  options: string[]
  // The rule that was applied, for the tool output and the docs.
  regla: string
  resto: string
}

// The deterministic rules, in order (the first that matches wins):
//   1. "pasado mañana" = today + 2; "mañana" = today + 1 ("a la mañana" is a part of the day, not
//      tomorrow); "hoy", "esta tarde/noche/mañana" = today.
//   2. "fin de semana" / "finde" = the next Saturday and Sunday (on a Sunday, that Sunday).
//   3. "la semana que viene" / "la próxima semana" = Monday to Sunday of next week;
//      "esta semana" = from today to this Sunday.
//   4. "12 de octubre", "12/10", "12/10/2026" = that date; without year, a date already passed is
//      next year's. An explicit date wins over the name of its day.
//   5. "día 12" (and "el 12" where a day of the month is expected) = the next 12th, today included.
//   6. A weekday ("el jueves", "este viernes") = its next occurrence, today included.
//      "el viernes que viene" / "el próximo viernes": said ON a Friday it is the Friday after;
//      when the coming Friday is already next week it is that one; when the coming Friday is
//      still in THIS week it may mean either that one or the next: ambiguous, the person is asked.
export function leerFecha(texto: string, hoy: string, opciones: { diaSuelto?: boolean } = {}): FechaLeida | null {
  const quitar = (m: RegExpExecArray) => `${texto.slice(0, m.index)} ${texto.slice(m.index + m[0].length)}`
  const exacta = (day: string, regla: string, resto: string, dayTo: string | null = null): FechaLeida => ({ tipo: 'exact', day, dayTo, options: [], regla, resto })
  let m: RegExpExecArray | null
  if ((m = /\bpasado manana\b/u.exec(texto))) return exacta(sumarDias(hoy, 2), 'pasado_manana', quitar(m))
  // "por la mañana" is a part of the day; a "mañana" left after that is tomorrow.
  const sinFranja = texto.replace(/\b(?:a|por|de|en|durante) la manana\b/gu, (encontrado) => ' '.repeat(encontrado.length))
  if ((m = /\bmanana\b/u.exec(sinFranja))) return exacta(sumarDias(hoy, 1), 'manana', `${texto.slice(0, m.index)} ${texto.slice(m.index + m[0].length)}`)
  if ((m = /\b(?:hoy|esta (?:tarde|noche|manana|siesta))\b/u.exec(texto))) return exacta(hoy, 'hoy', m[0] === 'hoy' ? quitar(m) : texto)
  if ((m = /\b(?:este |el |proximo )?(?:fin de semana|finde)\b/u.exec(texto))) {
    const dia = diaSemana(hoy)
    const sabado = dia === 0 ? hoy : sumarDias(hoy, (6 - dia + 7) % 7)
    return exacta(sabado, 'fin_de_semana', quitar(m), dia === 0 ? null : sumarDias(sabado, 1))
  }
  if ((m = /\b(?:la )?(?:semana que viene|proxima semana|semana proxima|semana siguiente)\b/u.exec(texto))) {
    const lunes = sumarDias(lunesDe(hoy), 7)
    return { tipo: 'range', day: lunes, dayTo: sumarDias(lunes, 6), options: [], regla: 'semana_que_viene', resto: quitar(m) }
  }
  if ((m = /\b(?:en |durante )?esta semana\b/u.exec(texto))) return { tipo: 'range', day: hoy, dayTo: sumarDias(lunesDe(hoy), 6), options: [], regla: 'esta_semana', resto: quitar(m) }
  if ((m = new RegExp(String.raw`\b(?:el |dia )?(\d{1,2}) de (${MESES.join('|')})\b`, 'u').exec(texto)) || (m = /\b(?:el |dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/u.exec(texto))) {
    const dia = Number(m[1])
    const mes = /^\d/u.test(m[2]!) ? Number(m[2]) : MESES.indexOf(m[2]!) + 1
    let anio = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(hoy.slice(0, 4))
    const armar = () => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    const valida = () => !Number.isNaN(Date.parse(`${armar()}T12:00:00.000Z`)) && new Date(`${armar()}T12:00:00.000Z`).getUTCDate() === dia
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || !valida()) return null
    // A date without year that already passed is next year's.
    if (!m[3] && armar() < hoy) anio += 1
    return valida() ? exacta(armar(), 'fecha_explicita', quitar(m)) : null
  }
  if ((m = /\b(?:el )?dia (\d{1,2})\b/u.exec(texto)) || (opciones.diaSuelto && (m = /\b(?:el )(\d{1,2})\b(?! ?(?:de\b|\/|:|hs\b|horas\b|y\b))/u.exec(texto)))) {
    const dia = Number(m[1])
    if (dia < 1 || dia > 31) return null
    // The next day of a month with that number, today included (a month without it is skipped).
    let [anio, mes] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))]
    for (let salto = 0; salto < 13; salto += 1) {
      const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
      if (fecha >= hoy && new Date(`${fecha}T12:00:00.000Z`).getUTCDate() === dia && !Number.isNaN(Date.parse(`${fecha}T12:00:00.000Z`))) return exacta(fecha, 'dia_del_mes', quitar(m))
      mes += 1
      if (mes > 12) [anio, mes] = [anio + 1, 1]
    }
    return null
  }
  if ((m = new RegExp(String.raw`\b(?:(este|el|proximo|para el|del) )?(${DIAS.join('|')})( que viene| proximo| siguiente)?\b`, 'u').exec(texto))) {
    const saltos = (DIAS.indexOf(m[2]!) - diaSemana(hoy) + 7) % 7
    const proximo = sumarDias(hoy, saltos)
    if (!(m[1] === 'proximo' || m[3])) return exacta(proximo, 'dia_de_semana', quitar(m))
    if (saltos === 0) return exacta(sumarDias(hoy, 7), 'dia_de_semana_que_viene', quitar(m))
    if (proximo > sumarDias(lunesDe(hoy), 6)) return exacta(proximo, 'dia_de_semana_que_viene', quitar(m))
    return { tipo: 'ambiguous', day: null, dayTo: null, options: [proximo, sumarDias(proximo, 7)], regla: 'dia_de_semana_que_viene_ambiguo', resto: quitar(m) }
  }
  return null
}

// What resolve_date_expression answers: the words of the person, resolved with the server's clock.
// exact: exactDate. range: fromDate..toDate. ambiguous: options (ask the person which one).
// unresolved: no date was understood (ask the person, never guess).
export function resolverExpresionFecha(expresion: string, ahora: number) {
  const hoy = hoyArgentina(ahora)
  const leida = leerFecha(normalizarTexto(expresion), hoy, { diaSuelto: true })
  const dia = (fecha: string) => ({ date: fecha, weekday: nombreDiaSemana(fecha) })
  const base = { timezone: ZONA_HORARIA_TUS, today: hoy }
  if (!leida) return { ...base, resolutionType: 'unresolved' as const, exactDate: null, fromDate: null, toDate: null, weekday: null, options: [], rule: null }
  if (leida.tipo === 'ambiguous') return { ...base, resolutionType: 'ambiguous' as const, exactDate: null, fromDate: null, toDate: null, weekday: null, options: leida.options.map(dia), rule: leida.regla }
  if (leida.tipo === 'range' || leida.dayTo) return { ...base, resolutionType: 'range' as const, exactDate: null, fromDate: leida.day, toDate: leida.dayTo, weekday: null, options: [], rule: leida.regla }
  return { ...base, resolutionType: 'exact' as const, exactDate: leida.day, fromDate: leida.day, toDate: leida.day, weekday: nombreDiaSemana(leida.day!), options: [], rule: leida.regla }
}
