import { randomUUID } from 'node:crypto'
import type {
  ConciliacionServicio,
  EstadoProveedorPagoServicio,
  IntencionPagoServicio,
  LiquidacionServicio,
  EstadoReembolsoServicio,
  MotivoNoCobrableServicio,
  ObligacionPagoServicio,
  ReembolsoServicio,
  Trabajo,
  VistaPreviaPagoServicio,
} from '@factory/contracts'
import {
  ESTADOS_PRESUPUESTO,
  ESTADOS_TRABAJO,
  TUS_CONTRACT_VERSION,
  formatMinorUnits,
} from '@factory/contracts'
import { PoliticaCobroFija, type PuertoPoliticaCobro } from './configuracion.ts'
import {
  REGLA_COMISION_SERVICIO_POR_DEFECTO,
  calcularDesgloseCobro,
  calcularInstantaneaComision,
  crearLiquidacion,
  evaluarConciliacion,
  movimientoCompensacion,
  movimientosAprobacion,
  proyectarLiquidacion,
  transicionarLiquidacion,
  type InstantaneaComisionServicio,
  type LiquidacionServicioDominio,
  type MovimientoContableServicio,
  type ReglaComisionServicio,
} from './liquidacion.ts'
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
  type ResultadoCheckout,
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
  aggregateType: 'obligacion_pago_servicio' | 'intencion_pago_servicio' | 'liquidacion_servicio'
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

// One commission snapshot per obligation (unique index); the snapshot is immutable.
export interface PuertoComisionesServicio {
  buscar(input: {
    tenantId: string
    obligacionId: string
  }): Promise<InstantaneaComisionServicio | null>
  crear(snapshot: InstantaneaComisionServicio): Promise<void>
  // WEB-09E: write-once completion of the PSP fee when Mercado Pago reports it after approval.
  registrarFeeProveedor(input: {
    tenantId: string
    obligacionId: string
    pspFeeMinor: bigint
    providerNetMinor: bigint
  }): Promise<boolean>
}

// WEB-09E refund attempts (total refunds only). Status changes of money still come only from
// verified provider events; this record tracks the request sent to Mercado Pago.
export interface ReembolsoServicioDominio {
  reembolsoId: string
  tenantId: string
  prestadorTenantId: string
  obligacionId: string
  paymentId: string
  attempt: number
  amountMinor: bigint
  currency: string
  status: EstadoReembolsoServicio
  providerRefundId: string | null
  providerError: string | null
  reason: string
  idempotencyKey: string
  actorId: string
  correlationId: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface PuertoReembolsosServicio {
  listarPorPago(input: { tenantId: string; paymentId: string }): Promise<ReembolsoServicioDominio[]>
  buscarPorClave(input: { tenantId: string; key: string }): Promise<ReembolsoServicioDominio | null>
  crear(refund: ReembolsoServicioDominio): Promise<void>
  actualizar(input: { refund: ReembolsoServicioDominio; expectedVersion: number }): Promise<boolean>
}

// Shared append-only ledger (`movimientos_contables`): no update or delete operation exists.
export interface PuertoLedgerServicio {
  listar(input: { tenantId: string; obligacionId: string }): Promise<MovimientoContableServicio[]>
  agregar(entry: MovimientoContableServicio): Promise<void>
}

export interface PuertoLiquidacionesServicio {
  buscar(input: {
    tenantId: string
    obligacionId: string
  }): Promise<LiquidacionServicioDominio | null>
  crear(settlement: LiquidacionServicioDominio): Promise<void>
  actualizar(input: {
    settlement: LiquidacionServicioDominio
    expectedVersion: number
  }): Promise<LiquidacionServicioDominio | null>
}

export interface PuertoConciliacionesServicio {
  registrar(result: ConciliacionServicio & { prestadorTenantId: string }): Promise<void>
}

export interface RepositoriosFinanzasServicio {
  identidad: PuertoIdentidadServicio
  obligaciones: PuertoObligacionesServicio
  idempotencia: PuertoIdempotenciaFinanciera
  intenciones: PuertoIntencionesPagoServicio
  inbox: PuertoInboxEventosPago
  outbox: PuertoOutboxFinanciero
  auditoria: PuertoAuditoriaFinanciera
  comisiones: PuertoComisionesServicio
  ledger: PuertoLedgerServicio
  liquidaciones: PuertoLiquidacionesServicio
  conciliaciones: PuertoConciliacionesServicio
  reembolsos: PuertoReembolsosServicio
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
      status: 'dispatched' | 'already_dispatched' | 'not_dispatchable' | 'in_progress'
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
  // Provider-only: commission and internal settlement. Customers never receive them.
  settlement?: LiquidacionServicio | null
  commission?: {
    rateBps: number
    ruleVersion: string
    grossMinor?: string
    commissionMinor?: string
    pspFeeMinor?: string | null
    providerNetMinor?: string | null
    currency?: string
  } | null
}

export type ResultadoCheckoutServicio = {
  status: 'created' | 'existing'
  obligation: ObligacionPagoServicio
  payment: IntencionPagoServicio
  checkoutUrl: string
}

export type ResultadoReembolso = {
  status: 'submitted' | 'requires_review' | 'failed' | 'existing' | 'replay'
  refund: ReembolsoServicio
}

export type ResultadoEvaluacionLiquidacion = {
  status: 'eligible' | 'unchanged'
  reason: string
  settlement: LiquidacionServicio | null
}

const ACTOR_PROVEEDOR = 'provider:mercado-pago'
// A dispatch claim protects the provider call against concurrent clicks; it expires so that a
// crashed request never blocks the payment forever.
const DURACION_RECLAMO_DESPACHO_MS = 30_000

export class ServicioFinanzasServicios {
  protected readonly transaction: PuertoTransaccionFinanzasServicio
  protected readonly now: () => number
  protected readonly proveedor: PuertoProveedorPagosServicio
  protected readonly reglaComision: ReglaComisionServicio
  protected readonly politica: PuertoPoliticaCobro

