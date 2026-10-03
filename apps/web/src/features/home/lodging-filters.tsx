'use client'

import type { TipoAlojamientoDTO } from '@factory/contracts'

import { MAX_GUESTS } from './map-state'
import styles from './home.module.css'

// Filters of the map when it shows lodgings: the type (from the API) and how many people.
export function LodgingFilters({
  types,
  type,
  guests,
  onChange,
}: {
  types: TipoAlojamientoDTO[]
  type: string
  guests: number | null
  onChange: (next: { type: string; guests: number | null }) => void
}): React.ReactNode {
  return (
    <div aria-label="Filtrar alojamientos" className={styles.mapFilters} role="group">
      <label className={styles.mapFilter}>
        <span>Tipo</span>
        <select onChange={(event) => onChange({ type: event.target.value, guests })} value={types.some((item) => item.slug === type) ? type : ''}>
          <option value="">Todos</option>
          {types.map((item) => <option key={item.id} value={item.slug}>{item.nombre}</option>)}
        </select>
      </label>
      <label className={styles.mapFilter}>
        <span>Personas</span>
        <select onChange={(event) => onChange({ type, guests: event.target.value ? Number(event.target.value) : null })} value={guests ?? ''}>
          <option value="">Cualquiera</option>
          {Array.from({ length: Math.min(8, MAX_GUESTS) }, (_value, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </label>
    </div>
  )
}
