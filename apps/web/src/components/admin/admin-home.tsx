'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { adminApi, adminErrorMessage, eventoLabel, formatFecha, type AdminEvento, type AdminResumen } from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import styles from './admin.module.css'

// Dashboard: only counts the API computes from real data (no invented numbers).
export function AdminHome(): React.ReactNode {
  const [resumen, setResumen] = useState<AdminResumen | null>(null)
  const [eventos, setEventos] = useState<AdminEvento[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.resumen().then(setResumen).catch((cause) => setError(adminErrorMessage(cause)))
    adminApi.actividad({ tipo: '', page: 1, pageSize: 10 }).then((result) => setEventos(result.items)).catch(() => setEventos([]))
  }, [])

  const cards = resumen
    ? [
        { label: 'Usuarios', value: resumen.usuarios, hint: 'Cuentas registradas', href: '/tus/admin/usuarios' },
        { label: 'Prestadores', value: resumen.prestadores.total, hint: `${resumen.prestadores.enMapa} visibles en el mapa`, href: '/tus/admin/prestadores' },
        { label: 'Solicitudes activas', value: resumen.solicitudes.publicadas, hint: 'Publicadas y vigentes', href: '/tus/admin/solicitudes' },
        { label: 'Solicitudes pendientes', value: resumen.solicitudes.sinPostulantes, hint: 'Sin postulantes todavía', href: '/tus/admin/solicitudes' },
        { label: 'WhatsApp pendientes', value: resumen.whatsappPendientes ?? '—', hint: resumen.whatsappPendientes === null ? 'Módulo no activo' : 'Esperan una persona', href: '/tus/admin/whatsapp' },
      ]
    : []

  return (
    <>
      <AdminPageHeader subtitle="Resumen general de TUS" title="Panel administrativo" />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!resumen && !error ? <p className={styles.muted} role="status">Cargando el resumen…</p> : null}
      <div className={styles.cards}>
        {cards.map((card) => (
          <Link className={styles.card} href={card.href as Route} key={card.label} style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className={styles.cardLabel}>{card.label}</span>
            <strong className={styles.cardValue}>{card.value}</strong>
            <span className={styles.cardHint}>{card.hint}</span>
          </Link>
        ))}
      </div>
      <section className={styles.section}>
        <h2>Actividad reciente</h2>
        {eventos === null ? <p className={styles.muted}>Cargando…</p> : eventos.length === 0 ? (
          <AdminEmpty text="Todavía no hay actividad registrada." />
        ) : (
          <ul className={styles.list}>
            {eventos.slice(0, 12).map((evento, index) => (
              <li className={styles.listItem} key={`${evento.fecha}-${index}`}>
                <span>{eventoLabel(evento.tipo)}</span>
                <span className={styles.muted}>
                  <span className={`${styles.badge} ${evento.resultado === 'denied' ? styles.badgeWarn : styles.badgeOk}`}>{evento.resultado === 'denied' ? 'Rechazado' : 'OK'}</span>{' '}
                  {formatFecha(evento.fecha)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
