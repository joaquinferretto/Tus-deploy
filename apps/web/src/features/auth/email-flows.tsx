'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { createTusWebAuthClient } from '@/lib/tus-auth-client'
import { FormError, PasswordField, TextField } from './auth-fields'
import { MIN_PASSWORD_LENGTH } from './auth-validation'
import styles from './auth.module.css'

// Email + password flows that do not depend on Google: email verification, re-send, password
// reset. Every public answer is generic (it never tells whether an email has an account).

// The one-time token arrives in the link (?token=...). It is read once and removed from the
// address bar so it does not stay in the history or leak to later pages.
function takeTokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token') ?? ''
  if (token) window.history.replaceState(null, '', window.location.pathname)
  return token
}

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())

export function VerifyEmailFlow(): React.ReactNode {
  const [state, setState] = useState<'checking' | 'verified' | 'invalid' | 'missing'>('checking')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const token = takeTokenFromUrl()
    if (!token) {
      setState('missing')
      return
    }
    void createTusWebAuthClient()
      .verifyEmail(token)
      .then((result) => setState(result.status === 'accepted' ? 'verified' : 'invalid'))
  }, [])

  if (state === 'checking') return <p role="status">Confirmando tu email…</p>
  if (state === 'verified')
    return (
      <div className={styles.form}>
        <p className={styles.success} role="status">
          ¡Listo! Tu email quedó confirmado. Ya podés iniciar sesión con tu email y contraseña.
        </p>
        <Link className={styles.primary} href="/sign-in">
          Iniciar sesión
        </Link>
      </div>
    )
  return (
    <>
      <FormError
        message={state === 'invalid' ? 'El enlace venció o ya se usó. Pedí uno nuevo con tu email.' : 'Abrí el enlace que te enviamos por email, o pedí uno nuevo.'}
      />
      <ResendVerificationForm />
    </>
  )
}

export function ResendVerificationForm(): React.ReactNode {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validEmail(email)) {
      setError('Ingresá un email válido.')
      return
    }
    setSubmitting(true)
    setError('')
    await createTusWebAuthClient().resendVerification(email.trim())
    setSubmitting(false)
    setSent(true)
  }

  if (sent)
    return (
      <p className={styles.success} role="status">
        Si ese email tiene una cuenta pendiente de confirmar, te enviamos un enlace nuevo. Revisá también la carpeta de spam. Podés
        pedir otro en un minuto.
      </p>
    )
  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <TextField autoComplete="email" error={error || undefined} id="reenviar-email" inputMode="email" label="Tu email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
      <button className={styles.primary} disabled={submitting} type="submit">
        {submitting ? 'Enviando…' : 'Reenviar email de verificación'}
      </button>
    </form>
  )
}

export function ForgotPasswordForm(): React.ReactNode {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validEmail(email)) {
      setError('Ingresá un email válido.')
      return
    }
    setSubmitting(true)
    setError('')
    await createTusWebAuthClient().requestRecovery(email.trim())
    setSubmitting(false)
    setSent(true)
  }

  if (sent)
    return (
      <div className={styles.form}>
        <p className={styles.success} role="status">
          Si el email tiene una cuenta en TUS, te enviamos un enlace para elegir una contraseña nueva. Vence en 1 hora.
        </p>
        <Link className={styles.link} href="/sign-in">
          Volver a iniciar sesión
        </Link>
      </div>
    )
  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <TextField autoComplete="email" error={error || undefined} id="olvide-email" inputMode="email" label="Tu email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
      <button className={styles.primary} disabled={submitting} type="submit">
        {submitting ? 'Enviando…' : 'Enviarme el enlace'}
      </button>
    </form>
  )
}

export function ResetPasswordForm(): React.ReactNode {
  const [token, setToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const tokenRead = useRef(false)

  useEffect(() => {
    if (tokenRead.current) return
    tokenRead.current = true
    setToken(takeTokenFromUrl())
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    if (password.length > 256) return setError('La contraseña es demasiado larga (máximo 256 caracteres).')
    if (password !== confirmation) return setError('Las contraseñas no coinciden.')
    setSubmitting(true)
    setError('')
    const result = await createTusWebAuthClient().completeRecovery({ token: token ?? '', newPassword: password })
    setSubmitting(false)
    if (result.status === 'accepted') return setDone(true)
    setError(
      result.code === 'PASSWORD_BREACHED'
        ? 'Esa contraseña apareció en filtraciones de datos conocidas. Elegí otra (una frase larga funciona bien).'
        : 'El enlace venció o ya se usó. Pedí uno nuevo.'
    )
  }

  if (token === null) return <p role="status">Cargando…</p>
  if (!token)
    return (
      <div className={styles.form}>
        <FormError message="Abrí el enlace que te enviamos por email." />
        <Link className={styles.link} href="/olvide-contrasena">
          Pedir un enlace nuevo
        </Link>
      </div>
    )
  if (done)
    return (
      <div className={styles.form}>
        <p className={styles.success} role="status">
          Listo, cambiaste tu contraseña y cerramos las sesiones abiertas. Iniciá sesión con la nueva.
        </p>
        <Link className={styles.primary} href="/sign-in">
          Iniciar sesión
        </Link>
      </div>
    )
  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <FormError message={error} />
      <PasswordField autoComplete="new-password" id="reset-password" label={`Contraseña nueva (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`} onChange={(event) => setPassword(event.target.value)} value={password} />
      <PasswordField autoComplete="new-password" id="reset-confirmacion" label="Repetí la contraseña" onChange={(event) => setConfirmation(event.target.value)} value={confirmation} />
      <button className={styles.primary} disabled={submitting} type="submit">
        {submitting ? 'Guardando…' : 'Guardar contraseña'}
      </button>
    </form>
  )
}

// Admin activation without an email provider: the operator's bootstrap code (set in the API
// environment as TUS_ADMIN_BOOTSTRAP_CODE) verifies an allowlisted admin email once. The account
// must already be registered with email + password; MFA is still required afterwards.
export function AdminBootstrapForm(): React.ReactNode {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validEmail(email) || code.trim().length < 24) {
      setError('Ingresá tu email y el código de arranque completo (24 caracteres o más).')
      return
    }
    setSubmitting(true)
    setError('')
    const result = await createTusWebAuthClient().verifyAdminWithBootstrapCode({ email: email.trim(), code: code.trim() })
    setSubmitting(false)
    if (result.status === 'accepted') return setDone(true)
    setError('No pudimos activar la cuenta. Revisá el email, el código y que ya te hayas registrado con email y contraseña.')
  }

  if (done)
    return (
      <div className={styles.form}>
        <p className={styles.success} role="status">
          Cuenta de administración confirmada. Iniciá sesión con tu email y contraseña; después te pedimos el código de la app autenticadora.
        </p>
        <Link className={styles.primary} href="/sign-in?returnTo=%2Ftus%2Fadmin%2Fseguridad">
          Iniciar sesión
        </Link>
      </div>
    )
  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <FormError message={error} />
      <TextField autoComplete="email" id="bootstrap-email" inputMode="email" label="Email de administración" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
      <PasswordField autoComplete="off" id="bootstrap-code" label="Código de arranque (el que cargaste en Hostinger)" onChange={(event) => setCode(event.target.value)} value={code} />
      <button className={styles.primary} disabled={submitting} type="submit">
        {submitting ? 'Confirmando…' : 'Confirmar cuenta de administración'}
      </button>
    </form>
  )
}
