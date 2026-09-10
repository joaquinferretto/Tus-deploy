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
  USD: 2,
  EUR: 2,
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
  const normalized = currency.trim().toUpperCase()
  if (!(normalized in MONEY_CURRENCY_SCALES)) throw new Error('money currency scale is unknown')
  return MONEY_CURRENCY_SCALES[normalized as SupportedMoneyCurrency]
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
