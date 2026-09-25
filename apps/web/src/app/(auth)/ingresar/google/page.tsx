import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { GoogleSignInCompletion } from '@/features/auth/google-flow'

export const metadata: Metadata = {
  title: 'Ingresando con Google | TUS',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function GoogleSignInPage(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Estamos confirmando tu identidad con TUS." title="Ingresando con Google">
      <GoogleSignInCompletion />
    </AuthShell>
  )
}
