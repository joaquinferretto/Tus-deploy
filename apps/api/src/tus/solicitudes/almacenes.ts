import type {
  CategoriaSolicitud,
  EstadoAsignacion,
  EstadoSolicitud,
  ImagenSolicitud,
  OrigenSolicitud,
  SolicitudServicio,
  UrgenciaSolicitud,
  VisibilidadSolicitud,
} from './modelo.ts'
import type { AlmacenSolicitudes } from './puertos.ts'

const unique = () => Object.assign(new Error('unique violation'), { code: 'P2002' })

// ---- en memoria (tests y composición local) -------------------------------------------------

export class AlmacenSolicitudesEnMemoria implements AlmacenSolicitudes {
  readonly solicitudes = new Map<string, SolicitudServicio>()
  readonly imagenes = new Map<string, ImagenSolicitud>()

  private copia(solicitud: SolicitudServicio): SolicitudServicio {
    const imagenes = [...this.imagenes.values()].filter((imagen) => imagen.solicitudId === solicitud.id).map((imagen) => imagen.orden)
    return { ...solicitud, imagenes }
  }

  async guardar(solicitud: SolicitudServicio) {
    this.solicitudes.set(solicitud.id, { ...solicitud, imagenes: [] })
  }

  async obtener(id: string) {
    const found = this.solicitudes.get(id)
    return found ? this.copia(found) : null
  }

  async listarAbiertas(input: { ahora: number; categoria?: CategoriaSolicitud; limite: number }) {
    return [...this.solicitudes.values()]
      .filter((item) => item.visibilidad === 'publica' && item.estado === 'abierta' && item.expiraEn > input.ahora && (!input.categoria || item.categoria === input.categoria))
      .sort((a, b) => b.creadaEn - a.creadaEn)
      .slice(0, input.limite)
      .map((item) => this.copia(item))
  }

  async listarDeCuenta(cuentaId: string) {
    return [...this.solicitudes.values()]
      .filter((item) => item.cuentaId === cuentaId)
      .sort((a, b) => b.creadaEn - a.creadaEn)
      .map((item) => this.copia(item))
  }

  async listarDirigidasA(prestadorTenantId: string) {
    return [...this.solicitudes.values()]
      .filter((item) => item.visibilidad === 'dirigida' && item.prestadorTenantId === prestadorTenantId)
      .sort((a, b) => b.creadaEn - a.creadaEn)
      .map((item) => this.copia(item))
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
    if (item.estadoAsignacion === 'pendiente') item.estadoAsignacion = 'cancelada'
    item.actualizadaEn = input.ahora
    return true
  }

  async responder(input: { id: string; prestadorTenantId: string; decision: 'aceptada' | 'rechazada'; ahora: number }) {
    const item = this.solicitudes.get(input.id)
    if (!item || item.prestadorTenantId !== input.prestadorTenantId || item.estadoAsignacion !== 'pendiente' || item.estado !== 'abierta') return false
    item.estadoAsignacion = input.decision
    if (input.decision === 'rechazada') item.estado = 'cerrada'
    item.respondidaEn = input.ahora
    item.actualizadaEn = input.ahora
    return true
  }

  async guardarImagen(imagen: ImagenSolicitud) {
    if ([...this.imagenes.values()].some((item) => item.solicitudId === imagen.solicitudId && item.orden === imagen.orden)) throw unique()
    this.imagenes.set(imagen.id, { ...imagen })
  }

  async imagen(solicitudId: string, orden: number) {
    const found = [...this.imagenes.values()].find((item) => item.solicitudId === solicitudId && item.orden === orden)
    return found ? { ...found } : null
  }
}

// ---- PostgreSQL (solicitudes_servicio + imagenes_solicitud) ----------------------------------

type Fila = Record<string, unknown>

interface DelegadoSolicitudes {
  create(input: { data: Fila }): Promise<Fila>
  findFirst(input: { where: Fila; include?: Fila }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila; take?: number; include?: Fila }): Promise<Fila[]>
  count(input: { where: Fila }): Promise<number>
  updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }>
}

interface DelegadoImagenes {
  create(input: { data: Fila }): Promise<Fila>
  findFirst(input: { where: Fila }): Promise<Fila | null>
}

export interface ClientePrismaSolicitudes {
  solicitudServicio: DelegadoSolicitudes
  imagenSolicitud: DelegadoImagenes
  $transaction<T>(operations: Promise<T>[]): Promise<T[]>
}

// Solo el orden de las fotos, nunca los bytes, al listar solicitudes.
const CON_IMAGENES = { imagenes: { select: { orden: true } } }

const aFecha = (value: number) => new Date(value)
const desdeFecha = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value))
const opcionalFecha = (value: unknown) => (value === null || value === undefined ? null : desdeFecha(value))

function desdeFila(fila: Fila): SolicitudServicio {
  const imagenes = Array.isArray(fila['imagenes']) ? (fila['imagenes'] as Fila[]).map((imagen) => Number(imagen['orden'])) : []
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
    origen: (fila['origen'] as OrigenSolicitud | undefined) ?? 'web_publica',
    visibilidad: (fila['visibilidad'] as VisibilidadSolicitud | undefined) ?? 'publica',
    prestadorTenantId: (fila['prestadorTenantId'] as string | null | undefined) ?? null,
    prestadorId: (fila['prestadorId'] as string | null | undefined) ?? null,
    estadoAsignacion: (fila['estadoAsignacion'] as EstadoAsignacion | null | undefined) ?? null,
    respondidaEn: opcionalFecha(fila['respondidaEn']),
    imagenes,
  }
}

