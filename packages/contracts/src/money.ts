export interface Money {
  currency: string
  minor: bigint
}

export function createMoney(currency: string, minor: bigint): Money {
  const normalizedCurrency = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(normalizedCurrency)) throw new Error('currency must be an ISO 4217 code')
  if (typeof minor !== 'bigint') throw new TypeError('money minor units must be bigint')
  return { currency: normalizedCurrency, minor }
}

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new Error('money currency must match')
  return createMoney(left.currency, left.minor + right.minor)
}

// Canonical TUS money boundary (WEB-09A):
// - domain and persistence use non-negative bigint minor units plus an explicit ISO 4217 currency;
// - JSON/HTTP carries minor units as base-10 strings (`"150000"`), never as floats;
// - major units exist only at external provider boundaries and are rendered as decimal strings.
export const MINOR_UNITS_PATTERN = /^(0|[1-9]\d*)$/u
export const BASIS_POINTS_DENOMINATOR = 10_000

// Only currencies with a verified exponent are accepted at provider boundaries.
const CURRENCY_MINOR_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  ARS: 2,
  BRL: 2,
  CLP: 0,
  COP: 2,
  EUR: 2,
  MXN: 2,
  PEN: 2,
  PYG: 0,
  USD: 2,
  UYU: 2,
})

export function normalizeCurrency(currency: string): string {
  const normalized = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/u.test(normalized)) throw new Error('currency must be an ISO 4217 code')
  return normalized
}

export function createNonNegativeMoney(currency: string, minor: bigint): Money {
  if (typeof minor !== 'bigint' || minor < 0n)
    throw new TypeError('money minor units must be a non-negative bigint')
  return { currency: normalizeCurrency(currency), minor }
}

export function isMinorUnitsString(value: unknown): value is string {
  return typeof value === 'string' && MINOR_UNITS_PATTERN.test(value)
}

export function parseMinorUnits(value: unknown): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new TypeError('minor units must be non-negative')
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError('minor units must be a non-negative safe integer')
    return BigInt(value)
  }
  if (isMinorUnitsString(value)) return BigInt(value)
  throw new TypeError('minor units must be a non-negative integer string')
}

export function formatMinorUnits(value: bigint): string {
  if (typeof value !== 'bigint' || value < 0n)
    throw new TypeError('minor units must be a non-negative bigint')
  return value.toString(10)
}

export function subtractMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new Error('money currency must match')
  if (right.minor > left.minor) throw new RangeError('money subtraction would be negative')
  return createNonNegativeMoney(left.currency, left.minor - right.minor)
}

export function assertBasisPoints(rateBps: number): number {
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > BASIS_POINTS_DENOMINATOR)
    throw new RangeError('rateBps must be an integer between 0 and 10000')
  return rateBps
}

// Half-up rounding on exact integers; the same input always yields the same commission.
export function calculateBasisPointsAmount(baseMinor: bigint, rateBps: number): bigint {
  if (typeof baseMinor !== 'bigint' || baseMinor < 0n)
    throw new TypeError('base minor units must be a non-negative bigint')
  const rate = BigInt(assertBasisPoints(rateBps))
  const denominator = BigInt(BASIS_POINTS_DENOMINATOR)
  return (baseMinor * rate + denominator / 2n) / denominator
}

export function currencyMinorExponent(currency: string): number {
  const normalized = normalizeCurrency(currency)
  const exponent = CURRENCY_MINOR_EXPONENTS[normalized]
  if (exponent === undefined)
    throw new Error(`currency ${normalized} has no verified minor-unit exponent`)
  return exponent
}

// Provider boundary only: renders minor units as a major-unit decimal string without floats.
export function minorUnitsToMajorDecimal(minor: bigint, currency: string): string {
  const exponent = currencyMinorExponent(currency)
  const digits = formatMinorUnits(minor)
  if (exponent === 0) return digits
  const padded = digits.padStart(exponent + 1, '0')
  return `${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`
}

// Provider boundary only: parses a major-unit decimal string, rejecting precision loss.
export function majorDecimalToMinorUnits(value: string, currency: string): bigint {
  const exponent = currencyMinorExponent(currency)
  const match = typeof value === 'string' ? /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value.trim()) : null
  if (!match) throw new TypeError('major amount must be a non-negative decimal string')
  const fraction = match[2] ?? ''
  if (fraction.length > exponent && /[1-9]/u.test(fraction.slice(exponent)))
    throw new RangeError('major amount exceeds the currency precision')
  return BigInt(`${match[1]}${fraction.slice(0, exponent).padEnd(exponent, '0')}`)
}
