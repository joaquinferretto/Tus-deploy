export const WORKFLOW_CONTRACT_VERSION = '1.0.0' as const

export const WORKFLOW_MESSAGE_TYPE = {
  REQUEST: 'workflow.request',
  PROGRESS: 'workflow.progress',
  RESULT: 'workflow.result',
} as const

export type WorkflowMessageType = (typeof WORKFLOW_MESSAGE_TYPE)[keyof typeof WORKFLOW_MESSAGE_TYPE]

export const WORKFLOW_PROGRESS_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

export type WorkflowProgressStatus =
  (typeof WORKFLOW_PROGRESS_STATUS)[keyof typeof WORKFLOW_PROGRESS_STATUS]

export const WORKFLOW_RESULT_STATUS = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

export type WorkflowResultStatus =
  (typeof WORKFLOW_RESULT_STATUS)[keyof typeof WORKFLOW_RESULT_STATUS]

export interface WorkflowLineage {
  rootMessageId: string
  parentMessageId?: string
  source: string
}

export interface WorkflowMessageBase {
  contractVersion: typeof WORKFLOW_CONTRACT_VERSION
  messageId: string
  messageType: WorkflowMessageType
  workflowId: string
  runId: string
  tenantId: string
  actorId: string
  correlationId: string
  idempotencyKey: string
  lineage: WorkflowLineage
  occurredAt: string
}

export interface WorkflowRequestPayload {
  input: Record<string, unknown>
  [key: string]: unknown
}

export interface WorkflowProgressPayload {
  status: WorkflowProgressStatus
  step: string
  progress: number
  [key: string]: unknown
}

export interface WorkflowResultError {
  code: string
  message: string
}

export interface WorkflowResultPayload {
  status: WorkflowResultStatus
  output?: Record<string, unknown>
  error?: WorkflowResultError
  [key: string]: unknown
}

export interface WorkflowRequestMessage extends WorkflowMessageBase {
  messageType: typeof WORKFLOW_MESSAGE_TYPE.REQUEST
  payload: WorkflowRequestPayload
}

export interface WorkflowProgressMessage extends WorkflowMessageBase {
  messageType: typeof WORKFLOW_MESSAGE_TYPE.PROGRESS
  payload: WorkflowProgressPayload
}

export interface WorkflowResultMessage extends WorkflowMessageBase {
  messageType: typeof WORKFLOW_MESSAGE_TYPE.RESULT
  payload: WorkflowResultPayload
}

export type WorkflowMessage =
  WorkflowRequestMessage | WorkflowProgressMessage | WorkflowResultMessage

export class WorkflowContractValidationError extends Error {
  readonly field: string

  constructor(field: string, reason: string) {
    super(`Invalid workflow message ${field}: ${reason}`)
    this.name = 'WorkflowContractValidationError'
    this.field = field
  }
}

const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_ISO_TIMESTAMP.test(value)) return false
  return new Date(value).toISOString() === value
}

