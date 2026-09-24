import type { Trabajo } from '@factory/contracts'
import { parseMinorUnits } from '@factory/contracts'
import type { MarketplaceStorePort } from '../../catalog/index.ts'
import type { TrabajoStorePort } from '../../work/index.ts'
import type { ObligacionServicio, RegistroIdempotenciaFinanciera } from './modelo.ts'
import type {
  PuertoIdempotenciaFinanciera,
  PuertoIdentidadServicio,
  PuertoObligacionesServicio,
  PuertoTransaccionFinanzasServicio,
  RepositoriosFinanzasServicio,
} from './servicio.ts'

export class IdentidadServicioEnMemoria implements PuertoIdentidadServicio {
  constructor(
    private readonly work: TrabajoStorePort,
    private readonly marketplace: Pick<MarketplaceStorePort, 'commitments' | 'listings'>
  ) {}

  async buscarTrabajoAccesible(input: {
    tenantId: string
    trabajoId: string
  }): Promise<Trabajo | null> {
    return this.work.findAccessible(input)
  }

  async buscarCompromiso(input: { tenantId: string; commitmentId: string }) {
    const commitment = await this.marketplace.commitments.find(input.commitmentId)
    if (!commitment || commitment.tenantId !== input.tenantId) return null
    const listing = await this.marketplace.listings.find(commitment.listingId)
    if (!listing) return null
    return {
      tenantId: commitment.tenantId,
      commitmentId: commitment.commitmentId,
      prestadorTenantId: listing.tenantId,
      prestadorId: commitment.merchantId,
      publicacionId: commitment.listingId,
      context: commitment.context,
      status: commitment.status,
      amountMinor: parseMinorUnits(commitment.priceSnapshot.minor) * BigInt(commitment.quantity),
      currency: commitment.priceSnapshot.currency,
    }
  }

  async buscarPublicacion(input: { prestadorTenantId: string; publicacionId: string }) {
    const listing = await this.marketplace.listings.find(input.publicacionId)
    if (!listing || listing.tenantId !== input.prestadorTenantId) return null
    return {
      tenantId: listing.tenantId,
      publicacionId: listing.listingId,
      prestadorId: listing.merchantId,
      kind: listing.kind,
      priceMode: listing.priceMode ?? null,
    }
  }

  async buscarPresupuesto(input: {
    tenantId: string
    trabajoId: string
    presupuestoId: string
    version: number
  }) {
    const budget = await this.work.findBudget(input)
    if (!budget || budget.tenantId !== input.tenantId) return null
    return {
      tenantId: budget.tenantId,
      prestadorTenantId: budget.prestadorTenantId,
      trabajoId: budget.trabajoId,
      presupuestoId: budget.presupuestoId,
      version: budget.version,
      status: budget.status,
      currency: budget.currency,
      totalMinor: parseMinorUnits(budget.totalMinor),
    }
  }
}

export interface EstadoFinanzasServicioEnMemoria {
  obligaciones: Map<string, ObligacionServicio>
  idempotencia: Map<string, RegistroIdempotenciaFinanciera>
}

export class AlmacenFinanzasServicioEnMemoria {
  state: EstadoFinanzasServicioEnMemoria = { obligaciones: new Map(), idempotencia: new Map() }

  snapshot(): EstadoFinanzasServicioEnMemoria {
    return structuredClone(this.state)
  }

  restore(state: EstadoFinanzasServicioEnMemoria): void {
    this.state = state
  }

  obligaciones(): PuertoObligacionesServicio {
    return {
      buscarPorTrabajo: async (input) =>
        clonar(this.state.obligaciones.get(clave(input.tenantId, input.trabajoId)) ?? null),
      crear: async (obligacion) => {
        const key = clave(obligacion.tenantId, obligacion.trabajoId)
        if (this.state.obligaciones.has(key))
          throw Object.assign(new Error('unique obligation per work'), { code: 'P2002' })
        this.state.obligaciones.set(key, clonar(obligacion))
      },
      actualizar: async ({ obligacion, expectedVersion }) => {
        const key = clave(obligacion.tenantId, obligacion.trabajoId)
        const current = this.state.obligaciones.get(key)
        if (!current || current.version !== expectedVersion) return null
        this.state.obligaciones.set(key, clonar(obligacion))
        return clonar(obligacion)
      },
    }
  }

  idempotencia(): PuertoIdempotenciaFinanciera {
    return {
      buscar: async (input) =>
        clonar(this.state.idempotencia.get(clave(input.tenantId, input.key)) ?? null),
      registrar: async (input) => {
        const key = clave(input.tenantId, input.key)
        if (this.state.idempotencia.has(key))
          throw Object.assign(new Error('unique idempotency key'), { code: 'P2002' })
        this.state.idempotencia.set(key, clonar(input.record))
      },
    }
  }
}

// Serializes callbacks and restores the previous state when the callback throws, which gives
// in-memory tests the same all-or-nothing behavior as the Prisma serializable transaction.
export class TransaccionFinanzasServicioEnMemoria implements PuertoTransaccionFinanzasServicio {
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: AlmacenFinanzasServicioEnMemoria,
    private readonly identidad: PuertoIdentidadServicio
  ) {}

  async ejecutar<T>(
    operation: (repositories: RepositoriosFinanzasServicio) => Promise<T>
  ): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const before = this.store.snapshot()
    try {
      return await operation(this.repositorios())
    } catch (error) {
      this.store.restore(before)
      throw error
    } finally {
      release()
    }
  }

  protected repositorios(): RepositoriosFinanzasServicio {
    return {
      identidad: this.identidad,
      obligaciones: this.store.obligaciones(),
      idempotencia: this.store.idempotencia(),
    }
  }
}

function clave(tenantId: string, id: string): string {
  return `${tenantId}\u0000${id}`
}

function clonar<T>(value: T): T {
  return value === null ? value : structuredClone(value)
}
