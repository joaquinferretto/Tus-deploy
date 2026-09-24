import {
  ESTADOS_DIAGNOSTICO,
  ESTADOS_PRESUPUESTO,
  ESTADOS_TRABAJO,
  FASES_EVIDENCIA_TRABAJO,
  TUS_CONTRACT_VERSION,
  type AceptacionPresupuesto,
  type Diagnostico,
  type EstadoDiagnostico,
  type EstadoPresupuesto,
  type EstadoTrabajo,
  type EvidenciaTrabajo,
  type FaseEvidenciaTrabajo,
  type LineaPresupuesto,
  type Presupuesto,
  type Trabajo,
} from '@factory/contracts'
import {
  publicationRequiresBudget,
  type MarketplaceCommitment,
  type Publicacion,
} from '../catalog/index.ts'

export interface TrabajoContext {
  tenantId: string
  actorId: string
  correlationId: string
}

export interface ComandoAceptarCompromisoTrabajo extends TrabajoContext {
  commitment: MarketplaceCommitment
  publication: Publicacion
  reservationId?: string
  idempotencyKey: string
  requestHash: string
  createdAt: string
}

export interface ComandoDiagnostico extends TrabajoContext {
  trabajoId: string
  descripcionOriginal: string
  datosEstructurados?: Record<string, unknown>
  idempotencyKey: string
  requestHash: string
  createdAt: string
}

export interface ComandoConfirmarDiagnostico extends TrabajoContext {
  trabajoId: string
  diagnosticoId: string
  expectedVersion: number
  idempotencyKey: string
  requestHash: string
  createdAt: string
}

export interface ComandoPresupuesto extends TrabajoContext {
  trabajoId: string
  currency: string
  scope: string
  totalMinor: string
  lines: LineaPresupuesto[]
  validUntil?: string | null
  idempotencyKey: string
  requestHash: string
  createdAt: string
}

export interface ComandoDecisionPresupuesto extends TrabajoContext {
  trabajoId: string
  presupuestoId: string
  presupuestoVersion: number
  decision: 'accepted' | 'rejected'
  reason?: string
  acceptanceId?: string
  idempotencyKey: string
  requestHash: string
  createdAt: string
}

export interface ComandoEvidenciaTrabajo extends TrabajoContext {
  trabajoId: string
  evidenceId: string
  phase: FaseEvidenciaTrabajo
  reference: string
  metadata: Record<string, unknown>
  occurredAt: string
  idempotencyKey: string
  requestHash: string
  createdAt: string
}

export interface ComandoTransicionTrabajo extends TrabajoContext {
  trabajoId: string
  expectedVersion: number
  idempotencyKey: string
  requestHash: string
  createdAt: string
}

export interface TransicionTrabajo {
  transitionId: string
  tenantId: string
  trabajoId: string
  previousStatus: EstadoTrabajo | null
  status: EstadoTrabajo
  version: number
  actorId: string
  correlationId: string
  reason: string
  createdAt: string
}

export interface AuditoriaTrabajo {
  auditId: string
  tenantId: string
  trabajoTenantId: string
  prestadorTenantId: string
  trabajoId: string
  actorId: string
  correlationId: string
  action: string
  resourceType: string
  resourceId: string
  outcome: 'allowed' | 'denied'
  metadata: Record<string, unknown>
  createdAt: string
}

export interface PresupuestoPersistido extends Presupuesto {
  recordId: string
  correlationId: string
}

export interface TrabajoDetalle {
  work: Trabajo
  diagnoses: Diagnostico[]
  budgets: Presupuesto[]
  evidence: EvidenciaTrabajo[]
  transitions: TransicionTrabajo[]
}

export type TrabajoMutation<T extends Record<string, unknown>> = Promise<
  { status: 'executed' | 'replay' } & T
>

export interface TrabajoStorePort {
  findAccessible(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null>
  findByCommitment(input: { tenantId: string; commitmentId: string }): Promise<Trabajo | null>
  listAccessible(tenantId: string): Promise<Trabajo[]>
  createWork(work: Trabajo): Promise<void>
  updateWork(input: {
    tenantId: string
    trabajoId: string
    expectedVersion: number
    work: Trabajo
  }): Promise<Trabajo | null>
  appendTransition(transition: TransicionTrabajo): Promise<void>
  listTransitions(input: { tenantId: string; trabajoId: string }): Promise<TransicionTrabajo[]>
  findDiagnosis(input: {
    tenantId: string
    trabajoId: string
    diagnosticoId: string
  }): Promise<Diagnostico | null>
  listDiagnoses(input: { tenantId: string; trabajoId: string }): Promise<Diagnostico[]>
  createDiagnosis(diagnosis: Diagnostico): Promise<void>
  updateDiagnosis(input: {
    tenantId: string
    trabajoId: string
    diagnosticoId: string
    expectedVersion: number
    diagnosis: Diagnostico
  }): Promise<Diagnostico | null>
  findBudget(input: {
    tenantId: string
    trabajoId: string
    presupuestoId: string
    version: number
  }): Promise<PresupuestoPersistido | null>
  listBudgets(input: { tenantId: string; trabajoId: string }): Promise<PresupuestoPersistido[]>
  createBudget(budget: PresupuestoPersistido): Promise<void>
  updateBudgetStatus(input: {
    recordId: string
    expectedStatus: EstadoPresupuesto
    status: EstadoPresupuesto
    updatedAt: string
  }): Promise<PresupuestoPersistido | null>
  findBudgetDecision(input: {
    tenantId: string
    recordId: string
  }): Promise<AceptacionPresupuesto | null>
  createBudgetDecision(
    decision: AceptacionPresupuesto & { budgetRecordId: string; correlationId: string }
  ): Promise<void>
  findEvidence(input: { tenantId: string; evidenceId: string }): Promise<EvidenciaTrabajo | null>
  listEvidence(input: { tenantId: string; trabajoId: string }): Promise<EvidenciaTrabajo[]>
  createEvidence(evidence: EvidenciaTrabajo): Promise<void>
  appendAudit(audit: AuditoriaTrabajo): Promise<void>
}

export interface TrabajoIdempotencyClaim {
  status: 'claimed' | 'replay' | 'in_progress' | 'conflict'
  response?: unknown
}

export interface TrabajoIdempotencyPort {
  claim(input: {
    tenantId: string
    key: string
    requestHash: string
    now: number
    expiresAt: number
  }): Promise<TrabajoIdempotencyClaim>
  complete(input: { tenantId: string; key: string; response: unknown }): Promise<void>
  release(input: { tenantId: string; key: string }): Promise<void>
}

export interface TrabajoOutboxRecord {
  eventId: string
  tenantId: string
  aggregateId: string
  eventType: string
  payload: Record<string, unknown>
  createdAt: number
}

export interface TrabajoOutboxPort {
  append(record: TrabajoOutboxRecord): Promise<void>
  list(tenantId: string): TrabajoOutboxRecord[]
}

export interface TrabajoTransactionRepositories {
  work: TrabajoStorePort
  idempotency: TrabajoIdempotencyPort
  outbox: TrabajoOutboxPort
}

export interface TrabajoTransactionPort {
  run<TValue>(
    operation: (repositories: TrabajoTransactionRepositories) => Promise<TValue>
  ): Promise<TValue>
}

export class TrabajoError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'TrabajoError'
    this.status = status
    this.code = code
  }
}

