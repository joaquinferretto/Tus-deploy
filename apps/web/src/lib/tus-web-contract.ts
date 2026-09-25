export const TUS_PAYMENT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REFUNDED: 'refunded',
} as const

export type TusPaymentStatus = (typeof TUS_PAYMENT_STATUS)[keyof typeof TUS_PAYMENT_STATUS]

export interface TusPaymentPresentation {
  status: TusPaymentStatus
  label: string
  message: string
  settlementClaim: 'not-claimed'
  retryable: boolean
  evidence: string
}

export function resolveTusPaymentPresentation(status: TusPaymentStatus): TusPaymentPresentation {
  const presentations: Record<TusPaymentStatus, TusPaymentPresentation> = {
    pending: {
      status,
      label: 'Payment pending',
      message: 'The payment provider has not confirmed the outcome yet.',
      settlementClaim: 'not-claimed',
      retryable: true,
      evidence: 'A pending provider state is shown without claiming capture or settlement.',
    },
    approved: {
      status,
      label: 'Payment approved',
      message: 'The payment provider approved the payment.',
      settlementClaim: 'not-claimed',
      retryable: false,
      evidence: 'Provider approval is shown; settlement remains unclaimed until TUS confirms it.',
    },
    rejected: {
      status,
      label: 'Payment rejected',
      message: 'The payment provider rejected the payment. Review the details and try again.',
      settlementClaim: 'not-claimed',
      retryable: true,
      evidence: 'The rejected state is authoritative for this attempt; no payment was claimed.',
    },
    refunded: {
      status,
      label: 'Payment refunded',
      message: 'The payment provider reports a refund for this payment.',
      settlementClaim: 'not-claimed',
      retryable: false,
      evidence: 'Provider refund is shown; final settlement accounting is not claimed by this surface.',
    },
  }
  return presentations[status]
}

export interface TusRedactedUiError {
  message: string
  code?: string
}

export function redactTusUiError(error: unknown): TusRedactedUiError {
  const record = asRecord(error)
  const code = typeof record['code'] === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(record['code'])
    ? record['code']
    : undefined
  return {
    message: 'The request could not be completed. Try again or contact support.',
    ...(code === undefined ? {} : { code }),
  }
}

export interface TusOfflineRecord<TPayload = unknown> {
  kind: string
  operationId: string
  idempotencyKey: string
  status: 'queued-offline'
  payload: TPayload
}

export function createTusOfflineRecord<TPayload>(input: {
  kind: string
  operationId: string
  idempotencyKey: string
  payload: TPayload
}): TusOfflineRecord<TPayload> {
  return {
    kind: input.kind,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    status: 'queued-offline',
    payload: input.payload,
  }
}

export const TUS_PWA_CAPABILITY = {
  INSTALL: 'install',
  UPDATE: 'update',
  OFFLINE: 'offline',
} as const

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export default {
  TUS_PAYMENT_STATUS,
  TUS_PWA_CAPABILITY,
  createTusOfflineRecord,
  redactTusUiError,
  resolveTusPaymentPresentation,
}
