import { CONTRACT_VERSION, ContractValidationError } from './base.ts'

export const TUS_CONTRACT_VERSION = CONTRACT_VERSION

export type TusContractVersion = typeof TUS_CONTRACT_VERSION

export interface TusErrorEnvelope {
  code: string
  error: string
  details?: Record<string, unknown>
}

export const COHORTES_MERCADO_SERVICIOS = {
  BEAUTY_PERSONAL_CARE: 'beauty-personal-care',
  REPAIRS_TRADES: 'repairs-trades',
} as const

export type CohorteMercadoServicios = (typeof COHORTES_MERCADO_SERVICIOS)[keyof typeof COHORTES_MERCADO_SERVICIOS]

export const TIPOS_PUBLICACION_MERCADO_SERVICIOS = {
  PRODUCT: 'product',
  SERVICE: 'service',
} as const

export type CommitmentContext = (typeof TIPOS_PUBLICACION_MERCADO_SERVICIOS)[keyof typeof TIPOS_PUBLICACION_MERCADO_SERVICIOS]

export const TUS_COMMITMENT_STATUSES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  FULFILLED: 'fulfilled',
  FROZEN: 'frozen',
  RELEASED: 'released',
  COMPENSATED: 'compensated',
} as const

export type CommitmentStatus = (typeof TUS_COMMITMENT_STATUSES)[keyof typeof TUS_COMMITMENT_STATUSES]

export interface TusTenantContext {
  tenantId: string
  actorId: string
  correlationId: string
  idempotencyKey?: string
}

export interface TusCartLine {
  lineId: string
  context: CommitmentContext
  merchantId: string
  amount: number
  currency: string
}

export interface TusCommitment {
  contractVersion: TusContractVersion
  commitmentId: string
  cartId: string
  tenantId: string
  merchantId: string
  context: CommitmentContext
  amount: number
  currency: string
  status: CommitmentStatus
  lineIds: string[]
  version: number
  createdAt: string
}

export interface PublicacionMercadoServicios {
  contractVersion: TusContractVersion
  listingId: string
  tenantId: string
  merchantId: string
  kind: CommitmentContext
  name: string
  description: string
  cohort: CohorteMercadoServicios
  locationId: string
  currency: string
  price: number
  availabilityVersion: number
  published: boolean
  policyVersion: string
  stock?: number | null
  durationMinutes?: number | null
  capacity?: number | null
  workingHours?: HorarioMercadoServicios[]
}

export interface HorarioMercadoServicios {
  day: number
  start: string
  end: string
}

export interface ItemDescubrimientoMercadoServicios extends PublicacionMercadoServicios {
  timezone: string
  availableQuantity?: number
}

export interface RespuestaDescubrimientoMercadoServicios {
  contractVersion: TusContractVersion
  evidence: 'local-deterministic' | 'local-postgresql-http' | 'authorized-external' | 'deferred'
  items: ItemDescubrimientoMercadoServicios[]
}

export interface LineaConfirmacionCompraMercadoServicios {
  lineId: string
  listingId: string
  context: CommitmentContext
  quantity: number
  availabilityVersion: number
  price?: number
  slotStart?: string
  slotEnd?: string
}

export interface CompromisoMercadoServicios extends TusCommitment {
  listingId: string
  quantity: number
  availabilityVersion: number
  policyVersion: string
  slotStart?: string
  slotEnd?: string
}

export interface SolicitudConfirmacionCompraMercadoServicios {
  contractVersion: TusContractVersion
  cartId: string
  requestHash: string
  idempotencyKey: string
  lines: LineaConfirmacionCompraMercadoServicios[]
}

export interface RespuestaConfirmacionCompraMercadoServicios {
  contractVersion: TusContractVersion
  status: 'executed' | 'replay'
  commitments: CompromisoMercadoServicios[]
  audits: AuditoriaMercadoServicios[]
}

