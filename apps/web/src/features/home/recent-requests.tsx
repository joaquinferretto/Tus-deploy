'use client'

import Image from 'next/image'

import { categoryOf, type MapRequest } from './types'
import styles from './home.module.css'

// Accessible equivalent of the map markers: every request on the map is a row here.
export function RecentRequests({
  status,
  requests,
  selectedId,
  onSelect,
  onHover,
}: {
  status: 'loading' | 'error' | 'success'
  requests: MapRequest[]
  selectedId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}): React.ReactNode {
  return (
    <section aria-labelledby="solicitudes-titulo" className={styles.section} id="solicitudes">
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle} id="solicitudes-titulo">
            Solicitudes recientes
          </h2>
          <p className={styles.sectionSubtitle}>
            Personas de tu zona buscando ayuda profesional.
          </p>
        </div>
        <div className={styles.sectionActions}>
          <a className={styles.buttonPrimary} href="/publicar">
            Publicar mi solicitud
          </a>
          <a className={styles.seeAll} href={`/sign-in?returnTo=${encodeURIComponent('/tus/prestador')}`}>
            Ver todas las solicitudes →
          </a>
        </div>
      </div>
      {status === 'loading' ? (
        <div aria-busy="true" aria-label="Cargando solicitudes" className={styles.list}>
          {[0, 1, 2].map((index) => (
            <div className={styles.skeletonRow} key={index} />
          ))}
        </div>
      ) : status === 'error' ? (
        <p className={styles.state} role="alert">
          No pudimos cargar las solicitudes en este momento. Probá de nuevo en unos minutos.
        </p>
      ) : requests.length === 0 ? (
        <p className={styles.state} role="status">
          Todavía no hay solicitudes visibles en esta zona.{' '}
          <a href="/publicar">Publicá la primera</a>.
        </p>
      ) : (
        <ul className={styles.list}>
          {requests.map((request) => (
            <RecentRequestRow
              active={request.id === selectedId}
              key={request.id}
              onHover={onHover}
              onSelect={onSelect}
              request={request}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function RecentRequestRow({
  request,
  active,
  onSelect,
  onHover,
}: {
  request: MapRequest
  active: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}): React.ReactNode {
  const category = categoryOf(request.category)
  const images = (request.images ?? []).slice(0, 2)
  const initials = (request.requesterName ?? '?')
    .split(/\s+/u)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <li
      aria-current={active ? 'true' : undefined}
      className={`${styles.row} ${active ? styles.rowActive : ''}`}
      id={`solicitud-${request.id}`}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(request.id)}
      onFocus={() => onHover(request.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(request.id)
        }
      }}
      onMouseEnter={() => onHover(request.id)}
      onMouseLeave={() => onHover(null)}
      tabIndex={0}
    >
      <div className={styles.cellMain}>
        <span aria-hidden="true" className={styles.categoryIcon} style={{ background: category.color }}>
          {category.label[0]}
        </span>
        <div style={{ minWidth: 0 }}>
          <p className={styles.rowCategory} style={{ color: category.color }}>
            {category.label}
          </p>
          <p className={styles.rowTitle}>{request.title}</p>
          {request.description ? <p className={`${styles.rowText} ${styles.hideMobile}`}>{request.description}</p> : null}
        </div>
      </div>
      <div className={`${styles.person} ${styles.hideMobile}`}>
        <span aria-hidden="true" className={styles.avatar}>
          {initials}
        </span>
        <div>
          <p className={styles.label}>Solicitó:</p>
          <p className={styles.strong}>{request.requesterName ?? 'Cliente de TUS'}</p>
        </div>
      </div>
      <div className={styles.hideMobile}>
        <p className={styles.strong}>{request.approximateLocation.label}</p>
        <p className={styles.rowText}>{request.createdAtLabel}</p>
      </div>
      <div className={`${styles.hideMobile} ${styles.hideTablet}`}>
        {images.length > 0 ? (
          <>
            <p className={styles.label}>Imágenes del servicio</p>
            <div className={styles.thumbs}>
              {images.map((src, index) => (
                <Image alt={`Imagen ${index + 1} de: ${request.title}`} className={styles.thumb} height={44} key={src} src={src} unoptimized width={44} />
              ))}
            </div>
          </>
        ) : (
          <p className={styles.label}>Sin imágenes</p>
        )}
      </div>
      <div className={styles.hideTablet}>
        <p className={styles.price}>{request.budgetLabel ?? 'A convenir'}</p>
        {request.urgencyLabel ? <p className={styles.urgency}>{request.urgencyLabel}</p> : null}
      </div>
      <span aria-hidden="true" className={styles.chevron}>
        ›
      </span>
    </li>
  )
}
