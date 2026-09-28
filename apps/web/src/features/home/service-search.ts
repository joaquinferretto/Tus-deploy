import type { InterpretacionNecesidad, OficioPublico, PrestadorPublico } from '@factory/contracts'

import type { ProviderMapFilters } from './providers-source'

// ONE search for the home: the search bar and the TUS assistant both call searchServices(). The
// API interprets the text with the same deterministic interpreter used by the Web assistant and
// WhatsApp (/tus/v1/asistente/interpretar) and the providers come from the real directory. Nothing
// here invents a provider, a rating or availability.

export interface ServiceSearchDeps {
  interpret: (text: string) => Promise<InterpretacionNecesidad>
  providers: (filters: ProviderMapFilters) => Promise<PrestadorPublico[]>
  catalog: OficioPublico[]
}

export type ServiceSearchOutcome =
  // A trade was understood: the map shows only that trade (and zone, when given).
  | { kind: 'category'; filters: ProviderMapFilters; label: string; zone: string | null; providers: PrestadorPublico[] }
  // Ambiguous text ("se rompió el motor"): the person picks one of the trades.
  | { kind: 'choose'; options: { id: string; label: string }[]; zone: string | null }
  // No trade recognised: a plain text search over the directory (names, descriptions, zones).
  | { kind: 'text'; filters: ProviderMapFilters; providers: PrestadorPublico[] }
  | { kind: 'empty' }

const labelOf = (catalog: OficioPublico[], id: string) => catalog.find((item) => item.id === id)?.label ?? id

export async function searchServices(text: string, deps: ServiceSearchDeps): Promise<ServiceSearchOutcome> {
  const query = text.trim().slice(0, 200)
  if (!query) return { kind: 'empty' }
  const need = await deps.interpret(query).catch(() => null)
  if (need?.category) {
    const filters = { query: '', profession: need.category, zone: need.zone ?? '' }
    return { kind: 'category', filters, label: labelOf(deps.catalog, need.category), zone: need.zone, providers: await deps.providers(filters) }
  }
  if (need && need.alternatives.length > 1)
    return { kind: 'choose', options: need.alternatives.map((id) => ({ id, label: labelOf(deps.catalog, id) })), zone: need.zone }
  const filters = { query, profession: '', zone: need?.zone ?? '' }
  return { kind: 'text', filters, providers: await deps.providers(filters) }
}

// The chosen trade of a 'choose' outcome, with the same zone.
export async function searchCategory(id: string, zone: string | null, deps: ServiceSearchDeps): Promise<ServiceSearchOutcome> {
  const filters = { query: '', profession: id, zone: zone ?? '' }
  return { kind: 'category', filters, label: labelOf(deps.catalog, id), zone, providers: await deps.providers(filters) }
}

// Short answer for the assistant, always from the real result.
export function describeOutcome(outcome: ServiceSearchOutcome): string {
  if (outcome.kind === 'empty') return 'Contame qué necesitás, por ejemplo: "se rompió una canilla" o "busco un electricista".'
  if (outcome.kind === 'choose') {
    const labels = outcome.options.map((item) => item.label.toLowerCase())
    const last = labels.pop() ?? ''
    // "u" before words starting with "o" ("aire acondicionado u otros oficios").
    return `¿Qué necesitás: ${labels.length ? `${labels.join(', ')} ${/^h?o/u.test(last) ? 'u' : 'o'} ` : ''}${last}?`
  }
  const where = outcome.kind === 'category' && outcome.zone ? ` en ${outcome.zone}` : ''
  const count = outcome.providers.length
  if (outcome.kind === 'category') {
    const label = outcome.label.toLowerCase()
    return count === 0
      ? `Por ahora no encontré profesionales de ${label} publicados${where}. Podés ampliar la búsqueda o publicar una solicitud.`
      : `Parece que necesitás ${label}. Te muestro ${count} ${count === 1 ? 'profesional disponible' : 'profesionales'}${where} en el mapa.`
  }
  return count === 0
    ? 'Por ahora no encontré profesionales publicados para eso. Podés contarme el problema con otras palabras o publicar una solicitud.'
    : `Te muestro ${count} ${count === 1 ? 'profesional relacionado' : 'profesionales relacionados'} en el mapa.`
}
