import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { GoogleSignupCompletion } from '@/features/auth/google-flow'

export const metadata: Metadata = {
  title: 'Completá tu registro | TUS',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function GoogleSignupPage(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Un último paso para crear tu cuenta con Google." title="Completá tu registro">
      <GoogleSignupCompletion />
    </AuthShell>
  )
}
