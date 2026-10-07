import { createHash } from 'node:crypto'

import { esOficio, type OficioId } from '../directorio/oficios.ts'
import { barriosVigentes, buscarBarrio } from '../catalogo/vigente.ts'

// Solicitudes de servicio: un cliente publica qué necesita y en qué barrio; los prestadores de la
// zona las ven en el mapa público de la home. Privacidad por diseño: nunca se pide dirección,
// teléfono ni ubicación exacta. Solo se guarda el barrio y un punto aproximado derivado de él.

// Las categorías de solicitud son los oficios vigentes del catálogo administrado.
export type CategoriaSolicitud = OficioId
export const esCategoriaSolicitud = esOficio

export const URGENCIAS_SOLICITUD = ['urgente', 'hoy_manana', 'esta_semana', 'sin_apuro'] as const
export type UrgenciaSolicitud = (typeof URGENCIAS_SOLICITUD)[number]

export type EstadoSolicitud = 'abierta' | 'cerrada'

// Una sola solicitud TUS para todos los canales; el origen queda como metadata.
export const ORIGENES_SOLICITUD = ['web_publica', 'web_assistant', 'web_directory', 'whatsapp'] as const
export type OrigenSolicitud = (typeof ORIGENES_SOLICITUD)[number]
// Orígenes que puede declarar la Web (WhatsApp lo fija el servidor).
export const ORIGENES_WEB: readonly OrigenSolicitud[] = ['web_publica', 'web_assistant', 'web_directory']

// 'publica': aparece en el mapa. 'dirigida': el cliente eligió un prestador; solo la ven el cliente
// y ese prestador. Elegido no es confirmado: la asignación queda 'pendiente' hasta que el prestador
// acepta.
export type VisibilidadSolicitud = 'publica' | 'dirigida'
export type EstadoAsignacion = 'pendiente' | 'aceptada' | 'rechazada' | 'cancelada'

// Postulación de un prestador (de cualquier oficio) a una solicitud pública. El cliente decide:
// aceptar a uno convierte la solicitud en dirigida y 'aceptada' para ese prestador, y rechaza al
// resto de los pendientes. 'retirada': el prestador se bajó antes de la decisión.
export type EstadoPostulacion = 'pendiente' | 'aceptada' | 'rechazada' | 'retirada'

export const IMAGENES_POR_SOLICITUD = 2
export const TAMANO_MAXIMO_IMAGEN = 3 * 1024 * 1024

// Barrios con su centro aproximado: vienen del catálogo administrado (tabla barrios). Solo los
// vigentes se ofrecen para nuevas solicitudes y se ubican en el mapa.
export function zonasCorrientes(): { nombre: string; lat: number; lng: number }[] {
  return barriosVigentes().map((barrio) => ({ nombre: barrio.nombre, lat: barrio.lat, lng: barrio.lng }))
}

export const LIMITES_SOLICITUD = {
  tituloMin: 5,
  tituloMax: 90,
  descripcionMax: 500,
  presupuestoMax: 100_000_000,
  // Anti-abuso: publicaciones por cuenta en 24 h y abiertas a la vez.
  publicacionesPorDia: 5,
  abiertasPorCuenta: 10,
  vigenciaDias: 30,
  listadoPublicoMax: 100,
  mensajePostulacionMax: 300,
  postulacionesPorSolicitud: 20,
} as const

