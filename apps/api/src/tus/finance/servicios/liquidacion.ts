import {
  TUS_CONTRACT_VERSION,
  calculateBasisPointsAmount,
  formatMinorUnits,
  subtractMoney,
  type ConciliacionServicio,
  type EstadoLiquidacionServicio,
  type HallazgoConciliacionServicio,
  type LiquidacionServicio,
} from '@factory/contracts'
import { ErrorFinanzasServicio, type ObligacionServicio } from './modelo.ts'
import type { IntencionPagoServicioDominio } from './pagos.ts'

// WEB-09C internal effects. Everything here is local accounting: no split, payout or refund is
// executed against a provider, and `eligible` never means the provider received money.

export interface ReglaComisionServicio {
  rateBps: number
  ruleVersion: string
}

// Existing TUS rule (`TusFinanceService` default); no new commercial decision is introduced.
export const REGLA_COMISION_SERVICIO_POR_DEFECTO: ReglaComisionServicio = Object.freeze({
  rateBps: 1000,
  ruleVersion: 'mvp-10-percent-v1',
})

export interface InstantaneaComisionServicio {
  snapshotId: string
  tenantId: string
  obligacionId: string
  grossMinor: bigint
  commissionableBaseMinor: bigint
  rateBps: number
  ruleVersion: string
  commissionMinor: bigint
  netMinor: bigint
  currency: string
  providerReference: string
  evidenceId: string
  createdAt: string
}

export type TipoMovimientoServicio =
  | 'gross_authorized'
  | 'commission_reserved'
  | 'merchant_payable_held'
  | 'refund_compensation'
  | 'chargeback_compensation'

export interface MovimientoContableServicio {
  entryId: string
  tenantId: string
  obligacionId: string
  entryType: TipoMovimientoServicio
  amountMinor: bigint
  currency: string
  linkedEntryId: string | null
  reason: string
  createdAt: string
}

export interface LiquidacionServicioDominio {
  liquidacionId: string
  tenantId: string
  prestadorTenantId: string
  obligacionId: string
  trabajoId: string
  grossMinor: bigint
  commissionMinor: bigint
  netMinor: bigint
  currency: string
  status: EstadoLiquidacionServicio
  reason: string
  version: number
  createdAt: string
  updatedAt: string
}

export function calcularInstantaneaComision(input: {
  obligation: ObligacionServicio
  intent: IntencionPagoServicioDominio
  rule: ReglaComisionServicio
  evidenceId: string
  now: string
}): InstantaneaComisionServicio {
  const { obligation, intent, rule } = input
  if (intent.amountMinor !== obligation.amountMinor || intent.currency !== obligation.currency)
    throw new ErrorFinanzasServicio(
      409,
      'AMOUNT_MISMATCH',
      'payment does not match the obligation amount'
    )
  if (!intent.providerReference)
    throw new ErrorFinanzasServicio(
      409,
      'PROVIDER_REFERENCE_REQUIRED',
      'commission requires a provider reference'
    )
  const commissionMinor = calculateBasisPointsAmount(obligation.amountMinor, rule.rateBps)
  const net = subtractMoney(
    { currency: obligation.currency, minor: obligation.amountMinor },
    { currency: obligation.currency, minor: commissionMinor }
  )
  return {
    snapshotId: `comision-${obligation.obligacionId}`,
    tenantId: obligation.tenantId,
    obligacionId: obligation.obligacionId,
    grossMinor: obligation.amountMinor,
    commissionableBaseMinor: obligation.amountMinor,
    rateBps: rule.rateBps,
    ruleVersion: rule.ruleVersion,
    commissionMinor,
    netMinor: net.minor,
    currency: obligation.currency,
    providerReference: intent.providerReference,
    evidenceId: input.evidenceId,
    createdAt: input.now,
  }
}

// Deterministic entry ids: a second attempt to book the same effect collides on the
// (tenant_id, entrada_id) unique key instead of producing another movement.
export function movimientosAprobacion(
  snapshot: InstantaneaComisionServicio,
  now: string
): MovimientoContableServicio[] {
  const base = {
    tenantId: snapshot.tenantId,
    obligacionId: snapshot.obligacionId,
    currency: snapshot.currency,
    createdAt: now,
  }
  const gross = `svc-gross-${snapshot.obligacionId}`
  const commission = `svc-commission-${snapshot.obligacionId}`
  return [
    {
      ...base,
      entryId: gross,
      entryType: 'gross_authorized',
      amountMinor: snapshot.grossMinor,
      linkedEntryId: null,
      reason: 'provider-approved',
    },
    {
      ...base,
      entryId: commission,
      entryType: 'commission_reserved',
      amountMinor: snapshot.commissionMinor,
      linkedEntryId: gross,
      reason: snapshot.ruleVersion,
    },
    {
      ...base,
      entryId: `svc-payable-${snapshot.obligacionId}`,
      entryType: 'merchant_payable_held',
      amountMinor: snapshot.netMinor,
      linkedEntryId: commission,
      reason: 'internal-settlement-hold',
    },
  ]
}

