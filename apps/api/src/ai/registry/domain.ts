const APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REVOKED: 'revoked',
} as const

const MODEL_AVAILABILITY_STATUS = {
  AVAILABLE: 'available',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
} as const

const PROMPT_VERSION_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  DEPRECATED: 'deprecated',
} as const

const ROLLOUT_STATE = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
  DEPRECATED: 'deprecated',
} as const

type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS]
type ModelAvailabilityStatus =
  (typeof MODEL_AVAILABILITY_STATUS)[keyof typeof MODEL_AVAILABILITY_STATUS]
type PromptVersionStatus = (typeof PROMPT_VERSION_STATUS)[keyof typeof PROMPT_VERSION_STATUS]
type RolloutState = (typeof ROLLOUT_STATE)[keyof typeof ROLLOUT_STATE]

const ApprovalStatus = APPROVAL_STATUS
const ModelAvailabilityStatus = MODEL_AVAILABILITY_STATUS
const PromptVersionStatus = PROMPT_VERSION_STATUS
const RolloutState = ROLLOUT_STATE

export interface RegistryContext {
  tenantId: string
  actorId: string
  correlationId: string
}

export interface PromptDefinition {
  id: string
  tenantId: string
  key: string
  owner: string
  description: string
}

export interface PromptVersion {
  id: string
  tenantId: string
  promptId: string
  version: number
  template: string
  checksum: string
  status: PromptVersionStatus
  createdBy: string
  approvedBy?: string
  deprecatedReason?: string
}

export interface ModelDefinition {
  id: string
  tenantId: string
  key: string
  provider: string
  modelName: string
  owner: string
  status: string
}

export interface ModelAvailability {
  id: string
  tenantId: string
  modelId: string
  status: ModelAvailabilityStatus
  reason: string
  observedAt: number
}

export interface Rollout {
  id: string
  tenantId: string
  promptId: string
  promptVersion: number
  modelId: string
  percentage: number
  state: RolloutState
  createdBy: string
  rolloutVersion: number
  previousRolloutId?: string
  failureReason?: string
}

export interface Approval {
  id: string
  tenantId: string
  resourceType: string
  resourceId: string
  requestedBy: string
  status: ApprovalStatus
  approverId?: string
  reason: string
}

export interface RegistroAuditoriaCatalogoIA {
  id: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  resourceType: string
  resourceId: string
  version?: number
  outcome: string
  metadata: Record<string, unknown>
  occurredAt: number
}

export interface EvaluationResult {
  rolloutId: string
  promptVersion: number
  modelId: string
  output: string
  quality: number
  latencyMs: number
  costUsd: number
  passed: boolean
}

export interface RegisterPromptInput {
  key: string
  owner: string
  description?: string
}

export interface CreatePromptVersionInput {
  promptId: string
  template: string
  version?: number
}

export interface RegisterModelInput {
  key: string
  provider: string
  modelName: string
  owner: string
}

export interface AvailabilityInput {
  status: ModelAvailabilityStatus
  reason: string
}

export interface ApprovalInput {
  resourceType: string
  resourceId: string
  reason?: string
}

export interface RolloutInput {
  promptId: string
  promptVersion: number
  modelId: string
  percentage: number
}

export interface RollbackInput {
  targetVersion: number
  reason: string
}

export {
  APPROVAL_STATUS,
  MODEL_AVAILABILITY_STATUS,
  PROMPT_VERSION_STATUS,
  ROLLOUT_STATE,
  ApprovalStatus,
  ModelAvailabilityStatus,
  PromptVersionStatus,
  RolloutState,
}
export default {
  APPROVAL_STATUS,
  MODEL_AVAILABILITY_STATUS,
  PROMPT_VERSION_STATUS,
  ROLLOUT_STATE,
  ApprovalStatus,
  ModelAvailabilityStatus,
  PromptVersionStatus,
  RolloutState,
}
