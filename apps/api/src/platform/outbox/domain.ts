import type { JsonValue } from '../idempotency/domain.js'

export const OUTBOX_STATUS = {
  PENDING: 'pending',
  CLAIMED: 'claimed',
  PUBLISHED: 'published',
} as const

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS]

export const OUTBOX_RESULT_STATUS = {
  CLAIMED: 'claimed',
  IN_PROGRESS: 'in_progress',
  PUBLISHED: 'published',
  ALREADY_PUBLISHED: 'already_published',
  EMPTY: 'empty',
  FORBIDDEN: 'forbidden',
} as const

export type OutboxResultStatus = (typeof OUTBOX_RESULT_STATUS)[keyof typeof OUTBOX_RESULT_STATUS]

export interface OutboxEventInput {
  id: string
  tenantId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payload: JsonValue
  createdAt: number
  availableAt: number
}

export interface OutboxRecord extends OutboxEventInput {
  status: OutboxStatus
  attempts: number
  lastError: string | null
  publishedAt: number | null
  claimId: string | null
  claimUntil: number | null
}

export interface OutboxClaimInput {
  tenantId: string
  eventId: string
  claimId: string
  now: number
  leaseMs: number
}

export interface OutboxPublishInput {
  tenantId: string
  eventId: string
  claimId: string
  now: number
}

export interface OutboxRecoveryInput {
  tenantId: string
  now: number
}

export interface OutboxClaimResult {
  status: OutboxResultStatus
  record?: OutboxRecord
}

export interface OutboxPublishResult {
  status: typeof OUTBOX_RESULT_STATUS.PUBLISHED | typeof OUTBOX_RESULT_STATUS.ALREADY_PUBLISHED
  record: OutboxRecord
}

export function outboxRecordKey(tenantId: string, eventId: string): string {
  return `${tenantId}:${eventId}`
}

export function cloneOutboxRecord(record: OutboxRecord): OutboxRecord {
  return structuredClone(record)
}

export function validOutboxEvent(input: OutboxEventInput): boolean {
  return Boolean(
    input.id.trim() &&
    input.tenantId.trim() &&
    input.aggregateType.trim() &&
    input.aggregateId.trim() &&
    input.eventType.trim() &&
    Number.isFinite(input.createdAt) &&
    Number.isFinite(input.availableAt)
  )
}

export default { OUTBOX_STATUS, OUTBOX_RESULT_STATUS, outboxRecordKey, validOutboxEvent }
