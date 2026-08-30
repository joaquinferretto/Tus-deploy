import type { JsonValue } from '../idempotency/domain.js'
import type { RunLedgerRecord } from '../jobs/domain.js'

export const RUN_LEDGER_SQL_OPERATION = {
  CREATE: 'run-ledger-create',
  FIND: 'run-ledger-find',
  FIND_BY_IDEMPOTENCY: 'run-ledger-find-by-idempotency',
  UPDATE: 'run-ledger-update',
} as const

export type RunLedgerSqlOperation =
  (typeof RUN_LEDGER_SQL_OPERATION)[keyof typeof RUN_LEDGER_SQL_OPERATION]

export interface RunLedgerSqlCommand<TRow = unknown> {
  operation: RunLedgerSqlOperation
  text: string
  parameters: readonly unknown[]
  tenantId: string
}

export interface RunLedgerSqlResult<TRow> {
  rows: readonly TRow[]
  rowCount: number
}

export interface RunLedgerSqlExecutor {
  query<TRow>(command: RunLedgerSqlCommand<TRow>): Promise<RunLedgerSqlResult<TRow>>
}

export interface RunLedgerCreateInput {
  id: string
  tenantId: string
  idempotencyKey: string
  requestHash: string
  runType: string
  input: JsonValue
  now: number
}

const CREATE_SQL = `
  INSERT INTO "RunLedger"
    ("id", "tenantId", "idempotencyKey", "requestHash", "runType", "status", "input", "createdAt", "updatedAt")
  VALUES ($2, $1, $3, $4, $5, 'queued', $6, $7, $7)
  ON CONFLICT ("tenantId", "idempotencyKey") DO NOTHING
  RETURNING "id", "tenantId", "idempotencyKey", "requestHash", "runType", "status", "input", "result", "error", "createdAt", "updatedAt"`

const FIND_SQL = `
  SELECT "id", "tenantId", "idempotencyKey", "requestHash", "runType", "status", "input", "result", "error", "createdAt", "updatedAt"
  FROM "RunLedger" WHERE "tenantId" = $1 AND "id" = $2`

const FIND_BY_IDEMPOTENCY_SQL = `
  SELECT "id", "tenantId", "idempotencyKey", "requestHash", "runType", "status", "input", "result", "error", "createdAt", "updatedAt"
  FROM "RunLedger" WHERE "tenantId" = $1 AND "idempotencyKey" = $2`

const UPDATE_SQL = `
  UPDATE "RunLedger"
  SET "status" = $3, "result" = $4, "error" = $5, "updatedAt" = $6
  WHERE "tenantId" = $1 AND "id" = $2
  RETURNING "id", "tenantId", "idempotencyKey", "requestHash", "runType", "status", "input", "result", "error", "createdAt", "updatedAt"`

export function buildRunLedgerCreateCommand(
  input: RunLedgerCreateInput
): RunLedgerSqlCommand<RunLedgerRecord> {
  requireText(input.tenantId, input.id, input.idempotencyKey, input.requestHash, input.runType)
  return {
    operation: RUN_LEDGER_SQL_OPERATION.CREATE,
    text: CREATE_SQL,
    parameters: [
      input.tenantId,
      input.id,
      input.idempotencyKey,
      input.requestHash,
      input.runType,
      JSON.stringify(input.input),
      input.now,
    ],
    tenantId: input.tenantId,
  }
}

export function buildRunLedgerFindCommand(
  tenantId: string,
  runId: string
): RunLedgerSqlCommand<RunLedgerRecord> {
  requireText(tenantId, runId)
  return {
    operation: RUN_LEDGER_SQL_OPERATION.FIND,
    text: FIND_SQL,
    parameters: [tenantId, runId],
    tenantId,
  }
}

export function buildRunLedgerFindByIdempotencyCommand(
  tenantId: string,
  idempotencyKey: string
): RunLedgerSqlCommand<RunLedgerRecord> {
  requireText(tenantId, idempotencyKey)
  return {
    operation: RUN_LEDGER_SQL_OPERATION.FIND_BY_IDEMPOTENCY,
    text: FIND_BY_IDEMPOTENCY_SQL,
    parameters: [tenantId, idempotencyKey],
    tenantId,
  }
}

export function buildRunLedgerUpdateCommand(input: {
  tenantId: string
  runId: string
  status: RunLedgerRecord['status']
  result: JsonValue | null
  error: JsonValue | null
  now: number
}): RunLedgerSqlCommand<RunLedgerRecord> {
  requireText(input.tenantId, input.runId, input.status)
  if (!Number.isFinite(input.now)) throw new Error('Run ledger time is required')
  return {
    operation: RUN_LEDGER_SQL_OPERATION.UPDATE,
    text: UPDATE_SQL,
    parameters: [
      input.tenantId,
      input.runId,
      input.status,
      input.result === null ? null : JSON.stringify(input.result),
      input.error === null ? null : JSON.stringify(input.error),
      input.now,
    ],
    tenantId: input.tenantId,
  }
}

export function rowToRunLedgerRecord(row: {
  id: string
  tenantId: string
  idempotencyKey: string
  requestHash?: string
  runType: string
  status: RunLedgerRecord['status']
  input: RunLedgerRecord['input'] | string
  result?: RunLedgerRecord['result'] | string | null
  error?: RunLedgerRecord['error'] | string | null
  createdAt: number | Date
  updatedAt: number | Date
}): RunLedgerRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash ?? '',
    runType: row.runType,
    status: row.status,
    input: parseJson(row.input),
    result: parseOptionalJson(row.result),
    error: parseOptionalJson(row.error),
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  }
}

function parseJson(value: JsonValue | string): JsonValue {
  return typeof value === 'string' ? JSON.parse(value) : structuredClone(value)
}

function parseOptionalJson(value: JsonValue | string | null | undefined): JsonValue | null {
  return value === null || value === undefined ? null : parseJson(value)
}

function toMillis(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value
}

function requireText(...values: string[]): void {
  if (values.some((value) => !value.trim())) throw new Error('Run ledger identifiers are required')
}

export default {
  RUN_LEDGER_SQL_OPERATION,
  buildRunLedgerCreateCommand,
  buildRunLedgerFindCommand,
  buildRunLedgerFindByIdempotencyCommand,
  buildRunLedgerUpdateCommand,
  rowToRunLedgerRecord,
}
