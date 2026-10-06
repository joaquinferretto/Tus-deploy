import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { HelpLink } from '@/features/help/help-link'
import { ProviderTurnos } from '@/features/provider/provider-turnos'
import styles from '@/features/directory/directory.module.css'
import { ProviderNav } from '@/features/provider/provider-nav'

export const metadata: Metadata = {
  title: 'Turnos y Agenda | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.narrow}>
        <h1 className={styles.title}>Mis Turnos y Agenda</h1>
        <ProviderNav />
        <p className={styles.subtitle}>
          Gestioná tus citas agendadas, registrá turnos presenciales y bloqueá horarios no disponibles.
        </p>
        <HelpLink href="/ayuda/prestadores/disponibilidad">¿Cómo configurar mis horarios?</HelpLink>
        <div style={{ marginTop: 24 }}>
          <ProviderTurnos />
        </div>
      </div>
    </SitePage>
  )
}
