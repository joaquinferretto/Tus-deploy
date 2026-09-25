import { randomUUID } from 'node:crypto'

import { prepararImagenDocumento } from '../identidad/documentos.ts'
import {
  CATEGORIAS_SOLICITUD,
  IMAGENES_POR_SOLICITUD,
  LIMITES_SOLICITUD,
  ORIGENES_SOLICITUD,
  ORIGENES_WEB,
  TAMANO_MAXIMO_IMAGEN,
  nombrePublico,
  ubicacionAproximada,
  validarMensajePostulacion,
  validarNuevaSolicitud,
  vistaPostulacionPropia,
  vistaPropia,
  vistaPublica,
  vistaRecibida,
  type CampoSolicitud,
  type CategoriaSolicitud,
  type ImagenSolicitud,
  type OrigenSolicitud,
  type PostulacionSolicitud,
  type SolicitudServicio,
  type VistaPostulacionPropia,
  type VistaPostulante,
  type VistaPropiaSolicitud,
  type VistaPublicaSolicitud,
  type VistaSolicitudRecibida,
} from './modelo.ts'
import type { AlmacenSolicitudes, CuentasSolicitudes, DestinosSolicitud } from './puertos.ts'

const DIA_MS = 24 * 60 * 60 * 1000

export type CodigoErrorSolicitud =
  | 'ACCOUNT_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'PROVIDER_NOT_AVAILABLE'
  | 'SELF_REQUEST'
  | 'INVALID_IMAGE'
  | 'IMAGE_LIMIT'
  | 'ALREADY_APPLIED'
  | 'REQUEST_FULL'

export type ResultadoSolicitud<T> =
  | ({ ok: true } & T)
  | { ok: false; code: 'INVALID_REQUEST'; fields: CampoSolicitud[] }
  | { ok: false; code: CodigoErrorSolicitud; fields?: undefined }

export interface DependenciasSolicitudes {
  almacen: AlmacenSolicitudes
  cuentas: CuentasSolicitudes
  // Sin directorio no se pueden crear solicitudes dirigidas (fail closed).
  destinos?: DestinosSolicitud
  now?: () => number
  newId?: () => string
}

// Una sola solicitud TUS para el mapa público, el directorio ("Buscar trabajador"), el asistente
// Web y WhatsApp. El origen es metadata; las reglas (validación, límites, privacidad, aceptación
// del prestador) son las mismas para todos los canales.
export class ServicioSolicitudes {
  private readonly now: () => number
  private readonly newId: () => string

  constructor(private readonly deps: DependenciasSolicitudes) {
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? randomUUID
  }

  async listarPublicas(input: { categoria?: unknown } = {}): Promise<VistaPublicaSolicitud[]> {
    const categoria = (CATEGORIAS_SOLICITUD as readonly unknown[]).includes(input.categoria) ? (input.categoria as CategoriaSolicitud) : undefined
    const solicitudes = await this.deps.almacen.listarAbiertas({
      ahora: this.now(),
      limite: LIMITES_SOLICITUD.listadoPublicoMax,
      ...(categoria ? { categoria } : {}),
    })
    return solicitudes.filter((solicitud) => solicitud.visibilidad === 'publica').map(vistaPublica)
  }

  // `providerId` (id público del perfil) convierte la solicitud en dirigida a ese prestador.
  // `origen` lo decide el adaptador: la Web solo puede declarar orígenes Web.
  async publicar(
    cuentaId: string,
    body: Record<string, unknown>,
    opciones: { origen?: OrigenSolicitud } = {}
  ): Promise<ResultadoSolicitud<{ solicitud: VistaPropiaSolicitud }>> {
    const validacion = validarNuevaSolicitud(body)
    if (!validacion.ok) return { ok: false, code: 'INVALID_REQUEST', fields: validacion.campos }
    const cuenta = await this.deps.cuentas.getAccount(cuentaId)
    if (!cuenta || cuenta.status !== 'active' || !cuenta.emailVerifiedAt) return { ok: false, code: 'ACCOUNT_NOT_ALLOWED' }

    const providerId = body['providerId']
    let destino: Awaited<ReturnType<DestinosSolicitud['destino']>> = null
    if (providerId !== undefined && providerId !== null) {
      destino = this.deps.destinos ? await this.deps.destinos.destino(providerId) : null
      if (!destino) return { ok: false, code: 'PROVIDER_NOT_AVAILABLE' }
      if (destino.perfil.tenantId === cuenta.tenantId) return { ok: false, code: 'SELF_REQUEST' }
    }

    const ahora = this.now()
    const [recientes, abiertas] = await Promise.all([
      this.deps.almacen.contarPublicadasDesde(cuentaId, ahora - DIA_MS),
      this.deps.almacen.contarAbiertas(cuentaId, ahora),
    ])
    if (recientes >= LIMITES_SOLICITUD.publicacionesPorDia || abiertas >= LIMITES_SOLICITUD.abiertasPorCuenta) return { ok: false, code: 'RATE_LIMITED' }

    const origen: OrigenSolicitud = opciones.origen ?? (destino ? 'web_directory' : 'web_publica')
    const id = this.newId()
    const punto = ubicacionAproximada(validacion.valor.zona, id)
    const solicitud: SolicitudServicio = {
      id,
      cuentaId,
      ...validacion.valor,
      nombrePublico: nombrePublico(cuenta.displayName),
      latitud: punto.lat,
      longitud: punto.lng,
      estado: 'abierta',
      creadaEn: ahora,
      actualizadaEn: ahora,
      expiraEn: ahora + LIMITES_SOLICITUD.vigenciaDias * DIA_MS,
      origen,
      visibilidad: destino ? 'dirigida' : 'publica',
      prestadorTenantId: destino?.perfil.tenantId ?? null,
      prestadorId: destino?.perfil.prestadorId ?? null,
      estadoAsignacion: destino ? 'pendiente' : null,
      respondidaEn: null,
      imagenes: [],
    }
    await this.deps.almacen.guardar(solicitud)
    return { ok: true, solicitud: vistaPropia(solicitud, destino ? { id: destino.perfil.id, displayName: destino.perfil.nombrePublico } : null) }
  }

