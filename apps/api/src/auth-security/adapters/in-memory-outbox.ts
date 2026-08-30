import type { OutboxPort } from '../ports/refresh-rotation.js'
import type { RefreshOutboxEvent } from '../domain/refresh.js'

export class OutboxAppendError extends Error {
  readonly code = 'OUTBOX_APPEND_FAILED'

  constructor() {
    super('Outbox event could not be appended')
    this.name = 'OutboxAppendError'
  }
}

export class InMemoryOutbox implements OutboxPort {
  readonly events: RefreshOutboxEvent[] = []
  fail = false

  async append(event: RefreshOutboxEvent): Promise<void> {
    if (this.fail) throw new OutboxAppendError()
    this.events.push(structuredClone(event))
  }
}
