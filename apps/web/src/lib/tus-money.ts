// WEB-09D: exact rendering of minor units received from TUS (ARS has 2 decimals). No floats:
// the Web only formats the decimal string the server returned.
export function formatMoney(amountMinor: string, currency: string): string {
  if (!/^\d+$/u.test(amountMinor)) return `importe no disponible (${currency})`
  const minor = BigInt(amountMinor)
  const units = new Intl.NumberFormat('es-AR').format(minor / 100n)
  const cents = (minor % 100n).toString().padStart(2, '0')
  return `${currency === 'ARS' ? '$' : currency} ${units},${cents}`
}

// WEB-09E: the browser only navigates to Mercado Pago's own HTTPS domains.
export function esUrlCheckoutMercadoPago(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /(^|\.)mercadopago\.com(\.[a-z]{2})?$/u.test(url.hostname)
  } catch {
    return false
  }
}

const tusMoneyModule = { formatMoney, esUrlCheckoutMercadoPago }

export default tusMoneyModule
