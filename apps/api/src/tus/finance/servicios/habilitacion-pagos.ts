import { randomUUID } from 'node:crypto'
import {
  HabilitacionBloqueadaError,
  type EvaluadorHabilitacion,
  type PerfilHabilitacion,
} from '../../readiness/index.ts'
import type { EstadoHabilitacionPagos, EstadoHabilitacionesPagos } from './configuracion.ts'

// Real money of service payments (deposit of a turno, deposit and balance of a request-born
// work) is gated by the evidence-based readiness decision of the `service-payments` capability.
// `settlement` is the gate of the general marketplace (products, delivery, POS): it is reported
// next to it so an operator can tell them apart, and it never authorizes a service payment.
//
// Nothing here reads an environment variable or a boolean: the only input is the evidence the
// evaluator finds for the platform tenant. Any failure of the evaluation is "not authorized".
export const CAPACIDAD_PAGOS_SERVICIO = 'service-payments' as const
export const ALCANCE_PAGOS_SERVICIO = 'argentina-stage-1'

export interface HabilitacionPagosServicio {
  // The decision every charge depends on.
  autorizada(): Promise<boolean>
  // What an operator reads: each gate with the evidence it still lacks (`gate:reason`).
  estado(): Promise<EstadoHabilitacionesPagos>
}

export function crearHabilitacionPagosServicio(
  evaluador: EvaluadorHabilitacion,
  opciones: { tenantId: string; profile: PerfilHabilitacion }
): HabilitacionPagosServicio {
  const evaluar = async (
    capability: typeof CAPACIDAD_PAGOS_SERVICIO | 'settlement'
  ): Promise<EstadoHabilitacionPagos> => {
    try {
      const decision = await evaluador.require({
        tenantId: opciones.tenantId,
        actorId: 'system:service-payments',
        // Unique per evaluation: two evaluations in the same millisecond are two audit records.
        correlationId: `${capability}-readiness-${Date.now()}-${randomUUID()}`,
        capability,
        profile: opciones.profile,
        scope: ALCANCE_PAGOS_SERVICIO,
      })
      const authorized = decision.enabled && decision.disposition === 'authorized'
      return { capability, authorized, blockers: authorized ? [] : ['READINESS_NOT_AUTHORIZED'] }
    } catch (error) {
      if (!(error instanceof HabilitacionBloqueadaError))
        return { capability, authorized: false, blockers: ['READINESS_EVALUATION_FAILED'] }
      const blockers = error.decision.failedGates.map(({ gate, reason }) => `${gate}:${reason}`)
      return {
        capability,
        authorized: false,
        blockers: blockers.length > 0 ? blockers : [error.decision.reason ?? 'READINESS_BLOCKED'],
      }
    }
  }
  return {
    autorizada: async () => (await evaluar(CAPACIDAD_PAGOS_SERVICIO)).authorized,
    estado: async () => ({
      servicePayments: await evaluar(CAPACIDAD_PAGOS_SERVICIO),
      settlement: await evaluar('settlement'),
    }),
  }
}
