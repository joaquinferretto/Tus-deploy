import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { ProviderPayments } from '@/features/provider/provider-payments'
import styles from '@/features/work/work.module.css'

export const metadata: Metadata = {
  title: 'Pagos | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.page}>
        <h1>Pagos</h1>
        <nav aria-label="Prestador">
          <a href="/prestador/perfil-publico">Mi perfil público</a> · <a href="/prestador/solicitudes">Solicitudes</a> ·{' '}
          <a href="/trabajos">Mis trabajos</a>
        </nav>
        <ProviderPayments />
      </div>
    </SitePage>
  )
}
