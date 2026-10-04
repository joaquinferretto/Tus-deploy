'use client'

import styles from './home.module.css'

// Bottom sheet over the map on small screens: the selected professional or lodging, instead of a
// popup that would not fit. It is not modal (the map stays usable) and Escape closes it.
export function MapSheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }): React.ReactNode {
  return (
    <div
      aria-label={label}
      className={styles.mapSheet}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      role="region"
    >
      <button aria-label="Cerrar" className={styles.mapSheetClose} onClick={onClose} type="button">×</button>
      {children}
    </div>
  )
}
