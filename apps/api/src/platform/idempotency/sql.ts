import type {
  IdempotencyClaimInput,
  IdempotencyCompleteInput,
  IdempotencyFailureInput,
  IdempotencyRecord,
  JsonValue,
} from './domain.js'

export const IDEMPOTENCY_SQL_OPERATION = {
  CLAIM: 'idempotency-claim',
  COMPLETE: 'idempotency-complete',
  FAIL: 'idempotency-fail',
  FIND: 'idempotency-find',
} as const

export type IdempotencySqlOperation =
  (typeof IDEMPOTENCY_SQL_OPERATION)[keyof typeof IDEMPOTENCY_SQL_OPERATION]

export interface IdempotencySqlCommand<TRow = unknown> {
  operation: IdempotencySqlOperation
  text: string
  parameters: readonly unknown[]
  tenantId: string
  row?: TRow
}

export interface IdempotencySqlResult<TRow> {
  rows: readonly TRow[]
  rowCount: number
}

export interface IdempotencySqlExecutor {
  query<TRow>(command: IdempotencySqlCommand<TRow>): Promise<IdempotencySqlResult<TRow>>
}

const CLAIM_SQL = `
  WITH inserted AS (
    INSERT INTO "IdempotencyRecord"
      ("id", "tenantId", "key", "requestHash", "status", "response", "createdAt", "expiresAt")
    VALUES ($3, $1, $2, $4, 'pending', NULL, $5, $6)
    ON CONFLICT ("tenantId", "key") DO NOTHING
    RETURNING "id", "tenantId", "key", "requestHash", "status", "response", "createdAt", "expiresAt",
      true AS "claimed"
  ), taken_over AS (
    UPDATE "IdempotencyRecord" AS record
    SET "id" = $3, "requestHash" = $4, "status" = 'pending', "response" = NULL,
        "createdAt" = $5, "expiresAt" = $6
    WHERE record."tenantId" = $1 AND record."key" = $2
      AND record."requestHash" = $4 AND record."status" = 'pending'
      AND record."expiresAt" <= $5
      AND NOT EXISTS (SELECT 1 FROM inserted)
    RETURNING record."id", record."tenantId", record."key", record."requestHash",
      record."status", record."response", record."createdAt", record."expiresAt",
      true AS "claimed"
  )
  SELECT * FROM inserted
  UNION ALL
  SELECT * FROM taken_over
  UNION ALL
  SELECT record."id", record."tenantId", record."key", record."requestHash",
    record."status", record."response", record."createdAt", record."expiresAt",
    false AS "claimed"
  FROM "IdempotencyRecord" AS record
  WHERE record."tenantId" = $1 AND record."key" = $2
    AND NOT EXISTS (SELECT 1 FROM inserted)
    AND NOT EXISTS (SELECT 1 FROM taken_over)`

const COMPLETE_SQL = `
  UPDATE "IdempotencyRecord"
  SET "status" = 'completed', "response" = $5
  WHERE "tenantId" = $1 AND "key" = $2 AND "id" = $3 AND "requestHash" = $4 AND "status" = 'pending'
  RETURNING "id", "tenantId", "key", "requestHash", "status", "response", "createdAt", "expiresAt"`

const FAIL_SQL = `
  UPDATE "IdempotencyRecord"
  SET "status" = 'failed', "response" = $5
  WHERE "tenantId" = $1 AND "key" = $2 AND "id" = $3 AND "requestHash" = $4 AND "status" = 'pending'
  RETURNING "id", "tenantId", "key", "requestHash", "status", "response", "createdAt", "expiresAt"`

const FIND_SQL = `
  SELECT "id", "tenantId", "key", "requestHash", "status", "response", "createdAt", "expiresAt"
  FROM "IdempotencyRecord"
  WHERE "tenantId" = $1 AND "key" = $2`

export function buildIdempotencyClaimCommand(
  input: IdempotencyClaimInput
): IdempotencySqlCommand<IdempotencyRecord & { claimed: boolean }> {
  validateSqlInput(input)
  return {
    operation: IDEMPOTENCY_SQL_OPERATION.CLAIM,
    text: CLAIM_SQL,
    parameters: [
      input.tenantId,
      input.key,
      input.recordId,
      input.requestHash,
      input.now,
      input.expiresAt,
    ],
    tenantId: input.tenantId,
  }
}

export function buildIdempotencyCompleteCommand(
  input: IdempotencyCompleteInput
): IdempotencySqlCommand<IdempotencyRecord> {
  validateSqlInput(input)
  return {
    operation: IDEMPOTENCY_SQL_OPERATION.COMPLETE,
    text: COMPLETE_SQL,
    parameters: [
      input.tenantId,
      input.key,
      input.recordId,
      input.requestHash,
      JSON.stringify(input.response),
    ],
    tenantId: input.tenantId,
  }
}

export function buildIdempotencyFailureCommand(
  input: IdempotencyFailureInput
): IdempotencySqlCommand<IdempotencyRecord> {
  validateSqlInput(input)
  return {
    operation: IDEMPOTENCY_SQL_OPERATION.FAIL,
    text: FAIL_SQL,
    parameters: [
      input.tenantId,
      input.key,
      input.recordId,
      input.requestHash,
      JSON.stringify(input.response ?? null),
    ],
    tenantId: input.tenantId,
  }
}

export function buildIdempotencyFindCommand(
  tenantId: string,
  key: string
): IdempotencySqlCommand<IdempotencyRecord> {
  if (!tenantId.trim() || !key.trim()) throw new Error('Tenant and idempotency key are required')
  return {
    operation: IDEMPOTENCY_SQL_OPERATION.FIND,
    text: FIND_SQL,
    parameters: [tenantId, key],
    tenantId,
  }
}

function validateSqlInput(input: IdempotencyClaimInput): void {
  if (!input.tenantId.trim() || !input.key.trim() || !input.requestHash.trim())
    throw new Error('Tenant, idempotency key, and request hash are required')
}

export function rowToIdempotencyRecord(row: {
  id: string
  tenantId: string
  key: string
  requestHash: string
  status: IdempotencyRecord['status']
  response: JsonValue | string | null
  createdAt: number | Date
  expiresAt: number | Date
}): IdempotencyRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    requestHash: row.requestHash,
    status: row.status,
    response:
      typeof row.response === 'string' ? (JSON.parse(row.response) as JsonValue) : row.response,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.getTime() : row.expiresAt,
  }
}

export default {
  IDEMPOTENCY_SQL_OPERATION,
  buildIdempotencyClaimCommand,
  buildIdempotencyCompleteCommand,
  buildIdempotencyFailureCommand,
  buildIdempotencyFindCommand,
}
