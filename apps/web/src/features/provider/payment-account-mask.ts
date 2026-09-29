// Only a hint of the Mercado Pago user id; tokens never reach the browser.
export function maskAccountId(value: string | null): string | null {
  if (!value) return null
  return value.length <= 4 ? '••••' : `•••• ${value.slice(-4)}`
}
