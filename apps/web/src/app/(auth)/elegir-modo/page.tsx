import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { AuthShell } from '@/features/auth/auth-shell'
import { ModeChoice } from '@/features/session/mode-choice'

export const metadata: Metadata = {
  title: '¿Cómo querés usar TUS? | TUS',
  robots: { index: false, follow: false },
}

export default function ElegirModoPage(): React.ReactNode {
  return (
    <AuthShell logo={<TusLogo variant="auth" />} subtitle="Podés cambiarlo cuando quieras desde el menú de tu cuenta." title="¿Cómo querés usar TUS?">
      <ModeChoice />
    </AuthShell>
  )
}
