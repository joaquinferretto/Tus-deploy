// Contratos públicos del directorio "Buscar trabajador", del asistente "Buscar servicios" y de la
// solicitud TUS dirigida a un prestador. Son DTO explícitos: nunca entidades de base de datos ni
// ids internos (tenant/prestador), direcciones, teléfonos, emails, documentos o coordenadas exactas.

// Trades are administered in the database (the admin panel creates new ones): an id is a slug.
// OFICIOS_TUS keeps the trades that existed before the administered catalog (compatibility).
export const OFICIOS_TUS = ['plomeria', 'electricidad', 'aire', 'pintura', 'mecanica', 'otros'] as const
export type OficioTus = string
export const esIdOficioTus = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,59}$/u.test(value)

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
  // Icon key chosen by the administration (the Web draws it; unknown keys use a generic icon).
  icon?: string
  categoryId?: string | null
}

export interface CategoriaPublica {
  id: string
  name: string
}

export interface BarrioPublico {
  id: string
  name: string
  zoneId: string | null
  lat: number
  lng: number
  polygon: { type: 'Polygon'; coordinates: [number, number][][] }
}

export interface UbicacionesPublicas {
  localities: { id: string; name: string; province: string; zones: { id: string; name: string }[]; neighbourhoods: BarrioPublico[] }[]
}

export interface CatalogoOficios {
  items: OficioPublico[]
  // Current neighbourhood names (compatibility with the pre-catalog clients).
  zones: string[]
  categories?: CategoriaPublica[]
  locations?: UbicacionesPublicas
}

export interface DisponibilidadPublica {
  status: 'atiende_hoy' | 'otros_dias' | 'sin_agenda'
  label: string
  today: { start: string; end: string } | null
}

export type FuenteUbicacionPublica = 'configured' | 'identity_fallback' | 'none'

export type ModalidadAtencionPublica = 'local' | 'domicilio' | 'mixto'

export interface UbicacionMapaPrestador {
  label: string
  lat: number
  lng: number
  precision: 'zone'
}

export interface CoberturaPublicaPrestador {
  mode: ModalidadAtencionPublica
  radiusKm: number | null
}

export interface PrestadorPublico {
  id: string
  displayName: string
  initials: string
  profession: { id: OficioTus; label: string; title: string }
  approximateArea: string
  publicArea: string
  serviceZones: string[]
  locationSource: FuenteUbicacionPublica
  mapLocations: UbicacionMapaPrestador[]
  coverage: CoberturaPublicaPrestador
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
  'publicArea',
  'serviceZones',
  'locationSource',
  'mapLocations',
  'coverage',
  'verified',
  'completedJobs',
  'rating',
  'availability',
  'yearsOfExperience',
  'startingPrice',
] as const

// Claves que un DTO público de prestador jamás puede traer.
export const CLAVES_PRIVADAS_PRESTADOR = ['tenantId', 'prestadorId', 'merchantId', 'email', 'phone', 'telefono', 'address', 'direccion', 'street', 'houseNumber', 'documentAddress', 'lat', 'lng', 'latitude', 'longitude', 'exactLatitude', 'exactLongitude', 'dni', 'cuil', 'documentNumber'] as const

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
    esIdOficioTus(profession['id']) &&
    typeof value['approximateArea'] === 'string' &&
    typeof value['publicArea'] === 'string' &&
    Array.isArray(value['serviceZones']) && value['serviceZones'].every((zone) => typeof zone === 'string') &&
    ['configured', 'identity_fallback', 'none'].includes(String(value['locationSource'])) &&
    Array.isArray(value['mapLocations']) && value['mapLocations'].every((location) => {
      if (!esRegistro(location)) return false
      return typeof location['label'] === 'string' && Number.isFinite(location['lat']) && Number.isFinite(location['lng']) && location['precision'] === 'zone'
    }) &&
    esRegistro(value['coverage']) &&
    ['local', 'domicilio', 'mixto'].includes(String(value['coverage']['mode'])) &&
    (value['coverage']['radiusKm'] === null || Number.isInteger(value['coverage']['radiusKm'])) &&
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
