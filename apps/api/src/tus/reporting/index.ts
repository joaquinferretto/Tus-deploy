import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { TusOperationsTelemetry } from '@factory/observability'

const REPORT_STATUS = {
  COMPLETE: 'complete',
} as const

const DEFAULT_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000

export interface OperationsRecord {
  tenantId: string
  context: 'product' | 'service'
  channel: string
  geography: string
  outcome: string
  amount: number
  currency: string
  ledgerStatus: string
  whatsappActions: number
  disputes: number
  posOffline: number
  createdAt?: string
}

export interface OperationsReport {
  tenantId: string
  from: string
  to: string
  currency: string
  sourceVersion: 'tus-operations-v1'
  generatedAt: string
  status: typeof REPORT_STATUS.COMPLETE
  freshness: {
    latestRecordAt: string | null
    oldestRecordAt: string | null
    stale: boolean
  }
  dimensions: {
    supply: number
    demand: number
    conversion: number
    fulfillment: number
    payment: number
    settlementAging: number
    disputes: number
    posOffline: number
    whatsappActions: number
    readiness: number
  }
}

export class ReportingError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ReportingError'
    this.status = status
    this.code = code
  }
}

export class InMemoryReportingStore {
  private readonly records: OperationsRecord[] = []

  add(input: OperationsRecord): void {
    this.records.push({ ...input })
  }

  list(tenantId: string): OperationsRecord[] {
    return this.records.filter((record) => record.tenantId === tenantId).map((record) => ({ ...record }))
  }
}

export interface ReportingStorePort {
  list(tenantId: string): OperationsRecord[] | Promise<OperationsRecord[]>
}

interface PrismaReportingClient {
  registroOperaciones: {
    findMany(input: { where: { tenantId: string } }): Promise<Record<string, unknown>[]>
  }
}

export class PrismaReportingStore implements ReportingStorePort {
  private readonly client: PrismaReportingClient

  constructor(client: PrismaReportingClient) {
    this.client = client
  }

  async list(tenantId: string): Promise<OperationsRecord[]> {
    const rows = await this.client.registroOperaciones.findMany({ where: { tenantId } })
    return rows.map((row) => ({
      tenantId: String(row['tenantId']), context: row['contexto'] as OperationsRecord['context'], channel: String(row['canal']), geography: String(row['geografia']), outcome: String(row['resultado']), amount: Number(row['monto']), currency: String(row['moneda']), ledgerStatus: String(row['estadoContable']), whatsappActions: Number(row['accionesWhatsApp']), disputes: Number(row['disputas']), posOffline: Number(row['posFueraLinea']), createdAt: new Date(String(row['fechaCreacion'])).toISOString(),
    }))
  }
}

export interface TusReportingServiceOptions {
  store: ReportingStorePort
  now?: () => number
  telemetry?: TusOperationsTelemetry
}

export class TusReportingService {
  readonly store: ReportingStorePort
  private readonly now: () => number
  private readonly telemetry?: TusOperationsTelemetry
  private readonly sessions = new Map<string, string>()

  constructor(options: TusReportingServiceOptions) {
    this.store = options.store
    this.now = options.now ?? (() => Date.now())
    this.telemetry = options.telemetry
  }

  async operations(input: TusAuthenticatedTenantContext & { from?: string; to?: string }): Promise<OperationsReport> {
    this.authorize(input)
    const from = input.from ?? new Date(0).toISOString()
    const to = input.to ?? new Date(this.now()).toISOString()
    const fromMs = parseTimestamp(from, 'from')
    const toMs = parseTimestamp(to, 'to')
    if (fromMs > toMs) throw new ReportingError(400, 'INVALID_PERIOD', 'report period is inverted')
    const records = (await this.store.list(input.tenantId)).filter((record) => {
      if (!record.createdAt) return true
      const timestamp = Date.parse(record.createdAt)
      return Number.isFinite(timestamp) && timestamp >= fromMs && timestamp <= toMs
    })
    const currency = records[0]?.currency ?? 'ARS'
    const supply = new Set(records.map((record) => `${record.tenantId}:${record.context}:${record.geography}`)).size
    const demand = records.length
    const fulfilled = records.filter((record) => record.outcome === 'fulfilled').length
    const createdAtValues = records.map((record) => record.createdAt).filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
    const sortedCreatedAt = [...createdAtValues].sort()
    const freshness = {
      latestRecordAt: sortedCreatedAt.at(-1) ?? null,
      oldestRecordAt: sortedCreatedAt[0] ?? null,
      stale: sortedCreatedAt.length > 0 && toTimestamp(sortedCreatedAt.at(-1) as string) < this.now() - DEFAULT_FRESHNESS_WINDOW_MS,
    }
    const report: OperationsReport = {
      tenantId: input.tenantId,
      from,
      to,
      currency,
      sourceVersion: 'tus-operations-v1',
      generatedAt: new Date(this.now()).toISOString(),
      status: REPORT_STATUS.COMPLETE,
      freshness,
      dimensions: {
        supply,
        demand,
        conversion: demand === 0 ? 0 : fulfilled / demand,
        fulfillment: fulfilled,
        payment: records.filter((record) => record.ledgerStatus !== 'pending').length,
        settlementAging: records.filter((record) => record.ledgerStatus === 'pending').length,
        disputes: records.reduce((total, record) => total + record.disputes, 0),
        posOffline: records.reduce((total, record) => total + record.posOffline, 0),
        whatsappActions: records.reduce((total, record) => total + record.whatsappActions, 0),
        readiness: records.filter((record) => record.ledgerStatus !== 'frozen').length,
      },
    }
    this.telemetry?.record({
      name: 'tus.reporting.operations',
      outcome: 'success',
      correlationId: input.correlationId,
      tenantId: input.tenantId,
      actorId: input.subjectId,
      latencyMs: 0,
      attributes: { records: demand, stale: freshness.stale },
    })
    return report
  }

