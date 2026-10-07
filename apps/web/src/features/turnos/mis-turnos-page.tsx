'use client'

import { FotosTurno } from './fotos-turno'
import type { Route } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { etiquetaEstadoTurno, etiquetaSenaTurno, formatearPesos, type DetalleTurno } from '@factory/contracts'

import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { useTusSession } from '../session/use-tus-session'
import { diaTurno, horaTurno, turnosApi } from '../../lib/tus-turnos-client'
import { claseEstadoTurno } from './estado-turno'

const RETURN_TO = '/mis-turnos'

const EXPLICACION: Record<string, string> = {
  pending: 'Solicitud enviada. Queda pendiente hasta que el prestador la acepte.',
  awaiting_payment: 'El prestador aceptó tu solicitud. Para confirmar definitivamente el turno tenés que abonar la seña.',
  rejected: 'El prestador no pudo tomar esta solicitud. Podés elegir otro horario u otro profesional.',
  expired: 'La solicitud venció: no fue respondida o la seña no se abonó a tiempo. Podés pedir otro horario.',
  cancelled: 'Este turno fue cancelado.',
}

// What the state means for THIS turno. "Confirmed" is said only for a confirmed turno: by its
// paid deposit, or by the acceptance when it had no deposit.
function explicacion(turno: DetalleTurno): string | null {
  const pagada = turno.sena?.estado === 'paid'
  if (turno.estado === 'confirmed') return pagada ? 'El pago de la seña fue aprobado. ¡Tu turno quedó confirmado!' : 'El prestador aceptó tu solicitud: el turno está confirmado.'
  if (turno.estado === 'awaiting_payment' && turno.sena?.estado === 'unavailable') return 'El prestador aceptó tu solicitud, pero el pago online de la seña no está disponible en este momento. Probá más tarde.'
  if ((turno.estado === 'expired' || turno.estado === 'cancelled') && pagada) return 'Recibimos el pago de la seña cuando el turno ya no estaba vigente. TUS lo va a revisar para reintegrarlo.'
  return EXPLICACION[turno.estado] ?? null
}

const venceEl = (iso: string): string => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })

