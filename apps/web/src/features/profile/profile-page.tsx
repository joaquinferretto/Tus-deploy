'use client'

import { useEffect, useState } from 'react'

import authStyles from '../auth/auth.module.css'
import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { useTusSession } from '../session/use-tus-session'
import { createTusWebAuthClient } from '../../lib/tus-auth-client'
import { createProfileClient, validDisplayName, type OwnAccount } from './profile-client'

const RETURN_TO = '/mi-perfil'

// "Mi perfil": account data, the name other people see ("Laura M.") and shortcuts to what the
// user does in TUS as a client and, if they offer services, as a provider.
export function ProfilePage(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [account, setAccount] = useState<OwnAccount | null>(null)
  const [failed, setFailed] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
    if (session.status !== 'authenticated') return
    createProfileClient(session.session)
      .account()
      .then((result) => {
        setAccount(result)
        setName(result.displayName)
      })
      .catch(() => setFailed(true))
  }, [session])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (session.status !== 'authenticated' || !account) return
    if (!validDisplayName(name)) {
      setNotice({ kind: 'error', text: 'Escribí tu nombre (entre 2 y 60 caracteres).' })
      return
    }
    setSaving(true)
    const updated = await createProfileClient(session.session).rename(account.id, name.trim())
    setSaving(false)
    if (updated) {
      setAccount(updated)
      setNotice({ kind: 'ok', text: 'Guardamos tu nombre.' })
    } else setNotice({ kind: 'error', text: 'No pudimos guardar el cambio. Probá de nuevo en unos minutos.' })
  }

  async function signOut() {
    await createTusWebAuthClient()
      .signOut()
      .catch(() => undefined)
    window.location.assign('/')
  }

  if (failed || session.status === 'unavailable')
    return (
      <div className={styles.narrow}>
        <p className={authStyles.formError} role="alert">
          No pudimos cargar tu perfil. Probá de nuevo en unos minutos.
        </p>
      </div>
    )
  if (!account)
    return (
      <div className={styles.narrow}>
        <p aria-busy="true" className={styles.resultCount} role="status">
          Cargando tu perfil…
        </p>
      </div>
    )

  const publicName = shortName(account.displayName)
  return (
    <div className={styles.narrow}>
      <h1 className={styles.title}>Mi perfil</h1>
      <p className={styles.subtitle}>Tus datos de cuenta. Tu email nunca se muestra a otros usuarios.</p>

      <section className={styles.card} style={{ marginTop: 20 }}>
        <p style={{ margin: 0 }}>
          <strong>Email:</strong> {account.email}{' '}
          <span className={account.emailVerifiedAt ? styles.available : styles.muted}>{account.emailVerifiedAt ? '· verificado' : '· sin verificar'}</span>
        </p>
        <form onSubmit={(event) => void save(event)} style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <strong>Nombre</strong>
            <input
              autoComplete="name"
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              style={{ border: '1px solid #d9dde4', borderRadius: 10, font: 'inherit', padding: 10 }}
              value={name}
            />
          </label>
          <span className={styles.muted} style={{ fontSize: '0.9rem' }}>
            En tus solicitudes otros ven: <strong>{publicName}</strong>
          </span>
          {notice ? (
            <p className={notice.kind === 'ok' ? styles.available : authStyles.formError} role={notice.kind === 'ok' ? 'status' : 'alert'} style={{ margin: 0 }}>
              {notice.text}
            </p>
          ) : null}
          <div className={styles.cardActions}>
            <button className={homeStyles.buttonPrimary} disabled={saving || name.trim() === account.displayName} type="submit">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.card} style={{ marginTop: 16 }}>
        <strong>Como cliente</strong>
        <div className={styles.cardActions}>
          <a className={homeStyles.buttonSecondary} href="/mis-solicitudes">
            Mis solicitudes y postulantes
          </a>
          <a className={homeStyles.buttonSecondary} href="/publicar">
            Publicar una solicitud
          </a>
        </div>
        <strong style={{ marginTop: 8 }}>Como prestador</strong>
        <div className={styles.cardActions}>
          <a className={homeStyles.buttonSecondary} href="/prestador/solicitudes">
            Solicitudes y postulaciones
          </a>
          <a className={homeStyles.buttonSecondary} href="/prestador/perfil-publico">
            Mi perfil público
          </a>
        </div>
      </section>

      <div className={styles.cardActions} style={{ marginTop: 16 }}>
        <button className={homeStyles.buttonSecondary} onClick={() => void signOut()} type="button">
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

// Mirrors the API's public name ("Laura Martínez" -> "Laura M.").
function shortName(displayName: string): string {
  const [first = '', last = ''] = displayName.trim().split(/\s+/u)
  if (!first) return 'Vecino/a'
  return last ? `${first.slice(0, 20)} ${last[0]!.toUpperCase()}.` : first.slice(0, 20)
}
