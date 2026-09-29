import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { WorkPage } from '@/features/work/work-page'

export const metadata = {
  title: 'Trabajo y mensajes | TUS',
  robots: { index: false, follow: false },
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.ReactNode> {
  const { id } = await params
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <WorkPage id={id} />
    </SitePage>
  )
}
