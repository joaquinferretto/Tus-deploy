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
}

export interface OwnRequestDto extends PublicRequestDto {
  status: 'abierta' | 'cerrada'
  expiresAt: string
}

export type RequestField = 'category' | 'title' | 'description' | 'zone' | 'budgetMax' | 'urgency'

export type PublishResult =
  | { ok: true; request: OwnRequestDto }
  | { ok: false; kind: 'invalid'; fields: RequestField[] }
  | { ok: false; kind: 'unauthorized' | 'rate_limited' | 'not_allowed' | 'unavailable' }

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
        if (response.status === 403) return { ok: false, kind: 'not_allowed' }
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
