import { randomUUID } from 'node:crypto'
import {
  CODIGO_BAJO_MINIMO,
  CODIGO_CUENTA_REQUERIDA,
  CODIGO_LIQUIDACION_ABIERTA,
  CODIGO_SIN_FONDOS,
  type AjusteGananciaDTO,
  type ConciliacionGananciaDTO,
  type DetalleLiquidacionAdminDTO,
  type EstadoMovimientoGanancia,
  type EstadoSolicitudLiquidacion,
  type LiquidacionAdminDTO,
  type MecanismoLiquidacion,
  type MotivoSinLiquidacion,
  type MovimientoHistorialGanancia,
  type ResumenGananciasPrestador,
  type SaldoNegativoPrestadorDTO,
  type SolicitudLiquidacionDTO,
} from '@factory/contracts'
import { ErrorFinanzasServicio, type ObligacionServicio } from './modelo.ts'

// TUS-GANANCIAS-01. What TUS owes a provider and the provider's payout requests.
//
// When the provider has no Mercado Pago account linked, TUS collects the payment with its own
// account (`modo_cobro = 'plataforma'`) and the provider's share (gross minus the TUS commission
// frozen on the payment) is an EARNING: an append-only ledger movement. The Mercado Pago fee of
// that collection is the provider's (as in Split 1:1) and is debited when Mercado Pago reports
// it; refunds and chargebacks are new debit movements; manual resolutions are explicit
// adjustments. A payout request books a RESERVE movement; failing or cancelling books a RELEASE;
// being paid books a COMPLETION. Nothing is ever edited and no balance is stored: it is derived.
//
// Three separate things:
//   1. the obligation of TUS towards the provider (the ledger, written by the finance service in
//      the same transaction that books the verified approval, refund or chargeback);
//   2. the payout request (this service): it reserves the exact earnings it pays;
//   3. the execution (PuertoEjecucionLiquidacion): Mercado Pago Payouts (POST /v1/payouts), an
//      account-to-account transfer from TUS's Mercado Pago account to the provider's, confirmed
//      only by querying the transaction to Mercado Pago. When the administration paid by another
//      means it records that operation with its reference instead ('manual'); the two are never
//      mixed on one request.

export type TipoMovimientoGanancia =
  | 'earning_credit'
  | 'psp_fee_debit'
  | 'refund_debit'
  | 'chargeback_debit'
  | 'adjustment_credit'
  | 'adjustment_debit'
  | 'payout_reserve'
  | 'payout_release'
  | 'payout_completed'

const TIPOS_LIQUIDACION: readonly TipoMovimientoGanancia[] = ['payout_reserve', 'payout_release', 'payout_completed']
export const esMovimientoDeLiquidacion = (tipo: TipoMovimientoGanancia): boolean => TIPOS_LIQUIDACION.includes(tipo)

export interface MovimientoGanancia {
  movimientoId: string
  prestadorTenantId: string
  prestadorId: string
  tipo: TipoMovimientoGanancia
  amountMinor: bigint
  currency: 'ARS'
  obligacionTenantId: string | null
  obligacionId: string | null
  trabajoId: string | null
  solicitudId: string | null
  relacionadoId: string | null
  reason: string
  actorId: string
  correlationId: string
  createdAt: string
}

// What the history shows of an earning's payment (read with the movements; never stored on them).
export type MovimientoConContexto = MovimientoGanancia & { concepto?: string | null; servicio?: string | null; turno?: string | null }

export interface SolicitudLiquidacion {
  solicitudId: string
  prestadorTenantId: string
  prestadorId: string
  amountMinor: bigint
  currency: 'ARS'
  status: EstadoSolicitudLiquidacion
  cuentaCobroId: string
  destinationEmail: string
  destinationAccountId: string | null
  mechanism: MecanismoLiquidacion | null
  providerPayoutId: string | null
  providerTransactionId: string | null
  providerStatus: string | null
  externalReference: string | null
  failureReason: string | null
  note: string | null
  requestedBy: string
  processedBy: string | null
  resolvedBy: string | null
  idempotencyKey: string
  correlationId: string
  version: number
  createdAt: string
  updatedAt: string
  processingAt: string | null
  paidAt: string | null
  failedAt: string | null
  cancelledAt: string | null
}

export interface ItemLiquidacion {
  solicitudId: string
  movimientoId: string
  activo: boolean
}

// Effect of a movement on what TUS owes the provider (payout movements are accounted apart).
export const signoMovimiento = (tipo: TipoMovimientoGanancia): bigint => (tipo === 'earning_credit' || tipo === 'adjustment_credit' ? 1n : -1n)

// ---- the ledger inside the finance transaction ------------------------------------------------

// Written by the finance service in the SAME transaction that books a verified approval, refund
// or chargeback. A second attempt of the same effect collides on the deterministic movement id.
export interface PuertoLedgerGanancias {
  buscar(input: { prestadorTenantId: string; movimientoId: string }): Promise<MovimientoGanancia | null>
  registrar(movimiento: MovimientoGanancia): Promise<void>
}

export class LedgerGananciasEnMemoria implements PuertoLedgerGanancias {
  readonly movimientos: MovimientoGanancia[] = []

  async buscar(input: { prestadorTenantId: string; movimientoId: string }): Promise<MovimientoGanancia | null> {
    return this.movimientos.find((item) => item.prestadorTenantId === input.prestadorTenantId && item.movimientoId === input.movimientoId) ?? null
  }

  async registrar(movimiento: MovimientoGanancia): Promise<void> {
    if (await this.buscar(movimiento)) throw new ErrorFinanzasServicio(409, 'DUPLICATE_MOVEMENT', 'earning movement already booked')
    this.movimientos.push({ ...movimiento })
  }
}

// The provider's share of an approved payment TUS collected: gross minus the TUS commission.
export function gananciaDeAprobacion(input: { obligation: ObligacionServicio; netMinor: bigint; paymentId: string; eventId: string; now: string }): MovimientoGanancia {
  const { obligation } = input
  if (obligation.currency !== 'ARS') throw new ErrorFinanzasServicio(409, 'CURRENCY_NOT_SUPPORTED', 'earnings are ARS only')
  if (input.netMinor <= 0n) throw new ErrorFinanzasServicio(409, 'INVALID_AMOUNT', 'an earning must be positive')
  return {
    movimientoId: `earning:${obligation.obligacionId}`,
    prestadorTenantId: obligation.prestadorTenantId,
    prestadorId: obligation.prestadorId,
    tipo: 'earning_credit',
    amountMinor: input.netMinor,
    currency: 'ARS',
    obligacionTenantId: obligation.tenantId,
    obligacionId: obligation.obligacionId,
    trabajoId: obligation.trabajoId,
    solicitudId: null,
    relacionadoId: null,
    reason: `payment:${input.paymentId}`,
    actorId: 'system:payment-provider',
    correlationId: `provider-event:${input.eventId}`,
    createdAt: input.now,
  }
}

// The Mercado Pago fee of a collection made by TUS, borne by the provider like in Split 1:1. Only
// the fee Mercado Pago reported (never an estimate): at the approval when it is known, later when
// the payment reports it.
export function tarifaDeGanancia(ganancia: MovimientoGanancia, pspFeeMinor: bigint, eventId: string, now: string): MovimientoGanancia | null {
  if (pspFeeMinor <= 0n) return null
  return {
    ...ganancia,
    movimientoId: `mp-fee:${ganancia.obligacionId}`,
    tipo: 'psp_fee_debit',
    amountMinor: pspFeeMinor,
    relacionadoId: ganancia.movimientoId,
    reason: `provider-event:${eventId}`,
    correlationId: `provider-event:${eventId}`,
    createdAt: now,
  }
}

