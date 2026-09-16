import { CompromisosCliente } from '@/components/compromisos/compromisos-cliente'

export default async function CompromisoPage({
  params,
}: {
  params: Promise<{ commitmentId: string }>
}): Promise<React.ReactNode> {
  const { commitmentId } = await params
  return <CompromisosCliente commitmentId={commitmentId} />
}
