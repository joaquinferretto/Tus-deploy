'use client'

import { useEffect, useState } from 'react'

import { createTusWebAuthClient, panelFor, type TusAccountCapabilities } from '../../lib/tus-auth-client'

export type AccountView =
  | { status: 'unknown' }
  | { status: 'guest' }
  | { status: 'signed-in'; capabilities: TusAccountCapabilities; panel: ReturnType<typeof panelFor> }

// Session + real role, both confirmed by the API (/auth/session): the header, the footer and
// "Mi perfil" never decide a role from local data, emails or names. One request per page load is
// shared by every component that asks.
let pending: Promise<AccountView> | null = null

async function loadAccountView(): Promise<AccountView> {
  let client: ReturnType<typeof createTusWebAuthClient>
  try {
    client = createTusWebAuthClient()
  } catch {
    return { status: 'guest' }
  }
  const restored = await client.restore('/').catch(() => null)
  if (!restored || restored.status !== 'authenticated' || !restored.session) return { status: 'guest' }
  const capabilities = (await client.capabilities()) ?? { platformAdmin: false, provider: false }
  return { status: 'signed-in', capabilities, panel: panelFor(capabilities) }
}

export function useAccountView(): AccountView {
  const [view, setView] = useState<AccountView>({ status: 'unknown' })
  useEffect(() => {
    let cancelled = false
    pending ??= loadAccountView()
    void pending.then((result) => {
      if (!cancelled) setView(result)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return view
}
