import { validateSqlScope, cloneSqlValue, type TenantSqlScope } from './contracts.js'
import type { AggregateInput, AggregateResult, WindowResult } from './aggregates.js'
import type { BulkUpdateInput } from './bulk.js'
import type { FullTextInput } from './full-text.js'
import type { GeospatialInput, GeospatialResult } from './geospatial.js'
import type { AvailabilityLockInput, ReservationDecision } from './locks.js'
import { RESERVATION_STATUS } from './locks.js'
import type { HotPathInput } from './hot-paths.js'

export interface HotPathRecord {
  id: string
  tenantId: string
  resourceId: string
  category: string
  text: string
  latitude: number
  longitude: number
  amount: number
  available: number
  updatedAt: number
  status?: string
}

export interface SqlFakeOptions {
  authorizedActors: Readonly<Record<string, readonly string[]>>
}

export class InMemorySqlHotPathFake {
  private readonly records = new Map<string, HotPathRecord>()

  constructor(
    records: readonly HotPathRecord[],
    private readonly options: SqlFakeOptions
  ) {
    for (const record of records)
      this.records.set(recordKey(record.tenantId, record.id), cloneSqlValue(record))
  }

  async reserve(input: AvailabilityLockInput): Promise<ReservationDecision> {
    const scope = validateSqlScope(input.scope)
    if (!this.authorized(scope)) return { status: RESERVATION_STATUS.FORBIDDEN }
    const record = this.byResource(scope, input.resourceId)
    if (!record || record.available < input.quantity) return { status: RESERVATION_STATUS.CONFLICT }
    record.available -= input.quantity
    record.updatedAt = input.now
    return { status: RESERVATION_STATUS.RESERVED, id: record.id, remaining: record.available }
  }

  async aggregate(input: AggregateInput): Promise<AggregateResult> {
    const records = this.scoped(input.scope).filter((record) => record.category === input.category)
    return {
      category: input.category,
      totalAmount: records.reduce((total, record) => total + record.amount, 0),
      available: records.reduce((total, record) => total + record.available, 0),
      recordCount: records.length,
    }
  }

  async window(input: AggregateInput): Promise<readonly WindowResult[]> {
    return this.scoped(input.scope)
      .filter((record) => record.category === input.category)
      .sort((left, right) => right.amount - left.amount || left.id.localeCompare(right.id))
      .map((record, index) => ({
        id: record.id,
        category: record.category,
        totalAmount: record.amount,
        available: record.available,
        recordCount: 1,
        rank: index + 1,
      }))
  }

  async bulkUpdate(input: BulkUpdateInput): Promise<{ updated: number }> {
    const scope = validateSqlScope(input.scope)
    if (!this.authorized(scope)) return { updated: 0 }
    const ids = new Set(input.ids)
    let updated = 0
    for (const record of this.scoped(scope)) {
      if (!ids.has(record.id)) continue
      record.status = input.status
      record.updatedAt = input.now
      updated += 1
    }
    return { updated }
  }

  async fullText(input: FullTextInput): Promise<readonly HotPathRecord[]> {
    const needle = input.search.trim().toLocaleLowerCase()
    return this.scoped(input.scope)
      .filter((record) => record.text.toLocaleLowerCase().includes(needle))
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, input.limit ?? 20)
      .map(cloneSqlValue)
  }

  async nearby(input: GeospatialInput): Promise<readonly GeospatialResult[]> {
    return this.scoped(input.scope)
      .map((record) => ({
        ...cloneSqlValue(record),
        distanceKm: distanceKm(input.latitude, input.longitude, record.latitude, record.longitude),
      }))
      .filter((record) => record.distanceKm <= input.radiusKm)
      .sort((left, right) => left.distanceKm - right.distanceKm || left.id.localeCompare(right.id))
  }

  async hotPath(input: HotPathInput): Promise<HotPathRecord | null> {
    const scope = validateSqlScope(input.scope)
    if (!this.authorized(scope)) return null
    const record = this.records.get(recordKey(scope.tenantId, input.resourceId))
    return record ? cloneSqlValue(record) : null
  }

  private scoped(scopeInput: TenantSqlScope): HotPathRecord[] {
    const scope = validateSqlScope(scopeInput)
    if (!this.authorized(scope)) return []
    return [...this.records.values()].filter((record) => record.tenantId === scope.tenantId)
  }

  private byResource(scope: TenantSqlScope, resourceId: string): HotPathRecord | undefined {
    return this.scoped(scope).find((record) => record.resourceId === resourceId)
  }

  private authorized(scope: TenantSqlScope): boolean {
    const actors = this.options.authorizedActors[scope.tenantId]
    return actors?.includes(scope.actorId) ?? false
  }
}

function recordKey(tenantId: string, id: string): string {
  return `${tenantId}:${id}`
}

function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const earthRadiusKm = 6371
  const latitudeDelta = toRadians(latitudeB - latitudeA)
  const longitudeDelta = toRadians(longitudeB - longitudeA)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

export default { InMemorySqlHotPathFake }
