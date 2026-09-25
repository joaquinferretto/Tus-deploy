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

// `keywords` let everyday words find the category ("cañería" -> Plomería).
export const CATEGORIES = [
  { id: 'plomeria', label: 'Plomería', color: '#2563eb', keywords: 'plomero plomeria cañeria caño cañerias agua perdida canilla inodoro termotanque destapacion' },
  { id: 'electricidad', label: 'Electricidad', color: '#ca8a04', keywords: 'electricista electricidad luz enchufe termica tablero cable corto' },
  { id: 'mecanica', label: 'Mecánica', color: '#16a34a', keywords: 'mecanico mecanica auto moto freno motor' },
  { id: 'pintura', label: 'Pintura', color: '#db2777', keywords: 'pintor pintura pintar pared humedad' },
  { id: 'aire', label: 'Aire acondicionado', color: '#0891b2', keywords: 'aire acondicionado split frio calor gas refrigeracion' },
  { id: 'otros', label: 'Otros', color: '#ff5a00', keywords: 'armado mueble placard cerrajero cerradura mudanza jardin' },
] as const

export type CategoryId = (typeof CATEGORIES)[number]['id']

export function categoryOf(id: string) {
  return CATEGORIES.find((category) => category.id === id) ?? CATEGORIES[CATEGORIES.length - 1]!
}

export interface RequestFilters {
  query: string
  category: CategoryId | ''
  zone: string
}

export const EMPTY_FILTERS: RequestFilters = { query: '', category: '', zone: '' }

export interface RequestsSource {
  // `example` data must be labelled as such in the UI.
  readonly kind: 'example' | 'api'
  list(filters: RequestFilters): Promise<MapRequest[]>
}

// Default map view (configurable). Córdoba Capital for the MVP; no geolocation is requested.
export const DEFAULT_MAP_CENTER = {
  lat: Number(process.env['NEXT_PUBLIC_MAP_DEFAULT_LAT'] ?? '') || -31.4167,
  lng: Number(process.env['NEXT_PUBLIC_MAP_DEFAULT_LNG'] ?? '') || -64.1833,
  zoom: 13,
  label: process.env['NEXT_PUBLIC_MAP_DEFAULT_LABEL'] || 'Córdoba Capital',
}
