import type { Compromiso } from '@factory/contracts'
import {
  TUS_OUTBOX_STATUSES,
  type ReferenciaAuditoria,
  type PuertoReferenciasAuditoria,
  type TusCheckoutResponse,
  type TusCommitmentCompensation,
  type TusCommitmentCompensationStorePort,
  type TusCommitmentStorePort,
  type TusIdempotencyClaim,
  type TusIdempotencyStorePort,
  type TusOutboxRecord,
  type TusOutboxStatus,
  type TusOutboxStorePort,
  type TusAuthenticatedTenantContext,
  type TusSessionResolverPort,
  type TusTransactionPort,
  type TusTransactionRepositories,
} from '../ports/index.ts'
/*
  ReferenciaAuditoria,
  PuertoReferenciasAuditoria,
  TusCheckoutResponse,
  TusCommitmentCompensation,
  TusCommitmentCompensationStorePort,
  TusCommitmentStorePort,
  TusIdempotencyClaim,
  TusIdempotencyStorePort,
  TusOutboxRecord,
  TusOutboxStatus,
  TUS_OUTBOX_STATUSES,
  TusOutboxStorePort,
  TusAuthenticatedTenantContext,
  TusSessionResolverPort,
  TusTransactionPort,
  TusTransactionRepositories,
*/

interface TusIdempotencyRecord {
  tenantId: string
  key: string
  requestHash: string
  expiresAt: number
  response: TusCheckoutResponse | null
}

export class InMemoryTusCommitmentStore implements TusCommitmentStorePort {
  private readonly commitments = new Map<string, Compromiso>()

  async saveMany(commitments: readonly Compromiso[]): Promise<void> {
    for (const commitment of commitments) {
      this.commitments.set(commitmentKey(commitment.tenantId, commitment.commitmentId), structuredClone(commitment))
    }
  }

  async find(commitmentId: string): Promise<Compromiso | null> {
    const commitment = [...this.commitments.values()].find((candidate) => candidate.commitmentId === commitmentId)
    return commitment ? structuredClone(commitment) : null
  }

  async update(input: { tenantId: string; commitmentId: string; expectedVersion: number; commitment: Compromiso }): Promise<Compromiso | null> {
    const key = commitmentKey(input.tenantId, input.commitmentId)
    const current = this.commitments.get(key)
    if (!current || current.version !== input.expectedVersion) return null
    const updated = structuredClone(input.commitment)
    this.commitments.set(key, updated)
    return structuredClone(updated)
  }

  snapshot(): Map<string, Compromiso> {
    return new Map([...this.commitments].map(([key, value]) => [key, structuredClone(value)]))
  }

  restore(snapshot: Map<string, Compromiso>): void {
    this.commitments.clear()
    for (const [key, value] of snapshot) this.commitments.set(key, structuredClone(value))
  }
}

export class InMemoryTusCompensationStore implements TusCommitmentCompensationStorePort {
  private readonly compensations = new Map<string, TusCommitmentCompensation>()

  async save(compensation: TusCommitmentCompensation): Promise<void> {
    const key = commitmentKey(compensation.tenantId, compensation.commitmentId)
    if (!this.compensations.has(key)) this.compensations.set(key, structuredClone(compensation))
  }

  async find(tenantId: string, commitmentId: string): Promise<TusCommitmentCompensation | null> {
    const compensation = this.compensations.get(commitmentKey(tenantId, commitmentId))
    return compensation ? structuredClone(compensation) : null
  }

  snapshot(): Map<string, TusCommitmentCompensation> {
    return new Map([...this.compensations].map(([key, value]) => [key, structuredClone(value)]))
  }

  restore(snapshot: Map<string, TusCommitmentCompensation>): void {
    this.compensations.clear()
    for (const [key, value] of snapshot) this.compensations.set(key, structuredClone(value))
  }
}

export class AlmacenReferenciasAuditoriaEnMemoria implements PuertoReferenciasAuditoria {
  private readonly references = new Map<string, ReferenciaAuditoria>()

  async append(references: readonly ReferenciaAuditoria[]): Promise<void> {
    for (const reference of references) {
      this.references.set(referenceKey(reference.tenantId, reference.referenceId), structuredClone(reference))
    }
  }

  list(tenantId: string): ReferenciaAuditoria[] {
    return [...this.references.values()]
      .filter((reference) => reference.tenantId === tenantId)
      .map((reference) => structuredClone(reference))
  }

