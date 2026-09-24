import type { Trabajo } from '@factory/contracts'
import { parseMinorUnits } from '@factory/contracts'
import type { MarketplaceStorePort } from '../../catalog/index.ts'
import type { TrabajoStorePort } from '../../work/index.ts'
import type { ObligacionServicio, RegistroIdempotenciaFinanciera } from './modelo.ts'
import type { IntencionPagoServicioDominio } from './pagos.ts'
import type {
  InstantaneaComisionServicio,
  LiquidacionServicioDominio,
  MovimientoContableServicio,
} from './liquidacion.ts'
import type { ConciliacionServicio } from '@factory/contracts'
import type {
  PuertoComisionesServicio,
  PuertoConciliacionesServicio,
  PuertoLedgerServicio,
  PuertoLiquidacionesServicio,
  PuertoAuditoriaFinanciera,
  PuertoInboxEventosPago,
  PuertoIntencionesPagoServicio,
  PuertoOutboxFinanciero,
  RegistroAuditoriaFinanciera,
  RegistroEventoProveedor,
  RegistroOutboxFinanciero,
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
      nombre: listing.name ?? null,
      categoria: listing.cohort ?? null,
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
  intenciones: Map<string, IntencionPagoServicioDominio>
  inbox: Map<string, RegistroEventoProveedor>
  outbox: RegistroOutboxFinanciero[]
  auditoria: RegistroAuditoriaFinanciera[]
  comisiones: Map<string, InstantaneaComisionServicio>
  ledger: Map<string, MovimientoContableServicio>
  liquidaciones: Map<string, LiquidacionServicioDominio>
  conciliaciones: (ConciliacionServicio & { prestadorTenantId: string })[]
}

export type PuertoConFallaInyectable =
  'outbox' | 'auditoria' | 'inbox' | 'intenciones' | 'ledger' | 'liquidaciones'

export class AlmacenFinanzasServicioEnMemoria {
  state: EstadoFinanzasServicioEnMemoria = {
    obligaciones: new Map(),
    idempotencia: new Map(),
    intenciones: new Map(),
    inbox: new Map(),
    outbox: [],
    auditoria: [],
    comisiones: new Map(),
    ledger: new Map(),
    liquidaciones: new Map(),
    conciliaciones: [],
  }
  private readonly fallas = new Set<PuertoConFallaInyectable>()

  snapshot(): EstadoFinanzasServicioEnMemoria {
    return structuredClone(this.state)
  }

  restore(state: EstadoFinanzasServicioEnMemoria): void {
    this.state = state
  }

  // Test hook: makes the next write on a port fail so rollback can be asserted.
  inyectarFalla(port: PuertoConFallaInyectable): void {
    this.fallas.add(port)
  }

  private verificarFalla(port: PuertoConFallaInyectable): void {
    if (this.fallas.delete(port)) throw new Error(`injected ${port} failure`)
  }

