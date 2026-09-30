'use client'

import { useCallback, useEffect, useState } from 'react'

import authStyles from '../auth/auth.module.css'
import { MENSAJE_TELEFONO, telefonoValido } from '../auth/auth-validation'
import { VerificacionWhatsapp } from '../auth/whatsapp-verification'
import styles from '../directory/directory.module.css'
import { mensajeErrorTelefono, phoneApi, type DesafioTelefonoWeb, type EstadoTelefonoCuentaWeb } from '../../lib/tus-phone-client'

// "Mi celular": the identity phone of the person (one per account, whatever the roles). Adding or
// changing it always goes through WhatsApp; the current number stays until the new one is proved.
export function PhoneSection(): React.ReactNode {
  const [estado, setEstado] = useState<EstadoTelefonoCuentaWeb | null>(null)
  const [editando, setEditando] = useState(false)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [desafio, setDesafio] = useState<DesafioTelefonoWeb | null>(null)

  const cargar = useCallback(() => phoneApi.miTelefono().then(setEstado).catch(() => setEstado(null)), [])
  useEffect(() => { void cargar() }, [cargar])

  const consultar = useCallback((actual: DesafioTelefonoWeb) => phoneApi.estadoConSesion(actual.challengeId), [])
  const renovar = useCallback(() => phoneApi.iniciar(phone.trim()), [phone])

  async function iniciar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!telefonoValido(phone)) return setError(MENSAJE_TELEFONO)
    setEnviando(true)
    setError('')
    try {
      setDesafio(await phoneApi.iniciar(phone.trim()))
    } catch (cause) {
      setError(mensajeErrorTelefono(cause))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section aria-labelledby="mi-celular" className={styles.card} style={{ marginTop: 16 }}>
      <h2 id="mi-celular" style={{ fontSize: '1.05rem', margin: 0 }}>Celular con WhatsApp</h2>
      {estado?.verified ? (
        <p style={{ margin: 0 }}>
          <strong>{estado.phoneMasked}</strong> <span className={styles.available}>✓ Verificado</span>
        </p>
      ) : (
        <p className={authStyles.notice} style={{ margin: 0 }}>
          Verificá tu número de WhatsApp: es la forma más simple de proteger tu cuenta y recuperarla si olvidás la contraseña.
          {estado?.pendingMasked ? <> Número pendiente: <strong>{estado.pendingMasked}</strong>.</> : null}
        </p>
      )}
      {desafio ? (
        <>
          <VerificacionWhatsapp
            consultar={consultar}
            desafio={desafio}
            onVerificado={() => {
              void cargar()
              setEditando(false)
            }}
            renovar={renovar}
          />
          <button className={authStyles.secondaryButton} onClick={() => setDesafio(null)} type="button">Volver</button>
        </>
      ) : editando || !estado?.verified ? (
        <form noValidate onSubmit={(event) => void iniciar(event)} style={{ display: 'grid', gap: 8 }}>
          <label htmlFor="mi-celular-numero" style={{ fontWeight: 700 }}>{estado?.verified ? 'Nuevo número' : 'Tu número'}</label>
          <input
            aria-describedby={error ? 'mi-celular-error' : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete="tel"
            className={authStyles.input}
            id="mi-celular-numero"
            inputMode="tel"
            onChange={(event) => setPhone(event.target.value)}
            placeholder="379 412-3456"
            type="tel"
            value={phone}
          />
          {error ? <p className={authStyles.fieldError} id="mi-celular-error" role="alert">{error}</p> : null}
          <button className={authStyles.primary} disabled={enviando} type="submit">
            {enviando ? 'Preparando…' : estado?.verified ? 'Verificar nuevo número con WhatsApp' : 'Verificar con WhatsApp'}
          </button>
        </form>
      ) : (
        <button className={authStyles.secondaryButton} onClick={() => setEditando(true)} type="button">Cambiar número</button>
      )}
    </section>
  )
}
