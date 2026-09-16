import { randomUUID } from 'node:crypto'
import type { Compromiso, TusContractVersion } from '@factory/contracts'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../readiness/index.ts'

export const MARKETPLACE_COHORTS = ['beauty-personal-care', 'repairs-trades'] as const
export type Cohorte = (typeof MARKETPLACE_COHORTS)[number]
export const MARKETPLACE_LISTING_KINDS = { PRODUCT: 'product', SERVICE: 'service' } as const
export type TipoPublicacion = (typeof MARKETPLACE_LISTING_KINDS)[keyof typeof MARKETPLACE_LISTING_KINDS]
export const MARKETPLACE_BOOKING_MODES = { FIXED_SHIFT: 'fixed_shift', VARIABLE_DURATION: 'variable_duration' } as const
export type MarketplaceBookingMode = (typeof MARKETPLACE_BOOKING_MODES)[keyof typeof MARKETPLACE_BOOKING_MODES]
export const MARKETPLACE_PRICE_MODES = { FIXED: 'fixed', REQUIRES_BUDGET: 'requires_budget' } as const
export type MarketplacePriceMode = (typeof MARKETPLACE_PRICE_MODES)[keyof typeof MARKETPLACE_PRICE_MODES]
export type MarketplaceAvailabilityStatus = 'configured' | 'not_configured'
export const MARKETPLACE_MERCHANT_STATUSES = { APPROVED: 'approved' } as const
export type MarketplaceMerchantStatus = (typeof MARKETPLACE_MERCHANT_STATUSES)[keyof typeof MARKETPLACE_MERCHANT_STATUSES]
export const MARKETPLACE_OUTBOX_EVENT_TYPES = {
  MERCHANT_ONBOARDED: 'tus.marketplace.merchant.onboarded',
  LISTING_CREATED: 'tus.marketplace.listing.created',
  LISTING_PUBLISHED: 'tus.marketplace.listing.published',
  COMMITMENTS_CREATED: 'tus.marketplace.commitments.created',
} as const
export type MarketplaceOutboxEventType = (typeof MARKETPLACE_OUTBOX_EVENT_TYPES)[keyof typeof MARKETPLACE_OUTBOX_EVENT_TYPES]

export interface PerfilPrestador {
  tenantId: string
  merchantId: string
  cohort: Cohorte
  locationId: string
  timezone: string
  staffRoles: string[]
  operatingPolicyVersion: string
  status: MarketplaceMerchantStatus
  createdAt: string
  updatedAt: string
}

export interface MarketplacePolicy {
  allowedCohorts?: readonly Cohorte[]
  evaluadorHabilitacion?: EvaluadorHabilitacion
  perfilHabilitacion?: PerfilHabilitacion
  alcanceHabilitacion?: string
  calendarResolver?: MarketplaceCalendarResolver
}

export interface MarketplaceCalendarResolver {
  findPrimaryCalendar(tenantId: string, prestadorId: string): Promise<{ calendarId: string; status: 'active' | 'inactive' } | null>
}

export interface MarketplaceWorkingHours {
  day: number
  start: string
  end: string
}

export interface Publicacion {
  contractVersion: typeof TUS_CONTRACT_VERSION
  listingId: string
  tenantId: string
  merchantId: string
  kind: TipoPublicacion
  name: string
  description: string
  cohort: Cohorte
  locationId: string
  currency: string
  price: number
  priceMinor: bigint
  priceSnapshot: MarketplaceMoneySnapshot
  availabilityVersion: number
  published: boolean
  policyVersion: string
  stock: number | null
  durationMinutes: number | null
  capacity: number | null
  workingHours: MarketplaceWorkingHours[]
  bookingMode?: MarketplaceBookingMode
  estimatedDurationMinutes?: number | null
  priceMode?: MarketplacePriceMode
  createdAt: string
  updatedAt: string
}

export interface ItemDescubrimiento {
  contractVersion: typeof TUS_CONTRACT_VERSION
  listingId: string
  tenantId: string
  merchantId: string
  kind: TipoPublicacion
  name: string
  description: string
  cohort: Cohorte
  locationId: string
  currency: string
  price: number
  priceMinor: bigint
  priceSnapshot: MarketplaceMoneySnapshot
  availabilityVersion: number
  policyVersion: string
  published: boolean
  availableQuantity?: number
  durationMinutes?: number
  capacity?: number
  workingHours?: MarketplaceWorkingHours[]
  timezone: string
  calendarId?: string
  bookingMode?: MarketplaceBookingMode
  estimatedDurationMinutes?: number
  priceMode?: MarketplacePriceMode
  availabilityStatus?: MarketplaceAvailabilityStatus
}

export interface EntradaPublicacion {
  merchantId: string
  kind: TipoPublicacion
  name: string
  description: string
  cohort: Cohorte
  locationId: string
  currency: string
  price: number
  priceMinor?: bigint
  stock?: number
  durationMinutes?: number
  capacity?: number
  workingHours?: MarketplaceWorkingHours[]
  bookingMode?: MarketplaceBookingMode
  estimatedDurationMinutes?: number
  priceMode?: MarketplacePriceMode
}

export interface MarketplaceCheckoutLine {
  lineId: string
  listingId: string
  context: TipoPublicacion
  quantity: number
  availabilityVersion: number
  price?: number
  slotStart?: string
  slotEnd?: string
}

