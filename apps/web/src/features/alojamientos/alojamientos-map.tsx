'use client'

import L from 'leaflet'
import { useEffect } from 'react'
import { Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import Link from 'next/link'
import type { Route } from 'next'
import type { AlojamientoPublicoDTO } from '@factory/contracts'
import { DEFAULT_MAP_CENTER } from '../home/types'
import { useMapHome, type MapHome } from '../home/use-map-home'
import { TusMap, useMapOperation } from '../home/tus-map'
import styles from './alojamientos.module.css'
const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION'] || '&copy; OpenStreetMap contributors'

function formatPrice(amount: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount)
}

// One icon per (label, active): an unchanged render gives Leaflet the same object.
const priceIcons = new Map<string, L.DivIcon>()
function createPriceIcon(priceLabel: string, active: boolean) {
  const key = `${priceLabel}:${active}`
  let icon = priceIcons.get(key)
  if (!icon) {
    icon = priceDivIcon(priceLabel, active)
    priceIcons.set(key, icon)
  }
  return icon
}

// `priceLabel` is a number formatted here or the fixed word "Consultar": never text of a lodging.
function priceDivIcon(priceLabel: string, active: boolean) {
  return L.divIcon({
    className: '',
    html: `<div class="${styles.mapMarkerPrice} ${active ? styles.mapMarkerPriceActive : ''}">${priceLabel}</div>`,
    iconSize: [80, 28],
    iconAnchor: [40, 14],
    popupAnchor: [0, -16],
  })
}

// With results the map frames them; without results it stays on the person's locality (or the
// documented default for a visitor), and follows it when the locality changes.
function MapBoundsWatcher({ alojamientos, home, recenter }: { alojamientos: AlojamientoPublicoDTO[]; home: MapHome; recenter: number }) {
  const map = useMap()
  const scheduleMapOperation = useMapOperation()

  useEffect(() => {
    return scheduleMapOperation(() => {
      if (alojamientos.length === 0) {
        map.setView([home.lat, home.lng], home.zoom, { animate: false })
        return
      }
      const bounds = L.latLngBounds(
        alojamientos.map((a) => [a.latitud, a.longitud] as [number, number])
      )
      map.fitBounds(bounds, { animate: recenter > 0, padding: [50, 50], maxZoom: 15 })
    })
    // `recenter` only re-runs the framing ("Recentrar").
  }, [map, alojamientos, home, recenter, scheduleMapOperation])

  return null
}

export interface AlojamientosMapProps {
  alojamientos: AlojamientoPublicoDTO[]
  selectedId: string | null
  onSelect: (id: string) => void
  // On small screens the home shows the selected lodging in a bottom sheet instead of a popup.
  popups?: boolean
}

// The lodgings as a LAYER of a map that already exists: their framing and their markers. The home
// puts it on its single map; /alojamientos puts it on a map of its own (below).
export function LodgingLayer({ alojamientos, selectedId, onSelect, popups = true, recenter = 0 }: AlojamientosMapProps & { recenter?: number }): React.ReactNode {
  const home = useMapHome()
  return (
    <>
      <MapBoundsWatcher alojamientos={alojamientos} home={home} recenter={recenter} />
      {alojamientos.map((a) => {
        const priceLabel = a.precioDesde ? formatPrice(a.precioDesde.amount) : 'Consultar'
        const primaryImg = a.imagenes.find((img) => img.esPrincipal) || a.imagenes[0]
        return (
          <Marker eventHandlers={{ click: () => onSelect(a.id) }} icon={createPriceIcon(priceLabel, selectedId === a.id)} key={a.id} position={[a.latitud, a.longitud]}>
            {popups ? (
              <Popup>
                <div className={styles.popupContainer}>
                  {primaryImg && (
                    <div style={{ width: '100%', height: 100, marginBottom: 8, borderRadius: 6, overflow: 'hidden' }}>
                      <img alt={primaryImg.alt || a.nombre} src={primaryImg.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                  <div className={styles.popupTitle}>{a.nombre}</div>
                  {a.rating && (
                    <div style={{ fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: '#f59e0b' }}>★</span> {a.rating.average} ({a.rating.count})
                    </div>
                  )}
                  <div className={styles.popupPrice}>{a.precioDesde ? `Desde ${formatPrice(a.precioDesde.amount)}` : 'Tarifa a consultar'}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                    {a.unidadesContador} {a.unidadesContador === 1 ? 'unidad disponible' : 'unidades disponibles'}
                  </div>
                  <Link className={styles.popupBtn} href={`/alojamientos/${a.slug || a.id}` as Route}>
                    Ver alojamiento
                  </Link>
                </div>
              </Popup>
            ) : null}
          </Marker>
        )
      })}
    </>
  )
}

export default function AlojamientosMap(props: AlojamientosMapProps): React.ReactNode {
  return (
    <div className={styles.mapContainer}>
      <TusMap center={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]} scrollWheelZoom={false} zoom={DEFAULT_MAP_CENTER.zoom}>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <ZoomControl position="topleft" />
        <LodgingLayer {...props} />
      </TusMap>
    </div>
  )
}