export class ServicioTrabajo {
  private readonly transaction: TrabajoTransactionPort
  private readonly now: () => number

  constructor(transaction: TrabajoTransactionPort, now: () => number = () => Date.now()) {
    this.transaction = transaction
    this.now = now
  }

  async acceptCommitment(
    input: ComandoAceptarCompromisoTrabajo
  ): TrabajoMutation<{ work: Trabajo }> {
    validateMutationContext(input)
    if (input.commitment.context !== 'service')
      throw new TrabajoError(409, 'INVALID_COMMITMENT', 'only service commitments can create work')
    if (
      !input.publication.published ||
      input.publication.kind !== 'service' ||
      input.publication.listingId !== input.commitment.listingId
    )
      throw new TrabajoError(409, 'INVALID_PUBLICATION', 'commitment publication is not active')
    if (
      input.publication.tenantId !== input.tenantId ||
      input.publication.merchantId !== input.commitment.merchantId
    )
      throw new TrabajoError(403, 'FORBIDDEN', 'provider does not own the commitment publication')
    if (!['pending', 'confirmed'].includes(input.commitment.status))
      throw new TrabajoError(
        409,
        'INVALID_COMMITMENT_STATUS',
        'commitment is not available for provider acceptance'
      )

    return this.execute(input, async (repositories) => {
      const existing = await repositories.work.findByCommitment({
        tenantId: input.commitment.tenantId,
        commitmentId: input.commitment.commitmentId,
      })
      if (existing) {
        if (existing.prestadorTenantId !== input.tenantId)
          throw new TrabajoError(
            403,
            'FORBIDDEN',
            'work is outside the authenticated provider tenant'
          )
        return { work: existing }
      }

      const createdAt = input.createdAt
      const work: Trabajo = {
        contractVersion: TUS_CONTRACT_VERSION,
        trabajoId: `trabajo-${input.commitment.tenantId}-${input.commitment.commitmentId}`,
        tenantId: input.commitment.tenantId,
        prestadorTenantId: input.tenantId,
        commitmentId: input.commitment.commitmentId,
        prestadorId: input.commitment.merchantId,
        publicacionId: input.commitment.listingId,
        ...(input.reservationId ? { reservaId: input.reservationId } : {}),
        clienteId: input.commitment.tenantId,
        status: ESTADOS_TRABAJO.SOLICITADO,
        version: 1,
        budgetRequired: publicationRequiresBudget(input.publication),
        acceptedBudgetId: null,
        acceptedBudgetVersion: null,
        createdAt,
        updatedAt: createdAt,
      }
      await repositories.work.createWork(work)
      await repositories.work.appendTransition(initialTransition(work, input))
      await this.recordChange(repositories, input, work, 'work.accepted', 'work', work.trabajoId, {
        commitmentId: work.commitmentId,
      })
      await this.publish(repositories, work, 'tus.work.accepted', {
        commitmentId: work.commitmentId,
        providerTenantId: work.prestadorTenantId,
      })
      return { work }
    })
  }

  async getWork(context: TrabajoContext, trabajoId: string): Promise<TrabajoDetalle> {
    validateContext(context)
    return this.transaction.run(async ({ work: store }) => {
      const work = await store.findAccessible({ tenantId: context.tenantId, trabajoId })
      if (!work) throw new TrabajoError(404, 'NOT_FOUND', 'work was not found')
      return {
        work,
        diagnoses: await store.listDiagnoses({
          tenantId: work.tenantId,
          trabajoId: work.trabajoId,
        }),
        budgets: (
          await store.listBudgets({ tenantId: work.tenantId, trabajoId: work.trabajoId })
        ).map(({ recordId: _recordId, correlationId: _correlationId, ...budget }) => budget),
        evidence: await store.listEvidence({ tenantId: work.tenantId, trabajoId: work.trabajoId }),
        transitions: await store.listTransitions({
          tenantId: work.tenantId,
          trabajoId: work.trabajoId,
        }),
      }
    })
  }

  async listWorks(context: TrabajoContext): Promise<Trabajo[]> {
    validateContext(context)
    return this.transaction.run(async ({ work: store }) => store.listAccessible(context.tenantId))
  }

