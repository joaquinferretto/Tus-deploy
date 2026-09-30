import type { GeocodificadorInverso } from './resolucion.ts'

// Reverse geocoding used ONLY when a point is saved (provider or admin) and no stored polygon
// contains it, to match names against existing localities/zones/neighbourhoods. Never on map
// loads, never to create or modify areas. Configurable:
//   TUS_REVERSE_GEOCODER=off               disables it (points stay "sin asociar");
//   TUS_REVERSE_GEOCODER_URL=https://...   Nominatim-compatible base (default: OpenStreetMap).
// Bounded: 4 s timeout; any failure means "no names" (the point is kept, never lost).

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export class GeocodificadorNominatim implements GeocodificadorInverso {
  constructor(
    private readonly baseUrl = 'https://nominatim.openstreetmap.org',
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
    private readonly timeoutMs = 4000
  ) {}

  async nombres(lat: number, lng: number): Promise<string[]> {
    const url = `${this.baseUrl.replace(/\/+$/u, '')}/reverse?format=jsonv2&zoom=16&addressdetails=1&accept-language=es&lat=${encodeURIComponent(lat.toFixed(6))}&lon=${encodeURIComponent(lng.toFixed(6))}`
    const response = await this.fetchImpl(url, {
      headers: { 'user-agent': 'TUS/1.0 (https://tusservicios.shop)', accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) return []
    const body = (await response.json()) as { address?: Record<string, unknown> }
    const address = body.address ?? {}
    // Most specific first: neighbourhood-like names, then city-like names.
    return ['neighbourhood', 'suburb', 'quarter', 'city_district', 'hamlet', 'village', 'town', 'city', 'municipality']
      .map((key) => address[key])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80)
  }
}

export function crearGeocodificador(env: Record<string, string | undefined>): GeocodificadorInverso | null {
  if (env['TUS_REVERSE_GEOCODER']?.trim().toLowerCase() === 'off') return null
  const base = env['TUS_REVERSE_GEOCODER_URL']?.trim()
  return new GeocodificadorNominatim(base && /^https:\/\//u.test(base) ? base : undefined)
}
