import type { EventoAuditoria } from '../domain.js'
import { redactarMetadatosAuditoria } from '../domain.js'
import type { EntradaEventoAuditoria, GeneradorIdAuditoria, ReceptorAuditoria } from '../ports.js'

export class ReceptorAuditoriaEnMemoria implements ReceptorAuditoria {
  private readonly storedEvents: EventoAuditoria[] = []

  get events(): readonly EventoAuditoria[] {
    return this.storedEvents.map((event) => ({ ...event, metadata: { ...event.metadata } }))
  }

  async record(input: EntradaEventoAuditoria, occurredAt: number): Promise<void> {
    this.storedEvents.push({
      id: `audit-${this.storedEvents.length + 1}`,
      ...input,
      occurredAt: new Date(occurredAt).toISOString(),
      metadata: redactarMetadatosAuditoria(input.metadata),
    })
  }
}

export class GeneradorIdAuditoriaDeterminista implements GeneradorIdAuditoria {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `audit-${this.sequence}`
  }
}
