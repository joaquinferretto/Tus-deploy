import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { ProviderInbox } from '@/features/provider/provider-inbox'
import { ProviderOpenRequests } from '@/features/provider/provider-open-requests'
import styles from '@/features/directory/directory.module.css'

export const metadata: Metadata = {
  title: 'Solicitudes | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.narrow}>
        <h1 className={styles.title}>Solicitudes recibidas</h1>
        <p className={styles.subtitle}>Clientes que te eligieron. Nada queda confirmado hasta que aceptes.</p>
        <div style={{ marginTop: 24 }}>
          <ProviderInbox />
        </div>
        <div style={{ marginTop: 40 }}>
          <ProviderOpenRequests />
        </div>
      </div>
    </SitePage>
  )
}
