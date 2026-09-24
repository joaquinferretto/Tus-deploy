import { randomUUID } from 'node:crypto'
import type {
  EstadoProveedorPagoServicio,
  IntencionPagoServicio,
  ObligacionPagoServicio,
  Trabajo,
} from '@factory/contracts'
import {
  ErrorFinanzasServicio,
  derivarObligacionServicio,
  huellaSolicitudFinanciera,
  proyectarObligacion,
  resolverIdempotenciaFinanciera,
  transicionarObligacion,
  validarClaveIdempotencia,
  validarContextoFinanzasServicio,
  type CompromisoServicioFinanciero,
  type ContextoFinanzasServicio,
  type ObligacionServicio,
  type PresupuestoFinanciero,
  type PublicacionServicioFinanciera,
  type RegistroIdempotenciaFinanciera,
} from './modelo.ts'
import {
  ErrorProveedorPagos,
  ProveedorPagosServicioNoDisponible,
  esTransicionProveedorPermitida,
  identificadorPago,
  proyectarIntencionPago,
  type EntradaEventoProveedor,
  type EventoPagoNormalizado,
  type IntencionPagoServicioDominio,
  type PuertoProveedorPagosServicio,
} from './pagos.ts'

// Reads the WEB-08 commercial chain inside the finance transaction. Every lookup is scoped:
// a work is visible only to its customer tenant or its provider tenant.
export interface PuertoIdentidadServicio {
  buscarTrabajoAccesible(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null>
  buscarCompromiso(input: {
    tenantId: string
    commitmentId: string
  }): Promise<CompromisoServicioFinanciero | null>
  buscarPublicacion(input: {
    prestadorTenantId: string
    publicacionId: string
  }): Promise<PublicacionServicioFinanciera | null>
  buscarPresupuesto(input: {
    tenantId: string
    trabajoId: string
    presupuestoId: string
    version: number
  }): Promise<PresupuestoFinanciero | null>
}

export interface PuertoObligacionesServicio {
  buscarPorTrabajo(input: {
    tenantId: string
    trabajoId: string
  }): Promise<ObligacionServicio | null>
  buscar(input: { tenantId: string; obligacionId: string }): Promise<ObligacionServicio | null>
  crear(obligacion: ObligacionServicio): Promise<void>
  actualizar(input: {
    obligacion: ObligacionServicio
    expectedVersion: number
  }): Promise<ObligacionServicio | null>
}

export interface PuertoIdempotenciaFinanciera {
  buscar(input: { tenantId: string; key: string }): Promise<RegistroIdempotenciaFinanciera | null>
  registrar(input: {
    tenantId: string
    key: string
    record: RegistroIdempotenciaFinanciera
  }): Promise<void>
}

export interface PuertoIntencionesPagoServicio {
  listarPorObligacion(input: {
    tenantId: string
    obligacionId: string
  }): Promise<IntencionPagoServicioDominio[]>
  buscar(input: {
    tenantId: string
    paymentId: string
  }): Promise<IntencionPagoServicioDominio | null>
  // Global lookups are only used after a provider signature was verified.
  buscarPorReferenciaProveedor(providerReference: string): Promise<IntencionPagoServicioDominio[]>
  buscarPorPaymentId(paymentId: string): Promise<IntencionPagoServicioDominio[]>
  crear(intent: IntencionPagoServicioDominio): Promise<void>
  actualizar(intent: IntencionPagoServicioDominio): Promise<void>
}

export type ResultadoEventoProveedor =
  'applied' | 'no_op' | 'stale' | 'ignored_unknown_status' | 'rejected_transition' | 'quarantined'

export interface RegistroEventoProveedor {
  eventId: string
  tenantId: string
  provider: 'mercado-pago'
  paymentId: string
  obligacionId: string
  providerReference: string
  status: string
  amountMinor: bigint
  currency: string
  signature: string
  rawBody: string
  occurredAt: string
  receivedAt: string
  result: ResultadoEventoProveedor
  reason: string | null
}

// Durable inbox (`eventos_webhook_pago`): insert-only, unique by (tenant, provider, event).
export interface PuertoInboxEventosPago {
  buscar(input: {
    tenantId: string
    provider: string
    eventId: string
  }): Promise<RegistroEventoProveedor | null>
  registrar(record: RegistroEventoProveedor): Promise<void>
  listarPorObligacion(input: {
    tenantId: string
    obligacionId: string
  }): Promise<RegistroEventoProveedor[]>
}

export interface RegistroOutboxFinanciero {
  eventId: string
  tenantId: string
  aggregateType: 'obligacion_pago_servicio' | 'intencion_pago_servicio'
  aggregateId: string
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}

export interface PuertoOutboxFinanciero {
  publicar(record: RegistroOutboxFinanciero): Promise<void>
}

export interface RegistroAuditoriaFinanciera {
  auditId: string
  tenantId: string
  prestadorTenantId: string
  obligacionId: string
  resourceType: 'obligation' | 'payment' | 'provider_event' | 'settlement' | 'reconciliation'
  resourceId: string
  action: string
  origin: 'customer' | 'provider_event' | 'system'
  actorId: string
  correlationId: string
  idempotencyKey: string | null
  previousStatus: string | null
  status: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface PuertoAuditoriaFinanciera {
  registrar(record: RegistroAuditoriaFinanciera): Promise<void>
}

export interface RepositoriosFinanzasServicio {
  identidad: PuertoIdentidadServicio
  obligaciones: PuertoObligacionesServicio
  idempotencia: PuertoIdempotenciaFinanciera
  intenciones: PuertoIntencionesPagoServicio
  inbox: PuertoInboxEventosPago
  outbox: PuertoOutboxFinanciero
  auditoria: PuertoAuditoriaFinanciera
}

// Implementations run the callback in one serializable transaction (Prisma) or one
// serialized critical section (in-memory) and retry bounded serialization conflicts.
export interface PuertoTransaccionFinanzasServicio {
  ejecutar<T>(operation: (repositories: RepositoriosFinanzasServicio) => Promise<T>): Promise<T>
}

export type ResultadoObligacion = {
  status: 'executed' | 'replay'
  obligation: ObligacionPagoServicio
}

export type ResultadoIntencionPago = {
  status: 'executed' | 'replay' | 'existing'
  obligation: ObligacionPagoServicio
  payment: IntencionPagoServicio
}

export type ResultadoDespachoPago =
  | {
      status: 'dispatched' | 'already_dispatched' | 'not_dispatchable'
      payment: IntencionPagoServicio
    }
  | { status: 'dispatch_failed'; reason: string; payment: IntencionPagoServicio }

export type ResultadoIngestaEvento =
  | { status: 'unmatched' | 'invalid'; reason: string }
  | { status: 'duplicate'; eventId: string; result: ResultadoEventoProveedor }
  | {
      status: 'recorded'
      eventId: string
      result: ResultadoEventoProveedor
      reason: string | null
      payment: IntencionPagoServicio
      obligation: ObligacionPagoServicio
    }

export interface ResumenFinancieroTrabajoServicio {
  trabajoId: string
  viewer: 'customer' | 'provider'
  obligation: ObligacionPagoServicio | null
  payments: IntencionPagoServicio[]
}

const ACTOR_PROVEEDOR = 'provider:mercado-pago'

export class ServicioFinanzasServicios {
  protected readonly transaction: PuertoTransaccionFinanzasServicio
  protected readonly now: () => number
  protected readonly proveedor: PuertoProveedorPagosServicio

