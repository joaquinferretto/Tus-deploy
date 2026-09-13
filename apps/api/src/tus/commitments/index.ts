import { TUS_COMMITMENT_STATUSES, TUS_CONTRACT_VERSION, type CommitmentStatus, type TusCommitment } from '@factory/contracts'
import type { MarketplaceCommitment } from '../catalog/index.ts'
import {
  TUS_AUDIT_REFERENCE_TYPES,
  TUS_OUTBOX_EVENT_TYPES,
  type TusAuditReference,
  type TusCheckoutResponse,
  type TusCommitmentCompensation,
  type TusCommandContext,
  type TusOutboxRecord,
  type TusTransactionPort,
} from '../ports/index.ts'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../readiness/index.ts'

export type TusMarketplaceCommitment = MarketplaceCommitment

export function splitMarketplaceCommitments(commitments: readonly MarketplaceCommitment[]): {
  products: MarketplaceCommitment[]
  services: MarketplaceCommitment[]
} {
  return {
    products: commitments.filter((commitment) => commitment.context === 'product'),
    services: commitments.filter((commitment) => commitment.context === 'service'),
  }
}

export function isIndependentMarketplaceCommitment(commitment: MarketplaceCommitment): boolean {
  return commitment.commitmentId.length > 0 && commitment.listingId.length > 0 && ['product', 'service'].includes(commitment.context)
}

export interface TusCommitmentLifecycleCommand extends TusCommandContext {
  commitmentId: string
  toStatus: CommitmentStatus
  expectedVersion: number
  idempotencyKey: string
  requestHash: string
  reason: string
  createdAt: string
}

export interface TusCommitmentCompensationCommand extends TusCommandContext {
  commitmentId: string
  expectedVersion: number
  idempotencyKey: string
  requestHash: string
  amount: number
  reason: string
  createdAt: string
}

export type TusCommitmentMutationResult = {
  status: 'executed' | 'replay'
  commitment: TusCommitment
  auditReferences: TusAuditReference[]
  compensation?: TusCommitmentCompensation
}

export class TusCommitmentError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'TusCommitmentError'
  }
}

export class TusCommitmentLifecycleService {
  private readonly transaction: TusTransactionPort
  private readonly now: () => number
  private readonly evaluadorHabilitacion?: EvaluadorHabilitacion
  private readonly perfilHabilitacion: PerfilHabilitacion
  private readonly alcanceHabilitacion: string

  constructor(transaction: TusTransactionPort, now: () => number = () => Date.now(), options: { evaluadorHabilitacion?: EvaluadorHabilitacion; perfilHabilitacion?: PerfilHabilitacion; alcanceHabilitacion?: string } = {}) {
    this.transaction = transaction
    this.now = now
    this.evaluadorHabilitacion = options.evaluadorHabilitacion
    this.perfilHabilitacion = options.perfilHabilitacion ?? 'native-local'
    this.alcanceHabilitacion = options.alcanceHabilitacion ?? 'argentina-stage-1'
  }

