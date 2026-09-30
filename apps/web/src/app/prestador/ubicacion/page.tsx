import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { ProviderLocationPage } from '@/features/provider/provider-location-page'
import styles from '@/features/work/work.module.css'

export const metadata: Metadata = {
  title: 'Ubicación en el mapa | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.page}>
        <h1>Ubicación en el mapa</h1>
        <nav aria-label="Prestador">
          <a href="/prestador/perfil-publico">Mi perfil público</a> · <a href="/prestador/solicitudes">Solicitudes</a> · <a href="/trabajos">Mis trabajos</a> · <a href="/prestador/pagos">Pagos</a>
        </nav>
        <p>Guardar tu ubicación no publica tu dirección: vos decidís si el mapa muestra el punto exacto o solo tu barrio o zona.</p>
        <ProviderLocationPage />
      </div>
    </SitePage>
  )
}
