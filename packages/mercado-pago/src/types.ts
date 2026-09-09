export const MERCADO_PAGO_DEFAULT_API_BASE_URL = 'https://api.mercadopago.com' as const

export const PAYMENT_STATUSES = {
  APPROVED: 'approved',
  PENDING: 'pending',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  CHARGED_BACK: 'charged_back',
  UNKNOWN: 'unknown',
} as const

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES]
export type RefundStatus = PaymentStatus

export const MONEY_OUT_STATUSES = {
  CREATED: 'created',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  ACTION_REQUIRED: 'action_required',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  CHARGED_BACK: 'charged_back',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
  PENDING: 'pending',
  UNKNOWN: 'unknown',
} as const

export type MoneyOutStatus = (typeof MONEY_OUT_STATUSES)[keyof typeof MONEY_OUT_STATUSES]

export const AUTO_RETURN_VALUES = {
  APPROVED: 'approved',
  ALL: 'all',
} as const

export type AutoReturn = (typeof AUTO_RETURN_VALUES)[keyof typeof AUTO_RETURN_VALUES]

export const WEBHOOK_SIGNATURE_MODES = {
  MERCADO_PAGO_MANIFEST: 'mercado-pago-manifest',
  RAW_BODY: 'raw-body',
} as const

export type WebhookSignatureMode =
  (typeof WEBHOOK_SIGNATURE_MODES)[keyof typeof WEBHOOK_SIGNATURE_MODES]

export interface MercadoPagoHttpResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface MercadoPagoRequestInit {
  method: string
  headers: Record<string, string>
  body?: string
}

export type MercadoPagoFetch = (
  url: string,
  init: MercadoPagoRequestInit,
) => Promise<MercadoPagoHttpResponse>

export interface MercadoPagoClientOptions {
  accessToken: string
  apiBaseUrl?: string
  fetch?: MercadoPagoFetch
}

export interface PreferenceItem {
  id?: string
  title: string
  description?: string
  quantity: number
  currencyId: string
  unitPrice: number
}

export interface PreferencePayer {
  email?: string
  name?: string
  surname?: string
}

export interface PreferenceBackUrls {
  success?: string
  failure?: string
  pending?: string
}

export type PreferenceMetadataValue = string | number | boolean
export type PreferenceMetadata = Record<string, PreferenceMetadataValue>

export interface CreatePreferenceInput {
  externalReference: string
  items: readonly PreferenceItem[]
  payer?: PreferencePayer
  backUrls?: PreferenceBackUrls
  autoReturn?: AutoReturn
  notificationUrl?: string
  metadata?: PreferenceMetadata
  statementDescriptor?: string
  idempotencyKey?: string
}

export interface Preference {
  id: string
  initPoint?: string
  sandboxInitPoint?: string
  externalReference?: string
  dateCreated?: string
}

export interface Payment {
  id: string
  status: PaymentStatus
  providerStatus?: string
  statusDetail?: string
  amount?: number
  currencyId?: string
  externalReference?: string
  dateCreated?: string
  dateApproved?: string
}

export interface CreateRefundInput {
  amount?: number
  idempotencyKey?: string
}

export interface Refund {
  id: string
  paymentId: string
  status: RefundStatus
  providerStatus?: string
  amount?: number
  currencyId?: string
  dateCreated?: string
}

export interface PaymentEvent {
  eventId?: string
  action: string
  resourceId: string
  externalReference?: string
  status: PaymentStatus
  statusDetail?: string
}

export interface HolderIdentification {
  type: string
  number: string
}

export interface DestinationAccountKey {
  type: string
  value: string
}

export interface DestinationAccount {
  accountType: string
  bankId?: string
  branch?: string
  number?: string
  holder?: string
  providerId?: string
  currencyId?: string
  description?: string
  key?: DestinationAccountKey
  holderIdentification?: HolderIdentification
}

export interface CreateMoneyOutInput {
  externalReference: string
  amount: number
  destinationAccount: DestinationAccount
  notificationUrl?: string
  idempotencyKey: string
  providerSignature?: string
  enforceSignature?: boolean
}

export interface MoneyOutTransaction {
  id: string
  externalReference?: string
  status: MoneyOutStatus
  providerStatus?: string
  statusDetail?: string
  amount?: number
  dateCreated?: string
  dateUpdated?: string
}

export interface MoneyOutEvent {
  eventId?: string
  action: string
  resourceId: string
  externalReference?: string
  status?: MoneyOutStatus
}

export interface WebhookNotification {
  eventId?: string
  type?: string
  action?: string
  dataId?: string
  status?: string
}

export const WEBHOOK_SIGNATURE_FAILURE_REASONS = {
  INVALID_BODY: 'invalid-body',
  MISSING_SECRET: 'missing-secret',
  MISSING_SIGNATURE: 'missing-signature',
  MALFORMED_SIGNATURE: 'malformed-signature',
  EXPIRED_SIGNATURE: 'expired-signature',
  MISMATCHED_SIGNATURE: 'mismatched-signature',
} as const

export type WebhookSignatureFailureReason =
  (typeof WEBHOOK_SIGNATURE_FAILURE_REASONS)[keyof typeof WEBHOOK_SIGNATURE_FAILURE_REASONS]

export interface VerifyWebhookSignatureInput {
  rawBody: Uint8Array
  signatureHeader?: string
  secret: string
  requestId?: string
  dataId?: string
  mode?: WebhookSignatureMode
  nowMs?: number
  toleranceSeconds?: number
}

export interface WebhookSignatureVerification {
  valid: boolean
  timestamp?: number
  reason?: WebhookSignatureFailureReason
}

export interface CreateWebhookSignatureInput {
  rawBody: Uint8Array
  secret: string
  timestamp: number
  requestId?: string
  dataId?: string
  mode?: WebhookSignatureMode
}