  constructor(
    transaction: PuertoTransaccionFinanzasServicio,
    now: () => number = () => Date.now(),
    proveedor: PuertoProveedorPagosServicio = new ProveedorPagosServicioNoDisponible()
  ) {
    this.transaction = transaction
    this.now = now
    this.proveedor = proveedor
  }

  // Customer command: fixes the payable amount of a work from persisted commercial facts.
  async prepararObligacion(
    input: ContextoFinanzasServicio & { trabajoId: string; idempotencyKey: string }
  ): Promise<ResultadoObligacion> {
    validarContextoFinanzasServicio(input)
    const key = validarClaveIdempotencia(input.idempotencyKey)
    const requestHash = huellaSolicitudFinanciera('service-obligation.prepare', {
      trabajoId: input.trabajoId,
      actorId: input.actorId,
    })
    return this.transaction.ejecutar(async (repositories) => {
      const idempotency = resolverIdempotenciaFinanciera(
        await repositories.idempotencia.buscar({ tenantId: input.tenantId, key }),
        requestHash
      )
      if (idempotency.status === 'replay')
        return {
          status: 'replay',
          obligation: idempotency.response['obligation'] as ObligacionPagoServicio,
        }
      const obligation = await this.asegurarObligacion(repositories, input, input.trabajoId, key)
      const response = { obligation: proyectarObligacion(obligation) }
      await repositories.idempotencia.registrar({
        tenantId: input.tenantId,
        key,
        record: { requestHash, response },
      })
      return { status: 'executed', ...response }
    })
  }

