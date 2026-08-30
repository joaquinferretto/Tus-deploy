import type {
  IdempotencyClaimInput,
  IdempotencyClaimResult,
  IdempotencyCompleteInput,
  IdempotencyFailureInput,
  IdempotencyRecord,
} from './domain.js'

export interface IdempotencyStorePort {
  claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimResult>
  complete(input: IdempotencyCompleteInput): Promise<IdempotencyRecord>
  fail(input: IdempotencyFailureInput): Promise<IdempotencyRecord>
  find(tenantId: string, key: string): Promise<IdempotencyRecord | null>
}

export interface IdempotencyTransactionPort extends IdempotencyStorePort {}

export default {}
