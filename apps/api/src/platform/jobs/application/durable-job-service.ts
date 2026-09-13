import {
  JOB_RESULT_STATUS,
  RUN_STATUS,
  type JobRecord,
  type RunEventRecord,
  type RunLedgerRecord,
  type SagaRecord,
  type SubmitJobInput,
  EVENT_CONTRACT_VERSION,
  toRunEventContract,
  toIsoDateTime,
  validSubmit,
} from '../domain.js'
import type { JsonValue } from '../../idempotency/domain.js'
import type {
  DurableJobPlatformPort,
  DurableJobTransactionPort,
  JobAcknowledgeInput,
  JobClaimInput,
  JobFailureInput,
  JobReplayInput,
  ReconciliationReport,
} from '../ports.js'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../../../tus/readiness/index.ts'

export type SubmitJobResult =
  | { status: 'created'; run: RunLedgerRecord; job: JobRecord }
  | { status: 'replay'; run: RunLedgerRecord; job: JobRecord | null }
  | { status: 'conflict' }

export type ServiceJobClaimResult =
  | { status: 'claimed'; record: JobRecord }
  | {
      status: 'in_progress' | 'empty' | 'forbidden' | 'succeeded' | 'dead_letter' | 'cancelled'
      record?: JobRecord
    }

export type ServiceFailureResult =
  | { status: 'retryable' | 'dead_letter'; recoverable: boolean; record: JobRecord }
  | { status: 'forbidden' | 'in_progress' | 'empty'; recoverable: false; record?: JobRecord }

export class DurableJobService {
  private readonly platform: DurableJobPlatformPort
  private readonly evaluadorHabilitacion?: EvaluadorHabilitacion
  private readonly perfilHabilitacion: PerfilHabilitacion
  private readonly alcanceHabilitacion: string

  constructor(platform: DurableJobPlatformPort, options: { evaluadorHabilitacion?: EvaluadorHabilitacion; perfilHabilitacion?: PerfilHabilitacion; alcanceHabilitacion?: string } = {}) {
    this.platform = platform
    this.evaluadorHabilitacion = options.evaluadorHabilitacion
    this.perfilHabilitacion = options.perfilHabilitacion ?? 'native-local'
    this.alcanceHabilitacion = options.alcanceHabilitacion ?? 'argentina-stage-1'
  }

  async submit(input: SubmitJobInput): Promise<SubmitJobResult> {
    if (!validSubmit(input)) throw new Error('Invalid durable job submission')
    await this.requireReadiness(input.tenantId, `job:${input.jobId}`, `run:${input.runId}`, input.now)
    const existing = this.platform.runs.findByIdempotency(input.tenantId, input.idempotencyKey)
    if (existing) {
      if (existing.requestHash !== input.requestHash) return { status: 'conflict' }
      return {
        status: 'replay',
        run: existing,
        job: this.platform.jobs.find(input.tenantId, input.jobId),
      }
    }

    return this.platform.transaction(async (transaction) => {
      const concurrent = transaction.runs.findByIdempotency(input.tenantId, input.idempotencyKey)
      if (concurrent) {
        if (concurrent.requestHash !== input.requestHash) return { status: 'conflict' as const }
        return {
          status: 'replay' as const,
          run: concurrent,
          job: transaction.jobs.find(input.tenantId, input.jobId),
        }
      }
      const run = transaction.runs.create({
        id: input.runId,
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        runType: input.runType,
        input: input.input,
        now: input.now,
      })
      const job = transaction.jobs.enqueue(input)
      transaction.sagas.create(input.tenantId, input.runId, input.sagaSteps ?? [], input.now)
      this.appendEvent(transaction, input, 'run.queued', { runId: input.runId, jobId: input.jobId })
      return { status: 'created', run, job }
    })
  }