  private authorize(input: TusAuthenticatedTenantContext): void {
    if (!input.sessionId.trim() || !input.subjectId.trim() || !input.tenantId.trim() || !input.correlationId.trim() || (!input.permissions.includes('tus:reporting:read') && !input.permissions.includes('tus:*'))) {
      throw new ReportingError(403, 'FORBIDDEN', 'TUS reporting access is not authorized')
    }
    const knownTenant = this.sessions.get(input.sessionId)
    if (knownTenant && knownTenant !== input.tenantId) throw new ReportingError(403, 'FORBIDDEN', 'report tenant is outside the authenticated session')
    this.sessions.set(input.sessionId, input.tenantId)
  }
}

export interface DiscoverySeoInput {
  listingId: string
  tenantId: string
  slug: string
  name: string
  description: string
  currency: string
  price: number
  location: string
  availability: string
  published: boolean
  cohortApproved: boolean
  policyCurrent: boolean
  locale?: string
  revoked?: boolean
  discoverable?: boolean
  updatedAt?: string
  canonicalBaseUrl?: string
  now?: string
  freshnessWindowMs?: number
}

export interface DiscoverySeoModel {
  listingId: string
  tenantId: string
  slug: string
  published: boolean
  cohortApproved: boolean
  policyCurrent: boolean
  locale: string
  revoked: boolean
  discoverable: boolean
  updatedAt: string
  canonicalBaseUrl: string
  indexable: boolean
  canonicalUrl: string | null
  structuredData: Record<string, string | number | boolean | Record<string, string>> | null
}

export function createDiscoverySeoModel(input: DiscoverySeoInput): DiscoverySeoModel {
  const now = Date.parse(input.now ?? new Date().toISOString())
  const updatedAtValue = input.updatedAt ?? input.now ?? new Date().toISOString()
  const updatedAt = Date.parse(updatedAtValue)
  const fresh = Number.isFinite(now) && Number.isFinite(updatedAt) && updatedAt <= now && now - updatedAt <= (input.freshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS)
  const revoked = input.revoked ?? false
  const discoverable = input.discoverable ?? true
  const locale = input.locale ?? 'es-AR'
  const indexable = input.published && input.cohortApproved && input.policyCurrent && !revoked && discoverable && fresh
  const canonicalBaseUrl = input.canonicalBaseUrl ?? 'https://tusservicios.com'
  const baseUrl = canonicalBaseUrl.replace(/\/$/, '')
  const canonicalUrl = indexable ? `${baseUrl}/tus/listing/${encodeURIComponent(input.slug)}` : null
  return {
    listingId: input.listingId,
    tenantId: input.tenantId,
    slug: input.slug,
    published: input.published,
    cohortApproved: input.cohortApproved,
    policyCurrent: input.policyCurrent,
    locale,
    revoked,
    discoverable,
    updatedAt: updatedAtValue,
    canonicalBaseUrl,
    indexable,
    canonicalUrl,
    structuredData: indexable ? {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: input.name,
      description: input.description,
      price: input.price,
      priceCurrency: input.currency,
      inLanguage: locale,
      availability: input.availability,
      location: { name: input.location },
    } : null,
  }
}

export function createSitemap(models: readonly DiscoverySeoModel[]): string[] {
  return models.filter((model) => model.indexable && model.canonicalUrl).map((model) => model.canonicalUrl as string)
}

export function createRobots(): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /tus/listing/'].join('\n')
}

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new ReportingError(400, 'INVALID_PERIOD', `${field} must be an ISO timestamp`)
  return timestamp
}

function toTimestamp(value: string): number {
  return Date.parse(value)
}

export default {
  TusReportingService,
  InMemoryReportingStore,
  PrismaReportingStore,
  ReportingError,
  createDiscoverySeoModel,
  createSitemap,
  createRobots,
}
