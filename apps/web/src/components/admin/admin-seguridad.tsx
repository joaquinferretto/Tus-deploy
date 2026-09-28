'use client'

import { useEffect, useState } from 'react'

import { adminMfa, type AdminMfaStatus } from '@/lib/tus-admin-mfa'
import { adminApi, eventoLabel, formatFecha, type AdminEvento } from '@/lib/tus-admin-api'
import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { SeguridadAdmin } from './seguridad-admin'
import styles from './admin.module.css'

// MFA and session state (never the TOTP secret) plus the existing tools: regenerate recovery codes
// and turn MFA off (password + code, enforced by the API).
export function AdminSeguridad(): React.ReactNode {
  const [status, setStatus] = useState<AdminMfaStatus | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [eventos, setEventos] = useState<AdminEvento[] | null>(null)

  useEffect(() => {
    void createTusWebAuthClient().restore(window.location.pathname).then((result) => {
      if (!result.session) return
      const session = toTusWebSession(result.session)
      setExpiresAt(result.session.expiresAt)
      adminMfa.status(session).then(setStatus).catch(() => setStatus(null))
    })
    adminApi.actividad().then((result) => setEventos(result.items)).catch(() => setEventos([]))
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
        <h2>Actividad de seguridad</h2>
        {eventos === null ? <p className={styles.muted}>Cargando…</p> : eventos.length === 0 ? <AdminEmpty text="Todavía no hay eventos registrados." /> : (
          <ul className={styles.list}>
            {eventos.slice(0, 15).map((evento, index) => (
              <li className={styles.listItem} key={`${evento.fecha}-${index}`}>
                <span>{eventoLabel(evento.tipo)}</span>
                <span className={styles.muted}>{evento.resultado === 'denied' ? 'Rechazado · ' : ''}{formatFecha(evento.fecha)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.section}>
        <SeguridadAdmin />
      </section>
    </>
  )
}
