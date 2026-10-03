import { randomUUID } from 'node:crypto'
import { ErrorAlojamiento, type AlojamientosService } from './alojamientos-service.ts'

export interface CheckoutPreferenceResult {
  preferenceId: string
  initPoint: string
  sandboxInitPoint: string
  amount: number
  currency: string
  reservaId: string
}

export class CheckoutAlojamientosService {
  private readonly alojamientosService: AlojamientosService

  // `simulado` es la MISMA decisión explícita que habilita el pago simulado (solo development o
  // test). Sin ella no hay preferencia: la ausencia de una variable nunca activa la simulación.
  constructor(alojamientosService: AlojamientosService, private readonly opciones: { simulado?: boolean; webBaseUrl?: string } = {}) {
    this.alojamientosService = alojamientosService
  }

  /**
   * Preferencia de pago SIMULADA para desarrollo local y tests. El cobro real de alojamientos con
   * Mercado Pago todavía no está integrado: fuera de development/test esta operación falla cerrada
   * (nunca devuelve un enlace de pago, real o simulado, con una preferencia que no existe).
   */
  async crearPreferenciaCheckout(reservaId: string): Promise<CheckoutPreferenceResult> {
    if (this.opciones.simulado !== true) {
      throw new ErrorAlojamiento(503, 'CHECKOUT_NOT_AVAILABLE', 'El pago online de alojamientos todavía no está disponible')
    }
    const preferenceId = `pref-aloj-${randomUUID().slice(0, 8)}`
    const host = (this.opciones.webBaseUrl ?? 'http://localhost:3000').replace(/\/+$/u, '')
    const initPoint = `${host}/checkout/alojamiento/mock?preference_id=${preferenceId}&reserva_id=${reservaId}`

    return {
      preferenceId,
      initPoint,
      sandboxInitPoint: initPoint,
      amount: 0,
      currency: 'ARS',
      reservaId,
    }
  }

  /**
   * Procesa la confirmación de pago de una reserva (simulada o proveniente de webhook verificado).
   */
  async procesarConfirmacionPago(input: {
    reservaId: string
    paymentId: string
    preferenceId?: string
    metodoPago?: string
  }) {
    return this.alojamientosService.confirmarReserva(input)
  }
}
