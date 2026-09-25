'use client'

import { useCallback, useEffect, useState } from 'react'

import type { PostulacionPrestador } from '@factory/contracts'

import authStyles from '../auth/auth.module.css'
import { DirectoryRequestError, createDirectoryClient } from '../directory/directory-client'
import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { budgetLabel, getRequestsSource, urgencyLabel } from '../home/requests-source'
import { CATEGORIES, categoryOf, type CategoryId, type MapRequest } from '../home/types'
import { useTusSession } from '../session/use-tus-session'
import type { TusWebSession } from '../../lib/tus-ui-contract'

const client = createDirectoryClient()
const RETURN_TO = '/prestador/solicitudes'

const STATUS: Record<PostulacionPrestador['status'], string> = {
  pendiente: 'Esperando la decisión del cliente',
  aceptada: 'El cliente te eligió',
  rechazada: 'El cliente eligió a otro profesional',
  retirada: 'Te retiraste',
}

const APPLY_ERRORS: Record<string, string> = {
  ALREADY_APPLIED: 'Ya te postulaste a esta solicitud.',
  REQUEST_FULL: 'Esta solicitud ya no recibe más postulaciones.',
  SELF_REQUEST: 'No podés postularte a tu propia solicitud.',
  PROVIDER_NOT_AVAILABLE: 'Para postularte, completá y publicá tu perfil público de prestador.',
  INVALID_REQUEST: 'El mensaje admite hasta 300 caracteres, sin teléfonos, emails ni links.',
  NOT_FOUND: 'La solicitud ya no está abierta.',
}

