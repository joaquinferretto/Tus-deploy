'use client'

import type { Route } from 'next'
import Link from 'next/link'

import type { AlojamientoPublicoDTO } from '@factory/contracts'

import styles from './home.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function lodgingHref(lodging: Pick<AlojamientoPublicoDTO, 'id' | 'slug'>): Route {
  return `/alojamientos/${encodeURIComponent(lodging.slug || lodging.id)}` as Route
}

// Only an https image (or a path of this site) is drawn; anything else shows the placeholder.
export function lodgingImage(lodging: Pick<AlojamientoPublicoDTO, 'imagenes'>): { url: string; alt: string } | null {
  const image = lodging.imagenes.find((item) => item.esPrincipal) ?? lodging.imagenes[0]
  if (!image || !(image.url.startsWith('https://') || (image.url.startsWith('/') && !image.url.startsWith('//')))) return null
  return { url: image.url, alt: image.alt ?? '' }
}

// Compact card of a lodging: real data only (a rating appears only when the API sends one).
export function LodgingCard({ lodging }: { lodging: AlojamientoPublicoDTO }): React.ReactNode {
  const image = lodgingImage(lodging)
  const place = lodging.barrioNombre ?? lodging.zonaNombre
  return (
    <article aria-labelledby={`alojamiento-${lodging.id}`} className={styles.lodgingCard}>
      <div className={styles.lodgingThumb}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- lodging images live on their own storage
          <img alt={image.alt} decoding="async" loading="lazy" src={image.url} />
        ) : null}
      </div>
      <div className={styles.lodgingBody}>
        <h3 className={styles.lodgingName} id={`alojamiento-${lodging.id}`}>{lodging.nombre}</h3>
        <p className={styles.rowText}>{lodging.tipo.nombre}{place ? ` · ${place}` : ''}</p>
        {lodging.rating ? <p className={styles.rowText}>★ {String(lodging.rating.average).replace('.', ',')} · {lodging.rating.count} {lodging.rating.count === 1 ? 'calificación' : 'calificaciones'}</p> : null}
        <p className={styles.lodgingPrice}>{lodging.precioDesde ? `Desde $${PESOS.format(lodging.precioDesde.amount)}` : 'Tarifa a consultar'}</p>
        <Link className={styles.buttonSecondary} href={lodgingHref(lodging)}>Ver alojamiento</Link>
      </div>
    </article>
  )
}

export function LodgingResults({ lodgings, status, selectedId, onSelect, filtered }: { lodgings: AlojamientoPublicoDTO[]; status: 'loading' | 'error' | 'success'; selectedId: string | null; onSelect: (id: string) => void; filtered: boolean }): React.ReactNode {
  return (
    <section aria-labelledby="alojamientos-titulo" className={styles.section} id="alojamientos">
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle} id="alojamientos-titulo">Alojamientos</h2>
          <p className={styles.sectionSubtitle}>Elegí un alojamiento y revisá fechas y tarifas antes de reservar.</p>
        </div>
        <a className={styles.seeAll} href="/alojamientos">Buscar por fechas →</a>
      </div>
      {status === 'loading' ? <p className={styles.state} role="status">Buscando alojamientos…</p> : status === 'error' ? <p className={styles.state} role="alert">No pudimos cargar los alojamientos en este momento.</p> : lodgings.length === 0 ? (
        <p className={styles.state} role="status">{filtered ? 'No encontramos alojamientos con esos filtros.' : 'Todavía no hay alojamientos publicados en TUS.'}</p>
      ) : (
        <ul className={styles.providerGrid}>
          {lodgings.slice(0, 9).map((lodging) => (
            <li className={lodging.id === selectedId ? styles.providerSelected : undefined} key={lodging.id} onClick={() => onSelect(lodging.id)}>
              <LodgingCard lodging={lodging} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
