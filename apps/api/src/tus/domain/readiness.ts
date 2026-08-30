import { evaluateLegacyReadinessGates, type LegacyReadinessStatus } from '../readiness/index.ts'
import type { ReadinessGateKey } from '@factory/contracts'

export type ReadinessGates = Partial<Record<ReadinessGateKey, boolean>>

/** @deprecated Compatibility adapter. Canonical authorization uses TusReadinessDecision. */
export function evaluateReadinessGates(gates: ReadinessGates): LegacyReadinessStatus {
  return evaluateLegacyReadinessGates(gates)
}
