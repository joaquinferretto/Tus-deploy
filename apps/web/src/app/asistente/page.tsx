import type { Metadata } from 'next'

import { AssistantChat } from '@/features/assistant/assistant-chat'
import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'

export const metadata: Metadata = {
  title: 'Buscar servicios | TUS',
  description: 'Contale tu problema al asistente de TUS y encontrá profesionales reales de tu zona.',
  alternates: { canonical: '/asistente' },
}

export default function AssistantPage(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <AssistantChat />
    </SitePage>
  )
}
