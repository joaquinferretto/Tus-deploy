'use client'

import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'

import type { PrestadorPublico } from '@factory/contracts'

import type { CatalogoOficios } from '@factory/contracts'

import { tradeOf } from '../catalog/use-catalog'
import { DEFAULT_MAP_CENTER } from './types'
import { useMapHome, type MapHome } from './use-map-home'
import styles from './home.module.css'
import { categoryMarkerSvg } from './category-icons'
import { ratingLabel } from '../directory/rating-label'
import { servicesLabel } from '../directory/services-label'
import { Avatar } from '../directory/avatar'
import { MAX_CLUSTER_ZOOM, clusterMarkers, type MapGroup } from './map-clusters'
import { TusMap, useMapOperation, useMapTimers } from './tus-map'

const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION'] || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

// Every marker uses the TUS orange; the icon inside tells the trade apart (no rainbow of colours).
const MARKER_COLOR = '#ff5a00'

// Icons are built once per (trade icon, active) and per (count, active): a render that changes
// nothing hands Leaflet the same objects, so it does not rebuild the markers' DOM.
const iconCache = new Map<string, L.DivIcon>()
function cachedIcon(key: string, build: () => L.DivIcon): L.DivIcon {
  let icon = iconCache.get(key)
  if (!icon) {
    icon = build()
    iconCache.set(key, icon)
  }
  return icon
}

function markerIcon(worker: PrestadorPublico, active: boolean, catalog: CatalogoOficios | undefined) {
  const category = tradeOf(catalog, worker.profession.id)
  return cachedIcon(`w:${category.icon}:${active}`, () => L.divIcon({
    className: '',
    html: `<span class="${styles.marker} ${active ? styles.markerActive : ''}" style="background:${MARKER_COLOR}">${categoryMarkerSvg(category.icon)}</span>`,
    iconAnchor: [17, 17],
    iconSize: [34, 34],
    popupAnchor: [0, -18],
  }))
}

// Group marker: only a number and fixed markup (no provider text inside the HTML string).
function groupIcon(total: number, active: boolean) {
  const count = Math.min(999, Math.max(0, Math.trunc(total)))
  const size = count >= 100 ? 46 : count >= 10 ? 42 : 38
  return cachedIcon(`g:${count}:${active}`, () => groupDivIcon(count, size, active))
}

function groupDivIcon(count: number, size: number, active: boolean) {
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
  return wide ? { topLeft: L.point(40, 340), bottomRight: L.point(40, 80) } : { topLeft: L.point(24, 24), bottomRight: L.point(24, 24) }
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

function fitProviders(map: L.Map, workers: PrestadorPublico[], home: MapHome, animate = true) {
  const locations = allLocations(workers)
  if (locations.length === 0) {
    map.setView([home.lat, home.lng], home.zoom, { animate })
    return
  }
  const padding = overlayPadding(map)
  const bounds = L.latLngBounds(locations.map(({ location }) => [location.lat, location.lng] as [number, number]))
  map.fitBounds(bounds, { paddingTopLeft: padding.topLeft, paddingBottomRight: padding.bottomRight, maxZoom: 15, animate })
}

function goHome(map: L.Map, home: MapHome) {
  map.setView([home.lat, home.lng], home.zoom, { animate: false })
}

function ensurePopupVisible(map: L.Map, popup: L.Popup) {
  // Only a popup that is still open on the map is moved into view.
  if (!popup.isOpen()) return
  const popupEl = popup.getElement()
  const mapEl = map.getContainer()
  if (!popupEl || !mapEl) return

  const popupRect = popupEl.getBoundingClientRect()
  const mapRect = mapEl.getBoundingClientRect()
  const dockEl = document.querySelector('[data-map-overlay="search-dock"]')
  const dockRect = dockEl?.getBoundingClientRect()
  const headerEl = document.querySelector('header')
  const headerRect = headerEl?.getBoundingClientRect()

  const MARGIN = 16
  let safeTop = mapRect.top + MARGIN
  let safeBottom = mapRect.bottom - MARGIN
  let safeLeft = mapRect.left + MARGIN
  let safeRight = mapRect.right - MARGIN

  if (headerRect && headerRect.bottom > mapRect.top) {
    safeTop = Math.max(safeTop, headerRect.bottom + MARGIN)
  }

  if (dockRect) {
    const dockOverlapsX = dockRect.left < mapRect.right && dockRect.right > mapRect.left
    const dockOverlapsY = dockRect.top < mapRect.bottom && dockRect.bottom > mapRect.top
    if (dockOverlapsX && dockOverlapsY) {
      safeTop = Math.max(safeTop, dockRect.bottom + MARGIN)
    }
  }

  safeTop = Math.max(safeTop, MARGIN)
  safeBottom = Math.min(safeBottom, window.innerHeight - MARGIN)
  safeLeft = Math.max(safeLeft, MARGIN)
  safeRight = Math.min(safeRight, window.innerWidth - MARGIN)

  let dx = 0
  let dy = 0

  if (popupRect.top < safeTop) {
    dy = -(safeTop - popupRect.top)
  } else if (popupRect.bottom > safeBottom) {
    dy = popupRect.bottom - safeBottom
  }

  if (popupRect.left < safeLeft) {
    dx = -(safeLeft - popupRect.left)
  } else if (popupRect.right > safeRight) {
    dx = popupRect.right - safeRight
  }

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    map.panBy([dx, dy], { animate: true, duration: 0.25 })
  }
}