export function validarSolicitudConfirmacionCompraMercadoServicios(value: unknown): SolicitudConfirmacionCompraMercadoServicios {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-marketplace-checkout', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-marketplace-checkout', value['contractVersion'])
  for (const field of ['cartId', 'requestHash', 'idempotencyKey']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (!Array.isArray(value['lines']) || value['lines'].length === 0) {
    throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'lines are required')
  }
  for (const line of value['lines']) {
    if (!isRecord(line)) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'checkout line must be an object')
    }
    for (const field of ['lineId', 'listingId']) {
      if (typeof line[field] !== 'string' || line[field].trim().length === 0) {
        throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, `${field} is required`)
      }
    }
    if (!['product', 'service'].includes(String(line['context']))) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'context is unsupported')
    }
    if (typeof line['quantity'] !== 'number' || !Number.isInteger(line['quantity']) || line['quantity'] < 1) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'quantity must be a positive integer')
    }
    if (typeof line['availabilityVersion'] !== 'number' || !Number.isInteger(line['availabilityVersion']) || line['availabilityVersion'] < 1) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'availabilityVersion must be a positive integer')
    }
    if (line['price'] !== undefined && (typeof line['price'] !== 'number' || !Number.isFinite(line['price']) || line['price'] <= 0)) {
      throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, 'price must be positive')
    }
    for (const field of ['slotStart', 'slotEnd']) {
      if (line[field] !== undefined && !isIsoTimestamp(line[field])) {
        throw new ContractValidationError('tus-marketplace-checkout', TUS_CONTRACT_VERSION, `${field} must be a valid ISO timestamp`)
      }
    }
  }
  return value as unknown as SolicitudConfirmacionCompraMercadoServicios
}

export interface AuditoriaMercadoServicios {
  auditId: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  resourceType: 'merchant' | 'listing' | 'commitment' | 'authorization'
  resourceId: string
  outcome: 'allowed' | 'denied'
  createdAt: string
}

export type EvidenceKind = 'completion' | 'check-in' | 'delivery-accepted'

export interface CompletionEvidence {
  contractVersion: TusContractVersion
  evidenceId: string
  commitmentId: string
  tenantId: string
  actorId: string
  correlationId: string
  kind: EvidenceKind
  occurredAt: string
}

export interface SettlementSnapshot {
  contractVersion: TusContractVersion
  commitmentId: string
  context: CommitmentContext
  ruleVersion: string
  commissionableBase: number
  rateBps: number
  commissionAmount: number
  currency: string
  evidenceId: string
}

export type DisputeStatus = 'open' | 'resolved' | 'rejected'

export interface TusDispute {
  contractVersion: TusContractVersion
  disputeId: string
  commitmentId: string
  tenantId: string
  actorId: string
  correlationId: string
  reason: string
  status: DisputeStatus
}

export interface TusSupportCase {
  contractVersion: TusContractVersion
  caseId: string
  commitmentId: string
  tenantId: string
  actorId: string
  correlationId: string
  category: string
  status: 'open' | 'resolved'
}

export function validateTusSupportCase(value: unknown): TusSupportCase {
  if (!isRecord(value)) throw new ContractValidationError('tus-support-case', undefined, 'payload must be an object')
  assertTusVersion('tus-support-case', value['contractVersion'])
  for (const field of ['caseId', 'commitmentId', 'tenantId', 'actorId', 'correlationId', 'category']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-support-case', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (value['status'] !== 'open' && value['status'] !== 'resolved') {
    throw new ContractValidationError('tus-support-case', TUS_CONTRACT_VERSION, 'status is unsupported')
  }
  return value as unknown as TusSupportCase
}

export const WHATSAPP_ACTION_TYPES = [
  'search',
  'quote',
  'cart',
  'status',
  'handoff',
  'confirm',
] as const

export type WhatsAppActionType = (typeof WHATSAPP_ACTION_TYPES)[number]

export interface WhatsAppAction {
  contractVersion: TusContractVersion
  type: WhatsAppActionType
  tenantId: string
  commitmentId?: string
  confirmationId?: string
}

