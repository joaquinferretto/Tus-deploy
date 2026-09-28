'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { createTusWebAuthClient, resolvePostLoginRoute } from '@/lib/tus-auth-client'
import { FormError, GoogleAuthButton, PasswordField, Separator, TextField } from './auth-fields'
import { googleErrorMessage, rememberReturnTo, signInErrorMessage, takeReturnTo, validateLogin, withReturnTo, type FieldErrors } from './auth-validation'
import styles from './auth.module.css'

// Email + password sign-in. `onAuthenticated` lets other flows (Google linking) continue after
// the TUS session is confirmed; otherwise it navigates to the safe return path.
export function LoginForm({
  onAuthenticated,
  showGoogle = true,
  showRegisterLink = true,
}: {
  onAuthenticated?: () => Promise<void> | void
  showGoogle?: boolean
  showRegisterLink?: boolean
}): React.ReactNode {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [returnTo, setReturnTo] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('returnTo')
    setReturnTo(requested)
    // Also covers "Continuar con Google": the destination survives the round trip.
    rememberReturnTo(requested)
    const googleError = googleErrorMessage(params.get('error'))
    if (googleError) setMessage(googleError)
    const client = createTusWebAuthClient()
    void client.restore(requested ?? undefined).then(async (result) => {
      if (result.status === 'authenticated') {
        const capabilities = await client.capabilities()
        window.location.replace(resolvePostLoginRoute(capabilities, requested))
        return
      }
      setRestoring(false)
    }).catch(() => setRestoring(false))
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validateLogin({ email, password })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    setMessage('')
    const client = createTusWebAuthClient()
    const result = await client.signIn({ email: email.trim(), password })
    if (result.status !== 'authenticated') {
      setSubmitting(false)
      setMessage(signInErrorMessage(result.status, result.code))
      return
    }
    if (onAuthenticated) await onAuthenticated()
    else {
      const capabilities = await client.capabilities()
      window.location.assign(resolvePostLoginRoute(capabilities, takeReturnTo() ?? returnTo))
    }
  }

  if (restoring) return <p className={styles.notice} role="status">Comprobando tu sesión…</p>

  return (
    <>
      {showGoogle ? (
        <>
          <GoogleAuthButton label="Continuar con Google" />
          <Separator />
        </>
      ) : null}
      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <FormError message={message} />
        <TextField
          autoComplete="username"
          error={errors.email}
          id="login-email"
          inputMode="email"
          label="Correo electrónico"
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
        <PasswordField
          autoComplete="current-password"
          error={errors.password}
          id="login-password"
          label="Contraseña"
          onChange={(event) => setPassword(event.target.value)}
          value={password}
        />
        <div className={styles.loginLinks}>
          <Link className={styles.link} href="/olvide-contrasena">
            ¿Olvidaste tu contraseña?
          </Link>
          <Link className={`${styles.link} ${styles.linkSubtle}`} href="/verificar-email">
            Reenviar email de verificación
          </Link>
        </div>
        <button className={styles.primary} disabled={submitting} type="submit">
          {submitting ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
      </form>
      {showRegisterLink ? (
        <p className={styles.footerText}>
          ¿No tenés cuenta?{' '}
          <Link className={styles.link} href={withReturnTo('/registro', returnTo) as Route}>
            Registrate
          </Link>
        </p>
      ) : null}
    </>
  )
}
