// State of the home map that lives in the URL, so a search can be shared and the back button
// works: /?tipo=alojamientos&alojamiento=cabana&personas=4 or /?categoria=hogar&servicio=plomeria.
// The query string is untrusted input: only known keys are read, every value is checked against a
// fixed shape and, once the catalog is known, against the catalog itself. Anything else is dropped.

export type MapKind = 'profesionales' | 'alojamientos'

export interface MapState {
  kind: MapKind
  category: string
  service: string
  zone: string
  lodgingType: string
  guests: number | null
}

export interface MapStateCatalog {
  categories: readonly string[]
  services: readonly { id: string; categoryId?: string | null }[]
  zones: readonly string[]
}

export const EMPTY_MAP_STATE: MapState = { kind: 'profesionales', category: '', service: '', zone: '', lodgingType: '', guests: null }
export const MAX_GUESTS = 20

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u
const id = (value: string | null): string => (value !== null && ID.test(value) ? value : '')

export function parseMapState(search: string, catalog?: MapStateCatalog): MapState {
  const params = new URLSearchParams(search)
  const kind: MapKind = params.get('tipo') === 'alojamientos' ? 'alojamientos' : 'profesionales'
  if (kind === 'alojamientos') {
    const guests = Number(params.get('personas'))
    return {
      ...EMPTY_MAP_STATE,
      kind,
      lodgingType: id(params.get('alojamiento')),
      guests: Number.isInteger(guests) && guests >= 1 && guests <= MAX_GUESTS ? guests : null,
    }
  }
  let service = id(params.get('servicio'))
  let category = id(params.get('categoria'))
  let zone = (params.get('zona') ?? '').trim().slice(0, 80)
  if (catalog) {
    const known = catalog.services.find((item) => item.id === service)
    if (!known) service = ''
    // A service decides its category; a category that does not exist is dropped.
    if (known?.categoryId) category = known.categoryId
    if (!catalog.categories.includes(category)) category = ''
    if (!catalog.zones.includes(zone)) zone = ''
  }
  return { ...EMPTY_MAP_STATE, kind, category, service, zone }
}

// The query string for a state ('' for the default one, so the home keeps its clean address).
export function mapStateQuery(state: MapState): string {
  const params = new URLSearchParams()
  if (state.kind === 'alojamientos') {
    params.set('tipo', 'alojamientos')
    if (state.lodgingType) params.set('alojamiento', state.lodgingType)
    if (state.guests) params.set('personas', String(state.guests))
  } else {
    if (state.category) params.set('categoria', state.category)
    if (state.service) params.set('servicio', state.service)
    if (state.zone) params.set('zona', state.zone)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}
