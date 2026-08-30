export const IDEMPOTENCY_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUS)[keyof typeof IDEMPOTENCY_STATUS]

export const IDEMPOTENCY_CLAIM_STATUS = {
  CLAIMED: 'claimed',
  REPLAY: 'replay',
  IN_PROGRESS: 'in_progress',
  CONFLICT: 'conflict',
  FORBIDDEN: 'forbidden',
} as const

export type IdempotencyClaimStatus =
  (typeof IDEMPOTENCY_CLAIM_STATUS)[keyof typeof IDEMPOTENCY_CLAIM_STATUS]

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }

export interface IdempotencyRecord {
  id: string
  tenantId: string
  key: string
  requestHash: string
  status: IdempotencyStatus
  response: JsonValue | null
  createdAt: number
  expiresAt: number
}

export interface IdempotencyClaimInput {
  tenantId: string
  key: string
  requestHash: string
  recordId: string
  now: number
  expiresAt: number
}

export interface IdempotencyCompleteInput extends IdempotencyClaimInput {
  response: JsonValue
}

export interface IdempotencyFailureInput extends IdempotencyClaimInput {
  response?: JsonValue
}

export interface IdempotencyClaimed {
  status: typeof IDEMPOTENCY_CLAIM_STATUS.CLAIMED
  record: IdempotencyRecord
}

export interface IdempotencyReplay {
  status: typeof IDEMPOTENCY_CLAIM_STATUS.REPLAY
  record: IdempotencyRecord
  response: JsonValue
}

export interface IdempotencyInProgress {
  status: typeof IDEMPOTENCY_CLAIM_STATUS.IN_PROGRESS
  record: IdempotencyRecord
}

export interface IdempotencyConflict {
  status: typeof IDEMPOTENCY_CLAIM_STATUS.CONFLICT
  record: IdempotencyRecord
}

export interface IdempotencyForbidden {
  status: typeof IDEMPOTENCY_CLAIM_STATUS.FORBIDDEN
}

export type IdempotencyClaimResult =
  | IdempotencyClaimed
  | IdempotencyReplay
  | IdempotencyInProgress
  | IdempotencyConflict
  | IdempotencyForbidden

export function idempotencyRecordKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`
}

export function validIdempotencyInput(input: IdempotencyClaimInput): boolean {
  return Boolean(
    input.tenantId.trim() &&
    input.key.trim() &&
    input.requestHash.trim() &&
    input.recordId.trim() &&
    Number.isFinite(input.now) &&
    Number.isFinite(input.expiresAt) &&
    input.expiresAt > input.now
  )
}

export function cloneIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
  return structuredClone(record)
}

export default {
  IDEMPOTENCY_STATUS,
  IDEMPOTENCY_CLAIM_STATUS,
  idempotencyRecordKey,
  validIdempotencyInput,
}
