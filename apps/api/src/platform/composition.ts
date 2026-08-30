import { InMemoryIdempotencyStore } from './idempotency/adapters/in-memory.js'
import { PostgresIdempotencyAdapter } from './idempotency/adapters/postgres.js'
import { InMemoryOutboxStore } from './outbox/adapters/in-memory.js'
import { PostgresOutboxAdapter } from './outbox/adapters/postgres.js'
import type { IdempotencyRecord } from './idempotency/domain.js'
import type { OutboxRecord } from './outbox/domain.js'
import type { PlatformTransactionPort, TransactionalPlatformPort } from './outbox/ports.js'

export interface PostgresTransactionExecutor {
  transaction<TValue>(
    operation: (executor: PostgresQueryExecutor) => Promise<TValue>
  ): Promise<TValue>
}

export interface PostgresQueryExecutor {
  query<TRow>(command: {
    operation: string
    text: string
    parameters: readonly unknown[]
    tenantId: string
  }): Promise<{ rows: readonly TRow[]; rowCount: number }>
}

export class InMemoryTransactionalPlatform implements TransactionalPlatformPort {
  readonly idempotency: InMemoryIdempotencyStore
  readonly outbox: InMemoryOutboxStore
  private transactionTail: Promise<void> = Promise.resolve()

  constructor(idempotency = new InMemoryIdempotencyStore(), outbox = new InMemoryOutboxStore()) {
    this.idempotency = idempotency
    this.outbox = outbox
  }

  async transaction<TValue>(
    operation: (transaction: PlatformTransactionPort) => Promise<TValue>
  ): Promise<TValue> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous

    const idempotency = new InMemoryIdempotencyStore(this.idempotency.snapshot())
    const outbox = new InMemoryOutboxStore(this.outbox.snapshot())
    try {
      const result = await operation({ idempotency, outbox })
      this.idempotency.replace(idempotency.snapshot())
      this.outbox.replace(outbox.snapshot())
      return result
    } finally {
      release()
    }
  }
}

export class PostgresTransactionalPlatform implements TransactionalPlatformPort {
  constructor(private readonly executor: PostgresTransactionExecutor) {}

  transaction<TValue>(
    operation: (transaction: PlatformTransactionPort) => Promise<TValue>
  ): Promise<TValue> {
    return this.executor.transaction(async (executor) =>
      operation({
        idempotency: new PostgresIdempotencyAdapter(executor),
        outbox: new PostgresOutboxAdapter(executor),
      })
    )
  }
}

export function createInMemoryPlatform(): InMemoryTransactionalPlatform {
  return new InMemoryTransactionalPlatform()
}

export type { IdempotencyRecord, OutboxRecord }
export { IdempotentActionService } from './idempotency/application/idempotent-action-service.js'
export { InMemoryIdempotencyStore } from './idempotency/adapters/in-memory.js'
export { InMemoryOutboxStore } from './outbox/adapters/in-memory.js'

export default {
  InMemoryTransactionalPlatform,
  PostgresTransactionalPlatform,
  createInMemoryPlatform,
}
