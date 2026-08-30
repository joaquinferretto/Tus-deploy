import type { JsonValue } from '../idempotency/domain.js'

export const JOB_STATUS = {
  PENDING: 'pending',
  CLAIMED: 'claimed',
  RETRYABLE: 'retryable',
  SUCCEEDED: 'succeeded',
  DEAD_LETTER: 'dead_letter',
  CANCELLED: 'cancelled',
} as const

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS]

export const JOB_RESULT_STATUS = {
  CREATED: 'created',
  CLAIMED: 'claimed',
  IN_PROGRESS: 'in_progress',
  EMPTY: 'empty',
  FORBIDDEN: 'forbidden',
  SUCCEEDED: 'succeeded',
  ALREADY_SUCCEEDED: 'already_succeeded',
  RETRYABLE: 'retryable',
  DEAD_LETTER: 'dead_letter',
  CANCELLED: 'cancelled',
  REPLAYED: 'replayed',
  ALREADY_QUEUED: 'already_queued',
} as const

export type JobResultStatus = (typeof JOB_RESULT_STATUS)[keyof typeof JOB_RESULT_STATUS]

export const RUN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  REPLAYING: 'replaying',
  SUCCEEDED: 'succeeded',
  RECOVERABLE: 'recoverable',
  CANCELLED: 'cancelled',
} as const

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS]

export const SAGA_STATUS = {
  PENDING: 'pending',
  COMPENSATING: 'compensating',
  COMPENSATED: 'compensated',
  COMPLETED: 'completed',
} as const

export type SagaStatus = (typeof SAGA_STATUS)[keyof typeof SAGA_STATUS]

export const SAGA_STEP_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  COMPENSATED: 'compensated',
} as const

export type SagaStepStatus = (typeof SAGA_STEP_STATUS)[keyof typeof SAGA_STEP_STATUS]

export const EVENT_STATUS = {
  PENDING: 'pending',
  CLAIMED: 'claimed',
  PUBLISHED: 'published',
} as const

export type EventStatus = (typeof EVENT_STATUS)[keyof typeof EVENT_STATUS]

export const JOB_CONTRACT_VERSION = '1.0.0' as const
export const EVENT_CONTRACT_VERSION = '1.0.0' as const

export interface SubmitJobInput {
  tenantId: string
  jobId: string
  runId: string
  idempotencyKey: string
  requestHash: string
  runType: string
  jobType: string
  input: JsonValue
  maxAttempts: number
  now: number
  sagaSteps?: readonly string[]
}

export interface JobRecord {
  contractVersion: typeof JOB_CONTRACT_VERSION
  jobId: string
  tenantId: string
  runId: string
  jobType: string
  payload: JsonValue
  status: JobStatus
  attempts: number
  maxAttempts: number
  availableAt: string
  createdAt: string
  claim: JobClaim | null
  lastError: string | null
}

export interface JobClaim {
  workerId: string
  until: string
}

export interface RunLedgerRecord {
  id: string
  tenantId: string
  idempotencyKey: string
  requestHash: string
  runType: string
  status: RunStatus
  input: JsonValue
  result: JsonValue | null
  error: JsonValue | null
  createdAt: number
  updatedAt: number
}

export interface SagaStep {
  name: string
  status: SagaStepStatus
}

export interface SagaRecord {
  id: string
  tenantId: string
  runId: string
  status: SagaStatus
  steps: SagaStep[]
  updatedAt: number
}

export interface RunEventRecord {
  contractVersion: typeof EVENT_CONTRACT_VERSION
  eventId: string
  tenantId: string
  runId: string
  type: string
  payload: JsonValue
  createdAt: string
}

export interface StoredRunEventRecord extends RunEventRecord {
  status: EventStatus
  claimId: string | null
}

export type RunEventContract = RunEventRecord

export function runLedgerKey(tenantId: string, runId: string): string {
  return `${tenantId}:${runId}`
}

export function runIdempotencyKey(tenantId: string, idempotencyKey: string): string {
  return `${tenantId}:${idempotencyKey}`
}

export function jobKey(tenantId: string, jobId: string): string {
  return `${tenantId}:${jobId}`
}

export function eventKey(tenantId: string, eventId: string): string {
  return `${tenantId}:${eventId}`
}

export function cloneJob(record: JobRecord): JobRecord {
  return structuredClone(record)
}

export function cloneRun(record: RunLedgerRecord): RunLedgerRecord {
  return structuredClone(record)
}

export function cloneSaga(record: SagaRecord): SagaRecord {
  return structuredClone(record)
}

export function cloneEvent(record: StoredRunEventRecord): StoredRunEventRecord {
  return structuredClone(record)
}

export function toIsoDateTime(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Job time is required')
  return new Date(value).toISOString()
}

export function toDurableJobContract(record: JobRecord): JobRecord {
  return cloneJob(record)
}

export function toRunEventContract(record: StoredRunEventRecord): RunEventContract {
  const { status: _status, claimId: _claimId, ...contract } = cloneEvent(record)
  return contract
}

export function validSubmit(input: SubmitJobInput): boolean {
  return Boolean(
    input.tenantId.trim() &&
    input.jobId.trim() &&
    input.runId.trim() &&
    input.idempotencyKey.trim() &&
    input.requestHash.trim() &&
    input.runType.trim() &&
    input.jobType.trim() &&
    Number.isFinite(input.now) &&
    Number.isInteger(input.maxAttempts) &&
    input.maxAttempts > 0
  )
}

export default {
  JOB_STATUS,
  JOB_RESULT_STATUS,
  RUN_STATUS,
  SAGA_STATUS,
  SAGA_STEP_STATUS,
  EVENT_STATUS,
  JOB_CONTRACT_VERSION,
  EVENT_CONTRACT_VERSION,
  runLedgerKey,
  runIdempotencyKey,
  jobKey,
  eventKey,
  validSubmit,
  toDurableJobContract,
  toRunEventContract,
  toIsoDateTime,
}
