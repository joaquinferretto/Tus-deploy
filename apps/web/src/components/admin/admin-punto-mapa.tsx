'use client'

import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { useState } from 'react'
import { MapContainer, CircleMarker, Marker, Polygon, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'

import { DEFAULT_MAP_CENTER } from '@/features/home/types'

const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION'] || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const vertice = L.divIcon({
  className: '',
  html: '<span style="display:block;width:16px;height:16px;border-radius:999px;background:#ff5a00;border:3px solid #fff;box-shadow:0 2px 6px rgba(20,33,61,.35)"></span>',
  iconAnchor: [8, 8],
  iconSize: [16, 16],
})
const referencia = L.divIcon({
  className: '',
  html: '<span style="display:block;width:22px;height:22px;border-radius:999px;background:#14213d;border:4px solid #fff;box-shadow:0 2px 6px rgba(20,33,61,.45)"></span>',
  iconAnchor: [11, 11],
  iconSize: [22, 22],
})

export type Punto = { lat: number; lng: number }
const redondear = (value: number) => Math.round(value * 1e6) / 1e6

function Click({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (event) => onClick(redondear(event.latlng.lat), redondear(event.latlng.lng)) })
  return null
}

// Geographic editor built on the Leaflet already used by TUS. Modes:
// - "Dibujar polígono": every click adds a vertex; vertices can be dragged; >= 3 vertices form the
//   polygon (the ring is closed when saving). "Deshacer" and "Eliminar polígono" are explicit.
// - "Punto de referencia": a click places (or moves) the fallback point; it can be dragged.
// Administrators never type coordinates; the API validates everything again.
export default function AdminPuntoMapa({
  value,
  onChange,
  point,
  onPoint,
  barrios,
  allowPolygon = true,
  allowPoint = true,
}: {
  value: Punto[]
  onChange: (points: Punto[]) => void
  point?: Punto | null
  onPoint?: (point: Punto | null) => void
  barrios: { id: string; nombre: string; lat: number | null; lng: number | null }[]
  allowPolygon?: boolean
  allowPoint?: boolean
}): React.ReactNode {
  const [modo, setModo] = useState<'ver' | 'poligono' | 'punto'>(value.length === 0 && allowPolygon ? 'poligono' : 'ver')
  const first = point ?? value[0]
  const center: [number, number] = first ? [first.lat, first.lng] : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]
  const click = (lat: number, lng: number) => {
    if (modo === 'poligono') onChange([...value, { lat, lng }])
    if (modo === 'punto') onPoint?.({ lat, lng })
  }
  const boton = (activo: boolean) => ({ fontWeight: activo ? 700 : 400, textDecoration: activo ? 'underline' : 'none' })
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        {allowPolygon ? <button aria-pressed={modo === 'poligono'} onClick={() => setModo(modo === 'poligono' ? 'ver' : 'poligono')} style={boton(modo === 'poligono')} type="button">{modo === 'poligono' ? 'Terminar polígono' : value.length ? 'Editar polígono' : 'Dibujar polígono'}</button> : null}
        {allowPoint && onPoint ? <button aria-pressed={modo === 'punto'} onClick={() => setModo(modo === 'punto' ? 'ver' : 'punto')} style={boton(modo === 'punto')} type="button">{modo === 'punto' ? 'Listo' : point ? 'Mover punto de referencia' : 'Marcar punto de referencia'}</button> : null}
      </div>
      <p style={{ fontSize: '0.85rem', margin: '0 0 6px' }}>
        {modo === 'poligono' ? 'Tocá el mapa para agregar vértices (mínimo 3). Arrastralos para ajustar.' : modo === 'punto' ? 'Tocá el mapa para ubicar el punto de referencia.' : 'Elegí una acción para editar la geografía.'}
      </p>
      <div style={{ border: '1px solid #e7e9ef', borderRadius: 12, height: 360, overflow: 'hidden' }}>
        <MapContainer center={center} scrollWheelZoom style={{ height: '100%', width: '100%' }} zoom={13}>
          <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
          <Click onClick={click} />
          {barrios.filter((item) => item.lat !== null && item.lng !== null).map((item) => (
            <CircleMarker center={[item.lat!, item.lng!]} key={item.id} pathOptions={{ color: '#14213d', weight: 1, fillOpacity: 0.5 }} radius={4}>
              <Tooltip>{item.nombre}</Tooltip>
            </CircleMarker>
          ))}
          {value.length >= 3 ? <Polygon pathOptions={{ color: '#ff5a00', fillOpacity: 0.18 }} positions={value.map((item) => [item.lat, item.lng])} /> : null}
          {modo === 'poligono'
            ? value.map((item, index) => (
                <Marker
                  draggable
                  eventHandlers={{ dragend: (event) => { const next = [...value]; const position = event.target.getLatLng(); next[index] = { lat: redondear(position.lat), lng: redondear(position.lng) }; onChange(next) } }}
                  icon={vertice}
                  key={`${index}-${item.lat}-${item.lng}`}
                  position={[item.lat, item.lng]}
                />
              ))
            : null}
          {point ? (
            <Marker
              draggable={modo === 'punto'}
              eventHandlers={{ dragend: (event) => { const position = event.target.getLatLng(); onPoint?.({ lat: redondear(position.lat), lng: redondear(position.lng) }) } }}
              icon={referencia}
              position={[point.lat, point.lng]}
            >
              <Tooltip>Punto de referencia</Tooltip>
            </Marker>
          ) : null}
        </MapContainer>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {allowPolygon ? <button disabled={value.length === 0} onClick={() => onChange(value.slice(0, -1))} type="button">Deshacer último vértice</button> : null}
        {allowPolygon ? <button disabled={value.length === 0} onClick={() => { onChange([]); setModo('ver') }} type="button">Eliminar polígono</button> : null}
        {allowPoint && onPoint ? <button disabled={!point} onClick={() => onPoint(null)} type="button">Quitar punto de referencia</button> : null}
        <span>{value.length >= 3 ? `Polígono de ${value.length} vértices` : value.length ? `${value.length} vértices (faltan ${3 - value.length})` : 'Sin polígono'}{point ? ` · punto ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : ''}</span>
      </div>
    </div>
  )
}
