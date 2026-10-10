import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { ProviderLocationPage } from '@/features/provider/provider-location-page'
import styles from '@/features/work/work.module.css'
import layout from '@/features/layout/layout.module.css'
import { ProviderNav } from '@/features/provider/provider-nav'

export const metadata: Metadata = {
  title: 'Ubicación en el mapa | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage footer={false} logo={<TusLogo variant="header" />}>
      <div className={`${styles.page} ${layout.dashboard}`}>
        <h1>Ubicación en el mapa</h1>
        <ProviderNav />
        <p>Guardar tu ubicación no publica tu dirección: vos decidís si el mapa muestra el punto exacto o solo tu barrio o zona.</p>
        <ProviderLocationPage />
      </div>
    </SitePage>
  )
}
