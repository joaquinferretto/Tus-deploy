export const QUEUE_CONTRACT_VERSION = '1.0.0' as const

export const QUEUE_ACTIVATION = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
} as const

export type QueueActivation = (typeof QUEUE_ACTIVATION)[keyof typeof QUEUE_ACTIVATION]

export const QUEUE_STATUS = {
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  ACKNOWLEDGED: 'acknowledged',
  RETRYABLE: 'retryable',
  DEAD_LETTER: 'dead_letter',
  CANCELLED: 'cancelled',
  FORBIDDEN: 'forbidden',
  EMPTY: 'empty',
} as const

export type QueueStatus = (typeof QUEUE_STATUS)[keyof typeof QUEUE_STATUS]

export interface QueueLineage {
  rootMessageId: string
  source: string
  parentMessageId?: string
}

export interface QueueMessageInput {
  contractVersion: typeof QUEUE_CONTRACT_VERSION
  messageId: string
  jobId: string
  runId: string
  jobType: string
  tenantId: string
  actorId: string
  correlationId: string
  idempotencyKey: string
  lineage: QueueLineage
  payload: Readonly<Record<string, unknown>>
  maxAttempts: number
  createdAt: number
  availableAt?: number
}

export interface QueueMessage extends QueueMessageInput {
  availableAt: number
  deliveryCount: number
  lastError: string | null
}

export interface QueueEnqueueResult {
  status: typeof QUEUE_STATUS.QUEUED
  message: QueueMessage
}

export interface QueueClaimInput {
  tenantId: string
  workerId: string
  now: number
  visibilityTimeoutMs: number
}

export interface QueueClaim {
  status: typeof QUEUE_STATUS.CLAIMED
  receiptId: string
  workerId: string
  attempt: number
  visibilityUntil: number
  message: QueueMessage
}

export interface QueueEmptyResult {
  status: typeof QUEUE_STATUS.EMPTY
}

export type QueueClaimResult = QueueClaim | QueueEmptyResult

export interface QueueAcknowledgeInput {
  tenantId: string
  workerId: string
  receiptId: string
  now: number
}

export interface QueueAcknowledgeResult {
  status:
    typeof QUEUE_STATUS.ACKNOWLEDGED | typeof QUEUE_STATUS.FORBIDDEN | typeof QUEUE_STATUS.EMPTY
  message?: QueueMessage
}

export interface QueueRetryInput {
  tenantId: string
  workerId: string
  receiptId: string
  now: number
  error: string
  delayMs?: number
}

export interface QueueRetryResult {
  status:
    | typeof QUEUE_STATUS.RETRYABLE
    | typeof QUEUE_STATUS.DEAD_LETTER
    | typeof QUEUE_STATUS.FORBIDDEN
    | typeof QUEUE_STATUS.EMPTY
  message?: QueueMessage
  availableAt?: number
  error?: string
}

export interface QueueCancelInput {
  tenantId: string
  jobId: string
  now: number
  reason: string
}

export interface QueueCancelResult {
  status: typeof QUEUE_STATUS.CANCELLED | typeof QUEUE_STATUS.FORBIDDEN | typeof QUEUE_STATUS.EMPTY
  message?: QueueMessage
  queueOwnsBusinessState: false
}

export interface QueueReconcileInput {
  tenantId: string
  now: number
  knownRunIds: readonly string[]
}

export interface QueueReconcileResult {
  status: 'clean' | 'recovered' | 'attention'
  expiredClaims: number
  orphanedMessages: number
  pendingMessages: number
  deadLetterMessages: number
  queueOwnsBusinessState: false
}

export interface QueueTransportPort {
  enqueue(input: QueueMessageInput): Promise<QueueEnqueueResult>
  claim(input: QueueClaimInput): Promise<QueueClaimResult>
  acknowledge(input: QueueAcknowledgeInput): Promise<QueueAcknowledgeResult>
  retry(input: QueueRetryInput): Promise<QueueRetryResult>
  cancel(input: QueueCancelInput): Promise<QueueCancelResult>
  reconcile(input: QueueReconcileInput): Promise<QueueReconcileResult>
  deadLetters(tenantId: string): Promise<readonly QueueMessage[]>
}

export class QueueActivationError extends Error {
  readonly code = 'QUEUE_ACTIVATION_REQUIRED'

  constructor(provider: string) {
    super(`${provider} queue is disabled until its activation gate is satisfied`)
    this.name = 'QueueActivationError'
  }
}

export class QueueProviderUnavailableError extends Error {
  readonly code = 'QUEUE_PROVIDER_UNAVAILABLE'

  constructor(provider: string) {
    super(`${provider} queue provider is unavailable; use a deterministic fake`)
    this.name = 'QueueProviderUnavailableError'
  }
}

export function assertQueueMessage(input: QueueMessageInput): void {
  const fields = {
    messageId: input.messageId,
    jobId: input.jobId,
    runId: input.runId,
    jobType: input.jobType,
    tenantId: input.tenantId,
    actorId: input.actorId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
  }
  for (const [name, value] of Object.entries(fields)) {
    if (!value.trim()) throw new Error(`Queue message ${name} is required`)
  }
  if (input.contractVersion !== QUEUE_CONTRACT_VERSION)
    throw new Error('Unsupported queue contract version')
  if (!input.lineage.rootMessageId.trim() || !input.lineage.source.trim())
    throw new Error('Queue message lineage is required')
  if (
    !Number.isFinite(input.createdAt) ||
    (input.availableAt !== undefined && !Number.isFinite(input.availableAt))
  )
    throw new Error('Queue message time is required')
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1)
    throw new Error('Queue message maxAttempts must be positive')
}

export function retryBackoffMs(attempt: number, baseMs = 100, maxMs = 30_000): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Queue attempt must be positive')
  if (!Number.isFinite(baseMs) || baseMs < 0 || !Number.isFinite(maxMs) || maxMs < baseMs)
    throw new Error('Queue backoff bounds are invalid')
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1))
}

export function cloneQueueMessage(message: QueueMessage): QueueMessage {
  return structuredClone(message)
}

export default {
  QUEUE_CONTRACT_VERSION,
  QUEUE_ACTIVATION,
  QUEUE_STATUS,
  QueueActivationError,
  QueueProviderUnavailableError,
  assertQueueMessage,
  retryBackoffMs,
  cloneQueueMessage,
}