export interface MarketplaceCheckoutCommand {
  tenantId: string
  actorId: string
  correlationId: string
  idempotencyKey: string
  cartId: string
  requestHash: string
  createdAt: string
  lines: MarketplaceCheckoutLine[]
}

export type MarketplaceCommitment = Compromiso & {
  contractVersion: TusContractVersion
  listingId: string
  quantity: number
  availabilityVersion: number
  policyVersion: string
  slotStart?: string
  slotEnd?: string
  priceSnapshot: MarketplaceMoneySnapshot
}

export interface MarketplaceMoneySnapshot {
  currency: string
  minor: bigint
}

export interface RegistroAuditoriaMercadoServicios {
  auditId: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  resourceType: 'merchant' | 'listing' | 'commitment' | 'authorization'
  resourceId: string
  outcome: 'allowed' | 'denied'
  createdAt: string
}

export interface MarketplaceCheckoutResponse {
  contractVersion: typeof TUS_CONTRACT_VERSION
  commitments: MarketplaceCommitment[]
  audits: RegistroAuditoriaMercadoServicios[]
}

export interface MarketplaceOutboxRecord {
  eventId: string
  tenantId: string
  eventType: MarketplaceOutboxEventType
  aggregateType: 'merchant' | 'listing' | 'commitment'
  aggregateId: string
  correlationId: string
    payload: {
    correlationId?: string
    commitmentIds?: string[]
    auditIds: string[]
  }
  createdAt: number
}

export interface MarketplaceStorePort {
  merchant: {
    save(profile: PerfilPrestador): Promise<void>
    find(tenantId: string): Promise<PerfilPrestador | null>
  }
  listings: {
    save(listing: Publicacion): Promise<void>
    find(listingId: string): Promise<Publicacion | null>
    published(): Promise<Publicacion[]>
    forTenant(tenantId: string): Promise<Publicacion[]>
    reserveProduct(input: { tenantId: string; listingId: string; availabilityVersion: number; quantity: number; updatedAt: string }): Promise<boolean>
  }
  commitments: {
    saveMany(commitments: readonly MarketplaceCommitment[]): Promise<void>
    find(commitmentId: string): Promise<MarketplaceCommitment | null>
    forTenant(tenantId: string): Promise<MarketplaceCommitment[]>
    forListing(listingId: string): Promise<MarketplaceCommitment[]>
  }
  audit: {
    append(records: readonly RegistroAuditoriaMercadoServicios[]): Promise<void>
    list(tenantId: string): RegistroAuditoriaMercadoServicios[] | Promise<RegistroAuditoriaMercadoServicios[]>
  }
  idempotency: {
    claim(input: { tenantId: string; key: string; requestHash: string }): Promise<{ status: 'claimed' | 'replay' | 'in_progress' | 'conflict'; response?: MarketplaceCheckoutResponse }>
    complete(input: { tenantId: string; key: string; response: MarketplaceCheckoutResponse }): Promise<void>
    release(input: { tenantId: string; key: string }): Promise<void>
  }
  outbox: {
    append(record: MarketplaceOutboxRecord): Promise<void>
    list(tenantId: string): MarketplaceOutboxRecord[] | Promise<MarketplaceOutboxRecord[]>
  }
  transaction<T>(operation: (store: MarketplaceStorePort) => Promise<T>): Promise<T>
}