  // Customer or provider read; other tenants receive NOT_FOUND to avoid existence leaks.
  async consultarObligacion(
    input: ContextoFinanzasServicio & { trabajoId: string }
  ): Promise<ObligacionPagoServicio | null> {
    validarContextoFinanzasServicio(input)
    return this.transaction.ejecutar(async (repositories) => {
      const trabajo = await this.requerirTrabajo(repositories, input, input.trabajoId)
      const obligation = await repositories.obligaciones.buscarPorTrabajo({
        tenantId: trabajo.tenantId,
        trabajoId: trabajo.trabajoId,
      })
      return obligation ? proyectarObligacion(obligation) : null
    })
  }

  // Customer command: persists the intention to pay. It never calls the provider inside the
  // transaction; dispatch is a separate, retryable step keyed by the payment id.
  async crearIntencionPago(
    input: ContextoFinanzasServicio & { trabajoId: string; idempotencyKey: string }
  ): Promise<ResultadoIntencionPago> {
    validarContextoFinanzasServicio(input)
    const key = validarClaveIdempotencia(input.idempotencyKey)
    const requestHash = huellaSolicitudFinanciera('service-payment.create', {
      trabajoId: input.trabajoId,
      actorId: input.actorId,
    })
    return this.transaction.ejecutar(async (repositories) => {
      const idempotency = resolverIdempotenciaFinanciera(
        await repositories.idempotencia.buscar({ tenantId: input.tenantId, key }),
        requestHash
      )
      if (idempotency.status === 'replay')
        return {
          status: 'replay',
          ...(idempotency.response as Omit<ResultadoIntencionPago, 'status'>),
        }
      const obligation = await this.asegurarObligacion(repositories, input, input.trabajoId, key)
      if (obligation.status !== 'pending_payment')
        throw new ErrorFinanzasServicio(
          409,
          'OBLIGATION_NOT_PAYABLE',
          `obligation is ${obligation.status}`
        )
      const intents = await repositories.intenciones.listarPorObligacion({
        tenantId: obligation.tenantId,
        obligacionId: obligation.obligacionId,
      })
      if (intents.some((intent) => intent.providerStatus === 'approved'))
        throw new ErrorFinanzasServicio(
          409,
          'OBLIGATION_NOT_PAYABLE',
          'obligation already has an approved payment'
        )
      const active = intents.find((intent) => intent.providerStatus === 'pending')
      let status: ResultadoIntencionPago['status'] = 'executed'
      let intent: IntencionPagoServicioDominio
      if (active) {
        status = 'existing'
        intent = active
      } else {
        const attempt = intents.reduce((max, candidate) => Math.max(max, candidate.attempt), 0) + 1
        const now = this.isoNow()
        intent = {
          paymentId: identificadorPago(obligation.obligacionId, attempt),
          obligacionId: obligation.obligacionId,
          trabajoId: obligation.trabajoId,
          tenantId: obligation.tenantId,
          prestadorTenantId: obligation.prestadorTenantId,
          attempt,
          amountMinor: obligation.amountMinor,
          currency: obligation.currency,
          providerStatus: 'pending',
          dispatchStatus: 'pending_dispatch',
          source: this.proveedor.source,
          providerReference: null,
          providerError: null,
          providerEventAt: null,
          idempotencyKey: key,
          correlationId: input.correlationId,
          createdAt: now,
          updatedAt: now,
        }
        await repositories.intenciones.crear(intent)
        await this.auditar(repositories, obligation, {
          resourceType: 'payment',
          resourceId: intent.paymentId,
          action: 'payment.intent_created',
          origin: 'customer',
          actorId: input.actorId,
          correlationId: input.correlationId,
          idempotencyKey: key,
          previousStatus: null,
          status: 'pending',
          metadata: {
            attempt,
            amountMinor: intent.amountMinor.toString(10),
            currency: intent.currency,
          },
        })
        await this.publicar(repositories, intent, 'tus.payment.intent_created', {
          obligationId: obligation.obligacionId,
          attempt,
          amountMinor: intent.amountMinor.toString(10),
          currency: intent.currency,
        })
      }
      const response = {
        obligation: proyectarObligacion(obligation),
        payment: proyectarIntencionPago(intent),
      }
      await repositories.idempotencia.registrar({
        tenantId: input.tenantId,
        key,
        record: { requestHash, response },
      })
      return { status, ...response }
    })
  }

