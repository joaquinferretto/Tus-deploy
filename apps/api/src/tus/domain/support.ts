import { TUS_CONTRACT_VERSION, type CasoSoporte, type TusTenantContext } from '@factory/contracts'

export interface CreateSupportCaseInput extends TusTenantContext {
  caseId: string
  commitmentId: string
  category: string
}

export function createSupportCase(input: CreateSupportCaseInput): CasoSoporte {
  if (!input.caseId.trim() || !input.commitmentId.trim() || !input.category.trim()) {
    throw new Error('support case identity and category are required')
  }
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    caseId: input.caseId,
    commitmentId: input.commitmentId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    correlationId: input.correlationId,
    category: input.category,
    status: 'open',
  }
}