export function validateTusWhatsAppAction(value: unknown): WhatsAppAction {
  if (!isRecord(value)) throw new ContractValidationError('tus-whatsapp-action', undefined, 'payload must be an object')
  assertTusVersion('tus-whatsapp-action', value['contractVersion'])
  if (typeof value['tenantId'] !== 'string' || value['tenantId'].trim().length === 0) {
    throw new ContractValidationError('tus-whatsapp-action', TUS_CONTRACT_VERSION, 'tenantId is required')
  }
  if (!WHATSAPP_ACTION_TYPES.includes(value['type'] as WhatsAppActionType)) {
    throw new ContractValidationError('tus-whatsapp-action', TUS_CONTRACT_VERSION, 'action type is unsupported')
  }
  for (const field of ['commitmentId', 'confirmationId']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].trim().length === 0)) {
      throw new ContractValidationError('tus-whatsapp-action', TUS_CONTRACT_VERSION, `${field} is invalid`)
    }
  }
  return value as unknown as WhatsAppAction
}

export interface MercadoPagoHandoff {
  contractVersion: TusContractVersion
  provider: 'mercado-pago'
  tenantId: string
  redirectUrl: string
  credentialsCollected: false
}

export type TusDeliveryTaskStatus = 'queued' | 'accepted' | 'picked-up' | 'in-transit' | 'handed-off' | 'returned' | 'incident-review'

export interface TusDeliveryTask {
  contractVersion: TusContractVersion
  taskId: string
  tenantId: string
  commitmentId: string
  merchantId: string
  context: 'product'
  zoneId: string
  shiftId: string
  operatorId: string | null
  status: TusDeliveryTaskStatus
  version: number
  proof?: TusDeliveryProof | null
  incident?: TusDeliveryIncident | null
  settlementClaim: 'not-claimed'
}

export interface TusDeliveryProof {
  contractVersion: TusContractVersion
  proofId: string
  tenantId: string
  taskId: string
  commitmentId: string
  recipientName: string
  capturedAt: string
  evidenceSource: 'authorized' | 'deterministic-test-only'
}

export interface TusDeliveryIncident {
  contractVersion: TusContractVersion
  incidentId: string
  tenantId: string
  taskId: string
  reason: string
  status: 'open' | 'resolved'
  createdAt: string
}

export interface TusPosDevice {
  contractVersion: TusContractVersion
  deviceId: string
  tenantId: string
  label: string
  fingerprint: string
  status: 'active' | 'revoked'
  createdAt: string
  updatedAt: string
}

export interface TusPosSession {
  contractVersion: TusContractVersion
  sessionId: string
  tenantId: string
  deviceId: string
  actorId: string
  shiftId: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt?: string
}

export interface TusPosReceipt {
  contractVersion: TusContractVersion
  receiptId: string
  tenantId: string
  operationId: string
  kind: TusPosOperationKind
  context: CommitmentContext
  amount: number
  currency: string
  status: 'pending' | 'accepted'
  source: 'authorized' | 'deterministic-test-only'
  providerCapture: 'not-claimed'
  settlement: 'not-claimed'
  integrityHash: string
  createdAt: string
}

export interface TusPosConflict {
  contractVersion: TusContractVersion
  conflictId: string
  tenantId: string
  operationId: string
  reason: 'idempotency_conflict' | 'version_conflict' | 'uncertain_sync'
  expectedVersion?: number
  actualVersion?: number
  status: 'open' | 'resolved' | 'discarded'
  createdAt: string
}

export type TusPosOperationKind = 'manual-sale' | 'manual-service'

export interface TusPosOperation {
  contractVersion: TusContractVersion
  operationId: string
  tenantId: string
  actorId: string
  deviceId: string
  shiftId: string
  idempotencyKey: string
  schemaVersion: string
  createdAt: string
  expectedVersion?: number
  kind: TusPosOperationKind
  context: CommitmentContext
  amount: number
  currency: string
}

