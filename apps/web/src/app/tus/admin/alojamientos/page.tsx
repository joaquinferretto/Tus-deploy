import type { Metadata } from 'next'
import { AdminAlojamientosView } from '@/components/admin/admin-alojamientos'
import { PublicHeader } from '@/features/home/public-header'
import { TusLogo } from '@/features/brand/tus-logo'
import { SiteFooter } from '@/features/home/site-footer'

export const metadata: Metadata = {
  title: 'Admin - Alojamientos | TUS',
  description: 'Gestión y administración comercial de alojamientos en TUS.',
}

export default function Page(): React.ReactNode {
  return (
    <>
      <PublicHeader logo={<TusLogo variant="header" />} />
      <main style={{ minHeight: '85vh', backgroundColor: '#f9fafb' }}>
        <AdminAlojamientosView />
      </main>
      <SiteFooter logo={<TusLogo variant="header" />} />
    </>
  )
}
