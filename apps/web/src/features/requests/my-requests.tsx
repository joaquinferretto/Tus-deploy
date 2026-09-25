'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { PostulanteSolicitud } from '@factory/contracts'

import type { TusWebSession } from '../../lib/tus-ui-contract'
import styles from '../auth/auth.module.css'
import homeStyles from '../home/home.module.css'
import { budgetLabel, timeAgoLabel, urgencyLabel } from '../home/requests-source'
import { categoryOf } from '../home/types'
import { APPLICATION_STATUS, createRequestsClient, requestStatusLabel, type OwnRequestDto } from './requests-client'

export function MyRequests({ session, refreshKey = 0 }: { session: TusWebSession; refreshKey?: number }): React.ReactNode {
  const [items, setItems] = useState<OwnRequestDto[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    createRequestsClient(session)
      .mine()
      .then(setItems)
      .catch(() => {
        setItems([])
        setFailed(true)
      })
  }, [session, refreshKey])

  async function close(item: OwnRequestDto) {
    if (!(await createRequestsClient(session).close(item.id))) return
    setItems((current) =>
      (current ?? []).map((existing) =>
        existing.id === item.id ? { ...existing, status: 'cerrada', assignment: existing.assignment === 'pendiente' ? 'cancelada' : existing.assignment } : existing
      )
    )
  }

  if (items === null)
    return (
      <p className={styles.footerText} role="status">
        Cargando…
      </p>
    )
  if (failed)
    return (
      <p className={styles.formError} role="alert">
        No pudimos cargar tus solicitudes. Probá de nuevo en unos minutos.
      </p>
    )
  if (items.length === 0) return <p className={styles.footerText}>Todavía no enviaste solicitudes.</p>
  return (
    <ul style={{ display: 'grid', gap: 10, listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
      {items.map((item) => (
        <li className={styles.notice} key={item.id} style={{ display: 'grid', gap: 4 }}>
          <strong>{item.title}</strong>
          <span>
            {categoryOf(item.category).label} · {item.approximateLocation.label} · {budgetLabel(item.budgetMax)} · {urgencyLabel(item.urgency)} ·{' '}
            {timeAgoLabel(item.createdAt)}
            {item.images.length > 0 ? ` · ${item.images.length} ${item.images.length === 1 ? 'foto' : 'fotos'}` : ''}
          </span>
          <span style={{ fontWeight: 600 }}>{requestStatusLabel(item)}</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {item.provider ? (
              <Link className={styles.link} href={`/trabajadores/${encodeURIComponent(item.provider.id)}` as Route}>
                Ver perfil de {item.provider.displayName}
              </Link>
            ) : null}
            {item.status === 'abierta' ? (
              <button className={styles.link} onClick={() => void close(item)} type="button">
                {item.assignment === 'pendiente' ? 'Cancelar solicitud' : 'Cerrar solicitud'}
              </button>
            ) : null}
          </span>
          {item.status === 'abierta' && !item.provider ? (
            <Applicants
              onChosen={(updated) => setItems((current) => (current ?? []).map((existing) => (existing.id === updated.id ? updated : existing)))}
              request={item}
              session={session}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

// Providers (of any trade) who offered to help with a public request. The client decides: accepting
// one confirms it with that provider, takes the request off the map and declines the rest.
function Applicants({ request, session, onChosen }: { request: OwnRequestDto; session: TusWebSession; onChosen: (updated: OwnRequestDto) => void }): React.ReactNode {
  const [items, setItems] = useState<PostulanteSolicitud[] | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    createRequestsClient(session)
      .applicants(request.id)
      .then(setItems)
      .catch(() => setItems([]))
  }, [request.id, session])

  async function choose(applicant: PostulanteSolicitud) {
    setWorking(applicant.id)
    setError(null)
    const updated = await createRequestsClient(session).chooseApplicant(request.id, applicant.id)
    setWorking(null)
    if (updated) onChosen(updated)
    else setError('Ese profesional ya no está disponible. Actualizá la página para ver el estado real.')
  }

  async function decline(applicant: PostulanteSolicitud) {
    setWorking(applicant.id)
    const ok = await createRequestsClient(session).declineApplicant(request.id, applicant.id)
    setWorking(null)
    if (ok) setItems((current) => (current ?? []).map((existing) => (existing.id === applicant.id ? { ...existing, status: 'rechazada' } : existing)))
  }

  if (items === null) return null
  if (items.length === 0) return <span className={styles.footerText}>Todavía no se postuló ningún profesional.</span>
  return (
    <div style={{ borderTop: '1px solid var(--tus-line, #d9dde4)', display: 'grid', gap: 8, marginTop: 6, paddingTop: 8 }}>
      <strong>
        {items.length === 1 ? '1 profesional se ofreció' : `${items.length} profesionales se ofrecieron`} · vos elegís
      </strong>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((applicant) => (
          <li key={applicant.id} style={{ display: 'grid', gap: 2 }}>
            <span>
              <Link className={styles.link} href={`/trabajadores/${encodeURIComponent(applicant.provider.id)}` as Route}>
                {applicant.provider.displayName}
              </Link>{' '}
              · {categoryOf(applicant.provider.profession).label} · {applicant.provider.approximateArea} · {APPLICATION_STATUS[applicant.status]}
            </span>
            {applicant.message ? <span>“{applicant.message}”</span> : null}
            {applicant.status === 'pendiente' ? (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <button className={homeStyles.buttonPrimary} disabled={working !== null} onClick={() => void choose(applicant)} type="button">
                  Aceptar
                </button>
                <button className={homeStyles.buttonSecondary} disabled={working !== null} onClick={() => void decline(applicant)} type="button">
                  Rechazar
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
