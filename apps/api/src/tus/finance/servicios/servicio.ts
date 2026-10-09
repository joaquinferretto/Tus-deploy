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
  TramoPagoServicio,
  Trabajo,
  VistaPreviaPagoServicio,
} from '@factory/contracts'
import {
  ESTADOS_PRESUPUESTO,
  ESTADOS_TRABAJO,
  ORIGENES_IMPORTE_OBLIGACION_SERVICIO,
  TUS_CONTRACT_VERSION,
  formatMinorUnits,
  majorDecimalToMinorUnits,
} from '@factory/contracts'
import { PoliticaCobroFija, type PuertoPoliticaCobro, type ReglaComisionAplicable } from './configuracion.ts'

// The rule of a work with the moment it was frozen (null: nothing is stored for that work).
type ReglaComisionFijada = ReglaComisionAplicable & { frozenAt: string | null }
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
  derivarObligacionSenaTurno,
  derivarObligacionServicio,
  derivarObligacionTramo,
  montoSenaReserva,
  montosSenaSaldo,
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
  type ReservaTurnoFinanciera,
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
import { debitoDeGanancia, gananciaDeAprobacion, tarifaDeGanancia, type MovimientoGanancia, type PuertoLedgerGanancias } from './ganancias.ts'

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
  // Reservation of the order of a turno (TURNOS-SENA-01), by the provider's agenda it belongs to.
  buscarReservaTurno(input: {
    prestadorTenantId: string
    reservaId: string
  }): Promise<ReservaTurnoFinanciera | null>
}

