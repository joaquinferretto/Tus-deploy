import type {
  Approval,
  ApprovalInput,
  AvailabilityInput,
  CreatePromptVersionInput,
  EvaluationResult,
  ModelAvailability,
  ModelDefinition,
  PromptDefinition,
  PromptVersion,
  RegisterModelInput,
  RegisterPromptInput,
  RegistroAuditoriaCatalogoIA,
  RegistryContext,
  RollbackInput,
  Rollout,
  RolloutInput,
} from '../domain.js'
import {
  APPROVAL_STATUS,
  MODEL_AVAILABILITY_STATUS,
  PROMPT_VERSION_STATUS,
  ROLLOUT_STATE,
  type ApprovalStatus,
  type ModelAvailabilityStatus,
} from '../domain.js'

export class RegistryStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistryStateError'
  }
}

export class RegistryValidationError extends RegistryStateError {
  constructor(message: string) {
    super(message)
    this.name = 'RegistryValidationError'
  }
}

export class DeterministicFakeEvaluator {
  evaluate(rollout: Rollout, payload: Record<string, unknown>): EvaluationResult {
    const canonical = Object.keys(payload)
      .sort()
      .map((key) => `${key}:${stableValue(payload[key])}`)
      .join('|')
    const digest = deterministicDigest(canonical).slice(0, 12)
    return {
      rolloutId: rollout.id,
      promptVersion: rollout.promptVersion,
      modelId: rollout.modelId,
      output: `fake-evaluation:${digest}`,
      quality: 1,
      latencyMs: 17,
      costUsd: 0,
      passed: true,
    }
  }
}

export interface InMemoryAIRegistryOptions {
  now?: () => number
}

export class InMemoryAIRegistry {
  private readonly now: () => number
  private sequence = 0
  private readonly prompts = new Map<string, PromptDefinition>()
  private readonly promptVersions = new Map<string, PromptVersion>()
  private readonly models = new Map<string, ModelDefinition>()
  private readonly availability = new Map<string, ModelAvailability>()
  private readonly rollouts = new Map<string, Rollout>()
  private readonly approvals = new Map<string, Approval>()
  private readonly audits: RegistroAuditoriaCatalogoIA[] = []
  private readonly evaluator = new DeterministicFakeEvaluator()

  constructor(options: InMemoryAIRegistryOptions = {}) {
    this.now = options.now ?? (() => 0)
  }

  registerPrompt(context: RegistryContext, input: RegisterPromptInput): PromptDefinition {
    validateContext(context)
    requireText(input.key, 'Prompt key')
    requireText(input.owner, 'Prompt owner')
    if (
      [...this.prompts.values()].some(
        (row) => row.tenantId === context.tenantId && row.key === input.key
      )
    ) {
      throw new RegistryStateError('Prompt key already registered')
    }
    const row: PromptDefinition = {
      id: this.id('prompt'),
      tenantId: context.tenantId,
      key: input.key,
      owner: input.owner,
      description: input.description ?? '',
    }
    this.prompts.set(row.id, row)
    this.audit(context, 'prompt.registered', 'prompt', row.id, undefined, 'success')
    return clone(row)
  }

  createPromptVersion(context: RegistryContext, input: CreatePromptVersionInput): PromptVersion {
    const prompt = this.get(context, this.prompts, input.promptId)
    requireText(input.template, 'Prompt template')
    const versions = [...this.promptVersions.values()]
      .filter((row) => row.promptId === prompt.id)
      .map((row) => row.version)
    const nextVersion = input.version ?? Math.max(0, ...versions) + 1
    if (!Number.isInteger(nextVersion) || nextVersion < 1 || versions.includes(nextVersion))
      throw new RegistryStateError('Prompt versions are immutable')
    const row: PromptVersion = {
      id: this.id('prompt-version'),
      tenantId: prompt.tenantId,
      promptId: prompt.id,
      version: nextVersion,
      template: input.template,
      checksum: deterministicDigest(input.template),
      status: PROMPT_VERSION_STATUS.DRAFT,
      createdBy: context.actorId,
    }
    this.promptVersions.set(row.id, row)
    this.audit(context, 'prompt.version.created', 'prompt_version', row.id, row.version, 'success')
    return clone(row)
  }

