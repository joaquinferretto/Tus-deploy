const MARKETPLACE_STATUS = {
  RETRYABLE: 'retryable',
  RESTORED: 'restored',
} as const

type MarketplaceStatus = (typeof MARKETPLACE_STATUS)[keyof typeof MARKETPLACE_STATUS]

interface MarketplaceContext {
  tenantId: string
  actorId: string
  correlationId: string
}

interface MarketplaceContextOptions {
  tenantId?: string
  actorId?: string
  correlationId?: string
}

interface MarketplaceRecord {
  recordId: string
  ownerTenantId: string
  kind: 'listing'
  value: {
    title: string
    quantity: number
  }
}

interface MarketplaceSearch {
  query: string
  recordIds: string[]
}

interface MarketplaceFailure {
  status: Extract<MarketplaceStatus, 'retryable'>
  attempt: number
  duplicatePrevented: boolean
}

interface MarketplaceRollback {
  status: Extract<MarketplaceStatus, 'restored'>
  version: number
  replayableLedger: boolean
}

export interface MarketplaceFallbackFixture {
  context: MarketplaceContext
  records: MarketplaceRecord[]
  search: MarketplaceSearch
  foreignRecordVisible: boolean
  failure: MarketplaceFailure
  rollback: MarketplaceRollback
}

export function createMarketplaceFallbackFixture(
  options: MarketplaceContextOptions = {}
): MarketplaceFallbackFixture {
  const context = {
    tenantId: options.tenantId ?? 'fixture-tenant',
    actorId: options.actorId ?? 'fixture-marketplace-actor',
    correlationId: options.correlationId ?? 'fixture-marketplace-correlation',
  }
  const records = [
    {
      recordId: 'fixture-listing',
      ownerTenantId: context.tenantId,
      kind: 'listing' as const,
      value: { title: 'Portable fixture resource', quantity: 2 },
    },
  ]

  return {
    context,
    records,
    search: { query: 'portable', recordIds: records.map((record) => record.recordId) },
    foreignRecordVisible: false,
    failure: { status: MARKETPLACE_STATUS.RETRYABLE, attempt: 1, duplicatePrevented: true },
    rollback: { status: MARKETPLACE_STATUS.RESTORED, version: 1, replayableLedger: true },
  }
}

export default { createMarketplaceFallbackFixture }
