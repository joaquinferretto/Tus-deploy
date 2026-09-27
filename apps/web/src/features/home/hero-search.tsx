'use client'

import type { OficioPublico } from '@factory/contracts'

import type { ProviderMapFilters } from './providers-source'
import styles from './home.module.css'

// Filters only (no data leaves the browser here): the search never submits a form to a server.
export function HeroSearch({
  filters,
  catalog,
  zones,
  onChange,
  onSubmit,
}: {
  filters: ProviderMapFilters
  catalog: OficioPublico[]
  zones: string[]
  onChange: (next: ProviderMapFilters) => void
  onSubmit: () => void
}): React.ReactNode {
  return (
    <form
       aria-label="Buscar prestadores"
      className={styles.search}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      role="search"
    >
      <div className={styles.field}>
        <label htmlFor="busqueda-que">Qué profesional buscás</label>
        <input
          autoComplete="off"
          id="busqueda-que"
          maxLength={80}
           onChange={(event) => onChange({ ...filters, query: event.target.value })}
           placeholder="Ej. Juan, plomero o aire acondicionado"
          type="search"
          value={filters.query}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="busqueda-categoria">Oficio</label>
        <select
          id="busqueda-categoria"
           onChange={(event) => onChange({ ...filters, profession: event.target.value })}
           value={filters.profession}
        >
          <option value="">Todas</option>
          {catalog.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="busqueda-ubicacion">Ubicación</label>
        <input
          autoComplete="off"
          id="busqueda-ubicacion"
          list="zonas"
          maxLength={60}
           onChange={(event) => onChange({ ...filters, zone: event.target.value })}
          placeholder="Barrio o zona"
          value={filters.zone}
        />
        <datalist id="zonas">
           {zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </div>
      <button className={`${styles.buttonPrimary} ${styles.searchButton}`} type="submit">
         Buscar prestadores
      </button>
    </form>
  )
}
