import { sinAcentos } from '../texto.ts'
import { barrioVigente, oficioVigente, type BarrioCatalogo, type CatalogoTus, type OficioCatalogo } from './modelo.ts'
import { SEMILLA_CATALOGO } from './semilla.ts'

// Current catalog snapshot. Read synchronously by the interpreter, validations, directory, requests
// and WhatsApp tools; refreshed from PostgreSQL at startup, right after every admin change and
// every minute (other processes converge within that window).

export interface FuenteCatalogo {
  cargar(): Promise<CatalogoTus>
}

let actual: CatalogoTus = SEMILLA_CATALOGO
let fuente: FuenteCatalogo | null = null
let temporizador: ReturnType<typeof setInterval> | null = null

export function catalogoVigente(): CatalogoTus {
  return actual
}

export function establecerCatalogo(catalogo: CatalogoTus): void {
  actual = catalogo
}

export async function recargarCatalogo(): Promise<CatalogoTus> {
  if (fuente) actual = await fuente.cargar()
  return actual
}

export async function iniciarCatalogo(nueva: FuenteCatalogo, intervaloMs = 60_000): Promise<void> {
  fuente = nueva
  await recargarCatalogo().catch(() => undefined)
  if (temporizador) clearInterval(temporizador)
  temporizador = setInterval(() => void recargarCatalogo().catch(() => undefined), intervaloMs)
  temporizador.unref?.()
}

const norm = (value: string) => sinAcentos(value.toLowerCase()).replace(/\s+/gu, ' ').trim()

// ---- trades ------------------------------------------------------------------------------------

export function oficiosVigentes(): OficioCatalogo[] {
  return actual.oficios.filter((oficio) => oficioVigente(actual, oficio)).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
}

// Any trade (also inactive): historical records keep showing their label.
export function buscarOficio(id: string): OficioCatalogo | null {
  return actual.oficios.find((oficio) => oficio.id === id) ?? null
}

export function esOficioVigente(value: unknown): value is string {
  return typeof value === 'string' && oficiosVigentes().some((oficio) => oficio.id === value)
}

// ---- locations ---------------------------------------------------------------------------------

// Neighbourhoods offered for new selections and placed on the map (they need a point).
export function barriosVigentes(): (BarrioCatalogo & { lat: number; lng: number })[] {
  return actual.barrios
    .filter((barrio): barrio is BarrioCatalogo & { lat: number; lng: number } => barrioVigente(actual, barrio) && barrio.lat !== null && barrio.lng !== null)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
}

export function buscarBarrio(nombre: string | null | undefined): BarrioCatalogo | null {
  if (!nombre) return null
  const target = norm(nombre)
  return actual.barrios.find((barrio) => norm(barrio.nombre) === target) ?? null
}

export function zonasVigentes() {
  return actual.zonas.filter((zona) => zona.activo && actual.localidades.find((item) => item.id === zona.localidadId)?.activo !== false)
}

// "Norte" (a zone) covers all its active neighbourhoods; a neighbourhood name covers itself.
export function barriosDeUbicacion(nombre: string): string[] {
  const target = norm(nombre)
  const zona = zonasVigentes().find((item) => norm(item.nombre) === target)
  const propios = zona ? barriosVigentes().filter((barrio) => barrio.zonaId === zona.id).map((barrio) => barrio.nombre) : []
  return [...new Set([nombre, ...propios])]
}

// Names the interpreter recognises: neighbourhoods first (more specific), then zones.
export function ubicacionesReconocibles(): { nombre: string; tipo: 'barrio' | 'zona'; zona: string | null }[] {
  const zonas = zonasVigentes()
  return [
    ...barriosVigentes().map((barrio) => ({ nombre: barrio.nombre, tipo: 'barrio' as const, zona: zonas.find((zona) => zona.id === barrio.zonaId)?.nombre ?? null })),
    ...zonas.map((zona) => ({ nombre: zona.nombre, tipo: 'zona' as const, zona: zona.nombre })),
  ]
}