  snapshot(): Map<string, ReferenciaAuditoria> {
    return new Map([...this.references].map(([key, value]) => [key, structuredClone(value)]))
  }

  restore(snapshot: Map<string, ReferenciaAuditoria>): void {
    this.references.clear()
    for (const [key, value] of snapshot) this.references.set(key, structuredClone(value))
  }
}

export class InMemoryTusOutboxStore implements TusOutboxStorePort {
  private readonly records = new Map<string, TusOutboxRecord>()

  async append(record: TusOutboxRecord): Promise<void> {
    if (!this.records.has(eventKey(record.tenantId, record.eventId))) {
      this.records.set(eventKey(record.tenantId, record.eventId), normalizeOutboxRecord(record))
    }
  }

  list(tenantId: string): TusOutboxRecord[] {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .map((record) => structuredClone(record))
  }

  async claim(tenantId: string, workerId: string, now: number, leaseMs: number): Promise<TusOutboxRecord | null> {
    const candidate = [...this.records.values()].find((record) => record.tenantId === tenantId
      && record.status === TUS_OUTBOX_STATUSES.PENDING
      && (record.availableAt ?? record.createdAt) <= now)
    if (!candidate) return null
    const claimId = `${workerId}:${candidate.eventId}:${(candidate.attempts ?? 0) + 1}`
    const claimed = { ...candidate, status: TUS_OUTBOX_STATUSES.PROCESSING, attempts: (candidate.attempts ?? 0) + 1, claimId, claimUntil: now + leaseMs }
    this.records.set(eventKey(tenantId, candidate.eventId), claimed)
    return structuredClone(claimed)
  }

  async acknowledge(input: { tenantId: string; eventId: string; claimId: string; publishedAt: number }): Promise<boolean> {
    const key = eventKey(input.tenantId, input.eventId)
    const record = this.records.get(key)
    if (!record || record.status !== TUS_OUTBOX_STATUSES.PROCESSING || record.claimId !== input.claimId) return false
    this.records.set(key, { ...record, status: TUS_OUTBOX_STATUSES.PUBLISHED, claimId: null, claimUntil: null, publishedAt: input.publishedAt })
    return true
  }

  async fail(input: { tenantId: string; eventId: string; claimId: string; error: string; now: number; maxAttempts: number }): Promise<TusOutboxStatus> {
    const key = eventKey(input.tenantId, input.eventId)
    const record = this.records.get(key)
    if (!record || record.status !== TUS_OUTBOX_STATUSES.PROCESSING || record.claimId !== input.claimId) return TUS_OUTBOX_STATUSES.DEAD_LETTER
    const status = (record.attempts ?? 0) >= input.maxAttempts ? TUS_OUTBOX_STATUSES.DEAD_LETTER : TUS_OUTBOX_STATUSES.PENDING
    this.records.set(key, { ...record, status, lastError: input.error, availableAt: input.now + Math.min(60_000, 100 * 2 ** Math.max(0, (record.attempts ?? 1) - 1)), claimId: null, claimUntil: null })
    return status
  }

  async recover(now: number): Promise<number> {
    let recovered = 0
    for (const [key, record] of this.records) {
      if (record.status !== TUS_OUTBOX_STATUSES.PROCESSING || (record.claimUntil ?? Number.POSITIVE_INFINITY) > now) continue
      this.records.set(key, { ...record, status: TUS_OUTBOX_STATUSES.PENDING, claimId: null, claimUntil: null, availableAt: now })
      recovered += 1
    }
    return recovered
  }

  snapshot(): Map<string, TusOutboxRecord> {
    return new Map([...this.records].map(([key, value]) => [key, structuredClone(value)]))
  }

  restore(snapshot: Map<string, TusOutboxRecord>): void {
    this.records.clear()
    for (const [key, value] of snapshot) this.records.set(key, structuredClone(value))
  }
}

function normalizeOutboxRecord(record: TusOutboxRecord): TusOutboxRecord {
  return structuredClone({
    ...record,
    status: record.status ?? TUS_OUTBOX_STATUSES.PENDING,
    attempts: record.attempts ?? 0,
    availableAt: record.availableAt ?? record.createdAt,
    lastError: record.lastError ?? null,
    claimId: record.claimId ?? null,
    claimUntil: record.claimUntil ?? null,
    publishedAt: record.publishedAt ?? null,
  })
}

function commitmentKey(tenantId: string, commitmentId: string): string {
  return `${tenantId}:${commitmentId}`
}