export class MarketplaceError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'MarketplaceError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class InMemoryMarketplaceStore implements MarketplaceStorePort {
  private readonly merchantRecords = new Map<string, PerfilPrestador>()
  private readonly listingRecords = new Map<string, Publicacion>()
  private readonly commitmentRecords = new Map<string, MarketplaceCommitment>()
  private readonly audits = new Map<string, RegistroAuditoriaMercadoServicios>()
  private readonly outboxRecords = new Map<string, MarketplaceOutboxRecord>()
  private readonly idempotencyRecords = new Map<string, { requestHash: string; response?: MarketplaceCheckoutResponse }>()
  private transactionTail: Promise<void> = Promise.resolve()

  readonly merchant = {
    save: async (profile: PerfilPrestador) => { this.merchantRecords.set(profile.tenantId, structuredClone(profile)) },
    find: async (tenantId: string) => this.merchantRecords.has(tenantId) ? structuredClone(this.merchantRecords.get(tenantId)!) : null,
  }

  readonly listings = {
    save: async (listing: Publicacion) => { this.listingRecords.set(listing.listingId, structuredClone(listing)) },
    find: async (listingId: string) => this.listingRecords.has(listingId) ? structuredClone(this.listingRecords.get(listingId)!) : null,
    published: async () => [...this.listingRecords.values()].filter((listing) => listing.published).map((listing) => structuredClone(listing)),
    forTenant: async (tenantId: string) => [...this.listingRecords.values()].filter((listing) => listing.tenantId === tenantId).map((listing) => structuredClone(listing)),
    reserveProduct: async ({ tenantId, listingId, availabilityVersion, quantity, updatedAt }: { tenantId: string; listingId: string; availabilityVersion: number; quantity: number; updatedAt: string }) => {
      const listing = this.listingRecords.get(listingId)
      if (!listing || listing.tenantId !== tenantId || !listing.published || listing.kind !== MARKETPLACE_LISTING_KINDS.PRODUCT || listing.availabilityVersion !== availabilityVersion || (listing.stock ?? 0) < quantity) return false
      this.listingRecords.set(listingId, { ...listing, stock: (listing.stock ?? 0) - quantity, availabilityVersion: availabilityVersion + 1, updatedAt })
      return true
    },
  }

  readonly commitments = {
    saveMany: async (commitments: readonly MarketplaceCommitment[]) => commitments.forEach((commitment) => this.commitmentRecords.set(commitment.commitmentId, structuredClone(commitment))),
    find: async (commitmentId: string) => this.commitmentRecords.has(commitmentId) ? structuredClone(this.commitmentRecords.get(commitmentId)!) : null,
    forTenant: async (tenantId: string) => [...this.commitmentRecords.values()].filter((commitment) => commitment.tenantId === tenantId).map((commitment) => structuredClone(commitment)),
    forListing: async (listingId: string) => [...this.commitmentRecords.values()].filter((commitment) => commitment.listingId === listingId).map((commitment) => structuredClone(commitment)),
  }

  readonly audit = {
    append: async (records: readonly RegistroAuditoriaMercadoServicios[]) => records.forEach((record) => this.audits.set(record.auditId, structuredClone(record))),
    list: (tenantId: string) => [...this.audits.values()].filter((record) => record.tenantId === tenantId).map((record) => structuredClone(record)),
  }

  readonly idempotency = {
    claim: async ({ tenantId, key, requestHash }: { tenantId: string; key: string; requestHash: string }) => {
      const record = this.idempotencyRecords.get(`${tenantId}:${key}`)
      if (!record) {
        this.idempotencyRecords.set(`${tenantId}:${key}`, { requestHash })
        return { status: 'claimed' as const }
      }
      if (record.requestHash !== requestHash) return { status: 'conflict' as const }
      return record.response ? { status: 'replay' as const, response: structuredClone(record.response) } : { status: 'in_progress' as const }
    },
    complete: async ({ tenantId, key, response }: { tenantId: string; key: string; response: MarketplaceCheckoutResponse }) => {
      const record = this.idempotencyRecords.get(`${tenantId}:${key}`)
      if (!record) throw new Error('marketplace idempotency record not found')
      record.response = structuredClone(response)
    },
      release: async ({ tenantId, key }: { tenantId: string; key: string }) => { this.idempotencyRecords.delete(`${tenantId}:${key}`) },
  }

  readonly outbox = {
    append: async (record: MarketplaceOutboxRecord) => {
      const key = `${record.tenantId}:${record.eventId}`
      if (!this.outboxRecords.has(key)) this.outboxRecords.set(key, structuredClone(record))
    },
    list: (tenantId: string) => [...this.outboxRecords.values()]
      .filter((record) => record.tenantId === tenantId)
      .map((record) => structuredClone(record)),
  }

  async transaction<T>(operation: (store: MarketplaceStorePort) => Promise<T>): Promise<T> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    const snapshot = this.snapshot()
    try {
      return await operation(this)
    } catch (error) {
      this.restore(snapshot)
      throw error
    } finally {
      release()
    }
  }

  private snapshot() {
    return {
      merchants: new Map([...this.merchantRecords].map(([key, value]) => [key, structuredClone(value)])),
      listings: new Map([...this.listingRecords].map(([key, value]) => [key, structuredClone(value)])),
      commitments: new Map([...this.commitmentRecords].map(([key, value]) => [key, structuredClone(value)])),
      audits: new Map([...this.audits].map(([key, value]) => [key, structuredClone(value)])),
      outbox: new Map([...this.outboxRecords].map(([key, value]) => [key, structuredClone(value)])),
      idempotency: new Map([...this.idempotencyRecords].map(([key, value]) => [key, structuredClone(value)])),
    }
  }

  private restore(snapshot: ReturnType<InMemoryMarketplaceStore['snapshot']>): void {
    this.merchantRecords.clear()
    this.listingRecords.clear()
    this.commitmentRecords.clear()
    this.audits.clear()
    this.outboxRecords.clear()
    this.idempotencyRecords.clear()
    for (const [key, value] of snapshot.merchants) this.merchantRecords.set(key, value)
    for (const [key, value] of snapshot.listings) this.listingRecords.set(key, value)
    for (const [key, value] of snapshot.commitments) this.commitmentRecords.set(key, value)
    for (const [key, value] of snapshot.audits) this.audits.set(key, value)
    for (const [key, value] of snapshot.outbox) this.outboxRecords.set(key, value)
    for (const [key, value] of snapshot.idempotency) this.idempotencyRecords.set(key, value)
  }
}

export class TusMarketplaceService {
  readonly store: MarketplaceStorePort
  readonly audit: MarketplaceStorePort['audit']

  private readonly allowedCohorts: readonly Cohorte[]
  private readonly evaluadorHabilitacion?: EvaluadorHabilitacion
  private readonly perfilHabilitacion: PerfilHabilitacion
  private readonly alcanceHabilitacion: string
  private readonly calendarResolver?: MarketplaceCalendarResolver

  constructor(store: MarketplaceStorePort, policy: MarketplacePolicy = {}) {
    this.store = store
    this.audit = store.audit
    this.allowedCohorts = policy.allowedCohorts ?? MARKETPLACE_COHORTS
    this.evaluadorHabilitacion = policy.evaluadorHabilitacion
    this.perfilHabilitacion = policy.perfilHabilitacion ?? 'native-local'
    this.alcanceHabilitacion = policy.alcanceHabilitacion ?? 'argentina-stage-1'
    this.calendarResolver = policy.calendarResolver
  }

