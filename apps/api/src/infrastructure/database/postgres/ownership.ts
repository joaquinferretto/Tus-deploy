export const LOCAL_ACID_BOUNDARY = 'postgresql-only'
export const DISTRIBUTED_2PC_PROHIBITED = true

export type PostgresOwnershipClass =
  | 'identity'
  | 'tenancy'
  | 'authorization'
  | 'audit'
  | 'search'
  | 'aggregates'
  | 'quotas'
  | 'idempotency'
  | 'outbox'
  | 'run-ledger'

export interface PostgresOwnership {
  dataClass: PostgresOwnershipClass
  sourceOfTruth: 'postgresql'
  reconciliation: 'restore-backup' | 'rebuild-from-postgres-outbox'
  projectionPolicy: 'no-competing-source' | 'outbox-projections'
}

const OWNERSHIP: Readonly<Record<PostgresOwnershipClass, PostgresOwnership>> = {
  identity: {
    dataClass: 'identity',
    sourceOfTruth: 'postgresql',
    reconciliation: 'restore-backup',
    projectionPolicy: 'no-competing-source',
  },
  tenancy: {
    dataClass: 'tenancy',
    sourceOfTruth: 'postgresql',
    reconciliation: 'rebuild-from-postgres-outbox',
    projectionPolicy: 'outbox-projections',
  },
  authorization: {
    dataClass: 'authorization',
    sourceOfTruth: 'postgresql',
    reconciliation: 'rebuild-from-postgres-outbox',
    projectionPolicy: 'outbox-projections',
  },
  audit: {
    dataClass: 'audit',
    sourceOfTruth: 'postgresql',
    reconciliation: 'restore-backup',
    projectionPolicy: 'no-competing-source',
  },
  search: {
    dataClass: 'search',
    sourceOfTruth: 'postgresql',
    reconciliation: 'rebuild-from-postgres-outbox',
    projectionPolicy: 'outbox-projections',
  },
  aggregates: {
    dataClass: 'aggregates',
    sourceOfTruth: 'postgresql',
    reconciliation: 'restore-backup',
    projectionPolicy: 'no-competing-source',
  },
  quotas: {
    dataClass: 'quotas',
    sourceOfTruth: 'postgresql',
    reconciliation: 'restore-backup',
    projectionPolicy: 'no-competing-source',
  },
  idempotency: {
    dataClass: 'idempotency',
    sourceOfTruth: 'postgresql',
    reconciliation: 'restore-backup',
    projectionPolicy: 'no-competing-source',
  },
  outbox: {
    dataClass: 'outbox',
    sourceOfTruth: 'postgresql',
    reconciliation: 'restore-backup',
    projectionPolicy: 'no-competing-source',
  },
  'run-ledger': {
    dataClass: 'run-ledger',
    sourceOfTruth: 'postgresql',
    reconciliation: 'restore-backup',
    projectionPolicy: 'no-competing-source',
  },
}

export interface PostgresTransaction {
  query<T = unknown>(sql: string, parameters: readonly unknown[]): Promise<T>
}

export interface PostgresTransactionClient {
  $transaction<T>(operation: (transaction: PostgresTransaction) => Promise<T>): Promise<T>
}

/** Execute owned writes in one PostgreSQL ACID boundary. */
export function withPostgresTransaction<T>(
  client: PostgresTransactionClient,
  operation: (transaction: PostgresTransaction) => Promise<T>
): Promise<T> {
  return client.$transaction(operation)
}

export type RecoveryTarget = 'mongo-projection' | 'vector-metadata'

export interface RecoveryPlan {
  sourceOfTruth: 'postgresql' | 'b2-lineage'
  strategy: 'replay-outbox' | 'rebuild-from-lineage'
  target: RecoveryTarget
}

export function ownershipFor(dataClass: PostgresOwnershipClass): PostgresOwnership {
  return { ...OWNERSHIP[dataClass] }
}

export function buildRecoveryPlan(target: RecoveryTarget): RecoveryPlan {
  if (target === 'mongo-projection') {
    return {
      sourceOfTruth: 'postgresql',
      strategy: 'replay-outbox',
      target,
    }
  }

  return {
    sourceOfTruth: 'b2-lineage',
    strategy: 'rebuild-from-lineage',
    target,
  }
}

export default {
  LOCAL_ACID_BOUNDARY,
  DISTRIBUTED_2PC_PROHIBITED,
  withPostgresTransaction,
  ownershipFor,
  buildRecoveryPlan,
}
