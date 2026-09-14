import { TUS_CONTRACT_VERSION } from '@factory/contracts/tus'
import type {
  MercadoPagoHandoff,
  Compromiso,
  TusTenantContext,
  WhatsAppAction,
} from '@factory/contracts/tus'

import { resolveWebApiBaseUrl } from './api-url'

export const TUS_API_VERSION = 'v1' as const

export type TusWebContext = TusTenantContext & {
  accessToken?: string
  sessionId?: string
}

export type TusPosOperation = TusTenantContext & {
  operationId: string
  idempotencyKey: string
  kind: 'manual-sale' | 'manual-service'
  context: 'product' | 'service'
  amount: number
  currency: string
  deviceId: string
  shiftId: string
  schemaVersion: string
  createdAt: string
  expectedVersion?: number
  accessToken?: string
}

export type TusMarketplaceLine = {
  lineId: string
  listingId: string
  context: 'product' | 'service'
  quantity: number
  availabilityVersion: number
  slotStart?: string
  slotEnd?: string
}

export type TusMarketplaceDiscoveryItem = {
  listingId: string
  tenantId: string
  merchantId: string
  kind: 'product' | 'service'
  name: string
  description: string
  cohort: string
  locationId: string
  currency: string
  price: number
  availabilityVersion: number
  availableQuantity?: number
  durationMinutes?: number
  capacity?: number
  timezone: string
}

export type TusMarketplaceCheckoutInput = TusWebContext & {
  idempotencyKey: string
  cartId: string
  requestHash: string
  lines: readonly TusMarketplaceLine[]
}

export type TusWhatsAppHandoffInput = TusWebContext & {
  commitmentId?: string
  confirmationId?: string
  senderId?: string
  consent?: boolean
  idempotencyKey?: string
  requestHash?: string
}

export interface TusWhatsAppHandoffResponse {
  status?: string
  reason?: string
  tenantId?: string
  credentialsCollected?: false
  redirectUrl?: string
}

const MARKETPLACE_PATHS = {
  DISCOVERY: '/tus/v1/marketplace/discovery',
  MERCHANT_OPERATIONS: '/tus/v1/marketplace/merchant/operations',
  CUSTOMER_COMMITMENTS: '/tus/v1/marketplace/customer/commitments',
  CHECKOUT: '/tus/v1/marketplace/checkout',
} as const

export const TUS_INTENT_ACTION = {
  RETRY: 'retry',
  REFRESH: 'refresh',
  RESOLVE: 'resolve',
  NONE: 'none',
} as const

export type TusIntentAction = (typeof TUS_INTENT_ACTION)[keyof typeof TUS_INTENT_ACTION]

export const TUS_INTENT_STATUS = {
  ACCEPTED: 'accepted',
  REPLAYED: 'replayed',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  ERROR: 'error',
} as const

export type TusIntentStatus = (typeof TUS_INTENT_STATUS)[keyof typeof TUS_INTENT_STATUS]

export interface TusCheckoutAcknowledgement {
  status: 'accepted' | 'replayed'
  intentId: string
  commitments: readonly Compromiso[]
}

export type TusCheckoutResult = TusCheckoutAcknowledgement | {
  status: 'pending' | 'conflict' | 'error'
  intentId: string
  reason: string
}

export interface TusIntentFeedback {
  status: TusIntentStatus
  intentId: string
  message: string
  evidence: string
  retryable: boolean
  action: TusIntentAction
}

export class TusRequestError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'TusRequestError'
    this.status = status
    this.code = code
  }
}

export interface TusWebRequest<TBody = unknown> extends TusWebContext {
  method: 'GET' | 'POST'
  path: string
  idempotencyKey?: string
  body?: TBody
}

export interface TusWebTransport {
  request<TResponse>(input: TusWebRequest): Promise<TResponse>
}

export interface TusDiscoveryResponse {
  contractVersion?: typeof TUS_CONTRACT_VERSION
  evidence?: 'local-deterministic' | 'local-postgresql-http' | 'authorized-external' | 'deferred'
  items: readonly TusMarketplaceDiscoveryItem[]
}

export interface TusMerchantOperationsResponse {
  merchant?: unknown
  listings?: readonly unknown[]
  items?: readonly unknown[]
}

