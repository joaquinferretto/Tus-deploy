import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { ChooseOwnPasswordForm } from '@/features/auth/email-flows'

export const metadata: Metadata = {
  title: 'Elegí tu contraseña | TUS',
  robots: { index: false, follow: false },
}

// ADMIN-CONTRASENA-TEMPORAL-01: first sign-in with a password the administration set.
export default function Page(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Te dieron una contraseña temporal. Antes de seguir, elegí la tuya: una frase larga que no uses en otros sitios." title="Elegí tu contraseña">
      <ChooseOwnPasswordForm />
    </AuthShell>
  )
}
