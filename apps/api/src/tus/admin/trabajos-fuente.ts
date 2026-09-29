import type { PrismaClient } from '@prisma/client'

// FASE 10: what platform support needs to follow a service end to end
// (request -> chosen provider -> work -> budget -> deposit -> balance -> cancellations -> rating).
// Read-only. Every page is a FIXED number of batched reads (never one query per row). No tokens,
// credentials, chat messages or full provider payment ids ever leave this module.

export interface ParteAdminPago {
  parte: 'total' | 'sena' | 'saldo'
  montoMinor: string
  moneda: string
  estado: string
}

export interface FilaAdminTrabajo {
  id: string
  origen: 'marketplace' | 'solicitud'
  solicitudId: string | null
  titulo: string
  cliente: string
  prestador: string
  estado: string
  version: number
  presupuesto: { totalMinor: string; moneda: string } | null
  pagos: ParteAdminPago[]
  cancelacion: { rol: string; motivo: string } | null
  cancelacionSolicitada: { fecha: string; motivo: string } | null
  calificacion: number | null
  terminadoEn: string | null
  creadoEn: string
  actualizadoEn: string
}

export interface PagoAdmin {
  pagoId: string
  trabajoId: string
  parte: 'total' | 'sena' | 'saldo'
  montoMinor: string
  moneda: string
  estado: string
  comisionMinor: string | null
  netoPrestadorMinor: string | null
  feeMercadoPagoMinor: string | null
  // Only the last 4 characters of the Mercado Pago payment id.
  referencia: string | null
  error: string | null
  creadoEn: string
  actualizadoEn: string
}

export interface DetalleAdminTrabajo extends FilaAdminTrabajo {
  transiciones: { de: string | null; a: string; motivo: string; fecha: string }[]
  pagosDetalle: PagoAdmin[]
  calificacionDetalle: { puntuacion: number; comentario: string | null; fecha: string } | null
  liquidaciones: { parte: string; estado: string; brutoMinor: string; comisionMinor: string; netoMinor: string }[]
}

export interface FuenteTrabajosAdmin {
  pagina(input: { pagina: number; tamano: number; q: string; estado: string }): Promise<{ items: FilaAdminTrabajo[]; total: number }>
  detalle(trabajoId: string): Promise<DetalleAdminTrabajo | null>
  pagos(input: { pagina: number; tamano: number; estado: string }): Promise<{ items: PagoAdmin[]; total: number }>
}

export function referenciaParcial(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length <= 4 ? '••••' : `•••• ${value.slice(-4)}`
}

type Cliente = Pick<
  PrismaClient,
  | 'trabajo'
  | 'solicitudServicio'
  | 'perfilPublicoPrestador'
  | 'presupuesto'
  | 'obligacionPagoServicio'
  | 'intencionPago'
  | 'instantaneaComision'
  | 'liquidacionServicio'
  | 'transicionTrabajo'
  | 'calificacionTrabajo'
>

const ESTADOS = ['requested', 'in_diagnosis', 'budget_pending', 'accepted', 'in_progress', 'completed', 'cancelled']
const ESTADOS_PAGO = ['pending', 'approved', 'rejected', 'expired', 'cancelled', 'refunded', 'charged_back']
const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null)
const texto = (value: bigint | number | null | undefined) =>
  value === null || value === undefined ? null : String(value)

export class FuenteTrabajosAdminPrisma implements FuenteTrabajosAdmin {
  constructor(private readonly db: Cliente) {}

  async pagina(input: { pagina: number; tamano: number; q: string; estado: string }) {
    const where = {
      ...(ESTADOS.includes(input.estado) ? { estado: input.estado } : {}),
      ...(input.q
        ? {
            OR: [
              { trabajoId: { contains: input.q } },
              { solicitudId: { contains: input.q } },
              { solicitud: { is: { titulo: { contains: input.q, mode: 'insensitive' as const } } } },
            ],
          }
        : {}),
    }
    const [filas, total] = await Promise.all([
      this.db.trabajo.findMany({
        where,
        orderBy: { fechaActualizacion: 'desc' },
        skip: (input.pagina - 1) * input.tamano,
        take: input.tamano,
      }),
      this.db.trabajo.count({ where }),
    ])
    return { items: await this.enriquecer(filas), total }
  }

