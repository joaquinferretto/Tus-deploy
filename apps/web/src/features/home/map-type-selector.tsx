'use client'

import type { MapKind } from './map-state'
import styles from './home.module.css'

const KINDS: { id: MapKind; label: string }[] = [
  { id: 'profesionales', label: 'Profesionales' },
  { id: 'alojamientos', label: 'Alojamientos' },
]

// What the map shows. It changes the results, the markers, the cards and the filters together.
export function MapTypeSelector({ kind, onChange }: { kind: MapKind; onChange: (kind: MapKind) => void }): React.ReactNode {
  return (
    <div aria-label="Qué buscás en el mapa" className={styles.typeSelector} role="radiogroup">
      {KINDS.map((item) => (
        <button
          aria-checked={kind === item.id}
          className={styles.typeOption}
          key={item.id}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const current = KINDS.findIndex((option) => option.id === kind)
            const index = (current + (event.key === 'ArrowRight' ? 1 : KINDS.length - 1)) % KINDS.length
            onChange(KINDS[index]!.id)
            event.currentTarget.parentElement?.querySelectorAll('button')[index]?.focus()
          }}
          role="radio"
          tabIndex={kind === item.id ? 0 : -1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
