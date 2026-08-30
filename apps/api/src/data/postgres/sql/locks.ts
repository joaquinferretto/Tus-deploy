import {
  createSqlCommand,
  SQL_OPERATION,
  TENANT_AUTHORIZATION_PREDICATE,
  type SqlExecutor,
  type SqlCommand,
  type TenantSqlScope,
} from './contracts.js'

export const RESERVATION_STATUS = {
  RESERVED: 'reserved',
  CONFLICT: 'conflict',
  FORBIDDEN: 'forbidden',
} as const

export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS]

export interface AvailabilityLockInput {
  scope: TenantSqlScope
  resourceId: string
  quantity: number
  now: number
}

export interface ReservationDecision {
  status: ReservationStatus
  id?: string
  remaining?: number
}

const AVAILABILITY_LOCK_SQL = `
  WITH locked AS (
    SELECT "id", "available"
    FROM "Inventory"
    WHERE ${TENANT_AUTHORIZATION_PREDICATE}
      AND "resourceId" = $3
    FOR UPDATE
  )
  UPDATE "Inventory" AS "inventory"
  SET "available" = "inventory"."available" - $4,
      "updatedAt" = $5
  FROM locked
  WHERE "inventory"."id" = locked."id"
    AND locked."available" >= $4
  RETURNING "inventory"."id", "inventory"."available" AS "remaining"`

export function buildAvailabilityLockQuery(
  input: AvailabilityLockInput
): SqlCommand<ReservationDecision> {
  if (!input.resourceId.trim() || input.quantity <= 0 || !Number.isFinite(input.quantity)) {
    throw new Error('A resource id and positive quantity are required')
  }
  return createSqlCommand(SQL_OPERATION.LOCK, AVAILABILITY_LOCK_SQL, input.scope, [
    input.resourceId,
    input.quantity,
    input.now,
  ])
}

export interface SqlLockPort {
  reserve(input: AvailabilityLockInput): Promise<ReservationDecision>
}

interface ReservationRow {
  id: string
  remaining: number
}

export class PostgresLockAdapter implements SqlLockPort {
  constructor(private readonly executor: SqlExecutor) {}

  async reserve(input: AvailabilityLockInput): Promise<ReservationDecision> {
    const result = await this.executor.query<ReservationRow>(buildAvailabilityLockQuery(input))
    const row = result.rows[0]
    return row
      ? { status: RESERVATION_STATUS.RESERVED, id: row.id, remaining: row.remaining }
      : { status: RESERVATION_STATUS.CONFLICT }
  }
}

export default { PostgresLockAdapter, buildAvailabilityLockQuery }
