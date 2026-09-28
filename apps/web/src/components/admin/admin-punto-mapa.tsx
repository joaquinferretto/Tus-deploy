'use client'

import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { MapContainer, CircleMarker, Marker, Polygon, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'

import { DEFAULT_MAP_CENTER } from '@/features/home/types'

const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION'] || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const pin = L.divIcon({
  className: '',
  html: '<span style="display:block;width:18px;height:18px;border-radius:999px;background:#ff5a00;border:3px solid #fff;box-shadow:0 2px 6px rgba(20,33,61,.35)"></span>',
  iconAnchor: [9, 9],
  iconSize: [18, 18],
})

function Click({ onAdd }: { onAdd: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (event) => onAdd(Math.round(event.latlng.lat * 1e5) / 1e5, Math.round(event.latlng.lng * 1e5) / 1e5) })
  return null
}

// Small polygon editor built on the Leaflet already used by TUS: click to add points and drag any
// vertex to adjust it. GeoJSON is assembled by the form; administrators never write coordinates.
export default function AdminPuntoMapa({
  value,
  onChange,
  barrios,
}: {
  value: { lat: number; lng: number }[]
  onChange: (points: { lat: number; lng: number }[]) => void
  barrios: { id: string; nombre: string; lat: number | null; lng: number | null }[]
}): React.ReactNode {
  const center: [number, number] = value[0] ? [value[0].lat, value[0].lng] : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]
  return (
    <div>
      <div style={{ border: '1px solid #e7e9ef', borderRadius: 12, height: 360, margin: '6px 0', overflow: 'hidden' }}>
        <MapContainer center={center} scrollWheelZoom style={{ height: '100%', width: '100%' }} zoom={13}>
          <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
          <Click onAdd={(lat, lng) => onChange([...value, { lat, lng }])} />
          {barrios.filter((item) => item.lat !== null && item.lng !== null).map((item) => (
            <CircleMarker center={[item.lat!, item.lng!]} key={item.id} pathOptions={{ color: '#14213d', weight: 1, fillOpacity: 0.5 }} radius={4}>
              <Tooltip>{item.nombre}</Tooltip>
            </CircleMarker>
          ))}
          {value.length >= 3 ? <Polygon pathOptions={{ color: '#ff5a00', fillOpacity: 0.18 }} positions={value.map((point) => [point.lat, point.lng])} /> : null}
          {value.map((point, index) => (
            <Marker
              draggable
              eventHandlers={{ dragend: (event) => { const next = [...value]; const position = event.target.getLatLng(); next[index] = { lat: Math.round(position.lat * 1e5) / 1e5, lng: Math.round(position.lng * 1e5) / 1e5 }; onChange(next) } }}
              icon={pin}
              key={`${index}-${point.lat}-${point.lng}`}
              position={[point.lat, point.lng]}
            />
          ))}
        </MapContainer>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button disabled={value.length === 0} onClick={() => onChange(value.slice(0, -1))} type="button">Deshacer último punto</button>
        <button disabled={value.length === 0} onClick={() => onChange([])} type="button">Borrar y redibujar</button>
        <span>{value.length} vértices</span>
      </div>
    </div>
  )
}
