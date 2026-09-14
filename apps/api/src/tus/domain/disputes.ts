import { TUS_CONTRACT_VERSION, type Disputa, type TusTenantContext } from '@factory/contracts'

export interface EntradaCrearDisputa extends TusTenantContext {
  disputeId: string
  commitmentId: string
  reason: string
}

export function crearDisputa(input: EntradaCrearDisputa): Disputa {
  if (input.reason.trim().length === 0) throw new Error('dispute reason is required')
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    disputeId: input.disputeId,
    commitmentId: input.commitmentId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    correlationId: input.correlationId,
    reason: input.reason,
    status: 'open',
  }
}