  // Worker step: calls the provider outside any database transaction, then records the result.
  // The provider idempotency key is the payment id, so a retry after a crash is safe.
  async despacharIntencionPago(input: {
    tenantId: string
    paymentId: string
    correlationId: string
  }): Promise<ResultadoDespachoPago> {
    const intent = await this.transaction.ejecutar((repositories) =>
      this.requerirIntencion(repositories, input.tenantId, input.paymentId)
    )
    if (intent.dispatchStatus === 'dispatched')
      return { status: 'already_dispatched', payment: proyectarIntencionPago(intent) }
    if (intent.providerStatus !== 'pending')
      return { status: 'not_dispatchable', payment: proyectarIntencionPago(intent) }
    let providerReference: string | null = null
    let failure: string | null = null
    try {
      providerReference = (
        await this.proveedor.crearPago({
          paymentId: intent.paymentId,
          idempotencyKey: intent.paymentId,
          amountMinor: intent.amountMinor,
          currency: intent.currency,
        })
      ).providerReference
    } catch (error) {
      failure = error instanceof ErrorProveedorPagos ? error.code : 'PROVIDER_UNAVAILABLE'
    }
    return this.transaction.ejecutar(async (repositories) => {
      const current = await this.requerirIntencion(repositories, input.tenantId, input.paymentId)
      const obligation = await this.requerirObligacion(
        repositories,
        current.tenantId,
        current.obligacionId
      )
      if (current.dispatchStatus === 'dispatched') {
        if (providerReference && current.providerReference !== providerReference)
          throw new ErrorFinanzasServicio(
            409,
            'PROVIDER_REFERENCE_CONFLICT',
            'provider returned another reference'
          )
        return { status: 'already_dispatched', payment: proyectarIntencionPago(current) }
      }
      const updated: IntencionPagoServicioDominio = failure
        ? {
            ...current,
            dispatchStatus: 'dispatch_failed',
            providerError: failure,
            updatedAt: this.isoNow(),
          }
        : {
            ...current,
            dispatchStatus: 'dispatched',
            providerReference,
            providerError: null,
            updatedAt: this.isoNow(),
          }
      await repositories.intenciones.actualizar(updated)
      await this.auditar(repositories, obligation, {
        resourceType: 'payment',
        resourceId: updated.paymentId,
        action: failure ? 'payment.dispatch_failed' : 'payment.dispatched',
        origin: 'system',
        actorId: 'system:payment-dispatch',
        correlationId: input.correlationId,
        idempotencyKey: updated.paymentId,
        previousStatus: current.dispatchStatus,
        status: updated.dispatchStatus,
        metadata: failure ? { error: failure } : { providerReference },
      })
      if (!failure)
        await this.publicar(repositories, updated, 'tus.payment.intent_dispatched', {
          providerReference,
        })
      return failure
        ? { status: 'dispatch_failed', reason: failure, payment: proyectarIntencionPago(updated) }
        : { status: 'dispatched', payment: proyectarIntencionPago(updated) }
    })
  }

