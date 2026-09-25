import { EXAMPLE_REQUESTS } from './example-requests'
import { categoryOf, type MapRequest, type RequestFilters, type RequestsSource } from './types'

// Privacy guard applied to EVERY source (examples today, API later): coordinates are rounded to
// ~110 m (3 decimals) and only a zone label survives; at most two images; no exact addresses.
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

// TEMPORARY: the backend does not expose a public feed of client requests yet (commitments are
// private to each tenant). The home uses these centralized examples, clearly labelled in the UI,
// until an API source with the same shape exists. Swapping sources does not touch the UI.
export const exampleRequestsSource: RequestsSource = {
  kind: 'example',
  async list(filters) {
    return EXAMPLE_REQUESTS.map(toPublicRequest).filter((request) => matchesFilters(request, filters))
  },
}

export function getRequestsSource(): RequestsSource {
  return exampleRequestsSource
}