  // El origen que declara la Web se valida contra la lista de orígenes Web.
  origenWeb(value: unknown): OrigenSolicitud | undefined {
    return (ORIGENES_WEB as readonly unknown[]).includes(value) ? (value as OrigenSolicitud) : undefined
  }

  esOrigen(value: unknown): value is OrigenSolicitud {
    return (ORIGENES_SOLICITUD as readonly unknown[]).includes(value)
  }

  async mias(cuentaId: string): Promise<VistaPropiaSolicitud[]> {
    const solicitudes = await this.deps.almacen.listarDeCuenta(cuentaId)
    const nombres = new Map<string, { id: string; displayName: string } | null>()
    for (const solicitud of solicitudes)
      if (solicitud.prestadorTenantId && !nombres.has(solicitud.prestadorTenantId)) {
        const perfil = await this.deps.destinos?.perfilPorTenant(solicitud.prestadorTenantId)
        nombres.set(solicitud.prestadorTenantId, perfil ? { id: perfil.id, displayName: perfil.nombrePublico } : null)
      }
    return solicitudes.map((solicitud) => vistaPropia(solicitud, solicitud.prestadorTenantId ? (nombres.get(solicitud.prestadorTenantId) ?? null) : null))
  }

  async cerrar(cuentaId: string, id: unknown): Promise<ResultadoSolicitud<object>> {
    if (!idValido(id)) return { ok: false, code: 'NOT_FOUND' }
    return (await this.deps.almacen.cerrar({ id, cuentaId, ahora: this.now() })) ? { ok: true } : { ok: false, code: 'NOT_FOUND' }
  }

  // ---- prestador destino ------------------------------------------------------------------------

  async recibidas(prestadorTenantId: string): Promise<VistaSolicitudRecibida[]> {
    return (await this.deps.almacen.listarDirigidasA(prestadorTenantId)).map(vistaRecibida)
  }

  // Aceptar confirma la relación con el cliente; rechazar la cierra. Solo desde 'pendiente'.
  async responder(prestadorTenantId: string, id: unknown, decision: unknown): Promise<ResultadoSolicitud<{ solicitud: VistaSolicitudRecibida }>> {
    if (!idValido(id) || (decision !== 'aceptada' && decision !== 'rechazada')) return { ok: false, code: 'NOT_FOUND' }
    const actualizada = await this.deps.almacen.responder({ id, prestadorTenantId, decision, ahora: this.now() })
    if (!actualizada) return { ok: false, code: 'NOT_FOUND' }
    const solicitud = await this.deps.almacen.obtener(id)
    return solicitud ? { ok: true, solicitud: vistaRecibida(solicitud) } : { ok: false, code: 'NOT_FOUND' }
  }

  // ---- postulaciones a solicitudes públicas -----------------------------------------------------
  // Cualquier prestador aprobado con perfil público visible puede ofrecerse, sea o no de ese
  // oficio. Postularse no confirma nada: el cliente decide a quién acepta.

