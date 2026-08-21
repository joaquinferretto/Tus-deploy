export const CONTRACT_VERSION = '1.0.0' as const

export type ContractVersion = typeof CONTRACT_VERSION

export interface TraceContext {
  traceId: string
  correlationId: string
  spanId?: string
  causationId?: string
}

export interface WorkflowJob {
  contractVersion: ContractVersion
  jobId: string
  workflowId: string
  runId: string
  kind: 'ingest' | 'transform' | 'render' | 'publish'
  status: 'pending' | 'leased' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  priority: number
  createdAt: string
  trace: TraceContext
  payload: { assetId: string; inputUri: string; [key: string]: unknown }
}

export class ContractValidationError extends Error {
  readonly contract: string
  readonly version: unknown

  constructor(contract: string, version: unknown, reason: string) {
    super(`Invalid ${contract} contract (${String(version)}): ${reason}`)
    this.name = 'ContractValidationError'
    this.contract = contract
    this.version = version
  }
}

export function validateWorkflowJob(value: unknown): WorkflowJob {
  if (!isRecord(value)) throw new ContractValidationError('workflow-job', undefined, 'payload must be an object')
  if (value.contractVersion !== CONTRACT_VERSION) {
    throw new ContractValidationError('workflow-job', value.contractVersion, 'unsupported contract version')
  }

  for (const field of ['jobId', 'workflowId', 'runId', 'createdAt']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new ContractValidationError('workflow-job', CONTRACT_VERSION, `${field} is required`)
    }
  }
  if (!['ingest', 'transform', 'render', 'publish'].includes(String(value.kind))) {
    throw new ContractValidationError('workflow-job', CONTRACT_VERSION, 'kind is unsupported')
  }
  if (!['pending', 'leased', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'].includes(String(value.status))) {
    throw new ContractValidationError('workflow-job', CONTRACT_VERSION, 'status is unsupported')
  }
  if (!Number.isInteger(value.priority) || Number(value.priority) < 1 || Number(value.priority) > 100) {
    throw new ContractValidationError('workflow-job', CONTRACT_VERSION, 'priority must be between 1 and 100')
  }
  if (!isRecord(value.trace) || typeof value.trace.traceId !== 'string' || typeof value.trace.correlationId !== 'string') {
    throw new ContractValidationError('workflow-job', CONTRACT_VERSION, 'trace context is required')
  }
  if (!isRecord(value.payload) || typeof value.payload.assetId !== 'string' || typeof value.payload.inputUri !== 'string') {
    throw new ContractValidationError('workflow-job', CONTRACT_VERSION, 'payload assetId and inputUri are required')
  }
  try {
    new URL(value.payload.inputUri)
  } catch {
    throw new ContractValidationError('workflow-job', CONTRACT_VERSION, 'payload inputUri must be a URI')
  }
  return value as unknown as WorkflowJob
}

export function createWorkflowJobFixture(): WorkflowJob {
  return {
    contractVersion: CONTRACT_VERSION,
    jobId: 'job-fixture',
    workflowId: 'workflow-fixture',
    runId: 'run-fixture',
    kind: 'ingest',
    status: 'pending',
    priority: 50,
    createdAt: '2026-01-01T00:00:00Z',
    trace: { traceId: '0123456789abcdef', correlationId: 'correlation-fixture' },
    payload: { assetId: 'asset-fixture', inputUri: 'https://example.invalid/asset' },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