  async createDiagnosis(
    input: ComandoDiagnostico
  ): TrabajoMutation<{ diagnosis: Diagnostico; work: Trabajo }> {
    validateMutationContext(input)
    requireText(input.descripcionOriginal, 'descripcionOriginal')
    return this.execute(input, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      if (
        hasWorkStatus(work.status, [
          ESTADOS_TRABAJO.COMPLETADO,
          ESTADOS_TRABAJO.CANCELADO,
          ESTADOS_TRABAJO.EN_PROGRESO,
        ])
      )
        throw new TrabajoError(
          409,
          'INVALID_STATE',
          'diagnosis cannot be added in the current work state'
        )
      const diagnoses = await repositories.work.listDiagnoses({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
      })
      const version =
        diagnoses.reduce((highest, diagnosis) => Math.max(highest, diagnosis.version), 0) + 1
      const diagnosis: Diagnostico = {
        contractVersion: TUS_CONTRACT_VERSION,
        diagnosticoId: `diagnostico-${work.trabajoId}-${version}`,
        trabajoId: work.trabajoId,
        tenantId: work.tenantId,
        version,
        status: ESTADOS_DIAGNOSTICO.BORRADOR,
        originalDescription: input.descripcionOriginal,
        ...(input.datosEstructurados
          ? { structuredData: structuredClone(input.datosEstructurados) }
          : {}),
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        confirmedAt: null,
      }
      await repositories.work.createDiagnosis(diagnosis)
      const updatedWork =
        work.status === ESTADOS_TRABAJO.SOLICITADO
          ? await this.transition(
              repositories,
              input,
              work,
              ESTADOS_TRABAJO.EN_DIAGNOSTICO,
              'diagnosis.created'
            )
          : work
      await this.recordChange(
        repositories,
        input,
        updatedWork,
        'diagnosis.created',
        'diagnosis',
        diagnosis.diagnosticoId,
        { version }
      )
      await this.publish(repositories, updatedWork, 'tus.work.diagnosis_created', {
        diagnosisId: diagnosis.diagnosticoId,
        version,
      })
      return { diagnosis, work: updatedWork }
    })
  }

  async confirmDiagnosis(
    input: ComandoConfirmarDiagnostico
  ): TrabajoMutation<{ diagnosis: Diagnostico }> {
    validateMutationContext(input)
    requirePositiveInteger(input.expectedVersion, 'expectedVersion')
    return this.execute(input, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      const current = await repositories.work.findDiagnosis({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
        diagnosticoId: input.diagnosticoId,
      })
      if (!current) throw new TrabajoError(404, 'NOT_FOUND', 'diagnosis was not found')
      if (current.status === ESTADOS_DIAGNOSTICO.CONFIRMADO) return { diagnosis: current }
      if (current.status !== ESTADOS_DIAGNOSTICO.BORRADOR)
        throw new TrabajoError(409, 'INVALID_STATE', 'diagnosis cannot be confirmed')
      if (current.version !== input.expectedVersion)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'diagnosis version is stale')
      const diagnosis: Diagnostico = {
        ...current,
        status: ESTADOS_DIAGNOSTICO.CONFIRMADO,
        version: current.version + 1,
        confirmedAt: input.createdAt,
        updatedAt: input.createdAt,
      }
      const persisted = await repositories.work.updateDiagnosis({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
        diagnosticoId: input.diagnosticoId,
        expectedVersion: input.expectedVersion,
        diagnosis,
      })
      if (!persisted) throw new TrabajoError(409, 'VERSION_CONFLICT', 'diagnosis version is stale')
      await this.recordChange(
        repositories,
        input,
        work,
        'diagnosis.confirmed',
        'diagnosis',
        diagnosis.diagnosticoId,
        { version: diagnosis.version }
      )
      await this.publish(repositories, work, 'tus.work.diagnosis_confirmed', {
        diagnosisId: diagnosis.diagnosticoId,
        version: diagnosis.version,
      })
      return { diagnosis: persisted }
    })
  }

  async createBudget(
    input: ComandoPresupuesto
  ): TrabajoMutation<{ budget: Presupuesto; work: Trabajo }> {
    validateMutationContext(input)
    requireText(input.currency, 'currency')
    requireText(input.scope, 'scope')
    validateMinorAmount(input.totalMinor, 'totalMinor')
    validateBudgetLines(input.lines, input.totalMinor)
    if (
      input.validUntil !== undefined &&
      input.validUntil !== null &&
      (!isIsoTimestamp(input.validUntil) || Date.parse(input.validUntil) <= this.now())
    )
      throw new TrabajoError(400, 'INVALID', 'validUntil must be in the future')
    return this.execute(input, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      if (!work.budgetRequired)
        throw new TrabajoError(409, 'BUDGET_NOT_REQUIRED', 'publication does not require a budget')
      if (
        !hasWorkStatus(work.status, [
          ESTADOS_TRABAJO.SOLICITADO,
          ESTADOS_TRABAJO.EN_DIAGNOSTICO,
          ESTADOS_TRABAJO.PRESUPUESTO_PENDIENTE,
        ])
      )
        throw new TrabajoError(
          409,
          'INVALID_STATE',
          'budget cannot be created in the current work state'
        )
      const budgets = await repositories.work.listBudgets({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
      })
      const version = budgets.reduce((highest, budget) => Math.max(highest, budget.version), 0) + 1
      const budget: Presupuesto = {
        contractVersion: TUS_CONTRACT_VERSION,
        presupuestoId: `presupuesto-${work.trabajoId}`,
        trabajoId: work.trabajoId,
        tenantId: work.tenantId,
        prestadorTenantId: work.prestadorTenantId,
        version,
        status: ESTADOS_PRESUPUESTO.EMITIDO,
        currency: input.currency,
        totalMinor: input.totalMinor,
        scope: input.scope,
        validUntil: input.validUntil ?? null,
        createdBy: input.actorId,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        lines: structuredClone(input.lines),
      }
      const persistedBudget: PresupuestoPersistido = {
        ...budget,
        recordId: `${budget.presupuestoId}:${budget.version}`,
        correlationId: input.correlationId,
      }
      await repositories.work.createBudget(persistedBudget)
      const updatedWork =
        work.status === ESTADOS_TRABAJO.PRESUPUESTO_PENDIENTE
          ? work
          : await this.transition(
              repositories,
              input,
              work,
              ESTADOS_TRABAJO.PRESUPUESTO_PENDIENTE,
              'budget.issued'
            )
      await this.recordChange(
        repositories,
        input,
        updatedWork,
        'budget.issued',
        'budget',
        `${budget.presupuestoId}:${budget.version}`,
        { version }
      )
      await this.publish(repositories, updatedWork, 'tus.work.budget_issued', {
        budgetId: budget.presupuestoId,
        version,
      })
      return { budget, work: updatedWork }
    })
  }

  async decideBudget(
    input: ComandoDecisionPresupuesto
  ): TrabajoMutation<{ budget: Presupuesto; acceptance: AceptacionPresupuesto; work: Trabajo }> {
    validateMutationContext(input)
    requirePositiveInteger(input.presupuestoVersion, 'presupuestoVersion')
    if (input.decision === 'rejected') requireText(input.reason ?? '', 'reason')
    return this.execute(input, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureCustomer(work, input)
      const budget = await repositories.work.findBudget({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
        presupuestoId: input.presupuestoId,
        version: input.presupuestoVersion,
      })
      if (!budget) throw new TrabajoError(404, 'NOT_FOUND', 'budget was not found')
      const existing = await repositories.work.findBudgetDecision({
        tenantId: work.tenantId,
        recordId: budget.recordId,
      })
      if (existing) {
        if (existing.decision !== input.decision)
          throw new TrabajoError(409, 'ALREADY_DECIDED', 'budget already has another decision')
        return { budget, acceptance: existing, work }
      }
      if (work.status !== ESTADOS_TRABAJO.PRESUPUESTO_PENDIENTE)
        throw new TrabajoError(
          409,
          'INVALID_STATE',
          'budget cannot be decided in the current work state'
        )
      if (budget.status !== ESTADOS_PRESUPUESTO.EMITIDO)
        throw new TrabajoError(409, 'INVALID_STATE', 'budget is not awaiting a decision')
      const budgets = await repositories.work.listBudgets({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
      })
      if (budgets.some((candidate) => candidate.version > budget.version))
        throw new TrabajoError(
          409,
          'SUPERSEDED_BUDGET',
          'only the latest budget version can be decided'
        )
      if (budget.validUntil && Date.parse(budget.validUntil) <= this.now())
        throw new TrabajoError(409, 'EXPIRED', 'budget has expired')
      const acceptance: AceptacionPresupuesto = {
        contractVersion: TUS_CONTRACT_VERSION,
        acceptanceId:
          input.acceptanceId ??
          `aceptacion-${budget.presupuestoId}-${budget.version}-${input.decision}`,
        presupuestoId: budget.presupuestoId,
        presupuestoVersion: budget.version,
        trabajoId: work.trabajoId,
        tenantId: work.tenantId,
        actorId: input.actorId,
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
        createdAt: input.createdAt,
      }
      const updatedBudget = await repositories.work.updateBudgetStatus({
        recordId: budget.recordId,
        expectedStatus: ESTADOS_PRESUPUESTO.EMITIDO,
        status: input.decision,
        updatedAt: input.createdAt,
      })
      if (!updatedBudget)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'budget was changed concurrently')
      const status =
        input.decision === 'accepted'
          ? ESTADOS_TRABAJO.ACEPTADO
          : ESTADOS_TRABAJO.PRESUPUESTO_PENDIENTE
      const nextWork: Trabajo = {
        ...work,
        status,
        version: work.version + 1,
        acceptedBudgetId: input.decision === 'accepted' ? budget.presupuestoId : null,
        acceptedBudgetVersion: input.decision === 'accepted' ? budget.version : null,
        updatedAt: input.createdAt,
      }
      const updatedWork = await repositories.work.updateWork({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
        expectedVersion: work.version,
        work: nextWork,
      })
      if (!updatedWork) throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      await repositories.work.createBudgetDecision({
        ...acceptance,
        budgetRecordId: budget.recordId,
        correlationId: input.correlationId,
      })
      await repositories.work.appendTransition({
        transitionId: `transicion-${updatedWork.trabajoId}-${updatedWork.version}`,
        tenantId: updatedWork.tenantId,
        trabajoId: updatedWork.trabajoId,
        previousStatus: work.status,
        status,
        version: updatedWork.version,
        actorId: input.actorId,
        correlationId: input.correlationId,
        reason: `budget.${input.decision}`,
        createdAt: input.createdAt,
      })
      await this.recordChange(
        repositories,
        input,
        updatedWork,
        `budget.${input.decision}`,
        'budget',
        `${budget.presupuestoId}:${budget.version}`,
        { version: budget.version, decision: input.decision }
      )
      await this.publish(repositories, updatedWork, 'tus.work.budget_decided', {
        budgetId: budget.presupuestoId,
        version: budget.version,
        decision: input.decision,
      })
      return { budget: updatedBudget, acceptance, work: updatedWork }
    })
  }

  async startWork(input: ComandoTransicionTrabajo): TrabajoMutation<{ work: Trabajo }> {
    validateMutationContext(input)
    requirePositiveInteger(input.expectedVersion, 'expectedVersion')
    return this.execute(input, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      if (work.budgetRequired && work.status !== ESTADOS_TRABAJO.ACEPTADO)
        throw new TrabajoError(
          409,
          'BUDGET_REQUIRED',
          'an accepted budget is required before work can start'
        )
      if (
        !hasWorkStatus(work.status, [
          ESTADOS_TRABAJO.SOLICITADO,
          ESTADOS_TRABAJO.EN_DIAGNOSTICO,
          ESTADOS_TRABAJO.ACEPTADO,
        ])
      )
        throw new TrabajoError(409, 'INVALID_STATE', 'work cannot start in the current state')
      if (work.version !== input.expectedVersion)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      const updated = await this.transition(
        repositories,
        input,
        work,
        ESTADOS_TRABAJO.EN_PROGRESO,
        'work.started'
      )
      await this.publish(repositories, updated, 'tus.work.started', {})
      return { work: updated }
    })
  }

  async completeWork(input: ComandoTransicionTrabajo): TrabajoMutation<{ work: Trabajo }> {
    validateMutationContext(input)
    requirePositiveInteger(input.expectedVersion, 'expectedVersion')
    return this.execute(input, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      if (work.version !== input.expectedVersion)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      if (work.status !== ESTADOS_TRABAJO.EN_PROGRESO)
        throw new TrabajoError(409, 'INVALID_STATE', 'only active work can be completed')
      const updated = await this.transition(
        repositories,
        input,
        work,
        ESTADOS_TRABAJO.COMPLETADO,
        'work.completed'
      )
      await this.publish(repositories, updated, 'tus.work.completed', {})
      return { work: updated }
    })
  }

  async cancelWork(input: ComandoTransicionTrabajo): TrabajoMutation<{ work: Trabajo }> {
    validateMutationContext(input)
    requirePositiveInteger(input.expectedVersion, 'expectedVersion')
    return this.execute(input, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      if (work.version !== input.expectedVersion)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      if (hasWorkStatus(work.status, [ESTADOS_TRABAJO.COMPLETADO, ESTADOS_TRABAJO.CANCELADO]))
        throw new TrabajoError(
          409,
          'INVALID_STATE',
          'work cannot be cancelled in the current state'
        )
      const updated = await this.transition(
        repositories,
        input,
        work,
        ESTADOS_TRABAJO.CANCELADO,
        'work.cancelled'
      )
      await this.publish(repositories, updated, 'tus.work.cancelled', {})
      return { work: updated }
    })
  }

  async recordEvidence(
    input: ComandoEvidenciaTrabajo
  ): TrabajoMutation<{ evidence: EvidenciaTrabajo }> {
    validateMutationContext(input)
    requireText(input.evidenceId, 'evidenceId')
    requireText(input.reference, 'reference')
    if (!Object.values(FASES_EVIDENCIA_TRABAJO).includes(input.phase))
      throw new TrabajoError(400, 'INVALID', 'phase is invalid')
    if (!isIsoTimestamp(input.occurredAt))
      throw new TrabajoError(400, 'INVALID', 'occurredAt must be a valid timestamp')
    return this.execute(input, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      if (work.status === ESTADOS_TRABAJO.CANCELADO)
        throw new TrabajoError(409, 'INVALID_STATE', 'cancelled work cannot receive evidence')
      if (
        input.phase === FASES_EVIDENCIA_TRABAJO.CIERRE &&
        !hasWorkStatus(work.status, [ESTADOS_TRABAJO.EN_PROGRESO, ESTADOS_TRABAJO.COMPLETADO])
      )
        throw new TrabajoError(
          409,
          'INVALID_STATE',
          'completion evidence requires active or completed work'
        )
      const existing = await repositories.work.findEvidence({
        tenantId: work.tenantId,
        evidenceId: input.evidenceId,
      })
      if (existing) {
        if (existing.trabajoId !== work.trabajoId)
          throw new TrabajoError(409, 'CONFLICT', 'evidence id belongs to another work')
        return { evidence: existing }
      }
      const evidence: EvidenciaTrabajo = {
        contractVersion: TUS_CONTRACT_VERSION,
        evidenceId: input.evidenceId,
        trabajoId: work.trabajoId,
        tenantId: work.tenantId,
        prestadorTenantId: work.prestadorTenantId,
        phase: input.phase,
        actorId: input.actorId,
        correlationId: input.correlationId,
        reference: input.reference,
        metadata: structuredClone(input.metadata),
        occurredAt: input.occurredAt,
        createdAt: input.createdAt,
      }
      await repositories.work.createEvidence(evidence)
      await this.recordChange(
        repositories,
        input,
        work,
        'evidence.recorded',
        'evidence',
        evidence.evidenceId,
        { phase: evidence.phase }
      )
      await this.publish(repositories, work, 'tus.work.evidence_recorded', {
        evidenceId: evidence.evidenceId,
        phase: evidence.phase,
      })
      return { evidence }
    })
  }

  private async requireWork(
    store: TrabajoStorePort,
    context: TrabajoContext & { trabajoId: string }
  ): Promise<Trabajo> {
    const work = await store.findAccessible({
      tenantId: context.tenantId,
      trabajoId: context.trabajoId,
    })
    if (!work) throw new TrabajoError(404, 'NOT_FOUND', 'work was not found')
    return work
  }

  private async transition(
    repositories: TrabajoTransactionRepositories,
    input: TrabajoContext & { createdAt: string },
    work: Trabajo,
    status: EstadoTrabajo,
    reason: string
  ): Promise<Trabajo> {
    const updated: Trabajo = {
      ...work,
      status,
      version: work.version + 1,
      updatedAt: input.createdAt,
    }
    const persisted = await repositories.work.updateWork({
      tenantId: work.tenantId,
      trabajoId: work.trabajoId,
      expectedVersion: work.version,
      work: updated,
    })
    if (!persisted) throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
    await repositories.work.appendTransition({
      transitionId: `transicion-${persisted.trabajoId}-${persisted.version}`,
      tenantId: persisted.tenantId,
      trabajoId: persisted.trabajoId,
      previousStatus: work.status,
      status,
      version: persisted.version,
      actorId: input.actorId,
      correlationId: input.correlationId,
      reason,
      createdAt: input.createdAt,
    })
    await this.recordChange(repositories, input, persisted, reason, 'work', persisted.trabajoId, {
      previousStatus: work.status,
      status,
    })
    return persisted
  }

  private async recordChange(
    repositories: TrabajoTransactionRepositories,
    input: TrabajoContext,
    work: Trabajo,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await repositories.work.appendAudit({
      auditId: `auditoria-${work.trabajoId}-${action}-${resourceId}`,
      tenantId: input.tenantId,
      trabajoTenantId: work.tenantId,
      prestadorTenantId: work.prestadorTenantId,
      trabajoId: work.trabajoId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      action,
      resourceType,
      resourceId,
      outcome: 'allowed',
      metadata: structuredClone(metadata),
      createdAt:
        'createdAt' in input && typeof input.createdAt === 'string'
          ? input.createdAt
          : new Date(this.now()).toISOString(),
    })
  }

  private async publish(
    repositories: TrabajoTransactionRepositories,
    work: Trabajo,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await repositories.outbox.append({
      eventId: `evento-${work.trabajoId}-${eventType}-${work.version}-${JSON.stringify(payload)}`,
      tenantId: work.tenantId,
      aggregateId: work.trabajoId,
      eventType,
      payload: { workId: work.trabajoId, providerTenantId: work.prestadorTenantId, ...payload },
      createdAt: this.now(),
    })
  }

  private async execute<T extends Record<string, unknown>>(
    input: TrabajoContext & { idempotencyKey: string; requestHash: string; createdAt: string },
    operation: (repositories: TrabajoTransactionRepositories) => Promise<T>
  ): Promise<{ status: 'executed' | 'replay' } & T> {
    return this.transaction.run(async (repositories) => {
      const now = this.now()
      const claim = await repositories.idempotency.claim({
        tenantId: input.tenantId,
        key: input.idempotencyKey,
        requestHash: input.requestHash,
        now,
        expiresAt: now + 15 * 60 * 1000,
      })
      if (claim.status === 'conflict')
        throw new TrabajoError(
          409,
          'CONFLICT',
          'idempotency key was already used for another request'
        )
      if (claim.status === 'in_progress')
        throw new TrabajoError(409, 'IN_PROGRESS', 'the idempotent request is already in progress')
      if (claim.status === 'replay') {
        if (!isRecord(claim.response))
          throw new TrabajoError(500, 'INVALID_REPLAY', 'idempotency replay is invalid')
        return { status: 'replay', ...(claim.response as T) }
      }
      const response = await operation(repositories)
      await repositories.idempotency.complete({
        tenantId: input.tenantId,
        key: input.idempotencyKey,
        response,
      })
      return { status: 'executed', ...response }
    })
  }
}