  registerModel(context: RegistryContext, input: RegisterModelInput): ModelDefinition {
    validateContext(context)
    for (const [value, label] of [
      [input.key, 'Model key'],
      [input.provider, 'Model provider'],
      [input.modelName, 'Model name'],
      [input.owner, 'Model owner'],
    ] as const)
      requireText(value, label)
    if (
      [...this.models.values()].some(
        (row) => row.tenantId === context.tenantId && row.key === input.key
      )
    )
      throw new RegistryStateError('Model key already registered')
    const row: ModelDefinition = {
      id: this.id('model'),
      tenantId: context.tenantId,
      ...input,
      status: 'registered',
    }
    this.models.set(row.id, row)
    this.availability.set(row.id, {
      id: this.id('availability'),
      tenantId: row.tenantId,
      modelId: row.id,
      status: MODEL_AVAILABILITY_STATUS.UNAVAILABLE,
      reason: 'availability not approved',
      observedAt: this.now(),
    })
    this.audit(context, 'model.registered', 'model', row.id, undefined, 'success')
    return clone(row)
  }

  setModelAvailability(
    context: RegistryContext,
    modelId: string,
    input: AvailabilityInput
  ): ModelAvailability {
    const model = this.get(context, this.models, modelId)
    requireText(input.reason, 'Availability reason')
    if (!Object.values(MODEL_AVAILABILITY_STATUS).includes(input.status))
      throw new RegistryValidationError('Model availability status is unsupported')
    const row: ModelAvailability = {
      id: this.id('availability'),
      tenantId: model.tenantId,
      modelId,
      ...input,
      observedAt: this.now(),
    }
    this.availability.set(modelId, row)
    this.audit(context, 'model.availability.changed', 'model', modelId, undefined, 'success', {
      status: input.status,
    })
    return clone(row)
  }

  requestApproval(context: RegistryContext, input: ApprovalInput): Approval {
    this.resource(context, input.resourceType, input.resourceId)
    if (!['prompt_version', 'rollout', 'model'].includes(input.resourceType))
      throw new RegistryValidationError('Unsupported approval resource')
    const row: Approval = {
      id: this.id('approval'),
      tenantId: context.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestedBy: context.actorId,
      status: APPROVAL_STATUS.PENDING,
      reason: input.reason ?? '',
    }
    this.approvals.set(row.id, row)
    this.audit(context, 'approval.requested', 'approval', row.id, undefined, 'success')
    return clone(row)
  }

  approve(context: RegistryContext, approvalId: string): Approval {
    const approval = this.get(context, this.approvals, approvalId)
    if (approval.status !== APPROVAL_STATUS.PENDING)
      throw new RegistryStateError('Approval is no longer pending')
    if (approval.requestedBy === context.actorId)
      throw new RegistryStateError('Approval requires a distinct actor')
    const target = this.resource(context, approval.resourceType, approval.resourceId)
    const updated: Approval = {
      ...approval,
      status: APPROVAL_STATUS.APPROVED,
      approverId: context.actorId,
    }
    this.approvals.set(approval.id, updated)
    if (isPromptVersion(target))
      this.promptVersions.set(target.id, {
        ...target,
        status: PROMPT_VERSION_STATUS.APPROVED,
        approvedBy: context.actorId,
      })
    this.audit(
      context,
      'approval.approved',
      'approval',
      approval.id,
      'version' in target ? target.version : undefined,
      'success'
    )
    return clone(updated)
  }

  listApprovals(context: RegistryContext): Approval[] {
    validateContext(context)
    return [...this.approvals.values()]
      .filter((row) => row.tenantId === context.tenantId)
      .map(clone)
  }