// The reversal of an earning (the earning itself is never touched).
export function debitoDeGanancia(ganancia: MovimientoGanancia, tipo: 'refund_debit' | 'chargeback_debit', eventId: string, now: string): MovimientoGanancia {
  return {
    ...ganancia,
    movimientoId: `${tipo === 'refund_debit' ? 'refund' : 'chargeback'}:${ganancia.obligacionId}`,
    tipo,
    relacionadoId: ganancia.movimientoId,
    reason: `provider-event:${eventId}`,
    correlationId: `provider-event:${eventId}`,
    createdAt: now,
  }
}

// The reserve, release or completion of a payout request.
function movimientoDeLiquidacion(solicitud: SolicitudLiquidacion, tipo: 'payout_reserve' | 'payout_release' | 'payout_completed', reason: string, actorId: string, now: string): MovimientoGanancia {
  return {
    movimientoId: `${tipo.replace('_', '-')}:${solicitud.solicitudId}`,
    prestadorTenantId: solicitud.prestadorTenantId,
    prestadorId: solicitud.prestadorId,
    tipo,
    amountMinor: solicitud.amountMinor,
    currency: 'ARS',
    obligacionTenantId: null,
    obligacionId: null,
    trabajoId: null,
    solicitudId: solicitud.solicitudId,
    relacionadoId: tipo === 'payout_reserve' ? null : `payout-reserve:${solicitud.solicitudId}`,
    reason,
    actorId,
    correlationId: `payout:${solicitud.solicitudId}`,
    createdAt: now,
  }
}

// ---- balance ------------------------------------------------------------------------------------

export interface SaldoGanancias {
  // What TUS owes minus what open or paid requests took (reserve - release).
  available: bigint
  reserved: bigint
  processing: bigint
  paid: bigint
  fees: bigint
  adjustments: bigint
}

// Derived, never stored. owed = earnings and credit adjustments - fees, refunds, chargebacks and
// debit adjustments. A request's reserve takes its amount from what is available; a release
// gives it back; a completion turns it into "paid". available = owed - reserves + releases.
export function calcularSaldo(movimientos: readonly MovimientoGanancia[], solicitudes: readonly SolicitudLiquidacion[]): SaldoGanancias {
  const saldo: SaldoGanancias = { available: 0n, reserved: 0n, processing: 0n, paid: 0n, fees: 0n, adjustments: 0n }
  const abierto = new Map<string, bigint>()
  for (const movimiento of movimientos) {
    const monto = movimiento.amountMinor
    switch (movimiento.tipo) {
      case 'payout_reserve':
        saldo.available -= monto
        abierto.set(movimiento.solicitudId!, (abierto.get(movimiento.solicitudId!) ?? 0n) + monto)
        break
      case 'payout_release':
        saldo.available += monto
        abierto.set(movimiento.solicitudId!, (abierto.get(movimiento.solicitudId!) ?? 0n) - monto)
        break
      case 'payout_completed':
        saldo.paid += monto
        abierto.set(movimiento.solicitudId!, (abierto.get(movimiento.solicitudId!) ?? 0n) - monto)
        break
      case 'psp_fee_debit':
        saldo.fees += monto
        saldo.available -= monto
        break
      case 'earning_credit':
        saldo.available += monto
        break
      default:
        saldo.adjustments -= signoMovimiento(movimiento.tipo) * monto
        saldo.available += signoMovimiento(movimiento.tipo) * monto
    }
  }
  const estadoDe = new Map(solicitudes.map((solicitud) => [solicitud.solicitudId, solicitud.status]))
  for (const [solicitudId, monto] of abierto) {
    if (estadoDe.get(solicitudId) === 'pending') saldo.reserved += monto
    else if (estadoDe.get(solicitudId) === 'processing') saldo.processing += monto
  }
  return saldo
}

// ---- payout requests ----------------------------------------------------------------------------

// What a payout request reserves, decided with the state read inside the transaction.
export interface EstadoReservable {
  movimientos: MovimientoGanancia[]
  itemsActivos: ItemLiquidacion[]
  solicitudes: SolicitudLiquidacion[]
  abierta: SolicitudLiquidacion | null
  porClave: SolicitudLiquidacion | null
}

export interface DecisionSolicitud {
  solicitud: SolicitudLiquidacion
  movimientoIds: string[]
  reserva: MovimientoGanancia
}

export interface FiltroLiquidaciones {
  estados: readonly EstadoSolicitudLiquidacion[]
  prestadorTenantId: string | null
  limite: number
  desplazamiento: number
}

export interface PuertoSolicitudesLiquidacion {
  // Everything of ONE provider (tenant + provider id), nothing of anybody else.
  movimientos(prestadorTenantId: string): Promise<MovimientoConContexto[]>
  items(prestadorTenantId: string): Promise<ItemLiquidacion[]>
  solicitudes(prestadorTenantId: string): Promise<SolicitudLiquidacion[]>
  buscar(prestadorTenantId: string, solicitudId: string): Promise<SolicitudLiquidacion | null>
  // The provider id of the provider tenant (null: it is not a provider).
  prestadorDe(prestadorTenantId: string): Promise<string | null>
  // The linked Mercado Pago account usable for a payout (status connected), or null.
  cuentaParaLiquidar(prestadorTenantId: string): Promise<{ cuentaCobroId: string; externalAccountId: string | null } | null>
  // The linked account as it is now (administration detail).
  cuentaActual(prestadorTenantId: string): Promise<{ status: string; externalAccountId: string | null; liveMode: boolean | null } | null>
  // One serializable transaction: reads the state, lets `armar` decide, writes the request, its
  // items and its reserve movement. A concurrent request for the same movements or a second open
  // request fails with PAYOUT_ALREADY_OPEN (unique indexes); the same key returns the stored one.
  crearAtomica(prestadorTenantId: string, idempotencyKey: string, armar: (estado: EstadoReservable) => DecisionSolicitud | SolicitudLiquidacion): Promise<{ solicitud: SolicitudLiquidacion; nueva: boolean }>
  // Moves or updates a request (optimistic on its version and state). Releasing frees its items.
  // The movements (release or completion) are booked in the same transaction.
  transicionar(input: { actual: SolicitudLiquidacion; siguiente: SolicitudLiquidacion; liberar: boolean; movimientos: MovimientoGanancia[]; at: string }): Promise<boolean>
  // Platform administration: requests of every provider.
  listar(filtro: FiltroLiquidaciones): Promise<{ items: SolicitudLiquidacion[]; total: number }>
  buscarPorId(solicitudId: string): Promise<SolicitudLiquidacion | null>
  buscarPorPayoutProveedor(providerPayoutId: string): Promise<SolicitudLiquidacion | null>
  nombrePrestador(prestadorTenantId: string): Promise<string | null>
  // An explicit adjustment movement; false when that movement id is already booked.
  registrarMovimiento(movimiento: MovimientoGanancia): Promise<boolean>
  // Providers with any debit movement (the only ones whose balance can be negative).
  prestadoresConDebitos(): Promise<string[]>
  // Gross, commission and Mercado Pago fee of each earning's payment (commission snapshot).
  desgloses(prestadorTenantId: string): Promise<Map<string, { grossMinor: bigint; commissionMinor: bigint; pspFeeMinor: bigint | null }>>
}

