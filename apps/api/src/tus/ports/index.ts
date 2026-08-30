import type { CommitmentStatus, TusCartLine, TusCommitment, TusTenantContext } from '@factory/contracts'

export const TUS_AUDIT_REFERENCE_TYPES = {
  CREATED: 'commitment.created',
  STATUS_CHANGED: 'commitment.status_changed',
  COMPENSATED: 'commitment.compensated',
  DENIED: 'commitment.denied',
} as const

export type TusAuditReferenceType = (typeof TUS_AUDIT_REFERENCE_TYPES)[keyof typeof TUS_AUDIT_REFERENCE_TYPES]

export const TUS_OUTBOX_EVENT_TYPES = {
  CHECKOUT_CREATED: 'tus.checkout.created',
  STATUS_CHANGED: 'tus.commitment.status_changed',
  COMPENSATED: 'tus.commitment.compensated',
} as const

export type TusOutboxEventType = (typeof TUS_OUTBOX_EVENT_TYPES)[keyof typeof TUS_OUTBOX_EVENT_TYPES]

export const TUS_OUTBOX_STATUSES = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  PUBLISHED: 'published',
  DEAD_LETTER: 'dead-letter',
} as const

export type TusOutboxStatus = (typeof TUS_OUTBOX_STATUSES)[keyof typeof TUS_OUTBOX_STATUSES]

export const TUS_BOUNDED_CONTEXTS = [
  'discovery',
  'merchant-catalog',
  'appointments-services',
  'delivery',
  'pos',
  'settlement',
  'disputes',
  'support',
  'reporting-seo',
  'mixed-checkout',
] as const

export type TusBoundedContext = (typeof TUS_BOUNDED_CONTEXTS)[number]

export interface TusAuthenticatedTenantContext {
  subjectId: string
  sessionId: string
  tenantId: string
  roles: string[]
  permissions: string[]
  correlationId: string
}

export interface TusSessionResolverPort {
  resolve(accessToken: string, correlationId: string): Promise<TusAuthenticatedTenantContext | null>
}

export interface TusAuditReference {
  referenceId: string
  tenantId: string
  actorId: string
  correlationId: string
  commitmentId: string
  referenceType: TusAuditReferenceType
  status?: CommitmentStatus
  previousStatus?: CommitmentStatus
  reason?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface TusCommitmentStorePort {
  saveMany(commitments: readonly TusCommitment[]): Promise<void>
  find(commitmentId: string): Promise<TusCommitment | null>
  update(input: { tenantId: string; commitmentId: string; expectedVersion: number; commitment: TusCommitment }): Promise<TusCommitment | null>
}

export interface TusCommitmentCompensation {
  compensationId: string
  tenantId: string
  commitmentId: string
  actorId: string
  correlationId: string
  amount: number
  currency: string
  reason: string
  createdAt: string
}

export interface TusCommitmentCompensationStorePort {
  save(compensation: TusCommitmentCompensation): Promise<void>
  find(tenantId: string, commitmentId: string): Promise<TusCommitmentCompensation | null>
}

export interface TusAuditStorePort {
  append(references: readonly TusAuditReference[]): Promise<void>
  list(tenantId: string): TusAuditReference[]
}

export interface TusCheckoutCommand extends TusTenantContext {
  cartId: string
  createdAt: string
  requestHash: string
  recordId: string
  expiresAt: number
  lines: TusCartLine[]
}

export interface TusOutboxRecord {
  eventId: string
  tenantId: string
  eventType: TusOutboxEventType
  aggregateId: string
  payload: {
    commitmentIds: string[]
    auditReferenceIds: string[]
    commitmentContext?: 'product' | 'service'
    idempotencyKey?: string
    requestHash?: string
    workflowRunId?: string
    compensationId?: string
  }
  createdAt: number
  status?: TusOutboxStatus
  attempts?: number
  availableAt?: number
  lastError?: string | null
  claimId?: string | null
  claimUntil?: number | null
  publishedAt?: number | null
}

export interface TusOutboxStorePort {
  append(record: TusOutboxRecord): Promise<void>
  list(tenantId: string): TusOutboxRecord[]
  claim(tenantId: string, workerId: string, now: number, leaseMs: number): Promise<TusOutboxRecord | null>
  acknowledge(input: { tenantId: string; eventId: string; claimId: string; publishedAt: number }): Promise<boolean>
  fail(input: { tenantId: string; eventId: string; claimId: string; error: string; now: number; maxAttempts: number }): Promise<TusOutboxStatus>
  recover(now: number): Promise<number>
}

export interface TusTransactionRepositories {
  commitments: TusCommitmentStorePort
  compensations: TusCommitmentCompensationStorePort
  audits: TusAuditStorePort
  idempotency: TusIdempotencyStorePort
  outbox: TusOutboxStorePort
}

export interface TusTransactionPort {
  run<TValue>(operation: (repositories: TusTransactionRepositories) => Promise<TValue>): Promise<TValue>
}

export type TusIdempotencyClaim =
  | { status: 'claimed' }
  | { status: 'replay'; response: TusCheckoutResponse }
  | { status: 'in_progress' }
  | { status: 'conflict' }

export interface TusIdempotencyStorePort {
  claim(input: {
    tenantId: string
    key: string
    requestHash: string
    now: number
    expiresAt: number
  }): Promise<TusIdempotencyClaim>
  complete(input: { tenantId: string; key: string; response: TusCheckoutResponse }): Promise<void>
  release(input: { tenantId: string; key: string }): Promise<void>
}

export interface TusCheckoutResponse {
  commitments: TusCommitment[]
  auditReferences: TusAuditReference[]
  operation?: 'checkout' | 'transition' | 'compensation'
  commitment?: TusCommitment
  compensation?: TusCommitmentCompensation
}

export type TusCommandContext = Pick<TusTenantContext, 'tenantId' | 'actorId' | 'correlationId'>
