import type { Metadata } from 'next'

import { AdminLayout } from '@/components/admin/admin-layout'

export const metadata: Metadata = {
  title: 'Administración | TUS',
  robots: { index: false, follow: false },
}

export default function TusAdminLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return <AdminLayout>{children}</AdminLayout>
}