// In-memory twin of the PostgreSQL store, same semantics: the read-decide-write of a request runs
// without yielding (atomic in one event loop turn), one open request per provider, one active
// item per movement, the idempotency key returns the stored request, one reserve, release and
// completion per request. The movements are the ones of the given ledger.
export class AlmacenSolicitudesLiquidacionEnMemoria implements PuertoSolicitudesLiquidacion {
  readonly solicitudesGuardadas: SolicitudLiquidacion[] = []
  readonly itemsGuardados: (ItemLiquidacion & { prestadorTenantId: string })[] = []
  // provider tenant -> provider id; provider tenant -> connected account.
  readonly prestadores = new Map<string, string>()
  readonly cuentas = new Map<string, string>()
  readonly desglosesGuardados = new Map<string, { grossMinor: bigint; commissionMinor: bigint; pspFeeMinor: bigint | null }>()

  constructor(readonly ledger: LedgerGananciasEnMemoria = new LedgerGananciasEnMemoria()) {}

  private copia<T>(value: T): T {
    return structuredClone(value)
  }

  private existe(movimiento: MovimientoGanancia): boolean {
    return this.ledger.movimientos.some((item) => item.prestadorTenantId === movimiento.prestadorTenantId && item.movimientoId === movimiento.movimientoId)
  }

  async movimientos(prestadorTenantId: string) {
    return this.ledger.movimientos.filter((item) => item.prestadorTenantId === prestadorTenantId).map((item) => this.copia(item))
  }

  async items(prestadorTenantId: string): Promise<ItemLiquidacion[]> {
    return this.itemsGuardados.filter((item) => item.prestadorTenantId === prestadorTenantId).map(({ solicitudId, movimientoId, activo }) => ({ solicitudId, movimientoId, activo }))
  }

  async solicitudes(prestadorTenantId: string): Promise<SolicitudLiquidacion[]> {
    return this.solicitudesGuardadas.filter((item) => item.prestadorTenantId === prestadorTenantId).map((item) => this.copia(item))
  }

  async buscar(prestadorTenantId: string, solicitudId: string): Promise<SolicitudLiquidacion | null> {
    const found = this.solicitudesGuardadas.find((item) => item.prestadorTenantId === prestadorTenantId && item.solicitudId === solicitudId)
    return found ? this.copia(found) : null
  }

  async buscarPorId(solicitudId: string): Promise<SolicitudLiquidacion | null> {
    const found = this.solicitudesGuardadas.find((item) => item.solicitudId === solicitudId)
    return found ? this.copia(found) : null
  }

  async buscarPorPayoutProveedor(providerPayoutId: string): Promise<SolicitudLiquidacion | null> {
    const found = this.solicitudesGuardadas.find((item) => item.providerPayoutId === providerPayoutId)
    return found ? this.copia(found) : null
  }

  async listar(filtro: FiltroLiquidaciones) {
    const todas = this.solicitudesGuardadas.filter((item) => filtro.estados.includes(item.status) && (!filtro.prestadorTenantId || item.prestadorTenantId === filtro.prestadorTenantId))
    return { items: todas.slice(filtro.desplazamiento, filtro.desplazamiento + filtro.limite).map((item) => this.copia(item)), total: todas.length }
  }

  async nombrePrestador(): Promise<string | null> {
    return null
  }

  async prestadorDe(prestadorTenantId: string): Promise<string | null> {
    return this.prestadores.get(prestadorTenantId) ?? null
  }

  async cuentaParaLiquidar(prestadorTenantId: string) {
    const cuentaCobroId = this.cuentas.get(prestadorTenantId)
    return cuentaCobroId ? { cuentaCobroId, externalAccountId: `mp-${prestadorTenantId}` } : null
  }

  async cuentaActual(prestadorTenantId: string) {
    return this.cuentas.has(prestadorTenantId) ? { status: 'connected', externalAccountId: `mp-${prestadorTenantId}`, liveMode: false } : null
  }

  async registrarMovimiento(movimiento: MovimientoGanancia): Promise<boolean> {
    if (this.existe(movimiento)) return false
    this.ledger.movimientos.push(this.copia(movimiento))
    return true
  }

  async prestadoresConDebitos(): Promise<string[]> {
    return [...new Set(this.ledger.movimientos.filter((item) => !esMovimientoDeLiquidacion(item.tipo) && signoMovimiento(item.tipo) < 0n).map((item) => item.prestadorTenantId))]
  }

  async desgloses(prestadorTenantId: string) {
    return new Map([...this.desglosesGuardados].filter(([obligacionId]) => this.ledger.movimientos.some((item) => item.prestadorTenantId === prestadorTenantId && item.obligacionId === obligacionId)))
  }

  async crearAtomica(prestadorTenantId: string, idempotencyKey: string, armar: (estado: EstadoReservable) => DecisionSolicitud | SolicitudLiquidacion) {
    const propias = this.solicitudesGuardadas.filter((item) => item.prestadorTenantId === prestadorTenantId)
    const decision = armar({
      movimientos: this.ledger.movimientos.filter((item) => item.prestadorTenantId === prestadorTenantId).map((item) => this.copia(item)),
      itemsActivos: this.itemsGuardados.filter((item) => item.prestadorTenantId === prestadorTenantId && item.activo).map(({ solicitudId, movimientoId, activo }) => ({ solicitudId, movimientoId, activo })),
      solicitudes: propias.map((item) => this.copia(item)),
      abierta: this.copia(propias.find((item) => item.status === 'pending' || item.status === 'processing') ?? null),
      porClave: this.copia(propias.find((item) => item.idempotencyKey === idempotencyKey) ?? null),
    })
    if (!('movimientoIds' in decision)) return { solicitud: decision, nueva: false }
    this.solicitudesGuardadas.push(this.copia(decision.solicitud))
    for (const movimientoId of decision.movimientoIds) this.itemsGuardados.push({ prestadorTenantId, solicitudId: decision.solicitud.solicitudId, movimientoId, activo: true })
    this.ledger.movimientos.push(this.copia(decision.reserva))
    return { solicitud: this.copia(decision.solicitud), nueva: true }
  }

  async transicionar(input: { actual: SolicitudLiquidacion; siguiente: SolicitudLiquidacion; liberar: boolean; movimientos: MovimientoGanancia[]; at: string }): Promise<boolean> {
    const index = this.solicitudesGuardadas.findIndex((item) => item.prestadorTenantId === input.actual.prestadorTenantId && item.solicitudId === input.actual.solicitudId)
    const current = this.solicitudesGuardadas[index]
    if (!current || current.version !== input.actual.version || current.status !== input.actual.status) return false
    if (input.movimientos.some((movimiento) => this.existe(movimiento))) return false
    if (input.siguiente.providerPayoutId && this.solicitudesGuardadas.some((item, i) => i !== index && item.providerPayoutId === input.siguiente.providerPayoutId)) return false
    this.solicitudesGuardadas[index] = this.copia(input.siguiente)
    if (input.liberar) for (const item of this.itemsGuardados) if (item.solicitudId === input.actual.solicitudId) item.activo = false
    for (const movimiento of input.movimientos) this.ledger.movimientos.push(this.copia(movimiento))
    return true
  }
}

// ---- execution ------------------------------------------------------------------------------------

// The state of a transfer as Mercado Pago reports it, mapped to what it means for the request.
export interface EstadoTransferencia {
  status: string
  statusDetail: string | null
  resultado: 'paid' | 'processing' | 'failed'
}

