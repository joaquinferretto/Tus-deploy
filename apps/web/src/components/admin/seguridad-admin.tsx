'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { adminMfa, mensajeErrorMfa } from '@/lib/tus-admin-mfa'
import type { TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton } from '../../app/tus/tus-ui'
import { CodigosRecuperacion } from './admin-mfa-gate'

// Admin second factor management (rendered only behind AdminMfaGate): regenerate recovery codes
// (needs a current code) or turn MFA off (current password + code; the API enforces both).
export function SeguridadAdmin(): ReactNode {
  const [session, setSession] = useState<TusWebSession | null>(null)
  const [codigos, setCodigos] = useState<string[] | null>(null)
  const [codigoRegenerar, setCodigoRegenerar] = useState('')
  const [password, setPassword] = useState('')
  const [codigoDesactivar, setCodigoDesactivar] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => setSession(result.session === undefined ? null : toTusWebSession(result.session)))
  }, [])

  async function regenerar(event: FormEvent) {
    event.preventDefault()
    if (!session) return
    setEnviando(true)
    setMensaje('')
    try {
      setCodigos((await adminMfa.regenerate(session, codigoRegenerar.trim())).recoveryCodes)
      setCodigoRegenerar('')
    } catch (cause) {
      setMensaje(mensajeErrorMfa(cause))
    } finally {
      setEnviando(false)
    }
  }

  async function desactivar(event: FormEvent) {
    event.preventDefault()
    if (!session) return
    setEnviando(true)
    setMensaje('')
    try {
      await adminMfa.disable(session, password, codigoDesactivar.trim())
      window.location.assign('/tus/admin/seguridad')
    } catch (cause) {
      setMensaje(mensajeErrorMfa(cause))
    } finally {
      setEnviando(false)
      setPassword('')
    }
  }

  if (codigos) return <CodigosRecuperacion codigos={codigos} onListo={() => setCodigos(null)} />

  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <Link href="/tus/admin/identidad">Identidad</Link>
        <Link href="/tus/admin/whatsapp">WhatsApp</Link>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">Plataforma / seguridad</p>
          <h1>Segundo factor de administración</h1>
        </div>
      </header>
      {mensaje ? <p role="alert">{mensaje}</p> : null}
      <section aria-labelledby="mfa-regen-title" className="tus-state-box">
        <h2 id="mfa-regen-title">Códigos de recuperación</h2>
        <p>Generar códigos nuevos invalida todos los anteriores.</p>
        <form className="tus-support-form" onSubmit={(event) => void regenerar(event)} noValidate>
          <label htmlFor="mfa-regen-code">Código actual de la app autenticadora</label>
          <input autoComplete="one-time-code" id="mfa-regen-code" inputMode="numeric" maxLength={6} onChange={(event) => setCodigoRegenerar(event.target.value)} value={codigoRegenerar} />
          <TusActionButton disabled={codigoRegenerar.trim().length !== 6} loading={enviando} type="submit">
            Generar códigos nuevos
          </TusActionButton>
        </form>
      </section>
      <section aria-labelledby="mfa-disable-title" className="tus-state-box">
        <h2 id="mfa-disable-title">Desactivar el segundo factor</h2>
        <p>Sin segundo factor la cuenta pierde el acceso de administración hasta volver a configurarlo.</p>
        <form className="tus-support-form" onSubmit={(event) => void desactivar(event)} noValidate>
          <label htmlFor="mfa-disable-password">Contraseña actual</label>
          <input autoComplete="current-password" id="mfa-disable-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          <label htmlFor="mfa-disable-code">Código de la app o de recuperación</label>
          <input autoComplete="one-time-code" id="mfa-disable-code" onChange={(event) => setCodigoDesactivar(event.target.value)} value={codigoDesactivar} />
          <TusActionButton disabled={codigoDesactivar.trim().length < 6} loading={enviando} type="submit">
            Desactivar
          </TusActionButton>
        </form>
      </section>
    </>
  )
}
