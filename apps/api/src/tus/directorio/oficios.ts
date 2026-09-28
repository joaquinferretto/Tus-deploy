import { sinAcentos } from '../texto.ts'
import { buscarOficio, esOficioVigente, oficiosVigentes } from '../catalogo/vigente.ts'

// Trades of TUS come from the administered catalog (tabla oficios_servicio, catalogo/vigente.ts):
// requests, provider profiles, the directory, the interpreter and WhatsApp all read it. New
// selections only accept current (active) trades; old records keep their trade id and label.

export type OficioId = string

export interface InfoOficio {
  id: string
  label: string
  profesion: string
  icono: string
  categoriaId: string | null
  // Synonyms as one string (free-text directory search).
  palabrasClave: string
}

export function esOficio(value: unknown): value is OficioId {
  return esOficioVigente(value)
}

export function idsOficios(): string[] {
  return oficiosVigentes().map((item) => item.id)
}

// Label of any trade id, active or not (history), with a neutral fallback.
export function oficio(id: OficioId): InfoOficio {
  const item = buscarOficio(id)
  return item
    ? { id: item.id, label: item.nombre, profesion: item.profesion, icono: item.icono, categoriaId: item.categoriaId, palabrasClave: item.sinonimos.join(' ') }
    : { id, label: 'Otro oficio', profesion: 'Oficio', icono: 'herramienta', categoriaId: null, palabrasClave: '' }
}

// Trades the interpreter can pick (active), with their synonyms.
export function oficiosInterpretables() {
  return oficiosVigentes()
}

export function normalizarTexto(value: string): string {
  return sinAcentos(value.toLowerCase())
    .replace(/[^a-z0-9ñ\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

// Public view of the catalog (GET /tus/v1/public/oficios).
export function catalogoPublico() {
  return oficiosVigentes().map((item) => ({ id: item.id, label: item.nombre, profession: item.profesion, icon: item.icono, categoryId: item.categoriaId }))
}
