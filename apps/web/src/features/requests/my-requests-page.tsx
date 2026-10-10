'use client'

import layout from '../layout/layout.module.css'
import { useEffect } from 'react'

import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { useAccountView } from '../session/use-account-view'
import { useTusSession } from '../session/use-tus-session'
import { isPlatformOnly } from '../../lib/tus-auth-client'
import { MyRequests } from './my-requests'
import { HelpLink } from '../help/help-link'

const RETURN_TO = '/mis-solicitudes'

export function MyRequestsPage(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const account = useAccountView()
  const platformOnly = account.status === 'signed-in' && isPlatformOnly(account.capabilities)
  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }, [session.status])

  return (
    <div className={`${styles.narrow} ${layout.dashboard}`}>
      <h1 className={styles.title}>Mis solicitudes</h1>
      {platformOnly ? null : (
        <>
          <a href="/mis-turnos">Mis turnos</a> · <a href="/trabajos">Mis trabajos</a>
        </>
      )}
      <p className={styles.subtitle}>El estado real de cada pedido. Una solicitud enviada a un profesional queda pendiente hasta que la acepte.</p>
      <HelpLink href="/ayuda/solicitudes">¿Cómo funcionan las solicitudes?</HelpLink>
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