  async transition(input: TusCommitmentLifecycleCommand): Promise<TusCommitmentMutationResult> {
    requireCommandText(input)
    await this.requerirHabilitacion(input)
    if (input.toStatus === TUS_COMMITMENT_STATUSES.COMPENSATED) {
      throw new TusCommitmentError(400, 'INVALID_TRANSITION', 'use compensation for compensated commitments')
    }
    return this.transaction.run(async (repositories) => {
      const claim = await repositories.idempotency.claim({ tenantId: input.tenantId, key: input.idempotencyKey, requestHash: input.requestHash, now: this.now(), expiresAt: this.now() + 15 * 60 * 1000 })
      if (claim.status === 'replay') return mutationFromResponse(claim.response)
      if (claim.status === 'conflict') throw new TusCommitmentError(409, 'CONFLICT', 'idempotency key was already used for another request')
      if (claim.status === 'in_progress') throw new TusCommitmentError(409, 'IN_PROGRESS', 'the idempotent request is already in progress')

      const current = await repositories.commitments.find(input.commitmentId)
      if (!current) throw new TusCommitmentError(404, 'NOT_FOUND', 'commitment was not found')
      if (current.tenantId !== input.tenantId) throw new TusCommitmentError(403, 'FORBIDDEN', 'commitment is outside the authenticated tenant')
      if (current.version !== input.expectedVersion) throw new TusCommitmentError(409, 'VERSION_CONFLICT', 'commitment version is stale')
      if (!isValidTransition(current.status, input.toStatus)) throw new TusCommitmentError(409, 'INVALID_TRANSITION', `cannot transition ${current.status} to ${input.toStatus}`)

      const updated = { ...current, status: input.toStatus, version: current.version + 1 }
      const persisted = await repositories.commitments.update({ tenantId: input.tenantId, commitmentId: input.commitmentId, expectedVersion: input.expectedVersion, commitment: updated })
      if (!persisted) throw new TusCommitmentError(409, 'VERSION_CONFLICT', 'commitment version is stale')
      const audit = lifecycleAudit(input, current, persisted, TUS_AUDIT_REFERENCE_TYPES.STATUS_CHANGED)
      const response = mutationResponse(persisted, [audit], 'transition')
      await repositories.audits.append([audit])
      await repositories.outbox.append(lifecycleOutbox(input, current, persisted, [audit], TUS_OUTBOX_EVENT_TYPES.STATUS_CHANGED))
      await repositories.idempotency.complete({ tenantId: input.tenantId, key: input.idempotencyKey, response })
      return executedMutation(response)
    })
  }

  async compensate(input: TusCommitmentCompensationCommand): Promise<TusCommitmentMutationResult> {
    requireCommandText(input)
    await this.requerirHabilitacion(input)
    if (!Number.isFinite(input.amount) || input.amount < 0) throw new TusCommitmentError(400, 'INVALID_COMPENSATION', 'compensation amount must be non-negative')
    return this.transaction.run(async (repositories) => {
      const claim = await repositories.idempotency.claim({ tenantId: input.tenantId, key: input.idempotencyKey, requestHash: input.requestHash, now: this.now(), expiresAt: this.now() + 15 * 60 * 1000 })
      if (claim.status === 'replay') return mutationFromResponse(claim.response)
      if (claim.status === 'conflict') throw new TusCommitmentError(409, 'CONFLICT', 'idempotency key was already used for another request')
      if (claim.status === 'in_progress') throw new TusCommitmentError(409, 'IN_PROGRESS', 'the idempotent request is already in progress')

      const current = await repositories.commitments.find(input.commitmentId)
      if (!current) throw new TusCommitmentError(404, 'NOT_FOUND', 'commitment was not found')
      if (current.tenantId !== input.tenantId) throw new TusCommitmentError(403, 'FORBIDDEN', 'commitment is outside the authenticated tenant')
      if (current.version !== input.expectedVersion) throw new TusCommitmentError(409, 'VERSION_CONFLICT', 'commitment version is stale')
      if (current.status === TUS_COMMITMENT_STATUSES.COMPENSATED) throw new TusCommitmentError(409, 'ALREADY_COMPENSATED', 'commitment has already been compensated')
      if (input.amount > current.amount) throw new TusCommitmentError(400, 'INVALID_COMPENSATION', 'compensation exceeds commitment amount')

      const updated = { ...current, status: TUS_COMMITMENT_STATUSES.COMPENSATED, version: current.version + 1 }
      const persisted = await repositories.commitments.update({ tenantId: input.tenantId, commitmentId: input.commitmentId, expectedVersion: input.expectedVersion, commitment: updated })
      if (!persisted) throw new TusCommitmentError(409, 'VERSION_CONFLICT', 'commitment version is stale')
      const compensation: TusCommitmentCompensation = { compensationId: `compensation-${input.tenantId}-${input.commitmentId}-${persisted.version}`, tenantId: input.tenantId, commitmentId: input.commitmentId, actorId: input.actorId, correlationId: input.correlationId, amount: input.amount, currency: current.currency, reason: input.reason, createdAt: input.createdAt }
      await repositories.compensations.save(compensation)
      const audit = lifecycleAudit(input, current, persisted, TUS_AUDIT_REFERENCE_TYPES.COMPENSATED)
      const response = mutationResponse(persisted, [audit], 'compensation', compensation)
      await repositories.audits.append([audit])
      await repositories.outbox.append(lifecycleOutbox(input, current, persisted, [audit], TUS_OUTBOX_EVENT_TYPES.COMPENSATED, compensation))
      await repositories.idempotency.complete({ tenantId: input.tenantId, key: input.idempotencyKey, response })
      return executedMutation(response)
    })
  }

