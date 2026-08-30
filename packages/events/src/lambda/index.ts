import {
  backoffDelay,
  EventActivationError,
  redactError,
  redactEventMessage,
  type EventAdapterOptions,
  type EventInvocationResult,
  type EventMessage,
  type EventPublishOptions,
  type LambdaRequest,
  type LambdaSender,
} from '../ports/index.ts'

export interface LambdaAdapterOptions extends EventAdapterOptions {
  functionRef: string
  sender: LambdaSender
}

export class LambdaAdapter {
  private active = false
  private readonly options: Required<
    Pick<LambdaAdapterOptions, 'maxAttempts' | 'baseBackoffMs' | 'maxBackoffMs'>
  > &
    LambdaAdapterOptions

  constructor(options: LambdaAdapterOptions) {
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

  async invoke(
    event: EventMessage,
    options: EventPublishOptions = {}
  ): Promise<EventInvocationResult> {
    if (!this.active) throw new EventActivationError('Lambda')
    const request: LambdaRequest = {
      functionRef: this.options.functionRef,
      invocationType: 'RequestResponse',
      detail: redactEventMessage(event),
    }
    const retryDelaysMs: number[] = []
    let attempts = 0
    let lastError = ''

    while (attempts < this.options.maxAttempts) {
      attempts += 1
      try {
        await this.options.sender(request)
        return { status: 'invoked', eventId: event.eventId, attempts, retryDelaysMs }
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
}
