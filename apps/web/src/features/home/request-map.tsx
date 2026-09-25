'use client'

import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet'

import { DEFAULT_MAP_CENTER, categoryOf, type MapRequest } from './types'
import styles from './home.module.css'

// OpenStreetMap tiles by default (attribution required). For heavy production traffic configure
// a tile provider in NEXT_PUBLIC_MAP_TILE_URL instead of the community OSM servers.
const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION'] || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function markerIcon(request: MapRequest, active: boolean) {
  const category = categoryOf(request.category)
  return L.divIcon({
    className: '',
    html: `<span class="${styles.marker} ${active ? styles.markerActive : ''}" style="background:${category.color}">${category.label[0]}</span>`,
    iconAnchor: [17, 17],
    iconSize: [34, 34],
    popupAnchor: [0, -18],
  })
}

// On wide screens the filters bar covers the top of the map: markers and popups are kept below it.
// On phones the filters sit above the map, outside it.
function overlayPadding(map: L.Map) {
  const wide = map.getSize().x > 768
  return wide
    ? { topLeft: L.point(40, 150), bottomRight: L.point(40, 80) }
    : { topLeft: L.point(24, 24), bottomRight: L.point(24, 24) }
}

export function fitRequests(map: L.Map, requests: MapRequest[]) {
  if (requests.length === 0) {
    map.setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_CENTER.zoom)
    return
  }
  const padding = overlayPadding(map)
  const bounds = L.latLngBounds(requests.map((request) => [request.approximateLocation.lat, request.approximateLocation.lng] as [number, number]))
  map.fitBounds(bounds, { paddingTopLeft: padding.topLeft, paddingBottomRight: padding.bottomRight, maxZoom: 15 })
}

function MapController({ requests, selected, interactive, recenterSignal }: { requests: MapRequest[]; selected: MapRequest | null; interactive: boolean; recenterSignal: number }) {
  const map = useMap()
  const requestKey = requests.map((request) => request.id).join(',')
  useEffect(() => {
    if (interactive) {
      map.dragging.enable()
      map.touchZoom.enable()
    } else {
      map.dragging.disable()
      map.touchZoom.disable()
    }
  }, [interactive, map])
  // Re-frame when the visible set changes (search/filters) or on "Recentrar".
  useEffect(() => {
    fitRequests(map, requests)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the ids, not the array identity
  }, [map, requestKey, recenterSignal])
  useEffect(() => {
    if (!selected) return
    // Put the selected marker in the middle of the free area (not under the card or search).
    const zoom = Math.max(map.getZoom(), 14)
    const padding = overlayPadding(map)
    const shift = L.point((padding.topLeft.x - padding.bottomRight.x) / 2, (padding.topLeft.y - padding.bottomRight.y) / 2)
    const target = map.unproject(map.project([selected.approximateLocation.lat, selected.approximateLocation.lng], zoom).subtract(shift), zoom)
    map.flyTo(target, zoom, { duration: 0.6 })
  }, [map, selected])
  return null
}

export default function RequestMap({
  requests,
  selectedId,
  highlightedId,
  onSelect,
}: {
  requests: MapRequest[]
  selectedId: string | null
  highlightedId: string | null
  onSelect: (id: string) => void
}): React.ReactNode {
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)
  const [interactive, setInteractive] = useState(!touch)
  const [wide] = useState(() => typeof window !== 'undefined' && window.innerWidth > 768)
  const [recenterSignal, setRecenterSignal] = useState(0)
  const markers = useRef(new Map<string, L.Marker>())
  const selected = useMemo(() => requests.find((request) => request.id === selectedId) ?? null, [requests, selectedId])

  useEffect(() => {
    if (selectedId) markers.current.get(selectedId)?.openPopup()
  }, [selectedId])

  return (
    <>
      <MapContainer
        attributionControl
        center={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]}
        dragging={!touch}
        scrollWheelZoom={!touch}
        style={{ height: '100%', width: '100%' }}
        zoom={DEFAULT_MAP_CENTER.zoom}
        zoomControl={false}
      >
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        {/* Bottom-left: the filters bar covers the top of the map on wide screens. */}
        <ZoomControl position="bottomleft" zoomInTitle="Acercar" zoomOutTitle="Alejar" />
        <MapController interactive={interactive} recenterSignal={recenterSignal} requests={requests} selected={selected} />
        {requests.map((request) => {
          const category = categoryOf(request.category)
          const active = request.id === selectedId || request.id === highlightedId
          return (
            <Marker
              eventHandlers={{ click: () => onSelect(request.id) }}
              icon={markerIcon(request, active)}
              key={request.id}
              keyboard
              position={[request.approximateLocation.lat, request.approximateLocation.lng]}
              ref={(instance) => {
                if (instance) markers.current.set(request.id, instance)
                else markers.current.delete(request.id)
              }}
              title={`${category.label}: ${request.title}`}
              zIndexOffset={active ? 1000 : 0}
            >
              <Popup autoPanPaddingBottomRight={[40, 80]} autoPanPaddingTopLeft={[24, wide ? 150 : 24]}>
                <div className={styles.popup}>
                  <span className={styles.popupCategory} style={{ color: category.color }}>
                    {category.label}
                  </span>
                  <p className={styles.popupTitle}>{request.title}</p>
                  <p className={styles.popupMeta}>
                    {request.approximateLocation.label} (zona aproximada)
                    {request.requesterName ? ` · ${request.requesterName}` : ''}
                  </p>
                  {request.budgetLabel || request.urgencyLabel ? (
                    <p className={styles.popupMeta}>
                      <strong>{request.budgetLabel}</strong>
                      {request.urgencyLabel ? ` · ${request.urgencyLabel}` : ''}
                    </p>
                  ) : null}
                  {request.images && request.images.length > 0 ? (
                    <div className={styles.popupImages}>
                      {request.images.slice(0, 2).map((src, index) => (
                        <Image alt={`Imagen ${index + 1} de la solicitud`} height={56} key={src} src={src} unoptimized width={56} />
                      ))}
                    </div>
                  ) : null}
                  <a className={styles.popupCta} href="/prestador/solicitudes#abiertas">
                    Ver solicitud →
                  </a>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
      {touch && !interactive ? (
        <p className={styles.mapNotice} role="note">
          Tocá “Mover mapa” para explorarlo
        </p>
      ) : null}
      <div className={styles.mapControls}>
        {touch ? (
          <button className={styles.buttonSecondary} onClick={() => setInteractive((value) => !value)} type="button">
            {interactive ? 'Fijar mapa' : 'Mover mapa'}
          </button>
        ) : null}
        <button className={styles.buttonSecondary} onClick={() => setRecenterSignal((value) => value + 1)} type="button">
          Recentrar
        </button>
      </div>
    </>
  )
}
