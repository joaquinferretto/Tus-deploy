import {
  EVENT_STATUS,
  JOB_RESULT_STATUS,
  JOB_STATUS,
  RUN_STATUS,
  JOB_CONTRACT_VERSION,
  EVENT_CONTRACT_VERSION,
  SAGA_STATUS,
  SAGA_STEP_STATUS,
  cloneEvent,
  cloneJob,
  cloneRun,
  cloneSaga,
  eventKey,
  jobKey,
  runIdempotencyKey,
  runLedgerKey,
  type JobRecord,
  type RunEventRecord,
  type StoredRunEventRecord,
  type RunLedgerRecord,
  type SagaRecord,
  type SubmitJobInput,
} from '../domain.js'
import type {
  DurableJobPlatformPort,
  DurableJobTransactionPort,
  EventStorePort,
  JobAcknowledgeInput,
  JobClaimInput,
  JobFailureInput,
  JobReplayInput,
  JobStorePort,
  JobTransportInput,
  JobTransportPort,
  RunLedgerStorePort,
  SagaStorePort,
} from '../ports.js'
import { validSubmit } from '../domain.js'

export class InMemoryJobStore implements JobStorePort {
  private readonly records: Map<string, JobRecord>

  constructor(records = new Map<string, JobRecord>()) {
    this.records = records
  }

  enqueue(input: SubmitJobInput): JobRecord {
    if (!validSubmit(input)) throw new Error('Invalid durable job input')
    const key = jobKey(input.tenantId, input.jobId)
    const existing = this.records.get(key)
    if (existing) return cloneJob(existing)
    const record: JobRecord = {
      contractVersion: JOB_CONTRACT_VERSION,
      jobId: input.jobId,
      tenantId: input.tenantId,
      runId: input.runId,
      jobType: input.jobType,
      payload: structuredClone(input.input),
      status: JOB_STATUS.PENDING,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      availableAt: toIso(input.now),
      createdAt: toIso(input.now),
      claim: null,
      lastError: null,
    }
    this.records.set(key, record)
    return cloneJob(record)
  }

  claim(input: JobClaimInput) {
    const record = this.records.get(jobKey(input.tenantId, input.jobId))
    if (!record) {
      const foreign = [...this.records.values()].some(
        (candidate) => candidate.jobId === input.jobId
      )
      return { status: foreign ? JOB_RESULT_STATUS.FORBIDDEN : JOB_RESULT_STATUS.EMPTY } as const
    }
    if (!input.workerId.trim() || input.leaseMs <= 0)
      throw new Error('Worker and positive lease are required')
    if (record.status === JOB_STATUS.SUCCEEDED) {
      return { status: JOB_RESULT_STATUS.ALREADY_SUCCEEDED, record: cloneJob(record) } as const
    }
    if (record.status === JOB_STATUS.DEAD_LETTER) {
      return { status: JOB_RESULT_STATUS.DEAD_LETTER, record: cloneJob(record) } as const
    }
    if (record.status === JOB_STATUS.CANCELLED) {
      return { status: JOB_RESULT_STATUS.CANCELLED, record: cloneJob(record) } as const
    }
    const leaseExpired =
      record.status === JOB_STATUS.CLAIMED && Date.parse(record.claim?.until ?? '') <= input.now
    if (
      Date.parse(record.availableAt) > input.now ||
      (record.status === JOB_STATUS.CLAIMED && !leaseExpired)
    ) {
      return { status: JOB_RESULT_STATUS.IN_PROGRESS, record: cloneJob(record) } as const
    }
    record.status = JOB_STATUS.CLAIMED
    record.attempts += 1
    record.claim = { workerId: input.workerId, until: toIso(input.now + input.leaseMs) }
    this.records.set(jobKey(input.tenantId, input.jobId), record)
    return { status: JOB_RESULT_STATUS.CLAIMED, record: cloneJob(record) } as const
  }

