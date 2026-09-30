import type {
  CatalogoOficios,
  InterpretacionNecesidad,
  PaginaDirectorio,
  PerfilPrestadorPublico,
  PostulacionPrestador,
  ResultadoCandidatos,
  SolicitudRecibidaPrestador,
} from '@factory/contracts'

import { resolveWebApiBaseUrl } from '../../lib/api-url'
import type { TusWebSession } from '../../lib/tus-ui-contract'
import { authorizationHeader, fetchWithSession } from '../../lib/session-credentials'

// Client of the directory ("Buscar trabajador"), the assistant ("Buscar servicios") and the
// provider inbox. Everything goes through the TUS API; the Web never talks to the database.

export class DirectoryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly fields: string[] = []
  ) {
    super(`TUS request failed (${status}${code ? ` ${code}` : ''})`)
  }
}

export function apiBase(): string {
  return resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })
}

// Absolute URL for an API path returned by the API (e.g. request images).
export function apiUrl(path: string): string {
  return path.startsWith('/tus/v1/') ? `${apiBase()}${path}` : ''
}

type Fetch = typeof fetch

async function call<T>(fetchImpl: Fetch, path: string, init: RequestInit = {}, session?: TusWebSession): Promise<T> {
  const response = await fetchImpl(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(session ? { ...authorizationHeader(session.accessToken), 'X-Correlation-Id': session.correlationId } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    ...(session ? { cache: 'no-store' as const } : {}),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: unknown; fields?: unknown } | null
    throw new DirectoryRequestError(
      response.status,
      typeof body?.code === 'string' ? body.code : null,
      Array.isArray(body?.fields) ? body.fields.filter((field): field is string => typeof field === 'string') : []
    )
  }
  return (await response.json()) as T
}

export interface DirectoryFilters {
  oficio?: string
  zona?: string
  q?: string
  verificados?: boolean
  hoy?: boolean
  orden?: 'relevancia' | 'trabajos' | 'cercania'
  pagina?: number
}

export function directoryQuery(filters: DirectoryFilters): string {
  const params = new URLSearchParams()
  if (filters.oficio) params.set('oficio', filters.oficio)
  if (filters.zona) params.set('zona', filters.zona)
  if (filters.q?.trim()) params.set('q', filters.q.trim())
  if (filters.verificados) params.set('verificados', '1')
  if (filters.hoy) params.set('hoy', '1')
  if (filters.orden && filters.orden !== 'relevancia') params.set('orden', filters.orden)
  if (filters.pagina && filters.pagina > 1) params.set('pagina', String(filters.pagina))
  const query = params.toString()
  return query ? `?${query}` : ''
}

// Location of a provider as the provider / admin sees it (never published as such).
export interface UbicacionPrestadorWeb {
  lat: number | null
  lng: number | null
  showExact: boolean
  association: 'poligono_barrio' | 'poligono_zona' | 'geocodificador' | 'manual' | 'sin_asociar' | null
  barrio: { id: string; name: string } | null
  zone: { id: string; name: string } | null
  mapPoint: { lat: number; lng: number; precision: 'exact' | 'barrio' | 'zona' | 'reference'; label: string } | null
}

