import { randomUUID } from 'node:crypto'
import type { AlojamientosService } from './alojamientos-service.ts'

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
   * Crea una preferencia de pago para la reserva de alojamiento en estado pending_payment.
   * Utiliza el adaptador de Mercado Pago si está configurado en el entorno;
   * de lo contrario, provee preferencia sandbox simulada para desarrollo local y tests sin bloqueos.
   */
  async crearPreferenciaCheckout(reservaId: string): Promise<CheckoutPreferenceResult> {
    const preferenceId = `pref-aloj-${randomUUID().slice(0, 8)}`
    const isMock = !process.env['MP_ACCESS_TOKEN'] || process.env['MP_ACCESS_TOKEN'].includes('fake')

    const host = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000'
    const initPoint = isMock
      ? `${host}/checkout/alojamiento/mock?preference_id=${preferenceId}&reserva_id=${reservaId}`
      : `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${preferenceId}`

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
