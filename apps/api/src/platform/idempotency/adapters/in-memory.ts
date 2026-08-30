import {
  IDEMPOTENCY_CLAIM_STATUS,
  IDEMPOTENCY_STATUS,
  cloneIdempotencyRecord,
  idempotencyRecordKey,
  validIdempotencyInput,
  type IdempotencyClaimInput,
  type IdempotencyClaimResult,
  type IdempotencyCompleteInput,
  type IdempotencyFailureInput,
  type IdempotencyRecord,
} from '../domain.js'
import type { IdempotencyStorePort } from '../ports.js'

export class InMemoryIdempotencyStore implements IdempotencyStorePort {
  private readonly records: Map<string, IdempotencyRecord>

  constructor(records: Map<string, IdempotencyRecord> = new Map()) {
    this.records = records
  }

  async claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimResult> {
    if (!validIdempotencyInput(input)) return { status: IDEMPOTENCY_CLAIM_STATUS.FORBIDDEN }
    const key = idempotencyRecordKey(input.tenantId, input.key)
    const existing = this.records.get(key)
    if (!existing) {
      const record = this.newRecord(input)
      this.records.set(key, record)
      return { status: IDEMPOTENCY_CLAIM_STATUS.CLAIMED, record: cloneIdempotencyRecord(record) }
    }
    if (existing.requestHash !== input.requestHash)
      return { status: IDEMPOTENCY_CLAIM_STATUS.CONFLICT, record: cloneIdempotencyRecord(existing) }
    if (existing.status === IDEMPOTENCY_STATUS.COMPLETED && existing.response !== null)
      return {
        status: IDEMPOTENCY_CLAIM_STATUS.REPLAY,
        record: cloneIdempotencyRecord(existing),
        response: structuredClone(existing.response),
      }
    if (existing.status === IDEMPOTENCY_STATUS.PENDING && existing.expiresAt <= input.now) {
      const record = this.newRecord(input)
      this.records.set(key, record)
      return { status: IDEMPOTENCY_CLAIM_STATUS.CLAIMED, record: cloneIdempotencyRecord(record) }
    }
    return {
      status: IDEMPOTENCY_CLAIM_STATUS.IN_PROGRESS,
      record: cloneIdempotencyRecord(existing),
    }
  }

  async complete(input: IdempotencyCompleteInput): Promise<IdempotencyRecord> {
    const record = this.requireOwned(input)
    if (record.status === IDEMPOTENCY_STATUS.COMPLETED) return cloneIdempotencyRecord(record)
    if (record.status !== IDEMPOTENCY_STATUS.PENDING)
      throw new Error('Idempotency record is not pending')
    record.status = IDEMPOTENCY_STATUS.COMPLETED
    record.response = structuredClone(input.response)
    this.records.set(idempotencyRecordKey(input.tenantId, input.key), record)
    return cloneIdempotencyRecord(record)
  }

  async fail(input: IdempotencyFailureInput): Promise<IdempotencyRecord> {
    const record = this.requireOwned(input)
    record.status = IDEMPOTENCY_STATUS.FAILED
    record.response = input.response === undefined ? null : structuredClone(input.response)
    this.records.set(idempotencyRecordKey(input.tenantId, input.key), record)
    return cloneIdempotencyRecord(record)
  }

  async find(tenantId: string, key: string): Promise<IdempotencyRecord | null> {
    const record = this.records.get(idempotencyRecordKey(tenantId, key))
    return record ? cloneIdempotencyRecord(record) : null
  }

  snapshot(): Map<string, IdempotencyRecord> {
    return new Map([...this.records].map(([key, value]) => [key, cloneIdempotencyRecord(value)]))
  }

  replace(records: Map<string, IdempotencyRecord>): void {
    this.records.clear()
    for (const [key, record] of records) this.records.set(key, cloneIdempotencyRecord(record))
  }

  private newRecord(input: IdempotencyClaimInput): IdempotencyRecord {
    return {
      id: input.recordId,
      tenantId: input.tenantId,
      key: input.key,
      requestHash: input.requestHash,
      status: IDEMPOTENCY_STATUS.PENDING,
      response: null,
      createdAt: input.now,
      expiresAt: input.expiresAt,
    }
  }

  private requireOwned(input: IdempotencyClaimInput): IdempotencyRecord {
    const record = this.records.get(idempotencyRecordKey(input.tenantId, input.key))
    if (!record || record.id !== input.recordId || record.requestHash !== input.requestHash)
      throw new Error('Idempotency record does not belong to this tenant and request')
    return record
  }
}

export default { InMemoryIdempotencyStore }
