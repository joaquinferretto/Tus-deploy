import { MercadoServicios } from '@/components/mercado/mercado-servicios'

export default async function PublicacionPage({
  params,
}: {
  params: Promise<{ listingId: string }>
}): Promise<React.ReactNode> {
  const { listingId } = await params
  return <MercadoServicios listingId={listingId} />
}
