'use client'

import { useEffect, useState } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '../../lib/tus-auth-client'
import type { TusWebSession } from '../../lib/tus-ui-contract'

export type SessionView =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'unavailable' }
  | { status: 'authenticated'; session: TusWebSession }

// Session confirmed by the server (/auth/session) on every page load; never trusted from local
// storage alone. Public pages keep working for guests and when the API URL is misconfigured.
export function useTusSession(returnTo: string): SessionView {
  const [view, setView] = useState<SessionView>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    let client: ReturnType<typeof createTusWebAuthClient>
    try {
      client = createTusWebAuthClient()
    } catch {
      setView({ status: 'unavailable' })
      return
    }
    void client
      .restore(returnTo)
      .then((result) => {
        if (cancelled) return
        if (result.status === 'authenticated' && result.session) setView({ status: 'authenticated', session: toTusWebSession(result.session) })
        else if (result.status === 'unavailable') setView({ status: 'unavailable' })
        else setView({ status: 'guest' })
      })
      .catch(() => {
        if (!cancelled) setView({ status: 'guest' })
      })
    return () => {
      cancelled = true
    }
  }, [returnTo])
  return view
}
