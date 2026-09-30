import { sinAcentos } from '../texto.ts'
import type { BarrioCatalogo, CatalogoTus, PoligonoGeoJson, ZonaCatalogo } from '../catalogo/modelo.ts'
import { area, coordenadasValidas, puntoEnPoligono, puntoInterior } from './geometria.ts'

// Geographic resolution of TUS. Everything reads the in-memory catalog snapshot (no query per
// provider): the map of N providers costs the same reads as the map of one.

export type PrecisionPunto = 'exact' | 'barrio' | 'zona' | 'reference'

export interface PuntoMapa {
  lat: number
  lng: number
  precision: PrecisionPunto
  // Public label: the neighbourhood / zone name ("Ubicación exacta" never names a street).
  label: string
}

export interface GeografiaPerfil {
  latitud: number | null
  longitud: number | null
  mostrarUbicacionExacta: boolean
  barrioId: string | null
  zonaId: string | null
  // Legacy text references (names) kept by profiles: main zone and coverage.
  zona: string | null
  zonasCobertura: readonly string[]
  // Neighbourhood name from the verified identity (last-resort area, never an address).
  barrioIdentidad?: string | null
}

const norm = (value: string) => sinAcentos(value.toLowerCase()).replace(/[^a-z0-9ñ\s]/gu, ' ').replace(/\s+/gu, ' ').trim()

function barrioDe(catalogo: CatalogoTus, geo: GeografiaPerfil): BarrioCatalogo | null {
  const porId = geo.barrioId ? catalogo.barrios.find((item) => item.id === geo.barrioId) : undefined
  if (porId) return porId
  for (const nombre of [geo.zona, ...geo.zonasCobertura, geo.barrioIdentidad]) {
    if (!nombre) continue
    const found = catalogo.barrios.find((item) => item.activo && norm(item.nombre) === norm(nombre))
    if (found) return found
  }
  return null
}

function zonaDe(catalogo: CatalogoTus, geo: GeografiaPerfil, barrio: BarrioCatalogo | null): ZonaCatalogo | null {
  const id = geo.zonaId ?? barrio?.zonaId ?? null
  if (id) return catalogo.zonas.find((item) => item.id === id) ?? null
  // A profile may name a zone directly ("Alta Gracia").
  for (const nombre of [geo.zona, ...geo.zonasCobertura]) {
    if (!nombre) continue
    const found = catalogo.zonas.find((item) => item.activo && norm(item.nombre) === norm(nombre))
    if (found) return found
  }
  return null
}

const interior = (poligono: PoligonoGeoJson | null | undefined) => (poligono ? puntoInterior(poligono.coordinates[0]!) : null)

// Deterministic priority (docs/DECISIONES_PRODUCTO_TUS.md, DIR-04):
//   1. exact point, only when the provider allows showing it;
//   2. a point inside the neighbourhood polygon;
//   3. a point inside the zone polygon;
//   4. the reference point of the neighbourhood, else of the zone;
//   5. null: never an invented coordinate.
export function resolverPuntoMapa(catalogo: CatalogoTus, geo: GeografiaPerfil): PuntoMapa | null {
  if (geo.mostrarUbicacionExacta && coordenadasValidas(geo.latitud, geo.longitud)) {
    const barrio = barrioDe(catalogo, geo)
    return { lat: geo.latitud, lng: geo.longitud!, precision: 'exact', label: barrio?.nombre ?? 'Ubicación del prestador' }
  }
  const barrio = barrioDe(catalogo, geo)
  const zona = zonaDe(catalogo, geo, barrio)
  const enBarrio = interior(barrio?.poligono)
  if (barrio && enBarrio) return { ...enBarrio, precision: 'barrio', label: barrio.nombre }
  const enZona = interior(zona?.poligono)
  if (zona && enZona) return { ...enZona, precision: 'zona', label: zona.nombre }
  if (barrio && coordenadasValidas(barrio.lat, barrio.lng)) return { lat: barrio.lat, lng: barrio.lng!, precision: 'reference', label: barrio.nombre }
  if (zona && coordenadasValidas(zona.lat, zona.lng)) return { lat: zona.lat, lng: zona.lng!, precision: 'reference', label: zona.nombre }
  return null
}

// ---- reverse: which internal area contains a point ---------------------------------------------

export type OrigenAsociacion = 'poligono_barrio' | 'poligono_zona' | 'geocodificador' | 'sin_asociar'

export interface AsociacionPunto {
  origen: OrigenAsociacion
  barrio: BarrioCatalogo | null
  zona: ZonaCatalogo | null
  localidadId: string | null
}

// Names returned by an external reverse geocoder for a point (neighbourhood, suburb, city...).
export interface GeocodificadorInverso {
  nombres(lat: number, lng: number): Promise<string[]>
}

// Stored polygons are the authority: the smallest containing neighbourhood, else the smallest
// containing zone. Only without any polygon match, the geocoder names are MATCHED against existing
// neighbourhoods / zones / localities (it never creates or modifies them).
export async function asociarPunto(
  catalogo: CatalogoTus,
  lat: number,
  lng: number,
  geocodificador: GeocodificadorInverso | null
): Promise<AsociacionPunto> {
  const contiene = <T extends { poligono: PoligonoGeoJson | null | undefined; activo: boolean }>(items: readonly T[]) =>
    items
      .filter((item) => item.activo && item.poligono && puntoEnPoligono(lat, lng, item.poligono.coordinates[0]!))
      .sort((a, b) => area(a.poligono!.coordinates[0]!) - area(b.poligono!.coordinates[0]!))[0] ?? null
  const barrio = contiene(catalogo.barrios)
  if (barrio) {
    const zona = barrio.zonaId ? (catalogo.zonas.find((item) => item.id === barrio.zonaId) ?? null) : null
    return { origen: 'poligono_barrio', barrio, zona, localidadId: barrio.localidadId }
  }
  const zona = contiene(catalogo.zonas)
  if (zona) return { origen: 'poligono_zona', barrio: null, zona, localidadId: zona.localidadId }
  const nombres = geocodificador ? await geocodificador.nombres(lat, lng).catch(() => [] as string[]) : []
  const claves = nombres.map(norm).filter(Boolean)
  const porNombre = <T extends { nombre: string; activo: boolean }>(items: readonly T[]) =>
    claves.map((clave) => items.find((item) => item.activo && norm(item.nombre) === clave)).find(Boolean) ?? null
  const barrioNombre = porNombre(catalogo.barrios)
  const zonaNombre = barrioNombre?.zonaId ? (catalogo.zonas.find((item) => item.id === barrioNombre.zonaId) ?? null) : porNombre(catalogo.zonas)
  const localidad = porNombre(catalogo.localidades)
  if (barrioNombre || zonaNombre)
    return { origen: 'geocodificador', barrio: barrioNombre, zona: zonaNombre, localidadId: barrioNombre?.localidadId ?? zonaNombre?.localidadId ?? localidad?.id ?? null }
  return { origen: 'sin_asociar', barrio: null, zona: null, localidadId: localidad?.id ?? null }
}
