import type { MarketplaceAuditRecord, MarketplaceCheckoutResponse, MarketplaceCommitment, MarketplaceListing, MarketplaceMerchantProfile, MarketplaceOutboxRecord, MarketplaceStorePort } from '../catalog/index.ts'
import type { TusPrismaClient } from './prisma.ts'

export class PrismaMarketplaceStore implements MarketplaceStorePort {
  private readonly client: TusPrismaClient

  constructor(client: TusPrismaClient) {
    this.client = client
  }

  readonly merchant = {
    save: async (profile: MarketplaceMerchantProfile) => {
      await this.client.tusMerchant.upsert({
        where: { tenantId: profile.tenantId },
        create: merchantRow(profile),
        update: merchantRow(profile),
      })
    },
    find: async (tenantId: string) => {
      const row = await this.client.tusMerchant.findUnique({ where: { tenantId } })
      return row ? toMerchant(row) : null
    },
  }

  readonly listings = {
    save: async (listing: MarketplaceListing) => {
      await this.client.tusListing.upsert({ where: { id: listing.listingId }, create: listingRow(listing), update: listingRow(listing) })
    },
    find: async (listingId: string) => {
      const row = await this.client.tusListing.findUnique({ where: { id: listingId } })
      return row ? toListing(row) : null
    },
    published: async () => (await this.client.tusListing.findMany({ where: { published: true } })).map(toListing),
    forTenant: async (tenantId: string) => (await this.client.tusListing.findMany({ where: { tenantId } })).map(toListing),
    reserveProduct: async ({ tenantId, listingId, availabilityVersion, quantity, updatedAt }: { tenantId: string; listingId: string; availabilityVersion: number; quantity: number; updatedAt: string }) => {
      const result = await this.client.tusListing.updateMany({
        where: { id: listingId, tenantId, kind: 'product', published: true, availabilityVersion, stock: { gte: quantity } },
        data: { stock: { decrement: quantity }, availabilityVersion: { increment: 1 }, updatedAt: new Date(updatedAt) },
      })
      return result.count === 1
    },
  }

  readonly commitments = {
    saveMany: async (commitments: readonly MarketplaceCommitment[]) => {
      await this.client.tusMarketplaceCommitment.createMany({ data: commitments.map(commitmentRow) })
    },
    find: async (commitmentId: string) => {
      const row = await this.client.tusMarketplaceCommitment.findUnique({ where: { commitmentId } })
      return row ? toCommitment(row) : null
    },
    forTenant: async (tenantId: string) => (await this.client.tusMarketplaceCommitment.findMany({ where: { tenantId } })).map(toCommitment),
    forListing: async (listingId: string) => (await this.client.tusMarketplaceCommitment.findMany({ where: { listingId } })).map(toCommitment),
  }

  readonly audit = {
    append: async (records: readonly MarketplaceAuditRecord[]) => {
      await this.client.tusMarketplaceAudit.createMany({ data: records.map((record) => ({ ...record, id: record.auditId })) })
    },
    list: async (tenantId: string): Promise<MarketplaceAuditRecord[]> => (await this.client.tusMarketplaceAudit.findMany({ where: { tenantId } })).map(toAudit),
  }

  readonly idempotency = {
    claim: async ({ tenantId, key, requestHash }: { tenantId: string; key: string; requestHash: string }) => {
      const existing = await this.client.idempotencyRecord.findUnique({ where: { tenantId_key: { tenantId, key } } })
      if (!existing) {
        await this.client.idempotencyRecord.create({ data: { id: `marketplace-idempotency-${tenantId}-${key}`, tenantId, key, requestHash, status: 'pending', response: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } })
        return { status: 'claimed' as const }
      }
      if (existing.requestHash !== requestHash) return { status: 'conflict' as const }
      if (existing.status === 'completed' && existing.response) return { status: 'replay' as const, response: existing.response as MarketplaceCheckoutResponse }
      return { status: 'in_progress' as const }
    },
    complete: async ({ tenantId, key, response }: { tenantId: string; key: string; response: MarketplaceCheckoutResponse }) => {
      await this.client.idempotencyRecord.update({ where: { tenantId_key: { tenantId, key } }, data: { status: 'completed', response } })
    },
    release: async ({ tenantId, key }: { tenantId: string; key: string }) => {
      await this.client.idempotencyRecord.delete({ where: { tenantId_key: { tenantId, key } } })
    },
  }

