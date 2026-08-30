import type {
  OutboxClaimInput,
  OutboxEventInput,
  OutboxPublishInput,
  OutboxRecord,
  OutboxRecoveryInput,
} from './domain.js'

export const OUTBOX_SQL_OPERATION = {
  APPEND: 'outbox-append',
  CLAIM: 'outbox-claim',
  PUBLISH: 'outbox-publish',
  RECOVER: 'outbox-recover',
  FIND: 'outbox-find',
} as const

export type OutboxSqlOperation = (typeof OUTBOX_SQL_OPERATION)[keyof typeof OUTBOX_SQL_OPERATION]

export interface OutboxSqlCommand<TRow = unknown> {
  operation: OutboxSqlOperation
  text: string
  parameters: readonly unknown[]
  tenantId: string
}

export interface OutboxSqlResult<TRow> {
  rows: readonly TRow[]
  rowCount: number
}

export interface OutboxSqlExecutor {
  query<TRow>(command: OutboxSqlCommand<TRow>): Promise<OutboxSqlResult<TRow>>
}

const APPEND_SQL = `
  INSERT INTO "OutboxEvent"
    ("id", "tenantId", "aggregateType", "aggregateId", "eventType", "payload", "status", "attempts", "availableAt", "createdAt")
  VALUES ($2, $1, $3, $4, $5, $6, 'pending', 0, $7, $8)
  ON CONFLICT ("id") DO NOTHING
  RETURNING "id", "tenantId", "aggregateType", "aggregateId", "eventType", "payload", "status", "attempts", "availableAt", "lastError", "createdAt", "publishedAt", "claimId", "claimUntil"`

const CLAIM_SQL = `
  UPDATE "OutboxEvent"
  SET "status" = 'claimed', "attempts" = "attempts" + 1,
      "claimId" = $3, "claimUntil" = $4
  WHERE "tenantId" = $1 AND "id" = $2 AND "availableAt" <= $5
    AND ("status" = 'pending' OR ("status" = 'claimed' AND "claimUntil" <= $5))
  RETURNING "id", "tenantId", "aggregateType", "aggregateId", "eventType", "payload", "status", "attempts", "availableAt", "lastError", "createdAt", "publishedAt", "claimId", "claimUntil"`

const PUBLISH_SQL = `
  UPDATE "OutboxEvent"
  SET "status" = 'published', "publishedAt" = $4, "claimId" = NULL, "claimUntil" = NULL
  WHERE "tenantId" = $1 AND "id" = $2 AND "status" = 'claimed' AND "claimId" = $3
  RETURNING "id", "tenantId", "aggregateType", "aggregateId", "eventType", "status", "attempts", "availableAt", "lastError", "createdAt", "publishedAt", "claimId", "claimUntil", "payload"`

const RECOVER_SQL = `
  UPDATE "OutboxEvent"
  SET "status" = 'pending', "claimId" = NULL, "claimUntil" = NULL
  WHERE "tenantId" = $1 AND "status" = 'claimed' AND "claimUntil" <= $2`

const FIND_SQL = `
  SELECT "id", "tenantId", "aggregateType", "aggregateId", "eventType", "payload", "status", "attempts", "availableAt", "lastError", "createdAt", "publishedAt", "claimId", "claimUntil"
  FROM "OutboxEvent" WHERE "tenantId" = $1 AND "id" = $2`

export function buildOutboxAppendCommand(input: OutboxEventInput): OutboxSqlCommand<OutboxRecord> {
  validateEvent(input)
  return {
    operation: OUTBOX_SQL_OPERATION.APPEND,
    text: APPEND_SQL,
    parameters: [
      input.tenantId,
      input.id,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      JSON.stringify(input.payload),
      input.availableAt,
      input.createdAt,
    ],
    tenantId: input.tenantId,
  }
}

export function buildOutboxClaimCommand(input: OutboxClaimInput): OutboxSqlCommand<OutboxRecord> {
  if (
    !input.tenantId.trim() ||
    !input.eventId.trim() ||
    !input.claimId.trim() ||
    input.leaseMs <= 0
  )
    throw new Error('Tenant, event, claim, and positive lease are required')
  return {
    operation: OUTBOX_SQL_OPERATION.CLAIM,
    text: CLAIM_SQL,
    parameters: [
      input.tenantId,
      input.eventId,
      input.claimId,
      input.now + input.leaseMs,
      input.now,
    ],
    tenantId: input.tenantId,
  }
}

export function buildOutboxPublishCommand(
  input: OutboxPublishInput
): OutboxSqlCommand<OutboxRecord> {
  if (!input.tenantId.trim() || !input.eventId.trim() || !input.claimId.trim())
    throw new Error('Tenant, event, and claim are required')
  return {
    operation: OUTBOX_SQL_OPERATION.PUBLISH,
    text: PUBLISH_SQL,
    parameters: [input.tenantId, input.eventId, input.claimId, input.now],
    tenantId: input.tenantId,
  }
}

export function buildOutboxRecoveryCommand(
  input: OutboxRecoveryInput
): OutboxSqlCommand<OutboxRecord> {
  if (!input.tenantId.trim() || !Number.isFinite(input.now))
    throw new Error('Tenant and time are required')
  return {
    operation: OUTBOX_SQL_OPERATION.RECOVER,
    text: RECOVER_SQL,
    parameters: [input.tenantId, input.now],
    tenantId: input.tenantId,
  }
}

export function buildOutboxFindCommand(
  tenantId: string,
  eventId: string
): OutboxSqlCommand<OutboxRecord> {
  if (!tenantId.trim() || !eventId.trim()) throw new Error('Tenant and event are required')
  return {
    operation: OUTBOX_SQL_OPERATION.FIND,
    text: FIND_SQL,
    parameters: [tenantId, eventId],
    tenantId,
  }
}

function validateEvent(input: OutboxEventInput): void {
  if (
    !input.id.trim() ||
    !input.tenantId.trim() ||
    !input.aggregateType.trim() ||
    !input.eventType.trim()
  )
    throw new Error('Outbox event identifiers are required')
}

export function rowToOutboxRecord(row: {
  id: string
  tenantId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payload: OutboxRecord['payload'] | string
  status: OutboxRecord['status']
  attempts: number
  availableAt: number | Date
  lastError?: string | null
  createdAt: number | Date
  publishedAt?: number | Date | null
  claimId?: string | null
  claimUntil?: number | Date | null
}): OutboxRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload:
      typeof row.payload === 'string' ? JSON.parse(row.payload) : structuredClone(row.payload),
    status: row.status,
    attempts: row.attempts,
    availableAt: toMillis(row.availableAt),
    lastError: row.lastError ?? null,
    createdAt: toMillis(row.createdAt),
    publishedAt:
      row.publishedAt === null || row.publishedAt === undefined ? null : toMillis(row.publishedAt),
    claimId: row.claimId ?? null,
    claimUntil:
      row.claimUntil === null || row.claimUntil === undefined ? null : toMillis(row.claimUntil),
  }
}

function toMillis(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value
}

export default {
  OUTBOX_SQL_OPERATION,
  buildOutboxAppendCommand,
  buildOutboxClaimCommand,
  buildOutboxPublishCommand,
  buildOutboxRecoveryCommand,
  buildOutboxFindCommand,
}