  async postular(
    actor: { tenantId: string; cuentaId: string },
    id: unknown,
    body: Record<string, unknown>
  ): Promise<ResultadoSolicitud<{ postulacion: VistaPostulacionPropia }>> {
    if (!idValido(id)) return { ok: false, code: 'NOT_FOUND' }
    const mensaje = validarMensajePostulacion(body['message'])
    if (!mensaje.ok) return { ok: false, code: 'INVALID_REQUEST', fields: ['message'] }
    const ahora = this.now()
    const solicitud = await this.deps.almacen.obtener(id)
    if (!solicitud || solicitud.visibilidad !== 'publica' || solicitud.estado !== 'abierta' || solicitud.expiraEn <= ahora) return { ok: false, code: 'NOT_FOUND' }
    if (solicitud.cuentaId === actor.cuentaId) return { ok: false, code: 'SELF_REQUEST' }
    const duena = await this.deps.cuentas.getAccount(solicitud.cuentaId)
    if (duena?.tenantId === actor.tenantId) return { ok: false, code: 'SELF_REQUEST' }
    const postulante = this.deps.destinos ? await this.deps.destinos.postulante(actor.tenantId) : null
    if (!postulante) return { ok: false, code: 'PROVIDER_NOT_AVAILABLE' }
    const existentes = await this.deps.almacen.postulacionesDe(solicitud.id)
    if (existentes.some((item) => item.prestadorTenantId === actor.tenantId)) return { ok: false, code: 'ALREADY_APPLIED' }
    if (existentes.length >= LIMITES_SOLICITUD.postulacionesPorSolicitud) return { ok: false, code: 'REQUEST_FULL' }
    const postulacion: PostulacionSolicitud = {
      id: this.newId(),
      solicitudId: solicitud.id,
      prestadorTenantId: actor.tenantId,
      prestadorId: postulante.perfil.prestadorId,
      mensaje: mensaje.valor,
      estado: 'pendiente',
      creadaEn: ahora,
      actualizadaEn: ahora,
    }
    try {
      await this.deps.almacen.guardarPostulacion(postulacion)
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2002') return { ok: false, code: 'ALREADY_APPLIED' }
      throw error
    }
    return { ok: true, postulacion: vistaPostulacionPropia(postulacion, solicitud, ahora) }
  }

  async misPostulaciones(prestadorTenantId: string): Promise<VistaPostulacionPropia[]> {
    const ahora = this.now()
    const postulaciones = await this.deps.almacen.postulacionesDePrestador(prestadorTenantId)
    const vistas = await Promise.all(
      postulaciones.map(async (postulacion) => {
        const solicitud = await this.deps.almacen.obtener(postulacion.solicitudId)
        return solicitud ? vistaPostulacionPropia(postulacion, solicitud, ahora) : null
      })
    )
    return vistas.filter((vista): vista is VistaPostulacionPropia => vista !== null)
  }

  async retirarPostulacion(prestadorTenantId: string, postulacionId: unknown): Promise<ResultadoSolicitud<object>> {
    if (!idValido(postulacionId)) return { ok: false, code: 'NOT_FOUND' }
    const retirada = await this.deps.almacen.cerrarPostulacion({ postulacionId, estado: 'retirada', prestadorTenantId, ahora: this.now() })
    return retirada ? { ok: true } : { ok: false, code: 'NOT_FOUND' }
  }

  // Postulantes de una solicitud: solo para su dueña, con el perfil público de cada prestador.
  async postulantes(cuentaId: string, id: unknown): Promise<ResultadoSolicitud<{ items: VistaPostulante[] }>> {
    const solicitud = await this.solicitudPropia(cuentaId, id)
    if (!solicitud) return { ok: false, code: 'NOT_FOUND' }
    const postulaciones = await this.deps.almacen.postulacionesDe(solicitud.id)
    const items = await Promise.all(
      postulaciones
        .filter((postulacion) => postulacion.estado !== 'retirada')
        .map(async (postulacion): Promise<VistaPostulante | null> => {
          const perfil = await this.deps.destinos?.perfilPublicoDe(postulacion.prestadorTenantId)
          if (!perfil) return null
          return {
            id: postulacion.id,
            provider: { id: perfil.id, displayName: perfil.nombrePublico, profession: perfil.oficio, approximateArea: perfil.zona },
            message: postulacion.mensaje,
            status: postulacion.estado,
            createdAt: new Date(postulacion.creadaEn).toISOString(),
          }
        })
    )
    return { ok: true, items: items.filter((item): item is VistaPostulante => item !== null) }
  }

  // El cliente acepta a un postulante: la solicitud sale del mapa y queda confirmada con él.
  async elegirPostulante(cuentaId: string, id: unknown, postulacionId: unknown): Promise<ResultadoSolicitud<{ solicitud: VistaPropiaSolicitud }>> {
    if (!idValido(id) || !idValido(postulacionId)) return { ok: false, code: 'NOT_FOUND' }
    const aceptada = await this.deps.almacen.aceptarPostulacion({ solicitudId: id, cuentaId, postulacionId, ahora: this.now() })
    if (!aceptada) return { ok: false, code: 'NOT_FOUND' }
    const solicitud = await this.deps.almacen.obtener(id)
    if (!solicitud) return { ok: false, code: 'NOT_FOUND' }
    const perfil = solicitud.prestadorTenantId ? await this.deps.destinos?.perfilPorTenant(solicitud.prestadorTenantId) : null
    return { ok: true, solicitud: vistaPropia(solicitud, perfil ? { id: perfil.id, displayName: perfil.nombrePublico } : null) }
  }