// How TUS sends a payout. The real implementation is Mercado Pago Payouts (see
// payouts-mercado-pago.ts); `disponible` is false when it is not configured, and then nothing
// can be sent (TUS never pretends to have sent money).
export interface PuertoEjecucionLiquidacion {
  readonly disponible: boolean
  // Creates the transfer. The idempotency key is the request id: retrying after an ambiguous
  // failure never creates a second transfer.
  enviar(input: { solicitudId: string; amountMinor: bigint; destinationEmail: string; description: string }): Promise<{ payoutId: string; transactionId: string; status: string }>
  // The transfer as Mercado Pago reports it now (the only source of truth for its result).
  consultar(input: { payoutId: string; transactionId: string }): Promise<EstadoTransferencia>
}

// No payout execution configured (no platform account, payouts disabled, or production without
// its request-signing key): every attempt to send fails closed.
export class EjecucionLiquidacionNoConfigurada implements PuertoEjecucionLiquidacion {
  readonly disponible = false

  async enviar(): Promise<never> {
    throw new ErrorFinanzasServicio(503, 'PAYOUTS_NOT_CONFIGURED', 'Mercado Pago Payouts is not configured')
  }

  async consultar(): Promise<never> {
    throw new ErrorFinanzasServicio(503, 'PAYOUTS_NOT_CONFIGURED', 'Mercado Pago Payouts is not configured')
  }
}

// ---- service ----------------------------------------------------------------------------------

const TIPO_HISTORIAL: Readonly<Record<TipoMovimientoGanancia, MovimientoHistorialGanancia['kind']>> = {
  earning_credit: 'earning',
  psp_fee_debit: 'mercado_pago_fee',
  refund_debit: 'refund',
  chargeback_debit: 'chargeback',
  adjustment_credit: 'adjustment',
  adjustment_debit: 'adjustment',
  payout_reserve: 'payout_reserve',
  payout_release: 'payout_release',
  payout_completed: 'payout_completed',
}

const CONCEPTO_HISTORIAL: Readonly<Record<TipoMovimientoGanancia, string>> = {
  earning_credit: 'Pago de un servicio',
  psp_fee_debit: 'Tarifa de Mercado Pago',
  refund_debit: 'Devolución al cliente',
  chargeback_debit: 'Contracargo',
  adjustment_credit: 'Ajuste a favor',
  adjustment_debit: 'Ajuste en contra',
  payout_reserve: 'Solicitud de pago',
  payout_release: 'Solicitud sin pagar: fondos liberados',
  payout_completed: 'Pago enviado a tu Mercado Pago',
}

const TRANSICIONES: Readonly<Record<EstadoSolicitudLiquidacion, readonly EstadoSolicitudLiquidacion[]>> = {
  pending: ['processing', 'failed', 'cancelled'],
  processing: ['paid', 'failed', 'cancelled'],
  paid: [],
  failed: [],
  cancelled: [],
}

export interface ContextoGanancias {
  tenantId: string
  actorId: string
  correlationId: string
}

const texto = (value: unknown, campo: string, maximo = 200): string => {
  const limpio = typeof value === 'string' ? value.trim() : ''
  if (limpio.length < 3 || limpio.length > maximo || /[\u0000-\u001f\u007f]/u.test(limpio)) throw new ErrorFinanzasServicio(400, 'INVALID', `${campo} must be one line of 3 to ${maximo} characters`)
  return limpio
}

const textoOpcional = (value: unknown, campo: string, maximo = 300): string | null => (value === undefined || value === null || value === '' ? null : texto(value, campo, maximo))

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u
function emailDestino(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (email.length < 6 || email.length > 254 || !EMAIL.test(email)) throw new ErrorFinanzasServicio(400, 'INVALID_DESTINATION_EMAIL', 'destinationEmail must be the email of your Mercado Pago account')
  return email
}

const clave = (value: unknown): string => {
  const key = typeof value === 'string' ? value.trim() : ''
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(key)) throw new ErrorFinanzasServicio(400, 'IDEMPOTENCY_KEY_REQUIRED', 'a valid Idempotency-Key header is required')
  return key
}

export function proyectarSolicitud(solicitud: SolicitudLiquidacion): SolicitudLiquidacionDTO {
  return {
    payoutId: solicitud.solicitudId,
    amountMinor: solicitud.amountMinor.toString(10),
    currency: 'ARS',
    status: solicitud.status,
    destinationEmail: solicitud.destinationEmail,
    mechanism: solicitud.mechanism,
    providerStatus: solicitud.providerStatus,
    externalReference: solicitud.externalReference,
    failureReason: solicitud.failureReason,
    createdAt: solicitud.createdAt,
    updatedAt: solicitud.updatedAt,
    processingAt: solicitud.processingAt,
    paidAt: solicitud.paidAt,
  }
}

function proyectarAdmin(solicitud: SolicitudLiquidacion, providerName: string | null): LiquidacionAdminDTO {
  return {
    ...proyectarSolicitud(solicitud),
    providerTenantId: solicitud.prestadorTenantId,
    providerId: solicitud.prestadorId,
    providerName,
    requestedBy: solicitud.requestedBy,
    processedBy: solicitud.processedBy,
    resolvedBy: solicitud.resolvedBy,
    note: solicitud.note,
    providerPayoutId: solicitud.providerPayoutId,
    providerTransactionId: solicitud.providerTransactionId,
  }
}

export interface OpcionesGanancias {
  // The minimum payout, from the administrative payment configuration (never fixed here).
  minimoLiquidacion: () => Promise<bigint>
  // Strict check of the linked account when requesting (OAuth still valid, renewed if needed;
  // a live account in production). Absent: the stored status 'connected' decides.
  cuentaHabilitada?: (prestadorTenantId: string) => Promise<boolean>
}

export class ServicioGananciasPrestador {
  constructor(
    private readonly store: PuertoSolicitudesLiquidacion,
    private readonly ejecucion: PuertoEjecucionLiquidacion,
    private readonly identidadVerificada: (prestadorTenantId: string) => Promise<boolean>,
    private readonly now: () => number = () => Date.now(),
    private readonly opciones: OpcionesGanancias
  ) {}

  private iso(): string {
    return new Date(this.now()).toISOString()
  }

  private async estado(prestadorTenantId: string) {
    const [movimientos, items, solicitudes] = await Promise.all([this.store.movimientos(prestadorTenantId), this.store.items(prestadorTenantId), this.store.solicitudes(prestadorTenantId)])
    return { movimientos, items, solicitudes, saldo: calcularSaldo(movimientos, solicitudes), abierta: solicitudes.find((item) => item.status === 'pending' || item.status === 'processing') ?? null }
  }

  // Why the provider cannot request a payout now (null: it can).
  private async motivo(prestadorTenantId: string, disponible: bigint, abierta: SolicitudLiquidacion | null, minimo: bigint): Promise<MotivoSinLiquidacion | null> {
    if (abierta) return 'PAYOUT_IN_PROGRESS'
    if (!(await this.store.cuentaParaLiquidar(prestadorTenantId))) return 'PAYMENT_ACCOUNT_REQUIRED'
    if (!(await this.identidadVerificada(prestadorTenantId).catch(() => false))) return 'IDENTITY_NOT_VERIFIED'
    if (disponible <= 0n) return 'NO_FUNDS'
    if (disponible < minimo) return 'BELOW_MINIMUM'
    return null
  }

