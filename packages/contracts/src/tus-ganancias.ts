// TUS-GANANCIAS-01: what TUS owes a provider for payments TUS collected with its own Mercado
// Pago account (the provider had none linked), and the provider's payout requests. Amounts are
// minor units (centavos) written as strings, ARS only. No internal database id is part of the
// provider shapes; `payoutId` is the provider's own request reference.

export const ESTADOS_SOLICITUD_LIQUIDACION = ['pending', 'processing', 'paid', 'failed', 'cancelled'] as const
export type EstadoSolicitudLiquidacion = (typeof ESTADOS_SOLICITUD_LIQUIDACION)[number]

// How a payout is executed: Mercado Pago Payouts (POST /v1/payouts, account-to-account transfer
// from TUS's account to the provider's) or another means the administration performed and
// recorded with its reference.
export const MECANISMOS_LIQUIDACION = ['mercado_pago_payouts', 'manual'] as const
export type MecanismoLiquidacion = (typeof MECANISMOS_LIQUIDACION)[number]

// Why a payout cannot be requested now.
export const MOTIVOS_SIN_LIQUIDACION = ['NO_FUNDS', 'BELOW_MINIMUM', 'PAYMENT_ACCOUNT_REQUIRED', 'IDENTITY_NOT_VERIFIED', 'PAYOUT_IN_PROGRESS'] as const
export type MotivoSinLiquidacion = (typeof MOTIVOS_SIN_LIQUIDACION)[number]

export interface SolicitudLiquidacionDTO {
  payoutId: string
  amountMinor: string
  currency: 'ARS'
  status: EstadoSolicitudLiquidacion
  // The provider's own Mercado Pago account email, where the money is sent.
  destinationEmail: string
  mechanism: MecanismoLiquidacion | null
  // Last status Mercado Pago reported for the transfer (for example 'success:accredited').
  providerStatus: string | null
  externalReference: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
  processingAt: string | null
  paidAt: string | null
}

export interface ResumenGananciasPrestador {
  currency: 'ARS'
  // Derived from the ledger: earnings net of fees, reversals and adjustments, minus what open or
  // paid requests hold. May be negative (then `negativeMinor` is its absolute value).
  availableMinor: string
  negativeMinor: string
  // In a pending request / in a request being paid.
  reservedMinor: string
  processingMinor: string
  // Paid out by TUS.
  paidMinor: string
  // Mercado Pago fees of the collections TUS made, borne by the provider (as in Split 1:1).
  feesMinor: string
  // Refunds, chargebacks and debit adjustments minus credit adjustments (positive: debited).
  adjustmentsMinor: string
  // The minimum of a payout request, from the administrative payment configuration.
  minimumPayoutMinor: string
  canRequest: boolean
  blockedReason: MotivoSinLiquidacion | null
  openPayout: SolicitudLiquidacionDTO | null
  // The email of the last request, to prefill the next one (the provider's own data).
  lastDestinationEmail: string | null
}

export type EstadoMovimientoGanancia = 'available' | 'reserved' | 'processing' | 'paid' | 'adjustment' | 'failed' | 'cancelled'

export interface MovimientoHistorialGanancia {
  date: string
  kind: 'earning' | 'mercado_pago_fee' | 'refund' | 'chargeback' | 'adjustment' | 'payout_reserve' | 'payout_release' | 'payout_completed'
  concept: string
  service: string | null
  // Start of the turno the payment was for, when it was a turno.
  appointmentAt: string | null
  // Signed effect on the available balance (a completed payout is shown with its amount and no
  // effect: its reserve already took it).
  amountMinor: string
  status: EstadoMovimientoGanancia
}

export const CODIGO_SIN_FONDOS = 'PAYOUT_NO_FUNDS'
export const CODIGO_CUENTA_REQUERIDA = 'PAYMENT_ACCOUNT_REQUIRED'
export const CODIGO_LIQUIDACION_ABIERTA = 'PAYOUT_ALREADY_OPEN'
export const CODIGO_BAJO_MINIMO = 'PAYOUT_BELOW_MINIMUM'

// ---- platform administration (never shown to a provider) ------------------------------------

export interface SaldoNegativoPrestadorDTO {
  providerTenantId: string
  providerId: string
  availableMinor: string
  lastMovementAt: string | null
}

export interface AjusteGananciaDTO {
  adjustmentId: string
  kind: 'credit' | 'debit'
  amountMinor: string
  reason: string
  createdAt: string
}

// One payment TUS collected for a provider, rebuilt from the ledger and the commission snapshot.
export interface ConciliacionGananciaDTO {
  obligationId: string
  date: string
  grossMinor: string | null
  commissionMinor: string | null
  // null: Mercado Pago has not reported the fee yet (never estimated).
  mercadoPagoFeeMinor: string | null
  earningMinor: string
  refundedMinor: string
  chargedBackMinor: string
  netMinor: string
  payoutId: string | null
  payoutStatus: EstadoSolicitudLiquidacion | null
}

export type LiquidacionAdminDTO = SolicitudLiquidacionDTO & {
  providerTenantId: string
  providerId: string
  providerName: string | null
  requestedBy: string
  processedBy: string | null
  resolvedBy: string | null
  note: string | null
  providerPayoutId: string | null
  providerTransactionId: string | null
}

export interface DetalleLiquidacionAdminDTO {
  payout: LiquidacionAdminDTO
  // The linked Mercado Pago account as it is now, and the one recorded on the request.
  account: { status: string; externalAccountId: string | null; liveMode: boolean | null; requestAccountId: string | null }
  // The earnings and debits this request pays.
  items: { kind: MovimientoHistorialGanancia['kind']; concept: string; service: string | null; appointmentAt: string | null; date: string; amountMinor: string }[]
  // Its reserve, release and completion movements.
  movements: { kind: 'payout_reserve' | 'payout_release' | 'payout_completed'; amountMinor: string; date: string; actorId: string }[]
  // Whether Mercado Pago Payouts is configured to execute it.
  automaticAvailable: boolean
}

export function mensajeMotivoSinLiquidacion(motivo: MotivoSinLiquidacion | null): string | null {
  if (motivo === 'PAYMENT_ACCOUNT_REQUIRED') return 'Para solicitar el pago de tus ganancias necesitás conectar Mercado Pago.'
  if (motivo === 'PAYOUT_IN_PROGRESS') return 'Ya tenés una solicitud de pago en proceso.'
  if (motivo === 'IDENTITY_NOT_VERIFIED') return 'Para solicitar el pago de tus ganancias tu identidad tiene que estar verificada.'
  if (motivo === 'NO_FUNDS') return 'Todavía no tenés ganancias disponibles para solicitar.'
  if (motivo === 'BELOW_MINIMUM') return 'Todavía no llegaste al mínimo para solicitar el pago de tus ganancias.'
  return null
}