export interface TusOperationsReportResponse {
  tenantId: string
  sourceVersion: 'tus-operations-v1'
  status: 'complete'
  currency: string
  freshness: {
    latestRecordAt: string | null
    oldestRecordAt: string | null
    stale: boolean
  }
  dimensions: {
    supply: number
    demand: number
    conversion: number
    fulfillment: number
    payment: number
    settlementAging: number
    disputes: number
    posOffline: number
    whatsappActions: number
    readiness: number
  }
}

export interface TusCustomerCommitmentsResponse {
  commitments: readonly Compromiso[]
}

export type TusPosResponse = {
  status: 'accepted' | 'replayed' | 'pending' | 'conflict' | 'error' | 'queued-offline'
  operationId: string
  reason?: string
  receipt?: Record<string, unknown>
}

export interface TusWebClient {
  discover(context: TusWebContext): Promise<TusDiscoveryResponse>
  merchantOperations(context: TusWebContext): Promise<TusMerchantOperationsResponse>
  merchantMarketplaceOperations(context: TusWebContext): Promise<TusMerchantOperationsResponse>
  customerCommitments(context: TusWebContext): Promise<TusCustomerCommitmentsResponse>
  marketplaceCustomerCommitments(context: TusWebContext): Promise<TusCustomerCommitmentsResponse>
  operationsReport(context: TusWebContext): Promise<TusOperationsReportResponse>
  discoverMarketplace(context: TusWebContext): Promise<TusDiscoveryResponse>
  checkoutMarketplace(input: TusMarketplaceCheckoutInput): Promise<TusCheckoutResult>
  whatsappPaymentHandoff(input: TusWhatsAppHandoffInput): Promise<TusWhatsAppHandoffResponse | MercadoPagoHandoff>
  recordManualOperation(operation: TusPosOperation): Promise<TusPosResponse>
}

export function createStableIdempotencyKey(scope: string, intentId: string): string {
  const normalizedScope = scope.trim()
  const normalizedIntent = intentId.trim()
  if (normalizedScope.length === 0 || normalizedIntent.length === 0) throw new Error('intent scope and id are required')
  return `tus:${normalizedScope}:${normalizedIntent}`
}

export function parseTusCheckoutResponse(payload: unknown, fallbackIntentId: string): TusCheckoutResult {
  const record = asRecord(payload)
  const intentId = fallbackIntentId.trim()
  if (record['contractVersion'] !== undefined && record['contractVersion'] !== TUS_CONTRACT_VERSION) {
    return { status: TUS_INTENT_STATUS.ERROR, intentId, reason: 'invalid_server_response' }
  }
  const status = record['status']
  const commitments = record['commitments']
  if ((status === 'executed' || status === 'replay') && Array.isArray(commitments)) {
    return {
      status: status === 'executed' ? TUS_INTENT_STATUS.ACCEPTED : TUS_INTENT_STATUS.REPLAYED,
      intentId,
      commitments: commitments as Compromiso[],
    }
  }
  return { status: TUS_INTENT_STATUS.ERROR, intentId, reason: 'invalid_server_response' }
}

export function parseTusPosResponse(payload: unknown, fallbackOperationId: string): TusPosResponse {
  const record = asRecord(payload)
  const operationId = typeof record['operationId'] === 'string' && record['operationId'].trim().length > 0
    ? record['operationId'].trim()
    : fallbackOperationId
  const status = record['status']
  if (status === 'accepted' || status === 'replayed' || status === 'queued-offline') {
    const receipt = asRecord(record['receipt'])
    return { status, operationId, ...(Object.keys(receipt).length === 0 ? {} : { receipt }) }
  }
  if ((status === 'pending' || status === 'conflict' || status === 'error') && typeof record['reason'] === 'string') return { status, operationId, reason: record['reason'] }
  return { status: 'error', operationId, reason: 'invalid_server_response' }
}

