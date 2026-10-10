import { createEmailTransportFromEnv, emailLayout, type EmailTransport } from '../../auth-security/adapters/email/email-senders.ts'

// ALOJAMIENTOS-AVISOS-01. The owner of a lodging is told, by email, when a reservation comes in
// and when its guest cancels it. Through the transport TUS already uses for account emails (when
// none is configured nothing is sent). The recipient is the email of the owner's ACCOUNT, read
// from the database; never an address taken from a request.
//
// It only tells: it decides nothing and moves no money (a lodging is paid at the place). A notice
// that cannot be sent never fails the reservation or its cancellation.

interface ReservaParaAviso {
  id: string
  estado: string
  clienteNombre: string
  fechaInicio: Date
  fechaFin: Date
  cantidadPersonas: number
  precioFinalSnapshot: bigint
  moneda: string
  unidad: { nombre: string }
  alojamiento: { nombre: string; propietarioId: string | null }
}

export interface ClientePrismaAvisosAlojamientos {
  reservaAlojamiento: { findUnique(args: { where: { id: string }; include: { unidad: true; alojamiento: true } }): Promise<ReservaParaAviso | null> }
  account: { findFirst(args: { where: Record<string, unknown>; include: { user: true } }): Promise<{ user: { email: string } } | null> }
}

export interface AvisosAlojamientos {
  reservaRecibida(reservaId: string): Promise<void>
  reservaCancelada(reservaId: string): Promise<void>
}

// A stay is made of calendar dates (stored at midnight UTC): read as such, never shifted.
const dia = (fecha: Date): string => `${String(fecha.getUTCDate()).padStart(2, '0')}/${String(fecha.getUTCMonth() + 1).padStart(2, '0')}/${fecha.getUTCFullYear()}`
const pesos = (monto: bigint, moneda: string): string => `${moneda === 'ARS' ? '$' : `${moneda} `}${new Intl.NumberFormat('es-AR').format(monto)}`

export class AvisosAlojamientosEmail implements AvisosAlojamientos {
  constructor(
    private readonly prisma: ClientePrismaAvisosAlojamientos,
    private readonly transporte: EmailTransport,
    private readonly webBaseUrl: string
  ) {}

  static desdeEnv(prisma: ClientePrismaAvisosAlojamientos, env: Record<string, string | undefined>): AvisosAlojamientos | null {
    const transporte = createEmailTransportFromEnv(env)
    return transporte ? new AvisosAlojamientosEmail(prisma, transporte, env['TUS_WEB_BASE_URL']?.trim() || 'https://tusservicios.shop') : null
  }

  private async contexto(reservaId: string): Promise<{ reserva: ReservaParaAviso; email: string } | null> {
    const reserva = await this.prisma.reservaAlojamiento.findUnique({ where: { id: reservaId }, include: { unidad: true, alojamiento: true } })
    if (!reserva?.alojamiento.propietarioId) return null
    const cuenta = await this.prisma.account.findFirst({ where: { id: reserva.alojamiento.propietarioId, status: 'active' }, include: { user: true } })
    return cuenta ? { reserva, email: cuenta.user.email } : null
  }

  private panel(): { label: string; url: string } {
    return { label: 'Ver las reservas de mis alojamientos', url: `${this.webBaseUrl.replace(/\/+$/u, '')}/propietario/alojamientos` }
  }

  async reservaRecibida(reservaId: string): Promise<void> {
    const contexto = await this.contexto(reservaId)
    // Only a reservation that IS confirmed is announced (a hold that was never confirmed is not).
    if (!contexto || contexto.reserva.estado !== 'confirmed') return
    const { reserva, email } = contexto
    await this.transporte.send({
      to: email,
      subject: `Nueva reserva en ${reserva.alojamiento.nombre}`,
      idempotencyKey: `alojamiento-reserva/${reserva.id}/propietario`,
      ...emailLayout(
        'Tenés una nueva reserva',
        [
          `${reserva.clienteNombre} reservó ${reserva.unidad.nombre} en ${reserva.alojamiento.nombre}.`,
          `Entrada: ${dia(reserva.fechaInicio)}. Salida: ${dia(reserva.fechaFin)}. Personas: ${reserva.cantidadPersonas}.`,
          `Total: ${pesos(reserva.precioFinalSnapshot, reserva.moneda)}, a pagar en el alojamiento. TUS no cobra esta reserva.`,
        ],
        this.panel()
      ),
    })
  }

  async reservaCancelada(reservaId: string): Promise<void> {
    const contexto = await this.contexto(reservaId)
    if (!contexto || !contexto.reserva.estado.startsWith('cancel')) return
    const { reserva, email } = contexto
    await this.transporte.send({
      to: email,
      subject: `Se canceló una reserva en ${reserva.alojamiento.nombre}`,
      idempotencyKey: `alojamiento-reserva-cancelada/${reserva.id}/propietario`,
      ...emailLayout(
        'Una reserva fue cancelada',
        [
          `${reserva.clienteNombre} canceló su reserva de ${reserva.unidad.nombre} en ${reserva.alojamiento.nombre}.`,
          `Era del ${dia(reserva.fechaInicio)} al ${dia(reserva.fechaFin)}, para ${reserva.cantidadPersonas} ${reserva.cantidadPersonas === 1 ? 'persona' : 'personas'}. Esas fechas vuelven a estar disponibles.`,
        ],
        this.panel()
      ),
    })
  }
}
