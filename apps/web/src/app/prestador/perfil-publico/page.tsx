import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { HelpLink } from '@/features/help/help-link'
import { ProviderPublicProfile } from '@/features/provider/provider-public-profile'
import styles from '@/features/directory/directory.module.css'
import { ProviderNav } from '@/features/provider/provider-nav'

export const metadata: Metadata = {
  title: 'Mi perfil público | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.narrow}>
        <h1 className={styles.title}>Mi perfil público</h1>
        <ProviderNav />
        <p className={styles.subtitle}>Cómo te encuentran los clientes en “Buscar trabajador” y en el asistente de TUS.</p>
        <HelpLink href="/ayuda/prestadores/perfil-publico">¿Cómo mejorar mi perfil público?</HelpLink>
        <div style={{ marginTop: 24 }}>
          <ProviderPublicProfile />
        </div>
      </div>
    </SitePage>
  )
}
