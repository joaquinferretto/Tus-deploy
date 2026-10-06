'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import type { MiReservaAlojamientoDTO } from '@factory/contracts'

import { cancelarMiReserva, ErrorAlojamientos, ESTADO_RESERVA, fechaCorta, misReservasAlojamiento, pesos } from './alojamientos-client'

// "Mis reservas": the stays of the account, each with its state in sight. The ones still ahead
// come first; the finished and cancelled ones stay below as history.
const VIGENTES = ['pending_payment', 'confirmed', 'checked_in']
const COLOR: Record<string, { fondo: string; texto: string }> = {
  confirmed: { fondo: '#ecfdf5', texto: '#065f46' },
  checked_in: { fondo: '#eff6ff', texto: '#1e40af' },
  pending_payment: { fondo: '#fff7ed', texto: '#9a3412' },
  completed: { fondo: '#f3f4f6', texto: '#374151' },
  cancelled: { fondo: '#fef2f2', texto: '#991b1b' },
  expired: { fondo: '#f3f4f6', texto: '#6b7280' },
}
const caja: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem' }
const boton: React.CSSProperties = { minHeight: 44, padding: '0.5rem 1rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }

export function MisReservasAlojamiento(): React.ReactNode {
  const [reservas, setReservas] = useState<MiReservaAlojamientoDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sinSesion, setSinSesion] = useState(false)
  const [porCancelar, setPorCancelar] = useState<MiReservaAlojamientoDTO | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setReservas(await misReservasAlojamiento())
      setError(null)
    } catch (causa) {
      if (causa instanceof ErrorAlojamientos && causa.status === 401) setSinSesion(true)
      else setError(causa instanceof Error ? causa.message : 'No pudimos cargar tus reservas.')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cancelar = async () => {
    if (!porCancelar) return
    setCancelando(true)
    try {
      await cancelarMiReserva(porCancelar.id)
      setAviso('Reserva cancelada.')
      setPorCancelar(null)
      await cargar()
    } catch (causa) {
      setAviso(causa instanceof Error ? causa.message : 'No pudimos cancelar la reserva.')
      setPorCancelar(null)
    } finally {
      setCancelando(false)
    }
  }

  const tarjeta = (r: MiReservaAlojamientoDTO) => {
    const color = COLOR[r.estado] ?? COLOR['completed']!
    return (
      <article data-reserva={r.id} data-reserva-estado={r.estado} key={r.id} style={{ ...caja, display: 'grid', gap: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, overflowWrap: 'anywhere' }}>{r.alojamientoNombre}</h3>
          <span style={{ background: color.fondo, color: color.texto, borderRadius: 9999, padding: '2px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{ESTADO_RESERVA[r.estado] ?? r.estado}</span>
        </div>
        <p style={{ margin: 0, color: '#374151' }}>
          {fechaCorta(r.fechaInicio)} → {fechaCorta(r.fechaFin)} · {r.noches} {r.noches === 1 ? 'noche' : 'noches'} · {r.cantidadPersonas} {r.cantidadPersonas === 1 ? 'huésped' : 'huéspedes'}
        </p>
        <p style={{ margin: 0, color: '#4b5563', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>
          {r.direccion ? `${r.direccion}${r.zona ? ` · ${r.zona}` : ''}` : r.zona ?? 'Ubicación a confirmar'}
          {r.direccion ? ` · Entrada ${r.checkInHora} · Salida ${r.checkOutHora}` : ''}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <strong>Total: {pesos(r.precioFinalSnapshot)}</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link href={`/alojamientos/${r.alojamientoId}` as Route} style={{ ...boton, background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#111827', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Ver alojamiento
            </Link>
            {r.puedeCancelar ? (
              <button data-reserva-accion="cancelar" onClick={() => setPorCancelar(r)} style={{ ...boton, background: '#fff', border: '1px solid #dc2626', color: '#b91c1c' }} type="button">
                Cancelar reserva
              </button>
            ) : null}
          </div>
        </div>
      </article>
    )
  }

  const vigentes = (reservas ?? []).filter((r) => VIGENTES.includes(r.estado))
  const anteriores = (reservas ?? []).filter((r) => !VIGENTES.includes(r.estado))

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1rem' }}>
      <header>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', margin: 0 }}>Mis reservas</h1>
        <p style={{ color: '#4b5563', margin: '0.25rem 0 0' }}>Tus estadías en alojamientos de TUS.</p>
      </header>
      {aviso ? <p data-reservas="aviso" role="status" style={{ ...caja, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', margin: 0 }}>{aviso}</p> : null}
      {sinSesion ? (
        <div style={{ ...caja, textAlign: 'center' }}>
          <p style={{ marginTop: 0 }}>Iniciá sesión para ver tus reservas.</p>
          <a href={`/sign-in?returnTo=${encodeURIComponent('/alojamientos/reservas')}`} style={{ ...boton, background: '#ff5a00', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Iniciar sesión</a>
        </div>
      ) : error ? (
        <p role="alert" style={{ ...caja, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b', margin: 0 }}>{error}</p>
      ) : reservas === null ? (
        <p data-reservas="cargando">Cargando tus reservas…</p>
      ) : reservas.length === 0 ? (
        <div data-reservas="vacio" style={{ ...caja, textAlign: 'center' }}>
          <p style={{ marginTop: 0 }}>Todavía no reservaste ningún alojamiento.</p>
          <Link href={'/alojamientos' as Route} style={{ ...boton, background: '#ff5a00', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Buscar alojamiento</Link>
        </div>
      ) : (
        <>
          <section aria-labelledby="reservas-vigentes" style={{ display: 'grid', gap: '0.75rem' }}>
            <h2 id="reservas-vigentes" style={{ fontSize: '1.1rem', margin: 0 }}>Próximas y en curso</h2>
            {vigentes.length === 0 ? <p style={{ color: '#6b7280', margin: 0 }}>No tenés estadías por delante.</p> : vigentes.map(tarjeta)}
          </section>
          {anteriores.length > 0 ? (
            <section aria-labelledby="reservas-anteriores" style={{ display: 'grid', gap: '0.75rem' }}>
              <h2 id="reservas-anteriores" style={{ fontSize: '1.1rem', margin: 0 }}>Anteriores y canceladas</h2>
              {anteriores.map(tarjeta)}
            </section>
          ) : null}
        </>
      )}
      {porCancelar ? (
        <div aria-labelledby="cancelar-titulo" aria-modal="true" role="dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 60 }}>
          <div style={{ ...caja, maxWidth: 420, width: '100%' }}>
            <h2 id="cancelar-titulo" style={{ marginTop: 0, fontSize: '1.15rem' }}>¿Cancelar esta reserva?</h2>
            <p style={{ color: '#4b5563' }}>
              {porCancelar.alojamientoNombre}, del {fechaCorta(porCancelar.fechaInicio)} al {fechaCorta(porCancelar.fechaFin)}. Las fechas vuelven a quedar disponibles para otras personas.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button disabled={cancelando} onClick={() => setPorCancelar(null)} style={{ ...boton, background: '#f3f4f6', border: '1px solid #e5e7eb' }} type="button">Volver</button>
              <button data-reserva-accion="confirmar-cancelacion" disabled={cancelando} onClick={() => void cancelar()} style={{ ...boton, background: '#dc2626', border: 'none', color: '#fff' }} type="button">{cancelando ? 'Cancelando…' : 'Sí, cancelar'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
