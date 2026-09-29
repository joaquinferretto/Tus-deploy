'use client'

import { useEffect, useState } from 'react'

import { adminApi, adminErrorMessage, formatFecha, type AdminSolicitud } from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { AdminPagination } from './admin-pagination'
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
  const [q, setQ] = useState('')
  const [categoria, setCategoria] = useState('')
  const [oficios, setOficios] = useState<{ id: string; nombre: string }[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => {
      adminApi.solicitudes({ q: q.trim(), estado: filtro === 'todas' ? '' : filtro, categoria, page, pageSize })
        .then((result) => { setItems(result.items); setTotalPages(result.totalPages); setError('') })
        .catch((cause) => setError(adminErrorMessage(cause)))
    }, 400)
    return () => clearTimeout(timer)
  }, [q, filtro, categoria, page, pageSize])

  useEffect(() => { void adminApi.catalogo().then((result) => setOficios(result.oficios.map(({ id, nombre }) => ({ id, nombre })))).catch(() => undefined) }, [])

  const tone = (value: 'ok' | 'brand' | 'off' | 'warn') => (value === 'ok' ? styles.badgeOk : value === 'brand' ? styles.badgeBrand : value === 'warn' ? styles.badgeWarn : styles.badgeOff)
  const visibles = items ?? []

  return (
    <>
      <AdminPageHeader subtitle="Solicitudes creadas por clientes, ordenadas de la más reciente" title="Solicitudes" />
      <div className={styles.toolbar}>
        <input aria-label="Buscar solicitudes" onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="Buscar cliente, título o zona" type="search" value={q} />
        <select aria-label="Servicio" onChange={(event) => { setCategoria(event.target.value); setPage(1) }} value={categoria}><option value="">Todos los servicios</option>{oficios.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select>
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button aria-pressed={filtro === value} key={value} onClick={() => { setFiltro(value); setPage(1) }} type="button">{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null && !error ? <p className={styles.muted} role="status">Cargando solicitudes…</p> : null}
      {items && visibles.length === 0 ? <AdminEmpty text={items.length === 0 ? 'Todavía no hay solicitudes.' : 'No hay solicitudes con ese estado.'} /> : null}
      {visibles.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr><th>Cliente</th><th>Servicio</th><th>Zona</th><th>Estado</th><th>Fecha</th><th>Postulantes</th><th>Trabajo</th></tr>
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
                <td data-label="Trabajo">{item.trabajoId ? <a href={`/tus/admin/trabajos?id=${encodeURIComponent(item.trabajoId)}`}>Ver trabajo</a> : item.canceladaEn ? <span className={styles.muted}>Cancelada</span> : <span className={styles.muted}>Sin trabajo</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {items ? <AdminPagination onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={totalPages} /> : null}
    </>
  )
}