  async claim(input: JobClaimInput): Promise<ServiceJobClaimResult> {
    await this.requireReadiness(input.tenantId, `worker:${input.workerId}`, `job:${input.jobId}`, input.now)
    return this.platform.transaction(async (transaction) => {
      const result = transaction.jobs.claim(input)
      if (result.status !== JOB_RESULT_STATUS.CLAIMED || !result.record)
        return mapClaimResult(result.status, result.record)
      transaction.runs.update(input.tenantId, result.record.runId, {
        status: RUN_STATUS.RUNNING,
        updatedAt: input.now,
      })
      this.appendRunEvent(
        transaction,
        input.tenantId,
        result.record.runId,
        'run.started',
        input.now,
        {
          jobId: result.record.jobId,
          workerId: input.workerId,
          attempt: result.record.attempts,
        }
      )
      return { status: 'claimed', record: result.record }
    })
  }

  async acknowledge(input: JobAcknowledgeInput) {
    await this.requireReadiness(input.tenantId, `worker:${input.workerId}`, `job:${input.jobId}`, input.now)
    return this.platform.transaction(async (transaction) => {
      const result = transaction.jobs.acknowledge(input)
      if (
        result.status === JOB_RESULT_STATUS.FORBIDDEN ||
        result.status === JOB_RESULT_STATUS.EMPTY
      )
        return { status: result.status }
      if (result.status === JOB_RESULT_STATUS.ALREADY_SUCCEEDED) return result
      if (!result.record) return { status: 'in_progress' as const }
      transaction.runs.update(input.tenantId, result.record.runId, {
        status: RUN_STATUS.SUCCEEDED,
        result: input.result,
        error: null,
        updatedAt: input.now,
      })
      transaction.sagas.complete(input.tenantId, result.record.runId, input.now)
      this.appendRunEvent(
        transaction,
        input.tenantId,
        result.record.runId,
        'run.succeeded',
        input.now,
        {
          jobId: result.record.jobId,
        }
      )
      return { status: 'succeeded' as const, record: result.record }
    })
  }

  async fail(input: JobFailureInput): Promise<ServiceFailureResult> {
    await this.requireReadiness(input.tenantId, `worker:${input.workerId}`, `job:${input.jobId}`, input.now)
    return this.platform.transaction(async (transaction) => {
      const result = transaction.jobs.fail(input)
      if (
        result.status !== JOB_RESULT_STATUS.RETRYABLE &&
        result.status !== JOB_RESULT_STATUS.DEAD_LETTER
      ) {
        const status =
          result.status === JOB_RESULT_STATUS.FORBIDDEN ||
          result.status === JOB_RESULT_STATUS.IN_PROGRESS ||
          result.status === JOB_RESULT_STATUS.EMPTY
            ? result.status
            : JOB_RESULT_STATUS.EMPTY
        return { status, recoverable: false, record: result.record }
      }
      if (!result.record) return { status: 'empty', recoverable: false }
      transaction.runs.update(input.tenantId, result.record.runId, {
        status: RUN_STATUS.RECOVERABLE,
        error: { message: input.error },
        updatedAt: input.now,
      })
      if (result.status === JOB_RESULT_STATUS.DEAD_LETTER) {
        transaction.sagas.compensate(input.tenantId, result.record.runId, input.now)
      }
      this.appendRunEvent(
        transaction,
        input.tenantId,
        result.record.runId,
        result.status === JOB_RESULT_STATUS.DEAD_LETTER ? 'run.recoverable' : 'run.retryable',
        input.now,
        { jobId: result.record.jobId, error: input.error, attempts: result.record.attempts }
      )
      return {
        status: result.status === JOB_RESULT_STATUS.DEAD_LETTER ? 'dead_letter' : 'retryable',
        recoverable: result.recoverable,
        record: result.record,
      }
    })
  }

  async replay(input: JobReplayInput) {
    await this.requireReadiness(input.tenantId, `replayer:${input.jobId}`, `job:${input.jobId}`, input.now)
    return this.platform.transaction(async (transaction) => {
      const result = transaction.jobs.replay(input)
      if (result.status !== JOB_RESULT_STATUS.REPLAYED || !result.record) {
        return { status: result.status, record: result.record }
      }
      transaction.runs.update(input.tenantId, result.record.runId, {
        status: RUN_STATUS.REPLAYING,
        error: null,
        updatedAt: input.now,
      })
      this.appendRunEvent(
        transaction,
        input.tenantId,
        result.record.runId,
        'run.replayed',
        input.now,
        {
          jobId: result.record.jobId,
        }
      )
      return { status: 'replayed' as const, record: result.record }
    })
  }

