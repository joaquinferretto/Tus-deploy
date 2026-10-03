import type { Metadata } from 'next'
import Link from 'next/link'

import { TusLogo } from '@/features/brand/tus-logo'
import { HowItWorksSteps } from '@/features/home/how-it-works'
import { SitePage } from '@/features/home/site-page'
import styles from '@/features/home/home.module.css'

// The same three steps as the "¿Cómo funciona?" dialog of the header, on a page of their own so
// the content keeps an address that can be linked and indexed.
export const metadata: Metadata = {
  title: 'Cómo funciona | TUS',
  description: 'Contás qué necesitás, elegís al profesional y pagás con Mercado Pago cuando el trabajo está listo.',
  alternates: { canonical: '/como-funciona' },
}

export default function HowItWorksPage(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <section aria-labelledby="como-funciona-pagina-titulo" className={styles.section}>
        <h1 className={styles.sectionTitle} id="como-funciona-pagina-titulo">Cómo funciona TUS</h1>
        <div style={{ marginTop: 20 }}>
          <HowItWorksSteps heading="h2" />
        </div>
        <div className={styles.dialogActions}>
          <Link className={styles.buttonSecondary} href="/trabajadores">Buscar trabajador</Link>
          <Link className={styles.buttonPrimary} href="/">Buscar un servicio</Link>
        </div>
      </section>
    </SitePage>
  )
}
