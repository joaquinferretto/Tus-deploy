import type { Route } from 'next'
import Link from 'next/link'

import type { CandidatoPrestador, PrestadorPublico } from '@factory/contracts'

import homeStyles from '../home/home.module.css'
import styles from './directory.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function profileHref(id: string): Route {
  return `/trabajadores/${encodeURIComponent(id)}` as Route
}

// Only public, authorized data. Rating is omitted because TUS has no reviews yet (never invented);
// no photo storage for providers exists either, so the avatar uses initials.
export function WorkerCard({
  worker,
  onChoose,
  chooseLabel = 'Elegir',
}: {
  worker: PrestadorPublico | CandidatoPrestador
  onChoose?: () => void
  chooseLabel?: string
}): React.ReactNode {
  const distance = 'distanceKm' in worker && worker.distanceKm !== null ? worker.distanceKm : null
  return (
    <article aria-labelledby={`trabajador-${worker.id}`} className={styles.card}>
      <div className={styles.cardTop}>
        <span aria-hidden="true" className={styles.avatar}>
          {worker.initials}
        </span>
        <div>
          <h3 className={styles.name} id={`trabajador-${worker.id}`}>
            {worker.displayName}
          </h3>
          <p className={styles.profession}>{worker.profession.title}</p>
        </div>
      </div>
      <ul className={styles.facts}>
        {worker.verified ? <li className={styles.verified}>✓ Identidad verificada</li> : <li className={styles.muted}>Identidad sin verificar</li>}
        <li>
          {worker.completedJobs > 0
            ? `${worker.completedJobs} ${worker.completedJobs === 1 ? 'trabajo realizado' : 'trabajos realizados'} en TUS`
            : 'Todavía sin trabajos en TUS'}
        </li>
        <li>
          {worker.approximateArea} · zona aproximada
          {distance !== null ? ` · ${distance < 1 ? 'muy cerca' : `a ~${String(distance).replace('.', ',')} km`}` : ''}
        </li>
        <li className={worker.availability.status === 'atiende_hoy' ? styles.available : styles.muted}>{worker.availability.label}</li>
        {worker.startingPrice ? <li>Desde ${PESOS.format(worker.startingPrice.amount)}</li> : null}
      </ul>
      <div className={styles.cardActions}>
        <Link className={homeStyles.buttonSecondary} href={profileHref(worker.id)}>
          Ver perfil
        </Link>
        {onChoose ? (
          <button className={homeStyles.buttonPrimary} onClick={onChoose} type="button">
            {chooseLabel}
          </button>
        ) : null}
      </div>
    </article>
  )
}
