import { createEmailTransportFromEnv, emailLayout, type EmailTransport } from '../../auth-security/adapters/email/email-senders.ts'

// Notices of the turno requests. The request itself is the notice inside TUS (the provider sees it
// in "Solicitudes de reserva", the client in "Mis turnos"); this port adds the outbound notice.
// Always after the commit and never part of the decision: a failed delivery changes nothing.
export interface NotificadorTurnos {
  // A client requested a turno: the provider has something to accept or reject.
  solicitudRecibida(aviso: AvisoSolicitudTurno): Promise<void>
  // The provider answered (or the time was no longer free): the client knows the result.
  solicitudRespondida(aviso: AvisoRespuestaTurno): Promise<void>
}

export interface AvisoSolicitudTurno {
  reservaId: string
  // Account of the provider (the recipient is resolved from it, never taken from a request).
  prestadorTenantId: string
  clienteNombre: string
  servicio: string
  inicio: Date
  duracionMinutos: number
  expiraEn: Date
}

export interface AvisoRespuestaTurno {
  reservaId: string
  clienteCuentaId: string
  resultado: 'confirmed' | 'rejected'
  prestadorNombre: string
  servicio: string
  inicio: Date
}

export const SIN_NOTIFICADOR_TURNOS: NotificadorTurnos = {
  solicitudRecibida: async () => {},
  solicitudRespondida: async () => {},
}

interface ClienteCuentasNotificacion {
  account: { findFirst(args: { where: Record<string, unknown>; include: { user: true }; orderBy?: Record<string, unknown> }): Promise<{ user: { email: string } } | null> }
}

const ZONA = 'America/Argentina/Buenos_Aires'
// reservas.fecha_inicio holds UTC; people read Argentina time.
const cuando = (instante: Date) =>
  `${instante.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA })} a las ${instante.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA })} hs`

// Email through the transport TUS already uses for account emails (Resend when configured;
// otherwise nothing is sent). The recipient is the email of the account, read from the database.
export class NotificadorTurnosEmail implements NotificadorTurnos {
  constructor(
    private readonly cuentas: ClienteCuentasNotificacion,
    private readonly transporte: EmailTransport,
    private readonly webBaseUrl: string
  ) {}

  static desdeEnv(cuentas: ClienteCuentasNotificacion, env: Record<string, string | undefined>): NotificadorTurnos {
    const transporte = createEmailTransportFromEnv(env)
    if (!transporte) return SIN_NOTIFICADOR_TURNOS
    return new NotificadorTurnosEmail(cuentas, transporte, env['TUS_WEB_BASE_URL']?.trim() || 'https://tusservicios.shop')
  }

  private url(path: string): string {
    return `${this.webBaseUrl.replace(/\/+$/u, '')}${path}`
  }

  async solicitudRecibida(aviso: AvisoSolicitudTurno): Promise<void> {
    const cuenta = await this.cuentas.account.findFirst({ where: { tenantId: aviso.prestadorTenantId, status: 'active' }, include: { user: true }, orderBy: { createdAt: 'asc' } })
    if (!cuenta) return
    await this.transporte.send({
      to: cuenta.user.email,
      subject: 'Tenés una nueva solicitud de turno en TUS',
      ...emailLayout(
        'Nueva solicitud de turno',
        [
          `${aviso.clienteNombre} te solicitó un turno de ${aviso.servicio}.`,
          `Fecha y horario: ${cuando(aviso.inicio)} (${aviso.duracionMinutos} minutos).`,
          `El turno queda pendiente hasta que lo aceptes o lo rechaces. Si no respondés antes del ${cuando(aviso.expiraEn)}, la solicitud vence y el horario vuelve a ofrecerse.`,
        ],
        { label: 'Ver solicitudes de reserva', url: this.url('/prestador/turnos') }
      ),
    })
  }

  async solicitudRespondida(aviso: AvisoRespuestaTurno): Promise<void> {
    const cuenta = await this.cuentas.account.findFirst({ where: { id: aviso.clienteCuentaId, status: 'active' }, include: { user: true } })
    if (!cuenta) return
    const aceptada = aviso.resultado === 'confirmed'
    await this.transporte.send({
      to: cuenta.user.email,
      subject: aceptada ? 'Tu turno en TUS quedó confirmado' : 'Tu solicitud de turno en TUS fue rechazada',
      ...emailLayout(
        aceptada ? 'Turno confirmado' : 'Solicitud rechazada',
        [
          aceptada
            ? `${aviso.prestadorNombre} aceptó tu solicitud: tu turno de ${aviso.servicio} del ${cuando(aviso.inicio)} quedó confirmado.`
            : `${aviso.prestadorNombre} no pudo tomar tu solicitud de ${aviso.servicio} del ${cuando(aviso.inicio)}. Podés elegir otro horario u otro profesional.`,
        ],
        { label: 'Ver mis turnos', url: this.url('/mis-turnos') }
      ),
    })
  }
}