  constructor(
    transaction: PuertoTransaccionFinanzasServicio,
    now: () => number = () => Date.now(),
    proveedor: PuertoProveedorPagosServicio = new ProveedorPagosServicioNoDisponible(),
    reglaComision: ReglaComisionServicio = REGLA_COMISION_SERVICIO_POR_DEFECTO,
    politica?: PuertoPoliticaCobro
  ) {
    this.transaction = transaction
    this.now = now
    this.proveedor = proveedor
    this.reglaComision = reglaComision
    // Without a persisted policy, availability follows the injected provider: the runtime
    // default (`held-no-provider`) is never available.
    this.politica =
      politica ??
      new PoliticaCobroFija(
        {
          politicaId: reglaComision.politicaId ?? null,
          rateBps: reglaComision.rateBps,
          ruleVersion: reglaComision.ruleVersion,
          pspFeeBearer: reglaComision.pspFeeBearer ?? 'undetermined',
        },
        proveedor.source !== 'held-no-provider'
      )
  }

  // WEB-09D customer read: what this completed work would cost and whether it can be paid now.
  // Read-only: it never creates an obligation, an intent or any audit/outbox record.
  async consultarVistaPreviaPago(
    input: ContextoFinanzasServicio & { trabajoId: string }
  ): Promise<VistaPreviaPagoServicio> {
    validarContextoFinanzasServicio(input)
    return this.transaction.ejecutar(async (repositories) => {
      const trabajo = await this.requerirTrabajo(repositories, input, input.trabajoId)
      if (trabajo.tenantId !== input.tenantId)
        throw new ErrorFinanzasServicio(
          403,
          'FORBIDDEN',
          'only the customer can review the payment of this work'
        )
      const cobro = await this.evaluarCobro(repositories, trabajo)
      const obligation = await repositories.obligaciones.buscarPorTrabajo({
        tenantId: trabajo.tenantId,
        trabajoId: trabajo.trabajoId,
      })
      const intents = obligation
        ? await repositories.intenciones.listarPorObligacion({
            tenantId: obligation.tenantId,
            obligacionId: obligation.obligacionId,
          })
        : []
      const latest = intents.reduce<IntencionPagoServicioDominio | null>(
        (best, intent) => (!best || intent.attempt > best.attempt ? intent : best),
        null
      )
      let notPayableReason = cobro.reason
      if (!notPayableReason && obligation && obligation.status !== 'pending_payment')
        notPayableReason = obligation.status === 'paid' ? 'ALREADY_PAID' : 'OBLIGATION_CLOSED'
      if (!notPayableReason && intents.some((intent) => intent.providerStatus === 'approved'))
        notPayableReason = 'ALREADY_PAID'
      const availability = notPayableReason
        ? null
        : await this.politica.disponibilidad({
            prestadorTenantId: trabajo.prestadorTenantId,
            prestadorId: trabajo.prestadorId,
            categoria: cobro.publicacion?.categoria ?? null,
          })
      const budget = cobro.presupuesto
      return {
        contractVersion: TUS_CONTRACT_VERSION,
        workId: trabajo.trabajoId,
        workStatus: trabajo.status,
        publicacionId: trabajo.publicacionId,
        serviceName: cobro.publicacion?.nombre ?? null,
        prestadorId: trabajo.prestadorId,
        budget: budget
          ? {
              budgetId: budget.presupuestoId,
              version: budget.version,
              totalMinor: formatMinorUnits(budget.totalMinor),
              currency: budget.currency,
            }
          : null,
        amountMinor: budget && !cobro.reason ? formatMinorUnits(budget.totalMinor) : null,
        currency: budget && !cobro.reason ? budget.currency : null,
        payable: notPayableReason === null,
        notPayableReason,
        obligation: obligation
          ? { obligacionId: obligation.obligacionId, status: obligation.status }
          : null,
        paymentStatus: latest?.providerStatus ?? 'not_started',
        latestPaymentId: latest?.paymentId ?? null,
        paymentReference:
          intents.find((intent) => intent.providerStatus === 'approved')?.providerReference ?? null,
        lastAttemptFailed:
          latest?.providerStatus === 'pending' &&
          Boolean(latest.providerError?.startsWith('PAYMENT_')),
        provider: 'mercado-pago',
        paymentAvailable: availability?.available === true,
        unavailableReason: notPayableReason ?? availability?.reason ?? null,
      }
    })
  }

