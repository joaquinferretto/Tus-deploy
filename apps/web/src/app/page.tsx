import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { HomePage } from '@/features/home/home-page'

// Public marketplace home.
// PWA note: installable through the manifest; online operation requires connectivity (there is
// no offline mode and no service worker update flow).
export const metadata: Metadata = {
  title: 'TUS | Servicios cerca tuyo',
  description:
    'Encontrá profesionales de tu zona para arreglos, reparaciones y servicios del hogar. Pedí presupuestos, elegí y pagá con Mercado Pago.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'TUS | Servicios cerca tuyo',
    description: 'Conectamos personas que necesitan una solución con profesionales disponibles en su zona.',
    locale: 'es_AR',
    type: 'website',
  },
}

export default function Page(): React.ReactNode {
  return <HomePage logo={<TusLogo variant="header" />} />
}
