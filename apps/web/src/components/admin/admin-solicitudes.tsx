'use client'

import { useEffect, useState } from 'react'

import { adminApi, adminErrorMessage, formatFecha, type AdminSolicitud } from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import styles from './admin.module.css'

// The request model has these states only (no "en proceso" / "cancelada"): shown as they are.
const ESTADO: Record<AdminSolicitud['estado'], { label: string; tone: 'ok' | 'brand' | 'off' | 'warn' }> = {
  publicada: { label: 'Publicada', tone: 'brand' },
  asignada: { label: 'Asignada', tone: 'ok' },
  vencida: { label: 'Vencida', tone: 'warn' },
  cerrada: { label: 'Cerrada', tone: 'off' },
}

const FILTROS = [['todas', 'Todas'], ['publicada', 'Publicadas'], ['asignada', 'Asignadas'], ['vencida', 'Vencidas'], ['cerrada', 'Cerradas']] as const

export function AdminSolicitudes(): React.ReactNode {
  const [items, setItems] = useState<AdminSolicitud[] | null>(null)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number][0]>('todas')

  useEffect(() => {
    adminApi.solicitudes().then((result) => setItems(result.items)).catch((cause) => setError(adminErrorMessage(cause)))
  }, [])

  const tone = (value: 'ok' | 'brand' | 'off' | 'warn') => (value === 'ok' ? styles.badgeOk : value === 'brand' ? styles.badgeBrand : value === 'warn' ? styles.badgeWarn : styles.badgeOff)
  const visibles = (items ?? []).filter((item) => filtro === 'todas' || item.estado === filtro)

  return (
    <>
      <AdminPageHeader subtitle="Solicitudes creadas por clientes (las 100 más recientes)" title="Solicitudes" />
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button aria-pressed={filtro === value} key={value} onClick={() => setFiltro(value)} type="button">{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null && !error ? <p className={styles.muted} role="status">Cargando solicitudes…</p> : null}
      {items && visibles.length === 0 ? <AdminEmpty text={items.length === 0 ? 'Todavía no hay solicitudes.' : 'No hay solicitudes con ese estado.'} /> : null}
      {visibles.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr><th>Cliente</th><th>Servicio</th><th>Zona</th><th>Estado</th><th>Fecha</th><th>Postulantes</th></tr>
          </thead>
          <tbody>
            {visibles.map((item) => (
              <tr key={item.id}>
                <td data-label="Cliente">{item.cliente}</td>
                <td data-label="Servicio"><strong>{item.titulo}</strong><div className={styles.muted}>{item.categoria}{item.visibilidad === 'dirigida' ? ' · dirigida a un prestador' : ''}</div></td>
                <td data-label="Zona">{item.zona}</td>
                <td data-label="Estado"><span className={`${styles.badge} ${tone(ESTADO[item.estado].tone)}`}>{ESTADO[item.estado].label}</span></td>
                <td className={styles.muted} data-label="Fecha">{formatFecha(item.creadaEn)}</td>
                <td data-label="Postulantes">{item.postulantes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
