import { TUS_CONTRACT_VERSION, type EvidenciaCumplimiento, type TipoEvidencia, type TusTenantContext } from '@factory/contracts'

export interface EntradaEvidenciaCumplimiento extends TusTenantContext {
  commitmentId: string
  evidenceId: string
  occurredAt: string
  kind: TipoEvidencia
}

export function crearEvidenciaCumplimiento(input: EntradaEvidenciaCumplimiento): EvidenciaCumplimiento {
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

export function esEvidenciaCumplimiento(
  evidence: Pick<EvidenciaCumplimiento, 'kind'> | undefined,
): evidence is EvidenciaCumplimiento {
  return evidence?.kind === 'completion' || evidence?.kind === 'delivery-accepted'
}
