import { formatearPesos } from '@factory/contracts'
import { createEmailTransportFromEnv, emailLayout, type EmailTransport } from '../../auth-security/adapters/email/email-senders.ts'

// Notices of the turno requests. The request itself is the notice inside TUS (the provider sees it
// in "Solicitudes de reserva", the client in "Mis turnos"); this port adds the outbound notice.
// Always after the commit and never part of the decision: a failed delivery changes nothing.
export interface NotificadorTurnos {
  // A client requested a turno: the provider has something to accept or reject.
  solicitudRecibida(aviso: AvisoSolicitudTurno): Promise<void>
  // The provider answered (or the time was no longer free): the client knows the result.
  solicitudRespondida(aviso: AvisoRespuestaTurno): Promise<void>
  // The verified payment of the deposit confirmed the turno: the client and the provider know.
  turnoConfirmado(aviso: AvisoTurnoConfirmado): Promise<void>
}

export interface AvisoTurnoConfirmado {
  reservaId: string
  clienteCuentaId: string
  // Account of the provider (its recipient is resolved from it) and how its client is named.
  prestadorTenantId: string
  clienteNombre: string
  prestadorNombre: string
  servicio: string
  inicio: Date
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
  // awaiting_payment: accepted, the deposit is due. confirmed: accepted with nothing to pay.
  resultado: 'awaiting_payment' | 'confirmed' | 'rejected'
  prestadorNombre: string
  servicio: string
  inicio: Date
  // Deposit of an accepted turno (TURNOS-SENA-01), computed by the backend. `url`: the hosted
  // Mercado Pago checkout of THAT deposit when it could be prepared; null otherwise.
  sena?: { monto: number; moneda: string; pagable: boolean; url: string | null } | null
}

export const SIN_NOTIFICADOR_TURNOS: NotificadorTurnos = {
  solicitudRecibida: async () => {},
  solicitudRespondida: async () => {},
  turnoConfirmado: async () => {},
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
    if (aviso.resultado === 'confirmed') {
      await this.transporte.send({
        to: cuenta.user.email,
        subject: '¡Tu turno quedó confirmado!',
        ...emailLayout('Turno confirmado', [`${aviso.prestadorNombre} aceptó tu solicitud: tu turno de ${aviso.servicio} del ${cuando(aviso.inicio)} quedó confirmado.`], { label: 'Ver mis turnos', url: this.url('/mis-turnos') }),
      })
      return
    }
    const aceptada = aviso.resultado === 'awaiting_payment'
    await this.transporte.send({
      to: cuenta.user.email,
      subject: aceptada ? 'Tu solicitud fue aceptada: aboná la seña' : 'Tu solicitud de turno en TUS fue rechazada',
      ...emailLayout(
        aceptada ? 'Esperando pago de seña' : 'Solicitud rechazada',
        [
          aceptada
            ? `${aviso.prestadorNombre} aceptó tu solicitud de ${aviso.servicio} del ${cuando(aviso.inicio)}. Para confirmar definitivamente el turno tenés que abonar la seña.`
            : `${aviso.prestadorNombre} no pudo tomar tu solicitud de ${aviso.servicio} del ${cuando(aviso.inicio)}. Podés elegir otro horario u otro profesional.`,
          // The deposit is paid from "Mis turnos" (signed in): the email never carries a payment link.
          ...(aceptada && aviso.sena
            ? [aviso.sena.pagable ? `La seña es de ${formatearPesos(aviso.sena.monto)}. Podés abonarla con Mercado Pago desde "Mis turnos".` : `La seña es de ${formatearPesos(aviso.sena.monto)}. El pago online todavía no está disponible; el turno sigue esperando el pago.`]
            : []),
        ],
        { label: aceptada && aviso.sena?.pagable ? `Pagar seña — ${formatearPesos(aviso.sena.monto)}` : 'Ver mis turnos', url: this.url('/mis-turnos') }
      ),
    })
  }

  async turnoConfirmado(aviso: AvisoTurnoConfirmado): Promise<void> {
    const [cuenta, prestador] = await Promise.all([
      this.cuentas.account.findFirst({ where: { id: aviso.clienteCuentaId, status: 'active' }, include: { user: true } }),
      this.cuentas.account.findFirst({ where: { tenantId: aviso.prestadorTenantId, status: 'active' }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
    ])
    // Each notice on its own: one failed delivery never silences the other.
    await Promise.allSettled([
      cuenta
        ? this.transporte.send({
            to: cuenta.user.email,
            subject: '¡Tu turno quedó confirmado!',
            ...emailLayout('Turno confirmado', [`Recibimos el pago de tu seña. ¡Tu turno quedó confirmado! ${aviso.servicio} con ${aviso.prestadorNombre}, ${cuando(aviso.inicio)}.`], { label: 'Ver mis turnos', url: this.url('/mis-turnos') }),
          })
        : Promise.resolve(),
      prestador
        ? this.transporte.send({
            to: prestador.user.email,
            subject: 'Un turno de tu agenda quedó confirmado',
            ...emailLayout('Turno confirmado', [`${aviso.clienteNombre} pagó la seña: el turno de ${aviso.servicio} del ${cuando(aviso.inicio)} quedó confirmado.`], { label: 'Ver mi agenda', url: this.url('/prestador/turnos') }),
          })
        : Promise.resolve(),
    ])
  }
}
