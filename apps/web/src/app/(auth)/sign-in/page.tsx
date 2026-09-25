import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { LoginForm } from '@/features/auth/login-form'

export const metadata: Metadata = {
  title: 'Iniciar sesión | TUS',
  robots: { index: false, follow: false },
}

export default function SignInPage(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Ingresá para ver tus solicitudes, trabajos y pagos." title="Bienvenido de nuevo">
      <LoginForm />
    </AuthShell>
  )
}
