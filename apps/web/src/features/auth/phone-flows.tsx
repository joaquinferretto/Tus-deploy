'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'

import { mensajeErrorTelefono, phoneApi, type DesafioTelefonoWeb } from '@/lib/tus-phone-client'
import { FormError, PasswordField, TextField } from './auth-fields'
import { MENSAJE_TELEFONO, telefonoValido } from './auth-validation'
import styles from './auth.module.css'
import { VerificacionWhatsapp } from './whatsapp-verification'

// Flows without a session: they poll with the secret the API returned with the challenge.
const consultarConSecreto = (desafio: DesafioTelefonoWeb) => phoneApi.estadoConSecreto(desafio.challengeId, desafio.pollSecret ?? '')
const renovarConSecreto = (desafio: DesafioTelefonoWeb) => phoneApi.renovar(desafio.challengeId, desafio.pollSecret ?? '')

// "Olvidé mi contraseña" through WhatsApp: the phone proves itself by sending the message; then
// the normal single-use recovery link takes over (/restablecer-contrasena).
export function RecoveryWhatsappForm(): React.ReactNode {
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [desafio, setDesafio] = useState<DesafioTelefonoWeb | null>(null)
  const alVerificar = useCallback((estado: { recoveryToken?: string }) => {
    if (estado.recoveryToken) window.location.assign(`/restablecer-contrasena?token=${encodeURIComponent(estado.recoveryToken)}`)
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!telefonoValido(phone)) return setError(MENSAJE_TELEFONO)
    setSubmitting(true)
    setError('')
    try {
      setDesafio(await phoneApi.recuperar(phone.trim()))
    } catch (cause) {
      setError(mensajeErrorTelefono(cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (desafio)
    return (
      <div className={styles.form}>
        <VerificacionWhatsapp consultar={consultarConSecreto} desafio={desafio} onVerificado={alVerificar} renovar={renovarConSecreto} textoExito="Listo. Te llevamos a elegir tu nueva contraseña." />
        <p className={styles.notice}>Si el número no está registrado en TUS, WhatsApp te va a responder que no pudimos verificarlo.</p>
      </div>
    )

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <FormError message={error} />
      <TextField autoComplete="tel" id="recuperar-telefono" inputMode="tel" label="Tu celular con WhatsApp" onChange={(event) => setPhone(event.target.value)} placeholder="379 412-3456" type="tel" value={phone} />
      <button className={styles.primary} disabled={submitting} type="submit">
        {submitting ? 'Preparando…' : 'Recuperar por WhatsApp'}
      </button>
      <Link className={styles.link} href="/olvide-contrasena">Prefiero recuperar por email</Link>
    </form>
  )
}

// An account created but never verified (the page was closed): proves ownership with the password
// and sends the WhatsApp message again. Same generic answer as sign-in when something is wrong.
export function PendingPhoneForm(): React.ReactNode {
  const [values, setValues] = useState({ identifier: '', password: '', phone: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [desafio, setDesafio] = useState<DesafioTelefonoWeb | null>(null)
  const [verificado, setVerificado] = useState(false)
  const update = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!telefonoValido(values.phone)) return setError(MENSAJE_TELEFONO)
    setSubmitting(true)
    setError('')
    try {
      setDesafio(await phoneApi.pendiente({ identifier: values.identifier.trim(), password: values.password, phone: values.phone.trim() }))
    } catch (cause) {
      setError(mensajeErrorTelefono(cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (desafio)
    return (
      <div className={styles.form}>
        <VerificacionWhatsapp consultar={consultarConSecreto} desafio={desafio} onVerificado={() => setVerificado(true)} renovar={renovarConSecreto} />
        {verificado ? <Link className={styles.primary} href="/sign-in">Ingresar</Link> : null}
      </div>
    )

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <FormError message={error} />
      <TextField autoComplete="username" id="pendiente-identificador" label="Correo con el que te registraste" onChange={update('identifier')} type="text" value={values.identifier} />
      <PasswordField autoComplete="current-password" id="pendiente-password" label="Contraseña" onChange={update('password')} value={values.password} />
      <TextField autoComplete="tel" id="pendiente-telefono" inputMode="tel" label="Celular con WhatsApp" onChange={update('phone')} placeholder="379 412-3456" type="tel" value={values.phone} />
      <button className={styles.primary} disabled={submitting} type="submit">
        {submitting ? 'Preparando…' : 'Verificar con WhatsApp'}
      </button>
    </form>
  )
}
