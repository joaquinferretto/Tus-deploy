import { AdminUsuarioDetallePage } from '@/components/admin/admin-usuario-detalle'

export default async function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  const { id } = await params
  return <AdminUsuarioDetallePage id={decodeURIComponent(id)} />
}