  async onboard(context: TusAuthenticatedTenantContext, input: Partial<PerfilPrestador>): Promise<PerfilPrestador> {
    assertPermission(context, 'tus:marketplace:write')
    assertMerchantRole(context)
    await this.requerirHabilitacion(context, 'publication')
    if (input.tenantId !== undefined && input.tenantId !== context.tenantId) throw new MarketplaceError(403, 'FORBIDDEN', 'merchant tenant does not match authenticated session')
    const cohort = input.cohort
    if (!esCohorteMercado(cohort) || !this.allowedCohorts.includes(cohort)) throw new MarketplaceError(400, 'COHORT_NOT_SUPPORTED', 'merchant cohort is outside Stage 1')
    const required = [input.merchantId, input.locationId, input.timezone, input.operatingPolicyVersion]
    if (required.some((value) => typeof value !== 'string' || !value.trim()) || !Array.isArray(input.staffRoles) || input.staffRoles.length === 0) {
      throw new MarketplaceError(400, 'INCOMPLETE_MERCHANT', 'location, timezone, staff roles, and operating policy are required')
    }
    const now = new Date().toISOString()
    const profile: PerfilPrestador = {
      tenantId: context.tenantId,
      merchantId: input.merchantId!,
      cohort,
      locationId: input.locationId!,
      timezone: input.timezone!,
      staffRoles: [...input.staffRoles!],
      operatingPolicyVersion: input.operatingPolicyVersion!,
      status: MARKETPLACE_MERCHANT_STATUSES.APPROVED,
      createdAt: now,
      updatedAt: now,
    }
    return this.store.transaction(async (store) => {
      await store.merchant.save(profile)
      const audit = crearAuditoriaMercadoServicios({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, createdAt: now }, 'merchant.onboarded', 'merchant', profile.merchantId, 'allowed')
      await store.audit.append([audit])
      await store.outbox.append(createOutbox({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, createdAt: now }, MARKETPLACE_OUTBOX_EVENT_TYPES.MERCHANT_ONBOARDED, 'merchant', profile.merchantId, [audit.auditId]))
      return profile
    })
  }

  async createListing(context: TusAuthenticatedTenantContext, input: EntradaPublicacion): Promise<Publicacion> {
    assertPermission(context, 'tus:marketplace:write')
    assertMerchantRole(context)
    await this.requerirHabilitacion(context, 'publication')
    const merchant = await this.store.merchant.find(context.tenantId)
    if (!merchant || merchant.status !== 'approved') throw new MarketplaceError(409, 'MERCHANT_NOT_READY', 'merchant onboarding is incomplete')
    if (input.merchantId !== merchant.merchantId) throw new MarketplaceError(403, 'FORBIDDEN', 'listing merchant is outside the authenticated tenant')
    validateListingInput(input, merchant)
    const bookingMode = input.kind === 'service' ? resolveBookingMode(input) : undefined
    const now = new Date().toISOString()
    const listing: Publicacion = {
      contractVersion: TUS_CONTRACT_VERSION,
      listingId: randomUUID(),
      tenantId: context.tenantId,
      merchantId: input.merchantId,
      kind: input.kind,
      name: input.name.trim(),
      description: input.description.trim(),
      cohort: input.cohort,
      locationId: input.locationId,
      currency: input.currency.trim().toUpperCase(),
      price: input.price,
      priceMinor: normalizeMoney(input.currency, input.price, input.priceMinor).minor,
      priceSnapshot: normalizeMoney(input.currency, input.price, input.priceMinor),
      availabilityVersion: 1,
      published: false,
      policyVersion: merchant.operatingPolicyVersion,
      stock: input.kind === 'product' ? input.stock! : null,
      durationMinutes: input.kind === 'service' && bookingMode === MARKETPLACE_BOOKING_MODES.FIXED_SHIFT ? input.durationMinutes! : null,
      capacity: input.kind === 'service' ? input.capacity! : null,
      workingHours: input.kind === 'service' ? [...(input.workingHours ?? [])] : [],
      ...(bookingMode === undefined ? {} : { bookingMode }),
      ...(input.kind === 'service' ? { estimatedDurationMinutes: bookingMode === MARKETPLACE_BOOKING_MODES.VARIABLE_DURATION ? input.estimatedDurationMinutes! : null, priceMode: input.priceMode ?? MARKETPLACE_PRICE_MODES.FIXED } : {}),
      createdAt: now,
      updatedAt: now,
    }
    return this.store.transaction(async (store) => {
      await store.listings.save(listing)
      const audit = crearAuditoriaMercadoServicios({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, createdAt: now }, 'listing.created', 'listing', listing.listingId, 'allowed')
      await store.audit.append([audit])
      await store.outbox.append(createOutbox({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, createdAt: now }, MARKETPLACE_OUTBOX_EVENT_TYPES.LISTING_CREATED, 'listing', listing.listingId, [audit.auditId]))
      return listing
    })
  }

