'use client'

import styles from './admin.module.css'

export function AdminPagination({ page, pageSize, totalPages, onPage, onPageSize }: {
  page: number
  pageSize: number
  totalPages: number
  onPage: (page: number) => void
  onPageSize: (pageSize: number) => void
}): React.ReactNode {
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
