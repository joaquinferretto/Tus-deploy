import { TUS_CONTRACT_VERSION, type MercadoPagoHandoff, type WhatsAppAction, type WhatsAppActionType } from '@factory/contracts'

const SUPPORTED_ACTIONS: ReadonlySet<WhatsAppActionType> = new Set([
  'search',
  'quote',
  'cart',
  'status',
  'handoff',
  'confirm',
])

export function isSupportedWhatsAppAction(action: Pick<WhatsAppAction, 'type'>): boolean {
  return SUPPORTED_ACTIONS.has(action.type)
}

export function createMercadoPagoHandoff(input: {
  tenantId: string
  checkoutUrl: string
}): MercadoPagoHandoff {
  let url: URL
  try {
    url = new URL(input.checkoutUrl)
  } catch {
    throw new Error('payment redirect must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:') throw new Error('payment redirect must be a valid HTTPS URL')
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    provider: 'mercado-pago',
    tenantId: input.tenantId,
    redirectUrl: url.toString(),
    credentialsCollected: false,
  }
}
