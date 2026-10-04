'use client'

import type { AlojamientoPublicoDTO, CatalogoOficios, PrestadorPublico } from '@factory/contracts'

import { LodgingLayer } from '../alojamientos/alojamientos-map'
import type { MapKind } from './map-state'
import ProviderMap from './provider-map'

// THE map of the home: one Leaflet map for the whole visit. The type selector does not swap maps,
// it swaps the LAYER drawn on this one (professionals or lodgings), so changing type never creates
// or removes a map and leaves nothing of the previous type behind.
export default function HomeMap({
  kind,
  popups,
  catalog,
  workers,
  selectedProviderId,
  onSelectProvider,
  searchSignal,
  lodgings,
  selectedLodgingId,
  onSelectLodging,
}: {
  kind: MapKind
  popups: boolean
  catalog?: CatalogoOficios
  workers: PrestadorPublico[]
  selectedProviderId: string | null
  onSelectProvider: (id: string | null) => void
  searchSignal: number
  lodgings: AlojamientoPublicoDTO[]
  selectedLodgingId: string | null
  onSelectLodging: (id: string) => void
}): React.ReactNode {
  return (
    <ProviderMap
      catalog={catalog}
      onSelect={onSelectProvider}
      overlay={kind === 'alojamientos' ? (recenter) => <LodgingLayer alojamientos={lodgings} onSelect={onSelectLodging} popups={popups} recenter={recenter} selectedId={selectedLodgingId} /> : null}
      popups={popups}
      searchSignal={searchSignal}
      selectedId={selectedProviderId}
      workers={workers}
    />
  )
}
