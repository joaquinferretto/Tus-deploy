import type {
  OutboxClaimInput,
  OutboxClaimResult,
  OutboxEventInput,
  OutboxPublishInput,
  OutboxPublishResult,
  OutboxRecord,
  OutboxRecoveryInput,
} from '../domain.js'
import { OUTBOX_RESULT_STATUS, OUTBOX_STATUS } from '../domain.js'
import type { OutboxStorePort } from '../ports.js'
import {
  buildOutboxAppendCommand,
  buildOutboxClaimCommand,
  buildOutboxFindCommand,
  buildOutboxPublishCommand,
  buildOutboxRecoveryCommand,
  rowToOutboxRecord,
  type OutboxSqlExecutor,
} from '../sql.js'

interface OutboxRow {
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
}

export class PostgresOutboxAdapter implements OutboxStorePort {
  constructor(private readonly executor: OutboxSqlExecutor) {}

  async append(input: OutboxEventInput): Promise<OutboxRecord> {
    const result = await this.executor.query<OutboxRow>(buildOutboxAppendCommand(input))
    if (!result.rows[0]) {
      const existing = await this.find(input.tenantId, input.id)
      if (!existing) throw new Error('Outbox append affected no record')
      return existing
    }
    return rowToOutboxRecord(result.rows[0])
  }

  async claim(input: OutboxClaimInput): Promise<OutboxClaimResult> {
    const result = await this.executor.query<OutboxRow>(buildOutboxClaimCommand(input))
    const row = result.rows[0]
    if (row) return { status: OUTBOX_RESULT_STATUS.CLAIMED, record: rowToOutboxRecord(row) }
    const current = await this.find(input.tenantId, input.eventId)
    if (!current) return { status: OUTBOX_RESULT_STATUS.EMPTY }
    if (current.status === OUTBOX_STATUS.PUBLISHED)
      return { status: OUTBOX_RESULT_STATUS.ALREADY_PUBLISHED, record: current }
    return { status: OUTBOX_RESULT_STATUS.IN_PROGRESS, record: current }
  }

  async publish(input: OutboxPublishInput): Promise<OutboxPublishResult> {
    const result = await this.executor.query<OutboxRow>(buildOutboxPublishCommand(input))
    const row = result.rows[0]
    if (row) return { status: OUTBOX_RESULT_STATUS.PUBLISHED, record: rowToOutboxRecord(row) }
    const current = await this.find(input.tenantId, input.eventId)
    if (current?.status === OUTBOX_STATUS.PUBLISHED)
      return { status: OUTBOX_RESULT_STATUS.ALREADY_PUBLISHED, record: current }
    throw new Error('Outbox publication claim is not owned')
  }

  async recover(input: OutboxRecoveryInput): Promise<number> {
    const result = await this.executor.query<OutboxRow>(buildOutboxRecoveryCommand(input))
    return result.rowCount
  }

  async find(tenantId: string, eventId: string): Promise<OutboxRecord | null> {
    const result = await this.executor.query<OutboxRow>(buildOutboxFindCommand(tenantId, eventId))
    return result.rows[0] ? rowToOutboxRecord(result.rows[0]) : null
  }

  list(_tenantId: string): OutboxRecord[] {
    throw new Error('Postgres list requires a bounded query contract')
  }
}

export default { PostgresOutboxAdapter }