export function validarPublicacionMercadoServicios(value: unknown): PublicacionMercadoServicios {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-marketplace-listing', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-marketplace-listing', value['contractVersion'])
  for (const field of ['listingId', 'tenantId', 'merchantId', 'name', 'description', 'locationId', 'currency', 'policyVersion']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (!['product', 'service'].includes(String(value['kind'])) || !['beauty-personal-care', 'repairs-trades'].includes(String(value['cohort']))) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'listing kind or cohort is unsupported')
  }
  if (typeof value['price'] !== 'number' || !Number.isFinite(value['price']) || value['price'] <= 0) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'price must be positive')
  }
  if (typeof value['availabilityVersion'] !== 'number' || !Number.isInteger(value['availabilityVersion']) || value['availabilityVersion'] < 1 || typeof value['published'] !== 'boolean') {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'availabilityVersion or published is invalid')
  }
  if (value['kind'] === 'product' && (typeof value['stock'] !== 'number' || !Number.isInteger(value['stock']) || value['stock'] < 0)) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'product stock is required')
  }
  if (value['kind'] === 'service' && (typeof value['durationMinutes'] !== 'number' || !Number.isInteger(value['durationMinutes']) || value['durationMinutes'] <= 0 || typeof value['capacity'] !== 'number' || !Number.isInteger(value['capacity']) || value['capacity'] <= 0 || !Array.isArray(value['workingHours']) || value['workingHours'].length === 0)) {
    throw new ContractValidationError('tus-marketplace-listing', TUS_CONTRACT_VERSION, 'service availability is required')
  }
  return value as unknown as PublicacionMercadoServicios
}

export const READINESS_GATE_KEYS = [
  'legal',
  'kyc',
  'kyb',
  'tax',
  'mercadoPago',
  'posPilot',
  'aws',
  'groqMigration',
  'runtimeProvider',
] as const

export type ReadinessGateKey = (typeof READINESS_GATE_KEYS)[number]

export type ReadinessCapability =
  | 'publication'
  | 'provider-actions'
  | 'settlement'
  | 'fleet'
  | 'release-jobs'

export type ReadinessEvidenceSource =
  | 'authorized-external'
  | 'local-deterministic'
  | 'local-postgresql-http'
  | 'deferred'
  | 'authorized'
  | 'deterministic-test-only'

export interface TusReadinessEvidence {
  contractVersion: TusContractVersion
  evidenceId: string
  tenantId: string
  capability: ReadinessCapability
  gate: ReadinessGateKey
  owner: string
  scope: string
  evidenceType: string
  evidenceRef: string
  policyVersion: string
  issuedAt: string
  expiresAt: string | null
  revoked: boolean
  source: ReadinessEvidenceSource
  profile?: 'native-local' | 'render-native' | 'aws-terraform' | 'local-postgresql-http'
  execution?: 'local-verification' | 'live'
  evidenceClass?: 'authorized-external' | 'local-deterministic' | 'local-postgresql-http' | 'deferred'
  liveConformance?: boolean
}

export type ReadinessFailureReason =
  | 'evidence_missing'
  | 'evidence_out_of_scope'
  | 'evidence_expired'
  | 'evidence_revoked'
  | 'evidence_not_yet_valid'
  | 'evidence_malformed'
  | 'evidence_conflict'
  | 'evidence_deferred'
  | 'deterministic_test_only'
  | 'legacy_conflict'

export interface ReadinessGateFailure {
  gate: ReadinessGateKey
  reason: ReadinessFailureReason
}

export interface ReadinessConflict {
  gate: ReadinessGateKey
  evidenceIds: string[]
  source?: 'evidence' | 'legacy-boolean'
}