  acknowledge(input: JobAcknowledgeInput) {
    const record = this.records.get(jobKey(input.tenantId, input.jobId))
    if (!record) {
      const foreign = [...this.records.values()].some(
        (candidate) => candidate.jobId === input.jobId
      )
      return { status: foreign ? JOB_RESULT_STATUS.FORBIDDEN : JOB_RESULT_STATUS.EMPTY } as const
    }
    if (record.status === JOB_STATUS.SUCCEEDED)
      return { status: JOB_RESULT_STATUS.ALREADY_SUCCEEDED, record: cloneJob(record) } as const
    if (record.status !== JOB_STATUS.CLAIMED || record.claim?.workerId !== input.workerId)
      return { status: JOB_RESULT_STATUS.IN_PROGRESS, record: cloneJob(record) } as const
    record.status = JOB_STATUS.SUCCEEDED
    record.claim = null
    this.records.set(jobKey(input.tenantId, input.jobId), record)
    return { status: JOB_RESULT_STATUS.SUCCEEDED, record: cloneJob(record) } as const
  }

  fail(input: JobFailureInput) {
    const record = this.records.get(jobKey(input.tenantId, input.jobId))
    if (!record) {
      const foreign = [...this.records.values()].some(
        (candidate) => candidate.jobId === input.jobId
      )
      return {
        status: foreign ? JOB_RESULT_STATUS.FORBIDDEN : JOB_RESULT_STATUS.EMPTY,
        recoverable: false,
      } as const
    }
    if (record.status !== JOB_STATUS.CLAIMED || record.claim?.workerId !== input.workerId)
      return {
        status: JOB_RESULT_STATUS.IN_PROGRESS,
        record: cloneJob(record),
        recoverable: false,
      } as const
    record.lastError = input.error
    record.claim = null
    if (!input.terminal && record.attempts < record.maxAttempts) {
      record.status = JOB_STATUS.RETRYABLE
      record.availableAt = toIso(input.now + (input.retryDelayMs ?? 100))
      this.records.set(jobKey(input.tenantId, input.jobId), record)
      return {
        status: JOB_RESULT_STATUS.RETRYABLE,
        record: cloneJob(record),
        recoverable: true,
      } as const
    }
    record.status = JOB_STATUS.DEAD_LETTER
    this.records.set(jobKey(input.tenantId, input.jobId), record)
    return {
      status: JOB_RESULT_STATUS.DEAD_LETTER,
      record: cloneJob(record),
      recoverable: true,
    } as const
  }

  recover(input: { tenantId: string; now: number }): JobRecord[] {
    const recovered: JobRecord[] = []
    for (const record of this.records.values()) {
      if (
        record.tenantId === input.tenantId &&
        record.status === JOB_STATUS.CLAIMED &&
        Date.parse(record.claim?.until ?? '') <= input.now
      ) {
        record.status = JOB_STATUS.RETRYABLE
        record.availableAt = toIso(input.now)
        record.claim = null
        this.records.set(jobKey(record.tenantId, record.jobId), record)
        recovered.push(cloneJob(record))
      }
    }
    return recovered
  }

  replay(input: JobReplayInput) {
    const record = this.records.get(jobKey(input.tenantId, input.jobId))
    if (!record) {
      const foreign = [...this.records.values()].some(
        (candidate) => candidate.jobId === input.jobId
      )
      return { status: foreign ? JOB_RESULT_STATUS.FORBIDDEN : JOB_RESULT_STATUS.EMPTY } as const
    }
    if (record.status === JOB_STATUS.PENDING || record.status === JOB_STATUS.RETRYABLE)
      return { status: JOB_RESULT_STATUS.ALREADY_QUEUED, record: cloneJob(record) } as const
    if (record.status !== JOB_STATUS.DEAD_LETTER)
      return { status: JOB_RESULT_STATUS.IN_PROGRESS, record: cloneJob(record) } as const
    record.status = JOB_STATUS.PENDING
    record.availableAt = toIso(input.now)
    record.claim = null
    record.lastError = null
    this.records.set(jobKey(input.tenantId, input.jobId), record)
    return { status: JOB_RESULT_STATUS.REPLAYED, record: cloneJob(record) } as const
  }

  find(tenantId: string, jobId: string): JobRecord | null {
    const record = this.records.get(jobKey(tenantId, jobId))
    return record ? cloneJob(record) : null
  }

  list(tenantId: string): JobRecord[] {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.jobId.localeCompare(right.jobId)
      )
      .map(cloneJob)
  }

  snapshot(): Map<string, JobRecord> {
    return new Map([...this.records].map(([key, value]) => [key, cloneJob(value)]))
  }

  replace(records: Map<string, JobRecord>): void {
    this.records.clear()
    for (const [key, record] of records) this.records.set(key, cloneJob(record))
  }
}

export class InMemoryRunLedgerStore implements RunLedgerStorePort {
  private readonly records: Map<string, RunLedgerRecord>

