import type {
  OutboxClaimInput,
  OutboxClaimResult,
  OutboxEventInput,
  OutboxPublishInput,
  OutboxPublishResult,
  OutboxRecord,
  OutboxRecoveryInput,
} from './domain.js'
import type { IdempotencyStorePort } from '../idempotency/ports.js'

export interface OutboxStorePort {
  append(input: OutboxEventInput): Promise<OutboxRecord>
  claim(input: OutboxClaimInput): Promise<OutboxClaimResult>
  publish(input: OutboxPublishInput): Promise<OutboxPublishResult>
  recover(input: OutboxRecoveryInput): Promise<number>
  find(tenantId: string, eventId: string): Promise<OutboxRecord | null>
  list(tenantId: string): OutboxRecord[]
}

export interface PlatformTransactionPort {
  idempotency: IdempotencyStorePort
  outbox: OutboxStorePort
}

export interface TransactionalPlatformPort {
  transaction<T>(operation: (transaction: PlatformTransactionPort) => Promise<T>): Promise<T>
}

export default {}
