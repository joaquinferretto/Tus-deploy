export interface Money {
  currency: string
  minor: bigint
}

export interface MoneyJson {
  currency: string
  minor: string
}

export const MONEY_ROUNDING = {
  REJECT: 'reject',
  HALF_UP: 'half-up',
} as const

export type MoneyRounding = (typeof MONEY_ROUNDING)[keyof typeof MONEY_ROUNDING]

export const MONEY_CURRENCY_SCALES = {
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
} as const

export type SupportedMoneyCurrency = keyof typeof MONEY_CURRENCY_SCALES

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
  const exponent = MONEY_CURRENCY_SCALES[normalized as SupportedMoneyCurrency]
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

export function serializeMoney(value: Money): MoneyJson {
  const money = createMoney(value.currency, value.minor)
  return { currency: money.currency, minor: money.minor.toString() }
}

export function deserializeMoney(value: unknown): Money {
  if (!isRecord(value) || typeof value['currency'] !== 'string' || typeof value['minor'] !== 'string') {
    throw new TypeError('money JSON must contain currency and string minor units')
  }
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value['minor'])) throw new TypeError('money JSON minor units must be an integer string')
  return createMoney(value['currency'], BigInt(value['minor']))
}

export function exactMoneyJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

export function exactMoneyJsonStringify(value: unknown): string {
  return JSON.stringify(value, exactMoneyJsonReplacer)
}

export function currencyScale(currency: string): number {
  return currencyMinorExponent(currency)
}

export function parseDecimalToMinor(
  currency: string,
  amount: string,
  options: { scale?: number; rounding?: MoneyRounding } = {},
): bigint {
  const currencyPolicyScale = currencyScale(currency)
  const scale = options.scale ?? currencyPolicyScale
  const rounding = options.rounding ?? MONEY_ROUNDING.REJECT
  createMoney(currency, 0n)
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) throw new Error('money scale must be between 0 and 6')
  if (scale !== currencyPolicyScale) throw new Error('money scale does not match the currency policy')
  if (rounding !== MONEY_ROUNDING.REJECT && rounding !== MONEY_ROUNDING.HALF_UP) throw new Error('money rounding policy is unsupported')
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(amount)) throw new Error('money decimal must be a plain base-10 value')

  const negative = amount.startsWith('-')
  const unsigned = negative ? amount.slice(1) : amount
  const [whole, fraction = ''] = unsigned.split('.')
  const kept = fraction.slice(0, scale).padEnd(scale, '0')
  const discarded = fraction.slice(scale)
  if (discarded && /[1-9]/u.test(discarded) && rounding === MONEY_ROUNDING.REJECT) {
    throw new Error('money decimal has more fractional precision than the currency policy')
  }

  let minor = BigInt(`${whole}${kept || ''}`)
  if (rounding === MONEY_ROUNDING.HALF_UP && discarded && Number(discarded[0]) >= 5) minor += 1n
  return negative ? -minor : minor
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
