import {
  OUTBOX_RESULT_STATUS,
  OUTBOX_STATUS,
  cloneOutboxRecord,
  outboxRecordKey,
  validOutboxEvent,
  type OutboxClaimInput,
  type OutboxClaimResult,
  type OutboxEventInput,
  type OutboxPublishInput,
  type OutboxPublishResult,
  type OutboxRecord,
  type OutboxRecoveryInput,
} from '../domain.js'
import type { OutboxStorePort } from '../ports.js'

export class InMemoryOutboxStore implements OutboxStorePort {
  private readonly records: Map<string, OutboxRecord>

  constructor(records: Map<string, OutboxRecord> = new Map()) {
    this.records = records
  }

  async append(input: OutboxEventInput): Promise<OutboxRecord> {
    if (!validOutboxEvent(input)) throw new Error('Invalid outbox event')
    const key = outboxRecordKey(input.tenantId, input.id)
    const existing = this.records.get(key)
    if (existing) return cloneOutboxRecord(existing)
    const record: OutboxRecord = {
      ...structuredClone(input),
      status: OUTBOX_STATUS.PENDING,
      attempts: 0,
      lastError: null,
      publishedAt: null,
      claimId: null,
      claimUntil: null,
    }
    this.records.set(key, record)
    return cloneOutboxRecord(record)
  }

  async claim(input: OutboxClaimInput): Promise<OutboxClaimResult> {
    const record = this.findRecord(input.tenantId, input.eventId)
    if (!record) {
      const foreign = [...this.records.values()].find((candidate) => candidate.id === input.eventId)
      return foreign
        ? { status: OUTBOX_RESULT_STATUS.FORBIDDEN }
        : { status: OUTBOX_RESULT_STATUS.EMPTY }
    }
    if (record.status === OUTBOX_STATUS.PUBLISHED)
      return { status: OUTBOX_RESULT_STATUS.ALREADY_PUBLISHED, record: cloneOutboxRecord(record) }
    if (record.availableAt > input.now)
      return { status: OUTBOX_RESULT_STATUS.IN_PROGRESS, record: cloneOutboxRecord(record) }
    const leaseExpired =
      record.status === OUTBOX_STATUS.CLAIMED && (record.claimUntil ?? Infinity) <= input.now
    if (record.status === OUTBOX_STATUS.CLAIMED && !leaseExpired)
      return { status: OUTBOX_RESULT_STATUS.IN_PROGRESS, record: cloneOutboxRecord(record) }
    record.status = OUTBOX_STATUS.CLAIMED
    record.attempts += 1
    record.claimId = input.claimId
    record.claimUntil = input.now + input.leaseMs
    this.records.set(outboxRecordKey(input.tenantId, input.eventId), record)
    return { status: OUTBOX_RESULT_STATUS.CLAIMED, record: cloneOutboxRecord(record) }
  }

  async publish(input: OutboxPublishInput): Promise<OutboxPublishResult> {
    const record = this.findRecord(input.tenantId, input.eventId)
    if (!record) throw new Error('Outbox event not found for tenant')
    if (record.status === OUTBOX_STATUS.PUBLISHED)
      return { status: OUTBOX_RESULT_STATUS.ALREADY_PUBLISHED, record: cloneOutboxRecord(record) }
    if (record.status !== OUTBOX_STATUS.CLAIMED || record.claimId !== input.claimId)
      throw new Error('Outbox claim is not owned by publisher')
    record.status = OUTBOX_STATUS.PUBLISHED
    record.publishedAt = input.now
    record.claimId = null
    record.claimUntil = null
    this.records.set(outboxRecordKey(input.tenantId, input.eventId), record)
    return { status: OUTBOX_RESULT_STATUS.PUBLISHED, record: cloneOutboxRecord(record) }
  }

  async recover(input: OutboxRecoveryInput): Promise<number> {
    let recovered = 0
    for (const record of this.records.values()) {
      if (
        record.tenantId === input.tenantId &&
        record.status === OUTBOX_STATUS.CLAIMED &&
        (record.claimUntil ?? Infinity) <= input.now
      ) {
        record.status = OUTBOX_STATUS.PENDING
        record.claimId = null
        record.claimUntil = null
        recovered += 1
      }
    }
    return recovered
  }

  async find(tenantId: string, eventId: string): Promise<OutboxRecord | null> {
    const record = this.findRecord(tenantId, eventId)
    return record ? cloneOutboxRecord(record) : null
  }

  list(tenantId: string): OutboxRecord[] {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(cloneOutboxRecord)
  }

  snapshot(): Map<string, OutboxRecord> {
    return new Map([...this.records].map(([key, value]) => [key, cloneOutboxRecord(value)]))
  }

  replace(records: Map<string, OutboxRecord>): void {
    this.records.clear()
    for (const [key, record] of records) this.records.set(key, cloneOutboxRecord(record))
  }

  private findRecord(tenantId: string, eventId: string): OutboxRecord | undefined {
    return this.records.get(outboxRecordKey(tenantId, eventId))
  }
}

export default { InMemoryOutboxStore }
