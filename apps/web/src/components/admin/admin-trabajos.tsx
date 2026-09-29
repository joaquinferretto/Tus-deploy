'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  adminApi,
  adminErrorMessage,
  formatFecha,
  type AdminPago,
  type AdminTrabajo,
  type AdminTrabajoDetalle,
} from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { AdminPagination } from './admin-pagination'
import styles from './admin.module.css'

// FASE 10: follow a service end to end: request -> provider -> work -> budget -> deposit ->
// balance -> cancellations -> rating. Read-only except the support cancellation, which never moves
// money (refunds are a separate admin operation). The private chat is not shown.

export const ESTADO_TRABAJO: Record<string, string> = {
  requested: 'Pendiente',
  in_diagnosis: 'En diagnóstico',
  budget_pending: 'Presupuesto por decidir',
  accepted: 'Presupuesto aceptado',
  in_progress: 'En curso',
  completed: 'Completado',
  cancelled: 'Cancelado',
}
export const ESTADO_PAGO: Record<string, string> = {
  pending_payment: 'Pendiente',
  paid: 'Pagado',
  refunded: 'Reembolsado',
  charged_back: 'Contracargo',
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  expired: 'Vencido',
  cancelled: 'Cancelado',
}
const PARTE: Record<string, string> = { total: 'Total', sena: 'Seña', saldo: 'Saldo' }
const ROL: Record<string, string> = { cliente: 'el Cliente', prestador: 'el Prestador', admin: 'soporte' }
export const pesos = (minor: string | null, currency = 'ARS') =>
  minor === null ? '—' : new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(Number(minor) / 100)

const FILTROS = [['', 'Todos'], ['accepted', 'Presupuesto aceptado'], ['in_progress', 'En curso'], ['completed', 'Completados'], ['cancelled', 'Cancelados']] as const

export function AdminTrabajos(): React.ReactNode {
  const [items, setItems] = useState<AdminTrabajo[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id')
    if (id) setSelected(id)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      adminApi
        .trabajos({ q: q.trim(), estado, page, pageSize })
        .then((result) => { setItems(result.items); setTotalPages(result.totalPages); setError('') })
        .catch((cause) => setError(adminErrorMessage(cause)))
    }, 300)
    return () => clearTimeout(timer)
  }, [q, estado, page, pageSize])

  return (
    <>
      <AdminPageHeader subtitle="Solicitud, Prestador, presupuesto, seña, saldo, cancelaciones y calificación de cada trabajo" title="Trabajos" />
      {selected ? <AdminTrabajoDetalleView id={selected} onClose={() => setSelected(null)} /> : null}
      <div className={styles.toolbar}>
        <input aria-label="Buscar trabajos" onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="Buscar por título, trabajo o solicitud" type="search" value={q} />
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button aria-pressed={estado === value} key={label} onClick={() => { setEstado(value); setPage(1) }} type="button">{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null && !error ? <p className={styles.muted} role="status">Cargando trabajos…</p> : null}
      {items && items.length === 0 ? <AdminEmpty text="No hay trabajos con ese filtro." /> : null}
      {items && items.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr><th>Trabajo</th><th>Cliente / Prestador</th><th>Estado</th><th>Presupuesto</th><th>Pagos</th><th>Rating</th><th /></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td data-label="Trabajo"><strong>{item.titulo}</strong><div className={styles.muted}>{item.origen === 'solicitud' ? 'Desde solicitud' : 'Marketplace'} · {formatFecha(item.creadoEn)}</div></td>
                <td data-label="Cliente / Prestador">{item.cliente}<div className={styles.muted}>{item.prestador}</div></td>
                <td data-label="Estado">
                  {ESTADO_TRABAJO[item.estado] ?? item.estado}
                  {item.cancelacion ? <div className={styles.muted}>por {ROL[item.cancelacion.rol] ?? item.cancelacion.rol}</div> : null}
                  {item.cancelacionSolicitada && item.estado !== 'cancelled' ? <div className={styles.muted}>Cancelación solicitada</div> : null}
                </td>
                <td data-label="Presupuesto">{item.presupuesto ? pesos(item.presupuesto.totalMinor, item.presupuesto.moneda) : '—'}</td>
                <td data-label="Pagos">{item.pagos.length ? item.pagos.map((p) => <div key={p.parte}>{PARTE[p.parte]}: {ESTADO_PAGO[p.estado] ?? p.estado}</div>) : <span className={styles.muted}>Sin pagos</span>}</td>
                <td data-label="Rating">{item.calificacion ? `★ ${item.calificacion}` : '—'}</td>
                <td><button onClick={() => setSelected(item.id)} type="button">Ver detalle</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {items ? <AdminPagination onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={totalPages} /> : null}
    </>
  )
}