  // Provider notification ingestion. Signature first, then durable inbox, then an explicit
  // mapping and a validated transition. Duplicates and unknown events never mutate money.
  async ingerirEventoProveedor(input: EntradaEventoProveedor): Promise<ResultadoIngestaEvento> {
    let event: EventoPagoNormalizado
    try {
      event = this.proveedor.verificarEvento(input)
    } catch (error) {
      if (error instanceof ErrorFinanzasServicio && error.code === 'PROVIDER_UNAVAILABLE')
        throw error
      return {
        status: 'invalid',
        reason: error instanceof ErrorFinanzasServicio ? error.code : 'INVALID_EVENT',
      }
    }
    return this.transaction.ejecutar(async (repositories) => {
      const intent = await this.resolverIntencionEvento(repositories, event)
      if (!intent) return { status: 'unmatched', reason: 'payment_not_found' }
      const previous = await repositories.inbox.buscar({
        tenantId: intent.tenantId,
        provider: this.proveedor.provider,
        eventId: event.eventId,
      })
      if (previous) return { status: 'duplicate', eventId: event.eventId, result: previous.result }
      const obligation = await this.requerirObligacion(
        repositories,
        intent.tenantId,
        intent.obligacionId
      )
      const outcome = this.evaluarEvento(intent, event)
      let updatedIntent = intent
      let updatedObligation = obligation
      if (outcome.result === 'applied') {
        const nextStatus = event.status as EstadoProveedorPagoServicio
        updatedIntent = {
          ...intent,
          providerStatus: nextStatus,
          providerReference: event.providerReference,
          providerEventAt: event.occurredAt,
          updatedAt: this.isoNow(),
        }
        await repositories.intenciones.actualizar(updatedIntent)
        const obligationStatus =
          nextStatus === 'approved'
            ? 'paid'
            : nextStatus === 'refunded' || nextStatus === 'charged_back'
              ? nextStatus
              : null
        if (obligationStatus) {
          const moved = transicionarObligacion(obligation, obligationStatus, this.isoNow())
          const persisted = await repositories.obligaciones.actualizar({
            obligacion: moved,
            expectedVersion: obligation.version,
          })
          if (!persisted)
            throw new ErrorFinanzasServicio(
              409,
              'VERSION_CONFLICT',
              'obligation changed concurrently'
            )
          updatedObligation = moved
          await this.auditar(repositories, obligation, {
            resourceType: 'obligation',
            resourceId: obligation.obligacionId,
            action: `obligation.${obligationStatus}`,
            origin: 'provider_event',
            actorId: ACTOR_PROVEEDOR,
            correlationId: `provider-event:${event.eventId}`,
            idempotencyKey: event.eventId,
            previousStatus: obligation.status,
            status: obligationStatus,
            metadata: { paymentId: intent.paymentId },
          })
        }
        await this.alAplicarEventoPago(repositories, {
          previousIntent: intent,
          intent: updatedIntent,
          obligation: updatedObligation,
          event,
        })
        await this.publicar(repositories, updatedIntent, 'tus.payment.status_changed', {
          obligationId: intent.obligacionId,
          previousStatus: intent.providerStatus,
          status: nextStatus,
          providerEventId: event.eventId,
        })
      }
      await repositories.inbox.registrar({
        eventId: event.eventId,
        tenantId: intent.tenantId,
        provider: this.proveedor.provider,
        paymentId: intent.paymentId,
        obligacionId: intent.obligacionId,
        providerReference: event.providerReference,
        status: event.rawStatus,
        amountMinor: event.amountMinor,
        currency: event.currency,
        signature: input.signature,
        rawBody: input.rawBody,
        occurredAt: event.occurredAt,
        receivedAt: input.receivedAt,
        result: outcome.result,
        reason: outcome.reason,
      })
      await this.auditar(repositories, obligation, {
        resourceType: 'provider_event',
        resourceId: event.eventId,
        action: `provider_event.${outcome.result}`,
        origin: 'provider_event',
        actorId: ACTOR_PROVEEDOR,
        correlationId: `provider-event:${event.eventId}`,
        idempotencyKey: event.eventId,
        previousStatus: intent.providerStatus,
        status: updatedIntent.providerStatus,
        metadata: { paymentId: intent.paymentId, reason: outcome.reason },
      })
      return {
        status: 'recorded',
        eventId: event.eventId,
        result: outcome.result,
        reason: outcome.reason,
        payment: proyectarIntencionPago(updatedIntent),
        obligation: proyectarObligacion(updatedObligation),
      }
    })
  }

