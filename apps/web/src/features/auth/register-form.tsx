'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { PhoneApiError, phoneApi, type DesafioTelefonoWeb } from '@/lib/tus-phone-client'
import { FormError, GoogleAuthButton, PasswordField, RoleIntentSelector, Separator, TextField } from './auth-fields'
import { MIN_PASSWORD_LENGTH, registerErrorMessage, rememberReturnTo, safeInternalPath, validateRegister, withReturnTo, type FieldErrors, type RoleIntent } from './auth-validation'
import styles from './auth.module.css'
import { VerificacionWhatsapp } from './whatsapp-verification'

// Sign-up with phone first: the account is created and verified by a WhatsApp message the person
// sends (no email link needed). The email is still collected (and can be confirmed instead);
// the chosen intent only decides the next screen (no role is granted client-side).
export function RegisterForm(): React.ReactNode {
  const [intent, setIntent] = useState<RoleIntent>('cliente')
  const [values, setValues] = useState({ firstName: '', lastName: '', phone: '', email: '', password: '', confirmation: '' })
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [desafio, setDesafio] = useState<DesafioTelefonoWeb | null>(null)
  const [porEmail, setPorEmail] = useState(false)
  const [verificado, setVerificado] = useState(false)
  const consultar = useCallback((actual: DesafioTelefonoWeb) => phoneApi.estadoConSecreto(actual.challengeId, actual.pollSecret ?? ''), [])
  const renovar = useCallback((actual: DesafioTelefonoWeb) => phoneApi.renovar(actual.challengeId, actual.pollSecret ?? ''), [])
  const [returnTo, setReturnTo] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('intencion') === 'prestador') setIntent('prestador')
    // Came from the assistant or a worker profile: go back there after signing in (also via Google).
    const requested = safeInternalPath(params.get('returnTo'))
    setReturnTo(requested)
    rememberReturnTo(requested)
  }, [])

  const update = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validateRegister({ ...values, acceptedTerms })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    setMessage('')
    let result: Awaited<ReturnType<typeof phoneApi.registrar>>
    try {
      result = await phoneApi.registrar({
        email: values.email.trim(),
        password: values.password,
        displayName: `${values.firstName.trim()} ${values.lastName.trim()}`,
        phone: values.phone.trim(),
      })
    } catch (cause) {
      setSubmitting(false)
      if (cause instanceof PhoneApiError && cause.code === 'INVALID_PHONE') return setErrors({ phone: 'Revisá el número: escribilo con característica, por ejemplo 379 412-3456.' })
      if (cause instanceof PhoneApiError && cause.code === 'RATE_LIMITED') return setMessage('Hiciste muchos intentos seguidos. Esperá unos minutos y probá de nuevo.')
      setMessage(registerErrorMessage(cause instanceof PhoneApiError ? cause.code : undefined))
      return
    }
    setSubmitting(false)
    setDesafio(result.phoneVerification ?? null)
    try {
      window.sessionStorage.setItem('tus.registro.intencion', intent)
    } catch {
      // Only a UX preference for the first screen after sign-in.
    }
    setDone(true)
  }

  if (done && desafio && !porEmail)
    return (
      <div className={styles.form}>
        <VerificacionWhatsapp consultar={consultar} desafio={desafio} onVerificado={() => setVerificado(true)} renovar={renovar} />
        {verificado ? (
          <Link className={styles.primary} href={withReturnTo('/sign-in', returnTo) as Route}>
            Ingresar con mi celular
          </Link>
        ) : (
          <button className={styles.secondaryButton} onClick={() => setPorEmail(true)} type="button">
            Prefiero verificar por email
          </button>
        )}
      </div>
    )

  if (done)
    return (
      <div className={styles.form}>
        <p className={styles.success} role="status">
          Te enviamos un correo a <strong>{values.email.trim()}</strong> con un enlace para confirmar tu cuenta (vence en 24
          horas). Después podés iniciar sesión con tu email y contraseña. ¿No llegó? Revisá spam o{' '}
          <Link className={styles.link} href="/verificar-email">
            pedí otro
          </Link>
          .
        </p>
        <Link className={styles.primary} href={withReturnTo('/sign-in', returnTo) as Route}>
          Ir a iniciar sesión
        </Link>
      </div>
    )

  return (
    <>
      <GoogleAuthButton label="Registrarme con Google" />
      <Separator />
      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <FormError message={message} />
        <RoleIntentSelector onChange={setIntent} value={intent} />
        <div className={styles.row2}>
          <TextField autoComplete="given-name" error={errors.firstName} id="registro-nombre" label="Nombre" onChange={update('firstName')} value={values.firstName} />
          <TextField autoComplete="family-name" error={errors.lastName} id="registro-apellido" label="Apellido" onChange={update('lastName')} value={values.lastName} />
        </div>
        <TextField autoComplete="tel" error={errors.phone} id="registro-telefono" inputMode="tel" label="Celular con WhatsApp" onChange={update('phone')} placeholder="379 412-3456" type="tel" value={values.phone} />
        <TextField autoComplete="email" error={errors.email} id="registro-email" inputMode="email" label="Correo electrónico" onChange={update('email')} type="email" value={values.email} />
        <PasswordField
          autoComplete="new-password"
          error={errors.password}
          id="registro-password"
          label={`Contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`}
          onChange={update('password')}
          value={values.password}
        />
        <PasswordField autoComplete="new-password" error={errors.confirmation} id="registro-confirmacion" label="Repetí la contraseña" onChange={update('confirmation')} value={values.confirmation} />
        <div>
          <label className={styles.checkbox}>
            <input
              aria-describedby={errors.terms ? 'registro-terminos-error' : undefined}
              aria-invalid={errors.terms ? true : undefined}
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              type="checkbox"
            />
            <span>Acepto los términos y condiciones y la política de privacidad de TUS.</span>
          </label>
          {errors.terms ? (
            <p className={styles.fieldError} id="registro-terminos-error" role="alert">
              {errors.terms}
            </p>
          ) : null}
        </div>
        <button className={styles.primary} disabled={submitting} type="submit">
          {submitting ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
      <p className={styles.footerText}>
        ¿Ya tenés cuenta?{' '}
        <Link className={styles.link} href={withReturnTo('/sign-in', returnTo) as Route}>
          Iniciá sesión
        </Link>
      </p>
    </>
  )
}
