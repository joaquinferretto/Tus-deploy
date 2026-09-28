'use client'

import type { CatalogoOficios } from '@factory/contracts'
import { useQuery } from '@tanstack/react-query'

import { createDirectoryClient } from '../directory/directory-client'

// The ONE catalog of the Web (trades with icon, categories, localities -> zones -> neighbourhoods),
// read from the API (administered in the panel). Every form, filter and map uses this hook: no
// component keeps its own list. Short cache: admin changes show up within a minute.
export function useCatalog() {
  return useQuery({ queryKey: ['tus-catalog'], queryFn: () => createDirectoryClient().catalog(), staleTime: 60_000 })
}

export interface TradeView {
  id: string
  label: string
  icon: string
}

// Label/icon of a trade id (also old or inactive ones that are not in the current list).
export function tradeOf(catalog: CatalogoOficios | undefined, id: string): TradeView {
  const item = catalog?.items.find((trade) => trade.id === id)
  return item ? { id: item.id, label: item.label, icon: item.icon ?? item.id } : { id, label: id ? 'Otro oficio' : '', icon: 'herramienta' }
}

// Neighbourhood names offered for new selections (current catalog).
export function neighbourhoodNames(catalog: CatalogoOficios | undefined): string[] {
  return catalog?.zones ?? []
}

// Neighbourhoods grouped by the zones the administration defined (for selects with <optgroup>).
export function neighbourhoodGroups(catalog: CatalogoOficios | undefined): { label: string; names: string[] }[] {
  const localities = catalog?.locations?.localities ?? []
  if (localities.length === 0) return catalog?.zones.length ? [{ label: '', names: catalog.zones }] : []
  return localities.flatMap((locality) => {
    const groups = locality.zones.map((zone) => ({ label: `${zone.name} · ${locality.name}`, names: locality.neighbourhoods.filter((item) => item.zoneId === zone.id).map((item) => item.name) }))
    const loose = locality.neighbourhoods.filter((item) => !item.zoneId || !locality.zones.some((zone) => zone.id === item.zoneId)).map((item) => item.name)
    return [...groups, ...(loose.length ? [{ label: locality.zones.length ? `Otros barrios · ${locality.name}` : locality.name, names: loose }] : [])].filter((group) => group.names.length > 0)
  })
}