function MapController({
  workers,
  selected,
  recenterSignal,
  activePopupRef,
  home,
}: {
  workers: PrestadorPublico[]
  selected: PrestadorPublico | null
  recenterSignal: number
  activePopupRef: React.MutableRefObject<L.Popup | null>
  home: MapHome
}) {
  const map = useMap()
  const scheduleMapOperation = useMapOperation()
  const initialFitDone = useRef(false)
  const prevRecenterSignal = useRef(recenterSignal)
  const appliedHome = useRef('')

  useEffect(() => {
    // The person's own locality is where the map starts (and where it goes again when they
    // change it in their profile). A search or "Recentrar" still frames the results.
    const homeKey = home.personal ? `${home.lat},${home.lng}` : ''
    if (homeKey !== appliedHome.current) {
      if (homeKey) {
        return scheduleMapOperation(() => {
          appliedHome.current = homeKey
          initialFitDone.current = true
          prevRecenterSignal.current = recenterSignal
          goHome(map, home)
        })
      }
      appliedHome.current = homeKey
    }
    if (!initialFitDone.current && workers.length > 0) {
      // The first framing is not animated: the map simply starts there.
      return scheduleMapOperation(() => {
        initialFitDone.current = true
        fitProviders(map, workers, home, false)
      })
    }
    if (recenterSignal !== prevRecenterSignal.current) {
      return scheduleMapOperation(() => {
        prevRecenterSignal.current = recenterSignal
        fitProviders(map, workers, home)
      })
    }
    return undefined
  }, [home, map, recenterSignal, scheduleMapOperation, workers])

  const prevSelectedId = useRef<string | null>(null)
  useEffect(() => {
    if (!selected) {
      prevSelectedId.current = null
      return
    }
    if (selected.id === prevSelectedId.current) return

    const location = workerPoint(selected)
    if (!location) return
    const zoom = Math.max(map.getZoom(), 14)

    // Compute dynamic safe target center based on measured obstructions
    const mapEl = map.getContainer()
    const mapRect = mapEl.getBoundingClientRect()
    const dockEl = document.querySelector('[data-map-overlay="search-dock"]')
    const dockRect = dockEl?.getBoundingClientRect()
    const headerEl = document.querySelector('header')
    const headerRect = headerEl?.getBoundingClientRect()

    let topObstruction = 0
    if (headerRect && headerRect.bottom > mapRect.top) {
      topObstruction = Math.max(topObstruction, headerRect.bottom - mapRect.top)
    }
    if (dockRect) {
      const overlapsX = dockRect.left < mapRect.right && dockRect.right > mapRect.left
      const overlapsY = dockRect.top < mapRect.bottom && dockRect.bottom > mapRect.top
      if (overlapsX && overlapsY) {
        topObstruction = Math.max(topObstruction, dockRect.bottom - mapRect.top)
      }
    }

    // Shift target north (subtract Y in projected space) so marker renders south of center,
    // allowing the popup (~260px) to sit cleanly below top obstructions.
    let shiftY = 0
    if (topObstruction > 0) {
      shiftY = Math.round(topObstruction + 50)
    } else {
      // On mobile where dock is static above mapLayer, shift down so popup is inside mapLayer
      shiftY = Math.min(120, Math.round(mapRect.height * 0.22))
    }

    const projected = map.project([location.lat, location.lng], zoom)
    const targetPoint = L.point(projected.x, projected.y - shiftY)
    const target = map.unproject(targetPoint, zoom)

    let disposeOperation = () => undefined
    const cancelScheduled = scheduleMapOperation(() => {
      prevSelectedId.current = selected.id
      let done = false
      const onFlyEnd = () => {
        if (done) return
        done = true
        map.off('moveend', onFlyEnd)
        if (activePopupRef.current?.isOpen()) {
          ensurePopupVisible(map, activePopupRef.current)
        }
      }

      map.flyTo(target, zoom, { duration: 0.5 })
      const moveTimer = setTimeout(() => {
        map.once('moveend', onFlyEnd)
      }, 150)
      const fallbackTimer = setTimeout(onFlyEnd, 550)
      disposeOperation = () => {
        map.off('moveend', onFlyEnd)
        clearTimeout(moveTimer)
        clearTimeout(fallbackTimer)
      }
    })

    return () => {
      cancelScheduled()
      disposeOperation()
    }
  }, [activePopupRef, map, scheduleMapOperation, selected])
  return null
}