export function AdminTrabajoDetalleView({ id, onClose }: { id: string; onClose: () => void }): React.ReactNode {
  const [detalle, setDetalle] = useState<AdminTrabajoDetalle | null>(null)
  const [error, setError] = useState('')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [aviso, setAviso] = useState('')
  const load = useCallback(() => {
    adminApi.trabajo(id).then((value) => { setDetalle(value); setError('') }).catch((cause) => setError(adminErrorMessage(cause)))
  }, [id])
  useEffect(() => { load() }, [load])

  async function cancelar() {
    if (!detalle || busy) return
    if (!motivo.trim()) {
      setAviso('Escribí el motivo de la cancelación.')
      return
    }
    if (!window.confirm('¿Cancelar este trabajo como soporte? Los pagos NO se reembolsan automáticamente.')) return
    setBusy(true)
    try {
      await adminApi.cancelarTrabajo(detalle.id, detalle.version, motivo.trim(), `admin-cancel:${detalle.id}:${detalle.version}`)
      setAviso('Trabajo cancelado. Si corresponde un reembolso, hacelo desde la operación de reembolsos.')
      setMotivo('')
      load()
    } catch (cause) {
      setAviso(adminErrorMessage(cause))
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Detalle del trabajo" className={styles.card}>
      <p><button onClick={onClose} type="button">Cerrar detalle</button></p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!detalle && !error ? <p className={styles.muted} role="status">Cargando trabajo…</p> : null}
      {detalle ? (
        <>
          <h2>{detalle.titulo}</h2>
          <p>
            {ESTADO_TRABAJO[detalle.estado] ?? detalle.estado} · {detalle.cliente} → {detalle.prestador}
            {detalle.solicitudId ? <span className={styles.muted}> · solicitud {detalle.solicitudId}</span> : null}
          </p>
          {detalle.presupuesto ? <p>Presupuesto aceptado: {pesos(detalle.presupuesto.totalMinor, detalle.presupuesto.moneda)}</p> : <p className={styles.muted}>Sin presupuesto aceptado.</p>}
          {detalle.cancelacion ? <p>Cancelado por {ROL[detalle.cancelacion.rol] ?? detalle.cancelacion.rol}: “{detalle.cancelacion.motivo}”</p> : null}
          {detalle.cancelacionSolicitada ? <p>Cancelación solicitada por el Cliente ({formatFecha(detalle.cancelacionSolicitada.fecha)}): “{detalle.cancelacionSolicitada.motivo}”</p> : null}
          <h3>Historial</h3>
          <ol>
            {detalle.transiciones.map((t, index) => (
              <li key={index}>{formatFecha(t.fecha)} · {t.de ? `${ESTADO_TRABAJO[t.de] ?? t.de} → ` : ''}{ESTADO_TRABAJO[t.a] ?? t.a} <span className={styles.muted}>({t.motivo})</span></li>
            ))}
          </ol>
          <h3>Pagos</h3>
          <AdminTablaPagos items={detalle.pagosDetalle} />
          {detalle.liquidaciones.length ? (
            <p className={styles.muted}>
              Liquidaciones internas (sin transferencias de TUS): {detalle.liquidaciones.map((l) => `${PARTE[l.parte] ?? l.parte} ${l.estado} (neto ${pesos(l.netoMinor)})`).join(' · ')}
            </p>
          ) : null}
          <h3>Calificación</h3>
          <p>{detalle.calificacionDetalle ? `★ ${detalle.calificacionDetalle.puntuacion}/5${detalle.calificacionDetalle.comentario ? ` · “${detalle.calificacionDetalle.comentario}”` : ''}` : 'Sin calificación.'}</p>
          {!['completed', 'cancelled'].includes(detalle.estado) ? (
            <>
              <h3>Cancelación de soporte</h3>
              <p className={styles.muted}>Cancela el trabajo aunque tenga pagos. No mueve dinero: los reembolsos se hacen aparte.</p>
              <label>
                Motivo
                <textarea maxLength={500} onChange={(event) => setMotivo(event.target.value)} value={motivo} />
              </label>
              <p><button disabled={busy} onClick={() => void cancelar()} type="button">Cancelar trabajo como soporte</button></p>
            </>
          ) : null}
          {aviso ? <p role="status">{aviso}</p> : null}
        </>
      ) : null}
    </section>
  )
}

