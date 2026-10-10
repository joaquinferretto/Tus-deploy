import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { HelpLink } from '@/features/help/help-link'
import { ProviderPayments } from '@/features/provider/provider-payments'
import styles from '@/features/work/work.module.css'
import layout from '@/features/layout/layout.module.css'
import { ProviderNav } from '@/features/provider/provider-nav'

export const metadata: Metadata = {
  title: 'Pagos | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage footer={false} logo={<TusLogo variant="header" />}>
      <div className={`${styles.page} ${layout.dashboard}`}>
        <h1>Pagos</h1>
        <ProviderNav />
        <p><HelpLink href="/ayuda/prestadores/mercado-pago">¿Cómo vincular Mercado Pago?</HelpLink> · <HelpLink href="/ayuda/prestadores/ganancias">¿Cómo funcionan mis ganancias?</HelpLink></p>
        <ProviderPayments />
      </div>
    </SitePage>
  )
}
