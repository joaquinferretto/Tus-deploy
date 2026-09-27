import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { ResetPasswordForm } from '@/features/auth/email-flows'

export const metadata: Metadata = {
  title: 'Restablecer contraseña | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Usá una frase larga que no uses en otros sitios." title="Elegí una contraseña nueva">
      <ResetPasswordForm />
    </AuthShell>
  )
}
