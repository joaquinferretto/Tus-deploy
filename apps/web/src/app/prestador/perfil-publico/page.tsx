import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { ProviderPublicProfile } from '@/features/provider/provider-public-profile'
import styles from '@/features/directory/directory.module.css'

export const metadata: Metadata = {
  title: 'Mi perfil público | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.narrow}>
        <h1 className={styles.title}>Mi perfil público</h1>
        <p className={styles.subtitle}>Cómo te encuentran los clientes en “Buscar trabajador” y en el asistente de TUS.</p>
        <div style={{ marginTop: 24 }}>
          <ProviderPublicProfile />
        </div>
      </div>
    </SitePage>
  )
}