export interface SolicitudServicio {
  id: string
  cuentaId: string
  categoria: CategoriaSolicitud
  titulo: string
  descripcion: string | null
  nombrePublico: string
  zona: string
  latitud: number
  longitud: number
  presupuestoMaximo: number | null
  urgencia: UrgenciaSolicitud
  estado: EstadoSolicitud
  creadaEn: number
  actualizadaEn: number
  expiraEn: number
  origen: OrigenSolicitud
  visibilidad: VisibilidadSolicitud
  prestadorTenantId: string | null
  prestadorId: string | null
  estadoAsignacion: EstadoAsignacion | null
  respondidaEn: number | null
  // Cancelada por su dueña (estado 'cerrada' + cuándo y quién); null en las demás.
  canceladaEn: number | null
  canceladaPor: string | null
  // Órdenes (1, 2) de las fotos guardadas; derivado de imagenes_solicitud.
  imagenes: number[]
  // Trabajo nacido del match (a lo sumo uno); derivado de trabajos.solicitud_id, nunca una columna.
  trabajoId: string | null
  // SERVICIO-URGENTE-01. Una difusión urgente: se ofrece a la vez a todos los prestadores
  // compatibles y el primero que acepta queda asignado. `direccion` solo la ven ellos y la
  // administración (nunca es pública). `cierreUrgente`: por qué cerró sin ganador.
  direccion?: string | null
  difusionUrgente?: boolean
  cierreUrgente?: 'sin_candidatos' | 'todos_rechazaron' | 'vencida' | null
  // Cuántas veces volvió a ofrecerse porque el prestador asignado avisó que no podía asistir.
  reaperturasUrgente?: number
}

export interface PostulacionSolicitud {
  id: string
  solicitudId: string
  prestadorTenantId: string
  prestadorId: string
  mensaje: string | null
  estado: EstadoPostulacion
  creadaEn: number
  actualizadaEn: number
}

export interface ImagenSolicitud {
  id: string
  solicitudId: string
  orden: number
  tipoMime: 'image/jpeg' | 'image/png' | 'image/webp'
  tamanoBytes: number
  sha256: string
  contenido: Buffer
  creadaEn: number
}

// Lo único que sale en el endpoint público.
export interface VistaPublicaSolicitud {
  id: string
  category: CategoriaSolicitud
  title: string
  description: string | null
  requesterName: string
  approximateLocation: { lat: number; lng: number; label: string }
  budgetMax: number | null
  urgency: UrgenciaSolicitud
  createdAt: string
  images: string[]
}

export interface VistaPropiaSolicitud extends VistaPublicaSolicitud {
  status: EstadoSolicitud
  expiresAt: string
  origin: OrigenSolicitud
  // Solo en solicitudes dirigidas: a quién se envió y qué respondió.
  provider: { id: string; displayName: string } | null
  assignment: EstadoAsignacion | null
  respondedAt: string | null
  // Trabajo creado al elegir prestador (null si todavía no hay match).
  workId: string | null
  // Cancelada por la dueña (antes de elegir prestador).
  cancelledAt: string | null
}

// Lo que ve el prestador destino: sin cuenta, email ni teléfono del cliente.
export interface VistaSolicitudRecibida {
  id: string
  category: CategoriaSolicitud
  title: string
  description: string | null
  requesterName: string
  approximateArea: string
  budgetMax: number | null
  urgency: UrgenciaSolicitud
  createdAt: string
  origin: OrigenSolicitud
  assignment: EstadoAsignacion
  respondedAt: string | null
  images: string[]
  // Trabajo creado cuando este prestador aceptó (null antes).
  workId: string | null
}

// Lo que ve el cliente de cada postulante: solo el perfil público (nunca tenant ni contacto).
export interface VistaPostulante {
  id: string
  provider: { id: string; displayName: string; profession: string; approximateArea: string }
  message: string | null
  status: EstadoPostulacion
  createdAt: string
}

// Lo que ve el prestador de sus postulaciones.
export interface VistaPostulacionPropia {
  id: string
  message: string | null
  status: EstadoPostulacion
  createdAt: string
  request: {
    id: string
    category: CategoriaSolicitud
    title: string
    requesterName: string
    approximateArea: string
    budgetMax: number | null
    urgency: UrgenciaSolicitud
    open: boolean
    // Solo si ESTA postulación fue la elegida (nunca el trabajo de otro prestador).
    workId: string | null
  }
}

export interface NuevaSolicitud {
  categoria: CategoriaSolicitud
  titulo: string
  descripcion: string | null
  zona: string
  presupuestoMaximo: number | null
  urgencia: UrgenciaSolicitud
}

