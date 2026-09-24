import { createHmac, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  WEBHOOK_SIGNATURE_FAILURE_REASONS,
  WEBHOOK_SIGNATURE_MODES,
  type CreateWebhookSignatureInput,
  type MoneyOutEvent,
  type MoneyOutTransaction,
  type Payment,
  type PaymentEvent,
  type VerifyWebhookSignatureInput,
  type WebhookNotification,
  type WebhookSignatureMode,
  type WebhookSignatureVerification,
} from './types'
import { normalizeMoneyOutStatus } from './normalizers'

export function buildMercadoPagoManifest(input: {
  timestamp: number
  requestId?: string
  dataId?: string
}): string {
  const parts: string[] = []

  if (input.dataId) {
    parts.push(`id:${input.dataId.toLowerCase()};`)
  }

  if (input.requestId) {
    parts.push(`request-id:${input.requestId};`)
  }

  parts.push(`ts:${input.timestamp};`)
  return parts.join('')
}

export function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): WebhookSignatureVerification {
  if (!(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0) {
    return { valid: false, reason: WEBHOOK_SIGNATURE_FAILURE_REASONS.INVALID_BODY }
  }

  if (!input.secret) {
    return { valid: false, reason: WEBHOOK_SIGNATURE_FAILURE_REASONS.MISSING_SECRET }
  }

  const parsed = parseSignatureHeader(input.signatureHeader)

  if (!parsed) {
    return { valid: false, reason: WEBHOOK_SIGNATURE_FAILURE_REASONS.MALFORMED_SIGNATURE }
  }

  const nowMs = input.nowMs ?? Date.now()
  const toleranceSeconds = input.toleranceSeconds ?? 300

  if (!Number.isFinite(nowMs) || !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    return { valid: false, reason: WEBHOOK_SIGNATURE_FAILURE_REASONS.EXPIRED_SIGNATURE }
  }

  // Mercado Pago sends `ts` in milliseconds (official docs: `ts=1742505638683`).
  const ageSeconds = Math.abs(nowMs - parsed.timestamp) / 1000

  if (ageSeconds > toleranceSeconds) {
    return {
      valid: false,
      timestamp: parsed.timestamp,
      reason: WEBHOOK_SIGNATURE_FAILURE_REASONS.EXPIRED_SIGNATURE,
    }
  }

  const mode = input.mode ?? WEBHOOK_SIGNATURE_MODES.MERCADO_PAGO_MANIFEST
  const message = createSignedMessage(mode, input.rawBody, {
    timestamp: parsed.timestamp,
    requestId: input.requestId,
    dataId: input.dataId,
  })
  const expected = createHmac('sha256', input.secret).update(message).digest('hex')
  const valid = constantTimeHexEqual(expected, parsed.signature)

  return {
    valid,
    timestamp: parsed.timestamp,
    ...(valid ? {} : { reason: WEBHOOK_SIGNATURE_FAILURE_REASONS.MISMATCHED_SIGNATURE }),
  }
}

export function createWebhookSignature(input: CreateWebhookSignatureInput): string {
  if (!(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0) {
    throw new Error('Webhook body must contain raw bytes')
  }

  if (!input.secret) {
    throw new Error('Webhook secret is required')
  }

  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
    throw new Error('Webhook timestamp must be a positive integer')
  }

  const mode = input.mode ?? WEBHOOK_SIGNATURE_MODES.MERCADO_PAGO_MANIFEST
  const message = createSignedMessage(mode, input.rawBody, input)
  const signature = createHmac('sha256', input.secret).update(message).digest('hex')
  return `ts=${input.timestamp},v1=${signature}`
}

export function parseWebhookNotification(rawBody: Uint8Array): WebhookNotification {
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength === 0) {
    throw new Error('Webhook body must contain raw bytes')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown
  } catch {
    throw new Error('Invalid webhook JSON')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid webhook notification')
  }

  const record = parsed as Record<string, unknown>
  const data = record['data']
  const dataRecord =
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined

  return {
    eventId: optionalString(record['id']),
    type: optionalString(record['type']),
    action: optionalString(record['action']),
    dataId: dataRecord ? optionalString(dataRecord['id']) : undefined,
    status: optionalString(record['status']),
  }
}

export function mapPaymentEvent(
  notification: WebhookNotification,
  payment: Payment,
): PaymentEvent | undefined {
  if (notification.type !== 'payment' || !notification.dataId || notification.dataId !== payment.id) {
    return undefined
  }

  return {
    eventId: notification.eventId,
    action: notification.action ?? 'payment.updated',
    resourceId: payment.id,
    externalReference: payment.externalReference,
    status: payment.status,
    statusDetail: payment.statusDetail,
  }
}

export function mapMoneyOutEvent(
  notification: WebhookNotification,
  transaction: MoneyOutTransaction,
): MoneyOutEvent | undefined {
  const isMoneyOutType = notification.type === 'transaction_intent'
  const isMoneyOutAction = notification.action?.startsWith('transaction_intent.') ?? false

  if ((!isMoneyOutType && !isMoneyOutAction) || !notification.dataId || notification.dataId !== transaction.id) {
    return undefined
  }

  return {
    eventId: notification.eventId,
    action: notification.action ?? 'transaction_intent.updated',
    resourceId: transaction.id,
    externalReference: transaction.externalReference,
    status: transaction.status ?? (notification.status ? normalizeMoneyOutStatus(notification.status) : undefined),
  }
}

function createSignedMessage(
  mode: WebhookSignatureMode,
  rawBody: Uint8Array,
  input: { timestamp: number; requestId?: string; dataId?: string },
): Buffer {
  if (mode === WEBHOOK_SIGNATURE_MODES.RAW_BODY) {
    return Buffer.concat([Buffer.from(`${input.timestamp}.`, 'utf8'), Buffer.from(rawBody)])
  }

  return Buffer.from(
    buildMercadoPagoManifest({
      timestamp: input.timestamp,
      requestId: input.requestId,
      dataId: input.dataId,
    }),
    'utf8',
  )
}

function parseSignatureHeader(
  header: string | undefined,
): { timestamp: number; signature: string } | undefined {
  if (!header) {
    return undefined
  }

  const values = new Map<string, string>()

  for (const part of header.split(',')) {
    const separator = part.indexOf('=')

    if (separator <= 0) {
      return undefined
    }

    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()

    if (!key || !value || values.has(key)) {
      return undefined
    }

    values.set(key, value)
  }

  const rawTimestamp = values.get('ts')
  const signature = values.get('v1')
  const timestamp = rawTimestamp ? Number(rawTimestamp) : Number.NaN

  if (
    !signature ||
    !/^[0-9a-f]{64}$/i.test(signature) ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0
  ) {
    return undefined
  }

  return { timestamp, signature }
}

function constantTimeHexEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'hex')
  const actualBytes = Buffer.from(actual, 'hex')
  const comparable = Buffer.alloc(expectedBytes.length)
  actualBytes.copy(comparable, 0, 0, expectedBytes.length)
  const equal = timingSafeEqual(expectedBytes, comparable)

  return actualBytes.length === expectedBytes.length && equal
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