export interface PuertoObligacionesServicio {
  // `part` defaults to 'total' (marketplace works).
  buscarPorTrabajo(input: {
    tenantId: string
    trabajoId: string
    part?: TramoPagoServicio
  }): Promise<ObligacionServicio | null>
  listarPorTrabajo(input: { tenantId: string; trabajoId: string }): Promise<ObligacionServicio[]>
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
  aggregateType: 'obligacion_pago_servicio' | 'intencion_pago_servicio' | 'liquidacion_servicio' | 'reserva'
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
  resourceType: 'obligation' | 'payment' | 'provider_event' | 'settlement' | 'reconciliation' | 'work'
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

// Completes a request-born work when its balance is approved, inside the SAME transaction as the
// approval (Prisma: same transactional client). Idempotent: an already completed work is a no-op.
export interface PuertoCierreTrabajoPorPago {
  completarPorPagoFinal(input: {
    tenantId: string
    trabajoId: string
    paymentId: string
    correlationId: string
    createdAt: string
  }): Promise<'completed' | 'already_completed' | 'not_in_progress'>
  // awaiting_payment -> confirmed for the turno whose deposit was just approved, in the SAME
  // transaction. false: the turno is no longer waiting for that payment (nothing is changed).
  confirmarReservaPorPago?(input: {
    reservaId: string
    prestadorTenantId: string
    clienteTenantId: string
    amountMinor: bigint
    currency: string
  }): Promise<boolean>
  // CIERRE-TRABAJO-01. What is recorded about the closing of a work: whether the client confirmed
  // it (or it was confirmed automatically when its window ran out) and whether something blocks
  // it (an open observation or claim). null: nothing was recorded for that work.
  estadoCierre?(input: { tenantId: string; trabajoId: string }): Promise<{ confirmed: boolean; blocked: string | null } | null>
}

// Deposit/balance state of a request-born work with an accepted budget (work summary and the
// start/finish gates). `required` = the platform has online payments enabled, so the deposit and
// the balance are mandatory; `online` = it can actually be charged now. A provider without a
// linked Mercado Pago account (or unverified identity) is `required` but not `online`: the work
// is BLOCKED, never free. Only a platform-wide switch off keeps the previous behaviour.
// Only the two ways of paying a client may ask for; anything else is "not said".
const modalidadDe = (value: unknown): 'sena' | 'total' | undefined => (value === 'sena' || value === 'total' ? value : undefined)

export interface EstadoPagosTrabajoServicio {
  required: boolean
  online: boolean
  unavailableReason: string | null
  currency: string
  totalMinor: bigint
  deposit: { amountMinor: bigint; status: ObligacionServicio['status'] | 'not_created' }
  balance: { amountMinor: bigint; status: ObligacionServicio['status'] | 'not_created' }
  // PAGOS-MODALIDAD-01. How the client is paying (null until a payment is approved), what was
  // paid and what is left of the total: pendingMinor = totalMinor - paidMinor, never negative.
  modality?: 'sena' | 'total' | null
  paidMinor?: bigint
  pendingMinor?: bigint
}

// Availability reasons that belong to ONE provider (the platform itself has payments enabled).
export const MOTIVOS_PRESTADOR_SIN_COBRO: ReadonlySet<string> = new Set([
  'PROVIDER_ACCOUNT_NOT_CONNECTED',
  // PAGOS-RETENCION-01: TUS has no account of its own to hold an advance payment with. Never
  // "no deposit": the work is not confirmed for free and the payment is not sent elsewhere.
  'PLATFORM_ACCOUNT_REQUIRED',
])

// COMISION-TRABAJO-01. The commission of TUS frozen for one work. `fijar` stores it only if the
// work has none yet and always returns the one that is stored (two requests at once agree).
export interface ComisionTrabajo {
  tenantId: string
  trabajoId: string
  rateBps: number
  ruleVersion: string
  politicaId: string | null
  currency: string
  baseMinor: bigint
  commissionMinor: bigint
  fixedAt: string
}
export interface PuertoComisionTrabajo {
  buscar(input: { tenantId: string; trabajoId: string }): Promise<ComisionTrabajo | null>
  fijar(snapshot: ComisionTrabajo): Promise<ComisionTrabajo>
}

export interface RepositoriosFinanzasServicio {
  // COMISION-TRABAJO-01 (absent in narrow test compositions: the policy in force is used then).
  comisionTrabajo?: PuertoComisionTrabajo
  // Absent in compositions without request-born works (then an approved balance only books money).
  cierreTrabajo?: PuertoCierreTrabajoPorPago
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
  // TUS-GANANCIAS-01: what TUS owes providers for payments it collected (optional: absent in
  // compositions without it, then nothing is booked there).
  ganancias?: PuertoLedgerGanancias
}

export interface ResultadoEvaluacionCobro {
  reason: MotivoNoCobrableServicio | null
  presupuesto: PresupuestoFinanciero | null
  publicacion: PublicacionServicioFinanciera | null
  // Part charged now and its amount (null when nothing can be charged).
  part: TramoPagoServicio | null
  amountMinor: bigint | null
  // Currency of the amount when it does not come from a budget (deposit of a turno).
  currency?: string | null
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

// What the payment query reports about a customer's payment. `approved` means Mercado Pago
// reported it approved AND every validation of the webhook accepted it (or it was already applied).
export interface ResultadoVerificacionPagoServicio {
  status: 'approved' | 'pending' | 'not_approved' | 'not_found' | 'quarantined' | 'unavailable'
  // True when THIS query applied the approval (the webhook had not arrived yet).
  appliedNow: boolean
  trabajoId: string
  amountMinor: string | null
  currency: string | null
  reason: string | null
}

export interface ResumenFinancieroTrabajoServicio {
  trabajoId: string
  viewer: 'customer' | 'provider'
  // Request-born works: the latest part (balance, else deposit); `parts` lists both.
  obligation: ObligacionPagoServicio | null
  payments: IntencionPagoServicio[]
  parts?: { obligation: ObligacionPagoServicio; payments: IntencionPagoServicio[] }[]
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
    input: ContextoFinanzasServicio & { trabajoId: string; modalidad?: 'sena' | 'total' }
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
      const cobro = await this.evaluarCobro(repositories, trabajo, modalidadDe(input.modalidad))
      const obligation = await repositories.obligaciones.buscarPorTrabajo({
        tenantId: trabajo.tenantId,
        trabajoId: trabajo.trabajoId,
        part: cobro.part ?? 'total',
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
        part: cobro.part,
        amountMinor:
          (budget || cobro.currency) && !cobro.reason && cobro.amountMinor !== null
            ? formatMinorUnits(cobro.amountMinor)
            : null,
        currency:
          !cobro.reason && cobro.amountMinor !== null
            ? (budget?.currency ?? cobro.currency ?? null)
            : null,
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
    trabajo: Trabajo,
    // PAGOS-MODALIDAD-01: how the client wants to pay ('sena' by default). Marketplace works
    // have one payment for everything and ignore it.
    modalidad?: 'sena' | 'total'
  ): Promise<ResultadoEvaluacionCobro> {
    // Request-born works have no listing; their payment path is evaluated separately.
    const publicacion = trabajo.publicacionId
      ? await repositories.identidad.buscarPublicacion({
          prestadorTenantId: trabajo.prestadorTenantId,
          publicacionId: trabajo.publicacionId,
        })
      : null
    const presupuesto =
      trabajo.acceptedBudgetId && trabajo.acceptedBudgetVersion
        ? await repositories.identidad.buscarPresupuesto({
            tenantId: trabajo.tenantId,
            trabajoId: trabajo.trabajoId,
            presupuestoId: trabajo.acceptedBudgetId,
            version: trabajo.acceptedBudgetVersion,
          })
        : null
    if (trabajo.origin === 'solicitud')
      return this.evaluarCobroSolicitud(repositories, trabajo, presupuesto, modalidad)
    if (trabajo.origin === 'turno') return this.evaluarCobroTurno(repositories, trabajo, modalidad)
    const result = (reason: MotivoNoCobrableServicio | null): ResultadoEvaluacionCobro => ({
      reason,
      presupuesto,
      publicacion,
      part: 'total',
      amountMinor: presupuesto?.totalMinor ?? null,
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

  // PAGOS-MODALIDAD-01. What was paid for a work and what is left, from its obligations: the one
  // canonical computation every decision about its money uses.
  //   pagado     sum of the obligations that are paid (a refund or a chargeback counts for nothing)
  //   pendiente  total - pagado, never negative
  //   modalidad  how the client is paying once something was approved ('sena' or 'total')
  protected resumenPagos(total: bigint, obligaciones: readonly ObligacionServicio[]): { vivas: ObligacionServicio[]; pagado: bigint; pendiente: bigint; modalidad: 'sena' | 'total' | null; revertido: boolean } {
    const vivas = obligaciones.filter((item) => item.status !== 'voided')
    const pagadas = vivas.filter((item) => item.status === 'paid')
    const pagado = pagadas.reduce((suma, item) => suma + item.amountMinor, 0n)
    return {
      vivas,
      pagado,
      pendiente: pagado >= total ? 0n : total - pagado,
      modalidad: pagadas.some((item) => item.part === 'total') ? 'total' : pagadas.some((item) => item.part === 'sena') ? 'sena' : null,
      revertido: vivas.some((item) => item.status === 'refunded' || item.status === 'charged_back'),
    }
  }

  // Request-born works. Before anything is paid the client chooses: a 50% deposit (the default)
  // or the total at once. Once a payment is approved the choice is fixed. After a deposit the
  // balance is what is left of the accepted budget, payable when the provider finished.
  protected async evaluarCobroSolicitud(
    repositories: RepositoriosFinanzasServicio,
    trabajo: Trabajo,
    presupuesto: PresupuestoFinanciero | null,
    modalidad?: 'sena' | 'total'
  ): Promise<ResultadoEvaluacionCobro> {
    const result = (
      reason: MotivoNoCobrableServicio | null,
      part: TramoPagoServicio | null = null,
      amountMinor: bigint | null = null
    ): ResultadoEvaluacionCobro => ({ reason, presupuesto, publicacion: null, part, amountMinor })
    if (trabajo.status === ESTADOS_TRABAJO.CANCELADO) return result('WORK_CANCELLED')
    if (!trabajo.acceptedBudgetId || !trabajo.acceptedBudgetVersion)
      return result('BUDGET_REQUIRED')
    if (
      !presupuesto ||
      presupuesto.status !== ESTADOS_PRESUPUESTO.ACEPTADO ||
      presupuesto.prestadorTenantId !== trabajo.prestadorTenantId
    )
      return result('BUDGET_INCONSISTENT')
    const total = presupuesto.totalMinor
    const pagos = this.resumenPagos(total, await repositories.obligaciones.listarPorTrabajo({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId }))
    if (pagos.revertido) return result('OBLIGATION_CLOSED')
    if (pagos.modalidad === null) {
      if (trabajo.status === ESTADOS_TRABAJO.COMPLETADO) return result('OBLIGATION_CLOSED')
      return modalidad === 'total' ? result(null, 'total', total) : result(null, 'sena', montosSenaSaldo(total).sena)
    }
    if (modalidad && modalidad !== pagos.modalidad) return result('PAYMENT_MODALITY_FIXED')
    if (pagos.pendiente === 0n) return result('ALREADY_PAID')
    if (trabajo.status === ESTADOS_TRABAJO.COMPLETADO) return result('OBLIGATION_CLOSED')
    if (trabajo.status !== ESTADOS_TRABAJO.EN_PROGRESO || !trabajo.finishedAt)
      return result('WORK_NOT_FINISHED', 'saldo', pagos.pendiente)
    return result(null, 'saldo', pagos.pendiente)
  }

  // Order of a turno (TURNOS-SENA-01, PAGOS-MODALIDAD-01). The reservation is the authority for
  // the price and for the moment. While the turno waits for its payment the client pays a 50%
  // deposit (the default) or the total; either one confirms the turno. After a deposit the
  // balance is what is left of the price, payable once the turno was delivered and its closing
  // confirmed (by the client or by its window), with nothing blocking it.
  protected async evaluarCobroTurno(
    repositories: RepositoriosFinanzasServicio,
    trabajo: Trabajo,
    modalidad?: 'sena' | 'total'
  ): Promise<ResultadoEvaluacionCobro> {
    const reserva = trabajo.reservaId
      ? await repositories.identidad.buscarReservaTurno({
          prestadorTenantId: trabajo.prestadorTenantId,
          reservaId: trabajo.reservaId,
        })
      : null
    const result = (
      reason: MotivoNoCobrableServicio | null,
      amountMinor: bigint | null = null,
      part: TramoPagoServicio = 'sena'
    ): ResultadoEvaluacionCobro => ({
      reason,
      presupuesto: null,
      publicacion: null,
      part: amountMinor === null ? null : part,
      amountMinor,
      currency: reserva?.currency ?? null,
    })
    if (!reserva || reserva.esInvitado || reserva.clienteTenantId !== trabajo.tenantId)
      return result('INCONSISTENT_COMMERCIAL_CHAIN')
    const obligaciones = await repositories.obligaciones.listarPorTrabajo({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId })
    const conPrecio = reserva.priceMajor !== null && reserva.priceMajor > 0n
    const total = conPrecio ? majorDecimalToMinorUnits(reserva.priceMajor!.toString(10), reserva.currency) : 0n
    const pagos = this.resumenPagos(total, obligaciones)
    if (pagos.revertido) return result('OBLIGATION_CLOSED')
    const cancelado = ['cancelled', 'cancelled-late', 'no-show', 'rejected', 'expired'].includes(reserva.status)
    if (pagos.modalidad === null) {
      if (cancelado) return result('WORK_CANCELLED')
      if (
        reserva.status !== 'awaiting_payment' ||
        !reserva.expiresAt || Date.parse(reserva.expiresAt) <= this.now() ||
        !conPrecio ||
        Date.parse(reserva.startsAt) <= this.now()
      )
        return result('APPOINTMENT_NOT_PAYABLE')
      if (modalidad === 'total') return result(null, total, 'total')
      const sena = pagos.vivas.find((item) => item.part === 'sena')
      return result(null, sena?.amountMinor ?? montoSenaReserva(reserva.priceMajor!, reserva.currency), 'sena')
    }
    if (modalidad && modalidad !== pagos.modalidad) return result('PAYMENT_MODALITY_FIXED')
    if (pagos.pendiente === 0n) return result('ALREADY_PAID')
    if (cancelado) return result('WORK_CANCELLED')
    // The balance: only after the turno was delivered and its closing confirmed.
    const cierre = repositories.cierreTrabajo?.estadoCierre ? await repositories.cierreTrabajo.estadoCierre({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId }) : null
    if (reserva.status !== 'completed' || !cierre?.confirmed || cierre.blocked) return result('WORK_NOT_FINISHED', pagos.pendiente, 'saldo')
    return result(null, pagos.pendiente, 'saldo')
  }

  // Whether the deposit of a turno of that provider could be charged online now (platform switch,
  // linked Mercado Pago account, verified identity). Read-only.
  async disponibilidadCobroPrestador(input: {
    prestadorTenantId: string
    prestadorId: string
  }): Promise<{ available: boolean; reason: string | null; mode: 'plataforma' | 'split' | null }> {
    // The deposit of a turno is always an advance payment.
    const availability = await this.politica.disponibilidad({ ...input, categoria: null, anticipado: true })
    return { available: availability.available === true, reason: availability.reason ?? null, mode: (availability as { mode?: 'plataforma' | 'split' }).mode ?? null }
  }

  // Deposit/balance state of a request-born work already authorized by the caller. Null for
  // marketplace works and before a budget is accepted.
  async estadoPagosTrabajo(trabajo: Trabajo): Promise<EstadoPagosTrabajoServicio | null> {
    const budgetId = trabajo.acceptedBudgetId
    const budgetVersion = trabajo.acceptedBudgetVersion
    if (trabajo.origin !== 'solicitud' || !budgetId || !budgetVersion) return null
    return this.transaction.ejecutar(async (repositories) => {
      const presupuesto = await repositories.identidad.buscarPresupuesto({
        tenantId: trabajo.tenantId,
        trabajoId: trabajo.trabajoId,
        presupuestoId: budgetId,
        version: budgetVersion,
      })
      if (!presupuesto || presupuesto.status !== ESTADOS_PRESUPUESTO.ACEPTADO) return null
      const amounts = montosSenaSaldo(presupuesto.totalMinor)
      const obligations = await repositories.obligaciones.listarPorTrabajo({
        tenantId: trabajo.tenantId,
        trabajoId: trabajo.trabajoId,
      })
      // PAGOS-MODALIDAD-01: a voided obligation is neither owed nor paid.
      const pagos = this.resumenPagos(presupuesto.totalMinor, obligations)
      const completo = pagos.vivas.find((item) => item.part === 'total')
      const sena = pagos.vivas.find((item) => item.part === 'sena')
      const saldo = pagos.vivas.find((item) => item.part === 'saldo')
      const closed =
        trabajo.status === ESTADOS_TRABAJO.CANCELADO ||
        trabajo.status === ESTADOS_TRABAJO.COMPLETADO
      const availability = closed
        ? { available: false, reason: null }
        : await this.politica.disponibilidad({
            prestadorTenantId: trabajo.prestadorTenantId,
            prestadorId: trabajo.prestadorId,
            categoria: null,
            // Anything paid for a work that is not closed is an advance payment.
            anticipado: true,
          })
      return {
        required:
          availability.available ||
          (availability.reason !== null && MOTIVOS_PRESTADOR_SIN_COBRO.has(availability.reason)),
        online: availability.available,
        unavailableReason: availability.available ? null : (availability.reason ?? null),
        currency: presupuesto.currency,
        totalMinor: presupuesto.totalMinor,
        // The total paid at once covers both: what the work needed before starting, and its balance.
        deposit: completo?.status === 'paid'
          ? { amountMinor: amounts.sena, status: 'paid' }
          : { amountMinor: sena?.amountMinor ?? amounts.sena, status: sena?.status ?? 'not_created' },
        balance: completo?.status === 'paid'
          ? { amountMinor: 0n, status: 'paid' }
          : { amountMinor: saldo?.amountMinor ?? (pagos.modalidad === 'sena' ? pagos.pendiente : amounts.saldo), status: saldo?.status ?? 'not_created' },
        modality: pagos.modalidad,
        paidMinor: pagos.pagado,
        pendingMinor: pagos.pendiente,
      }
    })
  }

  // Throws when the work cannot be charged now; used before any financial write.
  protected async exigirCobroDisponible(
    repositories: RepositoriosFinanzasServicio,
    context: ContextoFinanzasServicio,
    trabajoId: string,
    modalidad?: 'sena' | 'total'
  ): Promise<{
    publicacion: PublicacionServicioFinanciera | null
    trabajo: Trabajo
    part: TramoPagoServicio
    // What that part charges, as the canonical evaluation decided it.
    amountMinor: bigint | null
    mode: 'split' | 'plataforma'
  }> {
    const trabajo = await this.requerirTrabajo(repositories, context, trabajoId)
    if (trabajo.tenantId !== context.tenantId)
      throw new ErrorFinanzasServicio(
        403,
        'FORBIDDEN',
        'only the customer tenant can prepare the payment obligation'
      )
    const cobro = await this.evaluarCobro(repositories, trabajo, modalidad)
    if (cobro.reason || !cobro.part)
      throw new ErrorFinanzasServicio(
        409,
        cobro.reason ?? 'OBLIGATION_CLOSED',
        `work is not payable: ${cobro.reason ?? 'nothing due'}`
      )
    const availability = await this.politica.disponibilidad({
      prestadorTenantId: trabajo.prestadorTenantId,
      prestadorId: trabajo.prestadorId,
      categoria: cobro.publicacion?.categoria ?? null,
      // Paid before the work is completed: an advance payment (the order of a turno is never
      // "completed" by itself, so its payments always are).
      anticipado: trabajo.status !== ESTADOS_TRABAJO.COMPLETADO,
    })
    if (!availability.available)
      throw new ErrorFinanzasServicio(
        503,
        availability.reason ?? 'PAYMENTS_DISABLED',
        'online payment is not available yet'
      )
    return { publicacion: cobro.publicacion, trabajo, part: cobro.part, amountMinor: cobro.amountMinor, mode: availability.mode ?? 'split' }
  }

  // Customer command: fixes the payable amount of a work from persisted commercial facts.
  async prepararObligacion(
    input: ContextoFinanzasServicio & { trabajoId: string; idempotencyKey: string; modalidad?: 'sena' | 'total' }
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
      const cobro = await this.exigirCobroDisponible(repositories, input, input.trabajoId, modalidadDe(input.modalidad))
      const obligation = await this.asegurarObligacion(repositories, input, input.trabajoId, key, cobro.part, cobro.amountMinor)
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
    input: ContextoFinanzasServicio & { trabajoId: string; idempotencyKey: string; modalidad?: 'sena' | 'total' }
  ): Promise<ResultadoIntencionPago> {
    validarContextoFinanzasServicio(input)
    const key = validarClaveIdempotencia(input.idempotencyKey)
    const modalidad = modalidadDe(input.modalidad)
    const requestHash = huellaSolicitudFinanciera('service-payment.create', {
      trabajoId: input.trabajoId,
      actorId: input.actorId,
      // Only when it was asked for: the same key with another way of paying is another request.
      ...(modalidad ? { modalidad } : {}),
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
      const { publicacion, part, mode, amountMinor } = await this.exigirCobroDisponible(
        repositories,
        input,
        input.trabajoId,
        modalidad
      )
      const obligation = await this.asegurarObligacion(
        repositories,
        input,
        input.trabajoId,
        key,
        part,
        amountMinor
      )
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
        // COMISION-TRABAJO-01: with the rate frozen for the WORK, never the policy in force today
        // (the balance of a work is charged with the same rate as its deposit).
        const rule = await this.comisionDelTrabajo(repositories, obligation, publicacion?.categoria ?? null)
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
          // Decided now, with the provider's account as it is: frozen on the intent.
          collectionMode: mode,
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
            part: obligation.part,
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
      const publicacion = obligation.publicacionId
        ? await repositories.identidad.buscarPublicacion({
            prestadorTenantId: obligation.prestadorTenantId,
            publicacionId: obligation.publicacionId,
          })
        : null
      const deTurno = obligation.amountSource === ORIGENES_IMPORTE_OBLIGACION_SERVICIO.PRECIO_RESERVA
      const title = deTurno
        ? 'Seña (50%) del turno TUS'
        : obligation.part === 'sena'
          ? 'Seña (50%) del trabajo TUS'
          : obligation.part === 'saldo'
            ? 'Saldo (50%) del trabajo TUS'
            : (publicacion?.nombre ?? null)
      return { status: 'claimed' as const, intent: claimed, title, part: obligation.part, deTurno }
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
        collectionMode: intent.collectionMode ?? 'split',
        title: claim.title ?? 'Servicio TUS',
        trabajoId: intent.trabajoId,
        // Request-born works return to their page and a turno to "Mis turnos"; the return never
        // confirms a payment.
        ...(claim.deTurno
          ? { returnPath: '/mis-turnos?pago=retorno' }
          : claim.part === 'total'
            ? {}
            : { returnPath: `/trabajos/${encodeURIComponent(intent.trabajoId)}?pago=retorno` }),
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
    input: ContextoFinanzasServicio & { trabajoId: string; idempotencyKey: string; modalidad?: 'sena' | 'total' }
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
        collectionMode: intent.collectionMode ?? 'split',
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
          collectionMode: prepared.collectionMode,
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
    return this.aplicarEventoVerificado(event, {
      signature: input.signature,
      rawBody: input.rawBody,
      receivedAt: input.receivedAt,
    })
  }

  // The state machine of a VERIFIED payment event (what Mercado Pago itself reported for a
  // payment): intent resolution, durable inbox, the validations of `evaluarEvento`, the
  // transitions and everything an approval, refund or chargeback triggers (turno confirmation,
  // earning). It is the ONE place money changes state: the webhook calls it after verifying the
  // signature and the payment lookup; the payment query (`verificarPagoDelTrabajo`) calls it with
  // the payment read from Mercado Pago. The same event applied twice is a no-op.
  protected async aplicarEventoVerificado(
    event: EventoPagoNormalizado,
    origen: { signature: string; rawBody: string; receivedAt: string }
  ): Promise<ResultadoIngestaEvento> {
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
      const evaluado = this.evaluarEvento(intent, event)
      // PAGOS-MODALIDAD-01: never above the total of the work, whatever Mercado Pago collected.
      // A payment approved for an obligation that was voided is real money collected for something
      // nobody owes: always quarantined for review, whatever the state of its checkout.
      const outcome =
        event.status === 'approved' && obligation.status === 'voided'
          ? { result: 'quarantined' as const, reason: 'obligation_voided' }
          : evaluado.result === 'applied' && event.status === 'approved'
            ? ((await this.sobrecobro(repositories, obligation)) ?? evaluado)
            : evaluado
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
        signature: origen.signature,
        rawBody: origen.rawBody,
        occurredAt: event.occurredAt,
        receivedAt: origen.receivedAt,
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

  // TUS-WHATSAPP-MULTIMODAL-01: "did my payment arrive?". The CUSTOMER of a work asks for the real
  // state of ITS payment. Nothing said or sent by the customer decides it: the payment is read from
  // Mercado Pago by TUS's own payment id (the external reference of the intent, never a value the
  // customer typed) with the account that must have collected it, and whatever Mercado Pago reports
  // goes through the SAME state machine as the webhook (`aplicarEventoVerificado`: collector,
  // mode, reference, currency and amount are validated there). If the webhook already applied it,
  // or arrives later, that is a no-op: one approval, one confirmation, one earning.
  async verificarPagoDelTrabajo(
    input: ContextoFinanzasServicio & { trabajoId: string }
  ): Promise<ResultadoVerificacionPagoServicio> {
    validarContextoFinanzasServicio(input)
    const objetivo = await this.transaction.ejecutar(async (repositories) => {
      const trabajo = await this.requerirTrabajo(repositories, input, input.trabajoId)
      // Only the customer asks about its own payment; the provider's tenant does not.
      if (trabajo.tenantId !== input.tenantId) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'work was not found')
      const obligaciones = await repositories.obligaciones.listarPorTrabajo({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId })
      let abierta: { obligation: ObligacionServicio; intent: IntencionPagoServicioDominio } | null = null
      for (const obligation of obligaciones) {
        if (obligation.status === 'paid') continue
        const intents = await repositories.intenciones.listarPorObligacion({ tenantId: obligation.tenantId, obligacionId: obligation.obligacionId })
        const intent = intents.filter((item) => item.checkoutReference || item.providerReference).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        if (intent && (!abierta || intent.createdAt > abierta.intent.createdAt)) abierta = { obligation, intent }
      }
      return { trabajo, abierta, pagadas: obligaciones.filter((obligation) => obligation.status === 'paid') }
    })
    if (!objetivo.abierta) {
      const pagada = objetivo.pagadas[0]
      return pagada
        ? { status: 'approved', appliedNow: false, trabajoId: input.trabajoId, amountMinor: pagada.amountMinor.toString(10), currency: pagada.currency, reason: null }
        : { status: 'not_found', appliedNow: false, trabajoId: input.trabajoId, amountMinor: null, currency: null, reason: 'no_payment_started' }
    }
    const { obligation, intent } = objetivo.abierta
    const base = { trabajoId: input.trabajoId, amountMinor: intent.amountMinor.toString(10), currency: intent.currency }
    if (!this.proveedor.consultarPagos) return { ...base, status: 'unavailable', appliedNow: false, reason: 'provider_cannot_be_queried' }
    let events: EventoPagoNormalizado[]
    try {
      events = await this.proveedor.consultarPagos({ paymentId: intent.paymentId, collectionMode: intent.collectionMode ?? 'split', prestadorTenantId: intent.prestadorTenantId })
    } catch (error) {
      if (error instanceof ErrorFinanzasServicio && error.code === 'PROVIDER_UNAVAILABLE') return { ...base, status: 'unavailable', appliedNow: false, reason: 'provider_unavailable' }
      // A payment of another seller or an incomplete one is not a payment of this intent.
      return { ...base, status: 'not_found', appliedNow: false, reason: error instanceof ErrorFinanzasServicio ? error.code : 'invalid_provider_payment' }
    }
    // Only payments created for THIS intent (its own external reference), oldest first.
    const propios = events.filter((event) => event.paymentId === intent.paymentId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    if (propios.length === 0) return { ...base, status: 'not_found', appliedNow: false, reason: 'provider_has_no_payment' }
    const resultados: ResultadoIngestaEvento[] = []
    for (const event of propios)
      resultados.push(await this.aplicarEventoVerificado(event, { signature: 'payment-query', rawBody: JSON.stringify({ origin: 'payment_query', providerReference: event.providerReference, status: event.rawStatus }), receivedAt: this.isoNow() }))
    const appliedNow = resultados.some((resultado, index) => resultado.status === 'recorded' && resultado.result === 'applied' && propios[index]!.status === 'approved')
    const cuarentena = resultados.find((resultado) => resultado.status === 'recorded' && resultado.result === 'quarantined')
    const final = await this.transaction.ejecutar(async (repositories) => {
      const actual = await repositories.obligaciones.buscar({ tenantId: obligation.tenantId, obligacionId: obligation.obligacionId })
      const intents = await repositories.intenciones.listarPorObligacion({ tenantId: obligation.tenantId, obligacionId: obligation.obligacionId })
      const vigente = intents.find((item) => item.paymentId === intent.paymentId) ?? intent
      if (actual)
        await this.auditar(repositories, actual, {
          resourceType: 'payment',
          resourceId: intent.paymentId,
          action: 'payment.queried_by_customer',
          origin: 'customer',
          actorId: input.actorId,
          correlationId: input.correlationId,
          idempotencyKey: null,
          previousStatus: intent.providerStatus,
          status: vigente.providerStatus,
          metadata: { appliedNow, events: propios.length },
        })
      return { obligation: actual, intent: vigente }
    })
    if (final.obligation?.status === 'paid') return { ...base, status: 'approved', appliedNow, reason: null }
    if (cuarentena && cuarentena.status === 'recorded') return { ...base, status: 'quarantined', appliedNow: false, reason: cuarentena.reason }
    if (propios.every((event) => event.status === 'rejected' || event.status === 'cancelled' || event.status === 'expired' || event.status === 'refunded' || event.status === 'charged_back'))
      return { ...base, status: 'not_approved', appliedNow: false, reason: propios[propios.length - 1]!.status }
    return { ...base, status: 'pending', appliedNow: false, reason: null }
  }

  async consultarFinanzasTrabajo(
    input: ContextoFinanzasServicio & { trabajoId: string }
  ): Promise<ResumenFinancieroTrabajoServicio> {
    validarContextoFinanzasServicio(input)
    return this.transaction.ejecutar(async (repositories) => {
      const trabajo = await this.requerirTrabajo(repositories, input, input.trabajoId)
      const viewer = trabajo.tenantId === input.tenantId ? 'customer' : 'provider'
      const listPayments = async (item: ObligacionServicio) =>
        (
          await repositories.intenciones.listarPorObligacion({
            tenantId: item.tenantId,
            obligacionId: item.obligacionId,
          })
        )
          .sort((left, right) => left.attempt - right.attempt)
          .map(proyectarIntencionPago)
      const parts =
        trabajo.origin === 'solicitud' || trabajo.origin === 'turno'
          ? (
              await repositories.obligaciones.listarPorTrabajo({
                tenantId: trabajo.tenantId,
                trabajoId: trabajo.trabajoId,
              })
            ).sort((left, right) => (left.part === 'sena' ? -1 : right.part === 'sena' ? 1 : 0))
          : null
      const obligation = parts
        ? (parts.at(-1) ?? null)
        : await repositories.obligaciones.buscarPorTrabajo({
            tenantId: trabajo.tenantId,
            trabajoId: trabajo.trabajoId,
          })
      const partViews = parts
        ? await Promise.all(
            parts.map(async (item) => ({
              obligation: proyectarObligacion(item),
              payments: await listPayments(item),
            }))
          )
        : null
      const summary: ResumenFinancieroTrabajoServicio = {
        trabajoId: trabajo.trabajoId,
        viewer,
        obligation: obligation ? proyectarObligacion(obligation) : null,
        payments: partViews
          ? partViews.flatMap((item) => item.payments)
          : obligation
            ? await listPayments(obligation)
            : [],
        ...(partViews ? { parts: partViews } : {}),
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
      return this.evaluarLiquidacionEn(repositories, obligation, input.correlationId)
    })
  }

  // PAGOS-RETENCION-01. The release milestone of a work, for every payment of it at once: the
  // settlements that are held become eligible (their net becomes withdrawable) only when the
  // work is closed and nothing of it is still to be paid. Idempotent: a settlement already
  // released, frozen or reversed is left as it is, so repeating the closing event, the client's
  // confirmation or the automatic confirmation never releases anything twice.
  async liberarLiquidacionesDelTrabajo(input: {
    tenantId: string
    trabajoId: string
    correlationId: string
  }): Promise<ResultadoEvaluacionLiquidacion[]> {
    return this.transaction.ejecutar((repositories) => this.liberarLiquidacionesEn(repositories, input))
  }

  // CIERRE-TRABAJO-01. The economic side of a confirmation: releases what can be released and
  // says what is still missing (`pending`: 'not_fully_paid', 'balance_pending', ...). Confirming
  // a work never releases by itself; this evaluation, with what was really paid, does.
  async evaluarCierreEconomico(input: { tenantId: string; trabajoId: string; correlationId: string }): Promise<{ released: number; pending: string | null }> {
    const resultados = await this.liberarLiquidacionesDelTrabajo(input)
    return {
      released: resultados.filter((item) => item.status === 'eligible').length,
      pending: resultados.find((item) => item.status === 'unchanged' && item.reason !== 'settlement_eligible')?.reason ?? null,
    }
  }

  // PAGOS-MODALIDAD-01. Total, paid and pending of a work (null total: it has no price yet).
  async estadoEconomico(input: { tenantId: string; trabajoId: string }): Promise<{ totalMinor: bigint | null; paidMinor: bigint; pendingMinor: bigint | null; fullyPaid: boolean; modality: 'sena' | 'total' | null }> {
    return this.transaction.ejecutar(async (repositories) => {
      const trabajo = await repositories.identidad.buscarTrabajoAccesible(input)
      const obligaciones = await repositories.obligaciones.listarPorTrabajo(input)
      const reserva = trabajo?.origin === 'turno' && trabajo.reservaId ? await repositories.identidad.buscarReservaTurno({ prestadorTenantId: trabajo.prestadorTenantId, reservaId: trabajo.reservaId }) : null
      const total = trabajo ? await this.totalFinalDelTrabajo(repositories, trabajo, reserva, obligaciones) : null
      const pagos = this.resumenPagos(total ?? 0n, obligaciones)
      return { totalMinor: total, paidMinor: pagos.pagado, pendingMinor: total === null ? null : pagos.pendiente, fullyPaid: total !== null && total > 0n && pagos.pagado >= total && !pagos.revertido, modality: pagos.modalidad }
    })
  }

  // What of the payments of a work forbids confirming it AUTOMATICALLY: a refund in progress, a
  // payment that was reversed, a settlement frozen by a discrepancy. Read-only.
  async bloqueosDeCierre(input: { tenantId: string; trabajoId: string }): Promise<string[]> {
    return this.transaction.ejecutar(async (repositories) => {
      const bloqueos = new Set<string>()
      for (const obligation of await repositories.obligaciones.listarPorTrabajo(input)) {
        if (obligation.status === 'refunded' || obligation.status === 'charged_back') bloqueos.add('payment_reversed')
        const settlement = await repositories.liquidaciones.buscar({ tenantId: obligation.tenantId, obligacionId: obligation.obligacionId })
        if (settlement?.status === 'frozen') bloqueos.add('payment_inconsistency')
        for (const intent of await repositories.intenciones.listarPorObligacion({ tenantId: obligation.tenantId, obligacionId: obligation.obligacionId })) {
          const reembolsos = await repositories.reembolsos.listarPorPago({ tenantId: intent.tenantId, paymentId: intent.paymentId })
          if (reembolsos.some((refund) => refund.status !== 'failed')) bloqueos.add('refund_in_progress')
        }
      }
      return [...bloqueos]
    })
  }

  protected async liberarLiquidacionesEn(
    repositories: RepositoriosFinanzasServicio,
    input: { tenantId: string; trabajoId: string; correlationId: string }
  ): Promise<ResultadoEvaluacionLiquidacion[]> {
    const obligaciones = await repositories.obligaciones.listarPorTrabajo({ tenantId: input.tenantId, trabajoId: input.trabajoId })
    const resultados: ResultadoEvaluacionLiquidacion[] = []
    // A voided obligation (replaced by the other way of paying) was never paid: it has nothing
    // to release and it is not something pending either.
    for (const obligation of obligaciones.filter((item) => item.status !== 'voided'))
      resultados.push(await this.evaluarLiquidacionEn(repositories, obligation, input.correlationId))
    return resultados
  }

  // The final total of a work, from its persisted commercial facts: the price booked on the
  // reservation of a turno, the accepted budget of a request-born work, or (marketplace works,
  // one payment for everything) the amount of its only obligation.
  /**
   * COMISION-TRABAJO-01. The commission rule of a work: the one frozen for it, for every part
   * (deposit, balance or total) and for ever. It is frozen the first time it is asked for, which
   * is when the first obligation of the work is created (the work was contracted; nothing was
   * charged yet). A work that already had payment intents keeps THEIR rate. Only a work with
   * nothing frozen anywhere reads the policy in force, once.
   */
  protected async comisionDelTrabajo(
    repositories: RepositoriosFinanzasServicio,
    obligation: Pick<ObligacionServicio, 'tenantId' | 'trabajoId' | 'prestadorTenantId' | 'prestadorId' | 'currency' | 'amountMinor'>,
    categoria: string | null
  ): Promise<ReglaComisionFijada> {
    const politica = () => this.politica.reglaComision({ prestadorTenantId: obligation.prestadorTenantId, prestadorId: obligation.prestadorId, categoria })
    if (!repositories.comisionTrabajo) return { ...(await politica()), frozenAt: null }
    const scope = { tenantId: obligation.tenantId, trabajoId: obligation.trabajoId }
    const fijada = await repositories.comisionTrabajo.buscar(scope)
    if (fijada) return { politicaId: fijada.politicaId, rateBps: fijada.rateBps, ruleVersion: fijada.ruleVersion, pspFeeBearer: 'provider', frozenAt: fijada.fixedAt }
    const hermanas = await repositories.obligaciones.listarPorTrabajo(scope)
    // A work that was being paid before its commission was frozen here: the rate of its payments.
    let previa: { rateBps: number; ruleVersion: string; politicaId: string | null } | null = null
    for (const hermana of hermanas) {
      for (const intent of await repositories.intenciones.listarPorObligacion({ tenantId: hermana.tenantId, obligacionId: hermana.obligacionId }))
        if (intent.commission && (!previa || intent.createdAt < (previa as { createdAt?: string }).createdAt!)) previa = Object.assign({ rateBps: intent.commission.rateBps, ruleVersion: intent.commission.ruleVersion, politicaId: intent.commission.politicaId ?? null }, { createdAt: intent.createdAt })
    }
    const regla = previa ?? (await politica())
    const trabajo = await repositories.identidad.buscarTrabajoAccesible(scope)
    const reserva = trabajo?.origin === 'turno' && trabajo.reservaId ? await repositories.identidad.buscarReservaTurno({ prestadorTenantId: trabajo.prestadorTenantId, reservaId: trabajo.reservaId }) : null
    const baseMinor = (trabajo ? await this.totalFinalDelTrabajo(repositories, trabajo, reserva, hermanas) : null) ?? obligation.amountMinor
    const guardada = await repositories.comisionTrabajo.fijar({
      ...scope,
      rateBps: regla.rateBps,
      ruleVersion: regla.ruleVersion,
      politicaId: regla.politicaId ?? null,
      currency: obligation.currency,
      baseMinor,
      commissionMinor: calcularDesgloseCobro({ grossMinor: baseMinor, rateBps: regla.rateBps, pspFeeBearer: 'provider', pspFeeMinor: null }).commissionMinor,
      fixedAt: this.isoNow(),
    })
    return { politicaId: guardada.politicaId, rateBps: guardada.rateBps, ruleVersion: guardada.ruleVersion, pspFeeBearer: 'provider', frozenAt: guardada.fixedAt }
  }

  /** COMISION-TRABAJO-01: the commission frozen for a work, if any (for the administration). */
  async comisionFijada(input: { tenantId: string; trabajoId: string }): Promise<ComisionTrabajo | null> {
    return this.transaction.ejecutar(async (repositories) => (repositories.comisionTrabajo ? repositories.comisionTrabajo.buscar(input) : null))
  }

  protected async totalFinalDelTrabajo(
    repositories: RepositoriosFinanzasServicio,
    trabajo: Trabajo,
    reserva: ReservaTurnoFinanciera | null,
    obligaciones: readonly ObligacionServicio[]
  ): Promise<bigint | null> {
    if (trabajo.origin === 'turno')
      return reserva && reserva.priceMajor !== null && reserva.priceMajor > 0n ? majorDecimalToMinorUnits(reserva.priceMajor.toString(10), reserva.currency) : null
    if (trabajo.origin === 'solicitud') {
      if (!trabajo.acceptedBudgetId || !trabajo.acceptedBudgetVersion) return null
      const presupuesto = await repositories.identidad.buscarPresupuesto({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId, presupuestoId: trabajo.acceptedBudgetId, version: trabajo.acceptedBudgetVersion })
      return presupuesto ? presupuesto.totalMinor : null
    }
    return obligaciones.find((item) => item.part === 'total')?.amountMinor ?? null
  }

  protected async evaluarLiquidacionEn(
    repositories: RepositoriosFinanzasServicio,
    obligation: ObligacionServicio,
    correlationId: string
  ): Promise<ResultadoEvaluacionLiquidacion> {
    const input = { correlationId }
    {
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
      // The order of a turno never changes state: its turno is done when its reservation is.
      const reserva =
        trabajo?.origin === 'turno' && trabajo.reservaId
          ? await repositories.identidad.buscarReservaTurno({ prestadorTenantId: trabajo.prestadorTenantId, reservaId: trabajo.reservaId })
          : null
      const cierre = trabajo && repositories.cierreTrabajo?.estadoCierre
        ? await repositories.cierreTrabajo.estadoCierre({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId })
        : null
      const sinLiberar = (reason: string): ResultadoEvaluacionLiquidacion => ({ status: 'unchanged', reason, settlement: proyectarLiquidacion(settlement) })
      // 1. The work is done AND closed. The order of a turno never changes state: it is closed
      //    when its client confirmed it (or its window ran out) and its reservation is completed.
      const terminado = trabajo?.origin === 'turno' ? reserva?.status === 'completed' : trabajo?.status === ESTADOS_TRABAJO.COMPLETADO
      if (!terminado) return sinLiberar('work_not_completed')
      // The closing must exist and be confirmed (by the client or by its window): a reservation
      // marked completed some other way never releases what TUS holds.
      if (trabajo?.origin === 'turno' && repositories.cierreTrabajo?.estadoCierre && !cierre?.confirmed) return sinLiberar('client_confirmation_pending')
      // 2. Nothing blocks it: an open observation or claim of the client.
      if (cierre?.blocked) return sinLiberar(cierre.blocked)
      // 3. The economic condition. What was paid for the work is at least its final total: the
      //    price of the turno or the accepted budget. A missing balance obligation is NOT "paid":
      //    the sum of the approved payments decides, and a refund or a chargeback counts for nothing.
      const hermanas = await repositories.obligaciones.listarPorTrabajo({ tenantId: obligation.tenantId, trabajoId: obligation.trabajoId })
      if (hermanas.some((item) => item.status === 'pending_payment')) return sinLiberar('balance_pending')
      const totalFinal = await this.totalFinalDelTrabajo(repositories, trabajo!, reserva, hermanas)
      if (totalFinal === null) return sinLiberar('total_unknown')
      const pagado = hermanas.filter((item) => item.status === 'paid').reduce((suma, item) => suma + item.amountMinor, 0n)
      if (pagado < totalFinal) return sinLiberar('not_fully_paid')
      // 4. No payment of the work is frozen (a discrepancy) or reversed.
      for (const hermana of hermanas) {
        if (hermana.obligacionId === obligation.obligacionId || hermana.status !== 'paid') continue
        const otra = await repositories.liquidaciones.buscar({ tenantId: hermana.tenantId, obligacionId: hermana.obligacionId })
        if (otra && (otra.status === 'frozen' || otra.status === 'reversed')) return sinLiberar(`sibling_settlement_${otra.status}`)
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
    }
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
      const publicacion = obligation.publicacionId
        ? await repositories.identidad.buscarPublicacion({
            prestadorTenantId: obligation.prestadorTenantId,
            publicacionId: obligation.publicacionId,
          })
        : null
      // WEB-09E: an intent created with a checkout carries the commission already sent to the
      // provider; that frozen rule wins over the policy in force today.
      const rule = intent.commission
        ? {
            rateBps: intent.commission.rateBps,
            ruleVersion: intent.commission.ruleVersion,
            politicaId: intent.commission.politicaId,
            pspFeeBearer: 'provider' as const,
          }
        : await this.comisionDelTrabajo(repositories, obligation, publicacion?.categoria ?? null)
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
      // PAGOS-RETENCION-01. TUS collected it: the net is held until the work reaches its release
      // milestone. A payment Mercado Pago paid straight to the provider cannot be held by TUS.
      const settlement = crearLiquidacion(obligation, snapshot, now, intent.collectionMode === 'plataforma')
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
      // TUS collected this payment with its own account: the provider's share (gross minus the
      // frozen commission) is an earning TUS owes. Split payments were already paid by Mercado Pago.
      if (intent.collectionMode === 'plataforma' && repositories.ganancias) {
        const ganancia = gananciaDeAprobacion({ obligation, netMinor: snapshot.netMinor, paymentId: intent.paymentId, eventId: event.eventId, now })
        if (!(await repositories.ganancias.buscar(ganancia))) await repositories.ganancias.registrar(ganancia)
        // The Mercado Pago fee is the provider's, as in Split 1:1: when the approval already
        // reports it, it is debited now; otherwise when the payment reports it.
        await this.debitarTarifaGanancia(repositories, ganancia, snapshot.pspFeeMinor, event.eventId, now)
      }
      // The paid deposit of a turno confirms its reservation in this same transaction: it is the
      // only automatic path from awaiting_payment to confirmed. The money was really collected, so
      // the approval is ALWAYS booked: when the turno is no longer waiting for it (its payment
      // window ran out, or it was cancelled meanwhile) the reservation stays released, nothing is
      // confirmed, and the case is left on record for the platform to refund. Marketplace works
      // keep their own rule (W09-02): paid once completed, their reservation is not touched here.
      if ((obligation.part === 'sena' || obligation.part === 'total') && obligation.amountSource === ORIGENES_IMPORTE_OBLIGACION_SERVICIO.PRECIO_RESERVA) {
        const work = await repositories.identidad.buscarTrabajoAccesible({ tenantId: obligation.tenantId, trabajoId: obligation.trabajoId })
        const reservaId = work?.origin === 'turno' && work.tenantId === obligation.tenantId && work.prestadorTenantId === obligation.prestadorTenantId ? (work.reservaId ?? null) : null
        const confirmed =
          reservaId && work && repositories.cierreTrabajo?.confirmarReservaPorPago
            ? await repositories.cierreTrabajo.confirmarReservaPorPago({
                reservaId,
                prestadorTenantId: work.prestadorTenantId,
                clienteTenantId: work.tenantId,
                amountMinor: obligation.amountMinor,
                currency: obligation.currency,
              })
            : false
        const eventType = confirmed ? 'tus.turno.confirmed' : 'tus.turno.deposit_without_turno'
        await this.auditar(repositories, obligation, {
          resourceType: 'work',
          resourceId: obligation.trabajoId,
          action: confirmed ? 'appointment.confirmed_by_deposit' : 'appointment.deposit_without_turno',
          origin: 'provider_event',
          actorId: ACTOR_PROVEEDOR,
          correlationId: `provider-event:${event.eventId}`,
          idempotencyKey: event.eventId,
          previousStatus: confirmed ? 'awaiting_payment' : null,
          status: confirmed ? 'confirmed' : 'requires_refund_review',
          metadata: { paymentId: intent.paymentId },
        })
        await repositories.outbox.publicar({
          eventId: `${eventType}:${reservaId ?? obligation.trabajoId}`,
          tenantId: obligation.tenantId,
          aggregateType: 'reserva',
          aggregateId: reservaId ?? obligation.trabajoId,
          eventType,
          payload: { reservaId, paymentId: intent.paymentId, prestadorTenantId: obligation.prestadorTenantId, clienteTenantId: obligation.tenantId },
          createdAt: now,
        })
      }
      // The approved balance is what completes a request-born work (same transaction).
      if (obligation.part === 'saldo' && repositories.cierreTrabajo) {
        const closed = await repositories.cierreTrabajo.completarPorPagoFinal({
          tenantId: obligation.tenantId,
          trabajoId: obligation.trabajoId,
          paymentId: intent.paymentId,
          correlationId: `provider-event:${event.eventId}`,
          createdAt: now,
        })
        await this.auditar(repositories, obligation, {
          resourceType: 'work',
          resourceId: obligation.trabajoId,
          action: `work.final_payment_${closed}`,
          origin: 'provider_event',
          actorId: ACTOR_PROVEEDOR,
          correlationId: `provider-event:${event.eventId}`,
          idempotencyKey: event.eventId,
          previousStatus: null,
          status: closed,
          metadata: { paymentId: intent.paymentId },
        })
      }
      // PAGOS-RETENCION-01. This approval may be what closes the work (its balance) or arrive
      // when the work is already closed: release what is held only if the milestone is reached.
      // Only where TUS holds the money; the rest keeps its explicit evaluation step.
      if (intent.collectionMode === 'plataforma')
        await this.liberarLiquidacionesEn(repositories, { tenantId: obligation.tenantId, trabajoId: obligation.trabajoId, correlationId: `provider-event:${event.eventId}` })
      return
    }
    if (intent.providerStatus !== 'refunded' && intent.providerStatus !== 'charged_back') return
    // The earning is never edited: its reversal is a new debit movement.
    if (repositories.ganancias) {
      const ganancia = await repositories.ganancias.buscar({ prestadorTenantId: obligation.prestadorTenantId, movimientoId: `earning:${obligation.obligacionId}` })
      if (ganancia) {
        // One reversal per earning: a refund and a later chargeback of the same payment (or the
        // other way round) never debit the provider twice; any further dispute is an explicit
        // administrative adjustment.
        const reembolso = debitoDeGanancia(ganancia, 'refund_debit', event.eventId, now)
        const contracargo = debitoDeGanancia(ganancia, 'chargeback_debit', event.eventId, now)
        const debito = intent.providerStatus === 'refunded' ? reembolso : contracargo
        if (!(await repositories.ganancias.buscar(reembolso)) && !(await repositories.ganancias.buscar(contracargo))) await repositories.ganancias.registrar(debito)
      }
    }
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
    // A payment TUS collected: the fee reported now is debited from the provider's earning.
    if (repositories.ganancias) {
      const ganancia = await repositories.ganancias.buscar({ prestadorTenantId: obligation.prestadorTenantId, movimientoId: `earning:${obligation.obligacionId}` })
      if (ganancia) await this.debitarTarifaGanancia(repositories, ganancia, event.pspFeeMinor, event.eventId, this.isoNow())
    }
  }

  // TUS-GANANCIAS-01: the reported Mercado Pago fee of a collection made by TUS, once.
  protected async debitarTarifaGanancia(
    repositories: RepositoriosFinanzasServicio,
    ganancia: MovimientoGanancia,
    pspFeeMinor: bigint | null,
    eventId: string,
    now: string
  ): Promise<void> {
    if (!repositories.ganancias || pspFeeMinor === null) return
    const tarifa = tarifaDeGanancia(ganancia, pspFeeMinor, eventId, now)
    if (tarifa && !(await repositories.ganancias.buscar(tarifa))) await repositories.ganancias.registrar(tarifa)
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
    // TUS-GANANCIAS-01: the account that collected must be the one the intent was created for.
    // A payment in a provider's own account carrying the reference of an intent TUS collects
    // (or the other way round, or in another provider's account) would make TUS owe money it
    // never received, or confirm a turno with money that went elsewhere.
    if (event.collectedBy) {
      const mode = intent.collectionMode ?? 'split'
      if (event.collectedBy.mode !== mode) return { result: 'quarantined', reason: 'collection_mode_mismatch' }
      if (mode === 'split' && event.collectedBy.prestadorTenantId !== intent.prestadorTenantId)
        return { result: 'quarantined', reason: 'collector_mismatch' }
    }
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
    // TUS-GANANCIAS-01: a payment TUS collected with its own account carries no marketplace fee;
    // one that does is not the preference TUS created.
    if (intent.collectionMode === 'plataforma' && event.marketplaceFeeMinor !== null && event.marketplaceFeeMinor !== undefined && event.marketplaceFeeMinor !== 0n)
      return { result: 'quarantined', reason: 'marketplace_fee_unexpected' }
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
    idempotencyKey: string,
    part: TramoPagoServicio = 'total',
    amountMinor: bigint | null = null
  ): Promise<ObligacionServicio> {
    const trabajo = await this.requerirTrabajo(repositories, context, trabajoId)
    if (trabajo.tenantId !== context.tenantId)
      throw new ErrorFinanzasServicio(
        403,
        'FORBIDDEN',
        'only the customer tenant can prepare the payment obligation'
      )
    // A request-born work and the order of a turno have no marketplace commitment: their parts
    // (deposit, balance or the total at once) are derived from their budget or booked price.
    if (part !== 'total' || trabajo.origin === 'solicitud' || trabajo.origin === 'turno')
      return this.asegurarObligacionTramo(repositories, context, trabajo, idempotencyKey, part, amountMinor)
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
    if (!trabajo.commitmentId || !trabajo.publicacionId)
      throw new ErrorFinanzasServicio(
        409,
        'INCONSISTENT_COMMERCIAL_CHAIN',
        'work has no marketplace commitment'
      )
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
    // COMISION-TRABAJO-01: the work is contracted: its commission is frozen now, before any charge.
    await this.comisionDelTrabajo(repositories, obligation, null)
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

  protected async asegurarObligacionTramo(
    repositories: RepositoriosFinanzasServicio,
    context: ContextoFinanzasServicio,
    trabajo: Trabajo,
    idempotencyKey: string,
    part: TramoPagoServicio,
    amountMinor: bigint | null = null
  ): Promise<ObligacionServicio> {
    // PAGOS-MODALIDAD-01. Deposit and total are two ways of paying the same thing: choosing one
    // voids the other while nothing of it was paid, so the client can never pay both.
    if (part !== 'saldo') {
      const otra = await repositories.obligaciones.buscarPorTrabajo({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId, part: part === 'sena' ? 'total' : 'sena' })
      if (otra?.status === 'pending_payment') await this.anularObligacion(repositories, context, otra, idempotencyKey)
    }
    const guardada = await repositories.obligaciones.buscarPorTrabajo({
      tenantId: trabajo.tenantId,
      trabajoId: trabajo.trabajoId,
      part,
    })
    // Chosen again after having been replaced: the same obligation comes back.
    const existing = guardada?.status === 'voided' ? await this.reactivarObligacion(repositories, context, guardada, idempotencyKey) : guardada
    if (existing) {
      if (
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
    if (trabajo.origin === 'turno') {
      const reserva = trabajo.reservaId
        ? await repositories.identidad.buscarReservaTurno({
            prestadorTenantId: trabajo.prestadorTenantId,
            reservaId: trabajo.reservaId,
          })
        : null
      const obligation = derivarObligacionSenaTurno({ context, trabajo, reserva, now: this.isoNow(), part, ...(amountMinor !== null ? { amountMinor } : {}) })
      await repositories.obligaciones.crear(obligation)
      // COMISION-TRABAJO-01: the turno was accepted: its commission is frozen now, before any charge.
      await this.comisionDelTrabajo(repositories, obligation, null)
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
          part,
          amountSource: obligation.amountSource,
          amountMinor: obligation.amountMinor.toString(10),
          bookedPriceMajor: reserva?.priceMajor?.toString(10) ?? null,
          currency: obligation.currency,
        },
      })
      return obligation
    }
    const presupuesto =
      trabajo.acceptedBudgetId && trabajo.acceptedBudgetVersion
        ? await repositories.identidad.buscarPresupuesto({
            tenantId: trabajo.tenantId,
            trabajoId: trabajo.trabajoId,
            presupuestoId: trabajo.acceptedBudgetId,
            version: trabajo.acceptedBudgetVersion,
          })
        : null
    const obligation = derivarObligacionTramo({
      context,
      trabajo,
      presupuesto,
      part,
      ...(amountMinor !== null ? { amountMinor } : {}),
      now: this.isoNow(),
    })
    await repositories.obligaciones.crear(obligation)
    // COMISION-TRABAJO-01: the work is contracted: its commission is frozen now, before any charge.
    await this.comisionDelTrabajo(repositories, obligation, null)
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
        part,
        amountSource: obligation.amountSource,
        amountMinor: obligation.amountMinor.toString(10),
        budgetTotalMinor: presupuesto?.totalMinor.toString(10) ?? null,
        currency: obligation.currency,
      },
    })
    return obligation
  }

  // PAGOS-MODALIDAD-01. An unpaid obligation replaced by the other way of paying: it stops being
  // owed and its pending checkouts are cancelled. A payment that still arrives for it is never
  // applied (see `sobrecobro`).
  protected async anularObligacion(repositories: RepositoriosFinanzasServicio, context: ContextoFinanzasServicio, obligation: ObligacionServicio, idempotencyKey: string): Promise<void> {
    const now = this.isoNow()
    const intents = await repositories.intenciones.listarPorObligacion({ tenantId: obligation.tenantId, obligacionId: obligation.obligacionId })
    // An approved payment fixes the way of paying: nothing is voided then.
    if (intents.some((intent) => intent.providerStatus === 'approved')) throw new ErrorFinanzasServicio(409, 'PAYMENT_MODALITY_FIXED', 'a payment was already approved for this work')
    const anulada = await repositories.obligaciones.actualizar({ obligacion: transicionarObligacion(obligation, 'voided', now), expectedVersion: obligation.version })
    if (!anulada) throw new ErrorFinanzasServicio(409, 'VERSION_CONFLICT', 'obligation changed concurrently')
    for (const intent of intents)
      if (intent.providerStatus === 'pending') await repositories.intenciones.actualizar({ ...intent, providerStatus: 'cancelled', updatedAt: now })
    await this.auditar(repositories, obligation, { resourceType: 'obligation', resourceId: obligation.obligacionId, action: 'obligation.voided', origin: 'customer', actorId: context.actorId, correlationId: context.correlationId, idempotencyKey, previousStatus: obligation.status, status: 'voided', metadata: { part: obligation.part, reason: 'payment_modality_changed' } })
  }

  protected async reactivarObligacion(repositories: RepositoriosFinanzasServicio, context: ContextoFinanzasServicio, obligation: ObligacionServicio, idempotencyKey: string): Promise<ObligacionServicio> {
    const activa = await repositories.obligaciones.actualizar({ obligacion: transicionarObligacion(obligation, 'pending_payment', this.isoNow()), expectedVersion: obligation.version })
    if (!activa) throw new ErrorFinanzasServicio(409, 'VERSION_CONFLICT', 'obligation changed concurrently')
    await this.auditar(repositories, obligation, { resourceType: 'obligation', resourceId: obligation.obligacionId, action: 'obligation.reactivated', origin: 'customer', actorId: context.actorId, correlationId: context.correlationId, idempotencyKey, previousStatus: 'voided', status: 'pending_payment', metadata: { part: obligation.part } })
    return activa
  }

  // An approval that must NOT be applied because it would charge more than the work costs: a
  // payment for an obligation that was voided, or one that, added to what is already paid, goes
  // above the final total. It is kept in quarantine for the platform to review and refund.
  protected async sobrecobro(repositories: RepositoriosFinanzasServicio, obligation: ObligacionServicio): Promise<{ result: 'quarantined'; reason: string } | null> {
    if (obligation.status === 'voided') return { result: 'quarantined', reason: 'obligation_voided' }
    const trabajo = await repositories.identidad.buscarTrabajoAccesible({ tenantId: obligation.tenantId, trabajoId: obligation.trabajoId })
    if (!trabajo || (trabajo.origin !== 'turno' && trabajo.origin !== 'solicitud')) return null
    const reserva = trabajo.origin === 'turno' && trabajo.reservaId ? await repositories.identidad.buscarReservaTurno({ prestadorTenantId: trabajo.prestadorTenantId, reservaId: trabajo.reservaId }) : null
    const hermanas = await repositories.obligaciones.listarPorTrabajo({ tenantId: obligation.tenantId, trabajoId: obligation.trabajoId })
    const total = await this.totalFinalDelTrabajo(repositories, trabajo, reserva, hermanas)
    if (total === null) return null
    const yaPagado = hermanas.filter((item) => item.status === 'paid' && item.obligacionId !== obligation.obligacionId).reduce((suma, item) => suma + item.amountMinor, 0n)
    return yaPagado + obligation.amountMinor > total ? { result: 'quarantined', reason: 'exceeds_work_total' } : null
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
