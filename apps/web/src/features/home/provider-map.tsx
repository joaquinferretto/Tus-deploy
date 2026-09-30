'use client'

import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'

import type { PrestadorPublico } from '@factory/contracts'

import type { CatalogoOficios } from '@factory/contracts'

import { tradeOf } from '../catalog/use-catalog'
import { DEFAULT_MAP_CENTER } from './types'
import styles from './home.module.css'
import { categoryMarkerSvg } from './category-icons'
import { ratingLabel } from '../directory/rating-label'
import { servicesLabel } from '../directory/services-label'
import { MAX_CLUSTER_ZOOM, clusterMarkers, type MapGroup } from './map-clusters'

const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION'] || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

// Every marker uses the TUS orange; the icon inside tells the trade apart (no rainbow of colours).
const MARKER_COLOR = '#ff5a00'

function markerIcon(worker: PrestadorPublico, active: boolean, catalog: CatalogoOficios | undefined) {
  const category = tradeOf(catalog, worker.profession.id)
  return L.divIcon({
    className: '',
    html: `<span class="${styles.marker} ${active ? styles.markerActive : ''}" style="background:${MARKER_COLOR}">${categoryMarkerSvg(category.icon)}</span>`,
    iconAnchor: [17, 17],
    iconSize: [34, 34],
    popupAnchor: [0, -18],
  })
}

// Group marker: only a number and fixed markup (no provider text inside the HTML string).
function groupIcon(count: number, active: boolean) {
  const size = count >= 100 ? 46 : count >= 10 ? 42 : 38
  return L.divIcon({
    className: '',
    html: `<span class="${styles.marker} ${styles.markerCount} ${active ? styles.markerActive : ''}" style="background:${MARKER_COLOR};width:${size}px;height:${size}px">${Math.min(999, Math.max(0, Math.trunc(count)))}</span>`,
    iconAnchor: [size / 2, size / 2],
    iconSize: [size, size],
    popupAnchor: [0, -size / 2],
  })
}

function overlayPadding(map: L.Map) {
  const wide = map.getSize().x > 768
  return wide ? { topLeft: L.point(40, 230), bottomRight: L.point(40, 80) } : { topLeft: L.point(24, 24), bottomRight: L.point(24, 24) }
}

// ONE point per provider (not one per service): mapPoint, or the first public location of older
// payloads. Providers without a point are listed but not drawn.
export function workerPoint(worker: PrestadorPublico): { lat: number; lng: number; label: string; exact: boolean } | null {
  if (worker.mapPoint) return { lat: worker.mapPoint.lat, lng: worker.mapPoint.lng, label: worker.mapPoint.label, exact: worker.mapPoint.precision === 'exact' }
  const location = worker.mapLocations[0]
  return location ? { lat: location.lat, lng: location.lng, label: location.label, exact: location.precision === 'exact' } : null
}

function allLocations(workers: PrestadorPublico[]) {
  return workers.flatMap((worker) => {
    const location = workerPoint(worker)
    return location ? [{ worker, location }] : []
  })
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
  const workerKey = workers.map((worker) => `${worker.id}:${workerPoint(worker)?.label ?? ''}`).join('|')
  useEffect(() => {
    fitProviders(map, workers)
  }, [map, workerKey, recenterSignal, workers])
  useEffect(() => {
    const location = selected ? workerPoint(selected) : null
    if (!location) return
    const padding = overlayPadding(map)
    const zoom = Math.max(map.getZoom(), 14)
    const shift = L.point((padding.topLeft.x - padding.bottomRight.x) / 2, (padding.topLeft.y - padding.bottomRight.y) / 2)
    const target = map.unproject(map.project([location.lat, location.lng], zoom).subtract(shift), zoom)
    map.flyTo(target, zoom, { duration: 0.6 })
  }, [map, selected])
  return null
}

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) })
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

function WorkerPopupBody({ worker, label, exact }: { worker: PrestadorPublico; label: string; exact: boolean }) {
  return (
    <>
      <span className={styles.popupCategory} style={{ color: MARKER_COLOR }}>{servicesLabel(worker)}</span>
      <p className={styles.popupTitle}>{worker.displayName}</p>
      <p className={styles.popupMeta}>{label}{exact ? '' : ' · zona aproximada'}</p>
      <p className={styles.popupMeta}>{worker.availability.label}</p>
      {/* Only real facts: ratings of completed works (or nothing) and no exact distance. */}
      {ratingLabel(worker.rating) ? <p className={styles.popupMeta}>{ratingLabel(worker.rating)}</p> : null}
      {worker.completedJobs > 0 ? <p className={styles.popupMeta}>{worker.completedJobs} {worker.completedJobs === 1 ? 'trabajo completado' : 'trabajos completados'} en TUS</p> : null}
      {worker.verified ? <p className={styles.popupMeta}>Identidad verificada</p> : null}
      <div className={styles.popupActions}>
        <a className={styles.popupCta} href={`/trabajadores/${encodeURIComponent(worker.id)}`}>Ver perfil</a>
        {worker.aceptaTurnos !== false ? (
          <a className={styles.popupCta} href={`/trabajadores/${encodeURIComponent(worker.id)}?turno=1`}>Reservar turno</a>
        ) : null}
        {worker.aceptaSolicitudes !== false ? (
          <a className={styles.popupCta} href={`/trabajadores/${encodeURIComponent(worker.id)}?solicitar=1`}>Solicitar servicio</a>
        ) : null}
      </div>
    </>
  )
}

