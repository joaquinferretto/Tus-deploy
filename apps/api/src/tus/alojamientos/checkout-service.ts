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

  constructor(alojamientosService: AlojamientosService) {
    this.alojamientosService = alojamientosService
  }

  /**
   * Preferencia de pago SIMULADA para desarrollo local y tests. El cobro real de alojamientos con
   * Mercado Pago todavía no está integrado: con credenciales reales esta operación falla cerrada
   * (nunca devuelve un enlace de Mercado Pago con una preferencia que no existe).
   */
  async crearPreferenciaCheckout(reservaId: string): Promise<CheckoutPreferenceResult> {
    const preferenceId = `pref-aloj-${randomUUID().slice(0, 8)}`
    const isMock = !process.env['MP_ACCESS_TOKEN'] || process.env['MP_ACCESS_TOKEN'].includes('fake')

    if (!isMock) {
      throw new ErrorAlojamiento(503, 'CHECKOUT_NOT_AVAILABLE', 'El pago online de alojamientos todavía no está disponible')
    }

    const host = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000'
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
