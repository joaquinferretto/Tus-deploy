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

const listeners = new Set<(view: AccountView) => void>()

// After the person changes something the API reports in the capabilities (profile completed,
// locality changed): every mounted consumer gets the fresh view, with no page reload.
export function refreshAccountView(): Promise<AccountView> {
  pending = loadAccountView()
  const current = pending
  void current.then((result) => {
    if (pending === current) for (const listener of listeners) listener(result)
  })
  return current
}

export function useAccountView(): AccountView {
  const [view, setView] = useState<AccountView>({ status: 'unknown' })
  useEffect(() => {
    let cancelled = false
    const listener = (result: AccountView) => {
      if (!cancelled) setView(result)
    }
    listeners.add(listener)
    pending ??= loadAccountView()
    void pending.then(listener)
    return () => {
      cancelled = true
      listeners.delete(listener)
    }
  }, [])
  return view
}