  async reconcile(input: { tenantId: string; now: number }): Promise<ReconciliationReport> {
    await this.requireReadiness(input.tenantId, 'reconciler', `reconcile:${input.tenantId}`, input.now)
    return this.platform.transaction(async (transaction) => {
      const recovered = transaction.jobs.recover(input)
      const recoveredRunIds = new Set<string>()
      for (const job of recovered) {
        const run = transaction.runs.find(input.tenantId, job.runId)
        if (!run || run.status === RUN_STATUS.SUCCEEDED || run.status === RUN_STATUS.CANCELLED)
          continue
        transaction.runs.update(input.tenantId, job.runId, {
          status: RUN_STATUS.RECOVERABLE,
          error: { message: 'Worker lease expired before acknowledgement' },
          updatedAt: input.now,
        })
        recoveredRunIds.add(job.runId)
        this.appendRunEvent(transaction, input.tenantId, job.runId, 'run.recovered', input.now, {
          jobId: job.jobId,
          attempts: job.attempts,
        })
      }
      const runs = transaction.runs.list(input.tenantId)
      const events = transaction.events.list(input.tenantId)
      return {
        recoveredJobs: recovered.length,
        recoverableRuns: recoveredRunIds.size,
        pendingEvents: events.filter((event) => event.status !== 'published').length,
        status: recovered.length || recoveredRunIds.size ? 'recovered' : 'clean',
        runStatuses: countStatuses(runs, (run) => run.status),
        eventStatuses: countStatuses(events, (event) => event.status),
      }
    })
  }

  private appendEvent(
    transaction: DurableJobTransactionPort,
    input: SubmitJobInput,
    type: string,
    payload: JsonValue
  ): RunEventRecord {
    return this.appendRunEvent(transaction, input.tenantId, input.runId, type, input.now, payload)
  }

  private requireReadiness(tenantId: string, actorId: string, correlationId: string, now: number): Promise<unknown> {
    return this.evaluadorHabilitacion?.require({ tenantId, actorId, correlationId, capability: 'release-jobs', profile: this.perfilHabilitacion, scope: this.alcanceHabilitacion, now: new Date(now).toISOString() }) ?? Promise.resolve()
  }

  private appendRunEvent(
    transaction: DurableJobTransactionPort,
    tenantId: string,
    runId: string,
    type: string,
    now: number,
    payload: JsonValue
  ): RunEventRecord {
    return toRunEventContract(
      transaction.events.append({
        contractVersion: EVENT_CONTRACT_VERSION,
        eventId: `event-${runId}-${type}`,
        tenantId,
        runId,
        type,
        payload: structuredClone(payload),
        createdAt: toIsoDateTime(now),
      })
    )
  }
}

function mapClaimResult(status: string, record?: JobRecord): ServiceJobClaimResult {
  if (status === JOB_RESULT_STATUS.ALREADY_SUCCEEDED) return { status: 'succeeded', record }
  if (status === JOB_RESULT_STATUS.DEAD_LETTER) return { status: 'dead_letter', record }
  if (status === JOB_RESULT_STATUS.CANCELLED) return { status: 'cancelled', record }
  if (status === JOB_RESULT_STATUS.FORBIDDEN) return { status: 'forbidden' }
  if (status === JOB_RESULT_STATUS.EMPTY) return { status: 'empty' }
  return { status: 'in_progress', record }
}

function countStatuses<TValue, TStatus extends string>(
  values: readonly TValue[],
  getStatus: (value: TValue) => TStatus
): Readonly<Record<TStatus, number>> {
  const counts = {} as Record<TStatus, number>
  for (const value of values) {
    const status = getStatus(value)
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

export default { DurableJobService }
