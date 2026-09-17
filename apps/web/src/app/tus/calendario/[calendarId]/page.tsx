import { CalendarioCliente } from '@/components/calendario/calendario-cliente'

export default async function CalendarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ calendarId: string }>
  searchParams: Promise<{ listingId?: string; serviceId?: string }>
}): Promise<React.ReactNode> {
  const [{ calendarId }, { listingId, serviceId }] = await Promise.all([params, searchParams])
  if (listingId !== undefined && listingId.trim().length > 0) {
    return <CalendarioCliente calendarId={calendarId} listingId={listingId} />
  }
  if (serviceId !== undefined && serviceId.trim().length > 0) {
    return <CalendarioCliente calendarId={calendarId} serviceId={serviceId} />
  }
  return (
    <section className="tus-state-box" aria-labelledby="calendar-dependency-title">
      <h1 id="calendar-dependency-title">Calendario</h1>
      <p>Esta agenda necesita el listingId real de la publicación para consultar disponibilidad.</p>
      <small className="tus-boundary-note">
        Los enlaces legacy existentes también pueden proporcionar serviceId de forma explícita.
      </small>
    </section>
  )
}