  async rechazarPostulante(cuentaId: string, id: unknown, postulacionId: unknown): Promise<ResultadoSolicitud<object>> {
    const solicitud = await this.solicitudPropia(cuentaId, id)
    if (!solicitud || !idValido(postulacionId)) return { ok: false, code: 'NOT_FOUND' }
    const rechazada = await this.deps.almacen.cerrarPostulacion({ postulacionId, estado: 'rechazada', solicitudId: solicitud.id, ahora: this.now() })
    return rechazada ? { ok: true } : { ok: false, code: 'NOT_FOUND' }
  }

  private async solicitudPropia(cuentaId: string, id: unknown): Promise<SolicitudServicio | null> {
    if (!idValido(id)) return null
    const solicitud = await this.deps.almacen.obtener(id)
    return solicitud && solicitud.cuentaId === cuentaId ? solicitud : null
  }

  // ---- imágenes ---------------------------------------------------------------------------------

  async agregarImagen(cuentaId: string, id: unknown, bytes: unknown): Promise<ResultadoSolicitud<{ images: number }>> {
    if (!idValido(id)) return { ok: false, code: 'NOT_FOUND' }
    const solicitud = await this.deps.almacen.obtener(id)
    if (!solicitud || solicitud.cuentaId !== cuentaId || solicitud.estado !== 'abierta') return { ok: false, code: 'NOT_FOUND' }
    if (solicitud.imagenes.length >= IMAGENES_POR_SOLICITUD) return { ok: false, code: 'IMAGE_LIMIT' }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > TAMANO_MAXIMO_IMAGEN) return { ok: false, code: 'INVALID_IMAGE' }
    let limpia: ReturnType<typeof prepararImagenDocumento>
    try {
      // Mismo saneamiento que los documentos: tipo por magic bytes y sin EXIF/GPS/XMP.
      limpia = prepararImagenDocumento(bytes)
    } catch {
      return { ok: false, code: 'INVALID_IMAGE' }
    }
    if (limpia.bytes.length > TAMANO_MAXIMO_IMAGEN) return { ok: false, code: 'INVALID_IMAGE' }
    const orden = [1, 2].find((valor) => !solicitud.imagenes.includes(valor))!
    const imagen: ImagenSolicitud = {
      id: this.newId(),
      solicitudId: solicitud.id,
      orden,
      tipoMime: limpia.mimeType,
      tamanoBytes: limpia.bytes.length,
      sha256: limpia.sha256,
      contenido: limpia.bytes,
      creadaEn: this.now(),
    }
    try {
      await this.deps.almacen.guardarImagen(imagen)
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2002') return { ok: false, code: 'IMAGE_LIMIT' }
      throw error
    }
    return { ok: true, images: solicitud.imagenes.length + 1 }
  }

  // Foto de una solicitud pública, abierta y vigente.
  async imagenPublica(id: unknown, orden: unknown): Promise<ImagenSolicitud | null> {
    const encontrada = await this.buscarImagen(id, orden)
    if (!encontrada) return null
    const { solicitud, imagen } = encontrada
    return solicitud.visibilidad === 'publica' && solicitud.estado === 'abierta' && solicitud.expiraEn > this.now() ? imagen : null
  }

  // Foto de cualquier solicitud para su dueña o para el prestador destino.
  async imagenPrivada(actor: { cuentaId: string; tenantId: string }, id: unknown, orden: unknown): Promise<ImagenSolicitud | null> {
    const encontrada = await this.buscarImagen(id, orden)
    if (!encontrada) return null
    const { solicitud, imagen } = encontrada
    return solicitud.cuentaId === actor.cuentaId || (solicitud.prestadorTenantId !== null && solicitud.prestadorTenantId === actor.tenantId) ? imagen : null
  }

  private async buscarImagen(id: unknown, orden: unknown) {
    const numero = Number(orden)
    if (!idValido(id) || (numero !== 1 && numero !== 2)) return null
    const solicitud = await this.deps.almacen.obtener(id)
    if (!solicitud || !solicitud.imagenes.includes(numero)) return null
    const imagen = await this.deps.almacen.imagen(id, numero)
    return imagen ? { solicitud, imagen } : null
  }
}

function idValido(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[A-Za-z0-9-]+$/u.test(id)
}