  obligaciones(): PuertoObligacionesServicio {
    return {
      buscarPorTrabajo: async (input) =>
        clonar(this.state.obligaciones.get(clave(input.tenantId, input.trabajoId)) ?? null),
      buscar: async (input) =>
        clonar(
          [...this.state.obligaciones.values()].find(
            (obligacion) =>
              obligacion.tenantId === input.tenantId &&
              obligacion.obligacionId === input.obligacionId
          ) ?? null
        ),
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

  intenciones(): PuertoIntencionesPagoServicio {
    const all = () => [...this.state.intenciones.values()]
    return {
      listarPorObligacion: async (input) =>
        all()
          .filter(
            (intent) =>
              intent.tenantId === input.tenantId && intent.obligacionId === input.obligacionId
          )
          .map(clonar),
      buscar: async (input) =>
        clonar(this.state.intenciones.get(clave(input.tenantId, input.paymentId)) ?? null),
      buscarPorReferenciaProveedor: async (reference) =>
        all()
          .filter((intent) => intent.providerReference === reference)
          .map(clonar),
      buscarPorPaymentId: async (paymentId) =>
        all()
          .filter((intent) => intent.paymentId === paymentId)
          .map(clonar),
      crear: async (intent) => {
        this.verificarFalla('intenciones')
        const key = clave(intent.tenantId, intent.paymentId)
        if (this.state.intenciones.has(key))
          throw Object.assign(new Error('unique payment'), { code: 'P2002' })
        this.state.intenciones.set(key, clonar(intent))
      },
      actualizar: async (intent) => {
        this.verificarFalla('intenciones')
        this.state.intenciones.set(clave(intent.tenantId, intent.paymentId), clonar(intent))
      },
    }
  }

  inbox(): PuertoInboxEventosPago {
    return {
      buscar: async (input) =>
        clonar(
          this.state.inbox.get(clave(input.tenantId, `${input.provider}:${input.eventId}`)) ?? null
        ),
      registrar: async (record) => {
        this.verificarFalla('inbox')
        const key = clave(record.tenantId, `${record.provider}:${record.eventId}`)
        if (this.state.inbox.has(key))
          throw Object.assign(new Error('unique provider event'), { code: 'P2002' })
        this.state.inbox.set(key, clonar(record))
      },
      listarPorObligacion: async (input) =>
        [...this.state.inbox.values()]
          .filter(
            (record) =>
              record.tenantId === input.tenantId && record.obligacionId === input.obligacionId
          )
          .map(clonar),
    }
  }

  outbox(): PuertoOutboxFinanciero {
    return {
      publicar: async (record) => {
        this.verificarFalla('outbox')
        if (this.state.outbox.some((existing) => existing.eventId === record.eventId))
          throw Object.assign(new Error('unique outbox event'), { code: 'P2002' })
        this.state.outbox.push(clonar(record))
      },
    }
  }

  comisiones(): PuertoComisionesServicio {
    return {
      buscar: async (input) =>
        clonar(this.state.comisiones.get(clave(input.tenantId, input.obligacionId)) ?? null),
      crear: async (snapshot) => {
        const key = clave(snapshot.tenantId, snapshot.obligacionId)
        if (this.state.comisiones.has(key))
          throw Object.assign(new Error('unique commission per obligation'), { code: 'P2002' })
        this.state.comisiones.set(key, clonar(snapshot))
      },
    }
  }

  // Append-only: an existing entry id is never overwritten, mirroring the database trigger.
  ledger(): PuertoLedgerServicio {
    return {
      listar: async (input) =>
        [...this.state.ledger.values()]
          .filter(
            (entry) =>
              entry.tenantId === input.tenantId && entry.obligacionId === input.obligacionId
          )
          .map(clonar),
      agregar: async (entry) => {
        this.verificarFalla('ledger')
        const key = clave(entry.tenantId, entry.entryId)
        if (this.state.ledger.has(key))
          throw Object.assign(new Error('ledger entries are append-only'), { code: 'P2002' })
        this.state.ledger.set(key, clonar(entry))
      },
    }
  }

  liquidaciones(): PuertoLiquidacionesServicio {
    return {
      buscar: async (input) =>
        clonar(this.state.liquidaciones.get(clave(input.tenantId, input.obligacionId)) ?? null),
      crear: async (settlement) => {
        this.verificarFalla('liquidaciones')
        const key = clave(settlement.tenantId, settlement.obligacionId)
        if (this.state.liquidaciones.has(key))
          throw Object.assign(new Error('unique settlement per obligation'), { code: 'P2002' })
        this.state.liquidaciones.set(key, clonar(settlement))
      },
      actualizar: async ({ settlement, expectedVersion }) => {
        this.verificarFalla('liquidaciones')
        const key = clave(settlement.tenantId, settlement.obligacionId)
        const current = this.state.liquidaciones.get(key)
        if (!current || current.version !== expectedVersion) return null
        this.state.liquidaciones.set(key, clonar(settlement))
        return clonar(settlement)
      },
    }
  }

  conciliaciones(): PuertoConciliacionesServicio {
    return {
      registrar: async (result) => {
        this.state.conciliaciones.push(clonar(result))
      },
    }
  }

  auditoria(): PuertoAuditoriaFinanciera {
    return {
      registrar: async (record) => {
        this.verificarFalla('auditoria')
        this.state.auditoria.push(clonar(record))
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
      intenciones: this.store.intenciones(),
      inbox: this.store.inbox(),
      outbox: this.store.outbox(),
      auditoria: this.store.auditoria(),
      comisiones: this.store.comisiones(),
      ledger: this.store.ledger(),
      liquidaciones: this.store.liquidaciones(),
      conciliaciones: this.store.conciliaciones(),
    }
  }
}

function clave(tenantId: string, id: string): string {
  return `${tenantId}\u0000${id}`
}

function clonar<T>(value: T): T {
  return value === null ? value : structuredClone(value)
}