  readonly outbox = {
    append: async (record: MarketplaceOutboxRecord) => {
      await this.client.outboxEvent.create({ data: {
        id: record.eventId,
        tenantId: record.tenantId,
        aggregateType: record.aggregateType,
        aggregateId: record.aggregateId,
        eventType: record.eventType,
        payload: record.payload,
        status: 'pending',
        availableAt: new Date(record.createdAt),
        createdAt: new Date(record.createdAt),
      } })
    },
    list: async (tenantId: string): Promise<MarketplaceOutboxRecord[]> => (await this.client.outboxEvent.findMany({ where: { tenantId, eventType: { startsWith: 'tus.marketplace.' } } })).map(toOutbox),
  }

  transaction<T>(operation: (store: MarketplaceStorePort) => Promise<T>): Promise<T> {
    return this.client.$transaction(async (client) => operation(new PrismaMarketplaceStore(client)))
  }
}

function merchantRow(profile: MarketplaceMerchantProfile): Record<string, unknown> {
  return { id: profile.merchantId, tenantId: profile.tenantId, merchantId: profile.merchantId, cohort: profile.cohort, locationId: profile.locationId, timezone: profile.timezone, staffRoles: profile.staffRoles, operatingPolicyVersion: profile.operatingPolicyVersion, status: profile.status, createdAt: new Date(profile.createdAt), updatedAt: new Date(profile.updatedAt) }
}

function listingRow(listing: MarketplaceListing): Record<string, unknown> {
  return { id: listing.listingId, contractVersion: listing.contractVersion, tenantId: listing.tenantId, merchantId: listing.merchantId, kind: listing.kind, name: listing.name, description: listing.description, cohort: listing.cohort, locationId: listing.locationId, currency: listing.currency, price: listing.price, availabilityVersion: listing.availabilityVersion, published: listing.published, policyVersion: listing.policyVersion, stock: listing.stock, durationMinutes: listing.durationMinutes, capacity: listing.capacity, workingHours: listing.workingHours, createdAt: new Date(listing.createdAt), updatedAt: new Date(listing.updatedAt) }
}

function commitmentRow(commitment: MarketplaceCommitment): Record<string, unknown> {
  return { id: commitment.commitmentId, contractVersion: commitment.contractVersion, commitmentId: commitment.commitmentId, cartId: commitment.cartId, tenantId: commitment.tenantId, merchantId: commitment.merchantId, listingId: commitment.listingId, context: commitment.context, lineIds: commitment.lineIds, quantity: commitment.quantity, amount: commitment.amount, currency: commitment.currency, status: commitment.status, availabilityVersion: commitment.availabilityVersion, policyVersion: commitment.policyVersion, slotStart: commitment.slotStart ? new Date(commitment.slotStart) : null, slotEnd: commitment.slotEnd ? new Date(commitment.slotEnd) : null, createdAt: new Date(commitment.createdAt), updatedAt: new Date(commitment.createdAt) }
}

function toMerchant(row: Record<string, unknown>): MarketplaceMerchantProfile {
  return { tenantId: String(row['tenantId']), merchantId: String(row['merchantId']), cohort: row['cohort'] as MarketplaceMerchantProfile['cohort'], locationId: String(row['locationId']), timezone: String(row['timezone']), staffRoles: Array.isArray(row['staffRoles']) ? row['staffRoles'].map(String) : [], operatingPolicyVersion: String(row['operatingPolicyVersion']), status: 'approved', createdAt: new Date(String(row['createdAt'])).toISOString(), updatedAt: new Date(String(row['updatedAt'])).toISOString() }
}

