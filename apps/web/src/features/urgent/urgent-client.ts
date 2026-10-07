import type { TusWebSession } from '../../lib/tus-ui-contract'
import { authorizationHeader, fetchWithSession } from '../../lib/session-credentials'
import { apiBase } from '../directory/directory-client'

// SERVICIO-URGENTE-01. Client of the urgent service: the client asks for immediate attention and
// TUS offers the request, at once, to every compatible provider; the first that accepts is
// assigned. Everything goes through the TUS API, which takes who acts from the session.

export type UrgentStatus = 'pendiente' | 'tomada' | 'sin_candidatos' | 'todos_rechazaron' | 'vencida' | 'cancelada'
export type UrgentOfferStatus = 'notificada' | 'no_enviada' | 'acepto' | 'no_puede' | 'cerrada_por_otro' | 'renuncio' | 'vencida'

export interface OwnUrgentRequest {
  id: string
  category: string
  service: string
  description: string | null
  address: string
  zone: string
  status: UrgentStatus
  createdAt: string
  expiresAt: string
  candidates: number
  notified: number
  reopenings: number
  provider: { name: string } | null
  workId: string | null
  // Its work was cancelled afterwards: the client may ask for another urgent provider.
  workCancelled: boolean
  message?: string
}

// What the provider declared: the switch, "toda la ciudad", and the coverage it has on file.
export interface UrgentPreference {
  acceptsUrgent: boolean
  wholeCity: boolean
  zones: string[]
  radiusKm: number | null
}

// What a provider sees of an offer: the address and the zone from the first moment.
export interface UrgentOffer {
  id: string
  category: string
  service: string
  client: string
  description: string | null
  address: string
  zone: string
  createdAt: string
  expiresAt: string
  offer: UrgentOfferStatus
  open: boolean
  assigned: boolean
  workId: string | null
}

export interface UrgentAnswer {
  status: string
  message: string
  workId: string | null
}

export type UrgentField = 'category' | 'description' | 'address' | 'zone'

export type CreateUrgentResult =
  | { ok: true; request: OwnUrgentRequest }
  | { ok: false; kind: 'invalid'; fields: UrgentField[] }
  | { ok: false; kind: 'already_open' | 'rate_limited' | 'not_allowed' | 'unauthorized' | 'unavailable' }

type Fetch = typeof fetch

export function createUrgentClient(session: TusWebSession, fetchImpl: Fetch = fetchWithSession) {
  const request = async (path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    const response = await fetchImpl(`${apiBase()}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...authorizationHeader(session.accessToken), 'X-Correlation-Id': session.correlationId },
    })
    return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null }
  }
  const items = async <T>(path: string): Promise<T[]> => {
    const { status, body } = await request(path)
    if (status !== 200 || !Array.isArray(body?.['items'])) throw new Error(`urgent request failed (${status})`)
    return body['items'] as T[]
  }
  return {
    async create(input: { category: string; description: string; address: string; zone: string }): Promise<CreateUrgentResult> {
      let result: Awaited<ReturnType<typeof request>>
      try {
        result = await request('/tus/v1/urgentes', { method: 'POST', body: JSON.stringify(input) })
      } catch {
        return { ok: false, kind: 'unavailable' }
      }
      const { status, body } = result
      if (status === 201 && body && typeof body['id'] === 'string') return { ok: true, request: body as unknown as OwnUrgentRequest }
      if (status === 422) return { ok: false, kind: 'invalid', fields: Array.isArray(body?.['fields']) ? (body['fields'] as UrgentField[]) : [] }
      if (status === 409 && body?.['code'] === 'URGENT_ALREADY_OPEN') return { ok: false, kind: 'already_open' }
      if (status === 429) return { ok: false, kind: 'rate_limited' }
      if (status === 401) return { ok: false, kind: 'unauthorized' }
      if (status === 403) return { ok: false, kind: 'not_allowed' }
      return { ok: false, kind: 'unavailable' }
    },
    mine: () => items<OwnUrgentRequest>('/tus/v1/urgentes/mias'),
    offers: () => items<UrgentOffer>('/tus/v1/prestador/urgentes'),
    // null: this account has no provider profile.
    async preference(): Promise<UrgentPreference | null> {
      const { status, body } = await request('/tus/v1/prestador/urgentes/preferencia')
      if (status === 409) return null
      if (status !== 200 || !body) throw new Error(`urgent preference failed (${status})`)
      return toPreference(body)
    },
    // Only the field that is sent changes.
    async savePreference(change: { acceptsUrgent?: boolean; wholeCity?: boolean }): Promise<UrgentPreference> {
      const { status, body } = await request('/tus/v1/prestador/urgentes/preferencia', { method: 'PUT', body: JSON.stringify(change) })
      if (status !== 200 || !body) throw new Error(`urgent preference failed (${status})`)
      return toPreference(body)
    },
    // The answer always carries what happened in words ("ya fue tomada…"), also when it lost.
    async answer(id: string, decision: 'asistir' | 'no-puedo', reason?: string): Promise<UrgentAnswer> {
      const { status, body } = await request(`/tus/v1/prestador/urgentes/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}) })
      if (typeof body?.['message'] !== 'string') throw new Error(`urgent answer failed (${status})`)
      return { status: String(body['status'] ?? ''), message: body['message'], workId: typeof body['workId'] === 'string' ? body['workId'] : null }
    },
  }
}

function toPreference(body: Record<string, unknown>): UrgentPreference {
  return {
    acceptsUrgent: body['acceptsUrgent'] === true,
    wholeCity: body['wholeCity'] === true,
    zones: Array.isArray(body['zones']) ? body['zones'].filter((zone): zone is string => typeof zone === 'string') : [],
    radiusKm: typeof body['radiusKm'] === 'number' ? body['radiusKm'] : null,
  }
}

export const URGENT_STATUS_LABEL: Record<UrgentStatus, string> = {
  pendiente: 'Buscando un prestador',
  tomada: 'Un prestador la tomó',
  sin_candidatos: 'Sin prestadores disponibles',
  todos_rechazaron: 'Nadie pudo tomarla',
  vencida: 'Venció sin respuesta',
  cancelada: 'Cancelada',
}