export interface TusReadinessDecision {
  contractVersion: TusContractVersion
  tenantId: string
  capability: ReadinessCapability
  evaluatedAt: string
  enabled: boolean
  disposition: 'authorized' | 'disabled' | 'unavailable-deferred'
  failedGates: ReadinessGateFailure[]
  evidenceIds: string[]
  deterministic: boolean
  conflicts?: ReadinessConflict[]
  reason?: string
  evidencePreserved?: true
  auditPreserved?: true
  profile?: 'native-local' | 'render-native' | 'aws-terraform' | 'local-postgresql-http'
  execution?: 'local-verification' | 'live'
  evidenceClass?: 'authorized-external' | 'local-deterministic' | 'local-postgresql-http' | 'deferred'
  policyVersion?: string
  scope?: string
  actorId?: string
  jobId?: string
  correlationId?: string
}

export function validateTusCommitment(value: unknown): TusCommitment {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-commitment', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-commitment', value['contractVersion'])
  for (const field of ['commitmentId', 'cartId', 'tenantId', 'merchantId', 'currency', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (value['context'] !== 'product' && value['context'] !== 'service') {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'context is unsupported')
  }
  if (!isCommitmentStatus(value['status'])) {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'status is unsupported')
  }
  if (typeof value['amount'] !== 'number' || !Number.isFinite(value['amount']) || value['amount'] < 0) {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'amount must be non-negative')
  }
  if (!Array.isArray(value['lineIds']) || value['lineIds'].some((lineId) => typeof lineId !== 'string')) {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'lineIds are required')
  }
  if (typeof value['version'] !== 'number' || !Number.isInteger(value['version']) || value['version'] < 1) {
    throw new ContractValidationError('tus-commitment', TUS_CONTRACT_VERSION, 'version must be a positive integer')
  }
  return value as unknown as TusCommitment
}

export function validateTusSettlementSnapshot(value: unknown): SettlementSnapshot {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-settlement-snapshot', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-settlement-snapshot', value['contractVersion'])
  for (const field of ['commitmentId', 'ruleVersion', 'currency', 'evidenceId']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new ContractValidationError('tus-settlement-snapshot', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (value['context'] !== 'product' && value['context'] !== 'service') {
    throw new ContractValidationError('tus-settlement-snapshot', TUS_CONTRACT_VERSION, 'context is unsupported')
  }
  for (const field of ['commissionableBase', 'rateBps', 'commissionAmount']) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0) {
      throw new ContractValidationError('tus-settlement-snapshot', TUS_CONTRACT_VERSION, `${field} must be non-negative`)
    }
  }
  return value as unknown as SettlementSnapshot
}

export function validateTusReadinessEvidence(value: unknown): TusReadinessEvidence {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-readiness-evidence', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-readiness-evidence', value['contractVersion'])
  for (const field of [
    'evidenceId',
    'tenantId',
    'owner',
    'scope',
    'evidenceType',
    'evidenceRef',
    'policyVersion',
  ]) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (typeof value['issuedAt'] !== 'string' || !isIsoTimestamp(value['issuedAt'])) {
    throw new ContractValidationError(
      'tus-readiness-evidence',
      TUS_CONTRACT_VERSION,
      'issuedAt must be a valid ISO timestamp',
    )
  }
  if (!isReadinessCapability(value['capability'])) {
    throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, 'capability is unsupported')
  }
  if (!isReadinessGateKey(value['gate'])) {
    throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, 'gate is unsupported')
  }
  if (value['expiresAt'] !== null && (typeof value['expiresAt'] !== 'string' || !isIsoTimestamp(value['expiresAt']))) {
    throw new ContractValidationError(
      'tus-readiness-evidence',
      TUS_CONTRACT_VERSION,
      'expiresAt must be a valid ISO timestamp or null',
    )
  }
  if (typeof value['revoked'] !== 'boolean') {
    throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, 'revoked is required')
  }
  if (
    ![
      'authorized-external',
      'local-deterministic',
      'local-postgresql-http',
      'deferred',
      'authorized',
      'deterministic-test-only',
    ].includes(String(value['source']))
  ) {
    throw new ContractValidationError('tus-readiness-evidence', TUS_CONTRACT_VERSION, 'source is unsupported')
  }
  validateReadinessMetadata(value, 'tus-readiness-evidence')
  return value as unknown as TusReadinessEvidence
}

