'use client'

import { useEffect, useState } from 'react'

import type { SolicitudRecibidaPrestador } from '@factory/contracts'

import authStyles from '../auth/auth.module.css'
import { createDirectoryClient, privateImageUrl } from '../directory/directory-client'
import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { budgetLabel, timeAgoLabel, urgencyLabel } from '../home/requests-source'
import { categoryOf } from '../home/types'
import { useTusSession } from '../session/use-tus-session'
import type { TusWebSession } from '../../lib/tus-ui-contract'

const client = createDirectoryClient()
const RETURN_TO = '/prestador/solicitudes'

const ORIGINS: Record<string, string> = {
  web_assistant: 'Asistente TUS',
  web_directory: 'Buscar trabajador',
  whatsapp: 'WhatsApp TUS',
  web_publica: 'Mapa',
}

const ASSIGNMENT: Record<string, string> = {
  pendiente: 'Esperando tu respuesta',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada por el cliente',
}

// Requests clients sent to this provider. Accepting confirms the relationship; nothing is
// confirmed before that.
export function ProviderInbox(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [items, setItems] = useState<SolicitudRecibidaPrestador[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [working, setWorking] = useState<string | null>(null)

  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
    if (session.status !== 'authenticated') return
    client
      .inbox(session.session)
      .then((result) => setItems(result.items))
      .catch(() => {
        setItems([])
        setFailed(true)
      })
  }, [session])

  async function answer(item: SolicitudRecibidaPrestador, decision: 'aceptar' | 'rechazar') {
    if (session.status !== 'authenticated') return
    setWorking(item.id)
    try {
      const updated = await client.answer(session.session, item.id, decision)
      setItems((current) => (current ?? []).map((existing) => (existing.id === item.id ? updated : existing)))
    } catch {
      // Already answered or cancelled by the client: reload the real state.
      const fresh = await client.inbox(session.session).catch(() => null)
      if (fresh) setItems(fresh.items)
    } finally {
      setWorking(null)
    }
  }

  if (session.status !== 'authenticated' || items === null)
    return (
      <p aria-busy="true" className={styles.resultCount} role="status">
        Cargando solicitudes…
      </p>
    )
  if (failed)
    return (
      <p className={authStyles.formError} role="alert">
        No pudimos cargar tus solicitudes. Probá de nuevo en unos minutos.
      </p>
    )
  if (items.length === 0)
    return (
      <div className={styles.state} role="status">
        Todavía no recibiste solicitudes. Completá tu perfil público para aparecer en “Buscar trabajador”.
        <div className={styles.stateActions}>
          <a className={homeStyles.buttonSecondary} href="/prestador/perfil-publico">
            Editar mi perfil público
          </a>
        </div>
      </div>
    )

  return (
    <ul className={styles.grid} style={{ gridTemplateColumns: '1fr' }}>
      {items.map((item) => (
        <li className={styles.card} key={item.id}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
            <strong>{item.title}</strong>
            <span className={item.assignment === 'pendiente' ? styles.available : styles.muted}>{ASSIGNMENT[item.assignment] ?? item.assignment}</span>
          </div>
          {item.description ? <p style={{ margin: 0 }}>{item.description}</p> : null}
          <p className={styles.muted} style={{ fontSize: '0.9rem', margin: 0 }}>
            {categoryOf(item.category).label} · {item.requesterName} · {item.approximateArea} (zona aproximada) · {budgetLabel(item.budgetMax)} ·{' '}
            {urgencyLabel(item.urgency)} · {timeAgoLabel(item.createdAt)} · vía {ORIGINS[item.origin] ?? item.origin}
          </p>
          {item.images.length > 0 ? <PrivateImages paths={item.images} session={session.session} /> : null}
          {item.assignment === 'pendiente' ? (
            <div className={styles.cardActions}>
              <button className={homeStyles.buttonPrimary} disabled={working === item.id} onClick={() => void answer(item, 'aceptar')} type="button">
                Aceptar
              </button>
              <button className={homeStyles.buttonSecondary} disabled={working === item.id} onClick={() => void answer(item, 'rechazar')} type="button">
                Rechazar
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

// Photos of directed requests are private: fetched with the session and shown as blob URLs.
function PrivateImages({ paths, session }: { paths: string[]; session: TusWebSession }): React.ReactNode {
  const [urls, setUrls] = useState<(string | null)[]>([])
  useEffect(() => {
    let active = true
    const created: string[] = []
    void Promise.all(paths.map((path) => privateImageUrl(session, path))).then((result) => {
      result.forEach((url) => url && created.push(url))
      if (active) setUrls(result)
    })
    return () => {
      active = false
      created.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [paths, session])
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {urls.map((url, index) =>
        url ? (
          // eslint-disable-next-line @next/next/no-img-element -- private blob URL
          <img alt={`Foto ${index + 1} de la solicitud`} height={80} key={url} src={url} style={{ borderRadius: 10, objectFit: 'cover' }} width={80} />
        ) : (
          <span className={styles.muted} key={index} style={{ fontSize: '0.85rem' }}>
            Foto no disponible
          </span>
        )
      )}
    </div>
  )
}
