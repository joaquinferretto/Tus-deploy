import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { RecoveryWhatsappForm } from '@/features/auth/phone-flows'

export const metadata: Metadata = {
  title: 'Recuperar por WhatsApp | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Confirmá tu número desde WhatsApp y elegí una contraseña nueva." title="Recuperar mi contraseña">
      <RecoveryWhatsappForm />
    </AuthShell>
  )
}