export function movimientoCompensacion(
  obligation: ObligacionServicio,
  entryType: 'refund_compensation' | 'chargeback_compensation',
  providerEventId: string,
  now: string
): MovimientoContableServicio {
  return {
    entryId: `svc-${entryType === 'refund_compensation' ? 'refund' : 'chargeback'}-${obligation.obligacionId}`,
    tenantId: obligation.tenantId,
    obligacionId: obligation.obligacionId,
    entryType,
    amountMinor: obligation.amountMinor,
    currency: obligation.currency,
    linkedEntryId: `svc-gross-${obligation.obligacionId}`,
    reason: `provider-event:${providerEventId}`,
    createdAt: now,
  }
}

const TRANSICIONES_LIQUIDACION: Readonly<
  Record<EstadoLiquidacionServicio, readonly EstadoLiquidacionServicio[]>
> = {
  held: ['eligible', 'frozen', 'reversed'],
  eligible: ['frozen', 'reversed'],
  frozen: ['reversed'],
  reversed: [],
}

export function esTransicionLiquidacionPermitida(
  desde: EstadoLiquidacionServicio,
  hacia: EstadoLiquidacionServicio
): boolean {
  return (TRANSICIONES_LIQUIDACION[desde] ?? []).includes(hacia)
}

export function transicionarLiquidacion(
  settlement: LiquidacionServicioDominio,
  hacia: EstadoLiquidacionServicio,
  reason: string,
  now: string
): LiquidacionServicioDominio {
  if (!esTransicionLiquidacionPermitida(settlement.status, hacia))
    throw new ErrorFinanzasServicio(
      409,
      'INVALID_TRANSITION',
      `settlement cannot move from ${settlement.status} to ${hacia}`
    )
  return { ...settlement, status: hacia, reason, version: settlement.version + 1, updatedAt: now }
}