  async consultarFinanzasTrabajo(
    input: ContextoFinanzasServicio & { trabajoId: string }
  ): Promise<ResumenFinancieroTrabajoServicio> {
    validarContextoFinanzasServicio(input)
    return this.transaction.ejecutar(async (repositories) => {
      const trabajo = await this.requerirTrabajo(repositories, input, input.trabajoId)
      const viewer = trabajo.tenantId === input.tenantId ? 'customer' : 'provider'
      const obligation = await repositories.obligaciones.buscarPorTrabajo({
        tenantId: trabajo.tenantId,
        trabajoId: trabajo.trabajoId,
      })
      const payments = obligation
        ? await repositories.intenciones.listarPorObligacion({
            tenantId: obligation.tenantId,
            obligacionId: obligation.obligacionId,
          })
        : []
      return {
        trabajoId: trabajo.trabajoId,
        viewer,
        obligation: obligation ? proyectarObligacion(obligation) : null,
        payments: payments
          .sort((left, right) => left.attempt - right.attempt)
          .map(proyectarIntencionPago),
      }
    })
  }

  // Extension point for internal effects of an applied provider transition (WEB-09C).
  protected async alAplicarEventoPago(
    _repositories: RepositoriosFinanzasServicio,
    _input: {
      previousIntent: IntencionPagoServicioDominio
      intent: IntencionPagoServicioDominio
      obligation: ObligacionServicio
      event: EventoPagoNormalizado
    }
  ): Promise<void> {}

  protected evaluarEvento(
    intent: IntencionPagoServicioDominio,
    event: EventoPagoNormalizado
  ): { result: ResultadoEventoProveedor; reason: string | null } {
    if (intent.providerReference && intent.providerReference !== event.providerReference)
      return { result: 'quarantined', reason: 'provider_reference_mismatch' }
    if (event.currency !== intent.currency)
      return { result: 'quarantined', reason: 'currency_mismatch' }
    if (event.amountMinor !== intent.amountMinor)
      return { result: 'quarantined', reason: 'amount_mismatch' }
    if (event.status === 'unknown')
      return { result: 'ignored_unknown_status', reason: `unmapped:${event.rawStatus}` }
    if (
      intent.providerEventAt &&
      Date.parse(event.occurredAt) <= Date.parse(intent.providerEventAt)
    )
      return { result: 'stale', reason: 'older_than_last_applied_event' }
    if (event.status === intent.providerStatus) return { result: 'no_op', reason: 'same_status' }
    if (!esTransicionProveedorPermitida(intent.providerStatus, event.status))
      return { result: 'rejected_transition', reason: `${intent.providerStatus}->${event.status}` }
    return { result: 'applied', reason: null }
  }

  protected async resolverIntencionEvento(
    repositories: RepositoriosFinanzasServicio,
    event: EventoPagoNormalizado
  ): Promise<IntencionPagoServicioDominio | null> {
    const byReference = await repositories.intenciones.buscarPorReferenciaProveedor(
      event.providerReference
    )
    if (byReference.length === 1)
      return byReference[0]!.paymentId === event.paymentId ? byReference[0]! : null
    if (byReference.length > 1) return null
    // Crash window: the provider created the payment but the dispatch result was not stored.
    const byPayment = await repositories.intenciones.buscarPorPaymentId(event.paymentId)
    return byPayment.length === 1 && byPayment[0]!.providerReference === null ? byPayment[0]! : null
  }

  protected async requerirTrabajo(
    repositories: RepositoriosFinanzasServicio,
    context: ContextoFinanzasServicio,
    trabajoId: string
  ): Promise<Trabajo> {
    const trabajo = await repositories.identidad.buscarTrabajoAccesible({
      tenantId: context.tenantId,
      trabajoId,
    })
    if (!trabajo) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'work was not found')
    return trabajo
  }

  protected async requerirObligacion(
    repositories: RepositoriosFinanzasServicio,
    tenantId: string,
    obligacionId: string
  ): Promise<ObligacionServicio> {
    const obligation = await repositories.obligaciones.buscar({ tenantId, obligacionId })
    if (!obligation) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'obligation was not found')
    return obligation
  }