// Public requests from the map. Any provider can offer to help, even outside their own trade; the
// client sees who applied and decides. Applying confirms nothing.
export function ProviderOpenRequests(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [category, setCategory] = useState<CategoryId | ''>('')
  const [requests, setRequests] = useState<MapRequest[] | null>(null)
  const [applications, setApplications] = useState<PostulacionPrestador[]>([])
  const [failed, setFailed] = useState(false)

  const authenticated = session.status === 'authenticated' ? session.session : null

  const reloadApplications = useCallback(async (current: TusWebSession) => {
    const result = await client.myApplications(current).catch(() => null)
    if (result) setApplications(result.items)
  }, [])

  useEffect(() => {
    setRequests(null)
    setFailed(false)
    getRequestsSource()
      .list({ category })
      .then(setRequests)
      .catch(() => {
        setRequests([])
        setFailed(true)
      })
  }, [category])

  useEffect(() => {
    if (authenticated) void reloadApplications(authenticated)
  }, [authenticated, reloadApplications])

  const appliedTo = new Map(applications.map((application) => [application.request.id, application]))

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <section aria-labelledby="abiertas-titulo" id="abiertas">
        <h2 className={styles.title} id="abiertas-titulo" style={{ fontSize: '1.4rem' }}>
          Solicitudes abiertas
        </h2>
        <p className={styles.subtitle}>Clientes que publicaron lo que necesitan. Podés ofrecerte aunque no sea tu rubro; el cliente elige a quién acepta.</p>
        <label style={{ display: 'grid', gap: 4, margin: '12px 0', maxWidth: 280 }}>
          <span className={styles.muted}>Rubro</span>
          <select className={styles.select} onChange={(event) => setCategory(event.target.value as CategoryId | '')} value={category}>
            <option value="">Todos los rubros</option>
            {CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {requests === null ? (
          <p aria-busy="true" className={styles.resultCount} role="status">
            Cargando solicitudes…
          </p>
        ) : failed ? (
          <p className={authStyles.formError} role="alert">
            No pudimos cargar las solicitudes. Probá de nuevo en unos minutos.
          </p>
        ) : requests.length === 0 ? (
          <div className={styles.state} role="status">
            No hay solicitudes abiertas {category ? `de ${categoryOf(category).label}` : ''} en este momento.
          </div>
        ) : (
          <ul className={styles.grid} style={{ gridTemplateColumns: '1fr' }}>
            {requests.map((request) => (
              <OpenRequest
                application={appliedTo.get(request.id) ?? null}
                key={request.id}
                onApplied={(application) => setApplications((current) => [application, ...current])}
                request={request}
                session={authenticated}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="postulaciones-titulo">
        <h2 className={styles.title} id="postulaciones-titulo" style={{ fontSize: '1.4rem' }}>
          Mis postulaciones
        </h2>
        {applications.length === 0 ? (
          <p className={styles.muted}>Todavía no te postulaste a ninguna solicitud.</p>
        ) : (
          <ul className={styles.grid} style={{ gridTemplateColumns: '1fr' }}>
            {applications.map((application) => (
              <li className={styles.card} key={application.id}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  <strong>{application.request.title}</strong>
                  <span className={application.status === 'aceptada' ? styles.available : styles.muted}>{STATUS[application.status]}</span>
                </div>
                <p className={styles.muted} style={{ fontSize: '0.9rem', margin: 0 }}>
                  {categoryOf(application.request.category).label} · {application.request.requesterName} · {application.request.approximateArea} (zona aproximada) ·{' '}
                  {budgetLabel(application.request.budgetMax)} · {urgencyLabel(application.request.urgency)}
                </p>
                {application.message ? <p style={{ margin: 0 }}>Tu mensaje: “{application.message}”</p> : null}
                {application.status === 'aceptada' ? (
                  <p style={{ margin: 0 }}>Ya aparece en tus solicitudes recibidas como aceptada.</p>
                ) : null}
                {application.status === 'pendiente' && authenticated ? (
                  <div className={styles.cardActions}>
                    <button
                      className={homeStyles.buttonSecondary}
                      onClick={() =>
                        void client
                          .withdraw(authenticated, application.id)
                          .catch(() => null)
                          .then(() => reloadApplications(authenticated))
                      }
                      type="button"
                    >
                      Retirarme
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function OpenRequest({
  request,
  application,
  session,
  onApplied,
}: {
  request: MapRequest
  application: PostulacionPrestador | null
  session: TusWebSession | null
  onApplied: (application: PostulacionPrestador) => void
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const category = categoryOf(request.category)

  async function apply() {
    if (!session) {
      window.location.assign(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
      return
    }
    setWorking(true)
    setError(null)
    try {
      onApplied(await client.apply(session, request.id, message))
      setOpen(false)
    } catch (caught) {
      const code = caught instanceof DirectoryRequestError ? caught.code : null
      setError((code && APPLY_ERRORS[code]) || 'No pudimos enviar tu postulación. Probá de nuevo en unos minutos.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <li className={styles.card}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        <strong>{request.title}</strong>
        <span style={{ color: category.color, fontWeight: 600 }}>{category.label}</span>
      </div>
      {request.description ? <p style={{ margin: 0 }}>{request.description}</p> : null}
      <p className={styles.muted} style={{ fontSize: '0.9rem', margin: 0 }}>
        {request.requesterName ? `${request.requesterName} · ` : ''}
        {request.approximateLocation.label} (zona aproximada)
        {request.budgetLabel ? ` · ${request.budgetLabel}` : ''}
        {request.urgencyLabel ? ` · ${request.urgencyLabel}` : ''}
        {request.createdAtLabel ? ` · ${request.createdAtLabel}` : ''}
      </p>
      {error ? (
        <p className={authStyles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {application ? (
        <span className={styles.muted}>{STATUS[application.status]}</span>
      ) : open ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className={styles.muted}>Mensaje para el cliente (opcional)</span>
            <textarea
              maxLength={300}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ej.: Puedo ir mañana a la tarde. Tengo experiencia en arreglos de este tipo."
              rows={3}
              style={{ borderRadius: 10, font: 'inherit', padding: 10 }}
              value={message}
            />
          </label>
          <div className={styles.cardActions}>
            <button className={homeStyles.buttonPrimary} disabled={working} onClick={() => void apply()} type="button">
              {working ? 'Enviando…' : 'Enviar postulación'}
            </button>
            <button className={homeStyles.buttonSecondary} disabled={working} onClick={() => setOpen(false)} type="button">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.cardActions}>
          <button className={homeStyles.buttonPrimary} onClick={() => setOpen(true)} type="button">
            Postularme
          </button>
        </div>
      )}
    </li>
  )
}