export function classifyTusRequestError(error: unknown, intentId: string): TusIntentFeedback {
  const record = asRecord(error)
  const status = typeof record['status'] === 'number' ? record['status'] : undefined
  const code = typeof record['code'] === 'string' ? record['code'] : undefined
  if (code === 'IN_PROGRESS') return {
    status: TUS_INTENT_STATUS.PENDING,
    intentId,
    message: 'TUS is still processing this intent. Refresh before retrying.',
    evidence: 'The server reported an in-flight request; no success is claimed.',
    retryable: true,
    action: TUS_INTENT_ACTION.REFRESH,
  }
  if (status === 409 || code === 'CONFLICT') return {
    status: TUS_INTENT_STATUS.CONFLICT,
    intentId,
    message: 'This intent conflicts with an existing server request. Resolve or refresh before acting again.',
    evidence: code ?? 'The server reported a duplicate or payload conflict.',
    retryable: false,
    action: TUS_INTENT_ACTION.RESOLVE,
  }
  if (status === undefined || status === 408 || status === 429 || status >= 500) return {
    status: TUS_INTENT_STATUS.PENDING,
    intentId,
    message: 'TUS did not confirm the outcome. Retry the same intent or refresh its status.',
    evidence: 'The response is uncertain; no success is claimed.',
    retryable: true,
    action: TUS_INTENT_ACTION.RETRY,
  }
  return {
    status: TUS_INTENT_STATUS.ERROR,
    intentId,
    message: 'TUS rejected this intent. Review the error before retrying.',
    evidence: code ?? (error instanceof Error ? error.message : 'No server acknowledgement; no success is claimed.'),
    retryable: true,
    action: TUS_INTENT_ACTION.RETRY,
  }
}

export function tusIntentFeedback(result: TusCheckoutResult): TusIntentFeedback {
  if (result.status === TUS_INTENT_STATUS.ACCEPTED) return {
    status: result.status,
    intentId: result.intentId,
    message: 'TUS returned a server acknowledgement for the original intent.',
    evidence: 'Server acknowledgement received; provider capture and settlement are not claimed.',
    retryable: false,
    action: TUS_INTENT_ACTION.REFRESH,
  }
  if (result.status === TUS_INTENT_STATUS.REPLAYED) return {
    status: result.status,
    intentId: result.intentId,
    message: 'TUS replayed the original result for this intent.',
    evidence: 'The server returned the existing commitment result; provider capture and settlement are not claimed.',
    retryable: false,
    action: TUS_INTENT_ACTION.REFRESH,
  }
  if (result.status === TUS_INTENT_STATUS.CONFLICT) return {
    status: result.status,
    intentId: result.intentId,
    message: 'Review this intent before retrying.',
    evidence: 'reason' in result ? result.reason : 'No server acknowledgement; no success is claimed.',
    retryable: false,
    action: TUS_INTENT_ACTION.RESOLVE,
  }
  if (result.status === TUS_INTENT_STATUS.PENDING) return {
    status: result.status,
    intentId: result.intentId,
    message: 'This intent is pending server acknowledgement.',
    evidence: result.reason,
    retryable: true,
    action: TUS_INTENT_ACTION.RETRY,
  }
  return {
    status: TUS_INTENT_STATUS.ERROR,
    intentId: result.intentId,
    message: 'TUS did not acknowledge this intent.',
    evidence: 'reason' in result ? result.reason : 'No server acknowledgement; no success is claimed.',
    retryable: true,
    action: TUS_INTENT_ACTION.RETRY,
  }
}