  async publishListing(context: TusAuthenticatedTenantContext, listingId: string): Promise<Publicacion> {
    assertPermission(context, 'tus:marketplace:write')
    assertMerchantRole(context)
    await this.requerirHabilitacion(context, 'publication')
    const listing = await this.store.listings.find(listingId)
    if (!listing || listing.tenantId !== context.tenantId) throw new MarketplaceError(403, 'FORBIDDEN', 'listing is outside the authenticated tenant')
    const merchant = await this.store.merchant.find(context.tenantId)
    if (!merchant || merchant.status !== 'approved' || merchant.locationId !== listing.locationId || merchant.cohort !== listing.cohort) throw new MarketplaceError(409, 'PUBLICATION_INELIGIBLE', 'merchant and listing facts are not publication eligible')
    if (listing.kind === 'product' && (listing.stock ?? 0) < 0) throw new MarketplaceError(400, 'INVALID_LISTING', 'product stock cannot be negative')
    if (listing.kind === 'service') validatePublishedService(listing)
    const published = { ...listing, contractVersion: TUS_CONTRACT_VERSION, published: true, updatedAt: new Date().toISOString() }
    return this.store.transaction(async (store) => {
      await store.listings.save(published)
      const audit = crearAuditoriaMercadoServicios({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, createdAt: published.updatedAt }, 'listing.published', 'listing', listingId, 'allowed')
      await store.audit.append([audit])
      await store.outbox.append(createOutbox({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, createdAt: published.updatedAt }, MARKETPLACE_OUTBOX_EVENT_TYPES.LISTING_PUBLISHED, 'listing', listingId, [audit.auditId]))
      return published
    })
  }

  async discover(filters: { locationId?: string; cohort?: Cohorte } = {}): Promise<{ contractVersion: typeof TUS_CONTRACT_VERSION; items: ItemDescubrimiento[]; evidence: 'local-deterministic' }> {
    const listings = await this.store.listings.published()
    const items = await Promise.all(listings.map(async (listing) => {
      const merchant = await this.store.merchant.find(listing.tenantId)
      if (!merchant || merchant.status !== MARKETPLACE_MERCHANT_STATUSES.APPROVED || merchant.cohort !== listing.cohort || merchant.operatingPolicyVersion !== listing.policyVersion) return null
      if (merchant.merchantId !== listing.merchantId) return null
      if (listing.kind === 'product' && (listing.stock ?? 0) <= 0) return null
      if (filters.locationId !== undefined && filters.locationId !== listing.locationId) return null
      if (filters.cohort !== undefined && filters.cohort !== listing.cohort) return null
      if (listing.kind === 'service') validatePublishedService(listing)
      const calendar = listing.kind === 'service' ? await this.calendarResolver?.findPrimaryCalendar(listing.tenantId, listing.merchantId) : null
      const availabilityStatus: MarketplaceAvailabilityStatus = calendar?.status === 'active' ? 'configured' : 'not_configured'
      return {
        contractVersion: TUS_CONTRACT_VERSION,
        listingId: listing.listingId,
        tenantId: listing.tenantId,
        merchantId: listing.merchantId,
        kind: listing.kind,
        name: listing.name,
        description: listing.description,
        cohort: listing.cohort,
        locationId: listing.locationId,
        currency: listing.currency,
        price: listing.price,
        priceMinor: listing.priceMinor,
        priceSnapshot: structuredClone(listing.priceSnapshot),
        availabilityVersion: listing.availabilityVersion,
        policyVersion: listing.policyVersion,
        published: listing.published,
        ...(listing.kind === 'product' ? { availableQuantity: Math.max(0, listing.stock ?? 0) } : {}),
        ...(listing.kind === 'service' ? {
          ...(listing.durationMinutes === null ? {} : { durationMinutes: listing.durationMinutes }),
          capacity: listing.capacity!,
          workingHours: [...listing.workingHours],
          bookingMode: resolvedListingBookingMode(listing),
          ...(listing.estimatedDurationMinutes === null || listing.estimatedDurationMinutes === undefined ? {} : { estimatedDurationMinutes: listing.estimatedDurationMinutes }),
          priceMode: listing.priceMode ?? MARKETPLACE_PRICE_MODES.FIXED,
          availabilityStatus,
          ...(availabilityStatus === 'configured' && calendar ? { calendarId: calendar.calendarId } : {}),
        } : {}),
        timezone: merchant.timezone,
      }
    }))
    return { contractVersion: TUS_CONTRACT_VERSION, items: items.filter((item): item is ItemDescubrimiento => item !== null), evidence: 'local-deterministic' }
  }

  async findPublishedService(listingId: string): Promise<Publicacion | null> {
    const listing = await this.store.listings.find(listingId)
    return listing && listing.published && listing.kind === MARKETPLACE_LISTING_KINDS.SERVICE ? listing : null
  }

  async merchantOperations(context: TusAuthenticatedTenantContext): Promise<{ merchant: PerfilPrestador | null; listings: Publicacion[] }> {
    assertPermission(context, 'tus:marketplace:read')
    assertMerchantRole(context)
    const merchant = await this.store.merchant.find(context.tenantId)
    const listings = await this.store.listings.forTenant(context.tenantId)
    return { merchant, listings: merchant && hasLocationAccess(context, merchant.locationId) ? listings : [] }
  }

