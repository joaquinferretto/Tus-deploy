'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'

import type { UbicacionPrestadorWeb } from '../directory/directory-client'

const LocationMap = dynamic(() => import('./location-map'), { ssr: false, loading: () => <p role="status">Cargando mapa…</p> })

export const ASOCIACION: Record<string, string> = {
  poligono_barrio: 'dentro del barrio',
  poligono_zona: 'dentro de la zona',
  geocodificador: 'reconocida por nombre',
  manual: 'asignada manualmente',
  sin_asociar: 'sin asociar a una zona de TUS',
}
export const PRECISION: Record<string, string> = {
  exact: 'en tu ubicación exacta',
  barrio: 'dentro de tu barrio (zona aproximada)',
  zona: 'dentro de tu zona (zona aproximada)',
  reference: 'en el punto de referencia de tu zona',
}

// "Ubicación en el mapa": the provider (own session) or an administrator (any profile) places the
// pin, decides whether the exact point can be shown and sees how the public map will place it.
// The exact point is stored for TUS; without permission the map only shows the area.
export function LocationEditor({
  load,
  save,
  remove,
  owner = true,
}: {
  load: () => Promise<UbicacionPrestadorWeb | null>
  save: (input: { lat: number; lng: number; showExact: boolean }) => Promise<UbicacionPrestadorWeb>
  remove: () => Promise<UbicacionPrestadorWeb>
  owner?: boolean
}): React.ReactNode {
  const [current, setCurrent] = useState<UbicacionPrestadorWeb | null>(null)
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [showExact, setShowExact] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error' | 'none'>('loading')
  const [message, setMessage] = useState('')

  const apply = useCallback((value: UbicacionPrestadorWeb | null) => {
    setCurrent(value)
    setPoint(value && value.lat !== null && value.lng !== null ? { lat: value.lat, lng: value.lng } : null)
    setShowExact(value?.showExact ?? false)
  }, [])

  useEffect(() => {
    load()
      .then((value) => { apply(value); setStatus(value ? 'ready' : 'none') })
      .catch(() => setStatus('error'))
  }, [apply, load])

  async function run(action: () => Promise<UbicacionPrestadorWeb>, ok: string) {
    setStatus('saving')
    setMessage('')
    try {
      apply(await action())
      setMessage(ok)
      setStatus('ready')
    } catch {
      setMessage('No pudimos guardar la ubicación. Revisá el punto y probá de nuevo.')
      setStatus('ready')
    }
  }

  if (status === 'loading') return <p role="status">Cargando ubicación…</p>
  if (status === 'error') return <p role="alert">No pudimos cargar la ubicación.</p>
  if (status === 'none') return <p role="status">{owner ? 'Primero publicá tu perfil de prestador; después podés ubicarte en el mapa.' : 'Este prestador todavía no tiene perfil.'}</p>
  const dirty = Boolean(point && (point.lat !== current?.lat || point.lng !== current?.lng || showExact !== current?.showExact))
  return (
    <section aria-label="Ubicación en el mapa" style={{ display: 'grid', gap: 10 }}>
      <p style={{ margin: 0 }}>Tocá el mapa para marcar {owner ? 'tu' : 'la'} ubicación; arrastrá el marcador para moverla.</p>
      <LocationMap onChange={setPoint} value={point} />
      <p style={{ margin: 0 }}>
        {point ? `Latitud ${point.lat.toFixed(6)} · Longitud ${point.lng.toFixed(6)}` : 'Todavía sin ubicación exacta.'}
      </p>
      <label style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
        <input checked={showExact} onChange={(event) => setShowExact(event.target.checked)} type="checkbox" />
        <span>Mostrar la ubicación exacta en el mapa público (si no, solo se muestra el barrio o la zona)</span>
      </label>
      {current ? (
        <p style={{ margin: 0 }}>
          {current.lat !== null
            ? `Ubicación guardada: ${ASOCIACION[current.association ?? 'sin_asociar'] ?? ''}${current.barrio ? ` ${current.barrio.name}` : ''}${current.zone ? ` (zona ${current.zone.name})` : ''}.`
            : 'Sin ubicación exacta guardada.'}{' '}
          {current.mapPoint ? `El mapa ${owner ? 'te' : 'lo'} muestra ${PRECISION[current.mapPoint.precision] ?? ''}: ${current.mapPoint.label}.` : 'Sin ubicación geográfica: no aparece en el mapa.'}
        </p>
      ) : null}
      {current?.association === 'sin_asociar' ? <p role="status" style={{ margin: 0 }}>Este punto todavía no está asociado a una zona o barrio de TUS.</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button disabled={!point || !dirty || status === 'saving'} onClick={() => point && void run(() => save({ ...point, showExact }), 'Ubicación guardada.')} type="button">
          {status === 'saving' ? 'Guardando…' : current?.lat !== null && current?.lat !== undefined ? 'Actualizar ubicación' : 'Definir ubicación'}
        </button>
        <button disabled={current?.lat === null || status === 'saving'} onClick={() => void run(remove, 'Ubicación exacta quitada.')} type="button">Quitar ubicación</button>
      </div>
      {message ? <p role="status" style={{ margin: 0 }}>{message}</p> : null}
    </section>
  )
}
