'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { exemptFromProfile, needsProfile, profileRoute } from '../../lib/tus-auth-client'
import { useAccountView } from '../session/use-account-view'

// Onboarding. A signed-in person whose required personal profile is incomplete is taken to
// "Mi perfil" and comes back to where they were going (returnTo). It never loops: the profile, the
// auth screens and the administration panel are exempt, and an account that is not asked for a
// profile (platform administration) is never redirected. Visitors are untouched.
export function ProfileGate(): null {
  const pathname = usePathname() ?? '/'
  const account = useAccountView()
  const incomplete = account.status === 'signed-in' && needsProfile(account.capabilities)

  useEffect(() => {
    if (!incomplete || exemptFromProfile(pathname)) return
    window.location.replace(profileRoute(`${pathname}${window.location.search}`))
  }, [incomplete, pathname])

  return null
}
