export * from './ports/index.js'
export * from './fakes/index.js'
export * from './redis-local/index.js'
export * from './sqs-dlq/index.js'

import { FakeQueueTransport, InMemoryQueueTransport } from './fakes/index.js'
import { RedisLocalQueueTransport, RedisLocalTransport } from './redis-local/index.js'
import { SqsDlqQueueTransport, SqsDlqTransport } from './sqs-dlq/index.js'
import {
  QUEUE_ACTIVATION,
  QUEUE_CONTRACT_VERSION,
  QUEUE_STATUS,
  QueueActivationError,
  QueueProviderUnavailableError,
  assertQueueMessage,
  cloneQueueMessage,
  retryBackoffMs,
} from './ports/index.js'

export class UnavailableQueueTransport {
  private readonly provider: string

  constructor(provider: string) {
    this.provider = provider
  }

  private unavailable(): never {
    throw new QueueProviderUnavailableError(this.provider)
  }

  enqueue(): never {
    return this.unavailable()
  }
  claim(): never {
    return this.unavailable()
  }
  acknowledge(): never {
    return this.unavailable()
  }
  retry(): never {
    return this.unavailable()
  }
  cancel(): never {
    return this.unavailable()
  }
  reconcile(): never {
    return this.unavailable()
  }
  deadLetters(): never {
    return this.unavailable()
  }
}

export default {
  QUEUE_ACTIVATION,
  QUEUE_CONTRACT_VERSION,
  QUEUE_STATUS,
  QueueActivationError,
  QueueProviderUnavailableError,
  assertQueueMessage,
  cloneQueueMessage,
  retryBackoffMs,
  InMemoryQueueTransport,
  FakeQueueTransport,
  RedisLocalQueueTransport,
  RedisLocalTransport,
  SqsDlqQueueTransport,
  SqsDlqTransport,
  UnavailableQueueTransport,
}
