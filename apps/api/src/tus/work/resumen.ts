import type { PrismaClient } from '@prisma/client'
import type { Trabajo, WorkActions, WorkPayment, WorkSummary } from '@factory/contracts'
import { TrabajoError, type TrabajoStorePort } from './index.ts'

export function accionesTrabajo(
  work: Trabajo,
  role: WorkSummary['role'],
  budget: WorkSummary['budget'],
  permissions: readonly string[],
  now: number,
  payment: WorkPayment | null = null
): WorkActions {
  const write = permissions.some((p) => ['tus:work:write', 'tus:marketplace:write'].includes(p))
  const provider = role === 'prestador' && write
  const decide =
    role === 'cliente' &&
    permissions.some((p) => ['tus:work:accept', 'tus:work:write', 'tus:checkout'].includes(p)) &&
    work.status === 'budget_pending' &&
    budget?.status === 'issued' &&
    (!budget.validUntil || Date.parse(budget.validUntil) > now)
  // Online payments (request-born works): the deposit gates the start; after the provider finishes,
  // the balance completes the work. Without online payments nothing is gated.
  const online = payment?.online === true
  const required = payment?.required === true
  const depositPaid = payment?.deposit.status === 'paid'
  const client = role === 'cliente' && permissions.some((p) => ['tus:checkout', 'tus:work:accept'].includes(p))
  const solicitud = work.origin === 'solicitud'
  const open = !['completed', 'cancelled'].includes(work.status)
  return {
    canStart:
      provider &&
      ['requested', 'in_diagnosis', 'accepted'].includes(work.status) &&
      (!work.budgetRequired || work.status === 'accepted') &&
      !(required && !depositPaid),
    canComplete: provider && work.status === 'in_progress' && !work.finishedAt,
    // Provider: any open work without a registered payment. Client (request-born works only):
    // before the start. A paid deposit makes it a support case (cancellationNeedsSupport).
    canCancel:
      open &&
      !depositPaid &&
      (provider ||
        (client && solicitud && ['requested', 'in_diagnosis', 'budget_pending', 'accepted'].includes(work.status))),
    canCreateBudget:
      provider &&
      work.budgetRequired &&
      ['requested', 'in_diagnosis', 'budget_pending'].includes(work.status),
    canAcceptBudget: Boolean(decide),
    canRejectBudget: Boolean(decide),
    canSendMessage: permissions.includes('tus:marketplace:write'),
    canPayDeposit:
      client &&
      online &&
      ['accepted', 'in_progress'].includes(work.status) &&
      ['not_created', 'pending_payment'].includes(payment?.deposit.status ?? ''),
    canPayBalance:
      client &&
      online &&
      depositPaid &&
      work.status === 'in_progress' &&
      Boolean(work.finishedAt) &&
      ['not_created', 'pending_payment'].includes(payment?.balance.status ?? ''),
    canRequestCancellation:
      client && solicitud && work.status === 'in_progress' && !work.cancellationRequestedAt,
  }
}

// Deposit/balance state from the finance module (request-born works, detail only).
export interface PagosResumenTrabajo {
  estadoPagosTrabajo(work: Trabajo): Promise<{
    required: boolean
    online: boolean
    unavailableReason: string | null
    currency: string
    totalMinor: bigint
    deposit: { amountMinor: bigint; status: WorkPayment['deposit']['status'] }
    balance: { amountMinor: bigint; status: WorkPayment['balance']['status'] }
  } | null>
}

export type WorkEnrichment = Pick<WorkSummary, 'request' | 'budget'> & {
  provider: WorkSummary['counterpart']
  customerName: string
}
export interface WorkSummarySource {
  batch(works: readonly Trabajo[]): Promise<Map<string, WorkEnrichment>>
}

// A fixed number of reads: requests + image orders, public profiles, budgets. No per-work reads.
// Only ids from previously authorized work records reach this source.
export class PrismaWorkSummarySource implements WorkSummarySource {
  constructor(
    private readonly db: Pick<
      PrismaClient,
      'solicitudServicio' | 'perfilPublicoPrestador' | 'presupuesto'
    >
  ) {}