export function crearLiquidacion(
  obligation: ObligacionServicio,
  snapshot: InstantaneaComisionServicio,
  now: string
): LiquidacionServicioDominio {
  return {
    liquidacionId: `liquidacion-${obligation.obligacionId}`,
    tenantId: obligation.tenantId,
    prestadorTenantId: obligation.prestadorTenantId,
    obligacionId: obligation.obligacionId,
    trabajoId: obligation.trabajoId,
    grossMinor: snapshot.grossMinor,
    commissionMinor: snapshot.commissionMinor,
    netMinor: snapshot.netMinor,
    currency: snapshot.currency,
    status: 'held',
    reason: 'payment_approved_work_pending',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

export function proyectarLiquidacion(settlement: LiquidacionServicioDominio): LiquidacionServicio {
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    liquidacionId: settlement.liquidacionId,
    obligacionId: settlement.obligacionId,
    trabajoId: settlement.trabajoId,
    tenantId: settlement.tenantId,
    prestadorTenantId: settlement.prestadorTenantId,
    grossMinor: formatMinorUnits(settlement.grossMinor),
    commissionMinor: formatMinorUnits(settlement.commissionMinor),
    netMinor: formatMinorUnits(settlement.netMinor),
    currency: settlement.currency,
    status: settlement.status,
    reason: settlement.reason,
    payoutStatus: 'not_executed',
    version: settlement.version,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
  }
}

export interface EventoConciliable {
  eventId: string
  paymentId: string
  status: string
  amountMinor: bigint
  currency: string
  result: string
  reason: string | null
}

// Compares provider evidence (verified inbox), local payments, ledger and settlement. It only
// reports findings; it never rewrites money.
export function evaluarConciliacion(input: {
  obligation: ObligacionServicio
  intents: IntencionPagoServicioDominio[]
  events: EventoConciliable[]
  ledger: MovimientoContableServicio[]
  snapshot: InstantaneaComisionServicio | null
  settlement: LiquidacionServicioDominio | null
}): { status: ConciliacionServicio['status']; findings: HallazgoConciliacionServicio[] } {
  const { obligation, intents, events, ledger, snapshot, settlement } = input
  const findings: HallazgoConciliacionServicio[] = []
  const add = (code: HallazgoConciliacionServicio['code'], detail: string) =>
    findings.push({ code, detail })
  const approvedIntents = intents.filter((intent) =>
    ['approved', 'refunded', 'charged_back'].includes(intent.providerStatus)
  )
  const approvalEvents = events.filter(
    (event) => event.result === 'applied' && event.status === 'approved'
  )
  const grossEntries = ledger.filter((entry) => entry.entryType === 'gross_authorized')

  for (const event of events.filter((candidate) => candidate.result === 'quarantined')) {
    if (event.reason === 'amount_mismatch')
      add(
        'amount_mismatch',
        `provider event ${event.eventId} reported ${formatMinorUnits(event.amountMinor)}`
      )
    else if (event.reason === 'currency_mismatch')
      add('currency_mismatch', `provider event ${event.eventId} reported ${event.currency}`)
    else
      add(
        'invalid_state',
        `provider event ${event.eventId} quarantined: ${event.reason ?? 'unknown'}`
      )
  }
  if (approvedIntents.length > 1)
    add('duplicate', `${approvedIntents.length} approved payments for one obligation`)
  if (approvalEvents.length > 1)
    add('duplicate', `${approvalEvents.length} applied approval events`)
  if (grossEntries.length > 1) add('duplicate', `${grossEntries.length} gross ledger entries`)

  const paidState = ['paid', 'refunded', 'charged_back'].includes(obligation.status)
  if (paidState && approvedIntents.length === 0)
    add('invalid_state', `obligation is ${obligation.status} without an approved payment`)
  if (!paidState && approvedIntents.length > 0)
    add('invalid_state', 'approved payment on an unpaid obligation')
  if (settlement && !paidState) add('invalid_state', 'settlement exists for an unpaid obligation')

  if (approvedIntents.length > 0) {
    if (approvalEvents.length === 0) add('missing', 'no verified provider approval event')
    if (grossEntries.length === 0) add('missing', 'no gross ledger entry')
    if (!snapshot) add('missing', 'no commission snapshot')
    if (!settlement) add('missing', 'no internal settlement')
  } else if (approvalEvents.length > 0 || grossEntries.length > 0) {
    add('missing', 'provider approval or ledger entry without a local approved payment')
  }

  for (const event of approvalEvents) {
    if (event.amountMinor !== obligation.amountMinor)
      add('amount_mismatch', `approval ${event.eventId} amount differs from obligation`)
    if (event.currency !== obligation.currency)
      add('currency_mismatch', `approval ${event.eventId} currency differs from obligation`)
  }
  for (const entry of ledger) {
    if (entry.currency !== obligation.currency)
      add('currency_mismatch', `ledger ${entry.entryId} uses ${entry.currency}`)
  }
  for (const entry of grossEntries) {
    if (entry.amountMinor !== obligation.amountMinor)
      add('amount_mismatch', `ledger ${entry.entryId} gross differs from obligation`)
  }
  if (snapshot) {
    const commission = ledger.find((entry) => entry.entryType === 'commission_reserved')
    const payable = ledger.find((entry) => entry.entryType === 'merchant_payable_held')
    if (snapshot.commissionMinor + snapshot.netMinor !== snapshot.grossMinor)
      add('amount_mismatch', 'commission snapshot does not add up')
    if (commission && commission.amountMinor !== snapshot.commissionMinor)
      add('amount_mismatch', 'ledger commission differs from snapshot')
    if (payable && payable.amountMinor !== snapshot.netMinor)
      add('amount_mismatch', 'ledger payable differs from snapshot')
    if (
      settlement &&
      (settlement.grossMinor !== snapshot.grossMinor ||
        settlement.commissionMinor !== snapshot.commissionMinor ||
        settlement.netMinor !== snapshot.netMinor)
    )
      add('amount_mismatch', 'settlement differs from commission snapshot')
  }
  const refunded = ledger.some((entry) => entry.entryType === 'refund_compensation')
  if (obligation.status === 'refunded' && !refunded)
    add('missing', 'refunded obligation without compensation entry')
  if (settlement?.status === 'eligible' && obligation.status !== 'paid')
    add('invalid_state', 'eligible settlement on a non-paid obligation')

  if (findings.length > 0) return { status: 'discrepancy', findings }
  if (approvedIntents.length === 0) return { status: 'pending', findings }
  return {
    status: 'matched',
    findings: [
      { code: 'matched', detail: 'provider evidence, payment, ledger and settlement agree' },
    ],
  }
}
