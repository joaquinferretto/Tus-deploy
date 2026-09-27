import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { VerifyEmailFlow } from '@/features/auth/email-flows'

export const metadata: Metadata = {
  title: 'Verificar email | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Confirmamos tu email para activar la cuenta." title="Confirmá tu email">
      <VerifyEmailFlow />
    </AuthShell>
  )
}