// Turnos of the signed-in person: the requests waiting for the provider, the confirmed ones and
// the history. The state shown is the one the API holds; this page never decides it.
export function MisTurnosPage(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [turnos, setTurnos] = useState<DetalleTurno[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<string | null>(null)
  const [pagando, setPagando] = useState<string | null>(null)
  // Back from Mercado Pago. The return never confirms anything: the turno is confirmed only when
  // TUS receives the verified notification, so the list is read again a few times.
  const [retornoPago, setRetornoPago] = useState(false)

  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }, [session.status])

  const cargar = useCallback(() => {
    setError(null)
    turnosApi
      .misTurnos()
      .then(setTurnos)
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : 'No pudimos cargar tus turnos.'))
  }, [])

  useEffect(() => {
    if (session.status === 'authenticated') cargar()
  }, [session.status, cargar])

  useEffect(() => {
    if (session.status !== 'authenticated' || new URLSearchParams(window.location.search).get('pago') !== 'retorno') return
    setRetornoPago(true)
    window.history.replaceState(null, '', RETURN_TO)
    const esperas = [3000, 8000, 15000].map((ms) => window.setTimeout(cargar, ms))
    return () => esperas.forEach((id) => window.clearTimeout(id))
  }, [session.status, cargar])

  async function cancelar(turno: DetalleTurno) {
    setCancelando(turno.id)
    setError(null)
    try {
      await turnosApi.cancelarMiTurno(turno.id)
      cargar()
    } catch (causa: unknown) {
      setError(causa instanceof Error ? causa.message : 'No pudimos cancelar el turno.')
    } finally {
      setCancelando(null)
    }
  }

  async function pagar(turno: DetalleTurno) {
    setPagando(turno.id)
    setError(null)
    try {
      const checkout = await turnosApi.pagarSena(turno.id)
      window.location.assign(checkout.checkoutUrl)
    } catch (causa: unknown) {
      setError(causa instanceof Error ? causa.message : 'No pudimos preparar el pago de la seña.')
      setPagando(null)
    }
  }

  return (
    <div className={styles.narrow}>
      <h1 className={styles.title}>Mis turnos</h1>
      <p className={styles.subtitle}>Solicitás el turno, el prestador lo acepta y el pago de la seña lo confirma.</p>
      <div className={styles.stateActions} style={{ justifyContent: 'flex-start', margin: '16px 0 8px' }}>
        <a className={homeStyles.buttonPrimary} href="/trabajadores">
          Buscar trabajador
        </a>
        <a className={homeStyles.buttonSecondary} href="/mis-solicitudes">
          Mis solicitudes
        </a>
      </div>

      {error ? (
        <p className={styles.state} role="alert">
          {error}
        </p>
      ) : null}
      {retornoPago ? (
        <p className={styles.state} data-retorno-pago role="status">
          Si completaste el pago, el turno se confirma cuando Mercado Pago lo acredita. Puede tardar unos segundos; el estado de abajo se actualiza solo.
        </p>
      ) : null}

      {session.status !== 'authenticated' ? (
        <p aria-busy="true" className={styles.resultCount} role="status">
          {session.status === 'unavailable' ? 'No pudimos conectar con TUS. Probá de nuevo en unos minutos.' : 'Verificando tu sesión…'}
        </p>
      ) : turnos === null ? (
        error ? null : <div aria-busy="true" aria-label="Cargando tus turnos" className={styles.skeleton} />
      ) : turnos.length === 0 ? (
        <p className={styles.state}>Todavía no solicitaste ningún turno.</p>
      ) : (
        <ul aria-label="Mis turnos" className={styles.turnoList} style={{ listStyle: 'none', margin: '16px 0 0', padding: 0 }}>
          {turnos.map((turno) => {
            const servicio = [turno.oficioNombre, turno.tarifaNombre].filter((nombre, indice, lista) => nombre && lista.indexOf(nombre) === indice).join(' · ') || 'Turno'
            const futuro = Date.parse(turno.inicio) > Date.now()
            const detalle = explicacion(turno)
            return (
              <li className={`${styles.panel} ${styles.turnoCard} ${turno.estado === 'pending' ? styles.turnoCardNew : ''}`} data-turno={turno.estado} data-turno-id={turno.id} key={turno.id}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong>
                    {servicio} — {diaTurno(turno.inicio)} — {horaTurno(turno.inicio)}
                  </strong>
                  <span className={styles.muted}>
                    Con <Link href={`/trabajadores/${encodeURIComponent(turno.prestadorId)}` as Route}>{turno.prestadorNombre}</Link> · {turno.duracionMinutos} min
                  </span>
                  <span>
                    Estado: <span className={claseEstadoTurno(turno.estado)}>{etiquetaEstadoTurno(turno.estado)}</span>
                  </span>
                  {turno.precioFinal != null && turno.precioFinal > 0 ? (
                    <span data-turno-cobro>
                      Precio: <strong>{formatearPesos(turno.precioFinal)}</strong>
                      {turno.sena ? (
                        <>
                          {' '}
                          · Seña: <strong>{formatearPesos(turno.sena.monto)}</strong> ({etiquetaSenaTurno(turno.sena.estado)})
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {detalle ? <span className={styles.muted} style={{ fontSize: '0.9rem' }}>{detalle}</span> : null}
                  <FotosTurno cantidad={turno.imagenes ?? 0} puedeAgregar={turno.estado === 'pending' && futuro} turnoId={turno.id} />
                  {turno.estado === 'awaiting_payment' && turno.expiraEn ? (
                    <span className={styles.muted} style={{ fontSize: '0.9rem' }}>Tenés tiempo para abonarla hasta el {venceEl(turno.expiraEn)}; después el horario se libera.</span>
                  ) : null}
                </div>
                {(turno.estado === 'pending' || turno.estado === 'awaiting_payment' || turno.estado === 'confirmed') && futuro ? (
                  <div className={styles.turnoActions}>
                    {turno.estado === 'awaiting_payment' && turno.sena?.estado === 'pending' ? (
                      <button className={homeStyles.buttonPrimary} disabled={pagando === turno.id} onClick={() => void pagar(turno)} type="button">
                        {pagando === turno.id ? 'Preparando pago…' : `Pagar seña — ${formatearPesos(turno.sena.monto)}`}
                      </button>
                    ) : null}
                    <button className={homeStyles.buttonSecondary} disabled={cancelando === turno.id} onClick={() => void cancelar(turno)} type="button">
                      {cancelando === turno.id ? 'Cancelando…' : turno.estado === 'pending' ? 'Retirar solicitud' : 'Cancelar turno'}
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