  async checkout(input: MarketplaceCheckoutCommand): Promise<{ status: 'executed' | 'replay' } & MarketplaceCheckoutResponse> {
    await this.evaluadorHabilitacion?.require({
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      capability: 'settlement',
      profile: this.perfilHabilitacion,
      scope: this.alcanceHabilitacion,
      now: input.createdAt,
    })
    if (!input.idempotencyKey.trim() || !input.requestHash.trim()) throw new MarketplaceError(400, 'INVALID', 'idempotency-key and requestHash are required')
    return this.store.transaction(async (store) => {
      const claim = await store.idempotency.claim({ tenantId: input.tenantId, key: input.idempotencyKey, requestHash: input.requestHash })
      if (claim.status === 'replay') return { status: 'replay' as const, ...claim.response! }
      if (claim.status === 'conflict') throw new MarketplaceError(409, 'CONFLICT', 'idempotency key was already used for another request')
      if (claim.status === 'in_progress') throw new MarketplaceError(409, 'IN_PROGRESS', 'the idempotent request is already in progress')
      {
        if (input.lines.length === 0) throw new MarketplaceError(400, 'INVALID', 'checkout requires at least one marketplace line')
        const commitments: MarketplaceCommitment[] = []
        const audits: RegistroAuditoriaMercadoServicios[] = []
        const productQuantities = new Map<string, number>()
        const expectedVersions = new Map<string, number>()
        for (const line of input.lines) {
          const listing = await store.listings.find(line.listingId)
          if (!listing || !listing.published || listing.tenantId.trim().length === 0) throw new MarketplaceError(409, 'UNAVAILABLE', 'listing is not currently available')
          const merchant = await store.merchant.find(listing.tenantId)
          if (!merchant || merchant.status !== MARKETPLACE_MERCHANT_STATUSES.APPROVED) throw new MarketplaceError(409, 'UNAVAILABLE', 'merchant is not currently available')
          if (merchant.operatingPolicyVersion !== listing.policyVersion) throw new MarketplaceError(409, 'STALE_FACTS', 'merchant policy facts are stale', { listingId: listing.listingId, currentPolicyVersion: merchant.operatingPolicyVersion })
          validateCheckoutLine(line, listing)
          const expectedVersion = expectedVersions.get(listing.listingId) ?? listing.availabilityVersion
          if (line.availabilityVersion !== expectedVersion || (line.price !== undefined && line.price !== listing.price)) throw new MarketplaceError(409, 'STALE_FACTS', 'price or availability facts are stale', { listingId: listing.listingId, currentAvailabilityVersion: listing.availabilityVersion, currentPrice: listing.price })
          if (line.context === 'product') {
            const nextQuantity = (productQuantities.get(listing.listingId) ?? 0) + line.quantity
            if (nextQuantity > (listing.stock ?? 0)) throw new MarketplaceError(409, 'UNAVAILABLE', 'product stock is insufficient', { listingId: listing.listingId })
            productQuantities.set(listing.listingId, nextQuantity)
            expectedVersions.set(listing.listingId, listing.availabilityVersion)
          } else {
            if ((listing.priceMode ?? MARKETPLACE_PRICE_MODES.FIXED) === MARKETPLACE_PRICE_MODES.REQUIRES_BUDGET) throw new MarketplaceError(409, 'BUDGET_REQUIRED', 'service requires a budget before booking', { listingId: listing.listingId })
            const bookings = await store.commitments.forListing(listing.listingId)
            const overlapping = bookings.filter((booking) => booking.slotStart && booking.slotEnd && overlaps(line.slotStart!, line.slotEnd!, booking.slotStart, booking.slotEnd)).length
            const overlappingInCheckout = commitments.filter((booking) => booking.listingId === listing.listingId && booking.slotStart && booking.slotEnd && overlaps(line.slotStart!, line.slotEnd!, booking.slotStart, booking.slotEnd)).length
            if (overlapping + overlappingInCheckout >= (listing.capacity ?? 0)) throw new MarketplaceError(409, 'SLOT_UNAVAILABLE', 'service slot capacity is unavailable', { listingId: listing.listingId })
          }
          const commitment: MarketplaceCommitment = {
            contractVersion: TUS_CONTRACT_VERSION,
            commitmentId: `marketplace-${input.tenantId}-${input.idempotencyKey}-${commitments.length + 1}`,
            cartId: input.cartId,
            tenantId: input.tenantId,
            merchantId: listing.merchantId,
            context: line.context,
            amount: listing.price * line.quantity,
            currency: listing.currency,
            status: 'pending',
            lineIds: [line.lineId],
            version: 1,
            createdAt: input.createdAt,
            listingId: listing.listingId,
            quantity: line.quantity,
            availabilityVersion: line.availabilityVersion,
            policyVersion: listing.policyVersion,
            priceSnapshot: structuredClone(listing.priceSnapshot),
            ...(line.slotStart ? { slotStart: line.slotStart } : {}),
            ...(line.slotEnd ? { slotEnd: line.slotEnd } : {}),
          }
          commitments.push(commitment)
          audits.push(crearAuditoriaMercadoServicios(input, 'commitment.created', 'commitment', commitment.commitmentId, 'allowed'))
        }
        for (const [listingId, quantity] of productQuantities) {
          const listing = await store.listings.find(listingId)
          if (!listing) throw new MarketplaceError(409, 'UNAVAILABLE', 'listing is no longer available', { listingId })
          const reserved = await store.listings.reserveProduct({ tenantId: listing.tenantId, listingId, availabilityVersion: expectedVersions.get(listingId)!, quantity, updatedAt: input.createdAt })
          if (!reserved) throw new MarketplaceError(409, 'UNAVAILABLE', 'product stock or availability changed during checkout', { listingId })
        }
        await store.commitments.saveMany(commitments)
        await store.audit.append(audits)
        await store.outbox.append(createOutbox(input, MARKETPLACE_OUTBOX_EVENT_TYPES.COMMITMENTS_CREATED, 'commitment', input.cartId, audits.map((audit) => audit.auditId), commitments.map((commitment) => commitment.commitmentId)))
        const response = { contractVersion: TUS_CONTRACT_VERSION, commitments, audits }
        await store.idempotency.complete({ tenantId: input.tenantId, key: input.idempotencyKey, response })
        return { status: 'executed' as const, ...response }
      }
    })
  }