  createRollout(context: RegistryContext, input: RolloutInput): Rollout {
    const prompt = this.get(context, this.prompts, input.promptId)
    const version = this.promptVersion(context, prompt.id, input.promptVersion)
    const model = this.get(context, this.models, input.modelId)
    if (version.status !== PROMPT_VERSION_STATUS.APPROVED)
      throw new RegistryStateError('Prompt version must be approved before rollout')
    this.assertModelAvailable(context, model.id)
    if (!Number.isInteger(input.percentage) || input.percentage < 1 || input.percentage > 100)
      throw new RegistryValidationError('Rollout percentage must be between 1 and 100')
    const row: Rollout = {
      id: this.id('rollout'),
      tenantId: prompt.tenantId,
      promptId: prompt.id,
      promptVersion: version.version,
      modelId: model.id,
      percentage: input.percentage,
      state: ROLLOUT_STATE.DRAFT,
      createdBy: context.actorId,
      rolloutVersion: 1,
    }
    this.rollouts.set(row.id, row)
    this.audit(context, 'rollout.created', 'rollout', row.id, version.version, 'success')
    return clone(row)
  }

  activateRollout(context: RegistryContext, rolloutId: string): Rollout {
    const rollout = this.get(context, this.rollouts, rolloutId)
    this.assertRolloutReady(context, rollout)
    if (!this.hasApprovedApproval(context, 'rollout', rollout.id)) {
      throw new RegistryStateError('Rollout requires approval before activation')
    }
    for (const [id, current] of this.rollouts)
      if (
        current.promptId === rollout.promptId &&
        current.state === ROLLOUT_STATE.ACTIVE &&
        id !== rollout.id
      )
        this.rollouts.set(id, { ...current, state: ROLLOUT_STATE.PAUSED })
    const updated = { ...rollout, state: ROLLOUT_STATE.ACTIVE }
    this.rollouts.set(rollout.id, updated)
    this.audit(
      context,
      'rollout.activated',
      'rollout',
      rollout.id,
      rollout.promptVersion,
      'success'
    )
    return clone(updated)
  }

  deprecatePromptVersion(
    context: RegistryContext,
    input: { promptId: string; version: number; reason: string }
  ): PromptVersion {
    const row = this.promptVersion(context, input.promptId, input.version)
    requireText(input.reason, 'Deprecation reason')
    const updated = {
      ...row,
      status: PROMPT_VERSION_STATUS.DEPRECATED,
      deprecatedReason: input.reason,
    }
    this.promptVersions.set(row.id, updated)
    for (const [id, rollout] of this.rollouts)
      if (rollout.promptId === input.promptId && rollout.promptVersion === input.version)
        this.rollouts.set(id, { ...rollout, state: ROLLOUT_STATE.DEPRECATED })
    this.audit(
      context,
      'prompt.version.deprecated',
      'prompt_version',
      row.id,
      input.version,
      'success'
    )
    return clone(updated)
  }

  rollbackRollout(context: RegistryContext, rolloutId: string, input: RollbackInput): Rollout {
    const current = this.get(context, this.rollouts, rolloutId)
    requireText(input.reason, 'Rollback reason')
    const target = this.promptVersion(context, current.promptId, input.targetVersion)
    if (target.status !== PROMPT_VERSION_STATUS.APPROVED)
      throw new RegistryStateError('Rollback target must be approved')
    this.assertModelAvailable(context, current.modelId)
    this.rollouts.set(current.id, { ...current, state: ROLLOUT_STATE.ROLLED_BACK })
    const restored: Rollout = {
      ...current,
      id: this.id('rollout'),
      promptVersion: target.version,
      state: ROLLOUT_STATE.ACTIVE,
      createdBy: context.actorId,
      rolloutVersion: current.rolloutVersion + 1,
      previousRolloutId: current.id,
    }
    this.rollouts.set(restored.id, restored)
    this.audit(context, 'rollout.rolled_back', 'rollout', restored.id, target.version, 'success', {
      reason: 'redacted',
    })
    return clone(restored)
  }

