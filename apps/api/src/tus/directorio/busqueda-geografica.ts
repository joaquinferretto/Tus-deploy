import type { BarrioCatalogo, CatalogoTus } from '../catalogo/modelo.ts'
import { coordenadasValidas, puntoEnPoligono, area } from '../geo/geometria.ts'
import { resolverPuntoMapa } from '../geo/resolucion.ts'
import type { PerfilPublico } from './modelo.ts'
import { normalizarTexto } from './oficios.ts'

// GEO-BUSQUEDA-01. Where a client looks for providers, decided here (the Web only asks):
//
//   cerca      providers within RADIO_CERCA_KM of the point the client gives, AND whose own rules
//              of coverage reach that point (being near is not enough for one who goes to homes);
//   localidad  providers whose area of work is in that town;
//   provincia  providers whose area of work is in any town of that province.
//
// The point of the client is used to compute a distance and nothing else: it is not stored, not
// logged and not given to any provider. What comes back is a distance in whole kilometres.
export const RADIO_CERCA_KM = 8
// A point outside every drawn neighbourhood belongs to the nearest one only this close.
const BARRIO_MAS_CERCANO_KM = 3

export type AmbitoBusqueda = 'cerca' | 'localidad' | 'provincia'
export interface Punto { lat: number; lng: number }