  async customerCommitments(context: TusAuthenticatedTenantContext): Promise<{ commitments: MarketplaceCommitment[] }> {
    assertPermission(context, 'tus:marketplace:read')
    return { commitments: await this.store.commitments.forTenant(context.tenantId) }
  }

  async customerCommitment(context: TusAuthenticatedTenantContext, commitmentId: string): Promise<MarketplaceCommitment> {
    assertPermission(context, 'tus:marketplace:read')
    const commitment = await this.store.commitments.find(commitmentId)
    if (!commitment || commitment.tenantId !== context.tenantId) throw new MarketplaceError(403, 'FORBIDDEN', 'marketplace commitment is outside the authenticated tenant')
    return commitment
  }

  async recordDenied(context: TusAuthenticatedTenantContext, action: string, resourceId: string): Promise<void> {
    await this.registrarAuditoriaMercadoServicios(context, action, 'authorization', resourceId, 'denied')
  }

  private async registrarAuditoriaMercadoServicios(context: TusAuthenticatedTenantContext, action: string, resourceType: RegistroAuditoriaMercadoServicios['resourceType'], resourceId: string, outcome: RegistroAuditoriaMercadoServicios['outcome']): Promise<void> {
    await this.store.audit.append([crearAuditoriaMercadoServicios({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, createdAt: new Date().toISOString() }, action, resourceType, resourceId, outcome)])
  }

  private requerirHabilitacion(context: TusAuthenticatedTenantContext, capability: 'publication' | 'settlement'): Promise<unknown> {
    return this.evaluadorHabilitacion?.require({
      tenantId: context.tenantId,
      actorId: context.subjectId,
      correlationId: context.correlationId,
      capability,
      profile: this.perfilHabilitacion,
      scope: this.alcanceHabilitacion,
    }) ?? Promise.resolve()
  }
}

function crearAuditoriaMercadoServicios(input: Pick<MarketplaceCheckoutCommand, 'tenantId' | 'actorId' | 'correlationId' | 'createdAt'>, action: string, resourceType: RegistroAuditoriaMercadoServicios['resourceType'], resourceId: string, outcome: RegistroAuditoriaMercadoServicios['outcome']): RegistroAuditoriaMercadoServicios {
  return { auditId: randomUUID(), tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId, action, resourceType, resourceId, outcome, createdAt: input.createdAt }
}

function createOutbox(input: Pick<MarketplaceCheckoutCommand, 'tenantId' | 'actorId' | 'correlationId' | 'createdAt'>, eventType: MarketplaceOutboxEventType, aggregateType: MarketplaceOutboxRecord['aggregateType'], aggregateId: string, auditIds: string[], commitmentIds?: string[]): MarketplaceOutboxRecord {
  return {
    eventId: `marketplace-outbox-${randomUUID()}`,
    tenantId: input.tenantId,
    eventType,
    aggregateType,
    aggregateId,
    correlationId: input.correlationId,
      payload: { correlationId: input.correlationId, auditIds, ...(commitmentIds === undefined ? {} : { commitmentIds }) },
    createdAt: Date.parse(input.createdAt),
  }
}

function assertPermission(context: TusAuthenticatedTenantContext, permission: string): void {
  if (!context.permissions.includes(permission) && !context.permissions.includes('tus:*')) throw new MarketplaceError(403, 'FORBIDDEN', 'TUS marketplace operation is not authorized')
}

function assertMerchantRole(context: TusAuthenticatedTenantContext): void {
  if (!context.roles.some((role) => ['merchant', 'merchant-admin', 'owner', 'admin', 'operator'].includes(role))) throw new MarketplaceError(403, 'FORBIDDEN', 'merchant or operator role is required')
}

function esCohorteMercado(value: unknown): value is Cohorte {
  return MARKETPLACE_COHORTS.includes(value as Cohorte)
}

function validateListingInput(input: EntradaPublicacion, merchant: PerfilPrestador): void {
  if (!input.name.trim() || !input.description.trim() || input.locationId !== merchant.locationId || input.cohort !== merchant.cohort || !/^[A-Z]{3}$/u.test(input.currency.trim().toUpperCase()) || !Number.isFinite(input.price) || input.price <= 0) throw new MarketplaceError(400, 'INVALID_LISTING', 'listing commercial and location facts are invalid')
  normalizeMoney(input.currency, input.price, input.priceMinor)
  if (input.kind === 'product' && (!Number.isInteger(input.stock) || input.stock! < 0)) throw new MarketplaceError(400, 'INVALID_LISTING', 'product stock is required')
  if (input.kind === 'service') {
    resolveBookingMode(input)
    if (!Number.isInteger(input.capacity) || input.capacity! <= 0 || !Array.isArray(input.workingHours) || input.workingHours.length === 0) throw new MarketplaceError(400, 'INVALID_LISTING', 'service capacity and working hours are required')
    if (input.priceMode !== undefined && !Object.values(MARKETPLACE_PRICE_MODES).includes(input.priceMode)) throw new MarketplaceError(400, 'INVALID_LISTING', 'service price mode is invalid')
  }
}