function toListing(row: Record<string, unknown>): MarketplaceListing {
  return { listingId: String(row['id']), contractVersion: String(row['contractVersion']) as MarketplaceListing['contractVersion'], tenantId: String(row['tenantId']), merchantId: String(row['merchantId']), kind: row['kind'] as MarketplaceListing['kind'], name: String(row['name']), description: String(row['description']), cohort: row['cohort'] as MarketplaceListing['cohort'], locationId: String(row['locationId']), currency: String(row['currency']), price: Number(row['price']), availabilityVersion: Number(row['availabilityVersion']), published: Boolean(row['published']), policyVersion: String(row['policyVersion']), stock: row['stock'] === null ? null : Number(row['stock']), durationMinutes: row['durationMinutes'] === null ? null : Number(row['durationMinutes']), capacity: row['capacity'] === null ? null : Number(row['capacity']), workingHours: row['workingHours'] as MarketplaceListing['workingHours'], createdAt: new Date(String(row['createdAt'])).toISOString(), updatedAt: new Date(String(row['updatedAt'])).toISOString() }
}

function toCommitment(row: Record<string, unknown>): MarketplaceCommitment {
  return { contractVersion: String(row['contractVersion']) as MarketplaceCommitment['contractVersion'], commitmentId: String(row['commitmentId']), cartId: String(row['cartId']), tenantId: String(row['tenantId']), merchantId: String(row['merchantId']), context: row['context'] as MarketplaceCommitment['context'], amount: Number(row['amount']), currency: String(row['currency']), status: row['status'] as MarketplaceCommitment['status'], lineIds: Array.isArray(row['lineIds']) ? row['lineIds'].map(String) : [], version: Number(row['version'] ?? 1), createdAt: new Date(String(row['createdAt'])).toISOString(), listingId: String(row['listingId']), quantity: Number(row['quantity']), availabilityVersion: Number(row['availabilityVersion']), policyVersion: String(row['policyVersion']), ...(row['slotStart'] ? { slotStart: new Date(String(row['slotStart'])).toISOString() } : {}), ...(row['slotEnd'] ? { slotEnd: new Date(String(row['slotEnd'])).toISOString() } : {}) }
}

function toAudit(row: Record<string, unknown>): MarketplaceAuditRecord {
  return {
    auditId: String(row['id'] ?? row['auditId']),
    tenantId: String(row['tenantId']),
    actorId: String(row['actorId']),
    correlationId: String(row['correlationId']),
    action: String(row['action']),
    resourceType: row['resourceType'] as MarketplaceAuditRecord['resourceType'],
    resourceId: String(row['resourceId']),
    outcome: row['outcome'] as MarketplaceAuditRecord['outcome'],
    createdAt: toIsoString(row['createdAt']),
  }
}

function toOutbox(row: Record<string, unknown>): MarketplaceOutboxRecord {
  const payload = isRecord(row['payload']) ? row['payload'] : {}
  const auditIds = Array.isArray(payload['auditIds']) ? payload['auditIds'].map(String) : []
  const commitmentIds = Array.isArray(payload['commitmentIds']) ? payload['commitmentIds'].map(String) : undefined
  return {
    eventId: String(row['id'] ?? row['eventId']),
    tenantId: String(row['tenantId']),
    eventType: row['eventType'] as MarketplaceOutboxRecord['eventType'],
    aggregateType: row['aggregateType'] as MarketplaceOutboxRecord['aggregateType'],
    aggregateId: String(row['aggregateId']),
    correlationId: typeof payload['correlationId'] === 'string' ? payload['correlationId'] : '',
    payload: { auditIds, ...(commitmentIds === undefined ? {} : { commitmentIds }) },
    createdAt: toTimestamp(row['createdAt']),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

function toTimestamp(value: unknown): number {
  return value instanceof Date ? value.getTime() : Date.parse(String(value))
}

export default { PrismaMarketplaceStore }
