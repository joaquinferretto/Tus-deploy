import type { Metadata } from 'next'
import { AlojamientosDirectory } from '@/features/alojamientos/alojamientos-directory'
import { PublicHeader } from '@/features/home/public-header'
import { TusLogo } from '@/features/brand/tus-logo'
import { SiteFooter } from '@/features/home/site-footer'

export const metadata: Metadata = {
  title: 'Alojamientos | TUS',
  description: 'Encontrá y reservá hoteles, cabañas, departamentos y habitaciones verificados.',
}

export default function Page(): React.ReactNode {
  return (
    <>
      <PublicHeader logo={<TusLogo variant="header" />} />
      <main style={{ minHeight: '80vh', backgroundColor: '#f9fafb' }}>
        <AlojamientosDirectory />
      </main>
      <SiteFooter />
    </>
  )
}
