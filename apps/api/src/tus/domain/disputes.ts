import { TUS_CONTRACT_VERSION, type TusDispute, type TusTenantContext } from '@factory/contracts'

export interface CreateDisputeInput extends TusTenantContext {
  disputeId: string
  commitmentId: string
  reason: string
}

export function createDispute(input: CreateDisputeInput): TusDispute {
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
