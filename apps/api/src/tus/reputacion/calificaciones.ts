import type { Trabajo, WorkRating } from '@factory/contracts'

// Provider reputation (FASE 9). Rules:
// - only the client of the work (its customer tenant, from the session) rates, once;
// - only a `completed` work (never cancelled or in progress);
// - score 1..5 (integer) and an optional comment (max 500);
// - provider ids come from the persisted work, never from the request;
// - ratings are append-only (the database refuses updates/deletes);
// - averages are computed server-side in one grouped read for any set of providers.

export const LARGO_MAXIMO_COMENTARIO_CALIFICACION = 500

export interface CalificacionTrabajo {
  id: string
  tenantId: string
  trabajoId: string
  prestadorTenantId: string
  prestadorId: string
  autorCuentaId: string
  puntuacion: number
  comentario: string | null
  creadaEn: string
}

export interface ResumenReputacion {
  average: number
  count: number
}

export interface AlmacenCalificaciones {
  // false when the work already has a rating (unique per work).
  crear(calificacion: CalificacionTrabajo): Promise<boolean>
  deTrabajo(input: { tenantId: string; trabajoId: string }): Promise<CalificacionTrabajo | null>
  // One grouped read (GROUP BY provider tenant) for every requested provider.
  resumen(prestadorTenantIds: readonly string[]): Promise<Map<string, ResumenReputacion>>
}

export interface TrabajosCalificables {
  buscarAccesible(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null>
}

export class ErrorCalificacion extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ErrorCalificacion'
  }
}

export function proyectarCalificacion(item: CalificacionTrabajo): WorkRating {
  return { score: item.puntuacion, comment: item.comentario, createdAt: item.creadaEn }
}

export class ServicioCalificaciones {
  constructor(
    private readonly deps: {
      almacen: AlmacenCalificaciones
      trabajos: TrabajosCalificables
      now?: () => number
      newId?: () => string
    }
  ) {}

  async calificar(input: {
    tenantId: string
    cuentaId: string
    trabajoId: string
    score: unknown
    comment: unknown
  }): Promise<WorkRating> {
    const work = await this.deps.trabajos.buscarAccesible({ tenantId: input.tenantId, trabajoId: input.trabajoId })
    if (!work) throw new ErrorCalificacion(404, 'NOT_FOUND', 'work not found')
    if (work.tenantId !== input.tenantId)
      throw new ErrorCalificacion(403, 'FORBIDDEN', 'only the client of the work can rate it')
    if (work.status === 'cancelled') throw new ErrorCalificacion(409, 'WORK_CANCELLED', 'a cancelled work cannot be rated')
    if (work.status !== 'completed') throw new ErrorCalificacion(409, 'WORK_NOT_COMPLETED', 'only a completed work can be rated')
    const score = input.score
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5)
      throw new ErrorCalificacion(400, 'INVALID_SCORE', 'score must be an integer from 1 to 5')
    const comment = typeof input.comment === 'string' ? input.comment.trim() : ''
    if (input.comment !== undefined && input.comment !== null && typeof input.comment !== 'string')
      throw new ErrorCalificacion(400, 'INVALID', 'comment must be text')
    if (comment.length > LARGO_MAXIMO_COMENTARIO_CALIFICACION)
      throw new ErrorCalificacion(400, 'INVALID', 'comment is too long')
    const calificacion: CalificacionTrabajo = {
      id: (this.deps.newId ?? (() => crypto.randomUUID()))(),
      tenantId: work.tenantId,
      trabajoId: work.trabajoId,
      prestadorTenantId: work.prestadorTenantId,
      prestadorId: work.prestadorId,
      autorCuentaId: input.cuentaId,
      puntuacion: score,
      comentario: comment || null,
      creadaEn: new Date((this.deps.now ?? Date.now)()).toISOString(),
    }
    if (!(await this.deps.almacen.crear(calificacion)))
      throw new ErrorCalificacion(409, 'ALREADY_RATED', 'this work was already rated')
    return proyectarCalificacion(calificacion)
  }

  async deTrabajo(work: Trabajo): Promise<WorkRating | null> {
    const found = await this.deps.almacen.deTrabajo({ tenantId: work.tenantId, trabajoId: work.trabajoId })
    return found ? proyectarCalificacion(found) : null
  }

  resumen(prestadorTenantIds: readonly string[]): Promise<Map<string, ResumenReputacion>> {
    return prestadorTenantIds.length ? this.deps.almacen.resumen([...new Set(prestadorTenantIds)]) : Promise.resolve(new Map())
  }
}

