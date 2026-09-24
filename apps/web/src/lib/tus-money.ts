// WEB-09D: exact rendering of minor units received from TUS (ARS has 2 decimals). No floats:
// the Web only formats the decimal string the server returned.
export function formatMoney(amountMinor: string, currency: string): string {
  if (!/^\d+$/u.test(amountMinor)) return `importe no disponible (${currency})`
  const minor = BigInt(amountMinor)
  const units = new Intl.NumberFormat('es-AR').format(minor / 100n)
  const cents = (minor % 100n).toString().padStart(2, '0')
  return `${currency === 'ARS' ? '$' : currency} ${units},${cents}`
}

const tusMoneyModule = { formatMoney }

export default tusMoneyModule
