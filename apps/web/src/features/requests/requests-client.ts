import type { PostulanteSolicitud } from '@factory/contracts'

import { resolveWebApiBaseUrl } from '../../lib/api-url'
import type { TusWebSession } from '../../lib/tus-ui-contract'

import type { PublicRequestDto } from '../home/requests-source'
import type { CategoryId, UrgencyId } from '../home/types'

// Client for publishing service requests. Same Bearer session as the rest of TUS; the API
// derives the account, public name and approximate point (never sent by the browser).

export interface NewRequestInput {
  category: CategoryId
  title: string
  description: string
  zone: string
  budgetMax: number | null
  urgency: UrgencyId
  // Id público del perfil elegido: la solicitud queda dirigida a ese prestador ("pendiente").
  providerId?: string
  origin?: 'web_publica' | 'web_assistant' | 'web_directory'
}

export type RequestAssignment = 'pendiente' | 'aceptada' | 'rechazada' | 'cancelada'

export interface OwnRequestDto extends PublicRequestDto {
  status: 'abierta' | 'cerrada'
  expiresAt: string
  origin: string
  provider: { id: string; displayName: string } | null
  assignment: RequestAssignment | null
  respondedAt: string | null
}

export type RequestField = 'category' | 'title' | 'description' | 'zone' | 'budgetMax' | 'urgency'

export type PublishResult =
  | { ok: true; request: OwnRequestDto }
  | { ok: false; kind: 'invalid'; fields: RequestField[] }
  | { ok: false; kind: 'unauthorized' | 'rate_limited' | 'not_allowed' | 'unavailable' | 'provider_unavailable' | 'self_request' }

export type ImageUploadResult = { ok: true } | { ok: false; kind: 'invalid' | 'limit' | 'unavailable' }

function apiBase(): string {
  return resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })
}

export function createRequestsClient(session: TusWebSession, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const headers = (json = false): Record<string, string> => ({
    Accept: 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
    'X-Correlation-Id': session.correlationId,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  })

  return {
    async publish(input: NewRequestInput): Promise<PublishResult> {
      try {
        const response = await fetchImpl(`${apiBase()}/tus/v1/solicitudes`, {
          method: 'POST',
          cache: 'no-store',
          headers: headers(true),
          body: JSON.stringify(input),
        })
        if (response.ok) return { ok: true, request: (await response.json()) as OwnRequestDto }
        if (response.status === 422) {
          const body = (await response.json().catch(() => null)) as { fields?: RequestField[] } | null
          return { ok: false, kind: 'invalid', fields: Array.isArray(body?.fields) ? body.fields : [] }
        }
        if (response.status === 401) return { ok: false, kind: 'unauthorized' }
        if (response.status === 429) return { ok: false, kind: 'rate_limited' }
        if (response.status === 409) {
          const body = (await response.json().catch(() => null)) as { code?: string } | null
          return { ok: false, kind: body?.code === 'SELF_REQUEST' ? 'self_request' : 'provider_unavailable' }
        }
        if (response.status === 403) return { ok: false, kind: 'not_allowed' }
        return { ok: false, kind: 'unavailable' }
      } catch {
        return { ok: false, kind: 'unavailable' }
      }
    },

    // Photos go after the request exists (octet-stream; the API strips metadata).
    async uploadImage(id: string, file: Blob): Promise<ImageUploadResult> {
      try {
        const response = await fetchImpl(`${apiBase()}/tus/v1/solicitudes/${encodeURIComponent(id)}/imagenes`, {
          method: 'POST',
          cache: 'no-store',
          headers: { ...headers(), 'Content-Type': 'application/octet-stream' },
          body: file,
        })
        if (response.ok) return { ok: true }
        if (response.status === 409) return { ok: false, kind: 'limit' }
        if (response.status === 422 || response.status === 415) return { ok: false, kind: 'invalid' }
        return { ok: false, kind: 'unavailable' }
      } catch {
        return { ok: false, kind: 'unavailable' }
      }
    },

    async mine(): Promise<OwnRequestDto[]> {
      const response = await fetchImpl(`${apiBase()}/tus/v1/solicitudes/mias`, { cache: 'no-store', headers: headers() })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as { items?: OwnRequestDto[] }
      return Array.isArray(body.items) ? body.items : []
    },

    // Providers who offered to help with a public request. The client decides.
    async applicants(id: string): Promise<PostulanteSolicitud[]> {
      const response = await fetchImpl(`${apiBase()}/tus/v1/solicitudes/${encodeURIComponent(id)}/postulaciones`, { cache: 'no-store', headers: headers() })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as { items?: PostulanteSolicitud[] }
      return Array.isArray(body.items) ? body.items : []
    },

    // Accepting one takes the request off the map, confirms that provider and declines the rest.
    async chooseApplicant(id: string, applicationId: string): Promise<OwnRequestDto | null> {
      const response = await fetchImpl(`${apiBase()}/tus/v1/solicitudes/${encodeURIComponent(id)}/postulaciones/${encodeURIComponent(applicationId)}/aceptar`, {
        method: 'POST',
        cache: 'no-store',
        headers: headers(true),
        body: '{}',
      })
      return response.ok ? ((await response.json()) as OwnRequestDto) : null
    },

    async declineApplicant(id: string, applicationId: string): Promise<boolean> {
      const response = await fetchImpl(`${apiBase()}/tus/v1/solicitudes/${encodeURIComponent(id)}/postulaciones/${encodeURIComponent(applicationId)}/rechazar`, {
        method: 'POST',
        cache: 'no-store',
        headers: headers(true),
        body: '{}',
      })
      return response.ok
    },

    async close(id: string): Promise<boolean> {
      const response = await fetchImpl(`${apiBase()}/tus/v1/solicitudes/${encodeURIComponent(id)}/cerrar`, {
        method: 'POST',
        cache: 'no-store',
        headers: headers(true),
        body: '{}',
      })
      return response.ok
    },
  }
}