export function validateTusReadinessDecision(value: unknown): TusReadinessDecision {
  if (!isRecord(value)) {
    throw new ContractValidationError('tus-readiness-decision', undefined, 'payload must be an object')
  }
  assertTusVersion('tus-readiness-decision', value['contractVersion'])
  for (const field of ['tenantId', 'evaluatedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (!isIsoTimestamp(value['evaluatedAt'])) {
    throw new ContractValidationError(
      'tus-readiness-decision',
      TUS_CONTRACT_VERSION,
      'evaluatedAt must be a valid ISO timestamp',
    )
  }
  if (!isReadinessCapability(value['capability'])) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'capability is unsupported')
  }
  if (typeof value['enabled'] !== 'boolean' || typeof value['deterministic'] !== 'boolean') {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'boolean decision fields are required')
  }
  if (!['authorized', 'disabled', 'unavailable-deferred'].includes(String(value['disposition']))) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'disposition is unsupported')
  }
  if (!Array.isArray(value['evidenceIds']) || value['evidenceIds'].some((id) => typeof id !== 'string')) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'evidenceIds are required')
  }
  if (!Array.isArray(value['failedGates'])) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'failedGates are required')
  }
  if (
    value['conflicts'] !== undefined &&
    (!Array.isArray(value['conflicts']) ||
      value['conflicts'].some(
        (conflict) =>
          !isRecord(conflict) ||
          !isReadinessGateKey(conflict['gate']) ||
          !Array.isArray(conflict['evidenceIds']) ||
          conflict['evidenceIds'].some((id) => typeof id !== 'string') ||
          (conflict['source'] !== undefined && !['evidence', 'legacy-boolean'].includes(String(conflict['source']))),
      ))
  ) {
    throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'conflicts are unsupported')
  }
  for (const failure of value['failedGates']) {
    if (!isRecord(failure) || !isReadinessGateKey(failure['gate']) || !isReadinessFailureReason(failure['reason'])) {
      throw new ContractValidationError('tus-readiness-decision', TUS_CONTRACT_VERSION, 'failedGates contain an unsupported entry')
    }
  }
  if (
    !isReadinessDecisionConsistent(
      value['enabled'] === true,
      value['deterministic'] === true,
      String(value['disposition']),
      value['failedGates'].length,
      typeof value['reason'] === 'string' ? value['reason'] : undefined,
    )
  ) {
    throw new ContractValidationError(
      'tus-readiness-decision',
      TUS_CONTRACT_VERSION,
      'disposition must match readiness state',
    )
  }
  if (value['enabled'] === true && Array.isArray(value['conflicts']) && value['conflicts'].length > 0) {
    throw new ContractValidationError(
      'tus-readiness-decision',
      TUS_CONTRACT_VERSION,
      'enabled readiness cannot contain conflicts',
    )
  }
  validateReadinessMetadata(value, 'tus-readiness-decision')
  return value as unknown as TusReadinessDecision
}

function validateReadinessMetadata(value: Record<string, unknown>, contract: string): void {
  if (value['profile'] !== undefined && !['native-local', 'render-native', 'aws-terraform', 'local-postgresql-http'].includes(String(value['profile']))) {
    throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, 'profile is unsupported')
  }
  if (value['execution'] !== undefined && !['local-verification', 'live'].includes(String(value['execution']))) {
    throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, 'execution is unsupported')
  }
  if (value['evidenceClass'] !== undefined && !['authorized-external', 'local-deterministic', 'local-postgresql-http', 'deferred'].includes(String(value['evidenceClass']))) {
    throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, 'evidenceClass is unsupported')
  }
  if (value['liveConformance'] !== undefined && typeof value['liveConformance'] !== 'boolean') {
    throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, 'liveConformance must be boolean')
  }
  for (const field of ['policyVersion', 'scope', 'actorId', 'jobId', 'correlationId']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].trim().length === 0)) {
      throw new ContractValidationError(contract, TUS_CONTRACT_VERSION, `${field} must be a non-empty string`)
    }
  }
}

