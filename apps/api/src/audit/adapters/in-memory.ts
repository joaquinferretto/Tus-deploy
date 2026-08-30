import type { AuditEvent } from '../domain.js'
import { redactAuditMetadata } from '../domain.js'
import type { AuditEventInput, AuditIdGenerator, AuditSink } from '../ports.js'

export class InMemoryAuditSink implements AuditSink {
  private readonly storedEvents: AuditEvent[] = []

  get events(): readonly AuditEvent[] {
    return this.storedEvents.map((event) => ({ ...event, metadata: { ...event.metadata } }))
  }

  async record(input: AuditEventInput, occurredAt: number): Promise<void> {
    this.storedEvents.push({
      id: `audit-${this.storedEvents.length + 1}`,
      ...input,
      occurredAt: new Date(occurredAt).toISOString(),
      metadata: redactAuditMetadata(input.metadata),
    })
  }
}

export class DeterministicAuditIdGenerator implements AuditIdGenerator {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `audit-${this.sequence}`
  }
}