export type CampoSolicitud = 'category' | 'title' | 'description' | 'zone' | 'budgetMax' | 'urgency' | 'message'

export function validarNuevaSolicitud(body: Record<string, unknown>): { ok: true; valor: NuevaSolicitud } | { ok: false; campos: CampoSolicitud[] } {
  const campos: CampoSolicitud[] = []
  const texto = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '')
  const categoria = body['category']
  const urgencia = body['urgency']
  const titulo = texto(body['title'])
  const descripcion = texto(body['description'])
  const zona = zonasCorrientes().find((item) => item.nombre === body['zone'])
  const presupuestoCrudo = body['budgetMax']
  const presupuesto = presupuestoCrudo === null || presupuestoCrudo === undefined || presupuestoCrudo === '' ? null : presupuestoCrudo

  if (typeof categoria !== 'string' || !esOficio(categoria)) campos.push('category')
  if (titulo.length < LIMITES_SOLICITUD.tituloMin || titulo.length > LIMITES_SOLICITUD.tituloMax || contieneContacto(titulo)) campos.push('title')
  if (descripcion.length > LIMITES_SOLICITUD.descripcionMax || contieneContacto(descripcion)) campos.push('description')
  if (!zona) campos.push('zone')
  if (presupuesto !== null && (typeof presupuesto !== 'number' || !Number.isInteger(presupuesto) || presupuesto <= 0 || presupuesto > LIMITES_SOLICITUD.presupuestoMax)) campos.push('budgetMax')
  if (typeof urgencia !== 'string' || !(URGENCIAS_SOLICITUD as readonly string[]).includes(urgencia)) campos.push('urgency')
  if (campos.length > 0 || !zona) return { ok: false, campos }
  return {
    ok: true,
    valor: {
      categoria: categoria as CategoriaSolicitud,
      titulo,
      descripcion: descripcion || null,
      zona: zona.nombre,
      presupuestoMaximo: presupuesto as number | null,
      urgencia: urgencia as UrgenciaSolicitud,
    },
  }
}

// Mensaje opcional del prestador al postularse: mismo criterio anti-contacto que la solicitud.
export function validarMensajePostulacion(value: unknown): { ok: true; valor: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, valor: null }
  if (typeof value !== 'string') return { ok: false }
  const texto = value.replace(/\s+/gu, ' ').trim()
  if (!texto) return { ok: true, valor: null }
  if (texto.length > LIMITES_SOLICITUD.mensajePostulacionMax || contieneContacto(texto)) return { ok: false }
  return { ok: true, valor: texto }
}

// El texto es público: se rechazan emails, teléfonos y links para que nadie publique datos de
// contacto (el contacto ocurre dentro de TUS).
export function contieneContacto(value: string): boolean {
  return /[^\s@]+@[^\s@]+\.[a-z]{2,}/iu.test(value) || /(?:\+?\d[\s().-]?){8,}/u.test(value) || /(?:https?:\/\/|www\.)/iu.test(value)
}

// "Laura Martínez" -> "Laura M."; sin nombre -> "Vecino/a".
export function nombrePublico(displayName: string): string {
  const [primero = '', segundo = ''] = displayName.replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/u)
  if (!primero) return 'Vecino/a'
  const nombre = primero.slice(0, 20)
  return segundo ? `${nombre} ${segundo[0]!.toUpperCase()}.` : nombre
}

// Punto aproximado: centro del barrio + desplazamiento determinístico (±~300 m) derivado del id,
// para que las solicitudes de un mismo barrio no se superpongan. Redondeado a 3 decimales.
export function ubicacionAproximada(zona: string, id: string): { lat: number; lng: number } {
  const barrio = buscarBarrio(zona)
  const centro = barrio && barrio.lat !== null && barrio.lng !== null ? { lat: barrio.lat, lng: barrio.lng } : (zonasCorrientes()[0] ?? { lat: -27.4695, lng: -58.8295 })
  const hash = createHash('sha256').update(id).digest()
  const desplazamiento = (byte: number) => ((byte / 255) * 2 - 1) * 0.003
  const redondear = (value: number) => Math.round(value * 1000) / 1000
  return { lat: redondear(centro.lat + desplazamiento(hash[0]!)), lng: redondear(centro.lng + desplazamiento(hash[1]!)) }
}

