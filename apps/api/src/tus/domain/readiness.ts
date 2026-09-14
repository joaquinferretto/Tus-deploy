import { evaluarRequisitosHabilitacionLegacy, type EstadoHabilitacionLegacy } from '../readiness/index.ts'
import type { ClaveRequisitoHabilitacion as ClaveRequisitoHabilitacionContrato } from '@factory/contracts'

export type RequisitosHabilitacion = Partial<Record<ClaveRequisitoHabilitacionContrato, boolean>>

/** @deprecated Adaptador de compatibilidad. La autorización canónica usa DecisionHabilitacionContrato. */
export function evaluarRequisitosHabilitacion(gates: RequisitosHabilitacion): EstadoHabilitacionLegacy {
  return evaluarRequisitosHabilitacionLegacy(gates)
}