  async batch(works: readonly Trabajo[]): Promise<Map<string, WorkEnrichment>> {
    if (!works.length) return new Map()
    const solicitudIds = [...new Set(works.flatMap((w) => (w.solicitudId ? [w.solicitudId] : [])))]
    const [requests, profiles, budgets] = await Promise.all([
      this.db.solicitudServicio.findMany({
        where: { id: { in: solicitudIds } },
        select: {
          id: true,
          titulo: true,
          descripcion: true,
          categoria: true,
          zona: true,
          nombrePublico: true,
          imagenes: { select: { orden: true } },
        },
      }),
      this.db.perfilPublicoPrestador.findMany({
        where: {
          OR: works.map((w) => ({ tenantId: w.prestadorTenantId, prestadorId: w.prestadorId })),
        },
        select: { tenantId: true, prestadorId: true, nombrePublico: true, oficio: true },
      }),
      this.db.presupuesto.findMany({
        where: { OR: works.map((w) => ({ tenantId: w.tenantId, trabajoId: w.trabajoId })) },
        orderBy: { version: 'desc' },
        select: {
          tenantId: true,
          trabajoId: true,
          presupuestoId: true,
          version: true,
          estado: true,
          moneda: true,
          montoTotal: true,
          alcance: true,
          fechaValidez: true,
        },
      }),
    ])
    const requestsById = new Map(requests.map((r) => [r.id, r]))
    const profilesById = new Map(
      profiles.map((p) => [JSON.stringify([p.tenantId, p.prestadorId]), p])
    )
    const budgetsById = new Map<string, WorkSummary['budget']>()
    for (const b of budgets) {
      const key = JSON.stringify([b.tenantId, b.trabajoId])
      if (!budgetsById.has(key))
        budgetsById.set(key, {
          presupuestoId: b.presupuestoId,
          version: b.version,
          status: b.estado as NonNullable<WorkSummary['budget']>['status'],
          currency: b.moneda,
          totalMinor: String(b.montoTotal),
          scope: b.alcance,
          validUntil: b.fechaValidez?.toISOString() ?? null,
        })
    }
    return new Map(
      works.map((w) => {
        const r = w.solicitudId ? requestsById.get(w.solicitudId) : undefined
        const p = profilesById.get(JSON.stringify([w.prestadorTenantId, w.prestadorId]))
        return [
          w.trabajoId,
          {
            request: r
              ? {
                  title: r.titulo,
                  description: r.descripcion,
                  category: r.categoria,
                  area: r.zona,
                  images: r.imagenes.map(
                    (i) => `/tus/v1/solicitudes/${encodeURIComponent(r.id)}/imagenes/${i.orden}`
                  ),
                }
              : null,
            customerName: r?.nombrePublico ?? 'Cliente',
            provider: {
              displayName: p?.nombrePublico ?? 'Prestador',
              profession: p?.oficio ?? null,
            },
            budget: budgetsById.get(JSON.stringify([w.tenantId, w.trabajoId])) ?? null,
          },
        ]
      })
    )
  }
}

export class ServicioResumenTrabajo {
  constructor(
    private readonly store: Pick<TrabajoStorePort, 'listAccessible' | 'findAccessible'>,
    private readonly source: WorkSummarySource,
    private readonly now: () => number = Date.now,
    private readonly pagos: PagosResumenTrabajo | null = null
  ) {}

  async listar(
    tenantId: string,
    permissions: readonly string[]
  ): Promise<{ items: WorkSummary[] }> {
    return {
      items: await this.project(await this.store.listAccessible(tenantId), tenantId, permissions),
    }
  }

  async obtener(
    tenantId: string,
    id: string,
    permissions: readonly string[]
  ): Promise<WorkSummary> {
    const work = await this.store.findAccessible({ tenantId, trabajoId: id })
    if (!work) throw new TrabajoError(404, 'NOT_FOUND', 'work not found')
    const estado = this.pagos ? await this.pagos.estadoPagosTrabajo(work) : null
    const payment: WorkPayment | null = estado
      ? {
          required: estado.required,
          online: estado.online,
          unavailableReason: estado.unavailableReason,
          currency: estado.currency,
          totalMinor: String(estado.totalMinor),
          deposit: { amountMinor: String(estado.deposit.amountMinor), status: estado.deposit.status },
          balance: { amountMinor: String(estado.balance.amountMinor), status: estado.balance.status },
        }
      : null
    return (await this.project([work], tenantId, permissions, payment))[0]!
  }

  private async project(
    works: Trabajo[],
    tenantId: string,
    permissions: readonly string[],
    payment: WorkPayment | null = null
  ): Promise<WorkSummary[]> {
    const accessible = works.filter(
      (w) => w.tenantId === tenantId || w.prestadorTenantId === tenantId
    )
    const extra = await this.source.batch(accessible)
    return accessible.map((w) => {
      const role = w.tenantId === tenantId ? 'cliente' : 'prestador'
      const e = extra.get(w.trabajoId)
      const budget =
        e?.budget && (role === 'prestador' || e.budget.status !== 'draft') ? e.budget : null
      return {
        id: w.trabajoId,
        origin: w.origin ?? 'marketplace',
        solicitudId: w.solicitudId ?? null,
        status: w.status,
        version: w.version,
        budgetRequired: w.budgetRequired,
        finishedAt: w.finishedAt ?? null,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        title: e?.request?.title ?? 'Trabajo de servicio',
        role,
        counterpart:
          role === 'cliente'
            ? (e?.provider ?? { displayName: 'Prestador', profession: null })
            : { displayName: e?.customerName ?? 'Cliente', profession: null },
        request: e?.request ?? null,
        budget,
        payment,
        cancellation:
          w.cancelledByRole && w.cancellationReason
            ? { byRole: w.cancelledByRole, reason: w.cancellationReason }
            : null,
        cancellationRequest:
          w.cancellationRequestedAt && w.cancellationRequestReason
            ? { requestedAt: w.cancellationRequestedAt, reason: w.cancellationRequestReason }
            : null,
        cancellationNeedsSupport:
          payment?.deposit.status === 'paid' && !['completed', 'cancelled'].includes(w.status),
        actions: accionesTrabajo(w, role, budget, permissions, this.now(), payment),
      }
    })
  }
}
