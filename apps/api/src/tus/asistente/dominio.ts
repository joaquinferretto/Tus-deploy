import { createHash } from 'node:crypto'
import type { TusApplicationService } from '../application/tus-application-service.ts'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'

// The assistant reaches TUS only through this port. The adapter below delegates to the SAME
// application services used by the Web/API routes (marketplace, work, finance, identity), so
// tenancy, ownership, roles and state machines are enforced exactly once, in the domain.

export interface ServicioPublico {
  listingId: string
  name: string
  description: string
  category: string
  priceMode: string
  price: { amountMinor: string; currency: string } | null
  bookingMode: string | null
  providerRef: string
  zone: string
}

export interface TrabajoResumen {
  workId: string
  status: string
  role: 'client' | 'provider'
  serviceName: string | null
  budgetRequired: boolean
  hasReservation: boolean
  updatedAt: string
}

export interface PuertoDominioAsistente {
  buscarServicios(filter: { query: string | null; category: string | null }): Promise<ServicioPublico[]>
  servicio(listingId: string): Promise<ServicioPublico | null>
  esPrestador(context: TusAuthenticatedTenantContext): Promise<boolean>
  solicitudes(context: TusAuthenticatedTenantContext): Promise<{ requestId: string; status: string; serviceName: string | null; slotStart: string | null; createdAt: string }[]>
  trabajos(context: TusAuthenticatedTenantContext, role: 'client' | 'provider'): Promise<TrabajoResumen[]>
  trabajo(context: TusAuthenticatedTenantContext, workId: string): Promise<{
    workId: string
    status: string
    viewer: string
    version: number
    serviceName: string | null
    budgets: { budgetId: string; version: number; status: string; totalMinor: string; currency: string; scope: string }[]
  }>
  estadoPago(context: TusAuthenticatedTenantContext, workId: string): Promise<{ payable: boolean; paymentStatus: string; amountMinor: string | null; currency: string | null; paymentAvailable: boolean; reason: string | null }>
  linkPago(context: TusAuthenticatedTenantContext, workId: string, idempotencyKey: string): Promise<{ url: string | null; status: string }>
  estadoIdentidad(context: TusAuthenticatedTenantContext): Promise<{ status: string; message: string }>
  estadoMercadoPago(context: TusAuthenticatedTenantContext): Promise<{ status: string; connectAvailable: boolean }>
  crearSolicitud(context: TusAuthenticatedTenantContext, input: { listingId: string; idempotencyKey: string }): Promise<{ requestId: string; status: string }>
  decidirPresupuesto(context: TusAuthenticatedTenantContext, input: { workId: string; budgetId: string; decision: 'accepted' | 'rejected'; reason?: string; idempotencyKey: string }): Promise<{ workId: string; status: string }>
  transicionTrabajo(context: TusAuthenticatedTenantContext, input: { workId: string; action: 'cancel' | 'complete'; idempotencyKey: string }): Promise<{ workId: string; status: string }>
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class DominioAsistenteTus implements PuertoDominioAsistente {
  constructor(
    private readonly application: TusApplicationService,
    private readonly now: () => number = Date.now
  ) {}

  private get marketplace() {
    if (!this.application.marketplace) throw Object.assign(new Error('marketplace unavailable'), { status: 503, code: 'UNAVAILABLE' })
    return this.application.marketplace
  }

  private get work() {
    if (!this.application.work) throw Object.assign(new Error('work unavailable'), { status: 503, code: 'UNAVAILABLE' })
    return this.application.work
  }

  async buscarServicios(filter: { query: string | null; category: string | null }): Promise<ServicioPublico[]> {
    const discovered = await this.marketplace.discover(filter.category ? { cohort: filter.category as never } : {})
    const terms = (filter.query ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/gu, '')
      .split(/\s+/u)
      .filter((term) => term.length > 2)
    return discovered.items
      .filter((item) => item.kind === 'service')
      .filter((item) => {
        if (terms.length === 0) return true
        const haystack = `${item.name} ${item.description}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/gu, '')
        return terms.some((term) => haystack.includes(term.slice(0, Math.max(4, term.length - 2))))
      })
      .slice(0, 5)
      .map((item) => ({
        listingId: item.listingId,
        name: item.name,
        description: item.description.slice(0, 200),
        category: item.cohort,
        priceMode: String((item as { priceMode?: string }).priceMode ?? 'fixed'),
        price: (item as { priceMode?: string }).priceMode === 'requires_budget' ? null : { amountMinor: String(item.priceMinor), currency: item.currency },
        bookingMode: (item as { bookingMode?: string }).bookingMode ?? null,
        providerRef: item.merchantId,
        zone: item.locationId,
      }))
  }

  async servicio(listingId: string): Promise<ServicioPublico | null> {
    const listing = await this.marketplace.findPublishedService(listingId)
    if (!listing) return null
    return {
      listingId: listing.listingId,
      name: listing.name,
      description: listing.description.slice(0, 400),
      category: listing.cohort,
      priceMode: listing.priceMode ?? 'fixed',
      price: listing.priceMode === 'requires_budget' ? null : { amountMinor: String(listing.priceMinor), currency: listing.currency },
      bookingMode: listing.bookingMode ?? null,
      providerRef: listing.merchantId,
      zone: listing.locationId,
    }
  }

  async esPrestador(context: TusAuthenticatedTenantContext): Promise<boolean> {
    const merchant = await this.marketplace.store.merchant.find(context.tenantId)
    return Boolean(merchant && merchant.status === 'approved')
  }

  async solicitudes(context: TusAuthenticatedTenantContext) {
    const { commitments } = await this.marketplace.customerCommitments(context)
    const out = []
    for (const commitment of commitments.slice(-10).reverse()) {
      const listing = await this.marketplace.store.listings.find(commitment.listingId)
      out.push({
        requestId: commitment.commitmentId,
        status: commitment.status,
        serviceName: listing?.name ?? null,
        slotStart: commitment.slotStart ?? null,
        createdAt: commitment.createdAt,
      })
    }
    return out
  }

  async trabajos(context: TusAuthenticatedTenantContext, role: 'client' | 'provider'): Promise<TrabajoResumen[]> {
    const works = await this.work.listWorks({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId })
    const mine = works.filter((work) => (role === 'client' ? work.tenantId === context.tenantId : work.prestadorTenantId === context.tenantId))
    const out: TrabajoResumen[] = []
    for (const work of mine.slice(-10).reverse()) {
      const listing = await this.marketplace.store.listings.find(work.publicacionId)
      out.push({
        workId: work.trabajoId,
        status: work.status,
        role,
        serviceName: listing?.name ?? null,
        budgetRequired: work.budgetRequired,
        hasReservation: Boolean(work.reservaId),
        updatedAt: work.updatedAt,
      })
    }
    return out
  }

  async trabajo(context: TusAuthenticatedTenantContext, workId: string) {
    const detail = await this.work.getWork({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }, workId)
    const listing = await this.marketplace.store.listings.find(detail.work.publicacionId)
    return {
      workId: detail.work.trabajoId,
      status: detail.work.status,
      viewer: detail.viewer,
      version: detail.work.version,
      serviceName: listing?.name ?? null,
      budgets: detail.budgets.map((budget) => ({
        budgetId: budget.presupuestoId,
        version: budget.version,
        status: budget.status,
        totalMinor: budget.totalMinor,
        currency: budget.currency,
        scope: budget.scope.slice(0, 300),
      })),
    }
  }

  async estadoPago(context: TusAuthenticatedTenantContext, workId: string) {
    if (!this.application.serviceFinance) throw Object.assign(new Error('finance unavailable'), { status: 503, code: 'UNAVAILABLE' })
    const preview = await this.application.serviceFinance.consultarVistaPreviaPago({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, trabajoId: workId })
    return {
      payable: preview.payable,
      paymentStatus: preview.paymentStatus,
      amountMinor: preview.amountMinor,
      currency: preview.currency,
      paymentAvailable: preview.paymentAvailable,
      reason: preview.notPayableReason ?? (preview as { unavailableReason?: string | null }).unavailableReason ?? null,
    }
  }

  async linkPago(context: TusAuthenticatedTenantContext, workId: string, idempotencyKey: string) {
    if (!this.application.serviceFinance) throw Object.assign(new Error('finance unavailable'), { status: 503, code: 'UNAVAILABLE' })
    const result = await this.application.serviceFinance.iniciarCheckout({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, trabajoId: workId, idempotencyKey })
    // Only a hosted Mercado Pago HTTPS URL is ever forwarded (never preference internals).
    const url = typeof result.checkoutUrl === 'string' && /^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//u.test(result.checkoutUrl) ? result.checkoutUrl : null
    return { url, status: String(result.status) }
  }

  async estadoIdentidad(context: TusAuthenticatedTenantContext) {
    if (!this.application.identity) return { status: 'unavailable', message: 'La verificación de identidad no está disponible.' }
    const view = await this.application.identity.estado({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId })
    return { status: view.status, message: view.message }
  }

  async estadoMercadoPago(context: TusAuthenticatedTenantContext) {
    if (!this.application.servicePayments) return { status: 'unavailable', connectAvailable: false }
    const account = await this.application.servicePayments.cuentas.estadoCuenta({ tenantId: context.tenantId })
    return { status: account.status, connectAvailable: account.connectAvailable }
  }

  async crearSolicitud(context: TusAuthenticatedTenantContext, input: { listingId: string; idempotencyKey: string }) {
    const listing = await this.marketplace.findPublishedService(input.listingId)
    if (!listing) throw Object.assign(new Error('service not found'), { status: 404, code: 'NOT_FOUND' })
    const bookingMode = listing.bookingMode ?? (listing.durationMinutes === null ? 'variable_duration' : 'fixed_shift')
    // Slot-based services need a concrete slot: they are booked on the Web for now.
    if (!['requiere_presupuesto', 'visita_diagnostico', 'variable_duration', 'duracion_estimada'].includes(bookingMode))
      throw Object.assign(new Error('slot required'), { status: 409, code: 'SLOT_REQUIRED' })
    const lines = [{ lineId: `whatsapp-${input.idempotencyKey}`.slice(0, 80), listingId: listing.listingId, context: 'service' as const, quantity: 1, availabilityVersion: listing.availabilityVersion }]
    const result = await this.marketplace.checkout({
      tenantId: context.tenantId,
      actorId: context.subjectId,
      correlationId: context.correlationId,
      idempotencyKey: input.idempotencyKey,
      cartId: `whatsapp-cart-${hash(input.idempotencyKey).slice(0, 24)}`,
      requestHash: hash({ listingId: listing.listingId, availabilityVersion: listing.availabilityVersion }),
      createdAt: new Date(this.now()).toISOString(),
      lines,
    })
    const commitment = (result as { commitments?: { commitmentId: string; status: string }[] }).commitments?.[0]
    return { requestId: commitment?.commitmentId ?? 'unknown', status: commitment?.status ?? String(result.status) }
  }

  async decidirPresupuesto(context: TusAuthenticatedTenantContext, input: { workId: string; budgetId: string; decision: 'accepted' | 'rejected'; reason?: string; idempotencyKey: string }) {
    const detail = await this.work.getWork({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }, input.workId)
    const budget = detail.budgets.find((item) => item.presupuestoId === input.budgetId)
    if (!budget) throw Object.assign(new Error('budget not found'), { status: 404, code: 'NOT_FOUND' })
    const result = await this.work.decideBudget({
      tenantId: context.tenantId,
      actorId: context.subjectId,
      correlationId: context.correlationId,
      trabajoId: input.workId,
      presupuestoId: input.budgetId,
      presupuestoVersion: budget.version,
      decision: input.decision,
      ...(input.reason ? { reason: input.reason } : {}),
      idempotencyKey: input.idempotencyKey,
      requestHash: hash({ op: 'decide', ...input, version: budget.version }),
      createdAt: new Date(this.now()).toISOString(),
    })
    return { workId: result.work.trabajoId, status: result.work.status }
  }

  async transicionTrabajo(context: TusAuthenticatedTenantContext, input: { workId: string; action: 'cancel' | 'complete'; idempotencyKey: string }) {
    const detail = await this.work.getWork({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }, input.workId)
    const command = {
      tenantId: context.tenantId,
      actorId: context.subjectId,
      correlationId: context.correlationId,
      trabajoId: input.workId,
      expectedVersion: detail.work.version,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash({ op: input.action, workId: input.workId, version: detail.work.version }),
      createdAt: new Date(this.now()).toISOString(),
    }
    const result = input.action === 'cancel' ? await this.work.cancelWork(command) : await this.work.completeWork(command)
    return { workId: result.work.trabajoId, status: result.work.status }
  }
}
