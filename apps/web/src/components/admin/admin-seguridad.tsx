'use client'

import { useCallback, useEffect, useState } from 'react'

import { adminMfa, type AdminMfaStatus } from '@/lib/tus-admin-mfa'
import { adminApi, eventoLabel, formatFecha, type AdminEvento } from '@/lib/tus-admin-api'
import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { AdminPagination } from './admin-pagination'
import { SeguridadAdmin } from './seguridad-admin'
import styles from './admin.module.css'

// MFA and session state (never the TOTP secret) plus the existing tools: regenerate recovery codes
// and turn MFA off (password + code, enforced by the API).
export function AdminSeguridad(): React.ReactNode {
  const [status, setStatus] = useState<AdminMfaStatus | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [eventos, setEventos] = useState<AdminEvento[] | null>(null)
  const [tipo, setTipo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)

  // Audit log: paginated and filtered by the API. Changing the type goes back to page 1.
  const loadEventos = useCallback(() => adminApi.actividad({ tipo, page, pageSize })
    .then((result) => { setEventos(result.items); setTotalPages(result.totalPages) })
    .catch(() => setEventos([])), [tipo, page, pageSize])
  useEffect(() => { void loadEventos() }, [loadEventos])

  useEffect(() => {
    void createTusWebAuthClient().restore(window.location.pathname).then((result) => {
      if (!result.session) return
      const session = toTusWebSession(result.session)
      setExpiresAt(result.session.expiresAt)
      adminMfa.status(session).then(setStatus).catch(() => setStatus(null))
    })
  }, [])

  return (
    <>
      <AdminPageHeader subtitle="Segundo factor, sesión y actividad de seguridad" title="Seguridad" />
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>MFA</span>
          <strong className={styles.cardValue} style={{ fontSize: '1.1rem' }}>{status ? (status.enrolled ? 'Activo' : 'No configurado') : '—'}</strong>
          <span className={styles.cardHint}>App autenticadora (TOTP)</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Sesión administrativa</span>
          <strong className={styles.cardValue} style={{ fontSize: '1.1rem' }}>{status?.elevated ? 'Activa' : '—'}</strong>
          <span className={styles.cardHint}>{status?.elevatedUntil ? `MFA válido hasta ${formatFecha(new Date(status.elevatedUntil).toISOString())}` : ''}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Sesión vence</span>
          <strong className={styles.cardValue} style={{ fontSize: '1.1rem' }}>{expiresAt ? formatFecha(new Date(expiresAt).toISOString()) : '—'}</strong>
          <span className={styles.cardHint}>Después hay que volver a ingresar</span>
        </div>
      </div>
      <section className={styles.section}>
        <h2>Auditoría</h2>
        <div className={styles.filters}>
          <select aria-label="Tipo de evento" onChange={(event) => { setTipo(event.target.value); setPage(1) }} value={tipo}>
            <option value="">Todos los eventos</option>
            <option value="seguridad">Seguridad (ingresos, MFA, sesiones)</option>
            <option value="usuarios">Cambios de usuarios por un admin</option>
            <option value="catalogo">Cambios del catálogo</option>
          </select>
        </div>
        {eventos === null ? <p className={styles.muted}>Cargando…</p> : eventos.length === 0 ? <AdminEmpty text="Todavía no hay eventos registrados." /> : (
          <ul className={styles.list}>
            {eventos.map((evento, index) => (
              <li className={styles.listItem} key={`${evento.fecha}-${index}`}>
                <span>{eventoLabel(evento.tipo)}</span>
                <span className={styles.muted}>{evento.resultado === 'denied' ? 'Rechazado · ' : ''}{formatFecha(evento.fecha)}</span>
              </li>
            ))}
          </ul>
        )}
        {eventos ? <AdminPagination onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={totalPages} /> : null}
      </section>
      <section className={styles.section}>
        <SeguridadAdmin />
      </section>
    </>
  )
}
