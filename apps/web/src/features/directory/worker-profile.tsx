'use client'

import { useQuery } from '@tanstack/react-query'
import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import homeStyles from '../home/home.module.css'
import type { CategoryId } from '../home/types'
import { RequestForm } from '../requests/request-form'
import { useTusSession } from '../session/use-tus-session'
import { DAY_NAMES, DirectoryRequestError, createDirectoryClient } from './directory-client'
import styles from './directory.module.css'

const client = createDirectoryClient()
const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

// Public profile: only what the provider chose to publish plus facts TUS knows (verification,
// completed jobs, published services and hours). "Solicitar servicio" creates the same TUS request
// as the assistant, directed to this worker; it stays pending until the worker accepts it.
export function WorkerProfile({ id }: { id: string }): React.ReactNode {
  const path = `/trabajadores/${encodeURIComponent(id)}`
  const session = useTusSession(path)
  const [requesting, setRequesting] = useState(false)
  const [sent, setSent] = useState<{ warning: string | null } | null>(null)
  const profile = useQuery({ queryKey: ['trabajador', id], queryFn: () => client.profile(id), retry: (count, error) => !(error instanceof DirectoryRequestError && error.status === 404) && count < 2 })

  // Back from sign-in with ?solicitar=1: reopen the request form without losing the worker.
  useEffect(() => {
    if (session.status === 'authenticated' && new URLSearchParams(window.location.search).get('solicitar') === '1') {
      setRequesting(true)
      window.history.replaceState(null, '', path)
    }
  }, [session.status, path])

  function request() {
    if (session.status === 'authenticated') {
      setRequesting(true)
      return
    }
    window.location.assign(`/sign-in?returnTo=${encodeURIComponent(`${path}?solicitar=1`)}`)
  }

  if (profile.isPending)
    return (
      <div className={styles.narrow}>
        <div aria-busy="true" aria-label="Cargando perfil" className={styles.skeleton} />
      </div>
    )
  if (profile.isError || !profile.data) {
    const notFound = profile.error instanceof DirectoryRequestError && profile.error.status === 404
    return (
      <div className={styles.narrow}>
        <div className={styles.state} role="alert">
          {notFound ? 'Este profesional no está disponible en este momento.' : 'No pudimos cargar el perfil. Probá de nuevo en unos minutos.'}
          <div className={styles.stateActions}>
            <Link className={homeStyles.buttonSecondary} href="/trabajadores">
              Ver otros profesionales
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const worker = profile.data
  return (
    <div className={styles.narrow}>
      <Link className={styles.back} href="/trabajadores">
        ← Volver a Buscar trabajador
      </Link>
      <div className={styles.profileHead}>
        <span aria-hidden="true" className={`${styles.avatar} ${styles.avatarLarge}`}>
          {worker.initials}
        </span>
        <div>
          <h1 className={styles.title}>{worker.displayName}</h1>
          <p className={styles.profession}>
            {worker.profession.title} · {worker.approximateArea} (zona aproximada)
          </p>
        </div>
      </div>

      <div className={styles.profileGrid}>
        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <section aria-labelledby="sobre" className={styles.panel}>
            <h2 className={styles.panelTitle} id="sobre">
              Sobre {worker.displayName.split(' ')[0]}
            </h2>
            <p className={worker.description ? undefined : styles.muted} style={{ lineHeight: 1.55, margin: 0 }}>
              {worker.description ?? 'Todavía no agregó una descripción.'}
            </p>
          </section>

          <section aria-labelledby="servicios" className={styles.panel}>
            <h2 className={styles.panelTitle} id="servicios">
              Servicios publicados
            </h2>
            {worker.services.length === 0 ? (
              <p className={styles.muted} style={{ margin: 0 }}>
                Todavía no publicó servicios con precio y horarios. Igual podés enviarle una solicitud.
              </p>
            ) : (
              <ul className={styles.services}>
                {worker.services.map((service) => (
                  <li className={styles.service} key={service.listingId}>
                    <span>
                      <strong>{service.name}</strong>
                      <span className={styles.muted} style={{ display: 'block', fontSize: '0.9rem' }}>
                        {service.days.length > 0 ? service.days.map((day) => DAY_NAMES[day] ?? '').join(' · ') : 'Sin horarios publicados'}
                      </span>
                    </span>
                    <span>{service.price ? `$${PESOS.format(service.price)}` : 'A presupuestar'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside aria-label="Resumen" className={styles.panel} style={{ alignSelf: 'start', display: 'grid', gap: 14 }}>
          <ul className={styles.facts}>
            {worker.verified ? <li className={styles.verified}>✓ Identidad verificada por TUS</li> : <li className={styles.muted}>Identidad sin verificar</li>}
            <li>{worker.completedJobs > 0 ? `${worker.completedJobs} trabajos realizados en TUS` : 'Todavía sin trabajos en TUS'}</li>
            {worker.yearsOfExperience !== null ? <li>{worker.yearsOfExperience} años de experiencia (declarados)</li> : null}
            <li className={worker.availability.status === 'atiende_hoy' ? styles.available : styles.muted}>{worker.availability.label}</li>
            <li className={styles.muted}>Sin reseñas todavía</li>
          </ul>
          {sent ? (
            <p className={styles.notice} role="status">
              Enviamos tu solicitud a {worker.displayName}. Queda pendiente hasta que la acepte. Seguí el estado en{' '}
              <Link href={'/mis-solicitudes' as Route}>Mis solicitudes</Link>.{sent.warning ? ` ${sent.warning}` : ''}
            </p>
          ) : !requesting ? (
            <button className={homeStyles.buttonPrimary} onClick={request} type="button">
              Solicitar servicio
            </button>
          ) : null}
          {session.status === 'guest' && !requesting ? <p className={`${styles.muted}`} style={{ fontSize: '0.85rem', margin: 0 }}>Te vamos a pedir que inicies sesión y volvés acá.</p> : null}
        </aside>
      </div>

      {requesting && !sent && session.status === 'authenticated' ? (
        <section aria-labelledby="solicitar" className={styles.panel} style={{ marginTop: 24 }}>
          <h2 className={styles.panelTitle} id="solicitar">
            Solicitar servicio a {worker.displayName}
          </h2>
          <RequestForm
            lockedCategory={worker.profession.id as CategoryId}
            onSent={(_request, warning) => {
              setSent({ warning })
              setRequesting(false)
            }}
            origin="web_directory"
            provider={{ id: worker.id, displayName: worker.displayName }}
            session={session.session}
            submitLabel="Enviar solicitud"
          />
        </section>
      ) : null}
    </div>
  )
}
