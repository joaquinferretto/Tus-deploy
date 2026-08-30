import type {
  IdempotencyClaimInput,
  IdempotencyClaimResult,
  IdempotencyCompleteInput,
  IdempotencyFailureInput,
  IdempotencyRecord,
} from '../domain.js'
import { IDEMPOTENCY_CLAIM_STATUS, IDEMPOTENCY_STATUS } from '../domain.js'
import type { IdempotencyStorePort } from '../ports.js'
import {
  buildIdempotencyClaimCommand,
  buildIdempotencyCompleteCommand,
  buildIdempotencyFailureCommand,
  buildIdempotencyFindCommand,
  rowToIdempotencyRecord,
  type IdempotencySqlExecutor,
} from '../sql.js'

interface IdempotencyRow {
  id: string
  tenantId: string
  key: string
  requestHash: string
  status: IdempotencyRecord['status']
  response: IdempotencyRecord['response'] | string | null
  createdAt: number | Date
  expiresAt: number | Date
  claimed?: boolean
}

export class PostgresIdempotencyAdapter implements IdempotencyStorePort {
  constructor(private readonly executor: IdempotencySqlExecutor) {}

  async claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimResult> {
    const result = await this.executor.query<IdempotencyRow>(buildIdempotencyClaimCommand(input))
    const row = result.rows[0]
    if (!row) return { status: IDEMPOTENCY_CLAIM_STATUS.FORBIDDEN }
    const record = rowToIdempotencyRecord(row)
    if (record.requestHash !== input.requestHash)
      return { status: IDEMPOTENCY_CLAIM_STATUS.CONFLICT, record }
    if (record.status === IDEMPOTENCY_STATUS.COMPLETED && record.response !== null)
      return { status: IDEMPOTENCY_CLAIM_STATUS.REPLAY, record, response: record.response }
    if (row.claimed === false) return { status: IDEMPOTENCY_CLAIM_STATUS.IN_PROGRESS, record }
    return { status: IDEMPOTENCY_CLAIM_STATUS.CLAIMED, record }
  }

  async complete(input: IdempotencyCompleteInput): Promise<IdempotencyRecord> {
    return this.write(buildIdempotencyCompleteCommand(input))
  }

  async fail(input: IdempotencyFailureInput): Promise<IdempotencyRecord> {
    return this.write(buildIdempotencyFailureCommand(input))
  }

  async find(tenantId: string, key: string): Promise<IdempotencyRecord | null> {
    const result = await this.executor.query<IdempotencyRow>(
      buildIdempotencyFindCommand(tenantId, key)
    )
    return result.rows[0] ? rowToIdempotencyRecord(result.rows[0]) : null
  }

  private async write(
    command: ReturnType<typeof buildIdempotencyCompleteCommand>
  ): Promise<IdempotencyRecord> {
    const result = await this.executor.query<IdempotencyRow>(command)
    if (!result.rows[0]) throw new Error('Idempotency SQL update affected no record')
    return rowToIdempotencyRecord(result.rows[0])
  }
}

export default { PostgresIdempotencyAdapter }
