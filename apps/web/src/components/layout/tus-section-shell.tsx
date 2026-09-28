'use client'

import { usePathname } from 'next/navigation'

import { TusAppShell } from './tus-app-shell'

// The platform administration has its own frame (sidebar in the TUS identity); the rest of /tus
// keeps the workspace shell.
export function TusSectionShell({ children }: { children: React.ReactNode }): React.ReactNode {
  const pathname = usePathname() ?? ''
  if (pathname === '/tus/admin' || pathname.startsWith('/tus/admin/')) return <>{children}</>
  return <TusAppShell>{children}</TusAppShell>
}
