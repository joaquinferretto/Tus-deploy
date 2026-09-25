import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { RegisterForm } from '@/features/auth/register-form'

export const metadata: Metadata = {
  title: 'Crear cuenta | TUS',
  robots: { index: false, follow: false },
}

export default function RegisterPage(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Contratá servicios o ofrecé los tuyos en tu zona." title="Creá tu cuenta" visualTitle="Tu próxima solución está cerca.">
      <RegisterForm />
    </AuthShell>
  )
}
