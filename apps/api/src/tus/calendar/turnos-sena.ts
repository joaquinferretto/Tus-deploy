import type { Prisma, PrismaClient } from '@prisma/client'
import {
  CODIGO_PAGO_NO_DISPONIBLE,
  CODIGO_SENA_NO_PAGABLE,
  CODIGO_SENA_YA_PAGADA,
  type CheckoutSenaTurnoDTO,
  type EstadoSenaTurno,
  type SenaTurnoDTO,
} from '@factory/contracts'
import { montoSenaReserva } from '../finance/servicios/modelo.ts'
import { MOTIVOS_PRESTADOR_SIN_COBRO, type ResultadoVerificacionPagoServicio } from '../finance/servicios/servicio.ts'
import { esUrlMercadoPago } from '../finance/servicios/mercado-pago.ts'
import { ErrorCalendario } from './bookings.ts'

// TURNOS-SENA-01. Deposit ("seña") of a turno: half of the price booked on its reservation.
//
// Nothing of the deposit is stored on the reservation. Its AMOUNT derives from
// reservas.precio_final through the one 50% rule of finance (montoSenaReserva); its STATUS derives
// from the payment obligation of the turno's order, which only a verified Mercado Pago
// notification moves to `paid`. Generating a link, opening it or returning from the checkout
// changes nothing here.

type FilaReserva = Prisma.ReservaGetPayload<object>

// Payments of a deposit, through the SAME finance and work services every other payment of TUS
// uses (obligation, idempotent intent, hosted checkout, signed notifications). Wired by the
// composition; absent where those services do not exist (then no deposit can be paid online).
// Whether the deposit of a provider's turnos has to be paid, the same rule request-born works
// follow (W09-05):
//   exigible   online payments are on and this provider can charge: accepting opens the payment
//   bloqueada  online payments are on but this provider cannot charge yet (no Mercado Pago
//              account, identity not verified): it cannot accept; never confirmed for free
//   no_habilitada  online payments are on in production but TUS holds no `service-payments`
//              readiness authorization: nobody can accept a priced turno; never confirmed for
//              free. Sandbox never gets here (the authorization is not asked there)
//   sin_cobro  online payments are off for the whole platform: no deposit exists and accepting
//              confirms, as before the deposit existed
export type RequisitoSena = 'exigible' | 'bloqueada' | 'no_habilitada' | 'sin_cobro'

// The platform switch is on and only the production readiness authorization is missing.
const MOTIVO_PLATAFORMA_NO_HABILITADA = 'PRODUCTION_NOT_AUTHORIZED'

export interface PagosSenaTurno {
  // Platform switch on, provider with a linked Mercado Pago account and verified identity.
  requisito(prestador: { prestadorTenantId: string; prestadorId: string }): Promise<RequisitoSena>
  // Ensures the order of the turno and its payment intent and returns the hosted checkout. The
  // same reservation always gives the same intent: asking twice never creates two payments.
  checkout(input: {
    reservaId: string
    clienteTenantId: string
    clienteCuentaId: string
    prestadorTenantId: string
    prestadorId: string
    correlationId: string
  }): Promise<{ url: string }>
  // TUS-WHATSAPP-MULTIMODAL-01: the REAL state of the payment of the turno's order, read from
  // Mercado Pago and applied through the same state machine as the webhook (idempotent).
  verificar?(input: { trabajoId: string; clienteTenantId: string; clienteCuentaId: string; correlationId: string }): Promise<ResultadoVerificacionPagoServicio>
}