function MapEventsHandler({
  onPopupClose,
  onPopupOpen,
  mapRef,
}: {
  onPopupClose: () => void
  onPopupOpen: (popup: L.Popup) => void
  mapRef: React.MutableRefObject<L.Map | null>
}) {
  const map = useMapEvents({
    popupclose: () => {
      onPopupClose()
    },
    popupopen: (e) => {
      onPopupOpen(e.popup)
    },
  })

  // The reference is only valid while this layer is mounted.
  useEffect(() => {
    mapRef.current = map
    return () => {
      mapRef.current = null
    }
  }, [map, mapRef])

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
      <div className={styles.popupHead}>
        <Avatar initials={worker.initials} photoUrl={worker.photoUrl} size="sm" />
        <div>
          <p className={styles.popupTitle}>{worker.displayName}{worker.verified ? <span title="Identidad verificada"> ✓</span> : null}</p>
          <span className={styles.popupCategory} style={{ color: MARKER_COLOR }}>{servicesLabel(worker)}</span>
        </div>
      </div>
      <p className={styles.popupMeta}>{label}{exact ? '' : ' · zona aproximada'}</p>
      <p className={styles.popupMeta}>{worker.availability.label}</p>
      {/* Only real facts: ratings of completed works (or nothing) and no exact distance. */}
      {ratingLabel(worker.rating) ? <p className={styles.popupMeta}>{ratingLabel(worker.rating)}</p> : null}
      {worker.verified ? <p className={styles.srOnly}>Identidad verificada</p> : null}
      <div className={styles.popupActions}>
        <a className={styles.popupCta} href={`/trabajadores/${encodeURIComponent(worker.id)}`}>Ver perfil</a>
        {worker.aceptaTurnos !== false ? (
          <a className={styles.popupCta} href={`/trabajadores/${encodeURIComponent(worker.id)}?turno=1`}>Solicitar turno</a>
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
function ClusterMarker({ group, active, showList, markerRef, popupPadding }: { group: MapGroup<PrestadorPublico>; active: boolean; showList: boolean; markerRef: (instance: L.Marker | null) => void; popupPadding: { autoPan: boolean; autoPanPadding: [number, number] } }) {
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

export default function ProviderMap({
  workers,
  selectedId,
  onSelect,
  searchSignal = 0,
  catalog,
  popups = true,
  overlay,
}: {
  workers: PrestadorPublico[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  searchSignal?: number
  catalog?: CatalogoOficios
  // False on small screens: the selected provider is shown in a bottom sheet by the page, not in
  // a popup over the map. Group lists keep their popup.
  popups?: boolean
  // ONE map for the home. When given, this layer is drawn INSTEAD of the professionals (their
  // markers, popups, listeners and framing are unmounted, so nothing of them is left on the map);
  // the map itself, its tiles and its controls stay. It receives the "Recentrar" signal.
  overlay?: ((recenterSignal: number) => React.ReactNode) | null
}): React.ReactNode {
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)
  const [interactive, setInteractive] = useState(!touch)
  const [recenterSignal, setRecenterSignal] = useState(0)
  const [zoom, setZoom] = useState(DEFAULT_MAP_CENTER.zoom)
  const home = useMapHome()
  const activePopupRef = useRef<L.Popup | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const selected = useMemo(() => workers.find((worker) => worker.id === selectedId) ?? null, [selectedId, workers])
  const groups = useMemo(
    () => clusterMarkers(allLocations(workers).map(({ worker, location }) => ({ item: worker, lat: location.lat, lng: location.lng })), zoom),
    [workers, zoom]
  )
  const groupOf = useMemo(() => new Map(groups.flatMap((group) => group.items.map((worker) => [worker.id, group.key] as const))), [groups])
  const popupPadding = { autoPan: true, autoPanPadding: [16, 16] as [number, number] }

  const justSelectedRef = useRef(false)
  const prevOpenedIdRef = useRef<string | null>(null)
  // Cancelled on unmount: no callback of this component outlives it.
  const later = useMapTimers()
  const showingOverlay = Boolean(overlay)

  // Leaving the professionals (another layer takes the map) forgets their popup and selection
  // bookkeeping, so coming back starts clean.
  useEffect(() => {
    if (!showingOverlay) return
    activePopupRef.current = null
    prevOpenedIdRef.current = null
    justSelectedRef.current = false
  }, [showingOverlay])

  const handleSelect = (id: string | null) => {
    if (id) {
      justSelectedRef.current = true
      later(() => {
        justSelectedRef.current = false
      }, 700)
    }
    onSelect(id)
  }

  const handlePopupOpen = (popup: L.Popup) => {
    activePopupRef.current = popup
    later(() => {
      if (!justSelectedRef.current && mapRef.current) {
        ensurePopupVisible(mapRef.current, popup)
      }
    }, 120)
  }

  const handlePopupClose = () => {
    activePopupRef.current = null
    if (!justSelectedRef.current) {
      prevOpenedIdRef.current = null
      onSelect(null)
    }
  }

  useEffect(() => {
    const onResize = () => {
      if (mapRef.current && activePopupRef.current && activePopupRef.current.isOpen()) {
        ensurePopupVisible(mapRef.current, activePopupRef.current)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (selectedId && selectedId !== prevOpenedIdRef.current) {
      prevOpenedIdRef.current = selectedId
      const key = groupOf.get(selectedId)
      if (key) markers.current.get(key)?.openPopup()
    } else if (!selectedId) {
      prevOpenedIdRef.current = null
    }
  }, [groupOf, selectedId])

  const register = (key: string) => (instance: L.Marker | null) => {
    if (instance) markers.current.set(key, instance)
    else markers.current.delete(key)
  }

  return (
    <>
      <TusMap center={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]} dragging={interactive} scrollWheelZoom={interactive} zoom={DEFAULT_MAP_CENTER.zoom}>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <ZoomControl position="bottomleft" zoomInTitle="Acercar" zoomOutTitle="Alejar" />
        <ZoomWatcher onZoom={setZoom} />
        <MapInteractionController interactive={interactive} />
        {overlay ? overlay(recenterSignal) : (
          <>
        <MapController activePopupRef={activePopupRef} home={home} recenterSignal={recenterSignal + searchSignal} selected={selected} workers={workers} />
        <MapEventsHandler mapRef={mapRef} onPopupClose={handlePopupClose} onPopupOpen={handlePopupOpen} />
        {groups.map((group) => {
          const active = Boolean(selectedId && group.items.some((worker) => worker.id === selectedId))
          if (group.items.length === 1) {
            const worker = group.items[0]!
            const location = workerPoint(worker)!
            return (
              <Marker
                eventHandlers={{ click: () => handleSelect(worker.id) }}
                icon={markerIcon(worker, active, catalog)}
                key={group.key}
                keyboard
                position={[group.lat, group.lng]}
                ref={register(group.key)}
                title={`${worker.displayName}: ${servicesLabel(worker)}`}
                zIndexOffset={active ? 1000 : 0}
              >
                {popups ? (
                  <Popup {...popupPadding}>
                    <div className={styles.popup}><WorkerPopupBody exact={location.exact} label={location.label} worker={worker} /></div>
                  </Popup>
                ) : null}
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
          </>
        )}
      </TusMap>
      {touch && !interactive ? <p className={styles.mapNotice} role="note">Tocá “Mover mapa” para explorarlo</p> : null}
      <div className={styles.mapControls}>
        {touch ? <button className={styles.buttonSecondary} onClick={() => setInteractive((value) => !value)} type="button">{interactive ? 'Fijar mapa' : 'Mover mapa'}</button> : null}
        <button className={styles.buttonSecondary} onClick={() => setRecenterSignal((value) => value + 1)} type="button">Recentrar</button>
      </div>
    </>
  )
}
