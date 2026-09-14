import type { TusCommitment } from '@factory/contracts'
import type { TusMarketplaceService } from '../catalog/index.ts'
import type { ServiceCalendarService } from '../calendar/index.ts'
import type {
  ReleaseEligibility,
  ReleaseEligibilityInput,
} from '../domain/settlement.ts'
import { isReleaseEligible } from '../domain/settlement.ts'
import { splitCartIntoCommitments } from '../domain/commitments.ts'
import {
  ServicioCicloVidaCompromiso,
  type ComandoCompensacion,
  type ComandoCicloVidaCompromiso,
  type ResultadoMutacionCompromiso,
} from '../commitments/index.ts'
import type { TusFinanceService } from '../finance/index.ts'
import type { DeliveryProof, DeliveryTask, TusDeliveryService } from '../delivery/index.ts'
import type { TusPosService } from '../pos/index.ts'
import type { TusSupportService } from '../support/index.ts'
import type { TusWhatsAppService } from '../whatsapp/index.ts'
import type { TusReportingService } from '../reporting/index.ts'
import type { TusOperationsTelemetry } from '@factory/observability'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../readiness/index.ts'
import { TUS_BOUNDED_CONTEXTS } from '../ports/index.ts'
import type {
  ReferenciaAuditoria,
  TusCheckoutCommand,
  TusCheckoutResponse,
  TusCommandContext,
  TusCommitmentStorePort,
  TusCommitmentCompensationStorePort,
  PuertoReferenciasAuditoria,
  TusBoundedContext,
  TusIdempotencyStorePort,
  TusOutboxRecord,
  TusOutboxStorePort,
  TusTransactionPort,
  TusTransactionRepositories,
  TusAuthenticatedTenantContext,
} from '../ports/index.ts'

export type TusCheckoutResult =
  | ({ status: 'executed' | 'replay' } & TusCheckoutResponse)
  | { status: 'in_progress' | 'conflict' | 'forbidden' }
export type TusCommitmentReadResult =
  | { status: 'found'; commitment: TusCommitment }
  | { status: 'not_found' }
  | { status: 'forbidden' }

export interface TusReleasePolicy {
  localReleaseAfterMs?: number
}

export interface TusApplicationDependencies {
  commitments: TusCommitmentStorePort
  compensations: TusCommitmentCompensationStorePort
  audits: PuertoReferenciasAuditoria
  idempotency: TusIdempotencyStorePort
  outbox: TusOutboxStorePort
  transaction?: TusTransactionPort
  now?: () => number
  releasePolicy?: TusReleasePolicy
  marketplace?: TusMarketplaceService
  calendar?: ServiceCalendarService
  finance?: TusFinanceService
  delivery?: TusDeliveryService
  pos?: TusPosService
  support?: TusSupportService
  whatsapp?: TusWhatsAppService
  reporting?: TusReportingService
  operationsTelemetry?: TusOperationsTelemetry
  evaluadorHabilitacion?: EvaluadorHabilitacion
  perfilHabilitacion?: PerfilHabilitacion
  alcanceHabilitacion?: string
}

export class TusApplicationService {
  readonly outbox: TusOutboxStorePort
  readonly marketplace?: TusMarketplaceService
  readonly calendar?: ServiceCalendarService
  readonly finance?: TusFinanceService
  readonly delivery?: TusDeliveryService
  readonly pos?: TusPosService
  readonly support?: TusSupportService
  readonly whatsapp?: TusWhatsAppService
  readonly reporting?: TusReportingService
  readonly contexts = TUS_BOUNDED_CONTEXTS
  private readonly dependencies: TusApplicationDependencies
  private readonly lifecycle: ServicioCicloVidaCompromiso
  readonly evaluadorHabilitacion?: EvaluadorHabilitacion

  constructor(dependencies: TusApplicationDependencies) {
    this.dependencies = dependencies
    this.outbox = dependencies.outbox
    this.marketplace = dependencies.marketplace
    this.calendar = dependencies.calendar
    this.finance = dependencies.finance
    this.delivery = dependencies.delivery
    this.pos = dependencies.pos
    this.support = dependencies.support
    this.whatsapp = dependencies.whatsapp
    this.reporting = dependencies.reporting
    this.evaluadorHabilitacion = dependencies.evaluadorHabilitacion
    if (!dependencies.transaction) throw new Error('TUS transaction boundary is required')
    this.lifecycle = new ServicioCicloVidaCompromiso(dependencies.transaction, dependencies.now, {
      evaluadorHabilitacion: dependencies.evaluadorHabilitacion,
      perfilHabilitacion: dependencies.perfilHabilitacion,
      alcanceHabilitacion: dependencies.alcanceHabilitacion,
    })
  }

