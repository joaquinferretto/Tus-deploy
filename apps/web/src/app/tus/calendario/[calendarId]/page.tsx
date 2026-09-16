import { CalendarioCliente } from '@/components/calendario/calendario-cliente'

export default async function CalendarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ calendarId: string }>
  searchParams: Promise<{ serviceId?: string }>
}): Promise<React.ReactNode> {
  const [{ calendarId }, { serviceId }] = await Promise.all([params, searchParams])
  if (serviceId === undefined || serviceId.trim().length === 0) {
    return (
      <section className="tus-state-box" aria-labelledby="calendar-dependency-title">
        <h1 id="calendar-dependency-title">Calendario</h1>
        <p>
          Este calendario necesita el serviceId real de la publicación. Discovery todavía no entrega
          la relación publicación-calendario.
        </p>
        <small className="tus-boundary-note">DEPENDENCIA BACKEND: vincular discovery con calendarId y serviceId.</small>
      </section>
    )
  }
  return <CalendarioCliente calendarId={calendarId} serviceId={serviceId} />
}
