import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { AdminBootstrapForm } from '@/features/auth/email-flows'

export const metadata: Metadata = {
  title: 'Activar administración | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Confirmá tu cuenta de administración con el código de arranque del servidor." title="Activar administración">
      <AdminBootstrapForm />
    </AuthShell>
  )
}
