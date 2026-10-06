'use client'

import { useEffect, useState } from 'react'

import { canSwitchMode, getDefaultRouteForUser, type TusMode } from '@/lib/tus-auth-client'

import authStyles from '../auth/auth.module.css'
import { cambiarModo } from './account-menu'
import { useAccountView } from './use-account-view'

// "¿Cómo querés usar TUS?": asked once after signing in, to an account that can be both a client
// and a provider and has no previous mode. No password again: the session is already open. An
// account that has nothing to choose (one mode, or the administration) is sent where it belongs.
export function ModeChoice(): React.ReactNode {
  const account = useAccountView()
  const [busy, setBusy] = useState<TusMode | null>(null)
  const [error, setError] = useState('')
  const elige = account.status === 'signed-in' && canSwitchMode(account.capabilities)

  useEffect(() => {
    if (account.status === 'guest') window.location.replace('/sign-in')
    else if (account.status === 'signed-in' && !canSwitchMode(account.capabilities)) {
      const destino = getDefaultRouteForUser(account.capabilities)
      window.location.replace(destino === '/elegir-modo' ? '/' : destino)
    }
  }, [account])

  async function elegir(mode: TusMode) {
    setBusy(mode)
    setError('')
    if (!(await cambiarModo(mode))) {
      setBusy(null)
      setError('No pudimos entrar en ese modo. Probá de nuevo.')
    }
  }

  if (!elige) return <p aria-live="polite" role="status">Cargando…</p>
  return (
    <div className={authStyles.form} data-elegir-modo>
      <button className={authStyles.primary} data-elegir="CLIENT" disabled={busy !== null} onClick={() => void elegir('CLIENT')} type="button">
        {busy === 'CLIENT' ? 'Entrando…' : 'Entrar como cliente'}
      </button>
      <p style={{ margin: '0 0 12px', textAlign: 'center' }}>Buscar y contratar servicios</p>
      <button className={authStyles.secondaryButton} data-elegir="PROVIDER" disabled={busy !== null} onClick={() => void elegir('PROVIDER')} type="button">
        {busy === 'PROVIDER' ? 'Entrando…' : 'Entrar como prestador'}
      </button>
      <p style={{ margin: 0, textAlign: 'center' }}>Gestionar solicitudes y trabajos</p>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}