  protected async requerirIntencion(
    repositories: RepositoriosFinanzasServicio,
    tenantId: string,
    paymentId: string
  ): Promise<IntencionPagoServicioDominio> {
    const intent = await repositories.intenciones.buscar({ tenantId, paymentId })
    if (!intent) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'payment was not found')
    return intent
  }

  protected async asegurarObligacion(
    repositories: RepositoriosFinanzasServicio,
    context: ContextoFinanzasServicio,
    trabajoId: string,
    idempotencyKey: string
  ): Promise<ObligacionServicio> {
    const trabajo = await this.requerirTrabajo(repositories, context, trabajoId)
    if (trabajo.tenantId !== context.tenantId)
      throw new ErrorFinanzasServicio(
        403,
        'FORBIDDEN',
        'only the customer tenant can prepare the payment obligation'
      )
    const existing = await repositories.obligaciones.buscarPorTrabajo({
      tenantId: trabajo.tenantId,
      trabajoId: trabajo.trabajoId,
    })
    if (existing) {
      if (
        existing.commitmentId !== trabajo.commitmentId ||
        existing.prestadorTenantId !== trabajo.prestadorTenantId ||
        existing.budgetId !== (trabajo.acceptedBudgetId ?? null) ||
        existing.budgetVersion !== (trabajo.acceptedBudgetVersion ?? null)
      )
        throw new ErrorFinanzasServicio(
          409,
          'OBLIGATION_STALE',
          'payment obligation no longer matches the work'
        )
      return existing
    }
    const compromiso = await repositories.identidad.buscarCompromiso({
      tenantId: trabajo.tenantId,
      commitmentId: trabajo.commitmentId,
    })
    const publicacion = await repositories.identidad.buscarPublicacion({
      prestadorTenantId: trabajo.prestadorTenantId,
      publicacionId: trabajo.publicacionId,
    })
    if (!compromiso || !publicacion)
      throw new ErrorFinanzasServicio(
        409,
        'INCONSISTENT_COMMERCIAL_CHAIN',
        'work commercial references were not found'
      )
    const presupuesto =
      trabajo.acceptedBudgetId && trabajo.acceptedBudgetVersion
        ? await repositories.identidad.buscarPresupuesto({
            tenantId: trabajo.tenantId,
            trabajoId: trabajo.trabajoId,
            presupuestoId: trabajo.acceptedBudgetId,
            version: trabajo.acceptedBudgetVersion,
          })
        : null
    const obligation = derivarObligacionServicio({
      context,
      trabajo,
      compromiso,
      publicacion,
      presupuesto,
      now: this.isoNow(),
    })
    await repositories.obligaciones.crear(obligation)
    await this.auditar(repositories, obligation, {
      resourceType: 'obligation',
      resourceId: obligation.obligacionId,
      action: 'obligation.created',
      origin: 'customer',
      actorId: context.actorId,
      correlationId: context.correlationId,
      idempotencyKey,
      previousStatus: null,
      status: obligation.status,
      metadata: {
        amountSource: obligation.amountSource,
        amountMinor: obligation.amountMinor.toString(10),
        currency: obligation.currency,
      },
    })
    return obligation
  }

  protected async auditar(
    repositories: RepositoriosFinanzasServicio,
    obligation: ObligacionServicio,
    record: Omit<
      RegistroAuditoriaFinanciera,
      'auditId' | 'tenantId' | 'prestadorTenantId' | 'obligacionId' | 'createdAt'
    >
  ): Promise<void> {
    await repositories.auditoria.registrar({
      ...record,
      auditId: `auditoria-fin-${randomUUID()}`,
      tenantId: obligation.tenantId,
      prestadorTenantId: obligation.prestadorTenantId,
      obligacionId: obligation.obligacionId,
      createdAt: this.isoNow(),
    })
  }

  protected async publicar(
    repositories: RepositoriosFinanzasServicio,
    intent: IntencionPagoServicioDominio,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await repositories.outbox.publicar({
      eventId: `${eventType}:${intent.paymentId}:${String(payload['providerEventId'] ?? payload['providerReference'] ?? intent.attempt)}`,
      tenantId: intent.tenantId,
      aggregateType: 'intencion_pago_servicio',
      aggregateId: intent.paymentId,
      eventType,
      payload: {
        paymentId: intent.paymentId,
        providerTenantId: intent.prestadorTenantId,
        ...payload,
      },
      createdAt: this.isoNow(),
    })
  }

  protected isoNow(): string {
    return new Date(this.now()).toISOString()
  }
}

export default { ServicioFinanzasServicios }