function referenceKey(tenantId: string, referenceId: string): string {
  return `${tenantId}:${referenceId}`
}

function eventKey(tenantId: string, eventId: string): string {
  return `${tenantId}:${eventId}`
}

export class InMemoryTusIdempotencyStore implements TusIdempotencyStorePort {
  private readonly records = new Map<string, TusIdempotencyRecord>()

  async claim(input: {
    tenantId: string
    key: string
    requestHash: string
    now: number
    expiresAt: number
  }): Promise<TusIdempotencyClaim> {
    const recordKey = `${input.tenantId}:${input.key}`
    const existing = this.records.get(recordKey)
    const foreignRecord = [...this.records.values()].find((candidate) => candidate.key === input.key && candidate.tenantId !== input.tenantId)
    if (foreignRecord) return { status: 'conflict' }
    if (!existing || (existing.response === null && existing.expiresAt <= input.now)) {
      this.records.set(recordKey, { ...input, response: null })
      return { status: 'claimed' }
    }
    if (existing.requestHash !== input.requestHash) return { status: 'conflict' }
    if (existing.response !== null) return { status: 'replay', response: structuredClone(existing.response) }
    return { status: 'in_progress' }
  }

  async complete(input: { tenantId: string; key: string; response: TusCheckoutResponse }): Promise<void> {
    const record = this.records.get(`${input.tenantId}:${input.key}`)
    if (!record) throw new Error('TUS idempotency record not found')
    record.response = structuredClone(input.response)
  }

  async release(input: { tenantId: string; key: string }): Promise<void> {
    this.records.delete(`${input.tenantId}:${input.key}`)
  }

  snapshot(): Map<string, TusIdempotencyRecord> {
    return new Map([...this.records].map(([key, value]) => [key, structuredClone(value)]))
  }

  restore(snapshot: Map<string, TusIdempotencyRecord>): void {
    this.records.clear()
    for (const [key, value] of snapshot) this.records.set(key, structuredClone(value))
  }
}

export class InMemoryTusTransaction implements TusTransactionPort {
  private transactionTail: Promise<void> = Promise.resolve()
  private readonly repositories: SnapshotableTusTransactionRepositories

  constructor(repositories: Omit<SnapshotableTusTransactionRepositories, 'compensations'> & { compensations?: InMemoryTusCompensationStore }) {
    this.repositories = { ...repositories, compensations: repositories.compensations ?? new InMemoryTusCompensationStore() }
  }

  async run<TValue>(operation: (repositories: TusTransactionRepositories) => Promise<TValue>): Promise<TValue> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous

    const snapshots = {
      commitments: this.repositories.commitments.snapshot(),
      audits: this.repositories.audits.snapshot(),
      idempotency: this.repositories.idempotency.snapshot(),
      outbox: this.repositories.outbox.snapshot(),
      compensations: this.repositories.compensations.snapshot(),
    }
    try {
      return await operation(this.repositories)
    } catch (error) {
      this.repositories.commitments.restore(snapshots.commitments)
      this.repositories.audits.restore(snapshots.audits)
      this.repositories.idempotency.restore(snapshots.idempotency)
      this.repositories.outbox.restore(snapshots.outbox)
      this.repositories.compensations.restore(snapshots.compensations)
      throw error
    } finally {
      release()
    }
  }
}

type SnapshotableTusTransactionRepositories = TusTransactionRepositories & {
  commitments: InMemoryTusCommitmentStore
  audits: AlmacenReferenciasAuditoriaEnMemoria
  idempotency: InMemoryTusIdempotencyStore
  outbox: InMemoryTusOutboxStore
  compensations: InMemoryTusCompensationStore
}

export class InMemoryTusSessionResolver implements TusSessionResolverPort {
  private readonly sessions = new Map<string, TusAuthenticatedTenantContext>()

  add(accessToken: string, context: TusAuthenticatedTenantContext): void {
    this.sessions.set(accessToken, structuredClone(context))
  }

  async resolve(accessToken: string, correlationId: string): Promise<TusAuthenticatedTenantContext | null> {
    const context = this.sessions.get(accessToken)
    if (!context) return null
    return { ...structuredClone(context), correlationId }
  }
}

export default {
  AlmacenReferenciasAuditoriaEnMemoria,
  InMemoryTusCommitmentStore,
  InMemoryTusCompensationStore,
  InMemoryTusIdempotencyStore,
  InMemoryTusOutboxStore,
  InMemoryTusSessionResolver,
  InMemoryTusTransaction,
}
