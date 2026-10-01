'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import Link from 'next/link'
import type { Route } from 'next'
import type { AlojamientoPublicoDTO } from '@factory/contracts'
import { DEFAULT_MAP_CENTER } from '../home/types'
import { useMapHome, type MapHome } from '../home/use-map-home'
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

function createPriceIcon(priceLabel: string, active: boolean) {
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
function MapBoundsWatcher({ alojamientos, home }: { alojamientos: AlojamientoPublicoDTO[]; home: MapHome }) {
  const map = useMap()

  useEffect(() => {
    if (alojamientos.length === 0) {
      map.setView([home.lat, home.lng], home.zoom)
      return
    }
    const bounds = L.latLngBounds(
      alojamientos.map((a) => [a.latitud, a.longitud] as [number, number])
    )
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
  }, [map, alojamientos, home])

  return null
}

export interface AlojamientosMapProps {
  alojamientos: AlojamientoPublicoDTO[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function AlojamientosMap({
  alojamientos,
  selectedId,
  onSelect,
}: AlojamientosMapProps): React.ReactNode {
  const home = useMapHome()
  return (
    <div className={styles.mapContainer}>
      <MapContainer
        center={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]}
        zoom={DEFAULT_MAP_CENTER.zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <MapBoundsWatcher alojamientos={alojamientos} home={home} />

        {alojamientos.map((a) => {
          const priceLabel = a.precioDesde
            ? formatPrice(a.precioDesde.amount)
            : 'Consultar'
          const active = selectedId === a.id
          const icon = createPriceIcon(priceLabel, active)
          const primaryImg = a.imagenes.find((img) => img.esPrincipal) || a.imagenes[0]

          return (
            <Marker
              key={a.id}
              position={[a.latitud, a.longitud]}
              icon={icon}
              eventHandlers={{
                click: () => onSelect(a.id),
              }}
            >
              <Popup>
                <div className={styles.popupContainer}>
                  {primaryImg && (
                    <div style={{ width: '100%', height: 100, marginBottom: 8, borderRadius: 6, overflow: 'hidden' }}>
                      <img
                        src={primaryImg.url}
                        alt={primaryImg.alt || a.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>
                  )}
                  <div className={styles.popupTitle}>{a.nombre}</div>
                  {a.rating && (
                    <div style={{ fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: '#f59e0b' }}>★</span> {a.rating.average} ({a.rating.count})
                    </div>
                  )}
                  <div className={styles.popupPrice}>
                    {a.precioDesde ? `Desde ${formatPrice(a.precioDesde.amount)}` : 'Tarifa a consultar'}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                    {a.unidadesContador} {a.unidadesContador === 1 ? 'unidad disponible' : 'unidades disponibles'}
                  </div>
                  <Link href={`/alojamientos/${a.slug || a.id}` as Route} className={styles.popupBtn}>
                    Ver alojamiento
                  </Link>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
