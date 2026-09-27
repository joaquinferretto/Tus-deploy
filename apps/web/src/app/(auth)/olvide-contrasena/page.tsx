import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { ForgotPasswordForm } from '@/features/auth/email-flows'

export const metadata: Metadata = {
  title: 'Olvidé mi contraseña | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Te mandamos un enlace para elegir una contraseña nueva." title="Olvidé mi contraseña">
      <ForgotPasswordForm />
    </AuthShell>
  )
}