export function createDirectoryClient(fetchImpl: Fetch = fetchWithSession) {
  return {
    catalog: () => call<CatalogoOficios>(fetchImpl, '/tus/v1/public/oficios'),
    list: (filters: DirectoryFilters) => call<PaginaDirectorio>(fetchImpl, `/tus/v1/public/prestadores${directoryQuery(filters)}`),
    profile: (id: string) => call<PerfilPrestadorPublico>(fetchImpl, `/tus/v1/public/prestadores/${encodeURIComponent(id)}`),
    interpret: (text: string) =>
      call<InterpretacionNecesidad>(fetchImpl, '/tus/v1/asistente/interpretar', { method: 'POST', body: JSON.stringify({ text }) }),
    // Public help: extractive answers from TUS public knowledge (never live account data).
    help: (question: string) => call<RespuestaAyudaPublica>(fetchImpl, '/tus/v1/asistente/ayuda', { method: 'POST', body: JSON.stringify({ question }) }),
    candidates: (session: TusWebSession, input: { profession: string; zone: string | null }) =>
      call<ResultadoCandidatos>(fetchImpl, '/tus/v1/asistente/candidatos', { method: 'POST', body: JSON.stringify(input) }, session),
    // Provider side.
    myProfile: (session: TusWebSession) => call<{ profile: (PerfilPrestadorPublico & { visible: boolean }) | null }>(fetchImpl, '/tus/v1/prestador/perfil-publico', {}, session),
    saveProfile: (session: TusWebSession, input: { displayName: string; profession: string; professions?: string[]; zone: string; serviceZones: string[]; serviceMode: 'local' | 'domicilio' | 'mixto'; coverageRadiusKm: number | null; description: string; yearsOfExperience: number | null; visible: boolean }) =>
      call<{ profile: PerfilPrestadorPublico & { visible: boolean } }>(fetchImpl, '/tus/v1/prestador/perfil-publico', { method: 'PUT', body: JSON.stringify(input) }, session),
    // Own map location (the API takes the provider from the session, never from the body).
    myLocation: (session: TusWebSession) => call<{ location: UbicacionPrestadorWeb | null }>(fetchImpl, '/tus/v1/prestador/ubicacion', {}, session),
    saveMyLocation: (session: TusWebSession, input: { lat: number; lng: number; showExact: boolean }) =>
      call<{ location: UbicacionPrestadorWeb }>(fetchImpl, '/tus/v1/prestador/ubicacion', { method: 'PUT', body: JSON.stringify(input) }, session),
    removeMyLocation: (session: TusWebSession) => call<{ location: UbicacionPrestadorWeb }>(fetchImpl, '/tus/v1/prestador/ubicacion', { method: 'DELETE' }, session),
    inbox: (session: TusWebSession) => call<{ items: SolicitudRecibidaPrestador[] }>(fetchImpl, '/tus/v1/prestador/solicitudes', {}, session),
    answer: (session: TusWebSession, id: string, decision: 'aceptar' | 'rechazar') =>
      call<SolicitudRecibidaPrestador>(fetchImpl, `/tus/v1/prestador/solicitudes/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body: '{}' }, session),
    // Public requests: the provider offers to help; the client decides.
    apply: (session: TusWebSession, id: string, message: string) =>
      call<PostulacionPrestador>(fetchImpl, `/tus/v1/prestador/solicitudes/${encodeURIComponent(id)}/postular`, { method: 'POST', body: JSON.stringify(message.trim() ? { message } : {}) }, session),
    myApplications: (session: TusWebSession) => call<{ items: PostulacionPrestador[] }>(fetchImpl, '/tus/v1/prestador/postulaciones', {}, session),
    withdraw: (session: TusWebSession, id: string) =>
      call<{ status: 'retirada' }>(fetchImpl, `/tus/v1/prestador/postulaciones/${encodeURIComponent(id)}/retirar`, { method: 'POST', body: '{}' }, session),
  }
}

// Private images (directed requests) need the Bearer header: fetched as a blob URL.
export async function privateImageUrl(session: TusWebSession, path: string, fetchImpl: Fetch = fetchWithSession): Promise<string | null> {
  if (!path.startsWith('/tus/v1/solicitudes/')) return null
  try {
    const response = await fetchImpl(`${apiBase()}${path}`, { headers: { ...authorizationHeader(session.accessToken), 'X-Correlation-Id': session.correlationId }, cache: 'no-store' })
    if (!response.ok) return null
    return URL.createObjectURL(await response.blob())
  } catch {
    return null
  }
}

export type RespuestaAyudaPublica =
  | { status: 'answered'; answers: { documentId: string; documentTitle: string; section: string; excerpt: string }[] }
  | { status: 'low_confidence' }

export const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const