  recordProviderFailure(context: RegistryContext, modelId: string, reason: string): void {
    this.get(context, this.models, modelId)
    requireText(reason, 'Provider failure reason')
    this.availability.set(modelId, {
      id: this.id('availability'),
      tenantId: context.tenantId,
      modelId,
      status: MODEL_AVAILABILITY_STATUS.UNAVAILABLE,
      reason,
      observedAt: this.now(),
    })
    for (const [id, rollout] of this.rollouts)
      if (rollout.modelId === modelId && rollout.state !== ROLLOUT_STATE.DEPRECATED)
        this.rollouts.set(id, {
          ...rollout,
          state: ROLLOUT_STATE.PAUSED,
          failureReason: 'provider unavailable',
        })
    this.audit(context, 'provider.failure', 'model', modelId, undefined, 'failed', {
      reason: 'redacted',
    })
  }

  evaluate(
    context: RegistryContext,
    rolloutId: string,
    payload: Record<string, unknown>
  ): EvaluationResult {
    const rollout = this.get(context, this.rollouts, rolloutId)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new RegistryValidationError('Evaluation payload is required')
    }
    const version = this.promptVersion(context, rollout.promptId, rollout.promptVersion)
    if (
      version.status === PROMPT_VERSION_STATUS.DEPRECATED ||
      rollout.state === ROLLOUT_STATE.DEPRECATED
    )
      throw new RegistryStateError('deprecated prompt version cannot be evaluated')
    this.assertModelAvailable(context, rollout.modelId)
    if (rollout.state !== ROLLOUT_STATE.ACTIVE)
      throw new RegistryStateError('Rollout is not active')
    const result = this.evaluator.evaluate(rollout, payload)
    this.audit(
      context,
      'evaluation.completed',
      'rollout',
      rollout.id,
      rollout.promptVersion,
      'success',
      {
        inputKeys: Object.keys(payload)
          .filter((key) => !/secret|token|password/i.test(key))
          .sort(),
      }
    )
    return result
  }

  getPrompt(context: RegistryContext, id: string): PromptDefinition {
    return this.get(context, this.prompts, id)
  }
  getPromptVersion(context: RegistryContext, id: string): PromptVersion {
    return this.get(context, this.promptVersions, id)
  }
  getModel(context: RegistryContext, id: string): ModelDefinition {
    return this.get(context, this.models, id)
  }
  getModelAvailability(context: RegistryContext, modelId: string): ModelAvailability {
    this.get(context, this.models, modelId)
    const row = this.availability.get(modelId)
    if (!row || row.tenantId !== context.tenantId)
      throw new Error('No tenant-scoped model availability')
    return clone(row)
  }
  getRollout(context: RegistryContext, id: string): Rollout {
    return this.get(context, this.rollouts, id)
  }
  listPrompts(context: RegistryContext): PromptDefinition[] {
    validateContext(context)
    return [...this.prompts.values()].filter((row) => row.tenantId === context.tenantId).map(clone)
  }
  listModels(context: RegistryContext): ModelDefinition[] {
    validateContext(context)
    return [...this.models.values()].filter((row) => row.tenantId === context.tenantId).map(clone)
  }
  listRollouts(context: RegistryContext): Rollout[] {
    validateContext(context)
    return [...this.rollouts.values()].filter((row) => row.tenantId === context.tenantId).map(clone)
  }
  getActiveRollout(context: RegistryContext, promptId: string): Rollout {
    this.get(context, this.prompts, promptId)
    const row = [...this.rollouts.values()].find(
      (item) => item.promptId === promptId && item.state === ROLLOUT_STATE.ACTIVE
    )
    if (!row) throw new Error('No active tenant-scoped rollout')
    return clone(row)
  }
  auditLog(context: RegistryContext): RegistroAuditoriaCatalogoIA[] {
    return this.audits.filter((row) => row.tenantId === context.tenantId).map(clone)
  }

  private assertRolloutReady(context: RegistryContext, rollout: Rollout): void {
    const version = this.promptVersion(context, rollout.promptId, rollout.promptVersion)
    if (version.status === PROMPT_VERSION_STATUS.DEPRECATED)
      throw new RegistryStateError('Deprecated prompt versions cannot roll out')
    if (version.status !== PROMPT_VERSION_STATUS.APPROVED)
      throw new RegistryStateError('Prompt version must be approved before rollout')
    this.assertModelAvailable(context, rollout.modelId)
  }
  private assertModelAvailable(context: RegistryContext, modelId: string): void {
    this.get(context, this.models, modelId)
    const current = this.availability.get(modelId)
    const usableStatuses: readonly ModelAvailabilityStatus[] = [
      MODEL_AVAILABILITY_STATUS.AVAILABLE,
      MODEL_AVAILABILITY_STATUS.DEGRADED,
    ]
    if (!current || !usableStatuses.includes(current.status))
      throw new RegistryStateError('Model is unavailable')
  }
  private promptVersion(
    context: RegistryContext,
    promptId: string,
    version: number
  ): PromptVersion {
    this.get(context, this.prompts, promptId)
    const row = [...this.promptVersions.values()].find(
      (item) => item.promptId === promptId && item.version === version
    )
    if (!row || row.tenantId !== context.tenantId)
      throw new Error('No tenant-scoped prompt version')
    return clone(row)
  }
  private resource(
    context: RegistryContext,
    resourceType: string,
    resourceId: string
  ): PromptVersion | Rollout | ModelDefinition {
    if (resourceType === 'prompt_version') return this.get(context, this.promptVersions, resourceId)
    if (resourceType === 'rollout') return this.get(context, this.rollouts, resourceId)
    if (resourceType === 'model') return this.get(context, this.models, resourceId)
    throw new RegistryValidationError('Unsupported registry resource')
  }
  private get<T extends { tenantId: string }>(
    context: RegistryContext,
    store: Map<string, T>,
    id: string
  ): T {
    validateContext(context)
    const row = store.get(id)
    if (!row || row.tenantId !== context.tenantId)
      throw new Error('No tenant-scoped registry record')
    return clone(row)
  }
  private hasApprovedApproval(
    context: RegistryContext,
    resourceType: string,
    resourceId: string
  ): boolean {
    validateContext(context)
    return [...this.approvals.values()].some(
      (approval) =>
        approval.tenantId === context.tenantId &&
        approval.resourceType === resourceType &&
        approval.resourceId === resourceId &&
        approval.status === APPROVAL_STATUS.APPROVED
    )
  }
  private id(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
  private audit(
    context: RegistryContext,
    action: string,
    resourceType: string,
    resourceId: string,
    version: number | undefined,
    outcome: string,
    metadata: Record<string, unknown> = {}
  ): void {
    this.audits.push({
      id: this.id('audit'),
      tenantId: context.tenantId,
      actorId: context.actorId,
      correlationId: context.correlationId,
      action,
      resourceType,
      resourceId,
      version,
      outcome,
      metadata: redact(metadata),
      occurredAt: this.now(),
    })
  }
}

