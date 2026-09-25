import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { ProfilePage } from '@/features/profile/profile-page'

export const metadata: Metadata = {
  title: 'Mi perfil | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <ProfilePage />
    </SitePage>
  )
}
