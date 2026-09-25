import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { MyRequestsPage } from '@/features/requests/my-requests-page'

export const metadata: Metadata = {
  title: 'Mis solicitudes | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <MyRequestsPage />
    </SitePage>
  )
}
