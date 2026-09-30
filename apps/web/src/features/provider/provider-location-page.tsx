'use client'

import { useCallback, useEffect } from 'react'

import { createDirectoryClient } from '../directory/directory-client'
import { useTusSession } from '../session/use-tus-session'
import { LocationEditor } from './provider-location'

const client = createDirectoryClient()
const RETURN_TO = '/prestador/ubicacion'

// The provider places its OWN pin: the API resolves the provider from the session.
export function ProviderLocationPage(): React.ReactNode {
  const auth = useTusSession(RETURN_TO)
  useEffect(() => {
    if (auth.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }, [auth.status])
  const session = auth.status === 'authenticated' ? auth.session : null
  const load = useCallback(async () => (session ? (await client.myLocation(session)).location : null), [session])
  const save = useCallback(async (input: { lat: number; lng: number; showExact: boolean }) => (await client.saveMyLocation(session!, input)).location, [session])
  const remove = useCallback(async () => (await client.removeMyLocation(session!)).location, [session])
  if (!session) return <p role="status">Verificando tu sesión…</p>
  return <LocationEditor load={load} remove={remove} save={save} />
}
