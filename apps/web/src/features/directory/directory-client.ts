import type {
  CatalogoOficios,
  InterpretacionNecesidad,
  PaginaDirectorio,
  PerfilPrestadorPublico,
  ResultadoCandidatos,
  SolicitudRecibidaPrestador,
} from '@factory/contracts'

import { resolveWebApiBaseUrl } from '../../lib/api-url'
import type { TusWebSession } from '../../lib/tus-ui-contract'

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
      ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Correlation-Id': session.correlationId } : {}),
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

export function createDirectoryClient(fetchImpl: Fetch = (...args) => fetch(...args)) {
  return {
    catalog: () => call<CatalogoOficios>(fetchImpl, '/tus/v1/public/oficios'),
    list: (filters: DirectoryFilters) => call<PaginaDirectorio>(fetchImpl, `/tus/v1/public/prestadores${directoryQuery(filters)}`),
    profile: (id: string) => call<PerfilPrestadorPublico>(fetchImpl, `/tus/v1/public/prestadores/${encodeURIComponent(id)}`),
    interpret: (text: string) =>
      call<InterpretacionNecesidad>(fetchImpl, '/tus/v1/asistente/interpretar', { method: 'POST', body: JSON.stringify({ text }) }),
    candidates: (session: TusWebSession, input: { profession: string; zone: string | null }) =>
      call<ResultadoCandidatos>(fetchImpl, '/tus/v1/asistente/candidatos', { method: 'POST', body: JSON.stringify(input) }, session),
    // Provider side.
    myProfile: (session: TusWebSession) => call<{ profile: (PerfilPrestadorPublico & { visible: boolean }) | null }>(fetchImpl, '/tus/v1/prestador/perfil-publico', {}, session),
    saveProfile: (session: TusWebSession, input: { displayName: string; profession: string; zone: string; description: string; yearsOfExperience: number | null; visible: boolean }) =>
      call<{ profile: PerfilPrestadorPublico & { visible: boolean } }>(fetchImpl, '/tus/v1/prestador/perfil-publico', { method: 'PUT', body: JSON.stringify(input) }, session),
    inbox: (session: TusWebSession) => call<{ items: SolicitudRecibidaPrestador[] }>(fetchImpl, '/tus/v1/prestador/solicitudes', {}, session),
    answer: (session: TusWebSession, id: string, decision: 'aceptar' | 'rechazar') =>
      call<SolicitudRecibidaPrestador>(fetchImpl, `/tus/v1/prestador/solicitudes/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body: '{}' }, session),
  }
}

// Private images (directed requests) need the Bearer header: fetched as a blob URL.
export async function privateImageUrl(session: TusWebSession, path: string, fetchImpl: Fetch = (...args) => fetch(...args)): Promise<string | null> {
  if (!path.startsWith('/tus/v1/solicitudes/')) return null
  try {
    const response = await fetchImpl(`${apiBase()}${path}`, { headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Correlation-Id': session.correlationId }, cache: 'no-store' })
    if (!response.ok) return null
    return URL.createObjectURL(await response.blob())
  } catch {
    return null
  }
}

export const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const