// Spanish messages per field (mirrors the API validation in tus/solicitudes/modelo.ts).
export const FIELD_MESSAGES: Record<RequestField, string> = {
  category: 'Elegí una categoría.',
  title: 'Escribí un título de 5 a 90 caracteres, sin teléfonos, emails ni links.',
  description: 'La descripción admite hasta 500 caracteres, sin teléfonos, emails ni links.',
  zone: 'Elegí tu barrio.',
  budgetMax: 'Ingresá un monto en pesos, sin decimales, o dejalo vacío.',
  urgency: 'Elegí la urgencia.',
}

// Same rules as the API; the API remains the authority.
export function validateNewRequest(input: NewRequestInput): RequestField[] {
  const fields: RequestField[] = []
  const contact = (value: string) => /[^\s@]+@[^\s@]+\.[a-z]{2,}/iu.test(value) || /(?:\+?\d[\s().-]?){8,}/u.test(value) || /(?:https?:\/\/|www\.)/iu.test(value)
  const title = input.title.trim()
  if (!input.category) fields.push('category')
  if (title.length < 5 || title.length > 90 || contact(title)) fields.push('title')
  if (input.description.trim().length > 500 || contact(input.description)) fields.push('description')
  if (!input.zone) fields.push('zone')
  if (input.budgetMax !== null && (!Number.isInteger(input.budgetMax) || input.budgetMax <= 0 || input.budgetMax > 100_000_000)) fields.push('budgetMax')
  if (!input.urgency) fields.push('urgency')
  return fields
}

// "Elegido" is not "confirmado": a directed request shows the provider's real answer.
export function requestStatusLabel(item: OwnRequestDto): string {
  if (item.provider || item.assignment) {
    const name = item.provider?.displayName ?? 'el profesional'
    switch (item.assignment) {
      case 'aceptada':
        // Directed (the provider accepted) or chosen among applicants (the client accepted).
        return `Confirmado con ${name}`
      case 'rechazada':
        return `${name} no puede tomarla. Podés elegir a otro profesional.`
      case 'cancelada':
        return 'Cancelaste esta solicitud'
      default:
        return `Enviada a ${name} · pendiente de aceptación`
    }
  }
  return item.status === 'abierta' ? 'Publicada en el mapa' : 'Cerrada'
}

export const APPLICATION_STATUS: Record<PostulanteSolicitud['status'], string> = {
  pendiente: 'Esperando tu decisión',
  aceptada: 'Aceptado',
  rechazada: 'No elegido',
  retirada: 'Se retiró'
}
