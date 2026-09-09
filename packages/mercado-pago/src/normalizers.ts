import {
  MONEY_OUT_STATUSES,
  PAYMENT_STATUSES,
  type MoneyOutStatus,
  type Payment,
  type PaymentStatus,
  type Preference,
  type Refund,
} from './types'

type JsonRecord = Record<string, unknown>

export function normalizePaymentStatus(status: unknown): PaymentStatus {
  if (typeof status !== 'string') {
    return PAYMENT_STATUSES.UNKNOWN
  }

  switch (status.toLowerCase()) {
    case 'approved':
    case 'authorized':
      return PAYMENT_STATUSES.APPROVED
    case 'pending':
    case 'in_process':
    case 'in_mediation':
      return PAYMENT_STATUSES.PENDING
    case 'rejected':
    case 'failed':
      return PAYMENT_STATUSES.FAILED
    case 'cancelled':
    case 'canceled':
      return PAYMENT_STATUSES.CANCELLED
    case 'refunded':
      return PAYMENT_STATUSES.REFUNDED
    case 'charged_back':
      return PAYMENT_STATUSES.CHARGED_BACK
    default:
      return PAYMENT_STATUSES.UNKNOWN
  }
}

export function normalizeMoneyOutStatus(status: unknown): MoneyOutStatus {
  if (typeof status !== 'string') {
    return MONEY_OUT_STATUSES.UNKNOWN
  }

  switch (status.toLowerCase()) {
    case 'created':
    case 'new':
      return MONEY_OUT_STATUSES.CREATED
    case 'processing':
      return MONEY_OUT_STATUSES.PROCESSING
    case 'processed':
    case 'approved':
      return MONEY_OUT_STATUSES.PROCESSED
    case 'action_required':
    case 'in_review':
      return MONEY_OUT_STATUSES.ACTION_REQUIRED
    case 'failed':
      return MONEY_OUT_STATUSES.FAILED
    case 'cancelled':
    case 'canceled':
      return MONEY_OUT_STATUSES.CANCELLED
    case 'charged_back':
      return MONEY_OUT_STATUSES.CHARGED_BACK
    case 'expired':
      return MONEY_OUT_STATUSES.EXPIRED
    case 'refunded':
      return MONEY_OUT_STATUSES.REFUNDED
    case 'pending':
    case 'partially_processed':
    case 'in_process':
      return MONEY_OUT_STATUSES.PENDING
    default:
      return MONEY_OUT_STATUSES.UNKNOWN
  }
}

export function normalizePreference(input: unknown, fallbackExternalReference?: string): Preference {
  const record = requireRecord(input, 'preference')
  const id = requireString(record, 'id', 'preference')

  return {
    id,
    initPoint: optionalString(record, 'init_point'),
    sandboxInitPoint: optionalString(record, 'sandbox_init_point'),
    externalReference: optionalString(record, 'external_reference') ?? fallbackExternalReference,
    dateCreated: optionalString(record, 'date_created'),
  }
}

export function normalizePayment(input: unknown): Payment {
  const record = requireRecord(input, 'payment')
  const providerStatus = optionalString(record, 'status')

  return {
    id: requireString(record, 'id', 'payment'),
    status: normalizePaymentStatus(providerStatus),
    providerStatus,
    statusDetail: optionalString(record, 'status_detail'),
    amount: optionalNumber(record, 'transaction_amount'),
    currencyId: optionalString(record, 'currency_id'),
    externalReference: optionalString(record, 'external_reference'),
    dateCreated: optionalString(record, 'date_created'),
    dateApproved: optionalString(record, 'date_approved'),
  }
}

export function normalizeRefund(input: unknown, fallbackPaymentId?: string): Refund {
  const record = requireRecord(input, 'refund')
  const paymentId = optionalString(record, 'payment_id') ?? fallbackPaymentId

  if (!paymentId) {
    throw new Error('Invalid refund response: missing payment id')
  }

  const providerStatus = optionalString(record, 'status')

  return {
    id: requireString(record, 'id', 'refund'),
    paymentId,
    status: normalizePaymentStatus(providerStatus),
    providerStatus,
    amount: optionalNumber(record, 'amount'),
    currencyId: optionalString(record, 'currency_id'),
    dateCreated: optionalString(record, 'date_created'),
  }
}

export function normalizeMoneyOutTransaction(input: unknown): import('./types').MoneyOutTransaction {
  const record = requireRecord(input, 'Money Out transaction')
  const transaction = optionalRecord(record, 'transaction')
  const providerStatus = optionalString(record, 'status')

  return {
    id: requireString(record, 'id', 'Money Out transaction'),
    externalReference: optionalString(record, 'external_reference'),
    status: normalizeMoneyOutStatus(providerStatus),
    providerStatus,
    statusDetail: optionalString(record, 'status_detail'),
    amount:
      optionalNumber(record, 'amount') ??
      optionalNumber(record, 'total_amount') ??
      (transaction ? optionalNumber(transaction, 'total_amount') : undefined),
    dateCreated: optionalString(record, 'created_date'),
    dateUpdated: optionalString(record, 'last_updated_date'),
  }
}

function isRecord(input: unknown): input is JsonRecord {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function requireRecord(input: unknown, resourceName: string): JsonRecord {
  if (!isRecord(input)) {
    throw new Error(`Invalid ${resourceName} response`)
  }

  return input
}

function requireString(record: JsonRecord, key: string, resourceName: string): string {
  const value = optionalString(record, key)

  if (!value) {
    throw new Error(`Invalid ${resourceName} response: missing ${key}`)
  }

  return value
}

function optionalString(record: JsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function optionalRecord(record: JsonRecord, key: string): JsonRecord | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}
