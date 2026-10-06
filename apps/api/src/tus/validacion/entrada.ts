// Reading of untrusted input (a JSON body, a query string). Every function takes `unknown` and
// returns the normalized value or INVALIDO: nothing is coerced silently ("abc" is not a number,
// "false" is not a boolean, an object is not a text). The route decides the answer (422/400);
// these functions never throw, so bad input can never become a 500.

export const INVALIDO = Symbol('entrada-invalida')
export type Leido<T> = T | typeof INVALIDO

export const esInvalido = (value: unknown): value is typeof INVALIDO => value === INVALIDO

// The largest price or amount TUS accepts, in the whole pesos the agenda and the lodging store.
export const MONTO_MAXIMO_PESOS = 100_000_000n
// Currencies TUS charges in.
export const MONEDAS = ['ARS'] as const

// Control characters (other than the line break and tab of a multi-line text) and the characters
// that reorder or hide text (zero-width space, direction marks and overrides, BOM). Legitimate
// Unicode - accents, emoji and the joiners inside them - is untouched. Written with code points:
// no invisible character lives in this file.
const OCULTOS: readonly (readonly [number, number])[] = [[0x7f, 0x9f], [0x200b, 0x200b], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff]]
function tieneNoImprimible(value: string, lineas: boolean): boolean {
  for (const caracter of value) {
    const codigo = caracter.codePointAt(0)!
    if (codigo < 0x20 && !(lineas && (codigo === 0x0a || codigo === 0x09))) return true
    if (OCULTOS.some(([desde, hasta]) => codigo >= desde && codigo <= hasta)) return true
  }
  return false
}

// A text of one line: trimmed, inner whitespace collapsed, composed (NFC). With `lineas`, line
// breaks are kept (at most two in a row). Lengths are counted in characters, not UTF-16 units.
export function texto(value: unknown, limites: { min?: number; max: number; lineas?: boolean }): Leido<string> {
  if (typeof value !== 'string') return INVALIDO
  const compuesto = value.normalize('NFC')
  const limpio = limites.lineas
    ? compuesto.replace(/\r\n?/gu, '\n').replace(/[^\S\n]+/gu, ' ').replace(/ ?\n ?/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
    : compuesto.replace(/\s+/gu, ' ').trim()
  if (tieneNoImprimible(limpio, limites.lineas === true)) return INVALIDO
  const largo = [...limpio].length
  if (largo < (limites.min ?? 0) || largo > limites.max) return INVALIDO
  return limpio
}

// Absent, null or blank: null. Present: the same rules as `texto`.
export function textoOpcional(value: unknown, limites: { min?: number; max: number; lineas?: boolean }): Leido<string | null> {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && !value.trim()) return null
  return texto(value, limites)
}

// An integer: a JSON number without decimals or a string of digits. Never NaN, never Infinity.
export function entero(value: unknown, limites: { min: number; max: number }): Leido<number> {
  const numero = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d{1,15}$/u.test(value.trim()) ? Number(value.trim()) : Number.NaN
  if (!Number.isSafeInteger(numero) || numero < limites.min || numero > limites.max) return INVALIDO
  return numero
}

// An amount of money in whole units: an integer, never negative, never a decimal, never above
// the limit. As a bigint, the type the database stores.
export function monto(value: unknown, limites: { min?: bigint; max?: bigint } = {}): Leido<bigint> {
  let cantidad: bigint
  if (typeof value === 'bigint') cantidad = value
  else if (typeof value === 'number' && Number.isSafeInteger(value)) cantidad = BigInt(value)
  else if (typeof value === 'string' && /^\d{1,18}$/u.test(value.trim())) cantidad = BigInt(value.trim())
  else return INVALIDO
  if (cantidad < (limites.min ?? 0n) || cantidad > (limites.max ?? MONTO_MAXIMO_PESOS)) return INVALIDO
  return cantidad
}

// Only the JSON booleans: "false", 0 or "no" are not a decision.
export function booleano(value: unknown): Leido<boolean> {
  return typeof value === 'boolean' ? value : INVALIDO
}

// An instant: an ISO 8601 date-time WITH its offset ("2026-10-05T14:00:00.000Z"), so the same
// text is the same moment on every server.
export function instante(value: unknown): Leido<Date> {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.trim())) return INVALIDO
  const fecha = new Date(value.trim())
  return Number.isNaN(fecha.getTime()) ? INVALIDO : fecha
}

export function enumerado<T extends string>(value: unknown, lista: readonly T[]): Leido<T> {
  return typeof value === 'string' && (lista as readonly string[]).includes(value) ? (value as T) : INVALIDO
}

// An identifier of TUS as it travels in a body or a route.
export function identificador(value: unknown): Leido<string> {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/u.test(value) ? value : INVALIDO
}

// An http(s) address of an image or a page: never javascript:, data: or a relative path.
export function urlHttps(value: unknown, max = 2048): Leido<string> {
  if (typeof value !== 'string') return INVALIDO
  const limpio = value.trim()
  if (!limpio || limpio.length > max || tieneNoImprimible(limpio, false) || /\s/u.test(limpio)) return INVALIDO
  try {
    const url = new URL(limpio)
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password ? url.toString() : INVALIDO
  } catch {
    return INVALIDO
  }
}

// "HH:MM", 00:00 to 23:59.
export function hora(value: unknown): Leido<string> {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.trim()) ? value.trim() : INVALIDO
}

// The fields of a body that are not in the list (a closed schema names them in its answer).
export function camposDesconocidos(body: Record<string, unknown>, permitidos: readonly string[]): string[] {
  return Object.keys(body).filter((key) => !permitidos.includes(key))
}
