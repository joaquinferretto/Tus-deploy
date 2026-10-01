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
  // Null when the administration removed the drawn polygon (the point is the fallback).
  polygon: { type: 'Polygon'; coordinates: [number, number][][] } | null
}

export interface UbicacionesPublicas {
  localities: { id: string; name: string; province: string; zones: { id: string; name: string; lat?: number | null; lng?: number | null; polygon?: BarrioPublico['polygon'] }[]; neighbourhoods: BarrioPublico[] }[]
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
  // 'exact' only when the provider chose to show its exact point on the map.
  precision: 'zone' | 'exact'
}

// The ONE point that places a provider on the map (DIR-06): exact (only if allowed), inside its
// neighbourhood polygon, inside its zone polygon, or the reference point of either.
export interface PuntoMapaPrestador {
  lat: number
  lng: number
  precision: 'exact' | 'barrio' | 'zona' | 'reference'
  label: string
}

export interface CoberturaPublicaPrestador {
  mode: ModalidadAtencionPublica
  radiusKm: number | null
}

export interface TarifaServicioPublica {
  id: string
  nombre: string
  duracionMinutos: number
  precio: number
  moneda: string
}

export interface ServicioPrestadorPublico {
  id: OficioTus
  label: string
  title: string
  categoryId: string | null
  turnosHabilitados?: boolean
  solicitudesHabilitadas?: boolean
  precioBase?: number | null
  duracionMinutos?: number
  bufferMinutos?: number
  modalidad?: string
  tarifas?: TarifaServicioPublica[]
}

export interface PrestadorPublico {
  id: string
  displayName: string
  initials: string
  profession: { id: OficioTus; label: string; title: string }
  // Every service the provider offers (principal first). Absent in older payloads.
  professions?: ServicioPrestadorPublico[]
  // Switches de atención
  aceptaTurnos?: boolean
  aceptaSolicitudes?: boolean
  approximateArea: string
  publicArea: string
  serviceZones: string[]
  locationSource: FuenteUbicacionPublica
  mapLocations: UbicacionMapaPrestador[]
  // Absent in older payloads; null = not placed on the map.
  mapPoint?: PuntoMapaPrestador | null
  coverage: CoberturaPublicaPrestador
  verified: boolean
  completedJobs: number
  // Promedio (1 decimal) y cantidad de calificaciones reales de trabajos completados; null sin
  // calificaciones (nunca una valoración inventada).
  rating: { average: number; count: number } | null
  availability: DisponibilidadPublica
  yearsOfExperience: number | null
  startingPrice: { amount: number; currency: string } | null
}

export interface SlotDisponible {
  inicio: string
  fin: string
  duracionMinutos: number
  disponible: boolean
}

export interface SolicitudReservaTurno {
  oficioId: string
  tarifaId?: string
  inicio: string
  clienteNombre?: string
  clienteTelefono?: string
  clienteEmail?: string
  notas?: string
}

export interface DetalleTurno {
  id: string
  reservaId: string
  tenantId: string
  prestadorId: string
  prestadorNombre: string
  oficioId: string
  oficioNombre?: string
  tarifaId?: string | null
  tarifaNombre?: string | null
  inicio: string
  fin: string
  duracionMinutos: number
  precioLista: number | null
  precioFinal: number | null
  moneda: string
  estado: 'confirmed' | 'cancelled' | 'cancelled-late' | 'no-show' | string
  clienteNombre?: string | null
  clienteTelefono?: string | null
  clienteEmail?: string | null
  esInvitado: boolean
  modificadoPorAdminId?: string | null
  motivoModificacionPrecio?: string | null
  forzadoFueraHorario?: boolean
  motivoForzado?: string | null
  // Administrator that created the turno (general or forced); null for a client or a provider.
  creadoPorAdminId?: string | null
  // Account of the client when it is a registered one (null for a guest).
  clienteCuentaId?: string | null
  notas?: string | null
  fechaCreacion: string
}

export interface PerfilPrestadorPublico extends PrestadorPublico {
  description: string | null
  services: { listingId: string; name: string; price: number | null; currency: string; priceMode: string | null; days: number[] }[]
  tarifas?: TarifaServicioPublica[]
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
  workId?: string | null
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
    workId?: string | null
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
      return typeof location['label'] === 'string' && Number.isFinite(location['lat']) && Number.isFinite(location['lng']) && (location['precision'] === 'zone' || location['precision'] === 'exact')
    }) &&
    esRegistro(value['coverage']) &&
    ['local', 'domicilio', 'mixto'].includes(String(value['coverage']['mode'])) &&
    (value['coverage']['radiusKm'] === null || Number.isInteger(value['coverage']['radiusKm'])) &&
    typeof value['verified'] === 'boolean' &&
    Number.isInteger(value['completedJobs']) &&
    (value['rating'] === null ||
      (esRegistro(value['rating']) &&
        typeof value['rating']['average'] === 'number' &&
        value['rating']['average'] >= 1 &&
        value['rating']['average'] <= 5 &&
        Number.isInteger(value['rating']['count']) &&
        Number(value['rating']['count']) >= 1)) &&
    esRegistro(availability) &&
    ['atiende_hoy', 'otros_dias', 'sin_agenda'].includes(String(availability['status'])) &&
    (value['yearsOfExperience'] === null || Number.isInteger(value['yearsOfExperience']))
  )
}

export function esPaginaDirectorio(value: unknown): value is PaginaDirectorio {
  return esRegistro(value) && Array.isArray(value['items']) && value['items'].every(esPrestadorPublico) && Number.isInteger(value['total']) && Number.isInteger(value['page']) && typeof value['hasMore'] === 'boolean'
}
