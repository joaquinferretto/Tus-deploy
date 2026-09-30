'use client'

import { useEffect, useRef, useState } from 'react'

import type { DesafioTelefonoWeb, EstadoDesafioWeb } from '@/lib/tus-phone-client'
import { mensajeErrorTelefono } from '@/lib/tus-phone-client'
import styles from './auth.module.css'

const INTERVALO_MS = 3000

// "Verificá tu número": one big button opens WhatsApp with "VERIFICAR TUS <code>" already written;
// the person only taps Enviar and comes back. Designed for people not used to email links or
// codes: no digits to copy in the main path, plain words, a status read aloud (aria-live) and a
// bounded wait (the code lives 10 minutes; then a new one is one tap away).
export function VerificacionWhatsapp({
  desafio,
  consultar,
  renovar,
  onVerificado,
  textoExito = 'También te enviamos la confirmación por WhatsApp.',
}: {
  desafio: DesafioTelefonoWeb
  consultar: (desafio: DesafioTelefonoWeb) => Promise<EstadoDesafioWeb>
  renovar?: (desafio: DesafioTelefonoWeb) => Promise<DesafioTelefonoWeb>
  onVerificado?: (estado: EstadoDesafioWeb) => void
  textoExito?: string
}): React.ReactNode {
  const [actual, setActual] = useState(desafio)
  const [fase, setFase] = useState<'listo' | 'esperando' | 'verificado' | 'vencido' | 'fallido'>('listo')
  const [error, setError] = useState('')
  const [copiado, setCopiado] = useState(false)
  const avisado = useRef(false)

  useEffect(() => setActual(desafio), [desafio])

  // Polls while the code is alive, whether or not the button was tapped (the person may send the
  // message from another phone app). Stops on success, failure or expiry: never an endless loop.
  useEffect(() => {
    if (fase === 'verificado' || fase === 'vencido' || fase === 'fallido') return
    let cancelado = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const vence = Date.parse(actual.expiresAt) + 15_000
    const tick = async () => {
      if (cancelado) return
      if (Date.now() > vence) {
        setFase('vencido')
        return
      }
      try {
        const estado = await consultar(actual)
        if (cancelado) return
        if (estado.status === 'verified') {
          setFase('verificado')
          if (!avisado.current) {
            avisado.current = true
            onVerificado?.(estado)
          }
          return
        }
        if (estado.status === 'failed') return setFase('fallido')
        if (estado.status === 'expired') return setFase('vencido')
      } catch {
        // A network blip: keep waiting until the code expires.
      }
      timer = setTimeout(() => void tick(), INTERVALO_MS)
    }
    timer = setTimeout(() => void tick(), INTERVALO_MS)
    return () => {
      cancelado = true
      clearTimeout(timer)
    }
  }, [actual, consultar, fase, onVerificado])

  async function nuevoCodigo() {
    if (!renovar) return
    setError('')
    try {
      const siguiente = await renovar(actual)
      setActual(siguiente)
      setFase('listo')
      setCopiado(false)
    } catch (cause) {
      setError(mensajeErrorTelefono(cause))
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(actual.message)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  if (fase === 'verificado')
    return (
      <div aria-live="polite" className={styles.success} role="status">
        <p className={styles.verifiedTitle}>✓ Número verificado</p>
        <p className={styles.verifiedText}>{textoExito}</p>
      </div>
    )

  return (
    <section aria-labelledby="verificar-telefono-titulo" className={styles.whatsappBox}>
      <h2 className={styles.whatsappTitle} id="verificar-telefono-titulo">Verificá tu número</h2>
      <p className={styles.whatsappText}>
        Tocá el botón, enviá el mensaje por WhatsApp y volvé a TUS. Número: <strong>{actual.phoneMasked}</strong>
      </p>
      {actual.whatsappUrl ? (
        <a className={styles.primary} href={actual.whatsappUrl} onClick={() => setFase('esperando')} rel="noopener noreferrer" target="_blank">
          Verificar con WhatsApp
        </a>
      ) : (
        <p className={styles.notice}>Enviá este mensaje al WhatsApp de TUS desde tu teléfono:</p>
      )}
      <p className={styles.codeBox}>
        <span>Mensaje a enviar:</span> <strong>{actual.message}</strong>
        <button className={styles.inlineButton} onClick={() => void copiar()} type="button">{copiado ? 'Copiado' : 'Copiar'}</button>
      </p>
      <p aria-live="polite" className={styles.waiting} role="status">
        {fase === 'esperando' ? 'Esperando verificación…' : fase === 'vencido' ? 'El código venció. Generá uno nuevo.' : fase === 'fallido' ? 'No pudimos verificar este número. Probá con otro código o con otro número.' : 'Cuando envíes el mensaje, esta pantalla se actualiza sola.'}
      </p>
      {(fase === 'vencido' || fase === 'fallido' || fase === 'esperando') && renovar ? (
        <button className={styles.secondaryButton} onClick={() => void nuevoCodigo()} type="button">
          Generar un código nuevo
        </button>
      ) : null}
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
    </section>
  )
}