  async resumen(context: ContextoGanancias): Promise<ResumenGananciasPrestador> {
    const { saldo, abierta, solicitudes } = await this.estado(context.tenantId)
    const minimo = await this.opciones.minimoLiquidacion()
    const motivo = await this.motivo(context.tenantId, saldo.available, abierta, minimo)
    const minor = (value: bigint) => value.toString(10)
    return {
      currency: 'ARS',
      availableMinor: minor(saldo.available),
      negativeMinor: minor(saldo.available < 0n ? -saldo.available : 0n),
      reservedMinor: minor(saldo.reserved),
      processingMinor: minor(saldo.processing),
      paidMinor: minor(saldo.paid),
      feesMinor: minor(saldo.fees),
      adjustmentsMinor: minor(saldo.adjustments),
      minimumPayoutMinor: minor(minimo),
      canRequest: motivo === null,
      blockedReason: motivo,
      openPayout: abierta ? proyectarSolicitud(abierta) : null,
      lastDestinationEmail: solicitudes.at(-1)?.destinationEmail ?? null,
    }
  }

  // Newest first: every movement of the provider with what it is now.
  async historial(context: ContextoGanancias): Promise<MovimientoHistorialGanancia[]> {
    const { movimientos, items, solicitudes } = await this.estado(context.tenantId)
    const estadoDe = new Map(solicitudes.map((solicitud) => [solicitud.solicitudId, solicitud.status]))
    const tomado = new Map(items.filter((item) => item.activo).map((item) => [item.movimientoId, estadoDe.get(item.solicitudId)]))
    const filas = movimientos.map((movimiento): MovimientoHistorialGanancia => {
      const deSolicitud = movimiento.solicitudId ? estadoDe.get(movimiento.solicitudId) : undefined
      const enSolicitud = tomado.get(movimiento.movimientoId)
      const estado: EstadoMovimientoGanancia =
        movimiento.tipo === 'payout_reserve' ? (deSolicitud === 'pending' ? 'reserved' : (deSolicitud ?? 'reserved'))
        : movimiento.tipo === 'payout_release' ? (deSolicitud === 'cancelled' ? 'cancelled' : 'failed')
        : movimiento.tipo === 'payout_completed' ? 'paid'
        : enSolicitud === 'pending' ? 'reserved'
        : enSolicitud === 'processing' ? 'processing'
        : enSolicitud === 'paid' ? 'paid'
        : movimiento.tipo === 'earning_credit' ? 'available'
        : 'adjustment'
      const efecto = movimiento.tipo === 'payout_completed' ? movimiento.amountMinor : movimiento.tipo === 'payout_reserve' ? -movimiento.amountMinor : movimiento.tipo === 'payout_release' ? movimiento.amountMinor : signoMovimiento(movimiento.tipo) * movimiento.amountMinor
      return {
        date: movimiento.createdAt,
        kind: TIPO_HISTORIAL[movimiento.tipo],
        concept: movimiento.tipo === 'earning_credit' ? (movimiento.concepto ?? 'Pago de un servicio') : CONCEPTO_HISTORIAL[movimiento.tipo],
        service: movimiento.servicio ?? null,
        appointmentAt: movimiento.turno ?? null,
        amountMinor: efecto.toString(10),
        status: estado,
      }
    })
    return filas.sort((a, b) => b.date.localeCompare(a.date))
  }

  async liquidaciones(context: ContextoGanancias): Promise<SolicitudLiquidacionDTO[]> {
    return (await this.store.solicitudes(context.tenantId)).map(proyectarSolicitud).reverse()
  }

  // The provider asks to be paid everything available into its own Mercado Pago account. The
  // request reserves exactly the earnings it pays and books its reserve, in one transaction. The
  // body carries only the destination email; amount, provider and account are TUS's.
  async solicitar(context: ContextoGanancias, idempotencyKey: string, input: Record<string, unknown>): Promise<{ status: 'created' | 'existing'; payout: SolicitudLiquidacionDTO }> {
    if (Object.keys(input).some((campo) => campo !== 'destinationEmail')) throw new ErrorFinanzasServicio(400, 'UNTRUSTED_PAYOUT_FIELDS', 'amount, provider and account are decided by TUS')
    const key = clave(idempotencyKey)
    const destino = emailDestino(input['destinationEmail'])
    const prestadorId = await this.store.prestadorDe(context.tenantId)
    if (!prestadorId) throw new ErrorFinanzasServicio(403, 'FORBIDDEN', 'only a provider has earnings')
    const cuenta = await this.store.cuentaParaLiquidar(context.tenantId)
    if (!cuenta || (this.opciones.cuentaHabilitada && !(await this.opciones.cuentaHabilitada(context.tenantId).catch(() => false))))
      throw new ErrorFinanzasServicio(409, CODIGO_CUENTA_REQUERIDA, 'connect a valid Mercado Pago account to request a payout')
    if (!(await this.identidadVerificada(context.tenantId).catch(() => false))) throw new ErrorFinanzasServicio(409, 'PROVIDER_IDENTITY_NOT_VERIFIED', 'identity must be verified to request a payout')
    const ahora = this.iso()
    const minimo = await this.opciones.minimoLiquidacion()
    const { solicitud, nueva } = await this.store.crearAtomica(context.tenantId, key, (estado) => {
      if (estado.porClave) return estado.porClave
      if (estado.abierta) throw new ErrorFinanzasServicio(409, CODIGO_LIQUIDACION_ABIERTA, 'a payout request is already in progress')
      const monto = calcularSaldo(estado.movimientos, estado.solicitudes).available
      if (monto <= 0n) throw new ErrorFinanzasServicio(409, CODIGO_SIN_FONDOS, 'no earnings are available')
      if (monto < minimo) throw new ErrorFinanzasServicio(409, CODIGO_BAJO_MINIMO, 'the available earnings are below the minimum payout')
      const tomados = new Set(estado.itemsActivos.map((item) => item.movimientoId))
      const libres = estado.movimientos.filter((movimiento) => !esMovimientoDeLiquidacion(movimiento.tipo) && !tomados.has(movimiento.movimientoId))
      const nuevaSolicitud: SolicitudLiquidacion = {
        solicitudId: `liq-${randomUUID()}`,
        prestadorTenantId: context.tenantId,
        prestadorId,
        amountMinor: monto,
        currency: 'ARS',
        status: 'pending',
        cuentaCobroId: cuenta.cuentaCobroId,
        destinationEmail: destino,
        destinationAccountId: cuenta.externalAccountId,
        mechanism: null,
        providerPayoutId: null,
        providerTransactionId: null,
        providerStatus: null,
        externalReference: null,
        failureReason: null,
        note: null,
        requestedBy: context.actorId,
        processedBy: null,
        resolvedBy: null,
        idempotencyKey: key,
        correlationId: context.correlationId,
        version: 1,
        createdAt: ahora,
        updatedAt: ahora,
        processingAt: null,
        paidAt: null,
        failedAt: null,
        cancelledAt: null,
      }
      return { solicitud: nuevaSolicitud, movimientoIds: libres.map((movimiento) => movimiento.movimientoId), reserva: movimientoDeLiquidacion(nuevaSolicitud, 'payout_reserve', 'payout-requested', context.actorId, ahora) }
    })
    return { status: nueva ? 'created' : 'existing', payout: proyectarSolicitud(solicitud) }
  }

