'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import authStyles from '../auth/auth.module.css'
import { MENSAJE_TELEFONO, telefonoValido } from '../auth/auth-validation'
import { VerificacionWhatsapp } from '../auth/whatsapp-verification'
import styles from '../directory/directory.module.css'
import { mensajeErrorTelefono, phoneApi, type DesafioTelefonoWeb, type EstadoTelefonoCuentaWeb } from '../../lib/tus-phone-client'

// "WhatsApp" in Mi perfil. Three different facts, three different screens:
//  1. the number is not verified      -> verify it (the only form);
//  2. verified but WhatsApp not linked -> "Vincular este WhatsApp" (one button, no form);
//  3. verified and linked              -> ready; changing the number is a separate, secondary action.
// A verified phone and a linked WhatsApp are not the same thing: the link is what lets the
// assistant recognise this account from WhatsApp.
export function PhoneSection(): React.ReactNode {
  const [estado, setEstado] = useState<EstadoTelefonoCuentaWeb | null>(null)
  const [cambiando, setCambiando] = useState(false)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [desafio, setDesafio] = useState<DesafioTelefonoWeb | null>(null)
  const [numeroOficial, setNumeroOficial] = useState<string | null>(null)
  const seccion = useRef<HTMLElement>(null)
  const botonVincular = useRef<HTMLButtonElement>(null)

  const cargar = useCallback(() => phoneApi.miTelefono().then(setEstado).catch(() => setEstado(null)), [])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => { void phoneApi.numeroOficial().then(setNumeroOficial).catch(() => setNumeroOficial(null)) }, [])

  // ?accion=vincular-whatsapp (the bot's button): bring the linking step into view.
  useEffect(() => {
    if (!estado?.verified || estado.whatsappLinked) return
    if (new URLSearchParams(window.location.search).get('accion') !== 'vincular-whatsapp') return
    seccion.current?.scrollIntoView({ block: 'center' })
    botonVincular.current?.focus({ preventScroll: true })
  }, [estado])

  const consultar = useCallback((actual: DesafioTelefonoWeb) => phoneApi.estadoConSesion(actual.challengeId), [])
  const renovarVinculo = useCallback(() => phoneApi.vincular(), [])
  const renovarNumero = useCallback(() => phoneApi.iniciar(phone.trim()), [phone])

  async function verificarNumero(event: React.FormEvent<HTMLFormElement>) {
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

  async function vincular() {
    setEnviando(true)
    setError('')
    try {
      const nuevo = await phoneApi.vincular()
      setDesafio(nuevo)
      // Opens WhatsApp with "VERIFICAR TUS <code>" written; if the browser blocks the pop-up the
      // panel below keeps the same button.
      if (nuevo.whatsappUrl) window.open(nuevo.whatsappUrl, '_blank', 'noopener,noreferrer')
    } catch (cause) {
      setError(mensajeErrorTelefono(cause))
    } finally {
      setEnviando(false)
    }
  }

  function terminar() {
    void cargar()
    setCambiando(false)
    setDesafio(null)
  }

  const verificado = Boolean(estado?.verified)
  const vinculado = verificado && Boolean(estado?.whatsappLinked)
  const formularioNumero = !verificado || cambiando
  const esVinculo = desafio !== null && verificado && !cambiando

  return (
    <section aria-labelledby="mi-celular" className={styles.card} ref={seccion} style={{ marginTop: 16 }}>
      <h2 id="mi-celular" style={{ fontSize: '1.05rem', margin: 0 }}>{verificado && !vinculado && !cambiando ? 'Vincular WhatsApp' : 'WhatsApp'}</h2>

      {desafio ? (
        <>
          <VerificacionWhatsapp
            consultar={consultar}
            desafio={desafio}
            onVerificado={terminar}
            renovar={esVinculo ? renovarVinculo : renovarNumero}
            {...(esVinculo
              ? { titulo: 'Vinculá este WhatsApp', textoBoton: 'Abrir WhatsApp y enviar', tituloExito: '✓ WhatsApp vinculado', textoExito: 'Este WhatsApp está listo para usar TUS.', textoFallo: 'No pudimos vincular este WhatsApp. Generá un código nuevo y probá de nuevo.' }
              : {})}
          />
          <button className={authStyles.secondaryButton} onClick={() => setDesafio(null)} type="button">Volver</button>
        </>
      ) : formularioNumero ? (
        <form noValidate onSubmit={(event) => void verificarNumero(event)} style={{ display: 'grid', gap: 8 }}>
          <p className={authStyles.notice} style={{ margin: 0 }}>
            {cambiando
              ? 'Escribí tu nuevo número. Tu número actual sigue vigente hasta que confirmes el nuevo desde WhatsApp.'
              : 'Para usar TUS desde WhatsApp, primero verificá tu número de celular.'}
            {estado?.pendingMasked ? <> Número pendiente: <strong>{estado.pendingMasked}</strong>.</> : null}
          </p>
          <label htmlFor="mi-celular-numero" style={{ fontWeight: 700 }}>{cambiando ? 'Nuevo número' : 'Tu número de celular'}</label>
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
            {enviando ? 'Preparando…' : cambiando ? 'Verificar nuevo número' : 'Verificar mi número'}
          </button>
          <p style={{ color: 'var(--color-muted, #5b6470)', fontSize: '0.9rem', margin: 0 }}>Te vamos a abrir WhatsApp para confirmar que este número es tuyo.</p>
          {cambiando ? <button className={authStyles.secondaryButton} onClick={() => { setCambiando(false); setError('') }} type="button">Cancelar</button> : null}
        </form>
      ) : vinculado ? (
        <>
          <p style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', margin: 0 }}>
            <strong>{estado?.phoneMasked}</strong>
            <span className={styles.available}>✓ Verificado</span>
            <span className={styles.available}>✓ Vinculado a TUS</span>
          </p>
          <p style={{ margin: 0 }}>Este WhatsApp está listo para usar TUS.</p>
          {numeroOficial ? (
            <a className={authStyles.secondaryButton} href={`https://wa.me/${numeroOficial.replace(/\D/gu, '')}`} rel="noopener noreferrer" style={{ alignItems: 'center', display: 'flex', justifyContent: 'center', textDecoration: 'none' }} target="_blank">Abrir TUS en WhatsApp</a>
          ) : null}
          <button className={authStyles.secondaryButton} onClick={() => setCambiando(true)} type="button">Cambiar número de celular</button>
        </>
      ) : (
        <>
          <p style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', margin: 0 }}>
            <strong>{estado?.phoneMasked}</strong>
            <span className={styles.available}>✓ Número verificado</span>
          </p>
          <p style={{ margin: 0 }}>Tu número ya está verificado. Para continuar usando TUS desde WhatsApp falta vincular este WhatsApp con tu cuenta.</p>
          {error ? <p className={authStyles.fieldError} role="alert">{error}</p> : null}
          <button className={authStyles.primary} disabled={enviando} onClick={() => void vincular()} ref={botonVincular} type="button">
            {enviando ? 'Preparando…' : 'Vincular este WhatsApp'}
          </button>
          <p style={{ color: 'var(--color-muted, #5b6470)', fontSize: '0.9rem', margin: 0 }}>Al tocar el botón vamos a abrir WhatsApp con un mensaje de verificación listo para enviar.</p>
          <button className={authStyles.secondaryButton} onClick={() => setCambiando(true)} type="button">Cambiar número de celular</button>
        </>
      )}
    </section>
  )
}
