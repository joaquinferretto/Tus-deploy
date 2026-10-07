import type { Metadata } from 'next'
import { MisReservasAlojamiento } from '@/features/alojamientos/mis-reservas'
import { PublicHeader } from '@/features/home/public-header'
import { TusLogo } from '@/features/brand/tus-logo'
import { SiteFooter } from '@/features/home/site-footer'

export const metadata: Metadata = {
  title: 'Mis reservas | TUS',
  description: 'Tus reservas de alojamiento en TUS.',
}

export default function Page(): React.ReactNode {
  return (
    <>
      <PublicHeader logo={<TusLogo variant="header" />} />
      <main style={{ minHeight: '80vh', backgroundColor: '#f9fafb' }}>
        <MisReservasAlojamiento />
      </main>
      <SiteFooter logo={<TusLogo variant="header" />} />
    </>
  )
}
