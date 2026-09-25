'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { createTusWebAuthClient, sanitizeTusReturnTo } from '@/lib/tus-auth-client'
import { FormError, GoogleAuthButton, PasswordField, Separator, TextField } from './auth-fields'
import { googleErrorMessage, signInErrorMessage, validateLogin, type FieldErrors } from './auth-validation'
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
  const [returnTo, setReturnTo] = useState('/tus')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setReturnTo(sanitizeTusReturnTo(params.get('returnTo') ?? undefined))
    const googleError = googleErrorMessage(params.get('error'))
    if (googleError) setMessage(googleError)
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validateLogin({ email, password })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    setMessage('')
    const result = await createTusWebAuthClient().signIn({ email: email.trim(), password })
    if (result.status !== 'authenticated') {
      setSubmitting(false)
      setMessage(signInErrorMessage(result.status))
      return
    }
    if (onAuthenticated) await onAuthenticated()
    else window.location.assign(result.returnTo ?? returnTo)
  }

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
        <div className={styles.linkRow}>
          <Link className={styles.link} href="/recovery">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        {showGoogle ? (
          <p className={styles.googleHint} style={{ marginTop: -8, textAlign: 'left' }}>
            Si creaste tu cuenta con Google, no tenés contraseña: usá “Continuar con Google”.
          </p>
        ) : null}
        <button className={styles.primary} disabled={submitting} type="submit">
          {submitting ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
      </form>
      {showRegisterLink ? (
        <p className={styles.footerText}>
          ¿No tenés cuenta?{' '}
          <Link className={styles.link} href="/registro">
            Registrate
          </Link>
        </p>
      ) : null}
    </>
  )
}
