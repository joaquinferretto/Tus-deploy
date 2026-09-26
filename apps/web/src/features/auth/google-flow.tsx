'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { createTusWebAuthClient } from '@/lib/tus-auth-client'
import { FormError, RoleIntentSelector, TextField } from './auth-fields'
import { destinationFor, readFragmentParam, takeReturnTo, type RoleIntent } from './auth-validation'
import { LoginForm } from './login-form'
import styles from './auth.module.css'

// Results of the Google callback arrive as single-use codes in the URL fragment (never sent to
// servers or logs). The fragment is cleared immediately after reading it.
function takeFragment(key: string): string | null {
  const value = readFragmentParam(window.location.hash, key)
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return value
}

// /ingresar/google: `#code=` signs in; `#link=` asks for the password of the existing account.
export function GoogleSignInCompletion(): React.ReactNode {
  const started = useRef(false)
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'error'; message: string } | { kind: 'link'; code: string; email: string | null }>({ kind: 'working' })

  useEffect(() => {
    if (started.current) return
    started.current = true
    const code = readFragmentParam(window.location.hash, 'code')
    const link = readFragmentParam(window.location.hash, 'link')
    window.history.replaceState(null, '', window.location.pathname)
    const client = createTusWebAuthClient()
    if (code) {
      void client.googleExchange(code).then((result) => {
        if (result.status === 'authenticated') window.location.assign(takeReturnTo() ?? '/tus')
        else setState({ kind: 'error', message: 'No pudimos completar el ingreso con Google. Probá de nuevo.' })
      }).catch(() => setState({ kind: 'error', message: 'No pudimos conectar. Volvé a ingresar con Google.' }))
      return
    }
    if (link) {
      void client.googleLinkPreview(link).then((preview) => {
        if (preview) setState({ kind: 'link', code: link, email: preview.emailMasked })
        else setState({ kind: 'error', message: 'El enlace venció. Volvé a ingresar con Google.' })
      }).catch(() => setState({ kind: 'error', message: 'No pudimos conectar. Volvé a ingresar con Google.' }))
      return
    }
    setState({ kind: 'error', message: 'El enlace de ingreso no es válido.' })
  }, [])

  if (state.kind === 'working')
    return (
      <p className={styles.notice} role="status">
        Confirmando tu ingreso con TUS…
      </p>
    )
  if (state.kind === 'error')
    return (
      <div className={styles.form}>
        <FormError message={state.message} />
        <Link className={styles.primary} href="/sign-in">
          Volver a iniciar sesión
        </Link>
      </div>
    )
  return (
    <div className={styles.form}>
      <p className={styles.notice} role="status">
        Ya existe una cuenta TUS con el correo {state.email ?? 'de tu cuenta de Google'}. Iniciá sesión con tu contraseña para
        vincular Google a esa cuenta. No se crea una cuenta nueva.
      </p>
      <LoginForm
        onAuthenticated={async () => {
          const linked = await createTusWebAuthClient().googleLink(state.code)
          if (linked.status === 'accepted') window.location.assign(takeReturnTo() ?? '/tus')
          else
            setState({
              kind: 'error',
              message: 'Iniciaste sesión, pero no pudimos vincular Google (el correo no coincide o el enlace venció).',
            })
        }}
        showGoogle={false}
        showRegisterLink={false}
      />
    </div>
  )
}

// /registro/completar: first Google sign-up. The person confirms name, intent and terms.
export function GoogleSignupCompletion(): React.ReactNode {
  const [code, setCode] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [intent, setIntent] = useState<RoleIntent>('cliente')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid' | 'submitting'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const value = takeFragment('code')
    if (!value) {
      setStatus('invalid')
      return
    }
    setCode(value)
    void createTusWebAuthClient()
      .googleSignupPreview(value)
      .then((preview) => {
        if (!preview) {
          setStatus('invalid')
          return
        }
        setEmail(preview.email)
        setDisplayName(preview.name ?? '')
        setStatus('ready')
      })
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!code) return
    if (!acceptedTerms) {
      setMessage('Tenés que aceptar los términos para continuar.')
      return
    }
    setStatus('submitting')
    setMessage('')
    const result = await createTusWebAuthClient().googleSignup({ code, displayName: displayName.trim(), acceptedTerms })
    if (result.status === 'authenticated') {
      window.location.assign(takeReturnTo() ?? destinationFor(intent))
      return
    }
    setStatus('ready')
    setMessage('No pudimos crear tu cuenta. Si ya tenés una cuenta con este correo, iniciá sesión.')
  }

  if (status === 'loading')
    return (
      <p className={styles.notice} role="status">
        Cargando tus datos de Google…
      </p>
    )
  if (status === 'invalid')
    return (
      <div className={styles.form}>
        <FormError message="El enlace de registro venció o no es válido. Volvé a registrarte con Google." />
        <Link className={styles.primary} href="/registro">
          Volver al registro
        </Link>
      </div>
    )
  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <FormError message={message} />
      {email ? (
        <p className={styles.notice}>
          Vas a crear tu cuenta con <strong>{email}</strong>.
        </p>
      ) : null}
      <RoleIntentSelector onChange={setIntent} value={intent} />
      <TextField autoComplete="name" id="google-nombre" label="Nombre y apellido" maxLength={120} onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
      <label className={styles.checkbox}>
        <input checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} type="checkbox" />
        <span>Acepto los términos y condiciones y la política de privacidad de TUS.</span>
      </label>
      <button className={styles.primary} disabled={status === 'submitting'} type="submit">
        {status === 'submitting' ? 'Creando cuenta…' : 'Crear mi cuenta'}
      </button>
    </form>
  )
}
