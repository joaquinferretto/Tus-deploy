import type { Metadata } from 'next'
import { AlojamientoDetail } from '@/features/alojamientos/alojamiento-detail'
import { PublicHeader } from '@/features/home/public-header'
import { TusLogo } from '@/features/brand/tus-logo'
import { SiteFooter } from '@/features/home/site-footer'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Alojamiento ${id} | TUS`,
    description: `Detalles, disponibilidad y reservas para alojamiento en TUS.`,
  }
}

export default async function Page({ params }: PageProps): Promise<React.ReactNode> {
  const { id } = await params
  return (
    <>
      <PublicHeader logo={<TusLogo variant="header" />} />
      <main style={{ minHeight: '80vh', backgroundColor: '#f9fafb', paddingBottom: '3rem' }}>
        <AlojamientoDetail idOrSlug={id} />
      </main>
      <SiteFooter />
    </>
  )
}
