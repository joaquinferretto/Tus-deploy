import { createHash } from 'node:crypto'

// Solicitudes de servicio: un cliente publica qué necesita y en qué barrio; los prestadores de la
// zona las ven en el mapa público de la home. Privacidad por diseño: nunca se pide dirección,
// teléfono ni ubicación exacta. Solo se guarda el barrio y un punto aproximado derivado de él.

export const CATEGORIAS_SOLICITUD = ['plomeria', 'electricidad', 'mecanica', 'pintura', 'aire', 'otros'] as const
export type CategoriaSolicitud = (typeof CATEGORIAS_SOLICITUD)[number]

export const URGENCIAS_SOLICITUD = ['urgente', 'hoy_manana', 'esta_semana', 'sin_apuro'] as const
export type UrgenciaSolicitud = (typeof URGENCIAS_SOLICITUD)[number]

export type EstadoSolicitud = 'abierta' | 'cerrada'

// Barrios de Corrientes Capital con su centro aproximado. La Web muestra la misma lista.
export const ZONAS_CORRIENTES: ReadonlyArray<{ nombre: string; lat: number; lng: number }> = [
  { nombre: 'Centro', lat: -27.4695, lng: -58.8295 },
  { nombre: 'Camba Cuá', lat: -27.4765, lng: -58.8215 },
  { nombre: 'La Rosada', lat: -27.4805, lng: -58.8345 },
  { nombre: 'Barrio Sur', lat: -27.4755, lng: -58.8415 },
  { nombre: 'San Gerónimo', lat: -27.4795, lng: -58.8155 },
  { nombre: '1000 Viviendas', lat: -27.4855, lng: -58.829 },
  { nombre: 'Libertad', lat: -27.4835, lng: -58.8005 },
  { nombre: 'San Benito', lat: -27.4905, lng: -58.8165 },
  { nombre: 'Laguna Seca', lat: -27.4945, lng: -58.7855 },
  { nombre: 'Pirayuí', lat: -27.5035, lng: -58.7735 },
  { nombre: 'Molina Punta', lat: -27.5135, lng: -58.7905 },
]

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
}

export interface NuevaSolicitud {
  categoria: CategoriaSolicitud
  titulo: string
  descripcion: string | null
  zona: string
  presupuestoMaximo: number | null
  urgencia: UrgenciaSolicitud
}

export type CampoSolicitud = 'category' | 'title' | 'description' | 'zone' | 'budgetMax' | 'urgency'

export function validarNuevaSolicitud(body: Record<string, unknown>): { ok: true; valor: NuevaSolicitud } | { ok: false; campos: CampoSolicitud[] } {
  const campos: CampoSolicitud[] = []
  const texto = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '')
  const categoria = body['category']
  const urgencia = body['urgency']
  const titulo = texto(body['title'])
  const descripcion = texto(body['description'])
  const zona = ZONAS_CORRIENTES.find((item) => item.nombre === body['zone'])
  const presupuestoCrudo = body['budgetMax']
  const presupuesto = presupuestoCrudo === null || presupuestoCrudo === undefined || presupuestoCrudo === '' ? null : presupuestoCrudo

  if (typeof categoria !== 'string' || !(CATEGORIAS_SOLICITUD as readonly string[]).includes(categoria)) campos.push('category')
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
  const centro = ZONAS_CORRIENTES.find((item) => item.nombre === zona) ?? ZONAS_CORRIENTES[0]!
  const hash = createHash('sha256').update(id).digest()
  const desplazamiento = (byte: number) => ((byte / 255) * 2 - 1) * 0.003
  const redondear = (value: number) => Math.round(value * 1000) / 1000
  return { lat: redondear(centro.lat + desplazamiento(hash[0]!)), lng: redondear(centro.lng + desplazamiento(hash[1]!)) }
}

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
    images: [],
  }
}

export function vistaPropia(solicitud: SolicitudServicio): VistaPropiaSolicitud {
  return { ...vistaPublica(solicitud), status: solicitud.estado, expiresAt: new Date(solicitud.expiraEn).toISOString() }
}