export function validateWorkflowMessage(value: unknown): WorkflowMessage {
  if (!isRecord(value)) throw new WorkflowContractValidationError('message', 'must be an object')
  if (value.contractVersion !== WORKFLOW_CONTRACT_VERSION) {
    throw new WorkflowContractValidationError('contractVersion', 'unsupported contract version')
  }

  for (const field of [
    'messageId',
    'workflowId',
    'runId',
    'tenantId',
    'actorId',
    'correlationId',
    'idempotencyKey',
  ]) {
    if (!isNonEmptyString(value[field])) {
      throw new WorkflowContractValidationError(field, 'must be a non-empty string')
    }
  }
  if (!isCanonicalIsoTimestamp(value.occurredAt)) {
    throw new WorkflowContractValidationError(
      'occurredAt',
      'must be a canonical ISO-8601 UTC timestamp'
    )
  }
  if (!isWorkflowMessageType(value.messageType)) {
    throw new WorkflowContractValidationError('messageType', 'is unsupported')
  }
  if (
    !isRecord(value.lineage) ||
    !isNonEmptyString(value.lineage.rootMessageId) ||
    !isNonEmptyString(value.lineage.source)
  ) {
    throw new WorkflowContractValidationError('lineage', 'rootMessageId and source are required')
  }
  if (
    value.lineage.parentMessageId !== undefined &&
    !isNonEmptyString(value.lineage.parentMessageId)
  ) {
    throw new WorkflowContractValidationError(
      'lineage.parentMessageId',
      'must be a non-empty string'
    )
  }
  if (!isRecord(value.payload))
    throw new WorkflowContractValidationError('payload', 'must be an object')

  if (value.messageType === WORKFLOW_MESSAGE_TYPE.REQUEST) validateRequestPayload(value.payload)
  if (value.messageType === WORKFLOW_MESSAGE_TYPE.PROGRESS) {
    validateProgressPayload(value.payload)
  }
  if (value.messageType === WORKFLOW_MESSAGE_TYPE.RESULT) validateResultPayload(value.payload)

  return value as unknown as WorkflowMessage
}

export function createWorkflowRequestFixture(): WorkflowRequestMessage {
  return {
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    messageId: 'message-request-fixture',
    messageType: WORKFLOW_MESSAGE_TYPE.REQUEST,
    workflowId: 'workflow-fixture',
    runId: 'run-fixture',
    tenantId: 'tenant-fixture',
    actorId: 'actor-fixture',
    correlationId: 'correlation-fixture',
    idempotencyKey: 'idempotency-fixture',
    lineage: { rootMessageId: 'message-request-fixture', source: 'api-fixture' },
    occurredAt: '2026-01-01T00:00:00.000Z',
    payload: { input: { assetId: 'asset-fixture' } },
  }
}

function validateRequestPayload(payload: Record<string, unknown>): void {
  if (!isRecord(payload.input)) {
    throw new WorkflowContractValidationError('payload.input', 'must be an object')
  }
}

function validateProgressPayload(payload: Record<string, unknown>): void {
  if (!isWorkflowProgressStatus(payload.status)) {
    throw new WorkflowContractValidationError('payload.status', 'is unsupported')
  }
  if (!isNonEmptyString(payload.step)) {
    throw new WorkflowContractValidationError('payload.step', 'must be a non-empty string')
  }
  if (
    !Number.isInteger(payload.progress) ||
    Number(payload.progress) < 0 ||
    Number(payload.progress) > 100
  ) {
    throw new WorkflowContractValidationError(
      'payload.progress',
      'must be an integer from 0 to 100'
    )
  }
}

function validateResultPayload(payload: Record<string, unknown>): void {
  if (!isWorkflowResultStatus(payload.status)) {
    throw new WorkflowContractValidationError('payload.status', 'is unsupported')
  }
  if (payload.output !== undefined && !isRecord(payload.output)) {
    throw new WorkflowContractValidationError('payload.output', 'must be an object')
  }
  if (payload.error !== undefined && !isRecord(payload.error)) {
    throw new WorkflowContractValidationError('payload.error', 'must be an object')
  }
  if (
    payload.error !== undefined &&
    (!isNonEmptyString(payload.error.code) || !isNonEmptyString(payload.error.message))
  ) {
    throw new WorkflowContractValidationError('payload.error', 'code and message are required')
  }
}

function isWorkflowMessageType(value: unknown): value is WorkflowMessageType {
  return Object.values(WORKFLOW_MESSAGE_TYPE).includes(value as WorkflowMessageType)
}

function isWorkflowProgressStatus(value: unknown): value is WorkflowProgressStatus {
  return Object.values(WORKFLOW_PROGRESS_STATUS).includes(value as WorkflowProgressStatus)
}

function isWorkflowResultStatus(value: unknown): value is WorkflowResultStatus {
  return Object.values(WORKFLOW_RESULT_STATUS).includes(value as WorkflowResultStatus)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
