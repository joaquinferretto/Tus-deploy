import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { WorkPage } from '@/features/work/work-page'

export const metadata = { title: 'Mis trabajos | TUS', robots: { index: false, follow: false } }
export default function Page(): React.ReactNode {
  return (
    <SitePage footer={false} logo={<TusLogo variant="header" />}>
      <WorkPage />
    </SitePage>
  )
}
