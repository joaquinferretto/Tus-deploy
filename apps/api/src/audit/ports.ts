import type { AuditEvent, AuditMetadata, AuditOutcome } from './domain.js'

export interface AuditEventInput {
  action: string
  actorId: string | null
  productId: string | null
  tenantId: string | null
  correlationId: string
  outcome: AuditOutcome
  reason: string
  metadata: AuditMetadata
}

export interface AuditSink {
  readonly events: readonly AuditEvent[]
  record(input: AuditEventInput, occurredAt: number): Promise<void>
}

export interface AuditIdGenerator {
  next(): string
}
