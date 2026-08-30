import type {
  IdempotencyClaimInput,
  IdempotencyClaimResult,
  IdempotencyCompleteInput,
  IdempotencyFailureInput,
  IdempotencyRecord,
} from '../domain.js'
import type { IdempotencyStorePort } from '../ports.js'

export class IdempotencyProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'

  constructor() {
    super('Idempotency persistence is not activated')
    this.name = 'IdempotencyProviderUnavailableError'
  }
}

export class ActivationGatedIdempotencyAdapter implements IdempotencyStorePort {
  private enabled = false

  constructor(private readonly delegate: IdempotencyStorePort) {}

  activate(): void {
    this.enabled = true
  }

  deactivate(): void {
    this.enabled = false
  }

  claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimResult> {
    return this.run(() => this.delegate.claim(input))
  }

  complete(input: IdempotencyCompleteInput): Promise<IdempotencyRecord> {
    return this.run(() => this.delegate.complete(input))
  }

  fail(input: IdempotencyFailureInput): Promise<IdempotencyRecord> {
    return this.run(() => this.delegate.fail(input))
  }

  find(tenantId: string, key: string): Promise<IdempotencyRecord | null> {
    return this.run(() => this.delegate.find(tenantId, key))
  }

  private run<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    if (!this.enabled) return Promise.reject(new IdempotencyProviderUnavailableError())
    return operation()
  }
}

export default { ActivationGatedIdempotencyAdapter, IdempotencyProviderUnavailableError }
