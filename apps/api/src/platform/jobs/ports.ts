import type {
  EventStatus,
  JobRecord,
  RunEventRecord,
  StoredRunEventRecord,
  RunLedgerRecord,
  RunStatus,
  SagaRecord,
  SubmitJobInput,
} from './domain.js'
import type { JobResultStatus } from './domain.js'
import type { JsonValue } from '../idempotency/domain.js'

export interface JobClaimInput {
  tenantId: string
  jobId: string
  workerId: string
  now: number
  leaseMs: number
}

export interface JobAcknowledgeInput {
  tenantId: string
  jobId: string
  workerId: string
  now: number
  result: JsonValue
}

export interface JobFailureInput {
  tenantId: string
  jobId: string
  workerId: string
  now: number
  error: string
  retryDelayMs?: number
  terminal?: boolean
}

export interface JobRecoveryInput {
  tenantId: string
  now: number
}

export interface JobReplayInput {
  tenantId: string
  jobId: string
  now: number
}

export interface JobClaimResult {
  status: JobResultStatus
  record?: JobRecord
}

export interface JobFailureResult {
  status: JobResultStatus
  record?: JobRecord
  recoverable: boolean
}

export interface JobStorePort {
  enqueue(input: SubmitJobInput): JobRecord
  claim(input: JobClaimInput): JobClaimResult
  acknowledge(input: JobAcknowledgeInput): { status: JobResultStatus; record?: JobRecord }
  fail(input: JobFailureInput): JobFailureResult
  recover(input: JobRecoveryInput): JobRecord[]
  replay(input: JobReplayInput): { status: JobResultStatus; record?: JobRecord }
  find(tenantId: string, jobId: string): JobRecord | null
  list(tenantId: string): JobRecord[]
  snapshot(): Map<string, JobRecord>
  replace(records: Map<string, JobRecord>): void
}

export interface RunLedgerStorePort {
  create(input: {
    id: string
    tenantId: string
    idempotencyKey: string
    requestHash: string
    runType: string
    input: JsonValue
    now: number
  }): RunLedgerRecord
  find(tenantId: string, runId: string): RunLedgerRecord | null
  findByIdempotency(tenantId: string, idempotencyKey: string): RunLedgerRecord | null
  update(
    tenantId: string,
    runId: string,
    patch: Partial<Pick<RunLedgerRecord, 'status' | 'result' | 'error' | 'updatedAt'>>
  ): RunLedgerRecord
  list(tenantId: string): RunLedgerRecord[]
  snapshot(): Map<string, RunLedgerRecord>
  replace(records: Map<string, RunLedgerRecord>): void
}

export interface SagaStorePort {
  create(tenantId: string, runId: string, steps: readonly string[], now: number): SagaRecord
  find(tenantId: string, runId: string): SagaRecord | null
  complete(tenantId: string, runId: string, now: number): SagaRecord
  compensate(tenantId: string, runId: string, now: number): SagaRecord
  snapshot(): Map<string, SagaRecord>
  replace(records: Map<string, SagaRecord>): void
}

export interface EventStorePort {
  append(input: RunEventRecord): StoredRunEventRecord
  list(tenantId: string, runId?: string): StoredRunEventRecord[]
  claim(tenantId: string, eventId: string, claimId: string): StoredRunEventRecord | null
  publish(tenantId: string, eventId: string, claimId: string): StoredRunEventRecord | null
  snapshot(): Map<string, StoredRunEventRecord>
  replace(records: Map<string, StoredRunEventRecord>): void
}

export interface JobTransportInput {
  tenantId: string
  jobId: string
}

export interface JobTransportPort {
  enqueue(input: JobTransportInput): Promise<{ status: 'queued'; tenantId: string; jobId: string }>
}

export interface DurableJobTransactionPort {
  jobs: JobStorePort
  runs: RunLedgerStorePort
  sagas: SagaStorePort
  events: EventStorePort
}

export interface DurableJobPlatformPort extends DurableJobTransactionPort {
  transaction<TValue>(
    operation: (transaction: DurableJobTransactionPort) => Promise<TValue>
  ): Promise<TValue>
}

export interface ReconciliationReport {
  recoveredJobs: number
  recoverableRuns: number
  pendingEvents: number
  status: 'clean' | 'recovered'
  runStatuses: Readonly<Record<RunStatus, number>>
  eventStatuses: Readonly<Record<EventStatus, number>>
}

export default {}
