'use client'

import { useRef, useState } from 'react'

import type { TusWebSession } from '../../lib/tus-ui-contract'
import authStyles from '../auth/auth.module.css'
import { Avatar } from '../directory/avatar'
import { DirectoryRequestError, createDirectoryClient } from '../directory/directory-client'
import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { GENERIC, MESSAGES, PHOTO_TYPES, photoProblem } from './profile-photo-rules'

const client = createDirectoryClient()

// The provider's own photo: upload, replace or remove. The avatar falls back to the initials.
export function ProfilePhoto({
  session,
  initials,
  photoUrl,
  visible,
  onChange,
}: {
  session: TusWebSession
  initials: string
  photoUrl: string | null
  visible: boolean
  onChange: (photoUrl: string | null) => void
}): React.ReactNode {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  async function run(action: () => Promise<{ photoUrl: string | null }>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      onChange((await action()).photoUrl)
      setMessage({ text: done, error: false })
    } catch (error) {
      setMessage({ text: (error instanceof DirectoryRequestError && error.code && MESSAGES[error.code]) || GENERIC, error: true })
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const problem = photoProblem(file)
    if (problem) {
      setMessage({ text: problem, error: true })
      event.target.value = ''
      return
    }
    void run(() => client.uploadPhoto(session, file), 'Foto guardada.')
  }

  return (
    <section aria-labelledby="perfil-foto-titulo" className={styles.photoEditor}>
      {/* `key` remounts the avatar when the photo changes, so a previous load error is forgotten. */}
      <Avatar initials={initials} key={photoUrl ?? 'sin-foto'} photoUrl={photoUrl} size="lg" />
      <div className={styles.photoEditorBody}>
        <h2 className={styles.photoEditorTitle} id="perfil-foto-titulo">Foto de perfil</h2>
        <p className={styles.muted}>JPG, PNG o WEBP de hasta 2 MB. Sin foto mostramos tus iniciales.{photoUrl && !visible ? ' Se va a ver cuando tu perfil esté visible.' : ''}</p>
        <div className={styles.photoEditorActions}>
          <label className={`${homeStyles.buttonSecondary} ${styles.photoEditorPick}`} htmlFor="perfil-foto">
            {busy ? 'Guardando…' : photoUrl ? 'Cambiar foto' : 'Subir foto'}
          </label>
          <input accept={PHOTO_TYPES.join(',')} className={styles.photoEditorInput} disabled={busy} id="perfil-foto" onChange={choose} ref={input} type="file" />
          {photoUrl ? (
            <button className={homeStyles.buttonSecondary} disabled={busy} onClick={() => void run(() => client.removePhoto(session), 'Foto quitada.')} type="button">
              Quitar foto
            </button>
          ) : null}
        </div>
        <p aria-live="polite" className={message?.error ? authStyles.formError : styles.muted} role={message?.error ? 'alert' : 'status'}>
          {message?.text ?? ''}
        </p>
      </div>
    </section>
  )
}
