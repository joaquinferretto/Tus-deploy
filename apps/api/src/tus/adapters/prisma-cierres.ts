import { observacionAbierta, type CierreTrabajo, type OrigenConfirmacion, type PuertoCierres } from '../work/cierre.ts'

// CIERRE-TRABAJO-01 on PostgreSQL. Every write is ONE conditional statement (updateMany with the
// state it expects in its WHERE): the database decides which of two concurrent requests wins.

type Fila = Record<string, unknown>
interface Delegado {
  findFirst(args: unknown): Promise<Fila | null>
  findMany(args: unknown): Promise<Fila[]>
  create(args: unknown): Promise<unknown>
  updateMany(args: unknown): Promise<{ count: number }>
}
export interface ClientePrismaCierres {
  cierreTrabajo: Delegado
  reserva: Delegado
}

const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : null)

function cierreDe(fila: Fila): CierreTrabajo {
  return {
    tenantId: String(fila['tenantId']),
    trabajoId: String(fila['trabajoId']),
    prestadorTenantId: String(fila['prestadorTenantId']),
    finishedAt: iso(fila['finalizadoEn'])!,
    finishedBy: String(fila['finalizadoPor']),
    evidence: String(fila['evidencia']),
    confirmationDueAt: iso(fila['confirmacionVenceEn'])!,
    confirmedAt: iso(fila['confirmadoEn']),
    confirmationOrigin: (fila['confirmacionOrigen'] as OrigenConfirmacion | null) ?? null,
    observedAt: iso(fila['observadoEn']),
    observationReason: (fila['observacionMotivo'] as string | null) ?? null,
    observationResolvedAt: iso(fila['observacionResueltaEn']),
    createdAt: iso(fila['fechaCreacion'])!,
    updatedAt: iso(fila['fechaActualizacion'])!,
  }
}

// Not confirmed and without an open observation: what a confirmation and an observation expect.
const ABIERTO = { confirmadoEn: null, OR: [{ observadoEn: null }, { observacionResueltaEn: { not: null } }] }

export class AlmacenCierresPrisma implements PuertoCierres {
  constructor(private readonly client: ClientePrismaCierres) {}

  async buscar(input: { tenantId: string; trabajoId: string }): Promise<CierreTrabajo | null> {
    const fila = await this.client.cierreTrabajo.findFirst({ where: { tenantId: input.tenantId, trabajoId: input.trabajoId } })
    return fila ? cierreDe(fila) : null
  }

  async crear(cierre: CierreTrabajo): Promise<boolean> {
    try {
      await this.client.cierreTrabajo.create({
        data: {
          tenantId: cierre.tenantId,
          trabajoId: cierre.trabajoId,
          prestadorTenantId: cierre.prestadorTenantId,
          finalizadoEn: new Date(cierre.finishedAt),
          finalizadoPor: cierre.finishedBy,
          evidencia: cierre.evidence,
          confirmacionVenceEn: new Date(cierre.confirmationDueAt),
          fechaCreacion: new Date(cierre.createdAt),
          fechaActualizacion: new Date(cierre.updatedAt),
        },
      })
      return true
    } catch (error) {
      // The primary key: that work already has its closing row.
      if ((error as { code?: string } | null)?.code === 'P2002') return false
      throw error
    }
  }

  async confirmar(input: { tenantId: string; trabajoId: string; origin: OrigenConfirmacion; at: string }): Promise<boolean> {
    const at = new Date(input.at)
    const { count } = await this.client.cierreTrabajo.updateMany({ where: { tenantId: input.tenantId, trabajoId: input.trabajoId, ...ABIERTO }, data: { confirmadoEn: at, confirmacionOrigen: input.origin, fechaActualizacion: at } })
    return count === 1
  }

  async observar(input: { tenantId: string; trabajoId: string; reason: string; at: string }): Promise<boolean> {
    const at = new Date(input.at)
    const { count } = await this.client.cierreTrabajo.updateMany({ where: { tenantId: input.tenantId, trabajoId: input.trabajoId, ...ABIERTO }, data: { observadoEn: at, observacionMotivo: input.reason, observacionResueltaEn: null, fechaActualizacion: at } })
    return count === 1
  }

  async resolverObservacion(input: { tenantId: string; trabajoId: string; at: string }): Promise<boolean> {
    const at = new Date(input.at)
    const { count } = await this.client.cierreTrabajo.updateMany({ where: { tenantId: input.tenantId, trabajoId: input.trabajoId, observadoEn: { not: null }, observacionResueltaEn: null }, data: { observacionResueltaEn: at, fechaActualizacion: at } })
    return count === 1
  }

  async vencidos(input: { now: string; limit: number }): Promise<CierreTrabajo[]> {
    const filas = await this.client.cierreTrabajo.findMany({ where: { ...ABIERTO, confirmacionVenceEn: { lte: new Date(input.now) } }, orderBy: [{ confirmacionVenceEn: 'asc' }, { trabajoId: 'asc' }], take: input.limit })
    return filas.map(cierreDe).filter((cierre) => !observacionAbierta(cierre))
  }

  // The turno of an order as the closing needs it.
  async reserva(input: { prestadorTenantId: string; reservaId: string }): Promise<{ status: string; startsAt: string } | null> {
    const fila = await this.client.reserva.findFirst({ where: { tenantId: input.prestadorTenantId, reservaId: input.reservaId } })
    return fila ? { status: String(fila['estado']), startsAt: iso(fila['fechaInicio'])! } : null
  }

  // confirmed -> completed, once. false: the turno was not confirmed (already completed, or gone).
  async completarReserva(input: { prestadorTenantId: string; reservaId: string; at: string }): Promise<boolean> {
    const { count } = await this.client.reserva.updateMany({ where: { tenantId: input.prestadorTenantId, reservaId: input.reservaId, estado: 'confirmed' }, data: { estado: 'completed', fechaActualizacion: new Date(input.at) } })
    return count === 1
  }
}
