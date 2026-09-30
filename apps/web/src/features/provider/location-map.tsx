'use client'

import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet'

import { DEFAULT_MAP_CENTER } from '../home/types'

const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION'] || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const pin = L.divIcon({
  className: '',
  html: '<span style="display:block;width:24px;height:24px;border-radius:999px 999px 999px 0;transform:rotate(-45deg);background:#ff5a00;border:3px solid #fff;box-shadow:0 2px 6px rgba(20,33,61,.4)"></span>',
  iconAnchor: [12, 24],
  iconSize: [24, 24],
})
const redondear = (value: number) => Math.round(value * 1e6) / 1e6

function Click({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (event) => onPick(redondear(event.latlng.lat), redondear(event.latlng.lng)) })
  return null
}

// Click to place the marker, drag it to move it. Coordinates are shown, never typed.
export default function LocationMap({ value, onChange }: { value: { lat: number; lng: number } | null; onChange: (next: { lat: number; lng: number }) => void }): React.ReactNode {
  const center: [number, number] = value ? [value.lat, value.lng] : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]
  return (
    <div style={{ border: '1px solid #e7e9ef', borderRadius: 12, height: 340, overflow: 'hidden' }}>
      <MapContainer center={center} scrollWheelZoom style={{ height: '100%', width: '100%' }} zoom={value ? 16 : 13}>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <Click onPick={(lat, lng) => onChange({ lat, lng })} />
        {value ? (
          <Marker
            draggable
            eventHandlers={{ dragend: (event) => { const position = event.target.getLatLng(); onChange({ lat: redondear(position.lat), lng: redondear(position.lng) }) } }}
            icon={pin}
            position={[value.lat, value.lng]}
          />
        ) : null}
      </MapContainer>
    </div>
  )
}
