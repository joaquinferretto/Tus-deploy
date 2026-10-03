import { permanentRedirect } from 'next/navigation'

// The worker directory lives at /trabajadores; this address only keeps old links working. Only
// the two filters the directory reads are carried over, bounded.
export default async function BuscarTrabajadorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<never> {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const key of ['q', 'oficio'] as const) {
    const value = params[key]
    if (typeof value === 'string' && value.trim()) query.set(key, value.trim().slice(0, 80))
  }
  const suffix = query.toString()
  permanentRedirect(suffix ? `/trabajadores?${suffix}` : '/trabajadores')
}
