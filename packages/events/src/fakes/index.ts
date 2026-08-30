import { redactEventMessage, type EventMessage, type EventPublishResult } from '../ports/index.ts'

export class InMemoryEventPublisher {
  private readonly stored: EventMessage[] = []

  async publish(event: EventMessage): Promise<EventPublishResult> {
    this.stored.push(redactEventMessage(event))
    return {
      status: 'published',
      eventId: event.eventId,
      attempts: 1,
      retryDelaysMs: [],
    }
  }

  events(tenantId: string): EventMessage[] {
    return this.stored.filter((event) => event.tenantId === tenantId).map(redactEventMessage)
  }
}
