import { resolveWebApiBaseUrl } from '../../lib/api-url'

import { CATEGORIES, URGENCIES, categoryOf, type CategoryId, type MapRequest, type RequestFilters, type RequestsSource } from './types'

// Privacy guard applied to whatever the API returns (defence in depth; the API already sends only
// public fields): coordinates rounded to ~110 m (3 decimals), zone label only, at most two images.
export function toPublicRequest(request: MapRequest): MapRequest {
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    id: request.id,
    category: request.category,
    title: request.title.slice(0, 90),
    ...(request.description ? { description: request.description.slice(0, 160) } : {}),
    ...(request.requesterName ? { requesterName: publicName(request.requesterName) } : {}),
    approximateLocation: {
      lat: round(request.approximateLocation.lat),
      lng: round(request.approximateLocation.lng),
      label: request.approximateLocation.label.slice(0, 60),
    },
    ...(request.budgetLabel ? { budgetLabel: request.budgetLabel } : {}),
    ...(request.urgencyLabel ? { urgencyLabel: request.urgencyLabel } : {}),
    ...(request.createdAtLabel ? { createdAtLabel: request.createdAtLabel } : {}),
    images: (request.images ?? []).slice(0, 2),
  }
}

// "Laura Martínez" -> "Laura M." (first name and initial only).
export function publicName(name: string): string {
  const [first = '', last = ''] = name.trim().split(/\s+/u)
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .trim()

export function matchesFilters(request: MapRequest, filters: RequestFilters): boolean {
  if (filters.category && request.category !== filters.category) return false
  if (filters.zone && !normalize(request.approximateLocation.label).includes(normalize(filters.zone))) return false
  const terms = normalize(filters.query).split(/\s+/u).filter((term) => term.length > 2)
  if (terms.length === 0) return true
  const category = categoryOf(request.category)
  const haystack = normalize(`${request.title} ${request.description ?? ''} ${category.label} ${category.keywords}`)
  return terms.some((term) => haystack.includes(term.slice(0, Math.max(4, term.length - 2))))
}

// Shape of GET /tus/v1/public/solicitudes (apps/api/src/tus/solicitudes/modelo.ts).
export interface PublicRequestDto {
  id: string
  category: string
  title: string
  description: string | null
  requesterName: string
  approximateLocation: { lat: number; lng: number; label: string }
  budgetMax: number | null
  urgency: string
  createdAt: string
  images: string[]
}

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function budgetLabel(budgetMax: number | null): string {
  return budgetMax ? `Hasta $${PESOS.format(budgetMax)}` : 'A convenir'
}

export function urgencyLabel(urgency: string): string {
  return URGENCIES.find((item) => item.id === urgency)?.label ?? ''
}

export function timeAgoLabel(createdAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(createdAt)) / 60_000))
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return 'Recién'
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Hace ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Hace 1 día' : `Hace ${days} días`
}

// Drops anything malformed instead of breaking the map.
export function fromPublicDto(dto: PublicRequestDto, now = Date.now()): MapRequest | null {
  const location = dto?.approximateLocation
  if (typeof dto?.id !== 'string' || !CATEGORIES.some((category) => category.id === dto.category)) return null
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng) || typeof location.label !== 'string') return null
  return toPublicRequest({
    id: dto.id,
    category: dto.category as CategoryId,
    title: String(dto.title ?? ''),
    ...(dto.description ? { description: dto.description } : {}),
    ...(dto.requesterName ? { requesterName: dto.requesterName } : {}),
    approximateLocation: { lat: location.lat, lng: location.lng, label: location.label },
    budgetLabel: budgetLabel(dto.budgetMax),
    urgencyLabel: urgencyLabel(dto.urgency),
    createdAtLabel: timeAgoLabel(dto.createdAt, now),
    images: Array.isArray(dto.images) ? dto.images.filter((image) => typeof image === 'string' && image.startsWith('/')) : [],
  })
}

// Requests published by clients, stored in the TUS PostgreSQL (Supabase in production) and read
// through the API. The Web never talks to the database directly.
export function createApiRequestsSource(fetchImpl: typeof fetch = (...args) => fetch(...args)): RequestsSource {
  return {
    async list({ category }) {
      const base = resolveWebApiBaseUrl({
        canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
        legacyUrl: process.env['API_BASE_URL'],
        nodeEnv: process.env['NODE_ENV'],
      })
      const query = category ? `?categoria=${encodeURIComponent(category)}` : ''
      const response = await fetchImpl(`${base}/tus/v1/public/solicitudes${query}`, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`Solicitudes no disponibles (HTTP ${response.status})`)
      const body = (await response.json()) as { items?: PublicRequestDto[] }
      const now = Date.now()
      return (Array.isArray(body.items) ? body.items : []).map((item) => fromPublicDto(item, now)).filter((item): item is MapRequest => item !== null)
    },
  }
}

const apiRequestsSource = createApiRequestsSource()

export function getRequestsSource(): RequestsSource {
  return apiRequestsSource
}
