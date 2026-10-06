import { createHash } from 'node:crypto'
import { SerializadorEnMemoria } from '../domain/serializador-en-memoria.ts'
import {
  ESTADOS_DIAGNOSTICO,
  ESTADOS_PRESUPUESTO,
  ESTADOS_TRABAJO,
  FASES_EVIDENCIA_TRABAJO,
  TUS_CONTRACT_VERSION,
  type AceptacionPresupuesto,
  type Diagnostico,
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

// A client chose exactly one provider for a directory request. Every id comes from persisted
// facts resolved by the server (request owner's tenant, accepted application's provider), never
// from the HTTP body. `tenantId`/`actorId` are the client's (the actor who accepted).
export interface ComandoCrearTrabajoDesdeSolicitud extends TrabajoContext {
  solicitudId: string
  prestadorTenantId: string
  prestadorId: string
  createdAt: string
}

export function identificadorTrabajoSolicitud(solicitudId: string): string {
  return `trabajo-solicitud-${solicitudId}`
}

// TURNOS-SENA-01. Payment order of a CONFIRMED turno: money in TUS always hangs from a work, so a
// turno that has to charge its deposit gets one, bound to its reservation (one per reservation:
// uq_trabajos_reserva). Every value is a persisted fact of that reservation resolved by the
// server (its client, its provider), never a value of a request. `tenantId`/`actorId` are the
// client's. It is NOT a work the parties manage: the turno lives in its reservation, so this
// order is invisible to the work screens and commands and its state never changes.
export interface ComandoOrdenDeTurno extends TrabajoContext {
  reservaId: string
  prestadorTenantId: string
  prestadorId: string
  createdAt: string
}

export function identificadorOrdenDeTurno(reservaId: string): string {
  return `trabajo-turno-${reservaId}`
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
  // Cancelling (or asking to cancel) a request-born work requires a reason.
  reason?: string
}

export const LARGO_MAXIMO_MOTIVO_CANCELACION = 500

// What a diagnosis, a budget and an evidence may carry. The service is the authority: these
// limits hold for every caller (the Web, a direct call to the API, the assistant).
export const LIMITES_TRABAJO = {
  monedas: ['ARS'] as readonly string[],
  // Minor units (cents): up to 13 digits is 99.999.999.999,99.
  digitosMonto: 13,
  lineasPresupuesto: 50,
  cantidadPorLinea: 100_000,
  descripcionLinea: 300,
  alcance: 2000,
  descripcionDiagnostico: 4000,
  // Serialized size of the free-form objects (structured diagnosis data, evidence metadata).
  datosEstructurados: 8000,
  metadataEvidencia: 4000,
  referenciaEvidencia: 500,
  // How far ahead of the server's clock a client-reported moment may be (clients report their own
  // time; a day covers a wrong clock or time zone, not an invented date).
  futuroMs: 24 * 60 * 60_000,
} as const
const ID_ENTRADA = /^[A-Za-z0-9._:-]{1,120}$/u

// Platform support (MFA admin): the only way to cancel a work that already has a payment. It never
// moves money; refunds stay a separate, explicit admin operation.
export interface ComandoCancelacionSoporte {
  actorId: string
  correlationId: string
  trabajoId: string
  expectedVersion: number
  reason: string
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

// WEB-08F: el expediente se proyecta en servidor segun la parte que lo lee. Las transiciones
// visibles no llevan actor ni correlacion: son identificadores internos de la otra parte.
export type AudienciaTrabajo = 'customer' | 'provider'

export type TransicionTrabajoVisible = Omit<TransicionTrabajo, 'actorId' | 'correlationId'>

export interface TrabajoDetalle {
  viewer: AudienciaTrabajo
  work: Trabajo
  diagnoses: Diagnostico[]
  budgets: Presupuesto[]
  evidence: EvidenciaTrabajo[]
  transitions: TransicionTrabajoVisible[]
}

export type TrabajoMutation<T extends Record<string, unknown>> = Promise<
  { status: 'executed' | 'replay' } & T
>

export interface TrabajoStorePort {
  findAccessible(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null>
  findByCommitment(input: { tenantId: string; commitmentId: string }): Promise<Trabajo | null>
  // Request-born work (at most one per request: uq_trabajos_solicitud). Internal lookup: callers
  // authorize against the request owner/provider before exposing it.
  findBySolicitud(input: { solicitudId: string }): Promise<Trabajo | null>
  // Platform support only (authorized by the admin gate before calling): any work by id.
  findForSupport(input: { trabajoId: string }): Promise<Trabajo | null>
  findByReservation(input: {
    prestadorTenantId: string
    reservationId: string
  }): Promise<Trabajo | null>
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

// WEB-08H: la reserva se valida y bloquea dentro de la misma transaccion que crea el trabajo.
// `lockForWork` devuelve true solo si la reserva pertenece al prestador, al cliente y a la
// publicacion del compromiso, y la mantiene bloqueada hasta el commit.
// TURNOS-SOLICITUD-01: la reserva de un cliente nace como solicitud (`pending`). El prestador que
// acepta el trabajo es quien la confirma: una solicitud vigente y de un horario futuro pasa a
// `confirmed` en esta misma transaccion (o ninguna de las dos cosas ocurre). Una solicitud
// vencida, rechazada o cancelada no se vincula. Una reserva ya confirmada solo se bloquea.
// (Un trabajo del marketplace se cobra al completarse, W09-02: no hay seña que esperar. La seña
// que confirma es la de los turnos del directorio, TURNOS-SENA-01.)
export interface TrabajoReservaPort {
  lockForWork(input: {
    ownerTenantId: string
    reservationId: string
    customerTenantId: string
    listingId: string
    // Moment of the acceptance (in-memory adapter). PostgreSQL decides with its own server clock.
    acceptedAt: string
  }): Promise<boolean>
  // WEB-08I: cancela la reserva vinculada dentro de la transaccion que cancela el trabajo, con el
  // mismo lock de fila. Devuelve false si la reserva ya no estaba confirmada (nada que cambiar).
  cancelForWork(input: {
    ownerTenantId: string
    reservationId: string
    updatedAt: string
  }): Promise<boolean>
}

export interface TrabajoTransactionRepositories {
  work: TrabajoStorePort
  idempotency: TrabajoIdempotencyPort
  outbox: TrabajoOutboxPort
  reservations?: TrabajoReservaPort
}

// Online payments of a request-born work (deposit + balance, decision 2026-09-29). Null when the
// work has no accepted budget or is not request-born. `online` = Mercado Pago available now.
// `required`: platform payments enabled (deposit/balance mandatory); `online`: chargeable now.
export interface PuertoPagosTrabajo {
  estado(work: Trabajo): Promise<{ required: boolean; online: boolean; depositPaid: boolean } | null>
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

class ResultadoExistente<T extends Record<string, unknown>> {
  constructor(readonly value: T) {}
}

interface HuellaOperacion {
  operation: string
  payload: Record<string, unknown>
}

export class ServicioTrabajo {
  private readonly transaction: TrabajoTransactionPort
  private readonly now: () => number
  private pagos: PuertoPagosTrabajo | null = null

  constructor(transaction: TrabajoTransactionPort, now: () => number = () => Date.now()) {
    this.transaction = transaction
    this.now = now
  }

  // Wired after the finance module exists (it needs this service to complete works).
  conPagos(pagos: PuertoPagosTrabajo): this {
    this.pagos = pagos
    return this
  }

  private async estadoPagos(work: Trabajo) {
    return work.origin === 'solicitud' && this.pagos ? this.pagos.estado(work) : null
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

    const reservationId = input.reservationId?.trim() || undefined
    const fingerprint = {
      operation: 'work.accept',
      payload: {
        commitmentId: input.commitment.commitmentId,
        reservationId: reservationId ?? null,
      },
    }
    return this.execute(input, fingerprint, async (repositories) => {
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
        if (reservationId && existing.reservaId !== reservationId)
          throw new TrabajoError(
            409,
            'INVALID_RESERVATION_LINK',
            'work already exists for the commitment with another reservation'
          )
        return new ResultadoExistente({ work: existing })
      }
      if (reservationId) {
        const linked = await repositories.work.findByReservation({
          prestadorTenantId: input.tenantId,
          reservationId,
        })
        if (linked)
          throw new TrabajoError(
            409,
            'RESERVATION_ALREADY_LINKED',
            'reservation is already linked to another work'
          )
        if (!repositories.reservations)
          throw new TrabajoError(503, 'UNAVAILABLE', 'TUS calendar composition is unavailable')
        const locked = await repositories.reservations.lockForWork({
          ownerTenantId: input.tenantId,
          reservationId,
          customerTenantId: input.commitment.tenantId,
          listingId: input.publication.listingId,
          acceptedAt: input.createdAt,
        })
        if (!locked)
          throw new TrabajoError(
            409,
            'INVALID_RESERVATION_LINK',
            'reservation does not belong to the accepted service commitment'
          )
      }

      const createdAt = input.createdAt
      const work: Trabajo = {
        contractVersion: TUS_CONTRACT_VERSION,
        trabajoId: `trabajo-${input.commitment.tenantId}-${input.commitment.commitmentId}`,
        tenantId: input.commitment.tenantId,
        prestadorTenantId: input.tenantId,
        origin: 'marketplace',
        commitmentId: input.commitment.commitmentId,
        prestadorId: input.commitment.merchantId,
        publicacionId: input.commitment.listingId,
        solicitudId: null,
        ...(reservationId ? { reservaId: reservationId } : {}),
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

  // Creates the work of a request inside the CALLER's transaction (the one that assigns the request
  // and accepts the application), so both commit or roll back together. Idempotent per request:
  // the same request with the same provider returns the existing work; any other provider is a
  // conflict (the database also enforces it: uq_trabajos_solicitud + fk_trabajos_solicitud_asignada).
  // The agreed price is the accepted budget, so request-born work always requires one.
  async crearDesdeSolicitud(
    repositories: Pick<TrabajoTransactionRepositories, 'work' | 'outbox'>,
    input: ComandoCrearTrabajoDesdeSolicitud
  ): Promise<{ work: Trabajo; created: boolean }> {
    validateContext(input)
    for (const [field, value] of [['solicitudId', input.solicitudId], ['prestadorTenantId', input.prestadorTenantId], ['prestadorId', input.prestadorId]] as const)
      requireText(value ?? '', field)
    if (!isIsoTimestamp(input.createdAt)) throw new TrabajoError(400, 'INVALID', 'createdAt must be a valid timestamp')
    if (input.prestadorTenantId === input.tenantId)
      throw new TrabajoError(409, 'SELF_WORK', 'a client cannot hire its own provider tenant')
    const existing = await repositories.work.findBySolicitud({ solicitudId: input.solicitudId })
    if (existing) {
      if (existing.tenantId !== input.tenantId || existing.prestadorTenantId !== input.prestadorTenantId || existing.prestadorId !== input.prestadorId)
        throw new TrabajoError(409, 'CONFLICT', 'the request already has a work with another party')
      return { work: existing, created: false }
    }
    const work: Trabajo = {
      contractVersion: TUS_CONTRACT_VERSION,
      trabajoId: identificadorTrabajoSolicitud(input.solicitudId),
      tenantId: input.tenantId,
      prestadorTenantId: input.prestadorTenantId,
      origin: 'solicitud',
      commitmentId: null,
      prestadorId: input.prestadorId,
      publicacionId: null,
      solicitudId: input.solicitudId,
      clienteId: input.tenantId,
      status: ESTADOS_TRABAJO.SOLICITADO,
      version: 1,
      budgetRequired: true,
      acceptedBudgetId: null,
      acceptedBudgetVersion: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }
    const repos = repositories as TrabajoTransactionRepositories
    await repositories.work.createWork(work)
    await repositories.work.appendTransition({ ...initialTransition(work, input), reason: 'work.created_from_request' })
    await this.recordChange(repos, input, work, 'work.created_from_request', 'work', work.trabajoId, {
      solicitudId: input.solicitudId,
      prestadorTenantId: input.prestadorTenantId,
    })
    await this.publish(repos, work, 'tus.work.created_from_request', { solicitudId: input.solicitudId })
    return { work, created: true }
  }

  // Same operation in its own work transaction (in-memory compositions and tests).
  async crearDesdeSolicitudEnTransaccion(input: ComandoCrearTrabajoDesdeSolicitud): Promise<{ work: Trabajo; created: boolean }> {
    return this.transaction.run((repositories) => this.crearDesdeSolicitud(repositories, input))
  }

  // Payment order of an accepted turno awaiting its deposit. Idempotent per reservation: the same reservation with
  // the same parties returns the existing order (two requests at once are settled by the unique
  // index uq_trabajos_reserva and the retry of the transaction); another client or another kind
  // of work on that reservation is a conflict.
  async asegurarOrdenDeTurno(input: ComandoOrdenDeTurno): Promise<{ work: Trabajo; created: boolean }> {
    validateContext(input)
    for (const [field, value] of [['reservaId', input.reservaId], ['prestadorTenantId', input.prestadorTenantId], ['prestadorId', input.prestadorId]] as const)
      requireText(value ?? '', field)
    if (!isIsoTimestamp(input.createdAt)) throw new TrabajoError(400, 'INVALID', 'createdAt must be a valid timestamp')
    if (input.prestadorTenantId === input.tenantId)
      throw new TrabajoError(409, 'SELF_WORK', 'a client cannot hire its own provider tenant')
    const existente = (store: TrabajoStorePort) => store.findByReservation({ prestadorTenantId: input.prestadorTenantId, reservationId: input.reservaId })
    const mismaOrden = (work: Trabajo): { work: Trabajo; created: boolean } => {
      if (work.origin !== 'turno' || work.tenantId !== input.tenantId || work.prestadorId !== input.prestadorId)
        throw new TrabajoError(409, 'CONFLICT', 'the reservation already has a work with another party')
      return { work, created: false }
    }
    try {
      return await this.transaction.run(async (repositories) => {
        const previa = await existente(repositories.work)
        if (previa) return mismaOrden(previa)
        const work: Trabajo = {
          contractVersion: TUS_CONTRACT_VERSION,
          trabajoId: identificadorOrdenDeTurno(input.reservaId),
          tenantId: input.tenantId,
          prestadorTenantId: input.prestadorTenantId,
          origin: 'turno',
          commitmentId: null,
          prestadorId: input.prestadorId,
          publicacionId: null,
          solicitudId: null,
          reservaId: input.reservaId,
          clienteId: input.tenantId,
          // The provider already accepted the turno; nothing is negotiated here.
          status: ESTADOS_TRABAJO.ACEPTADO,
          version: 1,
          budgetRequired: false,
          acceptedBudgetId: null,
          acceptedBudgetVersion: null,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        }
        await repositories.work.createWork(work)
        await repositories.work.appendTransition({ ...initialTransition(work, input), reason: 'work.order_of_appointment' })
        await this.recordChange(repositories, input, work, 'work.order_of_appointment', 'work', work.trabajoId, {
          reservaId: input.reservaId,
          prestadorTenantId: input.prestadorTenantId,
        })
        return { work, created: true }
      })
    } catch (error) {
      // Lost the race to the unique index: the other request created the same order.
      const previa = await this.transaction.run((repositories) => existente(repositories.work))
      if (previa) return mismaOrden(previa)
      throw error
    }
  }

  async getWork(context: TrabajoContext, trabajoId: string): Promise<TrabajoDetalle> {
    validateContext(context)
    return this.transaction.run(async ({ work: store }) => {
      const work = await store.findAccessible({ tenantId: context.tenantId, trabajoId })
      if (!work || esOrdenDeTurno(work)) throw new TrabajoError(404, 'NOT_FOUND', 'work was not found')
      const viewer = audienceOf(work, context)
      const scope = { tenantId: work.tenantId, trabajoId: work.trabajoId }
      const belongs = (item: { tenantId: string; trabajoId: string }) =>
        item.tenantId === work.tenantId && item.trabajoId === work.trabajoId
      const diagnoses = (await store.listDiagnoses(scope)).filter(belongs)
      const budgets = (await store.listBudgets(scope)).filter(belongs)
      const evidence = (await store.listEvidence(scope)).filter(belongs)
      const transitions = (await store.listTransitions(scope)).filter(belongs)
      return {
        viewer,
        work,
        // Los borradores de diagnostico y presupuesto son trabajo interno del prestador.
        diagnoses:
          viewer === 'provider'
            ? diagnoses
            : diagnoses.filter((item) => item.status === ESTADOS_DIAGNOSTICO.CONFIRMADO),
        budgets: budgets
          .filter((item) => viewer === 'provider' || item.status !== ESTADOS_PRESUPUESTO.BORRADOR)
          .map(({ recordId: _recordId, correlationId: _correlationId, ...budget }) => budget),
        evidence,
        transitions: transitions.map(
          ({ actorId: _actorId, correlationId: _correlationId, ...transition }) => transition
        ),
      }
    })
  }

  async listWorks(context: TrabajoContext): Promise<Trabajo[]> {
    validateContext(context)
    // The order of a turno is not a work of the parties: the turno is seen in "Mis turnos" and
    // in the agenda of the provider.
    return this.transaction.run(async ({ work: store }) => (await store.listAccessible(context.tenantId)).filter((work) => !esOrdenDeTurno(work)))
  }

  async createDiagnosis(
    input: ComandoDiagnostico
  ): TrabajoMutation<{ diagnosis: Diagnostico; work: Trabajo }> {
    validateMutationContext(input)
    requireText(input.descripcionOriginal, 'descripcionOriginal')
    requireLength(input.descripcionOriginal, LIMITES_TRABAJO.descripcionDiagnostico, 'descripcionOriginal')
    requireSerializedSize(input.datosEstructurados, LIMITES_TRABAJO.datosEstructurados, 'structuredData')
    const fingerprint = {
      operation: 'work.diagnosis.create',
      payload: {
        trabajoId: input.trabajoId,
        descripcionOriginal: input.descripcionOriginal,
        datosEstructurados: input.datosEstructurados ?? null,
      },
    }
    return this.execute(input, fingerprint, async (repositories) => {
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
    const fingerprint = {
      operation: 'work.diagnosis.confirm',
      payload: {
        trabajoId: input.trabajoId,
        diagnosticoId: input.diagnosticoId,
        expectedVersion: input.expectedVersion,
      },
    }
    return this.execute(input, fingerprint, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      const current = await repositories.work.findDiagnosis({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
        diagnosticoId: input.diagnosticoId,
      })
      if (!current) throw new TrabajoError(404, 'NOT_FOUND', 'diagnosis was not found')
      if (current.status === ESTADOS_DIAGNOSTICO.CONFIRMADO)
        return new ResultadoExistente({ diagnosis: current })
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
    if (!LIMITES_TRABAJO.monedas.includes(input.currency)) throw new TrabajoError(400, 'INVALID', 'currency is not supported')
    requireText(input.scope, 'scope')
    requireLength(input.scope, LIMITES_TRABAJO.alcance, 'scope')
    validateMinorAmount(input.totalMinor, 'totalMinor')
    validateBudgetLines(input.lines, input.totalMinor)
    // Only the fields of a line are kept: anything else a caller added is not part of a budget.
    input = { ...input, lines: input.lines.map((line) => ({ lineId: line.lineId, description: line.description.trim(), quantity: line.quantity, unitAmountMinor: line.unitAmountMinor, totalAmountMinor: line.totalAmountMinor })) }
    if (
      input.validUntil !== undefined &&
      input.validUntil !== null &&
      (!isIsoTimestamp(input.validUntil) || Date.parse(input.validUntil) <= this.now())
    )
      throw new TrabajoError(400, 'INVALID', 'validUntil must be in the future')
    const fingerprint = {
      operation: 'work.budget.create',
      payload: {
        trabajoId: input.trabajoId,
        currency: input.currency,
        scope: input.scope,
        totalMinor: input.totalMinor,
        lines: input.lines,
        validUntil: input.validUntil ?? null,
      },
    }
    return this.execute(input, fingerprint, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      if (!work.budgetRequired)
        throw new TrabajoError(409, 'BUDGET_NOT_REQUIRED', 'publication does not require a budget')
      // Request-born works are paid in two halves (deposit + balance): both must be positive.
      if (work.origin === 'solicitud' && BigInt(input.totalMinor) < 2n)
        throw new TrabajoError(400, 'BUDGET_TOO_SMALL', 'the budget must allow a deposit and a balance')
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
    const fingerprint = {
      operation: 'work.budget.decide',
      payload: {
        trabajoId: input.trabajoId,
        presupuestoId: input.presupuestoId,
        presupuestoVersion: input.presupuestoVersion,
        decision: input.decision,
        reason: input.reason ?? null,
        acceptanceId: input.acceptanceId ?? null,
      },
    }
    return this.execute(input, fingerprint, async (repositories) => {
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
        return new ResultadoExistente({ budget, acceptance: existing, work })
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
    const fingerprint = transitionFingerprint('work.start', input)
    return this.execute(input, fingerprint, async (repositories) => {
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
      // With platform payments enabled a request-born work starts only after the deposit. A
      // provider that cannot be paid (no Mercado Pago link) is blocked, never exempted.
      const pagos = await this.estadoPagos(work)
      if (pagos?.required && !pagos.depositPaid)
        throw pagos.online
          ? new TrabajoError(409, 'DEPOSIT_REQUIRED', 'the deposit must be paid before the work can start')
          : new TrabajoError(
              409,
              'PROVIDER_PAYMENT_ACCOUNT_REQUIRED',
              'the provider must link Mercado Pago before this work can be charged'
            )
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
    const fingerprint = transitionFingerprint('work.complete', input)
    return this.execute(input, fingerprint, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureProvider(work, input)
      if (work.version !== input.expectedVersion)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      if (work.status !== ESTADOS_TRABAJO.EN_PROGRESO)
        throw new TrabajoError(409, 'INVALID_STATE', 'only active work can be completed')
      if (work.finishedAt)
        throw new TrabajoError(
          409,
          'ALREADY_FINISHED',
          'the work is finished and waits for the final payment'
        )
      // With online payments available, finishing a request-born work waits for the balance:
      // the approved balance completes it (completarPorPagoFinal).
      const pagos = await this.estadoPagos(work)
      if (pagos?.required) {
        const finished: Trabajo = {
          ...work,
          finishedAt: input.createdAt,
          version: work.version + 1,
          updatedAt: input.createdAt,
        }
        const persisted = await repositories.work.updateWork({
          tenantId: work.tenantId,
          trabajoId: work.trabajoId,
          expectedVersion: work.version,
          work: finished,
        })
        if (!persisted) throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
        await this.recordChange(repositories, input, persisted, 'work.finished', 'work', persisted.trabajoId, {
          status: persisted.status,
          awaiting: 'final_payment',
        })
        await this.publish(repositories, persisted, 'tus.work.finished', {})
        return { work: persisted }
      }
      const updated = await this.transition(
        repositories,
        input,
        { ...work, finishedAt: input.createdAt },
        ESTADOS_TRABAJO.COMPLETADO,
        'work.completed'
      )
      await this.publish(repositories, updated, 'tus.work.completed', {})
      return { work: updated }
    })
  }

  // System step inside the FINANCE transaction that approved the balance of a request-born work:
  // the approved final payment completes it. Idempotent; never touches a cancelled work.
  async completarPorPagoFinal(
    repositories: Pick<TrabajoTransactionRepositories, 'work' | 'outbox'>,
    input: { tenantId: string; trabajoId: string; paymentId: string; correlationId: string; createdAt: string }
  ): Promise<'completed' | 'already_completed' | 'not_in_progress'> {
    const work = await repositories.work.findAccessible({ tenantId: input.tenantId, trabajoId: input.trabajoId })
    if (!work) return 'not_in_progress'
    if (work.status === ESTADOS_TRABAJO.COMPLETADO) return 'already_completed'
    if (work.status !== ESTADOS_TRABAJO.EN_PROGRESO) return 'not_in_progress'
    const context = {
      tenantId: work.tenantId,
      actorId: 'system:mercado-pago',
      correlationId: input.correlationId,
      createdAt: input.createdAt,
    }
    const repos = repositories as TrabajoTransactionRepositories
    const updated = await this.transition(
      repos,
      context,
      { ...work, finishedAt: work.finishedAt ?? input.createdAt },
      ESTADOS_TRABAJO.COMPLETADO,
      'work.completed_after_final_payment'
    )
    await this.publish(repos, updated, 'tus.work.completed', { paymentId: input.paymentId })
    return 'completed'
  }

  // Request-born works (FASE 8): client or provider cancel before the start, with a reason; once
  // started only the provider cancels (the client asks through solicitarCancelacion). A paid
  // deposit locks the work: cancelling then is a platform-support case, never a button that makes
  // the payment disappear. Marketplace works keep the provider-only rule.
  async cancelWork(input: ComandoTransicionTrabajo): TrabajoMutation<{ work: Trabajo }> {
    validateMutationContext(input)
    requirePositiveInteger(input.expectedVersion, 'expectedVersion')
    const reason = normalizarMotivo(input.reason)
    const fingerprint = {
      operation: 'work.cancel',
      payload: { trabajoId: input.trabajoId, expectedVersion: input.expectedVersion, reason },
    }
    return this.execute(input, fingerprint, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      const solicitud = work.origin === 'solicitud'
      const role = work.prestadorTenantId === input.tenantId ? 'prestador' : 'cliente'
      if (!solicitud) ensureProvider(work, input)
      if (work.version !== input.expectedVersion)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      if (hasWorkStatus(work.status, [ESTADOS_TRABAJO.COMPLETADO, ESTADOS_TRABAJO.CANCELADO]))
        throw new TrabajoError(
          409,
          'INVALID_STATE',
          'work cannot be cancelled in the current state'
        )
      if (solicitud && !reason)
        throw new TrabajoError(400, 'REASON_REQUIRED', 'a cancellation reason is required')
      if (role === 'cliente' && work.status === ESTADOS_TRABAJO.EN_PROGRESO)
        throw new TrabajoError(
          409,
          'CLIENT_CANCEL_NOT_ALLOWED',
          'a started work cannot be cancelled by the client; request the cancellation instead'
        )
      const pagos = await this.estadoPagos(work)
      if (pagos?.depositPaid)
        throw new TrabajoError(
          409,
          'PAYMENT_REQUIRES_SUPPORT',
          'the work has a registered payment; platform support resolves its cancellation'
        )
      const updated = await this.transition(
        repositories,
        input,
        solicitud ? { ...work, cancelledByRole: role, cancellationReason: reason } : work,
        ESTADOS_TRABAJO.CANCELADO,
        'work.cancelled',
        solicitud ? { role, reason } : {}
      )
      // WEB-08I: el trabajo es la autoridad de la reserva vinculada; ambos se cancelan juntos.
      const reservation = work.reservaId
        ? await this.cancelLinkedReservation(repositories, input, updated, work.reservaId)
        : {}
      await this.publish(repositories, updated, 'tus.work.cancelled', reservation)
      return { work: updated }
    })
  }

  // Client of a started request-born work: records the request (with a reason) for the provider
  // and support. It never cancels by itself.
  async solicitarCancelacion(input: ComandoTransicionTrabajo): TrabajoMutation<{ work: Trabajo }> {
    validateMutationContext(input)
    requirePositiveInteger(input.expectedVersion, 'expectedVersion')
    const reason = normalizarMotivo(input.reason)
    const fingerprint = {
      operation: 'work.cancellation_request',
      payload: { trabajoId: input.trabajoId, expectedVersion: input.expectedVersion, reason },
    }
    return this.execute(input, fingerprint, async (repositories) => {
      const work = await this.requireWork(repositories.work, input)
      ensureCustomer(work, input)
      if (work.origin !== 'solicitud')
        throw new TrabajoError(409, 'INVALID_STATE', 'only request-born works accept cancellation requests')
      if (!reason) throw new TrabajoError(400, 'REASON_REQUIRED', 'a cancellation reason is required')
      if (work.version !== input.expectedVersion)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      if (work.status !== ESTADOS_TRABAJO.EN_PROGRESO)
        throw new TrabajoError(409, 'INVALID_STATE', 'only a started work takes cancellation requests')
      if (work.cancellationRequestedAt)
        throw new TrabajoError(409, 'ALREADY_REQUESTED', 'the cancellation was already requested')
      const requested: Trabajo = {
        ...work,
        cancellationRequestedAt: input.createdAt,
        cancellationRequestReason: reason,
        version: work.version + 1,
        updatedAt: input.createdAt,
      }
      const persisted = await repositories.work.updateWork({
        tenantId: work.tenantId,
        trabajoId: work.trabajoId,
        expectedVersion: work.version,
        work: requested,
      })
      if (!persisted) throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      await this.recordChange(repositories, input, persisted, 'work.cancellation_requested', 'work', persisted.trabajoId, {
        role: 'cliente',
        reason,
        status: persisted.status,
      })
      await this.publish(repositories, persisted, 'tus.work.cancellation_requested', {})
      return { work: persisted }
    })
  }

  // Platform support (MFA admin, authorized by the caller): cancels any non-terminal work, also
  // with payments, recording the reason. Payments and refunds are NOT touched here.
  async cancelarComoSoporte(input: ComandoCancelacionSoporte): TrabajoMutation<{ work: Trabajo }> {
    const found = await this.transaction.run((repositories) =>
      repositories.work.findForSupport({ trabajoId: input.trabajoId })
    )
    if (!found) throw new TrabajoError(404, 'NOT_FOUND', 'work was not found')
    const context = { ...input, tenantId: found.tenantId }
    validateMutationContext(context)
    requirePositiveInteger(input.expectedVersion, 'expectedVersion')
    const reason = normalizarMotivo(input.reason)
    if (!reason) throw new TrabajoError(400, 'REASON_REQUIRED', 'a cancellation reason is required')
    const fingerprint = {
      operation: 'work.support_cancel',
      payload: { trabajoId: input.trabajoId, expectedVersion: input.expectedVersion, reason },
    }
    return this.execute(context, fingerprint, async (repositories) => {
      const work = await this.requireWork(repositories.work, context)
      if (work.version !== input.expectedVersion)
        throw new TrabajoError(409, 'VERSION_CONFLICT', 'work version is stale')
      if (hasWorkStatus(work.status, [ESTADOS_TRABAJO.COMPLETADO, ESTADOS_TRABAJO.CANCELADO]))
        throw new TrabajoError(409, 'INVALID_STATE', 'work cannot be cancelled in the current state')
      const pagos = await this.estadoPagos(work)
      const updated = await this.transition(
        repositories,
        context,
        { ...work, cancelledByRole: 'admin', cancellationReason: reason },
        ESTADOS_TRABAJO.CANCELADO,
        'work.cancelled_by_support',
        { role: 'admin', reason, depositPaid: pagos?.depositPaid ?? false }
      )
      await this.publish(repositories, updated, 'tus.work.cancelled', { role: 'admin' })
      return { work: updated }
    })
  }

  async recordEvidence(
    input: ComandoEvidenciaTrabajo
  ): TrabajoMutation<{ evidence: EvidenciaTrabajo }> {
    validateMutationContext(input)
    requireText(input.evidenceId, 'evidenceId')
    if (!ID_ENTRADA.test(input.evidenceId)) throw new TrabajoError(400, 'INVALID', 'evidenceId is invalid')
    requireText(input.reference, 'reference')
    requireLength(input.reference, LIMITES_TRABAJO.referenciaEvidencia, 'reference')
    requireSerializedSize(input.metadata, LIMITES_TRABAJO.metadataEvidencia, 'metadata')
    if (!Object.values(FASES_EVIDENCIA_TRABAJO).includes(input.phase))
      throw new TrabajoError(400, 'INVALID', 'phase is invalid')
    if (!isIsoTimestamp(input.occurredAt))
      throw new TrabajoError(400, 'INVALID', 'occurredAt must be a valid timestamp')
    if (Date.parse(input.occurredAt) > this.now() + LIMITES_TRABAJO.futuroMs)
      throw new TrabajoError(400, 'INVALID', 'occurredAt cannot be in the future')
    const fingerprint = {
      operation: 'work.evidence.record',
      payload: {
        trabajoId: input.trabajoId,
        evidenceId: input.evidenceId,
        phase: input.phase,
        reference: input.reference,
        metadata: input.metadata,
        occurredAt: input.occurredAt,
      },
    }
    return this.execute(input, fingerprint, async (repositories) => {
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
        return new ResultadoExistente({ evidence: existing })
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
    // Every command of a work goes through here: the order of a turno accepts none of them.
    if (!work || esOrdenDeTurno(work)) throw new TrabajoError(404, 'NOT_FOUND', 'work was not found')
    return work
  }

  private async cancelLinkedReservation(
    repositories: TrabajoTransactionRepositories,
    input: TrabajoContext & { createdAt: string },
    work: Trabajo,
    reservationId: string
  ): Promise<{ reservationId: string; reservationCancelled: boolean }> {
    if (!repositories.reservations)
      throw new TrabajoError(503, 'UNAVAILABLE', 'TUS calendar composition is unavailable')
    const cancelled = await repositories.reservations.cancelForWork({
      ownerTenantId: work.prestadorTenantId,
      reservationId,
      updatedAt: input.createdAt,
    })
    if (cancelled)
      await this.recordChange(
        repositories,
        input,
        work,
        'reservation.cancelled',
        'reservation',
        reservationId,
        {
          reason: 'work.cancelled',
        }
      )
    return { reservationId, reservationCancelled: cancelled }
  }

  private async transition(
    repositories: TrabajoTransactionRepositories,
    input: TrabajoContext & { createdAt: string },
    work: Trabajo,
    status: EstadoTrabajo,
    reason: string,
    details: Record<string, unknown> = {}
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
      ...details,
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

  // WEB-08G: la huella de idempotencia se deriva en servidor de la operacion y de sus campos
  // semanticos. El `requestHash` del cliente sigue siendo obligatorio por contrato pero no decide
  // si un reintento es el mismo pedido; `createdAt` queda fuera para que un reintento sea replay.
  private async execute<T extends Record<string, unknown>>(
    input: TrabajoContext & { idempotencyKey: string; requestHash: string; createdAt: string },
    fingerprint: HuellaOperacion,
    operation: (repositories: TrabajoTransactionRepositories) => Promise<T | ResultadoExistente<T>>
  ): Promise<{ status: 'executed' | 'replay' } & T> {
    const requestHash = fingerprintRequest(fingerprint)
    return this.transaction.run(async (repositories) => {
      const now = this.now()
      const claim = await repositories.idempotency.claim({
        tenantId: input.tenantId,
        key: input.idempotencyKey,
        requestHash,
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
      const outcome = await operation(repositories)
      const existing = outcome instanceof ResultadoExistente
      const response = existing ? outcome.value : outcome
      await repositories.idempotency.complete({
        tenantId: input.tenantId,
        key: input.idempotencyKey,
        response,
      })
      return { status: existing ? 'replay' : 'executed', ...response }
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

  async findForSupport(input: { trabajoId: string }): Promise<Trabajo | null> {
    const work = [...this.works.values()].find((candidate) => candidate.trabajoId === input.trabajoId)
    return work ? structuredClone(work) : null
  }

  async findByCommitment(input: {
    tenantId: string
    commitmentId: string
  }): Promise<Trabajo | null> {
    const work = [...this.works.values()].find(
      (candidate) => candidate.tenantId === input.tenantId && candidate.commitmentId === input.commitmentId
    )
    return work ? structuredClone(work) : null
  }

  async findBySolicitud(input: { solicitudId: string }): Promise<Trabajo | null> {
    const work = [...this.works.values()].find((candidate) => candidate.solicitudId === input.solicitudId)
    return work ? structuredClone(work) : null
  }

  async findByReservation(input: {
    prestadorTenantId: string
    reservationId: string
  }): Promise<Trabajo | null> {
    const work = [...this.works.values()].find(
      (candidate) =>
        candidate.prestadorTenantId === input.prestadorTenantId &&
        candidate.reservaId === input.reservationId
    )
    return work ? structuredClone(work) : null
  }

  async listAccessible(tenantId: string): Promise<Trabajo[]> {
    return [...this.works.values()]
      .filter((work) => work.tenantId === tenantId || work.prestadorTenantId === tenantId)
      .map((work) => structuredClone(work))
  }

  async createWork(work: Trabajo): Promise<void> {
    const key = workKey(work.tenantId, work.trabajoId)
    if (this.works.has(key)) throw new TrabajoError(409, 'CONFLICT', 'work already exists')
    // Mirrors of uq_trabajos_tenant_compromiso and uq_trabajos_solicitud.
    if (work.commitmentId && (await this.findByCommitment({ tenantId: work.tenantId, commitmentId: work.commitmentId })))
      throw new TrabajoError(409, 'CONFLICT', 'work already exists for commitment')
    if (work.solicitudId && [...this.works.values()].some((candidate) => candidate.solicitudId === work.solicitudId))
      throw new TrabajoError(409, 'CONFLICT', 'work already exists for request')
    // Espejo de `uq_trabajos_reserva`: una reserva vincula como maximo un trabajo.
    if (
      work.reservaId &&
      (await this.findByReservation({
        prestadorTenantId: work.prestadorTenantId,
        reservationId: work.reservaId,
      }))
    )
      throw new TrabajoError(409, 'RESERVATION_ALREADY_LINKED', 'reservation is already linked')
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
    this.works.set(workKey(current.tenantId, current.trabajoId), structuredClone(input.work))
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
    const publicDecision: AceptacionPresupuesto = {
      contractVersion: decision.contractVersion,
      acceptanceId: decision.acceptanceId,
      presupuestoId: decision.presupuestoId,
      presupuestoVersion: decision.presupuestoVersion,
      trabajoId: decision.trabajoId,
      tenantId: decision.tenantId,
      actorId: decision.actorId,
      decision: decision.decision,
      ...(decision.reason ? { reason: decision.reason } : {}),
      createdAt: decision.createdAt,
    }
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
  // WEB-08I: la composicion en memoria comparte este serializador con el calendario.
  constructor(
    private readonly repositories: {
      work: InMemoryTrabajoStore
      idempotency: InMemoryTrabajoIdempotencyStore
      outbox: InMemoryTrabajoOutboxStore
      reservations?: TrabajoReservaPort
    },
    private readonly serializer: SerializadorEnMemoria = new SerializadorEnMemoria()
  ) {}

  async run<TValue>(
    operation: (repositories: TrabajoTransactionRepositories) => Promise<TValue>
  ): Promise<TValue> {
    return this.serializer.run(async () => {
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
      }
    })
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

interface ReservaVinculable {
  tenantId: string
  ownerTenantId: string
  listingId?: string
  status: string
  startsAt?: string
  requestExpiresAt?: string
}

// Adaptador en memoria: valida contra el calendario dentro del cerrojo serial de
// `InMemoryTrabajoTransaction`, la unica via de escritura de trabajos en memoria.
export class ReservasTrabajoEnMemoria implements TrabajoReservaPort {
  constructor(
    private readonly findBooking: (
      ownerTenantId: string,
      reservationId: string
    ) => Promise<ReservaVinculable | null>,
    private readonly cancelBooking?: (
      ownerTenantId: string,
      reservationId: string,
      updatedAt: string
    ) => Promise<boolean>,
    // Turns a pending request into the confirmed reservation (the provider accepted its work).
    private readonly confirmBooking?: (
      ownerTenantId: string,
      reservationId: string,
      updatedAt: string
    ) => Promise<boolean>
  ) {}

  // En memoria el calendario no participa del rollback de Trabajo: `cancelWork` la invoca despues
  // de la transicion y solo la siguen escrituras en memoria que no fallan (auditoria y outbox).
  // En PostgreSQL trabajo y reserva se revierten juntos.
  async cancelForWork(input: {
    ownerTenantId: string
    reservationId: string
    updatedAt: string
  }): Promise<boolean> {
    if (!this.cancelBooking)
      throw new TrabajoError(503, 'UNAVAILABLE', 'TUS calendar composition is unavailable')
    return this.cancelBooking(input.ownerTenantId, input.reservationId, input.updatedAt)
  }

  async lockForWork(input: {
    ownerTenantId: string
    reservationId: string
    customerTenantId: string
    listingId: string
    acceptedAt: string
  }): Promise<boolean> {
    const booking = await this.findBooking(input.ownerTenantId, input.reservationId)
    if (
      booking === null ||
      booking.ownerTenantId !== input.ownerTenantId ||
      booking.tenantId !== input.customerTenantId ||
      booking.listingId !== input.listingId
    )
      return false
    if (booking.status === 'confirmed') return true
    // A request still waiting: accepting the work confirms it, if it is still valid and its time
    // has not passed.
    const now = Date.parse(input.acceptedAt)
    const vigente =
      booking.status === 'pending' &&
      Date.parse(booking.requestExpiresAt ?? booking.startsAt ?? '') > now &&
      Date.parse(booking.startsAt ?? '') > now
    if (!vigente || !this.confirmBooking) return false
    return this.confirmBooking(input.ownerTenantId, input.reservationId, input.acceptedAt)
  }
}

const esOrdenDeTurno = (work: Trabajo): boolean => work.origin === 'turno'

function audienceOf(work: Trabajo, context: TrabajoContext): AudienciaTrabajo {
  if (work.prestadorTenantId === context.tenantId) return 'provider'
  if (work.tenantId === context.tenantId) return 'customer'
  throw new TrabajoError(404, 'NOT_FOUND', 'work was not found')
}

function transitionFingerprint(
  operation: string,
  input: ComandoTransicionTrabajo
): HuellaOperacion {
  return {
    operation,
    payload: { trabajoId: input.trabajoId, expectedVersion: input.expectedVersion },
  }
}

export function fingerprintRequest(fingerprint: HuellaOperacion): string {
  return `sha256:${createHash('sha256').update(canonicalJson(fingerprint)).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (isRecord(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value ?? null)
}

function ensureProvider(work: Trabajo, context: TrabajoContext): void {
  if (work.prestadorTenantId !== context.tenantId)
    throw new TrabajoError(403, 'FORBIDDEN', 'provider tenant does not own the work')
}

function ensureCustomer(work: Trabajo, context: TrabajoContext): void {
  if (work.tenantId !== context.tenantId)
    throw new TrabajoError(403, 'FORBIDDEN', 'customer tenant does not own the work')
}

function normalizarMotivo(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : ''
  if (reason.length > LARGO_MAXIMO_MOTIVO_CANCELACION)
    throw new TrabajoError(400, 'INVALID', 'the cancellation reason is too long')
  return reason
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

function requireLength(value: string, max: number, field: string): void {
  if ([...value.trim()].length > max) throw new TrabajoError(400, 'INVALID', `${field} is too long (${max} characters at most)`)
}

// A free-form object travels and is stored as JSON: bounded, and really an object.
function requireSerializedSize(value: unknown, max: number, field: string): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'object' || Array.isArray(value)) throw new TrabajoError(400, 'INVALID', `${field} must be an object`)
  let size: number
  try {
    size = JSON.stringify(value).length
  } catch {
    throw new TrabajoError(400, 'INVALID', `${field} is not valid`)
  }
  if (size > max) throw new TrabajoError(400, 'INVALID', `${field} is too large`)
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1)
    throw new TrabajoError(400, 'INVALID', `${field} must be a positive integer`)
}

function validateMinorAmount(value: string, field: string): void {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || value.length > LIMITES_TRABAJO.digitosMonto)
    throw new TrabajoError(400, 'INVALID', `${field} must be a non-negative minor-unit amount`)
}

function validateBudgetLines(lines: LineaPresupuesto[], totalMinor: string): void {
  if (!Array.isArray(lines) || lines.length === 0)
    throw new TrabajoError(400, 'INVALID', 'at least one budget line is required')
  if (lines.length > LIMITES_TRABAJO.lineasPresupuesto)
    throw new TrabajoError(400, 'INVALID', `a budget has at most ${LIMITES_TRABAJO.lineasPresupuesto} lines`)
  let total = 0n
  const ids = new Set<string>()
  for (const line of lines) {
    if (typeof line !== 'object' || line === null || typeof line.lineId !== 'string' || typeof line.description !== 'string')
      throw new TrabajoError(400, 'INVALID', 'budget line is invalid')
    requireText(line.lineId, 'lineId')
    if (!ID_ENTRADA.test(line.lineId)) throw new TrabajoError(400, 'INVALID', 'lineId is invalid')
    requireText(line.description, 'description')
    requireLength(line.description, LIMITES_TRABAJO.descripcionLinea, 'description')
    requirePositiveInteger(line.quantity, 'quantity')
    if (line.quantity > LIMITES_TRABAJO.cantidadPorLinea) throw new TrabajoError(400, 'INVALID', 'quantity is too large')
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

function workKey(tenantId: string, trabajoId: string): string {
  return `${tenantId}:${trabajoId}`
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