// The payments of a deposit over the application's own work and finance services: the order of
// the turno (one per reservation) and then the SAME checkout command every payment of TUS uses.
// The idempotency key is the reservation itself: asking again returns the same payment. null
// where those services are not composed.
export function pagosSenaDeAplicacion(
  servicios: {
    work?: { asegurarOrdenDeTurno(input: { tenantId: string; actorId: string; correlationId: string; reservaId: string; prestadorTenantId: string; prestadorId: string; createdAt: string }): Promise<{ work: { trabajoId: string } }> }
    serviceFinance?: {
      disponibilidadCobroPrestador(input: { prestadorTenantId: string; prestadorId: string }): Promise<{ available: boolean; reason: string | null }>
      iniciarCheckout(input: { tenantId: string; actorId: string; correlationId: string; trabajoId: string; idempotencyKey: string }): Promise<{ checkoutUrl: string }>
      verificarPagoDelTrabajo?(input: { tenantId: string; actorId: string; correlationId: string; trabajoId: string }): Promise<ResultadoVerificacionPagoServicio>
    }
  },
  now: () => number = Date.now
): PagosSenaTurno | null {
  const { work, serviceFinance } = servicios
  if (!work || !serviceFinance) return null
  return {
    requisito: async (prestador) => {
      const cobro = await serviceFinance.disponibilidadCobroPrestador(prestador)
      if (cobro.available) return 'exigible'
      if (cobro.reason === MOTIVO_PLATAFORMA_NO_HABILITADA) return 'no_habilitada'
      return cobro.reason !== null && MOTIVOS_PRESTADOR_SIN_COBRO.has(cobro.reason) ? 'bloqueada' : 'sin_cobro'
    },
    checkout: async (input) => {
      // The client of the reservation, read from the database by the caller: never a request value.
      const contexto = { tenantId: input.clienteTenantId, actorId: input.clienteCuentaId, correlationId: input.correlationId }
      const { work: orden } = await work.asegurarOrdenDeTurno({ ...contexto, reservaId: input.reservaId, prestadorTenantId: input.prestadorTenantId, prestadorId: input.prestadorId, createdAt: new Date(now()).toISOString() })
      const resultado = await serviceFinance.iniciarCheckout({ ...contexto, trabajoId: orden.trabajoId, idempotencyKey: `sena-turno:${input.reservaId}` })
      return { url: resultado.checkoutUrl }
    },
    verificar: serviceFinance.verificarPagoDelTrabajo
      ? (input) => serviceFinance.verificarPagoDelTrabajo!({ tenantId: input.clienteTenantId, actorId: input.clienteCuentaId, correlationId: input.correlationId, trabajoId: input.trabajoId })
      : undefined,
  }
}

const ESTADOS_OBLIGACION_VISIBLES: Record<string, EstadoSenaTurno> = { paid: 'paid', refunded: 'refunded', charged_back: 'charged_back' }

// A price in whole pesos -> its deposit in pesos (it carries cents when the price is odd).
export function senaDePrecio(precio: bigint | number, moneda = 'ARS'): number {
  return Number(montoSenaReserva(BigInt(precio), moneda)) / 100
}

