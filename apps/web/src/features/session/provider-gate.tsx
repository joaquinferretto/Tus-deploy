'use client'

import { useEffect, useRef } from 'react'

import { canSwitchMode, createTusWebAuthClient, modeOf } from '@/lib/tus-auth-client'

import { refreshAccountView, useAccountView } from './use-account-view'

// The provider surface of the Web (/prestador/*). The API is the authority — it refuses every
// provider operation of an account that is not an approved provider — and this takes the person
// out of the screens early instead of showing them empty:
// - no session: to sign in, coming back here;
// - an account that cannot be a provider (never was, or its provider is suspended): to the client
//   home, with the reason when it is a suspension;
// - an approved provider that is using TUS as a client and opens a provider screen (a link, a
//   notice): the session switches to the provider mode — validated by the API — and stays.
// Nothing is drawn until the API answered: no provider screen flashes for somebody else.
export function ProviderGate({ children }: { children: React.ReactNode }): React.ReactNode {
  const account = useAccountView()
  const cambiando = useRef(false)
  const signedIn = account.status === 'signed-in'
  const capabilities = signedIn ? account.capabilities : null
  // The platform administration keeps the access it always had to these screens.
  const puede = signedIn && (capabilities!.provider || capabilities!.platformAdmin)
  const enModo = signedIn && (capabilities!.platformAdmin || modeOf(capabilities) === 'PROVIDER')

  useEffect(() => {
    if (account.status === 'unknown') return
    if (account.status === 'guest') {
      window.location.replace(`/sign-in?returnTo=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    if (!puede) {
      window.location.replace(capabilities?.providerStatus === 'suspended' ? '/?aviso=prestador-suspendido' : '/')
      return
    }
    if (!enModo && canSwitchMode(capabilities) && !cambiando.current) {
      cambiando.current = true
      void createTusWebAuthClient().setMode('PROVIDER').then(() => refreshAccountView())
    }
  }, [account.status, puede, enModo, capabilities])

  if (!puede || !enModo) return <p aria-live="polite" role="status" style={{ padding: 24 }}>Cargando…</p>
  return <>{children}</>
}