export class AlmacenSolicitudesPrisma implements AlmacenSolicitudes {
  constructor(private readonly client: ClientePrismaSolicitudes) {}

  async guardar(solicitud: SolicitudServicio) {
    // `imagenes` is derived from imagenes_solicitud, never a column.
    const datos: Partial<SolicitudServicio> = { ...solicitud }
    delete datos.imagenes
    await this.client.solicitudServicio.create({
      data: {
        ...datos,
        creadaEn: aFecha(solicitud.creadaEn),
        actualizadaEn: aFecha(solicitud.actualizadaEn),
        expiraEn: aFecha(solicitud.expiraEn),
        respondidaEn: solicitud.respondidaEn === null ? null : aFecha(solicitud.respondidaEn),
      },
    })
  }

  async obtener(id: string) {
    const fila = await this.client.solicitudServicio.findFirst({ where: { id }, include: CON_IMAGENES })
    return fila ? desdeFila(fila) : null
  }

  async listarAbiertas(input: { ahora: number; categoria?: CategoriaSolicitud; limite: number }) {
    const filas = await this.client.solicitudServicio.findMany({
      where: { visibilidad: 'publica', estado: 'abierta', expiraEn: { gt: aFecha(input.ahora) }, ...(input.categoria ? { categoria: input.categoria } : {}) },
      orderBy: { creadaEn: 'desc' },
      take: input.limite,
      include: CON_IMAGENES,
    })
    return filas.map(desdeFila)
  }

  async listarDeCuenta(cuentaId: string) {
    const filas = await this.client.solicitudServicio.findMany({ where: { cuentaId }, orderBy: { creadaEn: 'desc' }, take: 50, include: CON_IMAGENES })
    return filas.map(desdeFila)
  }

  async listarDirigidasA(prestadorTenantId: string) {
    const filas = await this.client.solicitudServicio.findMany({
      where: { visibilidad: 'dirigida', prestadorTenantId },
      orderBy: { creadaEn: 'desc' },
      take: 100,
      include: CON_IMAGENES,
    })
    return filas.map(desdeFila)
  }

  async contarPublicadasDesde(cuentaId: string, desde: number) {
    return this.client.solicitudServicio.count({ where: { cuentaId, creadaEn: { gte: aFecha(desde) } } })
  }

  async contarAbiertas(cuentaId: string, ahora: number) {
    return this.client.solicitudServicio.count({ where: { cuentaId, estado: 'abierta', expiraEn: { gt: aFecha(ahora) } } })
  }

  async cerrar(input: { id: string; cuentaId: string; ahora: number }) {
    // Dos updates condicionales en una transacción: una dirigida pendiente queda 'cancelada'.
    const [pendiente, resto] = await this.client.$transaction([
      this.client.solicitudServicio.updateMany({
        where: { id: input.id, cuentaId: input.cuentaId, estado: 'abierta', estadoAsignacion: 'pendiente' },
        data: { estado: 'cerrada', estadoAsignacion: 'cancelada', actualizadaEn: aFecha(input.ahora) },
      }),
      this.client.solicitudServicio.updateMany({
        // Explícito: en SQL `NOT (x = 'pendiente')` excluiría las públicas (asignación NULL).
        where: { id: input.id, cuentaId: input.cuentaId, estado: 'abierta', OR: [{ estadoAsignacion: null }, { estadoAsignacion: { in: ['aceptada', 'rechazada', 'cancelada'] } }] },
        data: { estado: 'cerrada', actualizadaEn: aFecha(input.ahora) },
      }),
    ])
    return pendiente!.count + resto!.count === 1
  }

  async responder(input: { id: string; prestadorTenantId: string; decision: 'aceptada' | 'rechazada'; ahora: number }) {
    const result = await this.client.solicitudServicio.updateMany({
      where: { id: input.id, prestadorTenantId: input.prestadorTenantId, visibilidad: 'dirigida', estado: 'abierta', estadoAsignacion: 'pendiente' },
      data: {
        estadoAsignacion: input.decision,
        respondidaEn: aFecha(input.ahora),
        actualizadaEn: aFecha(input.ahora),
        ...(input.decision === 'rechazada' ? { estado: 'cerrada' } : {}),
      },
    })
    return result.count === 1
  }

  async guardarImagen(imagen: ImagenSolicitud) {
    await this.client.imagenSolicitud.create({
      data: {
        id: imagen.id,
        solicitudId: imagen.solicitudId,
        orden: imagen.orden,
        tipoMime: imagen.tipoMime,
        tamanoBytes: imagen.tamanoBytes,
        sha256: imagen.sha256,
        contenido: imagen.contenido,
        fechaCreacion: aFecha(imagen.creadaEn),
      },
    })
  }

  async imagen(solicitudId: string, orden: number) {
    const fila = await this.client.imagenSolicitud.findFirst({ where: { solicitudId, orden } })
    if (!fila) return null
    return {
      id: String(fila['id']),
      solicitudId: String(fila['solicitudId']),
      orden: Number(fila['orden']),
      tipoMime: fila['tipoMime'] as ImagenSolicitud['tipoMime'],
      tamanoBytes: Number(fila['tamanoBytes']),
      sha256: String(fila['sha256']),
      contenido: Buffer.from(fila['contenido'] as Uint8Array),
      creadaEn: desdeFecha(fila['fechaCreacion']),
    }
  }
}
