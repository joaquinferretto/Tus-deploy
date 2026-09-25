'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import styles from '../auth/auth.module.css'
import { useTusSession } from '../session/use-tus-session'
import { MyRequests } from './my-requests'
import { RequestForm } from './request-form'

const RETURN_TO = '/publicar'

// Public request (shown on the home map). Directed requests use the same form from a worker
// profile or the assistant.
export function PublishRequest(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [sent, setSent] = useState<{ warning: string | null } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [formKey, setFormKey] = useState(0)

  // Publishing needs a TUS session: without one, go to sign-in and come back here.
  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }, [session.status])

  if (session.status !== 'authenticated')
    return (
      <p aria-busy="true" className={styles.notice} role="status">
        {session.status === 'unavailable' ? 'No pudimos conectar con TUS. Probá de nuevo en unos minutos.' : 'Verificando tu sesión…'}
      </p>
    )

  return (
    <>
      {sent ? (
        <div className={styles.success} role="status">
          ¡Listo! Tu solicitud ya aparece en el mapa. <Link href="/">Ver el mapa</Link>
          {sent.warning ? <span style={{ display: 'block', marginTop: 4 }}>{sent.warning}</span> : null}
        </div>
      ) : null}

      <RequestForm
        key={formKey}
        onSent={(_request, warning) => {
          setSent({ warning })
          setRefreshKey((value) => value + 1)
          setFormKey((value) => value + 1)
        }}
        origin="web_publica"
        session={session.session}
        submitLabel="Publicar solicitud"
      />

      <section aria-labelledby="mis-solicitudes" style={{ marginTop: 32 }}>
        <h2 className={styles.legend} id="mis-solicitudes" style={{ fontSize: '1.05rem' }}>
          Mis solicitudes
        </h2>
        <MyRequests refreshKey={refreshKey} session={session.session} />
      </section>
    </>
  )
}
