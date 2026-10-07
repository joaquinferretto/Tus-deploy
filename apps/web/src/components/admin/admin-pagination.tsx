'use client'

import styles from './admin.module.css'

// `compact`: a one-row footer for a narrow panel (page size on the left, pages on the right; the
// pages drop to a second row only when they do not fit). The default layout is unchanged.
export function AdminPagination({ page, pageSize, totalPages, onPage, onPageSize, compact = false }: {
  page: number
  pageSize: number
  totalPages: number
  onPage: (page: number) => void
  onPageSize: (pageSize: number) => void
  compact?: boolean
}): React.ReactNode {
  if (compact)
    return (
      <div aria-label="Paginación" className={styles.paginationCompact} role="group">
        <label>
          <span className={styles.srOnlyLabel}>Registros por página</span>
          <select onChange={(event) => onPageSize(Number(event.target.value))} value={pageSize}>
            {[10, 25, 50].map((size) => <option key={size} value={size}>{size} por página</option>)}
          </select>
        </label>
        <div className={styles.paginationPages}>
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">‹ Anterior</button>
          <span aria-live="polite">
            <span className={styles.paginationLong}>Página {page} de {totalPages}</span>
            <span aria-hidden="true" className={styles.paginationShort}>{page} / {totalPages}</span>
          </span>
          <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} type="button">Siguiente ›</button>
        </div>
      </div>
    )
  return (
    <div aria-label="Paginación" className={styles.pagination}>
      <label>
        <span className={styles.srOnlyLabel}>Registros por página</span>
        <select onChange={(event) => onPageSize(Number(event.target.value))} value={pageSize}>
          {[10, 25, 50].map((size) => <option key={size} value={size}>{size} por página</option>)}
        </select>
      </label>
      <button className={styles.buttonSecondary} disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">‹ Anterior</button>
      <span>Página {page} de {totalPages}</span>
      <button className={styles.buttonSecondary} disabled={page >= totalPages} onClick={() => onPage(page + 1)} type="button">Siguiente ›</button>
    </div>
  )
}
