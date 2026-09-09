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
