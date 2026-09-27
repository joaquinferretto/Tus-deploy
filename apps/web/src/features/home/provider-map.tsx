'use client'

import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet'

import type { PrestadorPublico } from '@factory/contracts'

import { categoryOf, DEFAULT_MAP_CENTER } from './types'
import styles from './home.module.css'
import { categoryMarkerSvg } from './category-icons'

const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION'] || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function markerIcon(worker: PrestadorPublico, active: boolean) {
  const category = categoryOf(worker.profession.id)
  return L.divIcon({
    className: '',
    html: `<span class="${styles.marker} ${active ? styles.markerActive : ''}" style="background:${category.color}">${categoryMarkerSvg(category.id)}</span>`,
    iconAnchor: [17, 17],
    iconSize: [34, 34],
    popupAnchor: [0, -18],
  })
}

function overlayPadding(map: L.Map) {
  const wide = map.getSize().x > 768
  return wide ? { topLeft: L.point(40, 190), bottomRight: L.point(40, 80) } : { topLeft: L.point(24, 24), bottomRight: L.point(24, 24) }
}

function allLocations(workers: PrestadorPublico[]) {
  return workers.flatMap((worker) => worker.mapLocations.map((location) => ({ worker, location })))
}

function fitProviders(map: L.Map, workers: PrestadorPublico[]) {
  const locations = allLocations(workers)
  if (locations.length === 0) {
    map.setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_CENTER.zoom)
    return
  }
  const padding = overlayPadding(map)
  const bounds = L.latLngBounds(locations.map(({ location }) => [location.lat, location.lng] as [number, number]))
  map.fitBounds(bounds, { paddingTopLeft: padding.topLeft, paddingBottomRight: padding.bottomRight, maxZoom: 15 })
}

function MapController({ workers, selected, recenterSignal }: { workers: PrestadorPublico[]; selected: PrestadorPublico | null; recenterSignal: number }) {
  const map = useMap()
  const workerKey = workers.map((worker) => `${worker.id}:${worker.mapLocations.map((location) => location.label).join(',')}`).join('|')
  useEffect(() => {
    fitProviders(map, workers)
  }, [map, workerKey, recenterSignal, workers])
  useEffect(() => {
    const location = selected?.mapLocations[0]
    if (!location) return
    const padding = overlayPadding(map)
    const zoom = Math.max(map.getZoom(), 14)
    const shift = L.point((padding.topLeft.x - padding.bottomRight.x) / 2, (padding.topLeft.y - padding.bottomRight.y) / 2)
    const target = map.unproject(map.project([location.lat, location.lng], zoom).subtract(shift), zoom)
    map.flyTo(target, zoom, { duration: 0.6 })
  }, [map, selected])
  return null
}

function MapInteractionController({ interactive }: { interactive: boolean }) {
  const map = useMap()

  useEffect(() => {
    const handlers = [map.dragging, map.scrollWheelZoom, map.touchZoom]
    handlers.forEach((handler) => (interactive ? handler.enable() : handler.disable()))
  }, [interactive, map])

  return null
}

export default function ProviderMap({ workers, selectedId, onSelect, searchSignal = 0 }: { workers: PrestadorPublico[]; selectedId: string | null; onSelect: (id: string) => void; searchSignal?: number }): React.ReactNode {
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)
  const [interactive, setInteractive] = useState(!touch)
  const [wide] = useState(() => typeof window !== 'undefined' && window.innerWidth > 768)
  const [recenterSignal, setRecenterSignal] = useState(0)
  const markers = useRef(new Map<string, L.Marker>())
  const selected = useMemo(() => workers.find((worker) => worker.id === selectedId) ?? null, [selectedId, workers])

  useEffect(() => {
    if (selectedId) markers.current.get(`${selectedId}:0`)?.openPopup()
  }, [selectedId])

  return (
    <>
      <MapContainer center={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]} dragging={interactive} scrollWheelZoom={interactive} style={{ height: '100%', width: '100%' }} zoom={DEFAULT_MAP_CENTER.zoom} zoomControl={false}>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <ZoomControl position="bottomleft" zoomInTitle="Acercar" zoomOutTitle="Alejar" />
        <MapInteractionController interactive={interactive} />
        <MapController recenterSignal={recenterSignal + searchSignal} selected={selected} workers={workers} />
        {allLocations(workers).map(({ worker, location }, index) => {
          const markerKey = `${worker.id}:${index}`
          const active = worker.id === selectedId
          const category = categoryOf(worker.profession.id)
          return (
            <Marker
              eventHandlers={{ click: () => onSelect(worker.id) }}
              icon={markerIcon(worker, active)}
              key={markerKey}
              keyboard
              position={[location.lat, location.lng]}
              ref={(instance) => {
                if (instance) markers.current.set(markerKey, instance)
                else markers.current.delete(markerKey)
              }}
              title={`${worker.displayName}: ${category.label}`}
              zIndexOffset={active ? 1000 : 0}
            >
              <Popup autoPanPaddingBottomRight={[40, 80]} autoPanPaddingTopLeft={[24, wide ? 190 : 24]}>
                <div className={styles.popup}>
                  <span className={styles.popupCategory} style={{ color: category.color }}>{category.label}</span>
                  <p className={styles.popupTitle}>{worker.displayName}</p>
                  <p className={styles.popupMeta}>{location.label} · zona aproximada</p>
                  <p className={styles.popupMeta}>{worker.availability.label}</p>
                  <div className={styles.popupActions}>
                    <a className={styles.popupCta} href={`/trabajadores/${encodeURIComponent(worker.id)}`}>Ver perfil</a>
                    <a className={styles.popupCta} href={`/trabajadores/${encodeURIComponent(worker.id)}?solicitar=1`}>Solicitar servicio</a>
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
      {touch && !interactive ? <p className={styles.mapNotice} role="note">Tocá “Mover mapa” para explorarlo</p> : null}
      <div className={styles.mapControls}>
        {touch ? <button className={styles.buttonSecondary} onClick={() => setInteractive((value) => !value)} type="button">{interactive ? 'Fijar mapa' : 'Mover mapa'}</button> : null}
        <button className={styles.buttonSecondary} onClick={() => setRecenterSignal((value) => value + 1)} type="button">Recentrar</button>
      </div>
    </>
  )
}
