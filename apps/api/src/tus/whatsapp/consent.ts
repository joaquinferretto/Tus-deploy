export const WHATSAPP_RECIPIENT_TYPES = {
  TENANT: 'tenant',
  MERCHANT: 'merchant',
  CUSTOMER: 'customer',
} as const

export type TipoDestinatarioWhatsApp =
  (typeof WHATSAPP_RECIPIENT_TYPES)[keyof typeof WHATSAPP_RECIPIENT_TYPES]

export const WHATSAPP_CONSENT_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const

export type EstadoConsentimientoWhatsApp =
  (typeof WHATSAPP_CONSENT_STATUS)[keyof typeof WHATSAPP_CONSENT_STATUS]

export const WHATSAPP_CONSENT_ORIGINS = {
  WEB_LINKING: 'web_linking',
  WHATSAPP_INBOUND: 'whatsapp_inbound',
  OPERATOR_CONSOLE: 'operator_console',
  OPT_OUT: 'opt_out',
} as const

export type OrigenConsentimientoWhatsApp =
  (typeof WHATSAPP_CONSENT_ORIGINS)[keyof typeof WHATSAPP_CONSENT_ORIGINS]

export interface ConsentimientoWhatsApp {
  consentId: string
  tenantId: string
  recipientType: TipoDestinatarioWhatsApp
  recipientId: string
  status: EstadoConsentimientoWhatsApp
  // Existing rows may contain historical source values; new writes are normalized below.
  source: string
  grantedAt: string
  revokedAt: string | null
  updatedAt: string
  retentionUntil: string
}

export function normalizarOrigenConsentimiento(source: string): OrigenConsentimientoWhatsApp | null {
  const normalized = source.trim()
  return Object.values(WHATSAPP_CONSENT_ORIGINS).includes(
    normalized as OrigenConsentimientoWhatsApp,
  )
    ? (normalized as OrigenConsentimientoWhatsApp)
    : null
}

export function crearConsentimientoWhatsApp(input: {
  tenantId: string
  recipientType: TipoDestinatarioWhatsApp
  recipientId: string
  source: OrigenConsentimientoWhatsApp
  now: number
  retentionMs?: number
}): ConsentimientoWhatsApp {
  const nowIso = new Date(input.now).toISOString()
  return {
    consentId: `whatsapp-consent-${input.tenantId}-${input.recipientType}-${input.recipientId}`,
    tenantId: input.tenantId,
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    status: WHATSAPP_CONSENT_STATUS.ACTIVE,
    source: input.source,
    grantedAt: nowIso,
    revokedAt: null,
    updatedAt: nowIso,
    retentionUntil: new Date(input.now + (input.retentionMs ?? 365 * 24 * 60 * 60 * 1000)).toISOString(),
  }
}
