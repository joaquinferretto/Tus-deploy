import type {
  CategoriaSolicitud,
  EstadoAsignacion,
  EstadoPostulacion,
  EstadoSolicitud,
  ImagenSolicitud,
  OrigenSolicitud,
  PostulacionSolicitud,
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
  readonly postulaciones = new Map<string, PostulacionSolicitud>()

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
    // Cerrar la solicitud responde a quienes seguían esperando.
    for (const postulacion of this.postulaciones.values())
      if (postulacion.solicitudId === item.id && postulacion.estado === 'pendiente') Object.assign(postulacion, { estado: 'rechazada', actualizadaEn: input.ahora })
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

  async guardarPostulacion(postulacion: PostulacionSolicitud) {
    if ([...this.postulaciones.values()].some((item) => item.solicitudId === postulacion.solicitudId && item.prestadorTenantId === postulacion.prestadorTenantId)) throw unique()
    this.postulaciones.set(postulacion.id, { ...postulacion })
  }

  async postulacionesDe(solicitudId: string) {
    return [...this.postulaciones.values()]
      .filter((item) => item.solicitudId === solicitudId)
      .sort((a, b) => a.creadaEn - b.creadaEn)
      .map((item) => ({ ...item }))
  }

  async postulacionesDePrestador(prestadorTenantId: string) {
    return [...this.postulaciones.values()]
      .filter((item) => item.prestadorTenantId === prestadorTenantId)
      .sort((a, b) => b.creadaEn - a.creadaEn)
      .slice(0, 100)
      .map((item) => ({ ...item }))
  }

  async aceptarPostulacion(input: { solicitudId: string; cuentaId: string; postulacionId: string; ahora: number }) {
    const solicitud = this.solicitudes.get(input.solicitudId)
    const elegida = this.postulaciones.get(input.postulacionId)
    if (!solicitud || solicitud.cuentaId !== input.cuentaId || solicitud.visibilidad !== 'publica' || solicitud.estado !== 'abierta' || solicitud.expiraEn <= input.ahora) return false
    if (!elegida || elegida.solicitudId !== solicitud.id || elegida.estado !== 'pendiente') return false
    Object.assign(solicitud, {
      visibilidad: 'dirigida',
      prestadorTenantId: elegida.prestadorTenantId,
      prestadorId: elegida.prestadorId,
      estadoAsignacion: 'aceptada',
      respondidaEn: input.ahora,
      actualizadaEn: input.ahora,
    })
    for (const postulacion of this.postulaciones.values())
      if (postulacion.solicitudId === solicitud.id && postulacion.estado === 'pendiente')
        Object.assign(postulacion, { estado: postulacion.id === elegida.id ? 'aceptada' : 'rechazada', actualizadaEn: input.ahora })
    return true
  }

  async cerrarPostulacion(input: { postulacionId: string; estado: 'rechazada' | 'retirada'; solicitudId?: string; prestadorTenantId?: string; ahora: number }) {
    const postulacion = this.postulaciones.get(input.postulacionId)
    if (!postulacion || postulacion.estado !== 'pendiente') return false
    if (input.solicitudId !== undefined && postulacion.solicitudId !== input.solicitudId) return false
    if (input.prestadorTenantId !== undefined && postulacion.prestadorTenantId !== input.prestadorTenantId) return false
    Object.assign(postulacion, { estado: input.estado, actualizadaEn: input.ahora })
    return true
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

interface DelegadoPostulaciones {
  create(input: { data: Fila }): Promise<Fila>
  findFirst(input: { where: Fila }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila; take?: number }): Promise<Fila[]>
  updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }>
}

type DelegadosSolicitudes = {
  solicitudServicio: DelegadoSolicitudes
  imagenSolicitud: DelegadoImagenes
  postulacionSolicitud: DelegadoPostulaciones
}

export interface ClientePrismaSolicitudes extends DelegadosSolicitudes {
  $transaction<T>(operations: Promise<T>[]): Promise<T[]>
  // Transacción interactiva: lanzar dentro de `fn` revierte todo.
  $transaction<T>(fn: (tx: DelegadosSolicitudes) => Promise<T>): Promise<T>
}

// Señal interna para revertir la transacción de aceptación cuando una condición no se cumple.
class SinCambios extends Error {}

// Solo el orden de las fotos, nunca los bytes, al listar solicitudes.
const CON_IMAGENES = { imagenes: { select: { orden: true } } }

const aFecha = (value: number) => new Date(value)
const desdeFecha = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value))
const opcionalFecha = (value: unknown) => (value === null || value === undefined ? null : desdeFecha(value))

