import type { CategoriaSolicitud, EstadoSolicitud, SolicitudServicio, UrgenciaSolicitud } from './modelo.ts'
import type { AlmacenSolicitudes } from './puertos.ts'

// ---- en memoria (tests y composición local) -------------------------------------------------

export class AlmacenSolicitudesEnMemoria implements AlmacenSolicitudes {
  readonly solicitudes = new Map<string, SolicitudServicio>()

  async guardar(solicitud: SolicitudServicio) {
    this.solicitudes.set(solicitud.id, { ...solicitud })
  }

  async listarAbiertas(input: { ahora: number; categoria?: CategoriaSolicitud; limite: number }) {
    return [...this.solicitudes.values()]
      .filter((item) => item.estado === 'abierta' && item.expiraEn > input.ahora && (!input.categoria || item.categoria === input.categoria))
      .sort((a, b) => b.creadaEn - a.creadaEn)
      .slice(0, input.limite)
      .map((item) => ({ ...item }))
  }

  async listarDeCuenta(cuentaId: string) {
    return [...this.solicitudes.values()]
      .filter((item) => item.cuentaId === cuentaId)
      .sort((a, b) => b.creadaEn - a.creadaEn)
      .map((item) => ({ ...item }))
  }

  async contarPublicadasDesde(cuentaId: string, desde: number) {
    return [...this.solicitudes.values()].filter((item) => item.cuentaId === cuentaId && item.creadaEn >= desde).length
  }

  async contarAbiertas(cuentaId: string, ahora: number) {
    return [...this.solicitudes.values()].filter((item) => item.cuentaId === cuentaId && item.estado === 'abierta' && item.expiraEn > ahora).length
  }

  async cerrar(input: { id: string; cuentaId: string; ahora: number }) {
    const item = this.solicitudes.get(input.id)
    if (!item || item.cuentaId !== input.cuentaId || item.estado !== 'abierta') return false
    item.estado = 'cerrada'
    item.actualizadaEn = input.ahora
    return true
  }
}

// ---- PostgreSQL (tabla solicitudes_servicio) -------------------------------------------------

type Fila = Record<string, unknown>

interface DelegadoSolicitudes {
  create(input: { data: Fila }): Promise<Fila>
  findMany(input: { where: Fila; orderBy?: Fila; take?: number }): Promise<Fila[]>
  count(input: { where: Fila }): Promise<number>
  updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }>
}

export interface ClientePrismaSolicitudes {
  solicitudServicio: DelegadoSolicitudes
}

const aFecha = (value: number) => new Date(value)
const desdeFecha = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value))

function desdeFila(fila: Fila): SolicitudServicio {
  return {
    id: String(fila['id']),
    cuentaId: String(fila['cuentaId']),
    categoria: fila['categoria'] as CategoriaSolicitud,
    titulo: String(fila['titulo']),
    descripcion: (fila['descripcion'] as string | null) ?? null,
    nombrePublico: String(fila['nombrePublico']),
    zona: String(fila['zona']),
    latitud: Number(fila['latitud']),
    longitud: Number(fila['longitud']),
    presupuestoMaximo: fila['presupuestoMaximo'] === null || fila['presupuestoMaximo'] === undefined ? null : Number(fila['presupuestoMaximo']),
    urgencia: fila['urgencia'] as UrgenciaSolicitud,
    estado: fila['estado'] as EstadoSolicitud,
    creadaEn: desdeFecha(fila['creadaEn']),
    actualizadaEn: desdeFecha(fila['actualizadaEn']),
    expiraEn: desdeFecha(fila['expiraEn']),
  }
}

export class AlmacenSolicitudesPrisma implements AlmacenSolicitudes {
  constructor(private readonly client: ClientePrismaSolicitudes) {}

  async guardar(solicitud: SolicitudServicio) {
    await this.client.solicitudServicio.create({
      data: {
        ...solicitud,
        creadaEn: aFecha(solicitud.creadaEn),
        actualizadaEn: aFecha(solicitud.actualizadaEn),
        expiraEn: aFecha(solicitud.expiraEn),
      },
    })
  }

  async listarAbiertas(input: { ahora: number; categoria?: CategoriaSolicitud; limite: number }) {
    const filas = await this.client.solicitudServicio.findMany({
      where: { estado: 'abierta', expiraEn: { gt: aFecha(input.ahora) }, ...(input.categoria ? { categoria: input.categoria } : {}) },
      orderBy: { creadaEn: 'desc' },
      take: input.limite,
    })
    return filas.map(desdeFila)
  }

  async listarDeCuenta(cuentaId: string) {
    const filas = await this.client.solicitudServicio.findMany({ where: { cuentaId }, orderBy: { creadaEn: 'desc' }, take: 50 })
    return filas.map(desdeFila)
  }

  async contarPublicadasDesde(cuentaId: string, desde: number) {
    return this.client.solicitudServicio.count({ where: { cuentaId, creadaEn: { gte: aFecha(desde) } } })
  }

  async contarAbiertas(cuentaId: string, ahora: number) {
    return this.client.solicitudServicio.count({ where: { cuentaId, estado: 'abierta', expiraEn: { gt: aFecha(ahora) } } })
  }

  async cerrar(input: { id: string; cuentaId: string; ahora: number }) {
    const result = await this.client.solicitudServicio.updateMany({
      where: { id: input.id, cuentaId: input.cuentaId, estado: 'abierta' },
      data: { estado: 'cerrada', actualizadaEn: aFecha(input.ahora) },
    })
    return result.count === 1
  }
}