const redondear = (value: number) => Math.round(value * 10) / 10

export class AlmacenCalificacionesEnMemoria implements AlmacenCalificaciones {
  readonly items = new Map<string, CalificacionTrabajo>()
  // Test hook: the store refuses ratings of works that are not completed (DB trigger parity).
  constructor(private readonly estadoTrabajo?: (tenantId: string, trabajoId: string) => Promise<string | null>) {}

  async crear(calificacion: CalificacionTrabajo): Promise<boolean> {
    const key = `${calificacion.tenantId}:${calificacion.trabajoId}`
    if (this.items.has(key)) return false
    if (this.estadoTrabajo && (await this.estadoTrabajo(calificacion.tenantId, calificacion.trabajoId)) !== 'completed')
      throw new ErrorCalificacion(409, 'WORK_NOT_COMPLETED', 'only a completed work can be rated')
    this.items.set(key, { ...calificacion })
    return true
  }

  async deTrabajo(input: { tenantId: string; trabajoId: string }) {
    const found = this.items.get(`${input.tenantId}:${input.trabajoId}`)
    return found ? { ...found } : null
  }

  async resumen(prestadorTenantIds: readonly string[]) {
    const wanted = new Set(prestadorTenantIds)
    const acc = new Map<string, { sum: number; count: number }>()
    for (const item of this.items.values()) {
      if (!wanted.has(item.prestadorTenantId)) continue
      const current = acc.get(item.prestadorTenantId) ?? { sum: 0, count: 0 }
      acc.set(item.prestadorTenantId, { sum: current.sum + item.puntuacion, count: current.count + 1 })
    }
    return new Map([...acc].map(([tenantId, value]) => [tenantId, { average: redondear(value.sum / value.count), count: value.count }]))
  }
}

type Fila = Record<string, unknown>
export interface ClientePrismaCalificaciones {
  calificacionTrabajo: {
    create(input: { data: Fila }): Promise<Fila>
    findFirst(input: { where: Fila }): Promise<Fila | null>
    groupBy(input: { by: string[]; where: Fila; _avg: Fila; _count: Fila }): Promise<Fila[]>
  }
}

function desdeFila(fila: Fila): CalificacionTrabajo {
  return {
    id: String(fila['id']),
    tenantId: String(fila['tenantId']),
    trabajoId: String(fila['trabajoId']),
    prestadorTenantId: String(fila['prestadorTenantId']),
    prestadorId: String(fila['prestadorId']),
    autorCuentaId: String(fila['autorCuentaId']),
    puntuacion: Number(fila['puntuacion']),
    comentario: fila['comentario'] === null || fila['comentario'] === undefined ? null : String(fila['comentario']),
    creadaEn: (fila['fechaCreacion'] as Date).toISOString(),
  }
}

export class AlmacenCalificacionesPrisma implements AlmacenCalificaciones {
  constructor(private readonly client: ClientePrismaCalificaciones) {}

  async crear(c: CalificacionTrabajo): Promise<boolean> {
    try {
      await this.client.calificacionTrabajo.create({
        data: {
          id: c.id,
          tenantId: c.tenantId,
          trabajoId: c.trabajoId,
          prestadorTenantId: c.prestadorTenantId,
          prestadorId: c.prestadorId,
          autorCuentaId: c.autorCuentaId,
          puntuacion: c.puntuacion,
          comentario: c.comentario,
          fechaCreacion: new Date(c.creadaEn),
        },
      })
      return true
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'P2002') return false
      // The completed-work trigger raises check_violation (23514).
      if (/only a completed work can be rated/u.test(String((error as Error).message)))
        throw new ErrorCalificacion(409, 'WORK_NOT_COMPLETED', 'only a completed work can be rated')
      throw error
    }
  }

  async deTrabajo(input: { tenantId: string; trabajoId: string }) {
    const fila = await this.client.calificacionTrabajo.findFirst({ where: { tenantId: input.tenantId, trabajoId: input.trabajoId } })
    return fila ? desdeFila(fila) : null
  }

  async resumen(prestadorTenantIds: readonly string[]) {
    const filas = await this.client.calificacionTrabajo.groupBy({
      by: ['prestadorTenantId'],
      where: { prestadorTenantId: { in: [...prestadorTenantIds] } },
      _avg: { puntuacion: true },
      _count: { _all: true },
    })
    return new Map(
      filas.map((fila) => [
        String(fila['prestadorTenantId']),
        {
          average: redondear(Number((fila['_avg'] as Fila)['puntuacion'])),
          count: Number((fila['_count'] as Fila)['_all']),
        },
      ])
    )
  }
}