export class InMemoryTrabajoStore implements TrabajoStorePort {
  private readonly works = new Map<string, Trabajo>()
  private readonly transitions = new Map<string, TransicionTrabajo>()
  private readonly diagnoses = new Map<string, Diagnostico>()
  private readonly budgets = new Map<string, PresupuestoPersistido>()
  private readonly decisions = new Map<string, AceptacionPresupuesto>()
  private readonly evidence = new Map<string, EvidenciaTrabajo>()
  private readonly audits = new Map<string, AuditoriaTrabajo>()

  async findAccessible(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null> {
    const work = [...this.works.values()].find(
      (candidate) =>
        candidate.trabajoId === input.trabajoId &&
        (candidate.tenantId === input.tenantId || candidate.prestadorTenantId === input.tenantId)
    )
    return work ? structuredClone(work) : null
  }

  async findByCommitment(input: {
    tenantId: string
    commitmentId: string
  }): Promise<Trabajo | null> {
    const work = this.works.get(workKey(input.tenantId, input.commitmentId))
    return work ? structuredClone(work) : null
  }

  async listAccessible(tenantId: string): Promise<Trabajo[]> {
    return [...this.works.values()]
      .filter((work) => work.tenantId === tenantId || work.prestadorTenantId === tenantId)
      .map((work) => structuredClone(work))
  }

  async createWork(work: Trabajo): Promise<void> {
    const key = workKey(work.tenantId, work.commitmentId)
    if (this.works.has(key))
      throw new TrabajoError(409, 'CONFLICT', 'work already exists for commitment')
    this.works.set(key, structuredClone(work))
  }

  async updateWork(input: {
    tenantId: string
    trabajoId: string
    expectedVersion: number
    work: Trabajo
  }): Promise<Trabajo | null> {
    const current = [...this.works.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId && candidate.trabajoId === input.trabajoId
    )
    if (!current || current.version !== input.expectedVersion) return null
    this.works.set(workKey(current.tenantId, current.commitmentId), structuredClone(input.work))
    return structuredClone(input.work)
  }

  async appendTransition(transition: TransicionTrabajo): Promise<void> {
    this.transitions.set(
      transitionKey(transition.tenantId, transition.trabajoId, transition.version),
      structuredClone(transition)
    )
  }

  async listTransitions(input: {
    tenantId: string
    trabajoId: string
  }): Promise<TransicionTrabajo[]> {
    return [...this.transitions.values()]
      .filter(
        (transition) =>
          transition.tenantId === input.tenantId && transition.trabajoId === input.trabajoId
      )
      .sort((left, right) => left.version - right.version)
      .map((transition) => structuredClone(transition))
  }

  async findDiagnosis(input: {
    tenantId: string
    trabajoId: string
    diagnosticoId: string
  }): Promise<Diagnostico | null> {
    const diagnosis = [...this.diagnoses.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.trabajoId === input.trabajoId &&
        candidate.diagnosticoId === input.diagnosticoId
    )
    return diagnosis ? structuredClone(diagnosis) : null
  }

  async listDiagnoses(input: { tenantId: string; trabajoId: string }): Promise<Diagnostico[]> {
    return [...this.diagnoses.values()]
      .filter(
        (diagnosis) =>
          diagnosis.tenantId === input.tenantId && diagnosis.trabajoId === input.trabajoId
      )
      .sort((left, right) => left.version - right.version)
      .map((diagnosis) => structuredClone(diagnosis))
  }

  async createDiagnosis(diagnosis: Diagnostico): Promise<void> {
    this.diagnoses.set(
      diagnosisKey(diagnosis.tenantId, diagnosis.diagnosticoId),
      structuredClone(diagnosis)
    )
  }

  async updateDiagnosis(input: {
    tenantId: string
    trabajoId: string
    diagnosticoId: string
    expectedVersion: number
    diagnosis: Diagnostico
  }): Promise<Diagnostico | null> {
    const current = await this.findDiagnosis(input)
    if (!current || current.version !== input.expectedVersion) return null
    this.diagnoses.set(
      diagnosisKey(input.tenantId, input.diagnosticoId),
      structuredClone(input.diagnosis)
    )
    return structuredClone(input.diagnosis)
  }

  async findBudget(input: {
    tenantId: string
    trabajoId: string
    presupuestoId: string
    version: number
  }): Promise<PresupuestoPersistido | null> {
    const budget = this.budgets.get(budgetKey(input.tenantId, input.presupuestoId, input.version))
    return budget && budget.trabajoId === input.trabajoId ? structuredClone(budget) : null
  }

  async listBudgets(input: {
    tenantId: string
    trabajoId: string
  }): Promise<PresupuestoPersistido[]> {
    return [...this.budgets.values()]
      .filter(
        (budget) => budget.tenantId === input.tenantId && budget.trabajoId === input.trabajoId
      )
      .sort((left, right) => left.version - right.version)
      .map((budget) => structuredClone(budget))
  }

  async createBudget(budget: PresupuestoPersistido): Promise<void> {
    const key = budgetKey(budget.tenantId, budget.presupuestoId, budget.version)
    if (this.budgets.has(key))
      throw new TrabajoError(409, 'CONFLICT', 'budget version already exists')
    this.budgets.set(key, structuredClone(budget))
  }

  async updateBudgetStatus(input: {
    recordId: string
    expectedStatus: EstadoPresupuesto
    status: EstadoPresupuesto
    updatedAt: string
  }): Promise<PresupuestoPersistido | null> {
    const budget = [...this.budgets.values()].find(
      (candidate) => candidate.recordId === input.recordId
    )
    if (!budget || budget.status !== input.expectedStatus) return null
    const updated = { ...budget, status: input.status, updatedAt: input.updatedAt }
    this.budgets.set(
      budgetKey(budget.tenantId, budget.presupuestoId, budget.version),
      structuredClone(updated)
    )
    return structuredClone(updated)
  }

  async findBudgetDecision(input: {
    tenantId: string
    recordId: string
  }): Promise<AceptacionPresupuesto | null> {
    const budget = [...this.budgets.values()].find(
      (candidate) => candidate.recordId === input.recordId && candidate.tenantId === input.tenantId
    )
    if (!budget) return null
    const decision = this.decisions.get(decisionKey(input.tenantId, input.recordId))
    return decision ? structuredClone(decision) : null
  }

  async createBudgetDecision(
    decision: AceptacionPresupuesto & { budgetRecordId: string; correlationId: string }
  ): Promise<void> {
    const key = decisionKey(decision.tenantId, decision.budgetRecordId)
    if (this.decisions.has(key))
      throw new TrabajoError(409, 'ALREADY_DECIDED', 'budget already has a decision')
    const {
      budgetRecordId: _budgetRecordId,
      correlationId: _correlationId,
      ...publicDecision
    } = decision
    this.decisions.set(key, structuredClone(publicDecision))
  }

  async findEvidence(input: {
    tenantId: string
    evidenceId: string
  }): Promise<EvidenciaTrabajo | null> {
    const evidence = this.evidence.get(`${input.tenantId}:${input.evidenceId}`)
    return evidence ? structuredClone(evidence) : null
  }

  async listEvidence(input: { tenantId: string; trabajoId: string }): Promise<EvidenciaTrabajo[]> {
    return [...this.evidence.values()]
      .filter((item) => item.tenantId === input.tenantId && item.trabajoId === input.trabajoId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((item) => structuredClone(item))
  }

  async createEvidence(evidence: EvidenciaTrabajo): Promise<void> {
    this.evidence.set(`${evidence.tenantId}:${evidence.evidenceId}`, structuredClone(evidence))
  }

  async appendAudit(audit: AuditoriaTrabajo): Promise<void> {
    this.audits.set(audit.auditId, structuredClone(audit))
  }

  snapshot() {
    return {
      works: new Map([...this.works].map(([key, value]) => [key, structuredClone(value)])),
      transitions: new Map(
        [...this.transitions].map(([key, value]) => [key, structuredClone(value)])
      ),
      diagnoses: new Map([...this.diagnoses].map(([key, value]) => [key, structuredClone(value)])),
      budgets: new Map([...this.budgets].map(([key, value]) => [key, structuredClone(value)])),
      decisions: new Map([...this.decisions].map(([key, value]) => [key, structuredClone(value)])),
      evidence: new Map([...this.evidence].map(([key, value]) => [key, structuredClone(value)])),
      audits: new Map([...this.audits].map(([key, value]) => [key, structuredClone(value)])),
    }
  }

  restore(snapshot: ReturnType<InMemoryTrabajoStore['snapshot']>): void {
    this.works.clear()
    this.transitions.clear()
    this.diagnoses.clear()
    this.budgets.clear()
    this.decisions.clear()
    this.evidence.clear()
    this.audits.clear()
    for (const [key, value] of snapshot.works) this.works.set(key, value)
    for (const [key, value] of snapshot.transitions) this.transitions.set(key, value)
    for (const [key, value] of snapshot.diagnoses) this.diagnoses.set(key, value)
    for (const [key, value] of snapshot.budgets) this.budgets.set(key, value)
    for (const [key, value] of snapshot.decisions) this.decisions.set(key, value)
    for (const [key, value] of snapshot.evidence) this.evidence.set(key, value)
    for (const [key, value] of snapshot.audits) this.audits.set(key, value)
  }
}

interface TrabajoIdempotencyRecord {
  tenantId: string
  key: string
  requestHash: string
  expiresAt: number
  response: unknown
}

export class InMemoryTrabajoIdempotencyStore implements TrabajoIdempotencyPort {
  private readonly records = new Map<string, TrabajoIdempotencyRecord>()

  async claim(input: {
    tenantId: string
    key: string
    requestHash: string
    now: number
    expiresAt: number
  }): Promise<TrabajoIdempotencyClaim> {
    const existing = this.records.get(`${input.tenantId}:${input.key}`)
    if (!existing || (existing.response === null && existing.expiresAt <= input.now)) {
      this.records.set(`${input.tenantId}:${input.key}`, {
        tenantId: input.tenantId,
        key: input.key,
        requestHash: input.requestHash,
        expiresAt: input.expiresAt,
        response: null,
      })
      return { status: 'claimed' }
    }
    if (existing.requestHash !== input.requestHash) return { status: 'conflict' }
    if (existing.response !== null)
      return { status: 'replay', response: structuredClone(existing.response) }
    return { status: 'in_progress' }
  }

  async complete(input: { tenantId: string; key: string; response: unknown }): Promise<void> {
    const record = this.records.get(`${input.tenantId}:${input.key}`)
    if (!record) throw new TrabajoError(500, 'IDEMPOTENCY_MISSING', 'idempotency claim is missing')
    record.response = structuredClone(input.response)
  }

  async release(input: { tenantId: string; key: string }): Promise<void> {
    this.records.delete(`${input.tenantId}:${input.key}`)
  }

  snapshot(): Map<string, TrabajoIdempotencyRecord> {
    return new Map([...this.records].map(([key, value]) => [key, structuredClone(value)]))
  }
  restore(snapshot: Map<string, TrabajoIdempotencyRecord>): void {
    this.records.clear()
    for (const [key, value] of snapshot) this.records.set(key, value)
  }
}

export class InMemoryTrabajoOutboxStore implements TrabajoOutboxPort {
  private readonly records = new Map<string, TrabajoOutboxRecord>()
  async append(record: TrabajoOutboxRecord): Promise<void> {
    if (!this.records.has(`${record.tenantId}:${record.eventId}`))
      this.records.set(`${record.tenantId}:${record.eventId}`, structuredClone(record))
  }
  list(tenantId: string): TrabajoOutboxRecord[] {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .map((record) => structuredClone(record))
  }
  snapshot(): Map<string, TrabajoOutboxRecord> {
    return new Map([...this.records].map(([key, value]) => [key, structuredClone(value)]))
  }
  restore(snapshot: Map<string, TrabajoOutboxRecord>): void {
    this.records.clear()
    for (const [key, value] of snapshot) this.records.set(key, value)
  }
}

export class InMemoryTrabajoTransaction implements TrabajoTransactionPort {
  private transactionTail: Promise<void> = Promise.resolve()
  constructor(
    private readonly repositories: {
      work: InMemoryTrabajoStore
      idempotency: InMemoryTrabajoIdempotencyStore
      outbox: InMemoryTrabajoOutboxStore
    }
  ) {}

  async run<TValue>(
    operation: (repositories: TrabajoTransactionRepositories) => Promise<TValue>
  ): Promise<TValue> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const snapshot = {
      work: this.repositories.work.snapshot(),
      idempotency: this.repositories.idempotency.snapshot(),
      outbox: this.repositories.outbox.snapshot(),
    }
    try {
      return await operation(this.repositories)
    } catch (error) {
      this.repositories.work.restore(snapshot.work)
      this.repositories.idempotency.restore(snapshot.idempotency)
      this.repositories.outbox.restore(snapshot.outbox)
      throw error
    } finally {
      release()
    }
  }
}

function initialTransition(
  work: Trabajo,
  input: TrabajoContext & { createdAt: string }
): TransicionTrabajo {
  return {
    transitionId: `transicion-${work.trabajoId}-${work.version}`,
    tenantId: work.tenantId,
    trabajoId: work.trabajoId,
    previousStatus: null,
    status: work.status,
    version: work.version,
    actorId: input.actorId,
    correlationId: input.correlationId,
    reason: 'work.accepted',
    createdAt: input.createdAt,
  }
}

function ensureProvider(work: Trabajo, context: TrabajoContext): void {
  if (work.prestadorTenantId !== context.tenantId)
    throw new TrabajoError(403, 'FORBIDDEN', 'provider tenant does not own the work')
}

function ensureCustomer(work: Trabajo, context: TrabajoContext): void {
  if (work.tenantId !== context.tenantId)
    throw new TrabajoError(403, 'FORBIDDEN', 'customer tenant does not own the work')
}

function validateContext(context: TrabajoContext): void {
  for (const field of ['tenantId', 'actorId', 'correlationId'] as const) {
    const value = context[field]
    if (typeof value !== 'string' || !value.trim())
      throw new TrabajoError(400, 'INVALID', `${field} is required`)
  }
}

function validateMutationContext(
  input: TrabajoContext & { idempotencyKey: string; requestHash: string; createdAt: string }
): void {
  validateContext(input)
  requireText(input.idempotencyKey, 'idempotencyKey')
  requireText(input.requestHash, 'requestHash')
  if (!isIsoTimestamp(input.createdAt))
    throw new TrabajoError(400, 'INVALID', 'createdAt must be a valid timestamp')
}

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new TrabajoError(400, 'INVALID', `${field} is required`)
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1)
    throw new TrabajoError(400, 'INVALID', `${field} must be a positive integer`)
}

