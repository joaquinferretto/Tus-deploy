import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { WorkerProfile } from '@/features/directory/worker-profile'
import { SitePage } from '@/features/home/site-page'

export const metadata: Metadata = {
  title: 'Perfil del profesional | TUS',
}

export default async function WorkerProfilePage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  const { id } = await params
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <WorkerProfile id={id} />
    </SitePage>
  )
}
