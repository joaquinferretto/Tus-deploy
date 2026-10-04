import type { Route } from 'next'
import Link from 'next/link'

import type { CandidatoPrestador, PrestadorPublico } from '@factory/contracts'

import homeStyles from '../home/home.module.css'
import { Avatar } from './avatar'
import styles from './directory.module.css'
import { ratingLabel } from './rating-label'
import { servicesLabel } from './services-label'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function profileHref(id: string): Route {
  return `/trabajadores/${encodeURIComponent(id)}` as Route
}

// Only public, authorized data. The rating is the real one of completed works (never invented)
// and the avatar is the provider's photo, or its initials when there is none.
// `compact` is the short card of the map (the list under the map and the mobile sheet): who it
// is, what it does, where and whether it is available; the rest is on the profile.
export function WorkerCard({
  worker,
  onChoose,
  chooseLabel = 'Elegir',
  compact = false,
}: {
  worker: PrestadorPublico | CandidatoPrestador
  onChoose?: () => void
  chooseLabel?: string
  compact?: boolean
}): React.ReactNode {
  const distance = 'distanceKm' in worker && worker.distanceKm !== null ? worker.distanceKm : null
  if (compact) {
    const rating = ratingLabel(worker.rating)
    return (
      <article aria-labelledby={`trabajador-${worker.id}`} className={`${styles.card} ${styles.cardCompact}`}>
        <div className={styles.cardTop}>
          <Avatar initials={worker.initials} photoUrl={worker.photoUrl} size="sm" />
          <div className={styles.cardHeading}>
            <h3 className={styles.name} id={`trabajador-${worker.id}`}>
              {worker.displayName}
              {worker.verified ? (
                <span className={styles.verifiedMark} title="Identidad verificada">
                  {' '}✓<span className={homeStyles.srOnly}> Identidad verificada</span>
                </span>
              ) : null}
            </h3>
            <p className={styles.profession}>{servicesLabel(worker)}</p>
          </div>
        </div>
        <p className={styles.compactFacts}>
          {worker.publicArea}
          {rating ? ` · ${rating}` : ''}
          {worker.startingPrice ? ` · Desde ${PESOS.format(worker.startingPrice.amount)}` : ''}
        </p>
        <p className={`${styles.compactFacts} ${worker.availability.status === 'atiende_hoy' ? styles.available : styles.muted}`}>{worker.availability.label}</p>
        <div className={styles.cardActions}>
          <Link className={homeStyles.buttonSecondary} href={profileHref(worker.id)}>
            Ver perfil
          </Link>
          {worker.aceptaTurnos !== false ? (
            <Link className={homeStyles.buttonPrimary} href={`${profileHref(worker.id)}?turno=1` as Route}>
              Solicitar turno
            </Link>
          ) : null}
        </div>
      </article>
    )
  }
  return (
    <article aria-labelledby={`trabajador-${worker.id}`} className={styles.card}>
      <div className={styles.cardTop}>
        <Avatar initials={worker.initials} photoUrl={worker.photoUrl} />
        <div>
          <h3 className={styles.name} id={`trabajador-${worker.id}`}>
            {worker.displayName}
          </h3>
          <p className={styles.profession}>{worker.profession.title}</p>
          {(worker.professions?.length ?? 0) > 1 ? <p className={styles.muted}>{servicesLabel(worker)}</p> : null}
        </div>
      </div>
      <ul className={styles.facts}>
        {worker.verified ? <li className={styles.verified}>✓ Identidad verificada</li> : <li className={styles.muted}>Identidad sin verificar</li>}
        <li>
          {worker.completedJobs > 0
            ? `${worker.completedJobs} ${worker.completedJobs === 1 ? 'trabajo realizado' : 'trabajos realizados'} en TUS`
            : 'Todavía sin trabajos en TUS'}
        </li>
        {ratingLabel(worker.rating) ? <li>{ratingLabel(worker.rating)}</li> : null}
        <li>
          {worker.publicArea} · zona aproximada
          {worker.serviceZones.length > 1 ? ` · ${worker.serviceZones.length} zonas` : ''}
          {distance !== null ? ` · ${distance < 1 ? 'muy cerca' : `a ~${String(distance).replace('.', ',')} km`}` : ''}
        </li>
        <li className={worker.availability.status === 'atiende_hoy' ? styles.available : styles.muted}>{worker.availability.label}</li>
        {worker.startingPrice ? <li>Desde ${PESOS.format(worker.startingPrice.amount)}</li> : null}
      </ul>
      <div className={styles.cardActions}>
        <Link className={homeStyles.buttonSecondary} href={profileHref(worker.id)}>
          Ver perfil
        </Link>
        {worker.aceptaTurnos !== false && !onChoose ? (
          <Link className={homeStyles.buttonPrimary} href={`${profileHref(worker.id)}?turno=1` as Route}>
            Solicitar turno
          </Link>
        ) : null}
        {onChoose ? (
          <button className={homeStyles.buttonPrimary} onClick={onChoose} type="button">
            {chooseLabel}
          </button>
        ) : null}
      </div>
    </article>
  )
}
