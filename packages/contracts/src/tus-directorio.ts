// Contratos públicos del directorio "Buscar trabajador", del asistente "Buscar servicios" y de la
// solicitud TUS dirigida a un prestador. Son DTO explícitos: nunca entidades de base de datos ni
// ids internos (tenant/prestador), direcciones, teléfonos, emails, documentos o coordenadas.

export const OFICIOS_TUS = ['plomeria', 'electricidad', 'aire', 'pintura', 'mecanica', 'otros'] as const
export type OficioTus = (typeof OFICIOS_TUS)[number]

export const URGENCIAS_SOLICITUD_TUS = ['urgente', 'hoy_manana', 'esta_semana', 'sin_apuro'] as const
export type UrgenciaSolicitudTus = (typeof URGENCIAS_SOLICITUD_TUS)[number]

export const ORIGENES_SOLICITUD_TUS = ['web_publica', 'web_assistant', 'web_directory', 'whatsapp'] as const
export type OrigenSolicitudTus = (typeof ORIGENES_SOLICITUD_TUS)[number]

// candidato -> (cliente elige) -> pendiente -> aceptada | rechazada. "cancelada": el cliente la cerró
// antes de la respuesta. Elegido NUNCA equivale a confirmado.
export const ESTADOS_ASIGNACION_TUS = ['pendiente', 'aceptada', 'rechazada', 'cancelada'] as const
export type EstadoAsignacionTus = (typeof ESTADOS_ASIGNACION_TUS)[number]

export interface OficioPublico {
  id: OficioTus
  label: string
  profession: string
}

export interface CatalogoOficios {
  items: OficioPublico[]
  zones: string[]
}

export interface DisponibilidadPublica {
  status: 'atiende_hoy' | 'otros_dias' | 'sin_agenda'
  label: string
  today: { start: string; end: string } | null
}

export interface PrestadorPublico {
  id: string
  displayName: string
  initials: string
  profession: { id: OficioTus; label: string; title: string }
  approximateArea: string
  verified: boolean
  completedJobs: number
  // TUS todavía no tiene reseñas: siempre null (nunca una valoración inventada).
  rating: null
  availability: DisponibilidadPublica
  yearsOfExperience: number | null
  startingPrice: { amount: number; currency: string } | null
}

export interface PerfilPrestadorPublico extends PrestadorPublico {
  description: string | null
  services: { listingId: string; name: string; price: number | null; currency: string; priceMode: string | null; days: number[] }[]
}

export interface CandidatoPrestador extends PrestadorPublico {
  distanceKm: number | null
}

export interface PaginaDirectorio {
  items: PrestadorPublico[]
  total: number
  page: number
  hasMore: boolean
}

export interface InterpretacionNecesidad {
  category: OficioTus | null
  alternatives: OficioTus[]
  zone: string | null
  urgency: UrgenciaSolicitudTus | null
  budgetMax: number | null
}

export interface ResultadoCandidatos {
  items: CandidatoPrestador[]
  reason: 'ok' | 'no_providers'
}

export interface SolicitudRecibidaPrestador {
  id: string
  category: OficioTus
  title: string
  description: string | null
  requesterName: string
  approximateArea: string
  budgetMax: number | null
  urgency: UrgenciaSolicitudTus
  createdAt: string
  origin: OrigenSolicitudTus
  assignment: EstadoAsignacionTus
  respondedAt: string | null
  images: string[]
}

// Postulaciones a solicitudes públicas: el prestador se ofrece y el cliente decide.
export const ESTADOS_POSTULACION_TUS = ['pendiente', 'aceptada', 'rechazada', 'retirada'] as const
export type EstadoPostulacionTus = (typeof ESTADOS_POSTULACION_TUS)[number]

// Lo que ve el prestador de cada postulación suya.
export interface PostulacionPrestador {
  id: string
  message: string | null
  status: EstadoPostulacionTus
  createdAt: string
  request: {
    id: string
    category: OficioTus
    title: string
    requesterName: string
    approximateArea: string
    budgetMax: number | null
    urgency: UrgenciaSolicitudTus
    open: boolean
  }
}

// Lo que ve el cliente de cada postulante (solo perfil público).
export interface PostulanteSolicitud {
  id: string
  provider: { id: string; displayName: string; profession: OficioTus; approximateArea: string }
  message: string | null
  status: EstadoPostulacionTus
  createdAt: string
}

// ---- validación en el borde (respuestas de la API) --------------------------------------------

export const CLAVES_PRESTADOR_PUBLICO = [
  'id',
  'displayName',
  'initials',
  'profession',
  'approximateArea',
  'verified',
  'completedJobs',
  'rating',
  'availability',
  'yearsOfExperience',
  'startingPrice',
] as const

// Claves que un DTO público de prestador jamás puede traer.
export const CLAVES_PRIVADAS_PRESTADOR = ['tenantId', 'prestadorId', 'merchantId', 'email', 'phone', 'telefono', 'address', 'direccion', 'lat', 'lng', 'latitude', 'longitude', 'dni', 'cuil', 'documentNumber'] as const

const esRegistro = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function esPrestadorPublico(value: unknown): value is PrestadorPublico {
  if (!esRegistro(value)) return false
  if (CLAVES_PRIVADAS_PRESTADOR.some((key) => key in value)) return false
  const profession = value['profession']
  const availability = value['availability']
  return (
    typeof value['id'] === 'string' &&
    typeof value['displayName'] === 'string' &&
    typeof value['initials'] === 'string' &&
    esRegistro(profession) &&
    (OFICIOS_TUS as readonly unknown[]).includes(profession['id']) &&
    typeof value['approximateArea'] === 'string' &&
    typeof value['verified'] === 'boolean' &&
    Number.isInteger(value['completedJobs']) &&
    value['rating'] === null &&
    esRegistro(availability) &&
    ['atiende_hoy', 'otros_dias', 'sin_agenda'].includes(String(availability['status'])) &&
    (value['yearsOfExperience'] === null || Number.isInteger(value['yearsOfExperience']))
  )
}

export function esPaginaDirectorio(value: unknown): value is PaginaDirectorio {
  return esRegistro(value) && Array.isArray(value['items']) && value['items'].every(esPrestadorPublico) && Number.isInteger(value['total']) && Number.isInteger(value['page']) && typeof value['hasMore'] === 'boolean'
}