export function createTusWebClient(transport: TusWebTransport): TusWebClient {
  return {
    discover: (context) =>
      transport.request<TusDiscoveryResponse>({
        ...context,
        method: 'GET',
        path: MARKETPLACE_PATHS.DISCOVERY,
      }),
    recordManualOperation: async ({ accessToken, ...operation }) => {
      const response = await transport.request<unknown>({
        ...operation,
        method: 'POST',
        path: '/tus/pos/manual-operations',
        body: operation,
        ...(accessToken === undefined ? {} : { accessToken }),
      })
      return parseTusPosResponse(response, operation.operationId)
    },
    merchantOperations: (context) =>
      transport.request<TusMerchantOperationsResponse>({
        ...context,
        method: 'GET',
        path: MARKETPLACE_PATHS.MERCHANT_OPERATIONS,
      }),
    merchantMarketplaceOperations: (context) =>
      transport.request<TusMerchantOperationsResponse>({
        ...context,
        method: 'GET',
        path: MARKETPLACE_PATHS.MERCHANT_OPERATIONS,
      }),
    customerCommitments: (context) =>
      transport.request<TusCustomerCommitmentsResponse>({
        ...context,
        method: 'GET',
        path: MARKETPLACE_PATHS.CUSTOMER_COMMITMENTS,
      }),
    marketplaceCustomerCommitments: (context) =>
      transport.request<TusCustomerCommitmentsResponse>({
        ...context,
        method: 'GET',
        path: MARKETPLACE_PATHS.CUSTOMER_COMMITMENTS,
      }),
    operationsReport: (context) =>
      transport.request<TusOperationsReportResponse>({
        ...context,
        method: 'GET',
        path: '/tus/v1/reports/operations',
      }),
    discoverMarketplace: (context) =>
      transport.request<TusDiscoveryResponse>({
        ...context,
        method: 'GET',
        path: MARKETPLACE_PATHS.DISCOVERY,
      }),
    checkoutMarketplace: async ({ cartId, requestHash, lines, idempotencyKey, ...context }) => {
      try {
        const response = await transport.request<unknown>({
          ...context,
          idempotencyKey,
          method: 'POST',
          path: MARKETPLACE_PATHS.CHECKOUT,
          body: { contractVersion: TUS_CONTRACT_VERSION, cartId, requestHash, idempotencyKey, lines },
        })
        return parseTusCheckoutResponse(response, idempotencyKey)
      } catch (error) {
        const feedback = classifyTusRequestError(error, idempotencyKey)
        return { status: feedback.status === TUS_INTENT_STATUS.CONFLICT ? 'conflict' : feedback.status === TUS_INTENT_STATUS.PENDING ? 'pending' : 'error', intentId: idempotencyKey, reason: feedback.evidence }
      }
    },
    whatsappPaymentHandoff: ({ commitmentId, confirmationId, senderId, consent, idempotencyKey, requestHash, accessToken, ...context }) => {
      const stableKey = idempotencyKey ?? createStableIdempotencyKey('whatsapp', context.correlationId)
      const stableHash = requestHash ?? `handoff:${commitmentId ?? 'support'}:${confirmationId ?? 'none'}`
      const handoffAction: WhatsAppAction = {
        contractVersion: TUS_CONTRACT_VERSION,
        type: 'handoff',
        tenantId: context.tenantId,
        ...(commitmentId === undefined ? {} : { commitmentId }),
        ...(confirmationId === undefined ? {} : { confirmationId }),
      }
      return transport.request<TusWhatsAppHandoffResponse | MercadoPagoHandoff>({
        ...context,
        ...(accessToken === undefined ? {} : { accessToken }),
        idempotencyKey: stableKey,
        method: 'POST',
        path: '/tus/v1/whatsapp/handoff',
        body: {
          contractVersion: TUS_CONTRACT_VERSION,
          type: 'handoff',
          tenantId: context.tenantId,
          senderId: senderId ?? context.actorId,
          consent: consent ?? false,
          idempotencyKey: stableKey,
          requestHash: stableHash,
          action: handoffAction,
          ...(commitmentId === undefined ? {} : { commitmentId }),
          ...(confirmationId === undefined ? {} : { confirmationId }),
        },
      })
    },
  }
}

export function createTusWebFetchTransport(): TusWebTransport {
  const baseUrl = resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })

  return {
    request: async <TResponse>(input: TusWebRequest): Promise<TResponse> => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Tenant-Id': input.tenantId,
        'X-Actor-Id': input.actorId,
        'X-Correlation-Id': input.correlationId,
        'X-TUS-API-Version': TUS_API_VERSION,
        'X-TUS-Contract-Version': TUS_CONTRACT_VERSION,
      }
      if ('accessToken' in input && typeof input.accessToken === 'string' && input.accessToken.length > 0) headers['Authorization'] = `Bearer ${input.accessToken}`
      if (input.idempotencyKey !== undefined) headers['Idempotency-Key'] = input.idempotencyKey

      if (input.body !== undefined) headers['Content-Type'] = 'application/json'
      const response = await fetch(joinTusApiUrl(baseUrl, input.path), {
        method: input.method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as Record<string, unknown> | null
        throw new TusRequestError(
          typeof body?.['error'] === 'string' ? body['error'] : `TUS request failed with HTTP ${response.status}`,
          response.status,
          typeof body?.['code'] === 'string' ? body['code'] : undefined,
        )
      }
      return (await response.json()) as TResponse
    },
  }
}

export function normalizeTusApiBaseUrl(value: string | undefined): string {
  return resolveWebApiBaseUrl({ canonicalUrl: value, nodeEnv: 'production' })
}

export function joinTusApiUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeTusApiBaseUrl(baseUrl)
  const normalizedPath = `/${path.trim().replace(/^\/+/, '')}`
  return `${normalizedBase}${normalizedPath}`
}

export default {
  TUS_API_VERSION,
  classifyTusRequestError,
  createStableIdempotencyKey,
  createTusWebClient,
  createTusWebFetchTransport,
  joinTusApiUrl,
  normalizeTusApiBaseUrl,
  parseTusCheckoutResponse,
  parseTusPosResponse,
  tusIntentFeedback,
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