export function validateTusDeliveryTask(value: unknown): TusDeliveryTask {
  if (!isRecord(value)) throw new ContractValidationError('tus-delivery-task', undefined, 'payload must be an object')
  assertTusVersion('tus-delivery-task', value['contractVersion'])
  for (const field of ['taskId', 'tenantId', 'commitmentId', 'merchantId', 'zoneId', 'shiftId', 'settlementClaim']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (value['context'] !== 'product' || !['queued', 'accepted', 'picked-up', 'in-transit', 'handed-off', 'returned', 'incident-review'].includes(String(value['status'])) || value['settlementClaim'] !== 'not-claimed') throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'delivery task lifecycle is unsupported')
  if (typeof value['operatorId'] !== 'string' && value['operatorId'] !== null) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'operatorId is required')
  if (typeof value['version'] !== 'number' || !Number.isInteger(value['version']) || value['version'] < 0) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'version must be a non-negative integer')
  if (value['proof'] !== undefined && value['proof'] !== null && !isRecord(value['proof'])) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'proof must be an object or null')
  if (value['incident'] !== undefined && value['incident'] !== null && !isRecord(value['incident'])) throw new ContractValidationError('tus-delivery-task', TUS_CONTRACT_VERSION, 'incident must be an object or null')
  return value as unknown as TusDeliveryTask
}

export function validateTusPosOperation(value: unknown): TusPosOperation {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-operation', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-operation', value['contractVersion'])
  for (const field of ['operationId', 'tenantId', 'actorId', 'deviceId', 'shiftId', 'idempotencyKey', 'schemaVersion', 'createdAt', 'currency']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-operation', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['manual-sale', 'manual-service'].includes(String(value['kind'])) || !['product', 'service'].includes(String(value['context'])) || (value['kind'] === 'manual-sale' && value['context'] !== 'product') || (value['kind'] === 'manual-service' && value['context'] !== 'service')) throw new ContractValidationError('tus-pos-operation', TUS_CONTRACT_VERSION, 'POS lifecycle context is unsupported')
  if (typeof value['amount'] !== 'number' || !Number.isFinite(value['amount']) || value['amount'] < 0 || !isIsoTimestamp(value['createdAt'])) throw new ContractValidationError('tus-pos-operation', TUS_CONTRACT_VERSION, 'POS amount or timestamp is invalid')
  if (value['expectedVersion'] !== undefined && (typeof value['expectedVersion'] !== 'number' || !Number.isInteger(value['expectedVersion']) || value['expectedVersion'] < 0)) throw new ContractValidationError('tus-pos-operation', TUS_CONTRACT_VERSION, 'expectedVersion is invalid')
  return value as unknown as TusPosOperation
}