  // Product rule (WEB-09D): a service is paid only after the work is completed, and only for
  // the accepted, versioned budget. Listing prices ("desde", "por hora", fixed) never set the
  // amount. Returns the reason instead of throwing so the preview can explain it.
  protected async evaluarCobro(
    repositories: RepositoriosFinanzasServicio,
    trabajo: Trabajo
  ): Promise<{
    reason: MotivoNoCobrableServicio | null
    presupuesto: PresupuestoFinanciero | null
    publicacion: PublicacionServicioFinanciera | null
  }> {
    const publicacion = await repositories.identidad.buscarPublicacion({
      prestadorTenantId: trabajo.prestadorTenantId,
      publicacionId: trabajo.publicacionId,
    })
    const presupuesto =
      trabajo.acceptedBudgetId && trabajo.acceptedBudgetVersion
        ? await repositories.identidad.buscarPresupuesto({
            tenantId: trabajo.tenantId,
            trabajoId: trabajo.trabajoId,
            presupuestoId: trabajo.acceptedBudgetId,
            version: trabajo.acceptedBudgetVersion,
          })
        : null
    const result = (reason: MotivoNoCobrableServicio | null) => ({
      reason,
      presupuesto,
      publicacion,
    })
    if (!publicacion || publicacion.prestadorId !== trabajo.prestadorId)
      return result('INCONSISTENT_COMMERCIAL_CHAIN')
    if (trabajo.status === ESTADOS_TRABAJO.CANCELADO) return result('WORK_CANCELLED')
    if (!trabajo.acceptedBudgetId || !trabajo.acceptedBudgetVersion) {
      return result(
        trabajo.status === ESTADOS_TRABAJO.COMPLETADO ? 'BUDGET_REQUIRED' : 'WORK_NOT_COMPLETED'
      )
    }
    if (
      !presupuesto ||
      presupuesto.status !== ESTADOS_PRESUPUESTO.ACEPTADO ||
      presupuesto.prestadorTenantId !== trabajo.prestadorTenantId
    )
      return result('BUDGET_INCONSISTENT')
    if (trabajo.status !== ESTADOS_TRABAJO.COMPLETADO) return result('WORK_NOT_COMPLETED')
    return result(null)
  }

