'use client'

import { CATEGORIES, type RequestFilters } from './types'
import styles from './home.module.css'

const ZONES = ['Nueva Córdoba', 'General Paz', 'Alta Córdoba', 'Güemes', 'Alberdi', 'Cerro de las Rosas', 'Jardín', 'Centro']

// Filters only (no data leaves the browser here): the search never submits a form to a server.
export function HeroSearch({
  filters,
  onChange,
  onSubmit,
}: {
  filters: RequestFilters
  onChange: (next: RequestFilters) => void
  onSubmit: () => void
}): React.ReactNode {
  return (
    <form
      aria-label="Buscar servicios"
      className={styles.search}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      role="search"
    >
      <div className={styles.field}>
        <label htmlFor="busqueda-que">Qué necesitás</label>
        <input
          autoComplete="off"
          id="busqueda-que"
          maxLength={80}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Ej. arreglo de cañería"
          type="search"
          value={filters.query}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="busqueda-categoria">Categoría</label>
        <select
          id="busqueda-categoria"
          onChange={(event) => onChange({ ...filters, category: event.target.value as RequestFilters['category'] })}
          value={filters.category}
        >
          <option value="">Todas</option>
          {CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
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
          {ZONES.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </div>
      <button className={`${styles.buttonPrimary} ${styles.searchButton}`} type="submit">
        Buscar
      </button>
    </form>
  )
}