export class ServicioSenaTurnos {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pagos: PagosSenaTurno | null = null,
    private readonly now: () => number = Date.now
  ) {}

  // Whether the reservation is one a deposit applies to at all: a registered client and a price.
  private aplica(row: FilaReserva): boolean {
    return !row.esInvitado && Boolean(row.clienteTenantId) && row.precioFinal !== null && row.precioFinal > 0n
  }

  // Deposit of each reservation that has one, by reservation id, in a fixed number of queries.
  async senasDe(rows: FilaReserva[]): Promise<Map<string, SenaTurnoDTO>> {
    const conSena = rows.filter((row) => this.aplica(row))
    const senas = new Map<string, SenaTurnoDTO>()
    if (conSena.length === 0) return senas
    const ordenes = await this.prisma.trabajo.findMany({ where: { origen: 'turno', reservaId: { in: conSena.map((row) => row.reservaId) } } })
    const obligaciones = ordenes.length
      ? await this.prisma.obligacionPagoServicio.findMany({ where: { tramo: 'sena', trabajoId: { in: ordenes.map((orden) => orden.trabajoId) } } })
      : []
    const estadoDeOrden = new Map(obligaciones.map((obligacion) => [obligacion.trabajoId, obligacion.estado]))
    const estadoDeReserva = new Map(ordenes.map((orden) => [`${orden.reservaTenantId}\u0000${orden.reservaId}`, estadoDeOrden.get(orden.trabajoId) ?? null]))

    // Online payment is a fact of each provider: asked once per provider of the list.
    const abiertas = conSena.filter((row) => (row.estado === 'pending' || row.estado === 'awaiting_payment') && row.fechaInicio.getTime() > this.now() && row.solicitudExpiraEn !== null && row.solicitudExpiraEn.getTime() > this.now())
    const requisito = await this.requisitos([...new Set(abiertas.map((row) => row.tenantId))])

    for (const row of conSena) {
      const obligacion = estadoDeReserva.get(`${row.tenantId}\u0000${row.reservaId}`) ?? null
      const vigente = row.solicitudExpiraEn === null || row.solicitudExpiraEn.getTime() > this.now()
      const estado: EstadoSenaTurno | null =
        (obligacion && ESTADOS_OBLIGACION_VISIBLES[obligacion]) ||
        // A request: the deposit is announced only where one will really be asked.
        (row.estado === 'pending' && vigente
          ? (requisito.get(row.tenantId) ?? 'sin_cobro') === 'sin_cobro'
            ? null
            : 'not_due'
          : row.estado === 'awaiting_payment' && row.solicitudExpiraEn !== null && vigente && row.fechaInicio.getTime() > this.now()
            ? requisito.get(row.tenantId) === 'exigible'
              ? 'pending'
              : 'unavailable'
            : null)
      // A turno that ended without its deposit being paid simply has none to show.
      if (estado) senas.set(row.id, { monto: senaDePrecio(row.precioFinal!, row.moneda ?? 'ARS'), moneda: row.moneda ?? 'ARS', estado })
    }
    return senas
  }

  // `estricto`: a check that fails is an error of the caller (deciding what an acceptance means
  // must never fall back to "no deposit"). Otherwise unknown means nothing is promised.
  private async requisitos(tenants: string[], estricto = false): Promise<Map<string, RequisitoSena>> {
    const requisito = new Map<string, RequisitoSena>()
    if (tenants.length === 0) return requisito
    const perfiles = await this.prisma.perfilPublicoPrestador.findMany({ where: { tenantId: { in: tenants } } })
    for (const perfil of perfiles) {
      const consulta = this.pagos ? this.pagos.requisito({ prestadorTenantId: perfil.tenantId, prestadorId: perfil.prestadorId }) : Promise.resolve('sin_cobro' as const)
      // Unknown (payments not composed, or the check failed): nothing is charged and nothing is promised.
      requisito.set(perfil.tenantId, estricto ? await consulta : await consulta.catch(() => 'sin_cobro' as const))
    }
    return requisito
  }

  // What accepting THIS request means: 'sin_sena' when no deposit applies to it at all (no price,
  // or a client without an account). If it cannot be determined the acceptance fails: a priced
  // turno is never confirmed because a check was unavailable.
  async requisitoDe(row: FilaReserva): Promise<RequisitoSena | 'sin_sena'> {
    if (!this.aplica(row)) return 'sin_sena'
    try {
      return (await this.requisitos([row.tenantId], true)).get(row.tenantId) ?? 'sin_cobro'
    } catch {
      throw new ErrorCalendario(503, CODIGO_PAGO_NO_DISPONIBLE, 'No pudimos verificar el pago de la seña en este momento. Probá de nuevo en unos minutos.')
    }
  }

  // Whether the turnos of a provider are confirmed by paying a deposit (what a client is told
  // before requesting).
  async requeridaPara(tenantId: string): Promise<boolean> {
    return ((await this.requisitos([tenantId])).get(tenantId) ?? 'sin_cobro') !== 'sin_cobro'
  }

  // Whether a service of that provider needs a published price to be requested: where a deposit
  // can really be charged. While TUS itself is not authorized to charge (`no_habilitada`) a
  // price-less service keeps working as it always did: it has no deposit.
  async exigePrecio(tenantId: string): Promise<boolean> {
    const requisito = (await this.requisitos([tenantId])).get(tenantId) ?? 'sin_cobro'
    return requisito === 'exigible' || requisito === 'bloqueada'
  }

  async senaDe(row: FilaReserva): Promise<SenaTurnoDTO | null> {
    return (await this.senasDe([row])).get(row.id) ?? null
  }

  // A deposit was already issued for the reservation (its price can no longer change).
  async emitida(row: FilaReserva): Promise<boolean> {
    const orden = await this.prisma.trabajo.findFirst({ where: { origen: 'turno', reservaTenantId: row.tenantId, reservaId: row.reservaId } })
    if (!orden) return false
    return Boolean(await this.prisma.obligacionPagoServicio.findFirst({ where: { tenantId: orden.tenantId, trabajoId: orden.trabajoId, tramo: 'sena' } }))
  }

  /**
   * El cliente paga la seña de SU turno confirmado: devuelve el checkout de Mercado Pago de esa
   * seña. El cliente es la cuenta de la sesión (o la identificada por el asistente), nunca un
   * valor del pedido; el monto sale del precio guardado en la reserva. Pedirlo dos veces devuelve
   * el mismo pago.
   */
  async iniciarPago(input: { clienteId: string; reservaId: string; correlationId: string }): Promise<CheckoutSenaTurnoDTO> {
    const row = await this.prisma.reserva.findFirst({
      where: { OR: [{ id: input.reservaId }, { reservaId: input.reservaId }], clienteId: input.clienteId, esInvitado: false },
    })
    // Somebody else's turno does not exist for this account.
    if (!row) throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')
    return this.checkoutDe(row, input.correlationId)
  }

  /**
   * "¿Ya me llegó el pago?": el estado REAL del pago de la seña de SU turno. No decide nada: lee a
   * Mercado Pago y aplica lo que informa por el mismo camino que la notificación (idempotente: si la
   * notificación ya llegó, o llega después, no pasa nada dos veces). Un turno ajeno no existe para
   * esta cuenta.
   */
  async verificarPago(input: { clienteId: string; reservaId: string; correlationId: string }): Promise<ResultadoVerificacionPagoServicio> {
    const row = await this.prisma.reserva.findFirst({
      where: { OR: [{ id: input.reservaId }, { reservaId: input.reservaId }], clienteId: input.clienteId, esInvitado: false },
    })
    if (!row || !row.clienteTenantId) throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')
    const orden = await this.prisma.trabajo.findFirst({ where: { origen: 'turno', reservaTenantId: row.tenantId, reservaId: row.reservaId } })
    if (!orden) return { status: 'not_found', appliedNow: false, trabajoId: '', amountMinor: null, currency: null, reason: 'no_payment_started' }
    if (!this.pagos?.verificar) return { status: 'unavailable', appliedNow: false, trabajoId: orden.trabajoId, amountMinor: null, currency: null, reason: 'payments_not_composed' }
    return this.pagos.verificar({ trabajoId: orden.trabajoId, clienteTenantId: row.clienteTenantId, clienteCuentaId: row.clienteId, correlationId: input.correlationId })
  }

  /**
   * Enlace de pago de la seña al aceptarse el turno, para avisarle al cliente. Es un intento: si
   * el pago online no está disponible para ese prestador o Mercado Pago no responde, devuelve
   * null y el cliente puede pedirlo después desde "Mis turnos" o el asistente.
   */
  async enlaceAlAceptar(row: FilaReserva, correlationId: string): Promise<CheckoutSenaTurnoDTO | null> {
    if (!this.aplica(row)) return null
    return this.checkoutDe(row, correlationId).catch(() => null)
  }

  // The same checkout may be being prepared right now by another request (the notice of the
  // acceptance, a second tab): it is the same payment, so waiting a moment gives its result.
  private async conReintento<T>(operacion: () => Promise<T>): Promise<T> {
    for (let intento = 1; ; intento += 1) {
      try {
        return await operacion()
      } catch (error) {
        const code = String((error as { code?: unknown })?.code ?? '')
        if (intento >= 4 || !['IN_PROGRESS', 'CONCURRENT_MODIFICATION', 'VERSION_CONFLICT', 'P2034', 'P2002'].includes(code)) throw error
        await new Promise((resolve) => setTimeout(resolve, 250 * intento))
      }
    }
  }

  private async checkoutDe(row: FilaReserva, correlationId: string): Promise<CheckoutSenaTurnoDTO> {
    const sena = await this.senaDe(row)
    if (sena?.estado === 'paid') throw new ErrorCalendario(409, CODIGO_SENA_YA_PAGADA, 'La seña de ese turno ya está pagada.')
    if (sena?.estado === 'unavailable' || (sena?.estado === 'pending' && !this.pagos))
      throw new ErrorCalendario(503, CODIGO_PAGO_NO_DISPONIBLE, 'El pago online todavía no está disponible para ese profesional.')
    if (!sena || sena.estado !== 'pending' || !this.pagos) throw new ErrorCalendario(409, CODIGO_SENA_NO_PAGABLE, 'La seña de ese turno no se puede pagar ahora.')
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId: row.tenantId } })
    if (!perfil) throw new ErrorCalendario(409, CODIGO_SENA_NO_PAGABLE, 'La seña de ese turno no se puede pagar ahora.')
    let url: string
    try {
      url = await this.conReintento(() =>
        this.pagos!.checkout({
          reservaId: row.reservaId,
          clienteTenantId: row.clienteTenantId!,
          clienteCuentaId: row.clienteId,
          prestadorTenantId: row.tenantId,
          prestadorId: perfil.prestadorId,
          correlationId,
        }).then((resultado) => resultado.url)
      )
    } catch (error) {
      const code = String((error as { code?: unknown })?.code ?? '')
      if (code === 'ALREADY_PAID' || code === 'OBLIGATION_NOT_PAYABLE') throw new ErrorCalendario(409, CODIGO_SENA_YA_PAGADA, 'La seña de ese turno ya está pagada.')
      if (code === 'IN_PROGRESS') throw new ErrorCalendario(409, 'IN_PROGRESS', 'El pago se está preparando. Probá de nuevo en unos segundos.')
      if (code === 'APPOINTMENT_NOT_PAYABLE' || code === 'WORK_CANCELLED' || code === 'OBLIGATION_CLOSED' || code === 'INCONSISTENT_COMMERCIAL_CHAIN' || code === 'OBLIGATION_STALE')
        throw new ErrorCalendario(409, CODIGO_SENA_NO_PAGABLE, 'La seña de ese turno no se puede pagar ahora.')
      throw new ErrorCalendario(503, CODIGO_PAGO_NO_DISPONIBLE, 'No pudimos preparar el pago en este momento. Probá de nuevo en unos minutos.')
    }
    // Only a hosted Mercado Pago HTTPS address ever leaves the backend.
    if (!esUrlMercadoPago(url)) throw new ErrorCalendario(503, CODIGO_PAGO_NO_DISPONIBLE, 'No pudimos preparar el pago en este momento. Probá de nuevo en unos minutos.')
    return { checkoutUrl: url, monto: sena.monto, moneda: sena.moneda }
  }
}
