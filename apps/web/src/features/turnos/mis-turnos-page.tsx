'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { etiquetaEstadoTurno, type DetalleTurno } from '@factory/contracts'

import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { useTusSession } from '../session/use-tus-session'
import { diaTurno, horaTurno, turnosApi } from '../../lib/tus-turnos-client'
import { claseEstadoTurno } from './estado-turno'

const RETURN_TO = '/mis-turnos'

const EXPLICACION: Record<string, string> = {
  pending: 'Le enviamos la solicitud al prestador. El turno quedará confirmado cuando la acepte.',
  confirmed: 'El prestador aceptó tu solicitud: el turno está confirmado.',
  rejected: 'El prestador no pudo tomar esta solicitud. Podés elegir otro horario u otro profesional.',
  expired: 'El prestador no respondió a tiempo y la solicitud venció. Podés pedir otro horario.',
  cancelled: 'Este turno fue cancelado.',
}

// Turnos of the signed-in person: the requests waiting for the provider, the confirmed ones and
// the history. The state shown is the one the API holds; this page never decides it.
export function MisTurnosPage(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [turnos, setTurnos] = useState<DetalleTurno[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<string | null>(null)

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

  return (
    <div className={styles.narrow}>
      <h1 className={styles.title}>Mis turnos</h1>
      <p className={styles.subtitle}>Un turno que solicitás queda pendiente hasta que el prestador lo confirma.</p>
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
            const servicio = turno.oficioNombre ?? turno.tarifaNombre ?? 'Turno'
            const futuro = Date.parse(turno.inicio) > Date.now()
            return (
              <li className={`${styles.panel} ${styles.turnoCard} ${turno.estado === 'pending' ? styles.turnoCardNew : ''}`} data-turno={turno.estado} key={turno.id}>
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
                  {EXPLICACION[turno.estado] ? <span className={styles.muted} style={{ fontSize: '0.9rem' }}>{EXPLICACION[turno.estado]}</span> : null}
                </div>
                {(turno.estado === 'pending' || turno.estado === 'confirmed') && futuro ? (
                  <div className={styles.turnoActions}>
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
