'use client'

import { useEffect } from 'react'

import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { useTusSession } from '../session/use-tus-session'
import { MyRequests } from './my-requests'

const RETURN_TO = '/mis-solicitudes'

export function MyRequestsPage(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }, [session.status])

  return (
    <div className={styles.narrow}>
      <h1 className={styles.title}>Mis solicitudes</h1>
      <p className={styles.subtitle}>El estado real de cada pedido. Una solicitud enviada a un profesional queda pendiente hasta que la acepte.</p>
      <div className={styles.stateActions} style={{ justifyContent: 'flex-start', margin: '16px 0 8px' }}>
        <a className={homeStyles.buttonPrimary} href="/asistente">
          Nueva búsqueda
        </a>
        <a className={homeStyles.buttonSecondary} href="/trabajadores">
          Buscar trabajador
        </a>
      </div>
      {session.status === 'authenticated' ? (
        <MyRequests session={session.session} />
      ) : (
        <p aria-busy="true" className={styles.resultCount} role="status">
          {session.status === 'unavailable' ? 'No pudimos conectar con TUS. Probá de nuevo en unos minutos.' : 'Verificando tu sesión…'}
        </p>
      )}
    </div>
  )
}
