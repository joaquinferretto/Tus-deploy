import { TUS_CONTRACT_VERSION, type CompletionEvidence, type EvidenceKind, type TusTenantContext } from '@factory/contracts'

export interface CompletionEvidenceInput extends TusTenantContext {
  commitmentId: string
  evidenceId: string
  occurredAt: string
  kind: EvidenceKind
}

export function createCompletionEvidence(input: CompletionEvidenceInput): CompletionEvidence {
  if (input.kind === 'check-in' && input.commitmentId.length === 0) {
    throw new Error('check-in evidence requires a commitment')
  }
  return {
    contractVersion: TUS_CONTRACT_VERSION,
    evidenceId: input.evidenceId,
    commitmentId: input.commitmentId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    correlationId: input.correlationId,
    kind: input.kind,
    occurredAt: input.occurredAt,
  }
}

export function isCompletionEvidence(
  evidence: Pick<CompletionEvidence, 'kind'> | undefined,
): evidence is CompletionEvidence {
  return evidence?.kind === 'completion' || evidence?.kind === 'delivery-accepted'
}
