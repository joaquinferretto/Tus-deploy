import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { WorkerDirectory } from '@/features/directory/worker-directory'
import { SitePage } from '@/features/home/site-page'

export const metadata: Metadata = {
  title: 'Buscar trabajador | TUS',
  description: 'Explorá profesionales de Corrientes por oficio: plomería, electricidad, aire acondicionado, pintura y más.',
  alternates: { canonical: '/trabajadores' },
}

export default function WorkersPage(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <WorkerDirectory />
    </SitePage>
  )
}