export function AdminTablaPagos({ items }: { items: AdminPago[] }): React.ReactNode {
  if (!items.length) return <p className={styles.muted}>Sin pagos registrados.</p>
  return (
    <table className={styles.table}>
      <thead>
        <tr><th>Parte</th><th>Monto</th><th>Comisión TUS</th><th>Neto Prestador</th><th>Fee MP</th><th>Estado</th><th>Referencia MP</th><th>Fecha</th></tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <tr key={p.pagoId}>
            <td data-label="Parte">{PARTE[p.parte] ?? p.parte}</td>
            <td data-label="Monto">{pesos(p.montoMinor, p.moneda)}</td>
            <td data-label="Comisión TUS">{pesos(p.comisionMinor, p.moneda)}</td>
            <td data-label="Neto Prestador">{p.netoPrestadorMinor === null ? <span className={styles.muted}>pendiente</span> : pesos(p.netoPrestadorMinor, p.moneda)}</td>
            <td data-label="Fee MP">{p.feeMercadoPagoMinor === null ? <span className={styles.muted}>—</span> : pesos(p.feeMercadoPagoMinor, p.moneda)}</td>
            <td data-label="Estado">{ESTADO_PAGO[p.estado] ?? p.estado}{p.error ? <div className={styles.muted}>{p.error}</div> : null}</td>
            <td data-label="Referencia MP">{p.referencia ?? '—'}</td>
            <td className={styles.muted} data-label="Fecha">{formatFecha(p.creadoEn)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const FILTROS_PAGO = [['', 'Todos'], ['pending', 'Pendientes'], ['approved', 'Aprobados'], ['rejected', 'Rechazados'], ['refunded', 'Reembolsados']] as const

export function AdminPagos(): React.ReactNode {
  const [items, setItems] = useState<AdminPago[] | null>(null)
  const [error, setError] = useState('')
  const [estado, setEstado] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)
  const [estadoPagos, setEstadoPagos] = useState<Awaited<ReturnType<typeof adminApi.pagosEstado>> | null>(null)
  useEffect(() => { void adminApi.pagosEstado().then(setEstadoPagos).catch(() => undefined) }, [])
  useEffect(() => {
    adminApi
      .pagos({ estado, page, pageSize })
      .then((result) => { setItems(result.items); setTotalPages(result.totalPages); setError('') })
      .catch((cause) => setError(adminErrorMessage(cause)))
  }, [estado, page, pageSize])
  return (
    <>
      <AdminPageHeader subtitle="Cobros de trabajos con Mercado Pago: monto, comisión TUS, neto del Prestador y estado" title="Pagos" />
      {estadoPagos ? (
        <section aria-label="Estado de los pagos online" className={styles.card}>
          <p>
            <strong>{estadoPagos.productEnabled && estadoPagos.blockers.length === 0 ? 'Pagos online habilitados' : 'Pagos online no disponibles'}</strong>
            {' · '}entorno {estadoPagos.operational.environment} · comisión TUS {(estadoPagos.globalPolicy.rateBps / 100).toLocaleString('es-AR')}%
            {estadoPagos.globalPolicy.persisted ? '' : ' (por defecto)'}
          </p>
          {estadoPagos.blockers.length ? <p className={styles.muted}>Falta: {estadoPagos.blockers.join(', ')}</p> : null}
        </section>
      ) : null}
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          {FILTROS_PAGO.map(([value, label]) => (
            <button aria-pressed={estado === value} key={label} onClick={() => { setEstado(value); setPage(1) }} type="button">{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null && !error ? <p className={styles.muted} role="status">Cargando pagos…</p> : null}
      {items && items.length === 0 ? <AdminEmpty text="Todavía no hay pagos con ese filtro." /> : null}
      {items && items.length > 0 ? (
        <>
          <AdminTablaPagos items={items} />
          <p className={styles.muted}>Para ver el trabajo de un pago, buscalo en Trabajos. Los reembolsos no se hacen desde esta pantalla.</p>
        </>
      ) : null}
      {items ? <AdminPagination onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={totalPages} /> : null}
    </>
  )
}
