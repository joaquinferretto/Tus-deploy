import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { HelpLink } from '@/features/help/help-link'
import { ProviderInbox } from '@/features/provider/provider-inbox'
import { ProviderOpenRequests } from '@/features/provider/provider-open-requests'
import { ProviderUrgent } from '@/features/provider/provider-urgent'
import styles from '@/features/directory/directory.module.css'
import { ProviderNav } from '@/features/provider/provider-nav'

export const metadata: Metadata = {
  title: 'Solicitudes | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.narrow}>
        <h1 className={styles.title}>Solicitudes recibidas</h1>
        <ProviderNav />
        <p className={styles.subtitle}>Clientes que te eligieron. Nada queda confirmado hasta que aceptes.</p>
        <HelpLink href="/ayuda/prestadores/solicitudes">¿Cómo funcionan las solicitudes?</HelpLink>
        <div style={{ marginTop: 24 }}>
          <ProviderUrgent />
        </div>
        <div style={{ marginTop: 32 }}>
          <ProviderInbox />
        </div>
        <div style={{ marginTop: 40 }}>
          <ProviderOpenRequests />
        </div>
      </div>
    </SitePage>
  )
}
