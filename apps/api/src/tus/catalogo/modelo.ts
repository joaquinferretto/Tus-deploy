// Catálogo de TUS (oficios, categorías y ubicaciones). La fuente de verdad es PostgreSQL
// (tablas categorias_servicio, oficios_servicio, sinonimos_oficio, localidades, zonas_ubicacion y
// barrios) administrada desde el panel. En memoria vive una copia vigente (vigente.ts) que se
// recarga al iniciar, después de cada cambio del panel y periódicamente.

export interface CategoriaCatalogo {
  id: string
  nombre: string
  slug: string
  descripcion: string | null
  activo: boolean
  orden: number
}

export interface OficioCatalogo {
  id: string
  categoriaId: string | null
  nombre: string
  profesion: string
  slug: string
  descripcion: string | null
  icono: string
  activo: boolean
  orden: number
  sinonimos: string[]
}

export interface LocalidadCatalogo {
  id: string
  nombre: string
  provincia: string
  activo: boolean
  orden: number
  // Reference point of the town (map centre of the people who live there). Optional.
  lat?: number | null
  lng?: number | null
}

export interface ZonaCatalogo {
  id: string
  localidadId: string
  nombre: string
  slug: string
  activo: boolean
  orden: number
  // Optional drawn polygon and reference point (fallback when there is no polygon).
  poligono: PoligonoGeoJson | null
  lat: number | null
  lng: number | null
}

export interface BarrioCatalogo {
  id: string
  localidadId: string
  zonaId: string | null
  nombre: string
  slug: string
  // Punto aproximado que ubica el barrio en el mapa (nunca una dirección): el fallback.
  lat: number | null
  lng: number | null
  // Optional drawn polygon (null after an administrator removes it).
  poligono: PoligonoGeoJson | null
  activo: boolean
  orden: number
}

export interface PoligonoGeoJson {
  type: 'Polygon'
  coordinates: [number, number][][]
}

export function poligonoDesdeCentro(lat: number, lng: number, radio = 0.003): PoligonoGeoJson {
  return { type: 'Polygon', coordinates: [[
    [lng - radio, lat - radio], [lng + radio, lat - radio], [lng + radio, lat + radio], [lng - radio, lat + radio], [lng - radio, lat - radio],
  ]] }
}

export function validarPoligono(value: unknown): PoligonoGeoJson | null {
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'Polygon') return null
  const rings = (value as { coordinates?: unknown }).coordinates
  if (!Array.isArray(rings) || rings.length !== 1 || !Array.isArray(rings[0])) return null
  const points = rings[0].map((point) => Array.isArray(point) && point.length === 2 ? [Number(point[0]), Number(point[1])] as [number, number] : null)
  if (points.some((point) => point === null)) return null
  if (points.length > 200) return null
  // A repeated consecutive vertex (a double click on the map) is dropped, not an error.
  const valid = (points as [number, number][]).filter((point, index, all) => index === 0 || point[0] !== all[index - 1]![0] || point[1] !== all[index - 1]![1])
  if (valid.length < 3 || valid.some(([lng, lat]) => !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)) return null
  if (new Set(valid.map(([lng, lat]) => `${lng.toFixed(7)}:${lat.toFixed(7)}`)).size < 3) return null
  const first = valid[0]!
  const last = valid.at(-1)!
  const closed = first[0] === last[0] && first[1] === last[1] ? valid : [...valid, first]
  // Collinear vertices enclose no surface (about 1 m2 minimum): not an area.
  let doble = 0
  for (let index = 0; index < closed.length - 1; index += 1) doble += closed[index]![0] * closed[index + 1]![1] - closed[index + 1]![0] * closed[index]![1]
  if (Math.abs(doble) / 2 < 1e-10) return null
  for (let left = 0; left < closed.length - 1; left += 1)
    for (let right = left + 2; right < closed.length - 1; right += 1) {
      if (left === 0 && right === closed.length - 2) continue
      if (intersectan(closed[left]!, closed[left + 1]!, closed[right]!, closed[right + 1]!)) return null
    }
  return { type: 'Polygon', coordinates: [closed] }
}

function intersectan(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const giro = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return giro(a, b, c) !== giro(a, b, d) && giro(c, d, a) !== giro(c, d, b)
}

export interface CatalogoTus {
  categorias: CategoriaCatalogo[]
  oficios: OficioCatalogo[]
  localidades: LocalidadCatalogo[]
  zonas: ZonaCatalogo[]
  barrios: BarrioCatalogo[]
}

// Íconos disponibles para un oficio (el ícono es un recurso de la interfaz; el oficio guarda la
// clave). La Web dibuja cada clave; una clave desconocida usa el ícono genérico.
export const ICONOS_OFICIO = [
  'plomeria', 'electricidad', 'aire', 'pintura', 'mecanica', 'cerrajeria', 'albanileria',
  'carpinteria', 'jardineria', 'electrodomesticos', 'limpieza', 'mudanza', 'herramienta',
] as const

export type IconoOficio = (typeof ICONOS_OFICIO)[number]

export function slugificar(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/ñ/gu, 'n')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
}

// Un oficio se ofrece si él y su categoría están activos; un barrio, si él, su zona y su
// localidad lo están. Lo inactivo se conserva para los registros existentes.
export function oficioVigente(catalogo: CatalogoTus, oficio: OficioCatalogo): boolean {
  if (!oficio.activo) return false
  const categoria = oficio.categoriaId ? catalogo.categorias.find((item) => item.id === oficio.categoriaId) : null
  return !categoria || categoria.activo
}

export function barrioVigente(catalogo: CatalogoTus, barrio: BarrioCatalogo): boolean {
  if (!barrio.activo) return false
  const localidad = catalogo.localidades.find((item) => item.id === barrio.localidadId)
  if (localidad && !localidad.activo) return false
  const zona = barrio.zonaId ? catalogo.zonas.find((item) => item.id === barrio.zonaId) : null
  return !zona || zona.activo
}
