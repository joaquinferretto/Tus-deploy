import { AdminPrestadorDetallePage } from '@/components/admin/admin-prestador-detalle'

export default async function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  const { id } = await params
  return <AdminPrestadorDetallePage id={decodeURIComponent(id)} />
}