  async detalle(trabajoId: string): Promise<DetalleAdminTrabajo | null> {
    const fila = await this.db.trabajo.findFirst({ where: { trabajoId } })
    if (!fila) return null
    const [base] = await this.enriquecer([fila])
    const [transiciones, calificacion, obligaciones] = await Promise.all([
      this.db.transicionTrabajo.findMany({
        where: { tenantId: fila.tenantId, trabajoId },
        orderBy: { version: 'asc' },
      }),
      this.db.calificacionTrabajo.findFirst({ where: { tenantId: fila.tenantId, trabajoId } }),
      this.db.obligacionPagoServicio.findMany({ where: { tenantId: fila.tenantId, trabajoId } }),
    ])
    const ids = obligaciones.map((o) => o.obligacionId)
    const [intents, liquidaciones] = await Promise.all([
      ids.length
        ? this.db.intencionPago.findMany({
            where: { tenantId: fila.tenantId, obligacionId: { in: ids } },
            orderBy: { fechaCreacion: 'asc' },
          })
        : Promise.resolve([]),
      ids.length
        ? this.db.liquidacionServicio.findMany({ where: { tenantId: fila.tenantId, obligacionId: { in: ids } } })
        : Promise.resolve([]),
    ])
    const parteDe = new Map(obligaciones.map((o) => [o.obligacionId, o.tramo as ParteAdminPago['parte']]))
    return {
      ...base!,
      transiciones: transiciones.map((t) => ({
        de: t.estadoAnterior,
        a: t.estadoNuevo,
        motivo: t.motivo,
        fecha: t.fechaCreacion.toISOString(),
      })),
      pagosDetalle: await this.proyectarPagos(intents, parteDe),
      calificacionDetalle: calificacion
        ? { puntuacion: calificacion.puntuacion, comentario: calificacion.comentario, fecha: calificacion.fechaCreacion.toISOString() }
        : null,
      liquidaciones: liquidaciones.map((l) => ({
        parte: parteDe.get(l.obligacionId) ?? 'total',
        estado: l.estado,
        brutoMinor: String(l.montoBruto),
        comisionMinor: String(l.montoComision),
        netoMinor: String(l.montoNeto),
      })),
    }
  }

  async pagos(input: { pagina: number; tamano: number; estado: string }) {
    const where = {
      obligacionId: { not: null },
      ...(ESTADOS_PAGO.includes(input.estado) ? { estadoProveedor: input.estado } : {}),
    }
    const [intents, total] = await Promise.all([
      this.db.intencionPago.findMany({
        where,
        orderBy: { fechaCreacion: 'desc' },
        skip: (input.pagina - 1) * input.tamano,
        take: input.tamano,
      }),
      this.db.intencionPago.count({ where }),
    ])
    const ids = [...new Set(intents.map((i) => i.obligacionId).filter((id): id is string => Boolean(id)))]
    const obligaciones = ids.length
      ? await this.db.obligacionPagoServicio.findMany({ where: { obligacionId: { in: ids } } })
      : []
    const parteDe = new Map(obligaciones.map((o) => [o.obligacionId, o.tramo as ParteAdminPago['parte']]))
    return { items: await this.proyectarPagos(intents, parteDe), total }
  }

  // Obligation snapshots of a set of payments in ONE read.
  private async proyectarPagos(
    intents: Awaited<ReturnType<Cliente['intencionPago']['findMany']>>,
    parteDe: Map<string, ParteAdminPago['parte']>
  ): Promise<PagoAdmin[]> {
    const ids = [...new Set(intents.map((i) => i.obligacionId).filter((id): id is string => Boolean(id)))]
    const snapshots = ids.length
      ? await this.db.instantaneaComision.findMany({ where: { obligacionId: { in: ids } } })
      : []
    const snapshotDe = new Map(snapshots.map((s) => [s.obligacionId, s]))
    return intents.map((i) => {
      const snapshot = i.estadoProveedor === 'approved' || i.estadoProveedor === 'refunded' ? snapshotDe.get(i.obligacionId ?? '') : undefined
      return {
        pagoId: i.pagoId,
        trabajoId: i.ordenId,
        parte: parteDe.get(i.obligacionId ?? '') ?? 'total',
        montoMinor: String(i.monto),
        moneda: i.moneda,
        estado: i.estadoProveedor,
        comisionMinor: texto(snapshot?.montoComision ?? i.comisionMarketplace),
        netoPrestadorMinor: texto(snapshot?.netoPrestador),
        feeMercadoPagoMinor: texto(snapshot?.comisionProveedorPago),
        referencia: referenciaParcial(i.referenciaProveedor),
        error: i.errorProveedor,
        creadoEn: i.fechaCreacion.toISOString(),
        actualizadoEn: i.fechaActualizacion.toISOString(),
      }
    })
  }