export function validateTusPosReceipt(value: unknown): TusPosReceipt {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-receipt', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-receipt', value['contractVersion'])
  for (const field of ['receiptId', 'tenantId', 'operationId', 'currency', 'source', 'providerCapture', 'settlement', 'integrityHash', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-receipt', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['manual-sale', 'manual-service'].includes(String(value['kind'])) || !['product', 'service'].includes(String(value['context'])) || (value['kind'] === 'manual-sale' && value['context'] !== 'product') || (value['kind'] === 'manual-service' && value['context'] !== 'service')) throw new ContractValidationError('tus-pos-receipt', TUS_CONTRACT_VERSION, 'receipt lifecycle context is unsupported')
  if (!['pending', 'accepted'].includes(String(value['status'])) || value['source'] !== 'authorized' && value['source'] !== 'deterministic-test-only' || value['providerCapture'] !== 'not-claimed' || value['settlement'] !== 'not-claimed' || typeof value['amount'] !== 'number' || !Number.isFinite(value['amount']) || value['amount'] < 0 || !/^[a-f0-9]{64}$/.test(String(value['integrityHash'])) || !isIsoTimestamp(value['createdAt'])) throw new ContractValidationError('tus-pos-receipt', TUS_CONTRACT_VERSION, 'receipt integrity or settlement state is invalid')
  return value as unknown as TusPosReceipt
}

export function validateTusPosDevice(value: unknown): TusPosDevice {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-device', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-device', value['contractVersion'])
  for (const field of ['deviceId', 'tenantId', 'label', 'fingerprint', 'createdAt', 'updatedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-device', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['active', 'revoked'].includes(String(value['status'])) || !isIsoTimestamp(value['createdAt']) || !isIsoTimestamp(value['updatedAt'])) throw new ContractValidationError('tus-pos-device', TUS_CONTRACT_VERSION, 'device status or timestamps are invalid')
  return value as unknown as TusPosDevice
}

export function validateTusPosSession(value: unknown): TusPosSession {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-session', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-session', value['contractVersion'])
  for (const field of ['sessionId', 'tenantId', 'deviceId', 'actorId', 'shiftId', 'openedAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-session', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['open', 'closed'].includes(String(value['status'])) || !isIsoTimestamp(value['openedAt']) || (value['closedAt'] !== undefined && (typeof value['closedAt'] !== 'string' || !isIsoTimestamp(value['closedAt'])))) throw new ContractValidationError('tus-pos-session', TUS_CONTRACT_VERSION, 'session status or timestamps are invalid')
  return value as unknown as TusPosSession
}

export function validateTusPosConflict(value: unknown): TusPosConflict {
  if (!isRecord(value)) throw new ContractValidationError('tus-pos-conflict', undefined, 'payload must be an object')
  assertTusVersion('tus-pos-conflict', value['contractVersion'])
  for (const field of ['conflictId', 'tenantId', 'operationId', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new ContractValidationError('tus-pos-conflict', TUS_CONTRACT_VERSION, `${field} is required`)
  }
  if (!['idempotency_conflict', 'version_conflict', 'uncertain_sync'].includes(String(value['reason'])) || !['open', 'resolved', 'discarded'].includes(String(value['status'])) || !isIsoTimestamp(value['createdAt'])) throw new ContractValidationError('tus-pos-conflict', TUS_CONTRACT_VERSION, 'conflict state is invalid')
  return value as unknown as TusPosConflict
}

function assertTusVersion(contract: string, version: unknown): asserts version is TusContractVersion {
  if (version !== TUS_CONTRACT_VERSION) {
    throw new ContractValidationError(contract, version, 'unsupported contract version')
  }
}

function isCommitmentStatus(value: unknown): value is CommitmentStatus {
  return Object.values(TUS_COMMITMENT_STATUSES).includes(value as CommitmentStatus)
}

function isReadinessGateKey(value: unknown): value is ReadinessGateKey {
  return READINESS_GATE_KEYS.includes(value as ReadinessGateKey)
}

function isReadinessCapability(value: unknown): value is ReadinessCapability {
  return ['publication', 'provider-actions', 'settlement', 'fleet', 'release-jobs'].includes(String(value))
}

function isReadinessFailureReason(value: unknown): value is ReadinessFailureReason {
  return [
    'evidence_missing',
    'evidence_out_of_scope',
    'evidence_expired',
    'evidence_revoked',
    'evidence_not_yet_valid',
    'evidence_malformed',
    'evidence_conflict',
    'evidence_deferred',
    'deterministic_test_only',
    'legacy_conflict',
  ].includes(String(value))
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function isReadinessDecisionConsistent(
  enabled: boolean,
  deterministic: boolean,
  disposition: string,
  failedGateCount: number,
  reason: string | undefined,
): boolean {
  if (enabled) return disposition === 'authorized' && !deterministic && failedGateCount === 0
  return disposition === 'disabled' || (disposition === 'unavailable-deferred' && (deterministic || reason === 'evidence_deferred'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