function validateMinorAmount(value: string, field: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new TrabajoError(400, 'INVALID', `${field} must be a non-negative minor-unit amount`)
}

function validateBudgetLines(lines: LineaPresupuesto[], totalMinor: string): void {
  if (!Array.isArray(lines) || lines.length === 0)
    throw new TrabajoError(400, 'INVALID', 'at least one budget line is required')
  let total = 0n
  const ids = new Set<string>()
  for (const line of lines) {
    requireText(line.lineId, 'lineId')
    requireText(line.description, 'description')
    requirePositiveInteger(line.quantity, 'quantity')
    validateMinorAmount(line.unitAmountMinor, 'unitAmountMinor')
    validateMinorAmount(line.totalAmountMinor, 'totalAmountMinor')
    if (ids.has(line.lineId))
      throw new TrabajoError(400, 'INVALID', 'budget line ids must be unique')
    ids.add(line.lineId)
    if (BigInt(line.totalAmountMinor) !== BigInt(line.quantity) * BigInt(line.unitAmountMinor))
      throw new TrabajoError(
        400,
        'INVALID',
        'budget line total does not match quantity and unit amount'
      )
    total += BigInt(line.totalAmountMinor)
  }
  if (total !== BigInt(totalMinor))
    throw new TrabajoError(400, 'INVALID', 'budget total does not match its lines')
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function hasWorkStatus(status: EstadoTrabajo, allowed: readonly EstadoTrabajo[]): boolean {
  return allowed.includes(status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function workKey(tenantId: string, commitmentId: string): string {
  return `${tenantId}:${commitmentId}`
}
function transitionKey(tenantId: string, trabajoId: string, version: number): string {
  return `${tenantId}:${trabajoId}:${version}`
}
function diagnosisKey(tenantId: string, diagnosticoId: string): string {
  return `${tenantId}:${diagnosticoId}`
}
function budgetKey(tenantId: string, presupuestoId: string, version: number): string {
  return `${tenantId}:${presupuestoId}:${version}`
}
function decisionKey(tenantId: string, recordId: string): string {
  return `${tenantId}:${recordId}`
}

export default { ServicioTrabajo, TrabajoError }
