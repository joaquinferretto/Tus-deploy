'use client'

import { useMemo } from 'react'

import { useAccountView } from '../session/use-account-view'
import { DEFAULT_MAP_CENTER } from './types'

export interface MapHome {
  lat: number
  lng: number
  zoom: number
  label: string
  // true: the centre is the locality of the signed-in person (from their profile, via the API).
  // false: the documented default (Corrientes Capital) for visitors and people without a locality.
  personal: boolean
}

// Where a map starts. The person's locality comes from the API with the session capabilities;
// the browser's GPS is never asked. When the person changes their locality the account view is
// refreshed and this value changes: the maps re-centre without a page reload.
export function useMapHome(): MapHome {
  const account = useAccountView()
  const center = account.status === 'signed-in' ? account.capabilities.mapCenter : undefined
  const lat = center?.origen === 'localidad' ? center.latitud : null
  const lng = center?.origen === 'localidad' ? center.longitud : null
  const label = center?.etiqueta ?? ''
  return useMemo(
    () =>
      lat !== null && lng !== null
        ? { lat, lng, zoom: DEFAULT_MAP_CENTER.zoom, label, personal: true }
        : { lat: DEFAULT_MAP_CENTER.lat, lng: DEFAULT_MAP_CENTER.lng, zoom: DEFAULT_MAP_CENTER.zoom, label: DEFAULT_MAP_CENTER.label, personal: false },
    [lat, lng, label]
  )
}
