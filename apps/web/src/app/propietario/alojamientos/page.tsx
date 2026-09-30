import type { Metadata } from 'next'
import { PropietarioAlojamientosView } from '@/features/alojamientos/propietario-alojamientos'
import { PublicHeader } from '@/features/home/public-header'
import { TusLogo } from '@/features/brand/tus-logo'
import { SiteFooter } from '@/features/home/site-footer'

export const metadata: Metadata = {
  title: 'Mis Alojamientos | TUS',
  description: 'Panel de control para propietarios y gestores de alojamientos.',
}

export default function Page(): React.ReactNode {
  return (
    <>
      <PublicHeader logo={<TusLogo variant="header" />} />
      <main style={{ minHeight: '85vh', backgroundColor: '#f9fafb' }}>
        <PropietarioAlojamientosView />
      </main>
      <SiteFooter />
    </>
  )
}