  constructor(records = new Map<string, RunLedgerRecord>()) {
    this.records = records
  }

  create(input: Parameters<RunLedgerStorePort['create']>[0]): RunLedgerRecord {
    const key = runLedgerKey(input.tenantId, input.id)
    const existing = this.records.get(key)
    if (existing) return cloneRun(existing)
    const record: RunLedgerRecord = {
      id: input.id,
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      runType: input.runType,
      status: RUN_STATUS.QUEUED,
      input: structuredClone(input.input),
      result: null,
      error: null,
      createdAt: input.now,
      updatedAt: input.now,
    }
    this.records.set(key, record)
    return cloneRun(record)
  }

  find(tenantId: string, runId: string): RunLedgerRecord | null {
    const record = this.records.get(runLedgerKey(tenantId, runId))
    return record ? cloneRun(record) : null
  }

  findByIdempotency(tenantId: string, idempotencyKey: string): RunLedgerRecord | null {
    const record = [...this.records.values()].find(
      (candidate) => candidate.tenantId === tenantId && candidate.idempotencyKey === idempotencyKey
    )
    return record ? cloneRun(record) : null
  }

  update(
    tenantId: string,
    runId: string,
    patch: Partial<Pick<RunLedgerRecord, 'status' | 'result' | 'error' | 'updatedAt'>>
  ): RunLedgerRecord {
    const record = this.records.get(runLedgerKey(tenantId, runId))
    if (!record) throw new Error('Run ledger record not found')
    Object.assign(record, structuredClone(patch))
    this.records.set(runLedgerKey(tenantId, runId), record)
    return cloneRun(record)
  }

  list(tenantId: string): RunLedgerRecord[] {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(cloneRun)
  }

  snapshot(): Map<string, RunLedgerRecord> {
    return new Map([...this.records].map(([key, value]) => [key, cloneRun(value)]))
  }

  replace(records: Map<string, RunLedgerRecord>): void {
    this.records.clear()
    for (const [key, record] of records) this.records.set(key, cloneRun(record))
  }
}

export class InMemorySagaStore implements SagaStorePort {
  private readonly records: Map<string, SagaRecord>

  constructor(records = new Map<string, SagaRecord>()) {
    this.records = records
  }

  create(tenantId: string, runId: string, steps: readonly string[], now: number): SagaRecord {
    const key = runLedgerKey(tenantId, runId)
    const existing = this.records.get(key)
    if (existing) return cloneSaga(existing)
    const record: SagaRecord = {
      id: `saga-${runId}`,
      tenantId,
      runId,
      status: SAGA_STATUS.PENDING,
      steps: steps.map((name) => ({ name, status: SAGA_STEP_STATUS.PENDING })),
      updatedAt: now,
    }
    this.records.set(key, record)
    return cloneSaga(record)
  }

  find(tenantId: string, runId: string): SagaRecord | null {
    const record = this.records.get(runLedgerKey(tenantId, runId))
    return record ? cloneSaga(record) : null
  }

  complete(tenantId: string, runId: string, now: number): SagaRecord {
    const record = this.require(tenantId, runId)
    record.status = SAGA_STATUS.COMPLETED
    for (const step of record.steps) step.status = SAGA_STEP_STATUS.COMPLETED
    record.updatedAt = now
    return this.save(record)
  }

  compensate(tenantId: string, runId: string, now: number): SagaRecord {
    const record = this.require(tenantId, runId)
    record.status = SAGA_STATUS.COMPENSATING
    for (const step of [...record.steps].reverse()) step.status = SAGA_STEP_STATUS.COMPENSATED
    record.status = SAGA_STATUS.COMPENSATED
    record.updatedAt = now
    return this.save(record)
  }

  snapshot(): Map<string, SagaRecord> {
    return new Map([...this.records].map(([key, value]) => [key, cloneSaga(value)]))
  }

  replace(records: Map<string, SagaRecord>): void {
    this.records.clear()
    for (const [key, record] of records) this.records.set(key, cloneSaga(record))
  }

  private require(tenantId: string, runId: string): SagaRecord {
    const record = this.records.get(runLedgerKey(tenantId, runId))
    if (!record) throw new Error('Saga record not found')
    return structuredClone(record)
  }

  private save(record: SagaRecord): SagaRecord {
    this.records.set(runLedgerKey(record.tenantId, record.runId), record)
    return cloneSaga(record)
  }
}