const urlImagenes = (solicitud: SolicitudServicio, base: 'public' | 'private') =>
  [...solicitud.imagenes]
    .sort((x, y) => x - y)
    .map((orden) => (base === 'public' ? `/tus/v1/public/solicitudes/${solicitud.id}/imagenes/${orden}` : `/tus/v1/solicitudes/${solicitud.id}/imagenes/${orden}`))

export function vistaPublica(solicitud: SolicitudServicio): VistaPublicaSolicitud {
  return {
    id: solicitud.id,
    category: solicitud.categoria,
    title: solicitud.titulo,
    description: solicitud.descripcion,
    requesterName: solicitud.nombrePublico,
    approximateLocation: { lat: solicitud.latitud, lng: solicitud.longitud, label: solicitud.zona },
    budgetMax: solicitud.presupuestoMaximo,
    urgency: solicitud.urgencia,
    createdAt: new Date(solicitud.creadaEn).toISOString(),
    images: urlImagenes(solicitud, 'public'),
  }
}

export function vistaPropia(solicitud: SolicitudServicio, prestador: { id: string; displayName: string } | null = null): VistaPropiaSolicitud {
  return {
    ...vistaPublica(solicitud),
    // Las fotos de una solicitud dirigida no son públicas.
    images: urlImagenes(solicitud, solicitud.visibilidad === 'publica' ? 'public' : 'private'),
    status: solicitud.estado,
    expiresAt: new Date(solicitud.expiraEn).toISOString(),
    origin: solicitud.origen,
    provider: solicitud.visibilidad === 'dirigida' ? prestador : null,
    assignment: solicitud.estadoAsignacion,
    respondedAt: solicitud.respondidaEn === null ? null : new Date(solicitud.respondidaEn).toISOString(),
    workId: solicitud.trabajoId,
    cancelledAt: solicitud.canceladaEn === null ? null : new Date(solicitud.canceladaEn).toISOString(),
  }
}

export function vistaRecibida(solicitud: SolicitudServicio): VistaSolicitudRecibida {
  return {
    id: solicitud.id,
    category: solicitud.categoria,
    title: solicitud.titulo,
    description: solicitud.descripcion,
    requesterName: solicitud.nombrePublico,
    approximateArea: solicitud.zona,
    budgetMax: solicitud.presupuestoMaximo,
    urgency: solicitud.urgencia,
    createdAt: new Date(solicitud.creadaEn).toISOString(),
    origin: solicitud.origen,
    assignment: solicitud.estadoAsignacion ?? 'pendiente',
    respondedAt: solicitud.respondidaEn === null ? null : new Date(solicitud.respondidaEn).toISOString(),
    images: urlImagenes(solicitud, 'private'),
    workId: solicitud.trabajoId,
  }
}

export function vistaPostulacionPropia(postulacion: PostulacionSolicitud, solicitud: SolicitudServicio, ahora: number): VistaPostulacionPropia {
  return {
    id: postulacion.id,
    message: postulacion.mensaje,
    status: postulacion.estado,
    createdAt: new Date(postulacion.creadaEn).toISOString(),
    request: {
      id: solicitud.id,
      category: solicitud.categoria,
      title: solicitud.titulo,
      requesterName: solicitud.nombrePublico,
      approximateArea: solicitud.zona,
      budgetMax: solicitud.presupuestoMaximo,
      urgency: solicitud.urgencia,
      open: solicitud.estado === 'abierta' && solicitud.expiraEn > ahora,
      workId: postulacion.estado === 'aceptada' && solicitud.prestadorTenantId === postulacion.prestadorTenantId ? solicitud.trabajoId : null,
    },
  }
}
