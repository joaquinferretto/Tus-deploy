import type {
  OutboxClaimInput,
  OutboxClaimResult,
  OutboxEventInput,
  OutboxPublishInput,
  OutboxPublishResult,
  OutboxRecord,
  OutboxRecoveryInput,
} from '../domain.js'
import type { OutboxStorePort } from '../ports.js'

export class OutboxProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'

  constructor() {
    super('Outbox persistence is not activated')
    this.name = 'OutboxProviderUnavailableError'
  }
}

export class ActivationGatedOutboxAdapter implements OutboxStorePort {
  private enabled = false

  constructor(private readonly delegate: OutboxStorePort) {}

  activate(): void {
    this.enabled = true
  }

  deactivate(): void {
    this.enabled = false
  }

  append(input: OutboxEventInput): Promise<OutboxRecord> {
    return this.run(() => this.delegate.append(input))
  }

  claim(input: OutboxClaimInput): Promise<OutboxClaimResult> {
    return this.run(() => this.delegate.claim(input))
  }

  publish(input: OutboxPublishInput): Promise<OutboxPublishResult> {
    return this.run(() => this.delegate.publish(input))
  }

  recover(input: OutboxRecoveryInput): Promise<number> {
    return this.run(() => this.delegate.recover(input))
  }

  find(tenantId: string, eventId: string): Promise<OutboxRecord | null> {
    return this.run(() => this.delegate.find(tenantId, eventId))
  }

  list(tenantId: string): OutboxRecord[] {
    if (!this.enabled) throw new OutboxProviderUnavailableError()
    return this.delegate.list(tenantId)
  }

  private run<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    if (!this.enabled) return Promise.reject(new OutboxProviderUnavailableError())
    return operation()
  }
}

export default { ActivationGatedOutboxAdapter, OutboxProviderUnavailableError }