// Several providers on one marker: a list (name, services, rating, Ver perfil). Plain JSX text,
// escaped by React; nothing from a profile is injected as HTML.
function GroupPopupBody({ group }: { group: MapGroup<PrestadorPublico> }) {
  return (
    <>
      <p className={styles.popupTitle}>{group.items.length} prestadores {group.samePoint ? 'en esta ubicación' : 'en esta zona'}</p>
      <ul className={styles.popupList}>
        {group.items.map((worker) => (
          <li className={styles.popupListItem} key={worker.id}>
            <strong>{worker.displayName}</strong>
            <span className={styles.popupMeta}>{servicesLabel(worker)}</span>
            {ratingLabel(worker.rating) ? <span className={styles.popupMeta}>{ratingLabel(worker.rating)}</span> : null}
            <a className={styles.popupCta} href={`/trabajadores/${encodeURIComponent(worker.id)}`}>Ver perfil</a>
          </li>
        ))}
      </ul>
    </>
  )
}

// A cluster of distinct points zooms in on click; a same-point group (or any group at the maximum
// clustering zoom) opens the list, since zooming could never separate them.
function ClusterMarker({ group, active, showList, markerRef, popupPadding }: { group: MapGroup<PrestadorPublico>; active: boolean; showList: boolean; markerRef: (instance: L.Marker | null) => void; popupPadding: { autoPanPaddingBottomRight: [number, number]; autoPanPaddingTopLeft: [number, number] } }) {
  const map = useMap()
  return (
    <Marker
      eventHandlers={{
        click: () => {
          if (showList) return
          const bounds = L.latLngBounds([group.bounds.south, group.bounds.west], [group.bounds.north, group.bounds.east])
          map.fitBounds(bounds.pad(0.3), { maxZoom: MAX_CLUSTER_ZOOM })
        },
      }}
      icon={groupIcon(group.items.length, active)}
      keyboard
      position={[group.lat, group.lng]}
      ref={markerRef}
      title={`${group.items.length} prestadores`}
      zIndexOffset={active ? 1000 : 500}
    >
      {showList ? (
        <Popup {...popupPadding}>
          <div className={styles.popup}><GroupPopupBody group={group} /></div>
        </Popup>
      ) : null}
    </Marker>
  )
}

export default function ProviderMap({ workers, selectedId, onSelect, searchSignal = 0, catalog }: { workers: PrestadorPublico[]; selectedId: string | null; onSelect: (id: string) => void; searchSignal?: number; catalog?: CatalogoOficios }): React.ReactNode {
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)
  const [interactive, setInteractive] = useState(!touch)
  const [wide] = useState(() => typeof window !== 'undefined' && window.innerWidth > 768)
  const [recenterSignal, setRecenterSignal] = useState(0)
  const [zoom, setZoom] = useState(DEFAULT_MAP_CENTER.zoom)
  const markers = useRef(new Map<string, L.Marker>())
  const selected = useMemo(() => workers.find((worker) => worker.id === selectedId) ?? null, [selectedId, workers])
  const groups = useMemo(
    () => clusterMarkers(allLocations(workers).map(({ worker, location }) => ({ item: worker, lat: location.lat, lng: location.lng })), zoom),
    [workers, zoom]
  )
  const groupOf = useMemo(() => new Map(groups.flatMap((group) => group.items.map((worker) => [worker.id, group.key] as const))), [groups])
  const popupPadding = { autoPanPaddingBottomRight: [40, 80] as [number, number], autoPanPaddingTopLeft: [24, wide ? 230 : 24] as [number, number] }

  useEffect(() => {
    const key = selectedId ? groupOf.get(selectedId) : undefined
    if (key) markers.current.get(key)?.openPopup()
  }, [groupOf, selectedId])

  const register = (key: string) => (instance: L.Marker | null) => {
    if (instance) markers.current.set(key, instance)
    else markers.current.delete(key)
  }

  return (
    <>
      <MapContainer center={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]} dragging={interactive} scrollWheelZoom={interactive} style={{ height: '100%', width: '100%' }} zoom={DEFAULT_MAP_CENTER.zoom} zoomControl={false}>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <ZoomControl position="bottomleft" zoomInTitle="Acercar" zoomOutTitle="Alejar" />
        <ZoomWatcher onZoom={setZoom} />
        <MapInteractionController interactive={interactive} />
        <MapController recenterSignal={recenterSignal + searchSignal} selected={selected} workers={workers} />
        {groups.map((group) => {
          const active = Boolean(selectedId && group.items.some((worker) => worker.id === selectedId))
          if (group.items.length === 1) {
            const worker = group.items[0]!
            const location = workerPoint(worker)!
            return (
              <Marker
                eventHandlers={{ click: () => onSelect(worker.id) }}
                icon={markerIcon(worker, active, catalog)}
                key={group.key}
                keyboard
                position={[group.lat, group.lng]}
                ref={register(group.key)}
                title={`${worker.displayName}: ${servicesLabel(worker)}`}
                zIndexOffset={active ? 1000 : 0}
              >
                <Popup {...popupPadding}>
                  <div className={styles.popup}><WorkerPopupBody exact={location.exact} label={location.label} worker={worker} /></div>
                </Popup>
              </Marker>
            )
          }
          return (
            <ClusterMarker
              active={active}
              group={group}
              key={group.key}
              markerRef={register(group.key)}
              popupPadding={popupPadding}
              showList={group.samePoint || zoom >= MAX_CLUSTER_ZOOM}
            />
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
