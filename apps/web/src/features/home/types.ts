// Public view model of a service request shown on the home map and list. It only carries data
// that may be public BEFORE a provider is engaged: approximate zone, first name + initial, and
// optional photos chosen by the client. Never an exact address, phone or private coordinates.
export interface MapRequest {
  id: string
  category: CategoryId
  title: string
  description?: string
  requesterName?: string
  approximateLocation: {
    lat: number
    lng: number
    label: string
  }
  budgetLabel?: string
  urgencyLabel?: string
  createdAtLabel?: string
  // 0, 1 or 2 client photos (never more).
  images?: string[]
}

// Trade ids come from the administered catalog (features/catalog/use-catalog.ts).
export type CategoryId = string

export interface RequestFilters {
  query: string
  category: CategoryId | ''
  zone: string
}

export const EMPTY_FILTERS: RequestFilters = { query: '', category: '', zone: '' }

export interface RequestsSource {
  // Server-side filter by category; text and zone filters run in the browser (same list for map
  // and list, no refetch on every keystroke).
  list(input: { category: CategoryId | '' }): Promise<MapRequest[]>
}

export const URGENCIES = [
  { id: 'urgente', label: 'Urgente' },
  { id: 'hoy_manana', label: 'Hoy o mañana' },
  { id: 'esta_semana', label: 'Esta semana' },
  { id: 'sin_apuro', label: 'Sin apuro' },
] as const

export type UrgencyId = (typeof URGENCIES)[number]['id']

// Default map view (configurable). Corrientes Capital for the MVP; no geolocation is requested.
export const DEFAULT_MAP_CENTER = {
  lat: Number(process.env['NEXT_PUBLIC_MAP_DEFAULT_LAT'] ?? '') || -27.4692,
  lng: Number(process.env['NEXT_PUBLIC_MAP_DEFAULT_LNG'] ?? '') || -58.8306,
  zoom: 13,
  label: process.env['NEXT_PUBLIC_MAP_DEFAULT_LABEL'] || 'Corrientes Capital',
}