  async ver(context: ContextoGanancias, solicitudId: string): Promise<SolicitudLiquidacionDTO> {
    const solicitud = await this.store.buscar(context.tenantId, solicitudId)
    // Another provider's request does not exist for this one.
    if (!solicitud) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'payout request not found')
    return proyectarSolicitud(solicitud)
  }

  // The provider withdraws a request nobody started paying: its earnings are available again.
  async cancelar(context: ContextoGanancias, solicitudId: string): Promise<SolicitudLiquidacionDTO> {
    const solicitud = await this.store.buscar(context.tenantId, solicitudId)
    if (!solicitud) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'payout request not found')
    if (solicitud.status !== 'pending') throw new ErrorFinanzasServicio(409, 'INVALID_TRANSITION', 'only a pending request can be cancelled')
    return proyectarSolicitud(await this.mover(solicitud, 'cancelled', context.actorId, { failureReason: 'cancelled-by-provider' }))
  }

  // ---- platform administration -------------------------------------------------------------

  get pagoAutomaticoDisponible(): boolean {
    return this.ejecucion.disponible
  }

  async listar(input: { status?: unknown; providerTenantId?: unknown; page?: unknown; pageSize?: unknown }): Promise<{ items: LiquidacionAdminDTO[]; total: number; page: number; pageSize: number }> {
    const estado = typeof input.status === 'string' && input.status ? input.status : ''
    const estados = estado === '' ? (['pending', 'processing', 'paid', 'failed', 'cancelled'] as const) : estado === 'open' ? (['pending', 'processing'] as const) : ([estado] as EstadoSolicitudLiquidacion[])
    if (!estados.every((item) => ['pending', 'processing', 'paid', 'failed', 'cancelled'].includes(item))) throw new ErrorFinanzasServicio(400, 'INVALID', 'unknown status filter')
    const page = Math.max(1, Math.min(10_000, Number.parseInt(String(input.page ?? '1'), 10) || 1))
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(input.pageSize ?? '25'), 10) || 25))
    const prestadorTenantId = typeof input.providerTenantId === 'string' && input.providerTenantId.trim() ? input.providerTenantId.trim().slice(0, 200) : null
    const { items, total } = await this.store.listar({ estados, prestadorTenantId, limite: pageSize, desplazamiento: (page - 1) * pageSize })
    const nombres = new Map<string, string | null>()
    for (const item of items) if (!nombres.has(item.prestadorTenantId)) nombres.set(item.prestadorTenantId, await this.store.nombrePrestador(item.prestadorTenantId))
    return { items: items.map((item) => proyectarAdmin(item, nombres.get(item.prestadorTenantId) ?? null)), total, page, pageSize }
  }

  async detalle(solicitudId: string): Promise<DetalleLiquidacionAdminDTO> {
    const solicitud = await this.store.buscarPorId(solicitudId)
    if (!solicitud) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'payout request not found')
    const [{ movimientos, items }, cuenta, nombre] = await Promise.all([this.estado(solicitud.prestadorTenantId), this.store.cuentaActual(solicitud.prestadorTenantId), this.store.nombrePrestador(solicitud.prestadorTenantId)])
    const deLaSolicitud = new Set(items.filter((item) => item.solicitudId === solicitud.solicitudId).map((item) => item.movimientoId))
    return {
      payout: proyectarAdmin(solicitud, nombre),
      account: { status: cuenta?.status ?? 'not_connected', externalAccountId: cuenta?.externalAccountId ?? null, liveMode: cuenta?.liveMode ?? null, requestAccountId: solicitud.destinationAccountId },
      items: movimientos
        .filter((movimiento) => deLaSolicitud.has(movimiento.movimientoId))
        .map((movimiento) => ({ kind: TIPO_HISTORIAL[movimiento.tipo], concept: movimiento.tipo === 'earning_credit' ? (movimiento.concepto ?? 'Pago de un servicio') : CONCEPTO_HISTORIAL[movimiento.tipo], service: movimiento.servicio ?? null, appointmentAt: movimiento.turno ?? null, date: movimiento.createdAt, amountMinor: (signoMovimiento(movimiento.tipo) * movimiento.amountMinor).toString(10) })),
      movements: movimientos
        .filter((movimiento) => movimiento.solicitudId === solicitud.solicitudId && esMovimientoDeLiquidacion(movimiento.tipo))
        .map((movimiento) => ({ kind: movimiento.tipo as 'payout_reserve' | 'payout_release' | 'payout_completed', amountMinor: movimiento.amountMinor.toString(10), date: movimiento.createdAt, actorId: movimiento.actorId })),
      automaticAvailable: this.ejecucion.disponible,
    }
  }

  private async requerir(solicitudId: string): Promise<SolicitudLiquidacion> {
    const solicitud = await this.store.buscarPorId(solicitudId)
    if (!solicitud) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'payout request not found')
    return solicitud
  }

  // Starts paying a pending request. 'mercado_pago_payouts' sends the transfer through Mercado
  // Pago Payouts right away; 'manual' records that the administration will pay it by another
  // means (and must then record that operation's reference to mark it paid).
  async procesar(context: ContextoGanancias, solicitudId: string, input: Record<string, unknown>): Promise<SolicitudLiquidacionDTO> {
    if (Object.keys(input).some((campo) => campo !== 'mechanism' && campo !== 'note')) throw new ErrorFinanzasServicio(400, 'UNTRUSTED_PAYOUT_FIELDS', 'only mechanism and note are accepted')
    const mecanismo = input['mechanism']
    if (mecanismo !== 'mercado_pago_payouts' && mecanismo !== 'manual') throw new ErrorFinanzasServicio(400, 'INVALID', 'mechanism must be mercado_pago_payouts or manual')
    const note = textoOpcional(input['note'], 'note')
    const solicitud = await this.requerir(solicitudId)
    if (mecanismo === 'mercado_pago_payouts' && !this.ejecucion.disponible) throw new ErrorFinanzasServicio(503, 'PAYOUTS_NOT_CONFIGURED', 'Mercado Pago Payouts is not configured')
    if (solicitud.status !== 'pending') throw new ErrorFinanzasServicio(409, 'INVALID_TRANSITION', `payout request cannot be processed from ${solicitud.status}`)
    const enProceso = await this.mover(solicitud, 'processing', context.actorId, { mechanism: mecanismo, note, processedBy: context.actorId })
    return proyectarSolicitud(mecanismo === 'mercado_pago_payouts' ? await this.enviarAMercadoPago(enProceso, context.actorId) : enProceso)
  }

  // Sends (or resends, with the same idempotency key) a request being paid through Mercado Pago.
  async reenviar(context: ContextoGanancias, solicitudId: string): Promise<SolicitudLiquidacionDTO> {
    const solicitud = await this.requerir(solicitudId)
    if (solicitud.status !== 'processing' || solicitud.mechanism !== 'mercado_pago_payouts' || solicitud.providerPayoutId) throw new ErrorFinanzasServicio(409, 'INVALID_TRANSITION', 'only a Mercado Pago payout whose sending was not confirmed can be resent')
    return proyectarSolicitud(await this.enviarAMercadoPago(solicitud, context.actorId))
  }

  private async enviarAMercadoPago(solicitud: SolicitudLiquidacion, actorId: string): Promise<SolicitudLiquidacion> {
    let enviado: { payoutId: string; transactionId: string; status: string }
    try {
      enviado = await this.ejecucion.enviar({ solicitudId: solicitud.solicitudId, amountMinor: solicitud.amountMinor, destinationEmail: solicitud.destinationEmail, description: 'Pago de ganancias TUS' })
    } catch (error) {
      const code = (error as { code?: unknown }).code
      // Mercado Pago refused it (wrong destination, no funds, forbidden): nothing was sent, the
      // funds go back to the provider. Anything ambiguous keeps the request being paid; resending
      // reuses the idempotency key, so no second transfer can exist.
      if (code === 'PROVIDER_REJECTED') return this.mover(solicitud, 'failed', actorId, { failureReason: 'mercado_pago_rejected', providerStatus: 'rejected_on_create' })
      const actualizada = { ...solicitud, providerStatus: 'send_unconfirmed', version: solicitud.version + 1, updatedAt: this.iso() }
      await this.store.transicionar({ actual: solicitud, siguiente: actualizada, liberar: false, movimientos: [], at: actualizada.updatedAt })
      throw new ErrorFinanzasServicio(502, 'PAYOUT_SEND_UNCONFIRMED', 'Mercado Pago did not confirm the transfer; resend it or refresh its status')
    }
    const conIds: SolicitudLiquidacion = { ...solicitud, providerPayoutId: enviado.payoutId, providerTransactionId: enviado.transactionId, providerStatus: enviado.status, externalReference: `${enviado.payoutId}/${enviado.transactionId}`, version: solicitud.version + 1, updatedAt: this.iso() }
    if (!(await this.store.transicionar({ actual: solicitud, siguiente: conIds, liberar: false, movimientos: [], at: conIds.updatedAt }))) throw new ErrorFinanzasServicio(409, 'VERSION_CONFLICT', 'payout request changed; reload it')
    return conIds
  }

  // Reads the transfer from Mercado Pago and applies what it says: paid books the completion,
  // a definitive failure releases the funds, anything else keeps it being paid.
  async actualizarDesdeMercadoPago(context: ContextoGanancias, solicitudId: string): Promise<SolicitudLiquidacionDTO> {
    const solicitud = await this.requerir(solicitudId)
    return proyectarSolicitud(await this.aplicarEstadoProveedor(solicitud, context.actorId))
  }

  private async aplicarEstadoProveedor(solicitud: SolicitudLiquidacion, actorId: string): Promise<SolicitudLiquidacion> {
    if (solicitud.mechanism !== 'mercado_pago_payouts' || !solicitud.providerPayoutId || !solicitud.providerTransactionId) throw new ErrorFinanzasServicio(409, 'NOT_A_MERCADO_PAGO_PAYOUT', 'the request was not sent through Mercado Pago Payouts')
    if (solicitud.status !== 'processing') return solicitud
    const estado = await this.ejecucion.consultar({ payoutId: solicitud.providerPayoutId, transactionId: solicitud.providerTransactionId })
    const providerStatus = `${estado.status}${estado.statusDetail ? `:${estado.statusDetail}` : ''}`
    if (estado.resultado === 'paid') return this.mover(solicitud, 'paid', actorId, { providerStatus })
    if (estado.resultado === 'failed') return this.mover(solicitud, 'failed', actorId, { providerStatus, failureReason: `mercado_pago:${providerStatus}` })
    if (providerStatus === solicitud.providerStatus) return solicitud
    const actualizada = { ...solicitud, providerStatus, version: solicitud.version + 1, updatedAt: this.iso() }
    return (await this.store.transicionar({ actual: solicitud, siguiente: actualizada, liberar: false, movimientos: [], at: actualizada.updatedAt })) ? actualizada : solicitud
  }

  // A Mercado Pago Payouts notification. Its content is never trusted (Mercado Pago documents no
  // signature for it): it only says which payout to look at; the state is read from Mercado Pago.
  async notificacionPayout(body: unknown): Promise<{ status: 'applied' | 'ignored'; payoutStatus?: EstadoSolicitudLiquidacion }> {
    const registro = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    const payout = typeof registro['payout'] === 'object' && registro['payout'] !== null ? (registro['payout'] as Record<string, unknown>) : {}
    const payoutId = typeof payout['id'] === 'string' ? payout['id'] : ''
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(payoutId)) return { status: 'ignored' }
    const solicitud = await this.store.buscarPorPayoutProveedor(payoutId)
    if (!solicitud) return { status: 'ignored' }
    const actualizada = await this.aplicarEstadoProveedor(solicitud, 'system:mercado-pago-payouts')
    return { status: 'applied', payoutStatus: actualizada.status }
  }

  // The administration paid a 'manual' request by another means: only with that operation's
  // reference (and an optional note). A Mercado Pago payout is paid only by Mercado Pago's answer.
  async marcarPagada(context: ContextoGanancias, solicitudId: string, input: Record<string, unknown>): Promise<SolicitudLiquidacionDTO> {
    if (Object.keys(input).some((campo) => campo !== 'externalReference' && campo !== 'note')) throw new ErrorFinanzasServicio(400, 'UNTRUSTED_PAYOUT_FIELDS', 'only externalReference and note are accepted')
    const reference = texto(input['externalReference'], 'externalReference')
    const note = textoOpcional(input['note'], 'note')
    const solicitud = await this.requerir(solicitudId)
    if (solicitud.status !== 'processing' || solicitud.mechanism !== 'manual') throw new ErrorFinanzasServicio(409, 'INVALID_TRANSITION', 'only a request being paid by another means can be marked paid; a Mercado Pago payout is confirmed by Mercado Pago')
    return proyectarSolicitud(await this.mover(solicitud, 'paid', context.actorId, { externalReference: reference, note: note ?? solicitud.note }))
  }

  async marcarFallida(context: ContextoGanancias, solicitudId: string, input: Record<string, unknown>): Promise<SolicitudLiquidacionDTO> {
    if (Object.keys(input).some((campo) => campo !== 'reason')) throw new ErrorFinanzasServicio(400, 'UNTRUSTED_PAYOUT_FIELDS', 'only reason is accepted')
    const reason = texto(input['reason'], 'reason', 300)
    const solicitud = await this.requerir(solicitudId)
    this.exigirSinTransferenciaEnviada(solicitud)
    return proyectarSolicitud(await this.mover(solicitud, 'failed', context.actorId, { failureReason: reason }))
  }

  async cancelarAdmin(context: ContextoGanancias, solicitudId: string, input: Record<string, unknown>): Promise<SolicitudLiquidacionDTO> {
    if (Object.keys(input).some((campo) => campo !== 'reason')) throw new ErrorFinanzasServicio(400, 'UNTRUSTED_PAYOUT_FIELDS', 'only reason is accepted')
    const reason = texto(input['reason'], 'reason', 300)
    const solicitud = await this.requerir(solicitudId)
    this.exigirSinTransferenciaEnviada(solicitud)
    return proyectarSolicitud(await this.mover(solicitud, 'cancelled', context.actorId, { failureReason: reason }))
  }

  // Money that may have left through Mercado Pago is never released by hand: only Mercado Pago's
  // answer can fail it.
  private exigirSinTransferenciaEnviada(solicitud: SolicitudLiquidacion): void {
    if (solicitud.status === 'processing' && solicitud.mechanism === 'mercado_pago_payouts')
      throw new ErrorFinanzasServicio(409, 'PAYOUT_SENT_TO_PROVIDER', 'this payout was sent to Mercado Pago; its result comes from Mercado Pago')
  }

  // Balances below zero (refunds, chargebacks or fees after a payout): an obligation of the
  // provider that future earnings net automatically. Nothing is ever charged to the provider.
  async saldosNegativos(): Promise<SaldoNegativoPrestadorDTO[]> {
    const filas: SaldoNegativoPrestadorDTO[] = []
    for (const prestadorTenantId of (await this.store.prestadoresConDebitos()).slice(0, 500)) {
      const { saldo, movimientos } = await this.estado(prestadorTenantId)
      if (saldo.available >= 0n) continue
      filas.push({ providerTenantId: prestadorTenantId, providerId: movimientos[0]?.prestadorId ?? '', availableMinor: saldo.available.toString(10), lastMovementAt: movimientos.at(-1)?.createdAt ?? null })
    }
    return filas.sort((a, b) => (BigInt(a.availableMinor) < BigInt(b.availableMinor) ? -1 : 1))
  }

  // An explicit manual resolution: a credit or debit movement with its reason. Idempotent by key.
  async ajustar(context: ContextoGanancias, input: Record<string, unknown>, idempotencyKey: string): Promise<{ status: 'created' | 'existing'; adjustment: AjusteGananciaDTO }> {
    const permitidos = ['providerTenantId', 'kind', 'amountMinor', 'reason']
    if (Object.keys(input).some((campo) => !permitidos.includes(campo))) throw new ErrorFinanzasServicio(400, 'UNTRUSTED_ADJUSTMENT_FIELDS', 'only providerTenantId, kind, amountMinor and reason are accepted')
    const key = clave(idempotencyKey)
    const kind = input['kind']
    if (kind !== 'credit' && kind !== 'debit') throw new ErrorFinanzasServicio(400, 'INVALID', 'kind must be credit or debit')
    const amountText = typeof input['amountMinor'] === 'string' ? input['amountMinor'] : ''
    if (!/^[1-9]\d{0,14}$/u.test(amountText)) throw new ErrorFinanzasServicio(400, 'INVALID', 'amountMinor must be a positive integer of centavos')
    const reason = texto(input['reason'], 'reason', 300)
    const prestadorTenantId = typeof input['providerTenantId'] === 'string' ? input['providerTenantId'].trim() : ''
    const prestadorId = prestadorTenantId ? await this.store.prestadorDe(prestadorTenantId) : null
    if (!prestadorId) throw new ErrorFinanzasServicio(404, 'NOT_FOUND', 'provider not found')
    const movimiento: MovimientoGanancia = {
      movimientoId: `adjustment:${key}`,
      prestadorTenantId,
      prestadorId,
      tipo: kind === 'credit' ? 'adjustment_credit' : 'adjustment_debit',
      amountMinor: BigInt(amountText),
      currency: 'ARS',
      obligacionTenantId: null,
      obligacionId: null,
      trabajoId: null,
      solicitudId: null,
      relacionadoId: null,
      reason,
      actorId: context.actorId,
      correlationId: context.correlationId,
      createdAt: this.iso(),
    }
    const creado = await this.store.registrarMovimiento(movimiento)
    const guardado = creado ? movimiento : await this.store.movimientos(prestadorTenantId).then((items) => items.find((item) => item.movimientoId === movimiento.movimientoId) ?? null)
    if (!guardado || guardado.tipo !== movimiento.tipo || guardado.amountMinor !== movimiento.amountMinor) throw new ErrorFinanzasServicio(409, 'IDEMPOTENCY_CONFLICT', 'that key was used for a different adjustment')
    return { status: creado ? 'created' : 'existing', adjustment: { adjustmentId: key, kind, amountMinor: guardado.amountMinor.toString(10), reason: guardado.reason, createdAt: guardado.createdAt } }
  }

  // Reconciliation of one provider: each payment TUS collected for it, what the client paid, the
  // TUS commission, the Mercado Pago fee, the provider's net, what was reversed and which payout
  // request holds or paid it. Rebuilt from the ledger and the commission snapshots.
  async conciliacion(prestadorTenantId: string): Promise<ConciliacionGananciaDTO[]> {
    const { movimientos, items, solicitudes } = await this.estado(prestadorTenantId)
    const desgloses = await this.store.desgloses(prestadorTenantId)
    const estadoDe = new Map(solicitudes.map((solicitud) => [solicitud.solicitudId, solicitud.status]))
    const solicitudDe = new Map(items.filter((item) => item.activo).map((item) => [item.movimientoId, item.solicitudId]))
    return movimientos
      .filter((movimiento) => movimiento.tipo === 'earning_credit')
      .map((ganancia) => {
        const deLaObligacion = movimientos.filter((item) => item.obligacionId === ganancia.obligacionId)
        const suma = (tipo: TipoMovimientoGanancia) => deLaObligacion.filter((item) => item.tipo === tipo).reduce((total, item) => total + item.amountMinor, 0n)
        const desglose = desgloses.get(ganancia.obligacionId ?? '')
        const payoutId = solicitudDe.get(ganancia.movimientoId) ?? null
        return {
          obligationId: ganancia.obligacionId ?? '',
          date: ganancia.createdAt,
          grossMinor: desglose ? desglose.grossMinor.toString(10) : null,
          commissionMinor: desglose ? desglose.commissionMinor.toString(10) : null,
          mercadoPagoFeeMinor: deLaObligacion.some((item) => item.tipo === 'psp_fee_debit') ? suma('psp_fee_debit').toString(10) : null,
          earningMinor: ganancia.amountMinor.toString(10),
          refundedMinor: suma('refund_debit').toString(10),
          chargedBackMinor: suma('chargeback_debit').toString(10),
          netMinor: (ganancia.amountMinor - suma('psp_fee_debit') - suma('refund_debit') - suma('chargeback_debit')).toString(10),
          payoutId,
          payoutStatus: payoutId ? (estadoDe.get(payoutId) ?? null) : null,
        }
      })
  }

  private async mover(
    solicitud: SolicitudLiquidacion,
    hacia: EstadoSolicitudLiquidacion,
    actorId: string,
    extra: { externalReference?: string; failureReason?: string; mechanism?: MecanismoLiquidacion; note?: string | null; processedBy?: string; providerStatus?: string }
  ): Promise<SolicitudLiquidacion> {
    if (!TRANSICIONES[solicitud.status].includes(hacia)) throw new ErrorFinanzasServicio(409, 'INVALID_TRANSITION', `payout request cannot move from ${solicitud.status} to ${hacia}`)
    const ahora = this.iso()
    const siguiente: SolicitudLiquidacion = {
      ...solicitud,
      status: hacia,
      mechanism: extra.mechanism ?? solicitud.mechanism,
      note: extra.note !== undefined ? extra.note : solicitud.note,
      processedBy: extra.processedBy ?? solicitud.processedBy,
      providerStatus: extra.providerStatus ?? solicitud.providerStatus,
      externalReference: extra.externalReference ?? solicitud.externalReference,
      failureReason: extra.failureReason ?? solicitud.failureReason,
      resolvedBy: hacia === 'processing' ? solicitud.resolvedBy : actorId,
      version: solicitud.version + 1,
      updatedAt: ahora,
      ...(hacia === 'processing' ? { processingAt: ahora } : {}),
      ...(hacia === 'paid' ? { paidAt: ahora } : {}),
      ...(hacia === 'failed' ? { failedAt: ahora } : {}),
      ...(hacia === 'cancelled' ? { cancelledAt: ahora } : {}),
    }
    const movimientos =
      hacia === 'paid'
        ? [movimientoDeLiquidacion(siguiente, 'payout_completed', `payout-paid:${siguiente.externalReference}`, actorId, ahora)]
        : hacia === 'failed' || hacia === 'cancelled'
          ? [movimientoDeLiquidacion(siguiente, 'payout_release', `payout-${hacia}:${siguiente.failureReason ?? ''}`.slice(0, 300), actorId, ahora)]
          : []
    const movida = await this.store.transicionar({ actual: solicitud, siguiente, liberar: hacia === 'failed' || hacia === 'cancelled', movimientos, at: ahora })
    if (!movida) throw new ErrorFinanzasServicio(409, 'VERSION_CONFLICT', 'payout request changed; reload it')
    return siguiente
  }
}
