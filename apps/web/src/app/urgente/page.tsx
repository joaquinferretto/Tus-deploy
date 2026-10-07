import type { Metadata } from 'next'

import { AuthShell } from '@/features/auth/auth-shell'
import { TusLogo } from '@/features/brand/tus-logo'
import { UrgentRequest } from '@/features/urgent/urgent-request'

export const metadata: Metadata = {
  title: 'Servicio urgente | TUS',
  robots: { index: false, follow: false },
}

// SERVICIO-URGENTE-01: the request goes at once to every compatible provider; the first that
// accepts is assigned. The normal flow (compare and choose) lives in "Buscar trabajador".
export default function UrgentRequestPage(): React.ReactNode {
  return (
    <AuthShell
      logo={<TusLogo variant="auth" />}
      subtitle="Lo ofrecemos al mismo tiempo a todos los prestadores disponibles. El primero que acepta queda asignado."
      title="Servicio urgente"
      visualTitle="Atención inmediata, cerca tuyo."
    >
      <UrgentRequest />
    </AuthShell>
  )
}
