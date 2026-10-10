import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { MisTurnosPage } from '@/features/turnos/mis-turnos-page'

export const metadata: Metadata = {
  title: 'Mis turnos | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage footer={false} logo={<TusLogo variant="header" />}>
      <MisTurnosPage />
    </SitePage>
  )
}
