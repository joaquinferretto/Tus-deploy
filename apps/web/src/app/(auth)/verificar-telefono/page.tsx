import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { PendingPhoneForm } from '@/features/auth/phone-flows'

export const metadata: Metadata = {
  title: 'Verificar mi número | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Si creaste tu cuenta y no llegaste a verificarla, hacelo ahora por WhatsApp." title="Verificá tu número">
      <PendingPhoneForm />
    </AuthShell>
  )
}
