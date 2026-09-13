import type { EventoAuditoria, MetadatosAuditoria, ResultadoAuditoria } from './domain.js'

export interface EntradaEventoAuditoria {
  action: string
  actorId: string | null
  productId: string | null
  tenantId: string | null
  correlationId: string
  outcome: ResultadoAuditoria
  reason: string
  metadata: MetadatosAuditoria
}

export interface ReceptorAuditoria {
  readonly events: readonly EventoAuditoria[]
  record(input: EntradaEventoAuditoria, occurredAt: number): Promise<void>
}

export interface GeneradorIdAuditoria {
  next(): string
}