function validateContext(context: RegistryContext): void {
  if (!context || typeof context !== 'object')
    throw new RegistryValidationError('Registry context is required')
  for (const key of ['tenantId', 'actorId', 'correlationId']) {
    const value = context[key as keyof RegistryContext]
    if (typeof value !== 'string' || !value.trim())
      throw new RegistryValidationError(`Registry context ${key} is required`)
  }
}
function requireText(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim())
    throw new RegistryValidationError(`${label} is required`)
}
function clone<T>(value: T): T {
  return structuredClone(value)
}
function stableValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${stableValue((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  }
  return String(value)
}
function deterministicDigest(value: string): string {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
function redact(value: Record<string, unknown>): Record<string, unknown> {
  return redactValue(value) as Record<string, unknown>
}
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /secret|token|password|template/i.test(key) ? '[REDACTED]' : redactValue(item),
      ])
    )
  return value
}
function isPromptVersion(value: PromptVersion | Rollout | ModelDefinition): value is PromptVersion {
  return 'template' in value
}

export { APPROVAL_STATUS, MODEL_AVAILABILITY_STATUS, PROMPT_VERSION_STATUS, ROLLOUT_STATE }
export type { ApprovalStatus, ModelAvailabilityStatus }

export default {
  DeterministicFakeEvaluator,
  InMemoryAIRegistry,
  RegistryStateError,
  RegistryValidationError,
}