  // Batched enrichment of a page: requests, profiles, accepted budgets, obligations and ratings.
  private async enriquecer(filas: Awaited<ReturnType<Cliente['trabajo']['findMany']>>): Promise<FilaAdminTrabajo[]> {
    if (!filas.length) return []
    const solicitudIds = [...new Set(filas.flatMap((f) => (f.solicitudId ? [f.solicitudId] : [])))]
    const tenantsPrestador = [...new Set(filas.map((f) => f.prestadorTenantId))]
    const claves = filas.map((f) => ({ tenantId: f.tenantId, trabajoId: f.trabajoId }))
    const [solicitudes, perfiles, presupuestos, obligaciones, calificaciones] = await Promise.all([
      solicitudIds.length
        ? this.db.solicitudServicio.findMany({ where: { id: { in: solicitudIds } }, select: { id: true, titulo: true, nombrePublico: true } })
        : Promise.resolve([]),
      this.db.perfilPublicoPrestador.findMany({ where: { tenantId: { in: tenantsPrestador } }, select: { tenantId: true, nombrePublico: true } }),
      this.db.presupuesto.findMany({
        where: {
          OR: filas.flatMap((f) =>
            f.presupuestoAceptadoId && f.presupuestoAceptadoVersion
              ? [{ tenantId: f.tenantId, presupuestoId: f.presupuestoAceptadoId, version: f.presupuestoAceptadoVersion }]
              : []
          ),
        },
        select: { tenantId: true, presupuestoId: true, version: true, montoTotal: true, moneda: true },
      }),
      this.db.obligacionPagoServicio.findMany({
        where: { OR: claves },
        select: { tenantId: true, trabajoId: true, tramo: true, monto: true, moneda: true, estado: true },
      }),
      this.db.calificacionTrabajo.findMany({ where: { OR: claves }, select: { tenantId: true, trabajoId: true, puntuacion: true } }),
    ])
    const solicitudDe = new Map(solicitudes.map((s) => [s.id, s]))
    const perfilDe = new Map(perfiles.map((p) => [p.tenantId, p.nombrePublico]))
    const k = (tenantId: string, id: string) => `${tenantId}\u0000${id}`
    const presupuestoDe = new Map(presupuestos.map((p) => [k(p.tenantId, `${p.presupuestoId}@${p.version}`), p]))
    const pagosDe = new Map<string, ParteAdminPago[]>()
    for (const o of obligaciones) {
      const key = k(o.tenantId, o.trabajoId)
      pagosDe.set(key, [
        ...(pagosDe.get(key) ?? []),
        { parte: o.tramo as ParteAdminPago['parte'], montoMinor: String(o.monto), moneda: o.moneda, estado: o.estado },
      ])
    }
    const calificacionDe = new Map(calificaciones.map((c) => [k(c.tenantId, c.trabajoId), c.puntuacion]))
    return filas.map((f) => {
      const solicitud = f.solicitudId ? solicitudDe.get(f.solicitudId) : undefined
      const presupuesto =
        f.presupuestoAceptadoId && f.presupuestoAceptadoVersion
          ? presupuestoDe.get(k(f.tenantId, `${f.presupuestoAceptadoId}@${f.presupuestoAceptadoVersion}`))
          : undefined
      return {
        id: f.trabajoId,
        origen: f.origen === 'solicitud' ? 'solicitud' : 'marketplace',
        solicitudId: f.solicitudId,
        titulo: solicitud?.titulo ?? 'Trabajo del marketplace',
        cliente: solicitud?.nombrePublico ?? 'Cliente',
        prestador: perfilDe.get(f.prestadorTenantId) ?? 'Prestador',
        estado: f.estado,
        version: f.version,
        presupuesto: presupuesto ? { totalMinor: String(presupuesto.montoTotal), moneda: presupuesto.moneda } : null,
        pagos: (pagosDe.get(k(f.tenantId, f.trabajoId)) ?? []).sort((a, b) => a.parte.localeCompare(b.parte)).reverse(),
        cancelacion: f.canceladoPorRol && f.motivoCancelacion ? { rol: f.canceladoPorRol, motivo: f.motivoCancelacion } : null,
        cancelacionSolicitada:
          f.cancelacionSolicitadaEn && f.cancelacionSolicitadaMotivo
            ? { fecha: f.cancelacionSolicitadaEn.toISOString(), motivo: f.cancelacionSolicitadaMotivo }
            : null,
        calificacion: calificacionDe.get(k(f.tenantId, f.trabajoId)) ?? null,
        terminadoEn: iso(f.terminadoEn),
        creadoEn: f.fechaCreacion.toISOString(),
        actualizadoEn: f.fechaActualizacion.toISOString(),
      }
    })
  }
}
