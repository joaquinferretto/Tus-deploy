'use client'

import { useEffect, useState } from 'react'

import { createTusWebAuthClient, tusGoogleStartUrl } from '@/lib/tus-auth-client'
import type { RoleIntent } from './auth-validation'
import styles from './auth.module.css'

export function TextField({
  id,
  label,
  error,
  ...input
}: { id: string; label: string; error?: string | undefined } & React.InputHTMLAttributes<HTMLInputElement>): React.ReactNode {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        {...input}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className={`${styles.input} ${error ? styles.inputInvalid : ''}`}
        id={id}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

export function PasswordField({
  id,
  label,
  error,
  ...input
}: { id: string; label: string; error?: string | undefined } & React.InputHTMLAttributes<HTMLInputElement>): React.ReactNode {
  const [visible, setVisible] = useState(false)
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.passwordWrap}>
        <input
          {...input}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          className={`${styles.input} ${error ? styles.inputInvalid : ''}`}
          id={id}
          style={{ paddingRight: 84 }}
          type={visible ? 'text' : 'password'}
        />
        <button
          aria-controls={id}
          aria-label="Mostrar contraseña"
          aria-pressed={visible}
          className={styles.toggle}
          onClick={() => setVisible((value) => !value)}
          type="button"
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

export function FieldError({ id, message }: { id: string; message?: string | undefined }): React.ReactNode {
  return message ? (
    <p className={styles.fieldError} id={id} role="alert">
      {message}
    </p>
  ) : null
}

export function FormError({ message }: { message: string }): React.ReactNode {
  return message ? (
    <p className={styles.formError} role="alert">
      {message}
    </p>
  ) : null
}

// One Google flow for sign-in and sign-up: the API decides whether the identity is new.
export function GoogleAuthButton({ label }: { label: 'Continuar con Google' | 'Registrarme con Google' }): React.ReactNode {
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    try {
      void createTusWebAuthClient()
        .googleAvailable()
        .then((value) => {
          if (!cancelled) setAvailable(value)
        })
    } catch {
      setAvailable(false)
    }
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <div>
      <button
        className={styles.google}
        disabled={available !== true}
        onClick={() => window.location.assign(tusGoogleStartUrl())}
        type="button"
      >
        <GoogleMark />
        {label}
      </button>
      {available === false ? <p className={styles.googleHint}>El ingreso con Google todavía no está disponible.</p> : null}
      {available === true ? <p className={styles.googleHint}>Si es tu primera vez, creamos tu cuenta con los datos de Google y entrás directamente.</p> : null}
    </div>
  )
}

function GoogleMark(): React.ReactNode {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 48 48" width="18">
      <path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" fill="#FFC107" />
      <path d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00" />
      <path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" fill="#4CAF50" />
      <path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" fill="#1976D2" />
    </svg>
  )
}

export function Separator(): React.ReactNode {
  return <div className={styles.separator}>o</div>
}

export function RoleIntentSelector({ value, onChange }: { value: RoleIntent; onChange: (next: RoleIntent) => void }): React.ReactNode {
  const options: { id: RoleIntent; title: string; text: string }[] = [
    { id: 'cliente', title: 'Quiero contratar servicios', text: 'Pedí presupuestos a profesionales de tu zona.' },
    { id: 'prestador', title: 'Quiero ofrecer mis servicios', text: 'Publicá tus servicios y recibí trabajos.' },
  ]
  return (
    <fieldset className={styles.intent}>
      <legend className={styles.legend} style={{ gridColumn: '1 / -1', marginBottom: 6 }}>
        ¿Qué querés hacer en TUS?
      </legend>
      {options.map((option) => (
        <label className={`${styles.intentOption} ${value === option.id ? styles.intentSelected : ''}`} key={option.id}>
          <span>
            <input checked={value === option.id} name="intencion" onChange={() => onChange(option.id)} type="radio" value={option.id} />{' '}
            <span className={styles.intentTitle}>{option.title}</span>
          </span>
          <span className={styles.intentText}>{option.text}</span>
        </label>
      ))}
    </fieldset>
  )
}