  private requerirHabilitacion(input: TusCommandContext): Promise<unknown> {
    return this.evaluadorHabilitacion?.require({ tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId, capability: 'settlement', profile: this.perfilHabilitacion, scope: this.alcanceHabilitacion }) ?? Promise.resolve()
  }
}

function requireCommandText(input: TusCommandContext & { commitmentId: string; idempotencyKey: string; requestHash: string; reason: string }): void {
  for (const [field, value] of Object.entries(input)) {
    if (['tenantId', 'actorId', 'correlationId', 'commitmentId', 'idempotencyKey', 'requestHash', 'reason'].includes(field) && typeof value === 'string' && !value.trim()) {
      throw new TusCommitmentError(400, 'INVALID', `${field} is required`)
    }
  }
}

function isValidTransition(from: CommitmentStatus, to: CommitmentStatus): boolean {
  const transitions: Record<CommitmentStatus, readonly CommitmentStatus[]> = {
    pending: ['confirmed', 'cancelled', 'frozen'],
    confirmed: ['fulfilled', 'cancelled', 'frozen'],
    fulfilled: ['released', 'frozen'],
    frozen: ['confirmed', 'cancelled'],
    cancelled: [],
    released: [],
    compensated: [],
  }
  return transitions[from].includes(to)
}

function lifecycleAudit(input: TusCommandContext & { createdAt: string; reason: string }, previous: TusCommitment, updated: TusCommitment, referenceType: TusAuditReference['referenceType']): TusAuditReference {
  return { referenceId: `audit-${updated.commitmentId}-${updated.version}`, tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId, commitmentId: updated.commitmentId, referenceType, previousStatus: previous.status, status: updated.status, reason: input.reason, createdAt: input.createdAt }
}

function lifecycleOutbox(input: TusCommandContext & { createdAt: string; idempotencyKey: string; requestHash: string }, previous: TusCommitment, updated: TusCommitment, audits: readonly TusAuditReference[], eventType: TusOutboxRecord['eventType'], compensation?: TusCommitmentCompensation): TusOutboxRecord {
  return { eventId: `outbox-${updated.commitmentId}-${updated.version}`, tenantId: input.tenantId, eventType, aggregateId: updated.commitmentId, payload: { commitmentIds: [updated.commitmentId], auditReferenceIds: audits.map((audit) => audit.referenceId), commitmentContext: updated.context, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, workflowRunId: `tus-commitment-${updated.context}-${updated.commitmentId}`, ...(compensation ? { compensationId: compensation.compensationId } : {}) } as TusOutboxRecord['payload'], createdAt: Date.parse(input.createdAt), status: 'pending', attempts: 0, availableAt: Date.parse(input.createdAt), lastError: null, claimId: null, claimUntil: null }
}

function mutationResponse(commitment: TusCommitment, auditReferences: TusAuditReference[], operation: TusCheckoutResponse['operation'], compensation?: TusCommitmentCompensation): TusCheckoutResponse {
  return { commitments: [commitment], auditReferences, operation, commitment, ...(compensation ? { compensation } : {}) }
}

function mutationFromResponse(response: TusCheckoutResponse): TusCommitmentMutationResult {
  const commitment = response.commitment ?? response.commitments[0]
  if (!commitment) throw new TusCommitmentError(500, 'INVALID_REPLAY', 'idempotency replay has no commitment result')
  return { status: 'replay', commitment, auditReferences: response.auditReferences, ...(response.compensation ? { compensation: response.compensation } : {}) }
}

function executedMutation(response: TusCheckoutResponse): TusCommitmentMutationResult {
  const commitment = response.commitment ?? response.commitments[0]
  if (!commitment) throw new TusCommitmentError(500, 'INVALID_RESULT', 'commitment mutation produced no commitment')
  return { status: 'executed', commitment, auditReferences: response.auditReferences, ...(response.compensation ? { compensation: response.compensation } : {}) }
}

export default { isIndependentMarketplaceCommitment, splitMarketplaceCommitments }
