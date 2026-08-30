const SETTLEMENT_STATUS = {
  COMPENSATED: 'compensated',
  RECONCILED: 'reconciled',
} as const

type SettlementStatus = (typeof SETTLEMENT_STATUS)[keyof typeof SETTLEMENT_STATUS]

interface SettlementContext {
  tenantId: string
  actorId: string
  correlationId: string
}

interface SettlementContextOptions {
  tenantId?: string
  actorId?: string
  correlationId?: string
}

interface SettlementRecord {
  recordId: string
  ownerTenantId: string
  amount: number
  currency: string
  status: 'pending'
}

interface SettlementReconciliation {
  status: Extract<SettlementStatus, 'reconciled'>
  sourceOfTruth: 'ledger'
  duplicatePrevented: boolean
}

interface SettlementCompensation {
  status: Extract<SettlementStatus, 'compensated'>
  reason: 'provider-unavailable'
  replayable: boolean
}

export interface SettlementFallbackFixture {
  context: SettlementContext
  record: SettlementRecord
  reconciliation: SettlementReconciliation
  compensation: SettlementCompensation
  foreignRecordVisible: boolean
}

export function createSettlementFallbackFixture(
  options: SettlementContextOptions = {}
): SettlementFallbackFixture {
  const context = {
    tenantId: options.tenantId ?? 'fixture-tenant',
    actorId: options.actorId ?? 'fixture-settlement-actor',
    correlationId: options.correlationId ?? 'fixture-settlement-correlation',
  }

  return {
    context,
    record: {
      recordId: 'fixture-settlement',
      ownerTenantId: context.tenantId,
      amount: 1250,
      currency: 'ARS',
      status: 'pending',
    },
    reconciliation: {
      status: SETTLEMENT_STATUS.RECONCILED,
      sourceOfTruth: 'ledger',
      duplicatePrevented: true,
    },
    compensation: {
      status: SETTLEMENT_STATUS.COMPENSATED,
      reason: 'provider-unavailable',
      replayable: true,
    },
    foreignRecordVisible: false,
  }
}

export default { createSettlementFallbackFixture }
