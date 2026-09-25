'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { TusWebSession } from '../../lib/tus-ui-contract'
import styles from '../auth/auth.module.css'
import { budgetLabel, timeAgoLabel, urgencyLabel } from '../home/requests-source'
import { categoryOf } from '../home/types'
import { createRequestsClient, requestStatusLabel, type OwnRequestDto } from './requests-client'

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
        </li>
      ))}
    </ul>
  )
}
