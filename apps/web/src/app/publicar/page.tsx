import type { Metadata } from 'next'

import { AuthShell } from '@/features/auth/auth-shell'
import { TusLogo } from '@/features/brand/tus-logo'
import { PublishRequest } from '@/features/requests/publish-request'

export const metadata: Metadata = {
  title: 'Publicar solicitud | TUS',
  robots: { index: false, follow: false },
}

// Clients publish what they need; it shows up on the home map (approximate barrio only).
export default function PublishRequestPage(): React.ReactNode {
  return (
    <AuthShell
      logo={<TusLogo variant="auth" />}
      subtitle="Contá qué necesitás y los profesionales de tu zona te van a ver en el mapa."
      title="Publicá tu solicitud"
      visualTitle="Profesionales de Corrientes, cerca tuyo."
    >
      <PublishRequest />
    </AuthShell>
  )
}
