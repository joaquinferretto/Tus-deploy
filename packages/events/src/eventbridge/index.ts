import {
  backoffDelay,
  EventActivationError,
  redactError,
  redactEventMessage,
  type EventAdapterOptions,
  type EventBridgeRequest,
  type EventBridgeSender,
  type EventMessage,
  type EventPublishOptions,
  type EventPublishResult,
} from '../ports/index.ts'

export interface EventBridgeAdapterOptions extends EventAdapterOptions {
  eventBusRef: string
  sender: EventBridgeSender
}

export class EventBridgeAdapter {
  private active = false
  private readonly options: Required<
    Pick<EventBridgeAdapterOptions, 'maxAttempts' | 'baseBackoffMs' | 'maxBackoffMs'>
  > &
    EventBridgeAdapterOptions

  constructor(options: EventBridgeAdapterOptions) {
    this.options = {
      maxAttempts: 3,
      baseBackoffMs: 100,
      maxBackoffMs: 10_000,
      ...options,
    }
  }

  activate(): void {
    this.active = true
  }

  deactivate(): void {
    this.active = false
  }

  async publish(
    event: EventMessage,
    options: EventPublishOptions = {}
  ): Promise<EventPublishResult> {
    this.assertActive()
    const detail = redactEventMessage(event)
    const request: EventBridgeRequest = {
      eventBusRef: this.options.eventBusRef,
      source: 'product-factory-core',
      detailType: event.type,
      detail,
    }
    const retryDelaysMs: number[] = []
    let attempts = 0
    let lastError = ''

    while (attempts < this.options.maxAttempts) {
      attempts += 1
      try {
        await this.options.sender(request)
        return { status: 'published', eventId: event.eventId, attempts, retryDelaysMs }
      } catch (error: unknown) {
        lastError = redactError(error)
        if (attempts >= this.options.maxAttempts) break
        retryDelaysMs.push(
          backoffDelay(attempts, this.options.baseBackoffMs, this.options.maxBackoffMs)
        )
      }
    }

    const lastDelay = retryDelaysMs.at(-1) ?? 0
    return {
      status: 'retryable',
      eventId: event.eventId,
      attempts,
      retryDelaysMs,
      ...(options.now !== undefined ? { nextAttemptAt: options.now + lastDelay } : {}),
      error: lastError,
    }
  }

  private assertActive(): void {
    if (!this.active) throw new EventActivationError('EventBridge')
  }
}