  // Throws when the work cannot be charged now; used before any financial write.
  protected async exigirCobroDisponible(
    repositories: RepositoriosFinanzasServicio,
    context: ContextoFinanzasServicio,
    trabajoId: string
  ): Promise<{ publicacion: PublicacionServicioFinanciera | null; trabajo: Trabajo }> {
    const trabajo = await this.requerirTrabajo(repositories, context, trabajoId)
    if (trabajo.tenantId !== context.tenantId)
      throw new ErrorFinanzasServicio(
        403,
        'FORBIDDEN',
        'only the customer tenant can prepare the payment obligation'
      )
    const cobro = await this.evaluarCobro(repositories, trabajo)
    if (cobro.reason)
      throw new ErrorFinanzasServicio(409, cobro.reason, `work is not payable: ${cobro.reason}`)
    const availability = await this.politica.disponibilidad({
      prestadorTenantId: trabajo.prestadorTenantId,
      prestadorId: trabajo.prestadorId,
      categoria: cobro.publicacion?.categoria ?? null,
    })
    if (!availability.available)
      throw new ErrorFinanzasServicio(
        503,
        availability.reason ?? 'PAYMENTS_DISABLED',
        'online payment is not available yet'
      )
    return { publicacion: cobro.publicacion, trabajo }
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
      await this.exigirCobroDisponible(repositories, input, input.trabajoId)
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
      const { publicacion } = await this.exigirCobroDisponible(repositories, input, input.trabajoId)
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
        // WEB-09E: the commission is converted to an amount now and frozen on the intent; it is
        // what Mercado Pago receives as `marketplace_fee` and what the approval snapshot books.
        const rule = await this.politica.reglaComision({
          prestadorTenantId: obligation.prestadorTenantId,
          prestadorId: obligation.prestadorId,
          categoria: publicacion?.categoria ?? null,
        })
        const breakdown = calcularDesgloseCobro({
          grossMinor: obligation.amountMinor,
          rateBps: rule.rateBps,
          pspFeeBearer: 'provider',
          pspFeeMinor: null,
        })
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
          commission: {
            rateBps: rule.rateBps,
            ruleVersion: rule.ruleVersion,
            politicaId: rule.politicaId,
            commissionMinor: breakdown.commissionMinor,
          },
          checkoutReference: null,
          checkoutUrl: null,
          checkoutExpiresAt: null,
          dispatchClaimedUntil: null,
          environment: this.proveedor.environment ?? null,
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

  // Calls the provider outside any database transaction, then records the result. A short
  // claim stored on the intent makes concurrent requests wait instead of creating a second
  // checkout; the provider idempotency key is the server-side payment id.
  async despacharIntencionPago(input: {
    tenantId: string
    paymentId: string
    correlationId: string
  }): Promise<ResultadoDespachoPago> {
    const claim = await this.transaction.ejecutar(async (repositories) => {
      const intent = await this.requerirIntencion(repositories, input.tenantId, input.paymentId)
      if (intent.dispatchStatus === 'dispatched')
        return { status: 'already_dispatched' as const, intent }
      if (intent.providerStatus !== 'pending')
        return { status: 'not_dispatchable' as const, intent }
      if (intent.dispatchClaimedUntil && Date.parse(intent.dispatchClaimedUntil) > this.now())
        return { status: 'in_progress' as const, intent }
      const claimed: IntencionPagoServicioDominio = {
        ...intent,
        dispatchClaimedUntil: new Date(this.now() + DURACION_RECLAMO_DESPACHO_MS).toISOString(),
        updatedAt: this.isoNow(),
      }
      await repositories.intenciones.actualizar(claimed)
      const obligation = await this.requerirObligacion(
        repositories,
        intent.tenantId,
        intent.obligacionId
      )
      const publicacion = await repositories.identidad.buscarPublicacion({
        prestadorTenantId: obligation.prestadorTenantId,
        publicacionId: obligation.publicacionId,
      })
      return { status: 'claimed' as const, intent: claimed, title: publicacion?.nombre ?? null }
    })
    if (claim.status !== 'claimed')
      return { status: claim.status, payment: proyectarIntencionPago(claim.intent) }
    const intent = claim.intent
    let result: ResultadoCheckout | null = null
    let failure: string | null = null
    try {
      result = await this.proveedor.crearPago({
        paymentId: intent.paymentId,
        idempotencyKey: intent.paymentId,
        amountMinor: intent.amountMinor,
        currency: intent.currency,
        prestadorTenantId: intent.prestadorTenantId,
        commissionMinor: intent.commission?.commissionMinor ?? null,
        title: claim.title ?? 'Servicio TUS',
        trabajoId: intent.trabajoId,
      })
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
        if (
          result?.providerReference &&
          current.providerReference &&
          current.providerReference !== result.providerReference
        )
          throw new ErrorFinanzasServicio(
            409,
            'PROVIDER_REFERENCE_CONFLICT',
            'provider returned another reference'
          )
        return { status: 'already_dispatched', payment: proyectarIntencionPago(current) }
      }
      const updated: IntencionPagoServicioDominio =
        failure || !result
          ? {
              ...current,
              dispatchStatus: 'dispatch_failed',
              providerError: failure ?? 'PROVIDER_UNAVAILABLE',
              dispatchClaimedUntil: null,
              updatedAt: this.isoNow(),
            }
          : {
              ...current,
              dispatchStatus: 'dispatched',
              // A provider event may already have set the payment reference (crash window).
              providerReference: current.providerReference ?? result.providerReference,
              checkoutReference: result.checkoutReference ?? null,
              checkoutUrl: result.checkoutUrl ?? null,
              checkoutExpiresAt: result.checkoutExpiresAt ?? null,
              providerError: null,
              dispatchClaimedUntil: null,
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
        metadata: failure
          ? { error: failure }
          : {
              providerReference: updated.providerReference,
              checkoutReference: updated.checkoutReference ?? null,
              commissionMinor: updated.commission?.commissionMinor.toString(10) ?? null,
            },
      })
      if (!failure)
        await this.publicar(repositories, updated, 'tus.payment.intent_dispatched', {
          providerReference: updated.providerReference ?? updated.checkoutReference ?? null,
        })
      return failure
        ? { status: 'dispatch_failed', reason: failure, payment: proyectarIntencionPago(updated) }
        : { status: 'dispatched', payment: proyectarIntencionPago(updated) }
    })
  }

  // WEB-09E customer command: creates (or reuses) the payment intent and its hosted checkout
  // and returns the provider URL. The browser only sends the work id and an intent key; amount,
  // commission and seller come from the server. The URL never confirms a payment.
  async iniciarCheckout(
    input: ContextoFinanzasServicio & { trabajoId: string; idempotencyKey: string }
  ): Promise<ResultadoCheckoutServicio> {
    const created = await this.crearIntencionPago(input)
    const current = await this.transaction.ejecutar((repositories) =>
      this.requerirIntencion(repositories, created.payment.tenantId, created.payment.paymentId)
    )
    let payment = proyectarIntencionPago(current)
    if (current.dispatchStatus !== 'dispatched' || !current.checkoutUrl) {
      const dispatched = await this.despacharIntencionPago({
        tenantId: current.tenantId,
        paymentId: current.paymentId,
        correlationId: input.correlationId,
      })
      if (dispatched.status === 'in_progress')
        throw new ErrorFinanzasServicio(409, 'IN_PROGRESS', 'the checkout is being created; retry')
      if (dispatched.status === 'dispatch_failed')
        throw new ErrorFinanzasServicio(
          dispatched.reason === 'PROVIDER_ACCOUNT_NOT_CONNECTED' ? 503 : 502,
          dispatched.reason,
          'Mercado Pago did not create the checkout'
        )
      if (dispatched.status === 'not_dispatchable')
        throw new ErrorFinanzasServicio(
          409,
          'OBLIGATION_NOT_PAYABLE',
          'payment is no longer pending'
        )
      payment = dispatched.payment
    }
    if (!payment.checkoutUrl)
      throw new ErrorFinanzasServicio(502, 'PROVIDER_REJECTED', 'provider returned no checkout URL')
    return {
      status: created.status === 'executed' ? 'created' : 'existing',
      obligation: created.obligation,
      payment,
      checkoutUrl: payment.checkoutUrl,
    }
  }

  // WEB-09E platform command: total refund of an approved payment through the seller account.
  // The provider decides; a refusal (for example seller without balance) stays visible as
  // `requires_review`. TUS never covers the seller's part automatically.
  async solicitarReembolso(input: {
    tenantId: string
    paymentId: string
    actorId: string
    correlationId: string
    idempotencyKey: string
    reason: string
  }): Promise<ResultadoReembolso> {
    const key = validarClaveIdempotencia(input.idempotencyKey)
    const reason = input.reason?.trim().slice(0, 500)
    if (!reason) throw new ErrorFinanzasServicio(400, 'INVALID', 'refund reason is required')
    if (!this.proveedor.reembolsar)
      throw new ErrorFinanzasServicio(503, 'PROVIDER_NOT_CONFIGURED', 'refunds are not available')
    const prepared = await this.transaction.ejecutar(async (repositories) => {
      const previous = await repositories.reembolsos.buscarPorClave({
        tenantId: input.tenantId,
        key,
      })
      if (previous) {
        if (previous.paymentId !== input.paymentId)
          throw new ErrorFinanzasServicio(
            409,
            'IDEMPOTENCY_CONFLICT',
            'idempotency key was already used for another refund'
          )
        return { status: 'replay' as const, refund: previous }
      }
      const intent = await this.requerirIntencion(repositories, input.tenantId, input.paymentId)
      if (intent.providerStatus !== 'approved' || !intent.providerReference)
        throw new ErrorFinanzasServicio(
          409,
          'NOT_REFUNDABLE',
          'only approved payments can be refunded'
        )
      const refunds = await repositories.reembolsos.listarPorPago({
        tenantId: intent.tenantId,
        paymentId: intent.paymentId,
      })
      const active = refunds.find(
        (refund) => refund.status === 'requested' || refund.status === 'submitted'
      )
      if (active) return { status: 'existing' as const, refund: active }
      const now = this.isoNow()
      const attempt = refunds.reduce((max, refund) => Math.max(max, refund.attempt), 0) + 1
      const refund: ReembolsoServicioDominio = {
        reembolsoId: `reembolso-${intent.paymentId}-${attempt}`,
        tenantId: intent.tenantId,
        prestadorTenantId: intent.prestadorTenantId,
        obligacionId: intent.obligacionId,
        paymentId: intent.paymentId,
        attempt,
        amountMinor: intent.amountMinor,
        currency: intent.currency,
        status: 'requested',
        providerRefundId: null,
        providerError: null,
        reason,
        idempotencyKey: key,
        actorId: input.actorId,
        correlationId: input.correlationId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }
      await repositories.reembolsos.crear(refund)
      const obligation = await this.requerirObligacion(
        repositories,
        intent.tenantId,
        intent.obligacionId
      )
      await this.auditar(repositories, obligation, {
        resourceType: 'payment',
        resourceId: intent.paymentId,
        action: 'payment.refund_requested',
        origin: 'system',
        actorId: input.actorId,
        correlationId: input.correlationId,
        idempotencyKey: key,
        previousStatus: null,
        status: 'requested',
        metadata: { reembolsoId: refund.reembolsoId, amountMinor: refund.amountMinor.toString(10) },
      })
      return {
        status: 'new' as const,
        refund,
        providerReference: intent.providerReference,
      }
    })
    if (prepared.status !== 'new')
      return { status: prepared.status, refund: proyectarReembolso(prepared.refund) }
    let providerRefundId: string | null = null
    let failure: string | null = null
    try {
      providerRefundId = (
        await this.proveedor.reembolsar({
          prestadorTenantId: prepared.refund.prestadorTenantId,
          providerReference: prepared.providerReference,
          idempotencyKey: prepared.refund.reembolsoId,
        })
      ).providerRefundId
    } catch (error) {
      failure = error instanceof ErrorProveedorPagos ? error.code : 'PROVIDER_UNAVAILABLE'
    }
    return this.transaction.ejecutar(async (repositories) => {
      // Only errors that prove nothing reached Mercado Pago are `failed` (retryable). Timeouts
      // and unavailability are ambiguous and, like a seller without balance, need manual review.
      const status: EstadoReembolsoServicio = !failure
        ? 'submitted'
        : failure === 'PROVIDER_ACCOUNT_NOT_CONNECTED'
          ? 'failed'
          : 'requires_review'
      const next: ReembolsoServicioDominio = {
        ...prepared.refund,
        status,
        providerRefundId,
        providerError: failure,
        version: prepared.refund.version + 1,
        updatedAt: this.isoNow(),
      }
      if (
        !(await repositories.reembolsos.actualizar({
          refund: next,
          expectedVersion: prepared.refund.version,
        }))
      )
        throw new ErrorFinanzasServicio(409, 'VERSION_CONFLICT', 'refund changed concurrently')
      const obligation = await this.requerirObligacion(
        repositories,
        next.tenantId,
        next.obligacionId
      )
      await this.auditar(repositories, obligation, {
        resourceType: 'payment',
        resourceId: next.paymentId,
        action: `payment.refund_${status}`,
        origin: 'system',
        actorId: input.actorId,
        correlationId: input.correlationId,
        idempotencyKey: next.idempotencyKey,
        previousStatus: 'requested',
        status,
        metadata: { reembolsoId: next.reembolsoId, providerRefundId, error: failure },
      })
      await repositories.outbox.publicar({
        eventId: `tus.payment.refund_${status}:${next.reembolsoId}`,
        tenantId: next.tenantId,
        aggregateType: 'intencion_pago_servicio',
        aggregateId: next.paymentId,
        eventType: `tus.payment.refund_${status}`,
        payload: {
          paymentId: next.paymentId,
          refundId: next.reembolsoId,
          providerTenantId: next.prestadorTenantId,
          error: failure,
        },
        createdAt: this.isoNow(),
      })
      return {
        status: status === 'submitted' ? 'submitted' : status,
        refund: proyectarReembolso(next),
      }
    })
  }

  // Provider notification ingestion. Signature first, then durable inbox, then an explicit
  // mapping and a validated transition. Duplicates and unknown events never mutate money.
  async ingerirEventoProveedor(input: EntradaEventoProveedor): Promise<ResultadoIngestaEvento> {
    let event: EventoPagoNormalizado
    try {
      event = await this.proveedor.verificarEvento(input)
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
      if (outcome.reason?.startsWith('hosted_checkout_attempt_')) {
        updatedIntent = {
          ...intent,
          providerError: `PAYMENT_${String(event.status).toUpperCase()}`,
          updatedAt: this.isoNow(),
        }
        await repositories.intenciones.actualizar(updatedIntent)
      }
      if (
        outcome.result === 'no_op' &&
        event.status === 'approved' &&
        event.pspFeeMinor !== null &&
        event.pspFeeMinor !== undefined
      )
        await this.completarFeeProveedor(repositories, obligation, event)
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
      const summary: ResumenFinancieroTrabajoServicio = {
        trabajoId: trabajo.trabajoId,
        viewer,
        obligation: obligation ? proyectarObligacion(obligation) : null,
        payments: payments
          .sort((left, right) => left.attempt - right.attempt)
          .map(proyectarIntencionPago),
      }
      if (viewer === 'customer') return summary
      const settlement = obligation
        ? await repositories.liquidaciones.buscar({
            tenantId: obligation.tenantId,
            obligacionId: obligation.obligacionId,
          })
        : null
      const snapshot = obligation
        ? await repositories.comisiones.buscar({
            tenantId: obligation.tenantId,
            obligacionId: obligation.obligacionId,
          })
        : null
      return {
        ...summary,
        settlement: settlement ? proyectarLiquidacion(settlement) : null,
        commission: snapshot
          ? {
              rateBps: snapshot.rateBps,
              ruleVersion: snapshot.ruleVersion,
              grossMinor: formatMinorUnits(snapshot.grossMinor),
              commissionMinor: formatMinorUnits(snapshot.commissionMinor),
              pspFeeMinor:
                snapshot.pspFeeMinor === null ? null : formatMinorUnits(snapshot.pspFeeMinor),
              providerNetMinor:
                snapshot.providerNetMinor === null
                  ? null
                  : formatMinorUnits(snapshot.providerNetMinor),
              currency: snapshot.currency,
            }
          : null,
      }
    })
  }

  // System step (future consumer of `tus.work.completed`): marks the internal settlement as
  // eligible only when the payment is approved and the work is completed. It moves no money.
  async evaluarLiquidacion(input: {
    tenantId: string
    obligacionId: string
    correlationId: string
  }): Promise<ResultadoEvaluacionLiquidacion> {
    return this.transaction.ejecutar(async (repositories) => {
      const obligation = await this.requerirObligacion(
        repositories,
        input.tenantId,
        input.obligacionId
      )
      const settlement = await repositories.liquidaciones.buscar({
        tenantId: obligation.tenantId,
        obligacionId: obligation.obligacionId,
      })
      if (!settlement)
        return { status: 'unchanged', reason: 'payment_not_approved', settlement: null }
      if (settlement.status !== 'held')
        return {
          status: 'unchanged',
          reason: `settlement_${settlement.status}`,
          settlement: proyectarLiquidacion(settlement),
        }
      if (obligation.status !== 'paid')
        return {
          status: 'unchanged',
          reason: `obligation_${obligation.status}`,
          settlement: proyectarLiquidacion(settlement),
        }
      const trabajo = await repositories.identidad.buscarTrabajoAccesible({
        tenantId: obligation.tenantId,
        trabajoId: obligation.trabajoId,
      })
      if (trabajo?.status !== ESTADOS_TRABAJO.COMPLETADO)
        return {
          status: 'unchanged',
          reason: 'work_not_completed',
          settlement: proyectarLiquidacion(settlement),
        }
      const eligible = transicionarLiquidacion(
        settlement,
        'eligible',
        'work_completed_payment_approved',
        this.isoNow()
      )
      await this.guardarLiquidacion(repositories, settlement, eligible)
      await this.auditar(repositories, obligation, {
        resourceType: 'settlement',
        resourceId: settlement.liquidacionId,
        action: 'settlement.eligible',
        origin: 'system',
        actorId: 'system:settlement-evaluation',
        correlationId: input.correlationId,
        idempotencyKey: null,
        previousStatus: settlement.status,
        status: eligible.status,
        metadata: { payoutStatus: 'not_executed' },
      })
      await this.publicarLiquidacion(repositories, eligible, 'tus.service_settlement.eligible')
      return {
        status: 'eligible',
        reason: eligible.reason,
        settlement: proyectarLiquidacion(eligible),
      }
    })
  }

  // Internal reconciliation: provider evidence (verified inbox) vs local payment vs ledger vs
  // settlement. Discrepancies freeze the settlement but never rewrite economic records.
  async conciliarObligacion(input: {
    tenantId: string
    obligacionId: string
    actorId: string
    correlationId: string
  }): Promise<ConciliacionServicio> {
    return this.transaction.ejecutar(async (repositories) => {
      const obligation = await this.requerirObligacion(
        repositories,
        input.tenantId,
        input.obligacionId
      )
      const scope = { tenantId: obligation.tenantId, obligacionId: obligation.obligacionId }
      const [intents, events, ledger, snapshot, settlement] = await Promise.all([
        repositories.intenciones.listarPorObligacion(scope),
        repositories.inbox.listarPorObligacion(scope),
        repositories.ledger.listar(scope),
        repositories.comisiones.buscar(scope),
        repositories.liquidaciones.buscar(scope),
      ])
      const evaluation = evaluarConciliacion({
        obligation,
        intents,
        events,
        ledger,
        snapshot,
        settlement,
      })
      const now = this.isoNow()
      const result: ConciliacionServicio = {
        contractVersion: TUS_CONTRACT_VERSION,
        conciliacionId: `conciliacion-${obligation.obligacionId}-${randomUUID()}`,
        obligacionId: obligation.obligacionId,
        tenantId: obligation.tenantId,
        status: evaluation.status,
        findings: evaluation.findings,
        expectedMinor: formatMinorUnits(obligation.amountMinor),
        currency: obligation.currency,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: now,
      }
      await repositories.conciliaciones.registrar({
        ...result,
        prestadorTenantId: obligation.prestadorTenantId,
      })
      if (
        evaluation.status === 'discrepancy' &&
        settlement &&
        (settlement.status === 'held' || settlement.status === 'eligible')
      ) {
        const frozen = transicionarLiquidacion(
          settlement,
          'frozen',
          'reconciliation_discrepancy',
          now
        )
        await this.guardarLiquidacion(repositories, settlement, frozen)
        await this.publicarLiquidacion(repositories, frozen, 'tus.service_settlement.frozen')
      }
      await this.auditar(repositories, obligation, {
        resourceType: 'reconciliation',
        resourceId: result.conciliacionId,
        action: `reconciliation.${evaluation.status}`,
        origin: 'system',
        actorId: input.actorId,
        correlationId: input.correlationId,
        idempotencyKey: null,
        previousStatus: settlement?.status ?? null,
        status: evaluation.status,
        metadata: { findings: evaluation.findings.map((finding) => finding.code) },
      })
      return result
    })
  }

  // Internal effects of an applied provider transition. Runs inside the event transaction, so
  // the inbox uniqueness plus deterministic ids prevent any double commission or ledger entry.
  protected async alAplicarEventoPago(
    repositories: RepositoriosFinanzasServicio,
    input: {
      previousIntent: IntencionPagoServicioDominio
      intent: IntencionPagoServicioDominio
      obligation: ObligacionServicio
      event: EventoPagoNormalizado
    }
  ): Promise<void> {
    const { intent, obligation, event } = input
    const now = this.isoNow()
    const scope = { tenantId: obligation.tenantId, obligacionId: obligation.obligacionId }
    if (intent.providerStatus === 'approved') {
      if (await repositories.comisiones.buscar(scope))
        throw new ErrorFinanzasServicio(
          409,
          'COMMISSION_ALREADY_BOOKED',
          'obligation already has a commission snapshot'
        )
      // The rule in force when the approval is booked is frozen in the snapshot; later policy
      // changes never touch it.
      const publicacion = await repositories.identidad.buscarPublicacion({
        prestadorTenantId: obligation.prestadorTenantId,
        publicacionId: obligation.publicacionId,
      })
      // WEB-09E: an intent created with a checkout carries the commission already sent to the
      // provider; that frozen rule wins over the policy in force today.
      const rule = intent.commission
        ? {
            rateBps: intent.commission.rateBps,
            ruleVersion: intent.commission.ruleVersion,
            politicaId: intent.commission.politicaId,
            pspFeeBearer: 'provider' as const,
          }
        : await this.politica.reglaComision({
            prestadorTenantId: obligation.prestadorTenantId,
            prestadorId: obligation.prestadorId,
            categoria: publicacion?.categoria ?? null,
          })
      const snapshot = calcularInstantaneaComision({
        obligation,
        intent,
        rule,
        evidenceId: `provider-event:${event.eventId}`,
        now,
        pspFeeMinor: event.pspFeeMinor ?? null,
      })
      if (intent.commission && snapshot.commissionMinor !== intent.commission.commissionMinor)
        throw new ErrorFinanzasServicio(
          409,
          'COMMISSION_MISMATCH',
          'approval commission differs from the frozen checkout commission'
        )
      await repositories.comisiones.crear(snapshot)
      for (const entry of movimientosAprobacion(snapshot, now))
        await repositories.ledger.agregar(entry)
      const settlement = crearLiquidacion(obligation, snapshot, now)
      await repositories.liquidaciones.crear(settlement)
      await this.auditar(repositories, obligation, {
        resourceType: 'settlement',
        resourceId: settlement.liquidacionId,
        action: 'settlement.held',
        origin: 'provider_event',
        actorId: ACTOR_PROVEEDOR,
        correlationId: `provider-event:${event.eventId}`,
        idempotencyKey: event.eventId,
        previousStatus: null,
        status: settlement.status,
        metadata: {
          grossMinor: snapshot.grossMinor.toString(10),
          commissionMinor: snapshot.commissionMinor.toString(10),
          netMinor: snapshot.netMinor.toString(10),
          ruleVersion: snapshot.ruleVersion,
          payoutStatus: 'not_executed',
        },
      })
      await this.publicarLiquidacion(repositories, settlement, 'tus.service_settlement.held')
      return
    }
    if (intent.providerStatus !== 'refunded' && intent.providerStatus !== 'charged_back') return
    const entryType =
      intent.providerStatus === 'refunded' ? 'refund_compensation' : 'chargeback_compensation'
    await repositories.ledger.agregar(
      movimientoCompensacion(obligation, entryType, event.eventId, now)
    )
    const settlement = await repositories.liquidaciones.buscar(scope)
    if (!settlement) return
    const target = intent.providerStatus === 'refunded' ? 'reversed' : 'frozen'
    if (settlement.status === target || settlement.status === 'reversed') return
    const moved = transicionarLiquidacion(
      settlement,
      target,
      `provider_${intent.providerStatus}`,
      now
    )
    await this.guardarLiquidacion(repositories, settlement, moved)
    await this.auditar(repositories, obligation, {
      resourceType: 'settlement',
      resourceId: settlement.liquidacionId,
      action: `settlement.${target}`,
      origin: 'provider_event',
      actorId: ACTOR_PROVEEDOR,
      correlationId: `provider-event:${event.eventId}`,
      idempotencyKey: event.eventId,
      previousStatus: settlement.status,
      status: target,
      metadata: { payoutStatus: 'not_executed' },
    })
    await this.publicarLiquidacion(repositories, moved, `tus.service_settlement.${target}`)
  }

  // Write-once: the PSP fee may arrive after the approval (for example on a later
  // `payment.updated`). It completes the snapshot net without rewriting the commission.
  protected async completarFeeProveedor(
    repositories: RepositoriosFinanzasServicio,
    obligation: ObligacionServicio,
    event: EventoPagoNormalizado
  ): Promise<void> {
    const snapshot = await repositories.comisiones.buscar({
      tenantId: obligation.tenantId,
      obligacionId: obligation.obligacionId,
    })
    if (!snapshot || snapshot.pspFeeMinor !== null || event.pspFeeMinor == null) return
    const breakdown = calcularDesgloseCobro({
      grossMinor: snapshot.grossMinor,
      rateBps: snapshot.rateBps,
      pspFeeBearer: 'provider',
      pspFeeMinor: event.pspFeeMinor,
    })
    if (
      breakdown.commissionMinor !== snapshot.commissionMinor ||
      breakdown.providerNetMinor === null
    )
      return
    await repositories.comisiones.registrarFeeProveedor({
      tenantId: snapshot.tenantId,
      obligacionId: snapshot.obligacionId,
      pspFeeMinor: event.pspFeeMinor,
      providerNetMinor: breakdown.providerNetMinor,
    })
  }

  protected async guardarLiquidacion(
    repositories: RepositoriosFinanzasServicio,
    previous: LiquidacionServicioDominio,
    next: LiquidacionServicioDominio
  ): Promise<void> {
    const persisted = await repositories.liquidaciones.actualizar({
      settlement: next,
      expectedVersion: previous.version,
    })
    if (!persisted)
      throw new ErrorFinanzasServicio(409, 'VERSION_CONFLICT', 'settlement changed concurrently')
  }

  protected async publicarLiquidacion(
    repositories: RepositoriosFinanzasServicio,
    settlement: LiquidacionServicioDominio,
    eventType: string
  ): Promise<void> {
    await repositories.outbox.publicar({
      eventId: `${eventType}:${settlement.liquidacionId}:${settlement.version}`,
      tenantId: settlement.tenantId,
      aggregateType: 'liquidacion_servicio',
      aggregateId: settlement.liquidacionId,
      eventType,
      payload: {
        settlementId: settlement.liquidacionId,
        obligationId: settlement.obligacionId,
        providerTenantId: settlement.prestadorTenantId,
        status: settlement.status,
        payoutStatus: 'not_executed',
      },
      createdAt: this.isoNow(),
    })
  }

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
    if (
      intent.commission &&
      event.marketplaceFeeMinor !== null &&
      event.marketplaceFeeMinor !== undefined &&
      event.marketplaceFeeMinor !== intent.commission.commissionMinor
    )
      return { result: 'quarantined', reason: 'marketplace_fee_mismatch' }
    if (event.status === 'unknown')
      return { result: 'ignored_unknown_status', reason: `unmapped:${event.rawStatus}` }
    // WEB-09E hosted checkout: one preference can collect several payment attempts (a rejected
    // card followed by an approved one). Until a payment is locked by approval, a failed attempt
    // is informative and never closes the intent; otherwise a later approval would be lost.
    if (
      intent.checkoutReference &&
      intent.providerReference === null &&
      (event.status === 'rejected' || event.status === 'cancelled' || event.status === 'expired')
    )
      return { result: 'no_op', reason: `hosted_checkout_attempt_${event.status}` }
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
    // Crash window (reference not stored yet) or a hosted checkout collecting a payment for our
    // external reference. When the intent is already locked to another payment, the event is
    // still correlated so that `evaluarEvento` quarantines it (possible double charge) instead
    // of silently dropping it.
    const byPayment = await repositories.intenciones.buscarPorPaymentId(event.paymentId)
    return byPayment.length === 1 ? byPayment[0]! : null
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

export function proyectarReembolso(refund: ReembolsoServicioDominio): ReembolsoServicio {
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    reembolsoId: refund.reembolsoId,
    obligacionId: refund.obligacionId,
    paymentId: refund.paymentId,
    tenantId: refund.tenantId,
    amountMinor: formatMinorUnits(refund.amountMinor),
    currency: refund.currency,
    status: refund.status,
    providerRefundId: refund.providerRefundId,
    providerError: refund.providerError,
    reason: refund.reason,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  }
}