function resolveBookingMode(input: Pick<EntradaPublicacion, 'bookingMode' | 'durationMinutes' | 'estimatedDurationMinutes'>): MarketplaceBookingMode {
  const mode = input.bookingMode ?? (input.durationMinutes === undefined ? MARKETPLACE_BOOKING_MODES.VARIABLE_DURATION : MARKETPLACE_BOOKING_MODES.FIXED_SHIFT)
  if (!Object.values(MARKETPLACE_BOOKING_MODES).includes(mode)) throw new MarketplaceError(400, 'INVALID_LISTING', 'service booking mode is invalid')
  if (mode === MARKETPLACE_BOOKING_MODES.FIXED_SHIFT && (!Number.isInteger(input.durationMinutes) || input.durationMinutes! <= 0)) throw new MarketplaceError(400, 'INVALID_LISTING', 'fixed_shift services require durationMinutes')
  if (mode === MARKETPLACE_BOOKING_MODES.VARIABLE_DURATION && (!Number.isInteger(input.estimatedDurationMinutes) || input.estimatedDurationMinutes! <= 0)) throw new MarketplaceError(400, 'INVALID_LISTING', 'variable_duration services require estimatedDurationMinutes')
  return mode
}

function validatePublishedService(listing: Publicacion): void {
  const mode = listing.bookingMode ?? (listing.durationMinutes === null ? MARKETPLACE_BOOKING_MODES.VARIABLE_DURATION : MARKETPLACE_BOOKING_MODES.FIXED_SHIFT)
  if (!Object.values(MARKETPLACE_BOOKING_MODES).includes(mode)) throw new MarketplaceError(400, 'INVALID_LISTING', 'service booking mode is invalid')
  if (!listing.capacity || listing.workingHours.length === 0) throw new MarketplaceError(400, 'INVALID_LISTING', 'service capacity and working hours are required')
  if (mode === MARKETPLACE_BOOKING_MODES.FIXED_SHIFT && (!listing.durationMinutes || listing.estimatedDurationMinutes !== null && listing.estimatedDurationMinutes !== undefined)) throw new MarketplaceError(400, 'INVALID_LISTING', 'fixed_shift service duration is invalid')
  if (mode === MARKETPLACE_BOOKING_MODES.VARIABLE_DURATION && (!listing.estimatedDurationMinutes || listing.durationMinutes !== null)) throw new MarketplaceError(400, 'INVALID_LISTING', 'variable_duration service duration is invalid')
  if (listing.priceMode !== undefined && !Object.values(MARKETPLACE_PRICE_MODES).includes(listing.priceMode)) throw new MarketplaceError(400, 'INVALID_LISTING', 'service price mode is invalid')
}

function normalizeMoney(currency: string, price: number, priceMinor?: bigint): MarketplaceMoneySnapshot {
  const normalizedCurrency = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(normalizedCurrency) || !Number.isFinite(price) || price <= 0) throw new MarketplaceError(400, 'INVALID_MONEY', 'currency and price are invalid')
  const derivedMinor = BigInt(Math.round(price * 100))
  if (priceMinor !== undefined && (typeof priceMinor !== 'bigint' || priceMinor <= 0n || priceMinor !== derivedMinor)) throw new MarketplaceError(400, 'INVALID_MONEY', 'price and exact minor units do not match')
  if (priceMinor === undefined && Math.abs(price - Number(derivedMinor) / 100) > Number.EPSILON * Math.max(1, price)) throw new MarketplaceError(400, 'INVALID_MONEY', 'price must resolve to exact minor units')
  return { currency: normalizedCurrency, minor: priceMinor ?? derivedMinor }
}

function validateCheckoutLine(line: MarketplaceCheckoutLine, listing: Publicacion): void {
  if (line.context !== listing.kind || !Number.isInteger(line.quantity) || line.quantity <= 0) throw new MarketplaceError(400, 'INVALID', 'checkout context and quantity do not match the listing')
  if (line.context === 'service' && (line.quantity !== 1 || !line.slotStart || !line.slotEnd || !validInterval(line.slotStart, line.slotEnd) || Date.parse(line.slotEnd) - Date.parse(line.slotStart) !== effectiveListingDuration(listing) * 60 * 1000)) throw new MarketplaceError(400, 'INVALID', 'service checkout requires a valid slot matching the service duration')
}

function effectiveListingDuration(listing: Publicacion): number {
  const duration = resolvedListingBookingMode(listing) === MARKETPLACE_BOOKING_MODES.VARIABLE_DURATION ? listing.estimatedDurationMinutes : listing.durationMinutes
  return duration ?? 0
}

function resolvedListingBookingMode(listing: Publicacion): MarketplaceBookingMode {
  return listing.bookingMode ?? (listing.durationMinutes === null ? MARKETPLACE_BOOKING_MODES.VARIABLE_DURATION : MARKETPLACE_BOOKING_MODES.FIXED_SHIFT)
}

function hasLocationAccess(context: TusAuthenticatedTenantContext, locationId: string): boolean {
  if (context.permissions.includes('tus:*') || context.roles.some((role) => ['owner', 'admin', 'merchant-admin'].includes(role))) return true
  return context.roles.includes(`location:${locationId}`) || context.permissions.includes(`tus:marketplace:location:${locationId}`)
}

function validInterval(start: string, end: string): boolean {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
}

function overlaps(start: string, end: string, otherStart?: string, otherEnd?: string): boolean {
  if (!otherStart || !otherEnd) return false
  return Date.parse(start) < Date.parse(otherEnd) && Date.parse(end) > Date.parse(otherStart)
}

export default { InMemoryMarketplaceStore, MarketplaceError, TusMarketplaceService }
