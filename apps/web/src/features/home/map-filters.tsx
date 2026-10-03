'use client'

import type { CatalogoOficios } from '@factory/contracts'

import styles from './home.module.css'

// Categoría → Subcategoría (a service of that category). A category alone shows every provider
// with ANY service in it; choosing a subcategory narrows it to that service. Both lists come from
// the catalog the administration keeps in the backend: nothing is hardcoded here.
export function MapFilters({
  catalog,
  category,
  service,
  onChange,
}: {
  catalog: CatalogoOficios | undefined
  category: string
  service: string
  onChange: (next: { category: string; profession: string }) => void
}): React.ReactNode {
  const categories = catalog?.categories ?? []
  const services = catalog?.items ?? []
  // A service chosen from the search bar still shows its category.
  const shownCategory = category || services.find((item) => item.id === service)?.categoryId || ''
  const visibleServices = shownCategory ? services.filter((item) => item.categoryId === shownCategory) : services
  if (categories.length === 0 && services.length === 0) return null
  return (
    <div className={styles.mapFilters} role="group" aria-label="Filtrar prestadores">
      <label className={styles.mapFilter}>
        <span>Categoría</span>
        <select onChange={(event) => onChange({ category: event.target.value, profession: '' })} value={shownCategory}>
          <option value="">Todas</option>
          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className={styles.mapFilter}>
        <span>Subcategoría</span>
        <select onChange={(event) => onChange({ category: shownCategory, profession: event.target.value })} value={visibleServices.some((item) => item.id === service) ? service : ''}>
          <option value="">{shownCategory ? 'Todas las de la categoría' : 'Todas'}</option>
          {visibleServices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
    </div>
  )
}