export function distanciaKm(a: Punto, b: Punto): number {
  const rad = (value: number) => (value * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// The point a query gives, rounded to about 100 metres (enough for 8 km; never the exact one).
export function leerPunto(lat: unknown, lng: unknown): Punto | null {
  const numero = (value: unknown) => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN)
  const la = numero(lat)
  const lo = numero(lng)
  if (!coordenadasValidas(la, lo)) return null
  return { lat: Math.round(la * 1000) / 1000, lng: Math.round(lo * 1000) / 1000 }
}

// Where a provider works FROM: the point it marked on the map (used to measure even when it is not
// published) or, without one, the reference of its neighbourhood or zone.
export function puntoBaseDePerfil(catalogo: CatalogoTus, perfil: PerfilPublico): Punto | null {
  if (coordenadasValidas(perfil.latitud, perfil.longitud)) return { lat: perfil.latitud, lng: perfil.longitud! }
  const punto = resolverPuntoMapa(catalogo, { latitud: null, longitud: null, mostrarUbicacionExacta: false, barrioId: perfil.barrioId, zonaId: perfil.zonaId, zona: perfil.zona, zonasCobertura: perfil.zonasCobertura })
  return punto ? { lat: punto.lat, lng: punto.lng } : null
}

// The neighbourhood of a point: the smallest drawn one that contains it, else the nearest
// reference point when it is close. No external geocoder: the point never leaves TUS.
export function barrioDePunto(catalogo: CatalogoTus, punto: Punto): BarrioCatalogo | null {
  const activos = catalogo.barrios.filter((barrio) => barrio.activo)
  const dentro = activos
    .filter((barrio) => barrio.poligono && puntoEnPoligono(punto.lat, punto.lng, barrio.poligono.coordinates[0]!))
    .sort((a, b) => area(a.poligono!.coordinates[0]!) - area(b.poligono!.coordinates[0]!))[0]
  if (dentro) return dentro
  const cercano = activos
    .filter((barrio) => coordenadasValidas(barrio.lat, barrio.lng))
    .map((barrio) => ({ barrio, km: distanciaKm(punto, { lat: barrio.lat!, lng: barrio.lng! }) }))
    .sort((a, b) => a.km - b.km)[0]
  return cercano && cercano.km <= BARRIO_MAS_CERCANO_KM ? cercano.barrio : null
}

// Neighbourhood names a list of coverage names stands for ("Norte", a zone, is all its barrios).
function barriosCubiertos(catalogo: CatalogoTus, nombres: readonly string[]): BarrioCatalogo[] {
  const clave = (nombre: string) => normalizarTexto(nombre).replace(/^barrio\s+/u, '')
  const claves = new Set(nombres.map(clave))
  const zonas = new Set(catalogo.zonas.filter((zona) => zona.activo && claves.has(clave(zona.nombre))).map((zona) => zona.id))
  return catalogo.barrios.filter((barrio) => barrio.activo && (claves.has(clave(barrio.nombre)) || (barrio.zonaId !== null && zonas.has(barrio.zonaId))))
}

export interface CoberturaDePerfil {
  // Names the provider declared (its main zone and its coverage), as the directory publishes them.
  zonas: readonly string[]
  areaPublica: string
}

// "Cerca de mí". `km` is null when the provider cannot be placed.
export function coincideCerca(catalogo: CatalogoTus, perfil: PerfilPublico, cobertura: CoberturaDePerfil, cliente: Punto): { ok: boolean; km: number | null } {
  const base = puntoBaseDePerfil(catalogo, perfil)
  if (!base) return { ok: false, km: null }
  const km = distanciaKm(base, cliente)
  if (km > RADIO_CERCA_KM) return { ok: false, km }
  // It attends at its own place: being near is what matters.
  if (perfil.modalidadAtencion === 'local' || perfil.modalidadAtencion === 'mixto') return { ok: true, km }
  // It goes to the client: its own rules decide (the zones it declared, or the distance it travels).
  const barrio = barrioDePunto(catalogo, cliente)
  const porZona = barrio !== null && barriosCubiertos(catalogo, [...cobertura.zonas, cobertura.areaPublica]).some((item) => item.id === barrio.id)
  const porRadio = perfil.radioCoberturaKm !== null && km <= perfil.radioCoberturaKm
  return { ok: porZona || porRadio, km }
}

// A request in a named neighbourhood: a place-only provider is relevant at its own location;
// home visits require declared neighbourhoods or a radius reaching that neighbourhood. Mixed
// providers can match by either route. No fuzzy text or guessed coverage is used.
export function coincideEnZona(catalogo: CatalogoTus, perfil: PerfilPublico, cobertura: CoberturaDePerfil, zona: string): boolean {
  const buscados = barriosCubiertos(catalogo, [zona])
  if (buscados.length === 0) return false
  const propios = perfil.barrioId ? catalogo.barrios.filter((b) => b.id === perfil.barrioId && b.activo) : barriosCubiertos(catalogo, perfil.zona ? [perfil.zona] : [])
  const enLugar = propios.some((propio) => buscados.some((buscado) => buscado.id === propio.id))
  if (perfil.modalidadAtencion === 'local') return enLugar
  const declarados = barriosCubiertos(catalogo, [...cobertura.zonas, cobertura.areaPublica])
  const porZona = declarados.some((declarado) => buscados.some((buscado) => buscado.id === declarado.id))
  const base = puntoBaseDePerfil(catalogo, perfil)
  const porRadio = base !== null && perfil.radioCoberturaKm !== null && buscados.some((barrio) => coordenadasValidas(barrio.lat, barrio.lng) && distanciaKm(base, { lat: barrio.lat!, lng: barrio.lng! }) <= perfil.radioCoberturaKm!)
  return (perfil.modalidadAtencion === 'mixto' && enLugar) || porZona || porRadio
}

// Towns where a provider works: those of the neighbourhoods it declared and of its own.
export function localidadesDePerfil(catalogo: CatalogoTus, perfil: PerfilPublico, cobertura: CoberturaDePerfil): Set<string> {
  const ids = new Set(barriosCubiertos(catalogo, [...(perfil.zona ? [perfil.zona] : []), ...(perfil.modalidadAtencion === 'local' ? [] : [...cobertura.zonas, cobertura.areaPublica])]).map((barrio) => barrio.localidadId))
  const propio = perfil.barrioId ? catalogo.barrios.find((barrio) => barrio.id === perfil.barrioId) : undefined
  if (propio) ids.add(propio.localidadId)
  const zona = perfil.zonaId ? catalogo.zonas.find((item) => item.id === perfil.zonaId) : undefined
  if (zona) ids.add(zona.localidadId)
  if (perfil.modalidadAtencion !== 'local' && perfil.radioCoberturaKm !== null) {
    const base = puntoBaseDePerfil(catalogo, perfil)
    if (base) for (const localidad of catalogo.localidades) if (localidad.activo && coordenadasValidas(localidad.lat, localidad.lng) && distanciaKm(base, { lat: localidad.lat!, lng: localidad.lng! }) <= perfil.radioCoberturaKm) ids.add(localidad.id)
  }
  return ids
}

// Towns of the province of a town (by the name of the province, as the catalog keeps it).
export function localidadesDeProvincia(catalogo: CatalogoTus, localidadId: string): Set<string> {
  const localidad = catalogo.localidades.find((item) => item.id === localidadId)
  if (!localidad) return new Set()
  const provincia = normalizarTexto(localidad.provincia)
  return new Set(catalogo.localidades.filter((item) => normalizarTexto(item.provincia) === provincia).map((item) => item.id))
}

// Whole kilometres, never less than one: what a client is told.
export const distanciaPublica = (km: number): number => Math.max(1, Math.round(km))