export class InMemoryEventStore implements EventStorePort {
  private readonly records: Map<string, StoredRunEventRecord>

  constructor(records = new Map<string, StoredRunEventRecord>()) {
    this.records = records
  }

  append(input: RunEventRecord): StoredRunEventRecord {
    const key = eventKey(input.tenantId, input.eventId)
    const existing = this.records.get(key)
    if (existing) return cloneEvent(existing)
    const record: StoredRunEventRecord = {
      ...structuredClone(input),
      contractVersion: EVENT_CONTRACT_VERSION,
      status: EVENT_STATUS.PENDING,
      claimId: null,
    }
    this.records.set(key, record)
    return cloneEvent(record)
  }

  list(tenantId: string, runId?: string): StoredRunEventRecord[] {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId && (!runId || record.runId === runId))
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.eventId.localeCompare(right.eventId)
      )
      .map(cloneEvent)
  }

  claim(tenantId: string, eventId: string, claimId: string): StoredRunEventRecord | null {
    const record = this.records.get(eventKey(tenantId, eventId))
    if (!record || record.status !== EVENT_STATUS.PENDING) return record ? cloneEvent(record) : null
    record.status = EVENT_STATUS.CLAIMED
    record.claimId = claimId
    this.records.set(eventKey(tenantId, eventId), record)
    return cloneEvent(record)
  }

  publish(tenantId: string, eventId: string, claimId: string): StoredRunEventRecord | null {
    const record = this.records.get(eventKey(tenantId, eventId))
    if (!record || record.status === EVENT_STATUS.PUBLISHED)
      return record ? cloneEvent(record) : null
    if (record.status !== EVENT_STATUS.CLAIMED || record.claimId !== claimId) return null
    record.status = EVENT_STATUS.PUBLISHED
    record.claimId = null
    this.records.set(eventKey(tenantId, eventId), record)
    return cloneEvent(record)
  }

  snapshot(): Map<string, StoredRunEventRecord> {
    return new Map([...this.records].map(([key, value]) => [key, cloneEvent(value)]))
  }

  replace(records: Map<string, StoredRunEventRecord>): void {
    this.records.clear()
    for (const [key, record] of records) this.records.set(key, cloneEvent(record))
  }
}

function toIso(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Job time is required')
  return new Date(value).toISOString()
}

export class InMemoryJobTransport implements JobTransportPort {
  readonly queued: JobTransportInput[] = []

  async enqueue(input: JobTransportInput) {
    this.queued.push({ ...input })
    return { status: 'queued' as const, ...input }
  }
}

export class InMemoryDurableJobPlatform implements DurableJobPlatformPort {
  readonly jobs: InMemoryJobStore
  readonly runs: InMemoryRunLedgerStore
  readonly sagas: InMemorySagaStore
  readonly events: InMemoryEventStore
  private transactionTail: Promise<void> = Promise.resolve()

  constructor(
    jobs = new InMemoryJobStore(),
    runs = new InMemoryRunLedgerStore(),
    sagas = new InMemorySagaStore(),
    events = new InMemoryEventStore()
  ) {
    this.jobs = jobs
    this.runs = runs
    this.sagas = sagas
    this.events = events
  }

  async transaction<TValue>(
    operation: (transaction: DurableJobTransactionPort) => Promise<TValue>
  ): Promise<TValue> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const transaction = new InMemoryDurableJobPlatform(
      new InMemoryJobStore(this.jobs.snapshot()),
      new InMemoryRunLedgerStore(this.runs.snapshot()),
      new InMemorySagaStore(this.sagas.snapshot()),
      new InMemoryEventStore(this.events.snapshot())
    )
    try {
      const result = await operation(transaction)
      this.jobs.replace(transaction.jobs.snapshot())
      this.runs.replace(transaction.runs.snapshot())
      this.sagas.replace(transaction.sagas.snapshot())
      this.events.replace(transaction.events.snapshot())
      return result
    } finally {
      release()
    }
  }
}

export function createInMemoryDurableJobPlatform(): InMemoryDurableJobPlatform {
  return new InMemoryDurableJobPlatform()
}

export default {
  InMemoryJobStore,
  InMemoryRunLedgerStore,
  InMemorySagaStore,
  InMemoryEventStore,
  InMemoryJobTransport,
  InMemoryDurableJobPlatform,
  createInMemoryDurableJobPlatform,
}