  async checkout(input: TusCheckoutCommand): Promise<TusCheckoutResult> {
    assertCommandContext(input)
    await this.evaluadorHabilitacion?.require({
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      capability: 'settlement',
      profile: this.dependencies.perfilHabilitacion ?? 'native-local',
      scope: this.dependencies.alcanceHabilitacion ?? 'argentina-stage-1',
      now: input.createdAt,
    })
    if (!input.idempotencyKey?.trim() || !input.requestHash.trim()) throw new Error('idempotency key and request fingerprint are required')
    const key = input.idempotencyKey
    const now = this.dependencies.now?.() ?? Date.parse(input.createdAt)
    try {
      const execute = async (repositories: TusTransactionRepositories): Promise<TusCheckoutResult> => {
        const claim = await repositories.idempotency.claim({ tenantId: input.tenantId, key, requestHash: input.requestHash, now, expiresAt: input.expiresAt })
        if (claim.status === 'replay') return { status: 'replay', ...claim.response }
        if (claim.status !== 'claimed') return claim
        const commitments = splitCartIntoCommitments(input)
        if (commitments.length === 0) throw new Error('checkout requires at least one commitment line')
        const auditReferences = crearReferenciasAuditoria(input, commitments)
        const response: TusCheckoutResponse = { commitments, auditReferences }
        await repositories.commitments.saveMany(commitments)
        await repositories.audits.append(auditReferences)
        await repositories.outbox.append(createCheckoutEvent(input, commitments, auditReferences, now))
        await repositories.idempotency.complete({ tenantId: input.tenantId, key, response })
        return { status: 'executed', ...response }
      }

      return await this.dependencies.transaction!.run(execute)
    } catch (error) {
      if (!this.dependencies.transaction) await this.dependencies.idempotency.release({ tenantId: input.tenantId, key })
      throw error
    }
  }

  transitionCommitment(input: ComandoCicloVidaCompromiso): Promise<ResultadoMutacionCompromiso> {
    return this.lifecycle.transition(input)
  }

  compensateCommitment(input: ComandoCompensacion): Promise<ResultadoMutacionCompromiso> {
    return this.lifecycle.compensate(input)
  }

  async getCommitment(context: TusCommandContext, commitmentId: string): Promise<TusCommitmentReadResult> {
    assertCommandContext(context)
    const commitment = await this.lookupCommitment(commitmentId)
    if (!commitment) return { status: 'not_found' }
    if (commitment.tenantId !== context.tenantId) return { status: 'forbidden' }
    return { status: 'found', commitment }
  }

  async lookupCommitment(commitmentId: string): Promise<TusCommitment | null> {
    const commitment = await this.dependencies.commitments.find(commitmentId)
    if (commitment) return commitment
    return this.marketplace?.store.commitments.find(commitmentId) ?? null
  }

  async recordDeliveryProof(
    context: TusAuthenticatedTenantContext,
    input: Omit<DeliveryProof, 'tenantId' | 'commitmentId'>,
    expectedVersion: number,
  ): Promise<DeliveryTask> {
    if (!this.delivery) throw new Error('TUS delivery composition is unavailable')
    const task = await this.delivery.recordProof(context, input, expectedVersion)
    if (this.finance && task.proof && await this.lookupCommitment(task.commitmentId)) {
      await this.finance.recordEvidence({
        tenantId: context.tenantId,
        actorId: context.subjectId,
        correlationId: context.correlationId,
        commitmentId: task.commitmentId,
        evidenceId: task.proof.proofId,
        kind: 'delivery-accepted',
        occurredAt: task.proof.capturedAt,
      })
    }
    return task
  }

  async handoffDelivery(context: TusAuthenticatedTenantContext, taskId: string, expectedVersion: number): Promise<DeliveryTask> {
    if (!this.delivery) throw new Error('TUS delivery composition is unavailable')
    return this.delivery.transitionTask(context, taskId, 'handed-off', expectedVersion)
  }

  evaluateRelease(input: ReleaseEligibilityInput): ReleaseEligibility {
    return isReleaseEligible({
      ...input,
      localReleaseAfterMs: input.localReleaseAfterMs ?? this.dependencies.releasePolicy?.localReleaseAfterMs,
    })
  }

  isContextEnabled(context: string): context is TusBoundedContext {
    return (TUS_BOUNDED_CONTEXTS as readonly string[]).includes(context)
  }
}

function crearReferenciasAuditoria(
  input: TusCheckoutCommand,
  commitments: readonly TusCommitment[],
): ReferenciaAuditoria[] {
  return commitments.map((commitment) => ({
    referenceId: `audit-${commitment.commitmentId}`,
    tenantId: input.tenantId,
    actorId: input.actorId,
    correlationId: input.correlationId,
    commitmentId: commitment.commitmentId,
    referenceType: 'commitment.created',
    createdAt: input.createdAt,
  }))
}

function createCheckoutEvent(
  input: TusCheckoutCommand,
  commitments: readonly TusCommitment[],
  auditReferences: readonly ReferenciaAuditoria[],
  createdAt: number,
): TusOutboxRecord {
  return {
    eventId: `outbox-${input.cartId}`,
    tenantId: input.tenantId,
    eventType: 'tus.checkout.created',
    aggregateId: input.cartId,
    payload: {
      commitmentIds: commitments.map((commitment) => commitment.commitmentId),
      auditReferenceIds: auditReferences.map((reference) => reference.referenceId),
      ...(commitments.length === 1 && commitments[0] ? { commitmentContext: commitments[0].context } : {}),
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      ...(commitments.length === 1 && commitments[0] ? { workflowRunId: `tus-commitment-${commitments[0].context}-${commitments[0].commitmentId}` } : {}),
    },
    createdAt,
    status: 'pending',
    attempts: 0,
    availableAt: createdAt,
    lastError: null,
    claimId: null,
    claimUntil: null,
  }
}

function assertCommandContext(input: Pick<TusCommandContext, 'tenantId' | 'actorId' | 'correlationId'>): void {
  if (!input.tenantId.trim() || !input.actorId.trim() || !input.correlationId.trim()) {
    throw new Error('tenant authorization context is required')
  }
}

export default { TusApplicationService }