function desdeFilaPostulacion(fila: Fila): PostulacionSolicitud {
  return {
    id: String(fila['id']),
    solicitudId: String(fila['solicitudId']),
    prestadorTenantId: String(fila['prestadorTenantId']),
    prestadorId: String(fila['prestadorId']),
    mensaje: (fila['mensaje'] as string | null | undefined) ?? null,
    estado: fila['estado'] as EstadoPostulacion,
    creadaEn: desdeFecha(fila['fechaCreacion']),
    actualizadaEn: desdeFecha(fila['fechaActualizacion']),
  }
}

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
      // Cerrar la solicitud responde a quienes seguían esperando (solo si es de la cuenta).
      this.client.postulacionSolicitud.updateMany({
        where: { solicitudId: input.id, estado: 'pendiente', solicitud: { cuentaId: input.cuentaId } },
        data: { estado: 'rechazada', fechaActualizacion: aFecha(input.ahora) },
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

  async guardarPostulacion(postulacion: PostulacionSolicitud) {
    await this.client.postulacionSolicitud.create({
      data: {
        id: postulacion.id,
        solicitudId: postulacion.solicitudId,
        prestadorTenantId: postulacion.prestadorTenantId,
        prestadorId: postulacion.prestadorId,
        mensaje: postulacion.mensaje,
        estado: postulacion.estado,
        fechaCreacion: aFecha(postulacion.creadaEn),
        fechaActualizacion: aFecha(postulacion.actualizadaEn),
      },
    })
  }

  async postulacionesDe(solicitudId: string) {
    const filas = await this.client.postulacionSolicitud.findMany({ where: { solicitudId }, orderBy: { fechaCreacion: 'asc' }, take: 50 })
    return filas.map(desdeFilaPostulacion)
  }

  async postulacionesDePrestador(prestadorTenantId: string) {
    const filas = await this.client.postulacionSolicitud.findMany({ where: { prestadorTenantId }, orderBy: { fechaCreacion: 'desc' }, take: 100 })
    return filas.map(desdeFilaPostulacion)
  }

  async aceptarPostulacion(input: { solicitudId: string; cuentaId: string; postulacionId: string; ahora: number }) {
    const ahora = aFecha(input.ahora)
    try {
      await this.client.$transaction(async (tx) => {
        const elegida = await tx.postulacionSolicitud.findFirst({ where: { id: input.postulacionId, solicitudId: input.solicitudId, estado: 'pendiente' } })
        if (!elegida) throw new SinCambios()
        // El UPDATE condicional toma el lock de la fila: una segunda aceptación concurrente
        // re-evalúa el WHERE, ya no encuentra la solicitud pública y revierte.
        const solicitud = await tx.solicitudServicio.updateMany({
          where: { id: input.solicitudId, cuentaId: input.cuentaId, visibilidad: 'publica', estado: 'abierta', expiraEn: { gt: ahora } },
          data: {
            visibilidad: 'dirigida',
            prestadorTenantId: elegida['prestadorTenantId'],
            prestadorId: elegida['prestadorId'],
            estadoAsignacion: 'aceptada',
            respondidaEn: ahora,
            actualizadaEn: ahora,
          },
        })
        if (solicitud.count !== 1) throw new SinCambios()
        const aceptada = await tx.postulacionSolicitud.updateMany({ where: { id: input.postulacionId, estado: 'pendiente' }, data: { estado: 'aceptada', fechaActualizacion: ahora } })
        if (aceptada.count !== 1) throw new SinCambios()
        await tx.postulacionSolicitud.updateMany({ where: { solicitudId: input.solicitudId, estado: 'pendiente' }, data: { estado: 'rechazada', fechaActualizacion: ahora } })
      })
      return true
    } catch (error) {
      if (error instanceof SinCambios) return false
      // El índice parcial de un solo aceptado cubre cualquier carrera que el WHERE no vea.
      if ((error as { code?: unknown })?.code === 'P2002') return false
      throw error
    }
  }

  async cerrarPostulacion(input: { postulacionId: string; estado: 'rechazada' | 'retirada'; solicitudId?: string; prestadorTenantId?: string; ahora: number }) {
    const result = await this.client.postulacionSolicitud.updateMany({
      where: {
        id: input.postulacionId,
        estado: 'pendiente',
        ...(input.solicitudId !== undefined ? { solicitudId: input.solicitudId } : {}),
        ...(input.prestadorTenantId !== undefined ? { prestadorTenantId: input.prestadorTenantId } : {}),
      },
      data: { estado: input.estado, fechaActualizacion: aFecha(input.ahora) },
    })
    return result.count === 1
  }
}
