import { TUS_CONTRACT_VERSION } from '@factory/contracts/tus'
import type {
  ComprobantePOS,
  CasoSoporte,
  DispositivoPOS,
  MercadoPagoHandoff,
  CompromisoMercadoServicios,
  ItemDescubrimientoMercadoServicios,
  LineaConfirmacionCompraMercadoServicios,
  RespuestaDescubrimientoMercadoServicios,
  SesionPOS,
  TusTenantContext,
  AccionWhatsApp,
  AceptacionPresupuesto,
  Diagnostico,
  EvidenciaTrabajo,
  LineaPresupuesto,
  Presupuesto,
  Trabajo,
  CuentaCobroPrestador,
  VistaPreviaPagoServicio,
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

export type TusMarketplaceLine = LineaConfirmacionCompraMercadoServicios

export type TusMarketplaceDiscoveryItem = ItemDescubrimientoMercadoServicios

export type TusMarketplaceCheckoutInput = TusWebContext & {
  idempotencyKey: string
  cartId: string
  requestHash: string
  lines: readonly TusMarketplaceLine[]
}

export type TusWork = Trabajo
export type TusWorkDiagnosis = Diagnostico
export type TusWorkBudget = Presupuesto
export type TusWorkEvidence = EvidenciaTrabajo
export type TusWorkBudgetDecision = AceptacionPresupuesto

export interface TusWorkTransition {
  transitionId: string
  tenantId: string
  trabajoId: string
  previousStatus: TusWork['status'] | null
  status: TusWork['status']
  version: number
  reason: string
  createdAt: string
}

// WEB-08F: el servidor proyecta el expediente segun quien lo lee; `viewer` indica esa audiencia.
export interface TusWorkDetail {
  viewer: 'customer' | 'provider'
  work: TusWork
  diagnoses: readonly TusWorkDiagnosis[]
  budgets: readonly TusWorkBudget[]
  evidence: readonly TusWorkEvidence[]
  transitions: readonly TusWorkTransition[]
}

export interface TusWorkListResponse {
  works: readonly TusWork[]
}

// WEB-09D: server-derived payment preview and provider payment account. The Web never sends
// an amount; it only renders what TUS returns.
export type TusPaymentPreview = VistaPreviaPagoServicio
export type TusPaymentAccount = CuentaCobroPrestador & { connectAvailable: boolean }
export interface TusPaymentIntentResponse {
  status: 'executed' | 'replay' | 'existing'
  payment: { paymentId: string; providerStatus: string; dispatchStatus: string }
}

// WEB-09E: hosted Mercado Pago checkout; the URL is only where to pay, never a confirmation.
export interface TusCheckoutStartResponse {
  status: 'created' | 'existing'
  checkoutUrl: string
  payment: { paymentId: string; providerStatus: string; dispatchStatus: string }
}

export interface TusWorkFinanceResponse {
  viewer: 'customer' | 'provider'
  obligation: { status: string; amountMinor: string; currency: string } | null
  payments: readonly {
    paymentId: string
    providerStatus: string
    providerReference: string | null
  }[]
  settlement?: { status: string; payoutStatus: string } | null
  commission?: {
    rateBps: number
    ruleVersion: string
    grossMinor?: string
    commissionMinor?: string
    pspFeeMinor?: string | null
    providerNetMinor?: string | null
    currency?: string
  } | null
}

export type TusWorkMutationResponse<T> = {
  status: 'executed' | 'replay'
} & T

export type TusWorkMutationInput = TusWebContext & {
  workId: string
  idempotencyKey: string
  requestHash: string
}

export type TusWorkAcceptCommitmentInput = TusWebContext & {
  commitmentId: string
  reservationId?: string
  idempotencyKey: string
  requestHash: string
}

export type TusWorkDiagnosisInput = TusWorkMutationInput & {
  description: string
  structuredData?: Record<string, unknown>
}

export type TusWorkConfirmDiagnosisInput = TusWorkMutationInput & {
  diagnosisId: string
  expectedVersion: number
}

export type TusWorkBudgetInput = TusWorkMutationInput & {
  currency: string
  scope: string
  totalMinor: string
  lines: readonly LineaPresupuesto[]
  validUntil?: string
}

export type TusWorkBudgetDecisionInput = TusWorkMutationInput & {
  budgetId: string
  budgetVersion: number
  acceptanceId?: string
  reason?: string
}

export type TusWorkEvidenceInput = TusWorkMutationInput & {
  evidenceId: string
  phase: TusWorkEvidence['phase']
  reference: string
  metadata: Record<string, unknown>
  occurredAt: string
}

export type TusWorkTransitionInput = TusWorkMutationInput & {
  expectedVersion: number
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
  DISCOVERY: '/tus/v1/mercado-servicios/discovery',
  MERCHANT_OPERATIONS: '/tus/v1/mercado-servicios/merchant/operations',
  CUSTOMER_COMMITMENTS: '/tus/v1/mercado-servicios/customer/commitments',
  CHECKOUT: '/tus/v1/mercado-servicios/checkout',
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
  commitments: readonly CompromisoMercadoServicios[]
}

export type TusCheckoutResult =
  | TusCheckoutAcknowledgement
  | {
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

export type TusDiscoveryResponse = RespuestaDescubrimientoMercadoServicios

export interface TusMerchantOperationsResponse {
  merchant?: TusMerchantProfile | null
  listings?: readonly TusMerchantListing[]
  items?: readonly TusMerchantListing[]
}

export type TusMerchantCohort = 'beauty-personal-care' | 'repairs-trades'
export type TusMerchantListingKind = 'product' | 'service'
export type TusMerchantBookingMode =
  | 'fixed_shift'
  | 'visita_diagnostico'
  | 'variable_duration'
  | 'duracion_estimada'
  | 'requiere_presupuesto'
export type TusMerchantPriceMode =
  'fixed' | 'requires_budget' | 'precio_fijo' | 'precio_desde' | 'por_hora' | 'presupuesto'

export interface TusMerchantWorkingHour {
  day: number
  start: string
  end: string
}

export interface TusMerchantProfile {
  tenantId: string
  merchantId: string
  cohort: TusMerchantCohort
  locationId: string
  timezone: string
  staffRoles: readonly string[]
  operatingPolicyVersion: string
  status: 'approved'
  createdAt: string
  updatedAt: string
}

export interface TusMerchantListing {
  listingId: string
  tenantId: string
  merchantId: string
  kind: TusMerchantListingKind
  name: string
  description: string
  cohort: TusMerchantCohort
  locationId: string
  currency: string
  price: number
  availabilityVersion: number
  published: boolean
  policyVersion: string
  stock: number | null
  durationMinutes: number | null
  capacity: number | null
  workingHours: readonly TusMerchantWorkingHour[]
  bookingMode?: TusMerchantBookingMode
  estimatedDurationMinutes?: number | null
  priceMode?: TusMerchantPriceMode
  createdAt: string
  updatedAt: string
}

export type TusMerchantOnboardInput = TusWebContext & {
  merchantId: string
  cohort: TusMerchantCohort
  locationId: string
  timezone: string
  staffRoles: readonly string[]
  operatingPolicyVersion: string
}

export type TusMerchantListingInput = TusWebContext & {
  merchantId: string
  kind: TusMerchantListingKind
  name: string
  description: string
  cohort: TusMerchantCohort
  locationId: string
  currency: string
  price: number
  stock?: number
  durationMinutes?: number
  capacity?: number
  workingHours?: readonly TusMerchantWorkingHour[]
  bookingMode?: TusMerchantBookingMode
  estimatedDurationMinutes?: number
  priceMode?: TusMerchantPriceMode
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
  commitments: readonly CompromisoMercadoServicios[]
}

export interface TusCalendarSlot {
  slotId: string
  calendarId: string
  listingId: string
  timezone: string
  start: string
  end: string
  capacity: number
}

export interface TusCalendarSlotsResponse {
  slots: readonly TusCalendarSlot[]
}

/** Legacy calendar slots remain available for the explicit legacy client method only. */
export interface TusLegacyCalendarSlot {
  slotId: string
  calendarId: string
  serviceId: string
  timezone: string
  start: string
  end: string
  capacity: number
}

export interface TusLegacyCalendarSlotsResponse {
  slots: readonly TusLegacyCalendarSlot[]
}

export interface TusCalendarBooking {
  contractVersion: typeof TUS_CONTRACT_VERSION
  bookingId: string
  tenantId: string
  ownerTenantId: string
  serviceId?: string
  calendarId: string
  listingId?: string
  customerId: string
  startsAt: string
  endsAt: string
  status: 'confirmed' | 'cancelled' | 'cancelled-late' | 'no-show'
  version: number
  policyVersion: string
  createdAt: string
  updatedAt: string
}

export type TusCalendarBookingResponse =
  | TusCalendarBooking
  | { status: 'replay'; booking: TusCalendarBooking }
  | { status: 'rejected'; reason: 'capacity' }

type TusCanonicalCalendarBookingInput = TusWebContext & {
  listingId: string
  calendarId?: string
  customerId: string
  slotId: string
  idempotencyKey: string
  requestHash: string
  now: string
}

type TusLegacyCalendarBookingInput = TusWebContext & {
  calendarId: string
  serviceId: string
  customerId: string
  slotId: string
  idempotencyKey: string
  requestHash: string
  now: string
}

export type TusCalendarBookingInput =
  TusCanonicalCalendarBookingInput | TusLegacyCalendarBookingInput

export type TusPosResponse = {
  status: 'accepted' | 'replayed' | 'pending' | 'conflict' | 'error' | 'queued-offline'
  operationId: string
  reason?: string
  receipt?: Record<string, unknown>
}

export type TusPosOperationStatus = {
  status: 'accepted' | 'pending' | 'conflict' | 'not_found' | 'error'
  operationId: string
  reason?: string
  receipt?: ComprobantePOS
}

export type TusPosDevice = DispositivoPOS
export type TusPosSession = SesionPOS

export type TusSupportCase = Pick<
  CasoSoporte,
  'caseId' | 'commitmentId' | 'tenantId' | 'correlationId' | 'category' | 'status'
> & {
  disputeId?: string
  openedBy?: string
  outcome?: 'no-refund' | 'partial-refund' | 'full-refund' | null
  createdAt?: string
  resolvedAt?: string | null
}

export interface TusSupportCasesResponse {
  cases: readonly TusSupportCase[]
}

export interface TusSupportEvidenceResponse {
  evidenceId: string
  caseId: string
  party: 'customer' | 'merchant'
  summary: string
  createdAt?: string
}

export interface TusWhatsAppSupportHandoffResponse {
  handoffId?: string
  tenantId?: string
  senderId?: string
  reason?: string
  status?: 'handoff'
  createdAt?: string
}

export interface TusWhatsappAdminConversation {
  conversationId: string
  contact: {
    contactId: string
    waIdMasked: string | null
    displayName: string | null
    linked: boolean
    linkedTenantId: string | null
    blocked: boolean
  }
  mode: 'bot' | 'human'
  status: 'active' | 'closed'
  handoffReason: string | null
  unread: number
  lastMessage: { direction: 'inbound' | 'outbound'; preview: string; status: string } | null
  lastActivity: string
  serviceWindowOpen: boolean
}

export interface TusWhatsappAdminDetail {
  conversationId: string
  contact: TusWhatsappAdminConversation['contact']
  mode: 'bot' | 'human'
  status: 'active' | 'closed'
  handoffReason: string | null
  serviceWindowOpen: boolean
  operatorId: string | null
  summary: string | null
  messages: readonly {
    messageId: string
    direction: 'inbound' | 'outbound'
    actor: string
    type: string
    text: string | null
    status: string
    createdAt: string
    location?: { latitude: number; longitude: number } | null
    hasMedia?: boolean
  }[]
}

export type TusWhatsappAdminAction = 'takeover' | 'release' | 'reply' | 'unlink' | 'block'

export interface TusWebClient {
  discover(context: TusWebContext): Promise<TusDiscoveryResponse>
  merchantOperations(context: TusWebContext): Promise<TusMerchantOperationsResponse>
  merchantMarketplaceOperations(context: TusWebContext): Promise<TusMerchantOperationsResponse>
  customerCommitments(context: TusWebContext): Promise<TusCustomerCommitmentsResponse>
  marketplaceCustomerCommitments(context: TusWebContext): Promise<TusCustomerCommitmentsResponse>
  calendarSlots(
    context: TusWebContext,
    calendarId: string,
    date: string,
    now?: string
  ): Promise<TusLegacyCalendarSlotsResponse>
  calendarSlotsForPublication(
    context: TusWebContext,
    listingId: string,
    date: string,
    now?: string
  ): Promise<TusCalendarSlotsResponse>
  calendarBooking(input: TusCalendarBookingInput): Promise<TusCalendarBookingResponse>
  operationsReport(context: TusWebContext): Promise<TusOperationsReportResponse>
  discoverMarketplace(context: TusWebContext): Promise<TusDiscoveryResponse>
  checkoutMarketplace(input: TusMarketplaceCheckoutInput): Promise<TusCheckoutResult>
  whatsappPaymentHandoff(
    input: TusWhatsAppHandoffInput
  ): Promise<TusWhatsAppHandoffResponse | MercadoPagoHandoff>
  onboardMerchant(input: TusMerchantOnboardInput): Promise<TusMerchantProfile>
  createMerchantListing(input: TusMerchantListingInput): Promise<TusMerchantListing>
  publishMerchantListing(context: TusWebContext, listingId: string): Promise<TusMerchantListing>
  registerPosDevice(
    input: TusWebContext & { deviceId: string; label: string; fingerprint: string }
  ): Promise<TusPosDevice>
  openPosSession(
    input: TusWebContext & { sessionId: string; deviceId: string; shiftId: string }
  ): Promise<TusPosSession>
  closePosSession(context: TusWebContext, sessionId: string): Promise<TusPosSession>
  recordManualOperation(operation: TusPosOperation): Promise<TusPosResponse>
  posOperationStatus(context: TusWebContext, operationId: string): Promise<TusPosOperationStatus>
  listSupportCases(context: TusWebContext): Promise<TusSupportCasesResponse>
  openSupportCase(
    input: TusWebContext & {
      caseId: string
      commitmentId: string
      category: string
      disputeId?: string
    }
  ): Promise<TusSupportCase>
  submitSupportEvidence(
    input: TusWebContext & {
      caseId: string
      evidenceId: string
      party: 'customer' | 'merchant'
      summary: string
    }
  ): Promise<TusSupportEvidenceResponse>
  whatsappSupportHandoff(
    input: TusWebContext & { senderId: string; reason: string }
  ): Promise<TusWhatsAppSupportHandoffResponse>
  listWhatsappAdminConversations(
    context: TusWebContext,
    mode?: 'bot' | 'human'
  ): Promise<{ conversations: readonly TusWhatsappAdminConversation[] }>
  getWhatsappAdminConversation(
    context: TusWebContext,
    conversationId: string
  ): Promise<TusWhatsappAdminDetail>
  whatsappAdminAction(
    context: TusWebContext,
    conversationId: string,
    action: TusWhatsappAdminAction,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>>
  paymentPreview(context: TusWebContext, workId: string): Promise<TusPaymentPreview>
  createWorkPaymentIntent(
    input: TusWebContext & { workId: string; idempotencyKey: string }
  ): Promise<TusPaymentIntentResponse>
  startWorkCheckout(
    input: TusWebContext & { workId: string; idempotencyKey: string }
  ): Promise<TusCheckoutStartResponse>
  workFinance(context: TusWebContext, workId: string): Promise<TusWorkFinanceResponse>
  paymentAccount(context: TusWebContext): Promise<TusPaymentAccount>
  connectPaymentAccount(
    context: TusWebContext
  ): Promise<{ authorizationUrl: string; expiresAt: string }>
  disconnectPaymentAccount(context: TusWebContext): Promise<TusPaymentAccount>
  listWork(context: TusWebContext): Promise<TusWorkListResponse>
  workDetail(context: TusWebContext, workId: string): Promise<TusWorkDetail>
  acceptWorkCommitment(
    input: TusWorkAcceptCommitmentInput
  ): Promise<TusWorkMutationResponse<{ work: TusWork }>>
  createWorkDiagnosis(
    input: TusWorkDiagnosisInput
  ): Promise<TusWorkMutationResponse<{ diagnosis: TusWorkDiagnosis; work: TusWork }>>
  confirmWorkDiagnosis(
    input: TusWorkConfirmDiagnosisInput
  ): Promise<TusWorkMutationResponse<{ diagnosis: TusWorkDiagnosis }>>
  createWorkBudget(
    input: TusWorkBudgetInput
  ): Promise<TusWorkMutationResponse<{ budget: TusWorkBudget; work: TusWork }>>
  acceptWorkBudget(input: TusWorkBudgetDecisionInput): Promise<
    TusWorkMutationResponse<{
      budget: TusWorkBudget
      acceptance: TusWorkBudgetDecision
      work: TusWork
    }>
  >
  rejectWorkBudget(input: TusWorkBudgetDecisionInput): Promise<
    TusWorkMutationResponse<{
      budget: TusWorkBudget
      acceptance: TusWorkBudgetDecision
      work: TusWork
    }>
  >
  recordWorkEvidence(
    input: TusWorkEvidenceInput
  ): Promise<TusWorkMutationResponse<{ evidence: TusWorkEvidence }>>
  startWork(input: TusWorkTransitionInput): Promise<TusWorkMutationResponse<{ work: TusWork }>>
  completeWork(input: TusWorkTransitionInput): Promise<TusWorkMutationResponse<{ work: TusWork }>>
  cancelWork(input: TusWorkTransitionInput): Promise<TusWorkMutationResponse<{ work: TusWork }>>
}

export function createStableIdempotencyKey(scope: string, intentId: string): string {
  const normalizedScope = scope.trim()
  const normalizedIntent = intentId.trim()
  if (normalizedScope.length === 0 || normalizedIntent.length === 0)
    throw new Error('intent scope and id are required')
  return `tus:${normalizedScope}:${normalizedIntent}`
}

export function parseTusCheckoutResponse(
  payload: unknown,
  fallbackIntentId: string
): TusCheckoutResult {
  const record = asRecord(payload)
  const intentId = fallbackIntentId.trim()
  if (
    record['contractVersion'] !== undefined &&
    record['contractVersion'] !== TUS_CONTRACT_VERSION
  ) {
    return { status: TUS_INTENT_STATUS.ERROR, intentId, reason: 'invalid_server_response' }
  }
  const status = record['status']
  const commitments = record['commitments']
  if ((status === 'executed' || status === 'replay') && Array.isArray(commitments)) {
    return {
      status: status === 'executed' ? TUS_INTENT_STATUS.ACCEPTED : TUS_INTENT_STATUS.REPLAYED,
      intentId,
      commitments: commitments as CompromisoMercadoServicios[],
    }
  }
  return { status: TUS_INTENT_STATUS.ERROR, intentId, reason: 'invalid_server_response' }
}

export function parseTusPosResponse(payload: unknown, fallbackOperationId: string): TusPosResponse {
  const record = asRecord(payload)
  const operationId =
    typeof record['operationId'] === 'string' && record['operationId'].trim().length > 0
      ? record['operationId'].trim()
      : fallbackOperationId
  const status = record['status']
  if (status === 'accepted' || status === 'replayed' || status === 'queued-offline') {
    const receipt = asRecord(record['receipt'])
    return { status, operationId, ...(Object.keys(receipt).length === 0 ? {} : { receipt }) }
  }
  if (
    (status === 'pending' || status === 'conflict' || status === 'error') &&
    typeof record['reason'] === 'string'
  )
    return { status, operationId, reason: record['reason'] }
  return { status: 'error', operationId, reason: 'invalid_server_response' }
}

export function parseTusPosOperationStatus(
  payload: unknown,
  fallbackOperationId: string
): TusPosOperationStatus {
  const record = asRecord(payload)
  const operationId =
    typeof record['operationId'] === 'string' && record['operationId'].trim().length > 0
      ? record['operationId'].trim()
      : fallbackOperationId
  const status = record['status']
  const reason = typeof record['reason'] === 'string' ? record['reason'] : undefined
  if (status === 'accepted') {
    const receipt = asRecord(record['receipt'])
    return {
      status,
      operationId,
      ...(Object.keys(receipt).length === 0
        ? {}
        : { receipt: receipt as unknown as ComprobantePOS }),
    }
  }
  if (status === 'pending' || status === 'conflict' || status === 'not_found') {
    return { status, operationId, ...(reason === undefined ? {} : { reason }) }
  }
  return { status: 'error', operationId, reason: reason ?? 'invalid_server_response' }
}

export function parseTusSupportCases(payload: unknown): TusSupportCasesResponse {
  const record = asRecord(payload)
  const cases = Array.isArray(record['cases'])
    ? record['cases'].flatMap((value) => {
        const item = asRecord(value)
        const status = item['status']
        if (
          typeof item['caseId'] !== 'string' ||
          typeof item['commitmentId'] !== 'string' ||
          typeof item['tenantId'] !== 'string' ||
          typeof item['correlationId'] !== 'string' ||
          typeof item['category'] !== 'string' ||
          (status !== 'open' && status !== 'resolved')
        )
          return []
        const normalizedStatus = status as TusSupportCase['status']
        return [
          {
            caseId: item['caseId'],
            commitmentId: item['commitmentId'],
            tenantId: item['tenantId'],
            correlationId: item['correlationId'],
            category: item['category'],
            status: normalizedStatus,
            ...(typeof item['disputeId'] === 'string' ? { disputeId: item['disputeId'] } : {}),
            ...(typeof item['openedBy'] === 'string' ? { openedBy: item['openedBy'] } : {}),
            ...(item['outcome'] === null || typeof item['outcome'] === 'string'
              ? { outcome: item['outcome'] as TusSupportCase['outcome'] }
              : {}),
            ...(typeof item['createdAt'] === 'string' ? { createdAt: item['createdAt'] } : {}),
            ...(item['resolvedAt'] === null || typeof item['resolvedAt'] === 'string'
              ? { resolvedAt: item['resolvedAt'] as string | null }
              : {}),
          },
        ]
      })
    : []
  return { cases }
}

export function parseTusWhatsappAdminConversations(payload: unknown): {
  conversations: readonly TusWhatsappAdminConversation[]
} {
  const record = asRecord(payload)
  const conversations = Array.isArray(record['conversations'])
    ? record['conversations'].flatMap((value) => {
        const item = asRecord(value)
        const contact = asRecord(item['contact'])
        const mode = item['mode']
        const status = item['status']
        if (
          typeof item['conversationId'] !== 'string' ||
          (mode !== 'bot' && mode !== 'human') ||
          (status !== 'active' && status !== 'closed') ||
          typeof contact['contactId'] !== 'string' ||
          typeof item['lastActivity'] !== 'string'
        )
          return []
        const last = item['lastMessage'] === null ? null : asRecord(item['lastMessage'])
        return [
          {
            conversationId: item['conversationId'],
            contact: {
              contactId: contact['contactId'],
              waIdMasked: typeof contact['waIdMasked'] === 'string' ? contact['waIdMasked'] : null,
              displayName:
                typeof contact['displayName'] === 'string' ? contact['displayName'] : null,
              linked: contact['linked'] === true,
              linkedTenantId:
                typeof contact['linkedTenantId'] === 'string' ? contact['linkedTenantId'] : null,
              blocked: contact['blocked'] === true,
            },
            mode: mode as 'bot' | 'human',
            status: status as 'active' | 'closed',
            handoffReason: typeof item['handoffReason'] === 'string' ? item['handoffReason'] : null,
            unread: typeof item['unread'] === 'number' ? item['unread'] : 0,
            lastMessage:
              last &&
              typeof last['direction'] === 'string' &&
              typeof last['preview'] === 'string' &&
              typeof last['status'] === 'string'
                ? {
                    direction: last['direction'] as 'inbound' | 'outbound',
                    preview: last['preview'],
                    status: last['status'],
                  }
                : null,
            lastActivity: item['lastActivity'],
            serviceWindowOpen: item['serviceWindowOpen'] === true,
          },
        ]
      })
    : []
  return { conversations }
}

export function parseTusWhatsappAdminDetail(payload: unknown): TusWhatsappAdminDetail {
  const item = asRecord(payload)
  const contact = asRecord(item['contact'])
  const mode = item['mode']
  const status = item['status']
  if (
    typeof item['conversationId'] !== 'string' ||
    typeof contact['contactId'] !== 'string' ||
    (mode !== 'bot' && mode !== 'human') ||
    (status !== 'active' && status !== 'closed')
  )
    throw new Error('invalid WhatsApp conversation response')
  const messages = Array.isArray(item['messages'])
    ? item['messages'].flatMap((value) => {
        const message = asRecord(value)
        if (
          typeof message['messageId'] !== 'string' ||
          (message['direction'] !== 'inbound' && message['direction'] !== 'outbound') ||
          typeof message['actor'] !== 'string' ||
          typeof message['type'] !== 'string' ||
          typeof message['status'] !== 'string' ||
          typeof message['createdAt'] !== 'string'
        )
          return []
        const location = asRecord(message['location'])
        return [
          {
            messageId: message['messageId'],
            direction: message['direction'] as 'inbound' | 'outbound',
            actor: message['actor'],
            type: message['type'],
            text: typeof message['text'] === 'string' ? message['text'] : null,
            status: message['status'],
            createdAt: message['createdAt'],
            ...(typeof location['latitude'] === 'number' &&
            typeof location['longitude'] === 'number'
              ? { location: { latitude: location['latitude'], longitude: location['longitude'] } }
              : {}),
            ...(message['hasMedia'] === true ? { hasMedia: true } : {}),
          },
        ]
      })
    : []
  return {
    conversationId: item['conversationId'],
    contact: {
      contactId: contact['contactId'],
      waIdMasked: typeof contact['waIdMasked'] === 'string' ? contact['waIdMasked'] : null,
      displayName: typeof contact['displayName'] === 'string' ? contact['displayName'] : null,
      linked: contact['linked'] === true,
      linkedTenantId:
        typeof contact['linkedTenantId'] === 'string' ? contact['linkedTenantId'] : null,
      blocked: contact['blocked'] === true,
    },
    mode: mode as 'bot' | 'human',
    status: status as 'active' | 'closed',
    handoffReason: typeof item['handoffReason'] === 'string' ? item['handoffReason'] : null,
    serviceWindowOpen: item['serviceWindowOpen'] === true,
    operatorId: typeof item['operatorId'] === 'string' ? item['operatorId'] : null,
    summary: typeof item['summary'] === 'string' ? item['summary'] : null,
    messages,
  }
}

export function classifyTusRequestError(error: unknown, intentId: string): TusIntentFeedback {
  const record = asRecord(error)
  const status = typeof record['status'] === 'number' ? record['status'] : undefined
  const code = typeof record['code'] === 'string' ? record['code'] : undefined
  if (code === 'IN_PROGRESS')
    return {
      status: TUS_INTENT_STATUS.PENDING,
      intentId,
      message: 'TUS is still processing this intent. Refresh before retrying.',
      evidence: 'The server reported an in-flight request; no success is claimed.',
      retryable: true,
      action: TUS_INTENT_ACTION.REFRESH,
    }
  if (status === 409 || code === 'CONFLICT')
    return {
      status: TUS_INTENT_STATUS.CONFLICT,
      intentId,
      message:
        'This intent conflicts with an existing server request. Resolve or refresh before acting again.',
      evidence: code ?? 'The server reported a duplicate or payload conflict.',
      retryable: false,
      action: TUS_INTENT_ACTION.RESOLVE,
    }
  if (status === undefined || status === 408 || status === 429 || status >= 500)
    return {
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
    evidence:
      code ??
      (error instanceof Error
        ? error.message
        : 'No server acknowledgement; no success is claimed.'),
    retryable: true,
    action: TUS_INTENT_ACTION.RETRY,
  }
}

export function tusIntentFeedback(result: TusCheckoutResult): TusIntentFeedback {
  if (result.status === TUS_INTENT_STATUS.ACCEPTED)
    return {
      status: result.status,
      intentId: result.intentId,
      message: 'TUS returned a server acknowledgement for the original intent.',
      evidence: 'Server acknowledgement received; provider capture and settlement are not claimed.',
      retryable: false,
      action: TUS_INTENT_ACTION.REFRESH,
    }
  if (result.status === TUS_INTENT_STATUS.REPLAYED)
    return {
      status: result.status,
      intentId: result.intentId,
      message: 'TUS replayed the original result for this intent.',
      evidence:
        'The server returned the existing commitment result; provider capture and settlement are not claimed.',
      retryable: false,
      action: TUS_INTENT_ACTION.REFRESH,
    }
  if (result.status === TUS_INTENT_STATUS.CONFLICT)
    return {
      status: result.status,
      intentId: result.intentId,
      message: 'Review this intent before retrying.',
      evidence:
        'reason' in result ? result.reason : 'No server acknowledgement; no success is claimed.',
      retryable: false,
      action: TUS_INTENT_ACTION.RESOLVE,
    }
  if (result.status === TUS_INTENT_STATUS.PENDING)
    return {
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
    evidence:
      'reason' in result ? result.reason : 'No server acknowledgement; no success is claimed.',
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
    registerPosDevice: ({ deviceId, label, fingerprint, ...context }) =>
      transport.request<TusPosDevice>({
        ...context,
        method: 'POST',
        path: '/tus/v1/pos/devices',
        body: { deviceId, label, fingerprint },
      }),
    openPosSession: ({ sessionId, deviceId, shiftId, ...context }) =>
      transport.request<TusPosSession>({
        ...context,
        method: 'POST',
        path: '/tus/v1/pos/sessions',
        body: { sessionId, deviceId, shiftId },
      }),
    closePosSession: (context, sessionId) =>
      transport.request<TusPosSession>({
        ...context,
        method: 'POST',
        path: `/tus/v1/pos/sessions/${encodeURIComponent(sessionId)}/close`,
      }),
    posOperationStatus: async (context, operationId) => {
      const response = await transport.request<unknown>({
        ...context,
        method: 'GET',
        path: `/tus/v1/pos/operations/${encodeURIComponent(operationId)}/status`,
      })
      return parseTusPosOperationStatus(response, operationId)
    },
    listSupportCases: async (context) => {
      const response = await transport.request<unknown>({
        ...context,
        method: 'GET',
        path: '/tus/v1/support/cases',
      })
      return parseTusSupportCases(response)
    },
    openSupportCase: async ({ caseId, commitmentId, category, disputeId, ...context }) =>
      transport.request<TusSupportCase>({
        ...context,
        method: 'POST',
        path: '/tus/v1/support/cases',
        body: { caseId, commitmentId, category, ...(disputeId === undefined ? {} : { disputeId }) },
      }),
    submitSupportEvidence: async ({ caseId, evidenceId, party, summary, ...context }) =>
      transport.request<TusSupportEvidenceResponse>({
        ...context,
        method: 'POST',
        path: `/tus/v1/support/cases/${encodeURIComponent(caseId)}/evidence`,
        body: { evidenceId, party, summary },
      }),
    whatsappSupportHandoff: async ({ senderId, reason, ...context }) =>
      transport.request<TusWhatsAppSupportHandoffResponse>({
        ...context,
        method: 'POST',
        path: '/tus/v1/whatsapp/support-handoff',
        body: { senderId, reason },
      }),
    listWhatsappAdminConversations: async (context, mode) => {
      const response = await transport.request<unknown>({
        ...context,
        method: 'GET',
        path: `/tus/v1/admin/whatsapp/conversations${mode ? `?mode=${encodeURIComponent(mode)}` : ''}`,
      })
      return parseTusWhatsappAdminConversations(response)
    },
    getWhatsappAdminConversation: async (context, conversationId) => {
      const response = await transport.request<unknown>({
        ...context,
        method: 'GET',
        path: `/tus/v1/admin/whatsapp/conversations/${encodeURIComponent(conversationId)}`,
      })
      return parseTusWhatsappAdminDetail(response)
    },
    whatsappAdminAction: (context, conversationId, action, body = {}) =>
      transport.request<Record<string, unknown>>({
        ...context,
        method: 'POST',
        path: `/tus/v1/admin/whatsapp/conversations/${encodeURIComponent(conversationId)}/${action}`,
        body,
      }),
    paymentPreview: (context, workId) =>
      transport.request<TusPaymentPreview>({
        ...context,
        method: 'GET',
        path: `/tus/v1/work/${encodeURIComponent(workId)}/payment-preview`,
      }),
    createWorkPaymentIntent: ({ workId, idempotencyKey, ...context }) =>
      transport.request<TusPaymentIntentResponse>({
        ...context,
        idempotencyKey,
        method: 'POST',
        path: `/tus/v1/work/${encodeURIComponent(workId)}/payment-intents`,
        body: {},
      }),
    startWorkCheckout: ({ workId, idempotencyKey, ...context }) =>
      transport.request<TusCheckoutStartResponse>({
        ...context,
        idempotencyKey,
        method: 'POST',
        path: `/tus/v1/work/${encodeURIComponent(workId)}/checkout`,
        body: {},
      }),
    workFinance: (context, workId) =>
      transport.request<TusWorkFinanceResponse>({
        ...context,
        method: 'GET',
        path: `/tus/v1/work/${encodeURIComponent(workId)}/finance`,
      }),
    paymentAccount: (context) =>
      transport.request<TusPaymentAccount>({
        ...context,
        method: 'GET',
        path: '/tus/v1/provider/payment-account',
      }),
    connectPaymentAccount: (context) =>
      transport.request<{ authorizationUrl: string; expiresAt: string }>({
        ...context,
        method: 'POST',
        path: '/tus/v1/provider/payment-account/mercado-pago/connect',
        body: {},
      }),
    disconnectPaymentAccount: (context) =>
      transport.request<TusPaymentAccount>({
        ...context,
        method: 'POST',
        path: '/tus/v1/provider/payment-account/disconnect',
        body: {},
      }),
    listWork: (context) =>
      transport.request<TusWorkListResponse>({
        ...context,
        method: 'GET',
        path: '/tus/v1/work',
      }),
    workDetail: (context, workId) =>
      transport.request<TusWorkDetail>({
        ...context,
        method: 'GET',
        path: `/tus/v1/work/${encodeURIComponent(workId)}`,
      }),
    acceptWorkCommitment: ({
      commitmentId,
      reservationId,
      idempotencyKey,
      requestHash,
      ...context
    }) =>
      transport.request<TusWorkMutationResponse<{ work: TusWork }>>({
        ...context,
        idempotencyKey,
        method: 'POST',
        path: `/tus/v1/work/commitments/${encodeURIComponent(commitmentId)}/accept`,
        body: { requestHash, ...(reservationId === undefined ? {} : { reservationId }) },
      }),
    createWorkDiagnosis: ({
      workId,
      description,
      structuredData,
      idempotencyKey,
      requestHash,
      ...context
    }) =>
      transport.request<TusWorkMutationResponse<{ diagnosis: TusWorkDiagnosis; work: TusWork }>>({
        ...context,
        idempotencyKey,
        method: 'POST',
        path: `/tus/v1/work/${encodeURIComponent(workId)}/diagnosis`,
        body: {
          requestHash,
          description,
          ...(structuredData === undefined ? {} : { structuredData }),
        },
      }),
    confirmWorkDiagnosis: ({
      workId,
      diagnosisId,
      expectedVersion,
      idempotencyKey,
      requestHash,
      ...context
    }) =>
      transport.request<TusWorkMutationResponse<{ diagnosis: TusWorkDiagnosis }>>({
        ...context,
        idempotencyKey,
        method: 'POST',
        path: `/tus/v1/work/${encodeURIComponent(workId)}/diagnosis/${encodeURIComponent(diagnosisId)}/confirm`,
        body: { requestHash, expectedVersion },
      }),
    createWorkBudget: ({
      workId,
      currency,
      scope,
      totalMinor,
      lines,
      validUntil,
      idempotencyKey,
      requestHash,
      ...context
    }) =>
      transport.request<TusWorkMutationResponse<{ budget: TusWorkBudget; work: TusWork }>>({
        ...context,
        idempotencyKey,
        method: 'POST',
        path: `/tus/v1/work/${encodeURIComponent(workId)}/budgets`,
        body: {
          requestHash,
          currency,
          scope,
          totalMinor,
          lines,
          ...(validUntil === undefined ? {} : { validUntil }),
        },
      }),
    acceptWorkBudget: (input) => decideWorkBudget(transport, input, 'accept'),
    rejectWorkBudget: (input) => decideWorkBudget(transport, input, 'reject'),
    recordWorkEvidence: ({
      workId,
      evidenceId,
      phase,
      reference,
      metadata,
      occurredAt,
      idempotencyKey,
      requestHash,
      ...context
    }) =>
      transport.request<TusWorkMutationResponse<{ evidence: TusWorkEvidence }>>({
        ...context,
        idempotencyKey,
        method: 'POST',
        path: `/tus/v1/work/${encodeURIComponent(workId)}/evidence`,
        body: { requestHash, evidenceId, phase, reference, metadata, occurredAt },
      }),
    startWork: (input) => transitionWork(transport, input, 'start'),
    completeWork: (input) => transitionWork(transport, input, 'complete'),
    cancelWork: (input) => transitionWork(transport, input, 'cancel'),
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
    onboardMerchant: async ({
      merchantId,
      cohort,
      locationId,
      timezone,
      staffRoles,
      operatingPolicyVersion,
      ...context
    }) =>
      transport.request<TusMerchantProfile>({
        ...context,
        method: 'POST',
        path: '/tus/v1/marketplace/onboarding',
        body: { merchantId, cohort, locationId, timezone, staffRoles, operatingPolicyVersion },
      }),
    createMerchantListing: async ({
      merchantId,
      kind,
      name,
      description,
      cohort,
      locationId,
      currency,
      price,
      stock,
      durationMinutes,
      capacity,
      workingHours,
      bookingMode,
      estimatedDurationMinutes,
      priceMode,
      ...context
    }) =>
      transport.request<TusMerchantListing>({
        ...context,
        method: 'POST',
        path: '/tus/v1/marketplace/listings',
        body: {
          merchantId,
          kind,
          name,
          description,
          cohort,
          locationId,
          currency,
          price,
          ...(stock === undefined ? {} : { stock }),
          ...(durationMinutes === undefined ? {} : { durationMinutes }),
          ...(capacity === undefined ? {} : { capacity }),
          ...(workingHours === undefined ? {} : { workingHours }),
          ...(bookingMode === undefined ? {} : { bookingMode }),
          ...(estimatedDurationMinutes === undefined ? {} : { estimatedDurationMinutes }),
          ...(priceMode === undefined ? {} : { priceMode }),
        },
      }),
    publishMerchantListing: (context, listingId) =>
      transport.request<TusMerchantListing>({
        ...context,
        method: 'POST',
        path: `/tus/v1/marketplace/listings/${encodeURIComponent(listingId)}/publish`,
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
    calendarSlots: (context, calendarId, date, now) =>
      transport.request<TusLegacyCalendarSlotsResponse>({
        ...context,
        method: 'GET',
        path: `/tus/v1/calendar/${encodeURIComponent(calendarId)}/slots?date=${encodeURIComponent(date)}${now === undefined ? '' : `&now=${encodeURIComponent(now)}`}`,
      }),
    calendarSlotsForPublication: (context, listingId, date, now) =>
      transport.request<TusCalendarSlotsResponse>({
        ...context,
        method: 'GET',
        path: `/tus/v1/marketplace/listings/${encodeURIComponent(listingId)}/slots?date=${encodeURIComponent(date)}${now === undefined ? '' : `&now=${encodeURIComponent(now)}`}`,
      }),
    calendarBooking: async (input) => {
      const { customerId, slotId, idempotencyKey, requestHash, now, ...context } = input
      const body =
        'listingId' in input
          ? {
              listingId: input.listingId,
              ...(input.calendarId === undefined ? {} : { calendarId: input.calendarId }),
              customerId,
              slotId,
              idempotencyKey,
              requestHash,
              now,
            }
          : {
              calendarId: input.calendarId,
              serviceId: input.serviceId,
              customerId,
              slotId,
              idempotencyKey,
              requestHash,
              now,
            }
      return transport.request<TusCalendarBookingResponse>({
        ...context,
        idempotencyKey,
        method: 'POST',
        path: '/tus/v1/calendar/bookings',
        body,
      })
    },
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
          body: {
            contractVersion: TUS_CONTRACT_VERSION,
            cartId,
            requestHash,
            idempotencyKey,
            lines,
          },
        })
        return parseTusCheckoutResponse(response, idempotencyKey)
      } catch (error) {
        const feedback = classifyTusRequestError(error, idempotencyKey)
        return {
          status:
            feedback.status === TUS_INTENT_STATUS.CONFLICT
              ? 'conflict'
              : feedback.status === TUS_INTENT_STATUS.PENDING
                ? 'pending'
                : 'error',
          intentId: idempotencyKey,
          reason: feedback.evidence,
        }
      }
    },
    whatsappPaymentHandoff: ({
      commitmentId,
      confirmationId,
      senderId,
      consent,
      idempotencyKey,
      requestHash,
      accessToken,
      ...context
    }) => {
      const stableKey =
        idempotencyKey ?? createStableIdempotencyKey('whatsapp', context.correlationId)
      const stableHash =
        requestHash ?? `handoff:${commitmentId ?? 'support'}:${confirmationId ?? 'none'}`
      const handoffAction: AccionWhatsApp = {
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

function decideWorkBudget(
  transport: TusWebTransport,
  {
    workId,
    budgetId,
    budgetVersion,
    acceptanceId,
    reason,
    idempotencyKey,
    requestHash,
    ...context
  }: TusWorkBudgetDecisionInput,
  decision: 'accept' | 'reject'
): Promise<
  TusWorkMutationResponse<{
    budget: TusWorkBudget
    acceptance: TusWorkBudgetDecision
    work: TusWork
  }>
> {
  return transport.request({
    ...context,
    idempotencyKey,
    method: 'POST',
    path: `/tus/v1/work/${encodeURIComponent(workId)}/budgets/${budgetVersion}/${decision}`,
    body: {
      requestHash,
      budgetId,
      ...(acceptanceId === undefined ? {} : { acceptanceId }),
      ...(reason === undefined ? {} : { reason }),
    },
  })
}

function transitionWork(
  transport: TusWebTransport,
  { workId, expectedVersion, idempotencyKey, requestHash, ...context }: TusWorkTransitionInput,
  action: 'start' | 'complete' | 'cancel'
): Promise<TusWorkMutationResponse<{ work: TusWork }>> {
  return transport.request({
    ...context,
    idempotencyKey,
    method: 'POST',
    path: `/tus/v1/work/${encodeURIComponent(workId)}/${action}`,
    body: { requestHash, expectedVersion },
  })
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
      if (
        'accessToken' in input &&
        typeof input.accessToken === 'string' &&
        input.accessToken.length > 0
      )
        headers['Authorization'] = `Bearer ${input.accessToken}`
      if (input.idempotencyKey !== undefined) headers['Idempotency-Key'] = input.idempotencyKey

      if (input.body !== undefined) headers['Content-Type'] = 'application/json'
      const response = await fetch(joinTusApiUrl(baseUrl, input.path), {
        method: input.method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
        throw new TusRequestError(
          typeof body?.['error'] === 'string'
            ? body['error']
            : `TUS request failed with HTTP ${response.status}`,
          response.status,
          typeof body?.['code'] === 'string' ? body['code'] : undefined
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

const tusClientModule = {
  TUS_API_VERSION,
  classifyTusRequestError,
  createStableIdempotencyKey,
  createTusWebClient,
  createTusWebFetchTransport,
  joinTusApiUrl,
  normalizeTusApiBaseUrl,
  parseTusCheckoutResponse,
  parseTusPosOperationStatus,
  parseTusPosResponse,
  parseTusSupportCases,
  parseTusWhatsappAdminConversations,
  parseTusWhatsappAdminDetail,
  tusIntentFeedback,
}

export default tusClientModule

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
