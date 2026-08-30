import type { RunLedgerRecord } from '../jobs/domain.js'
import type { JsonValue } from '../idempotency/domain.js'
import {
  buildRunLedgerCreateCommand,
  buildRunLedgerFindByIdempotencyCommand,
  buildRunLedgerFindCommand,
  buildRunLedgerUpdateCommand,
  rowToRunLedgerRecord,
  type RunLedgerCreateInput,
  type RunLedgerSqlExecutor,
} from './sql.js'

export class PostgresRunLedgerAdapter {
  constructor(private readonly executor: RunLedgerSqlExecutor) {}

  async create(input: RunLedgerCreateInput): Promise<RunLedgerRecord> {
    const result = await this.executor.query(buildRunLedgerCreateCommand(input))
    const row = result.rows[0]
    if (row) return rowToRunLedgerRecord(row)
    const existing = await this.findByIdempotency(input.tenantId, input.idempotencyKey)
    if (!existing) throw new Error('Run ledger create did not return a record')
    return existing
  }

  async find(tenantId: string, runId: string): Promise<RunLedgerRecord | null> {
    const result = await this.executor.query(buildRunLedgerFindCommand(tenantId, runId))
    const row = result.rows[0]
    return row ? rowToRunLedgerRecord(row) : null
  }

  async findByIdempotency(
    tenantId: string,
    idempotencyKey: string
  ): Promise<RunLedgerRecord | null> {
    const result = await this.executor.query(
      buildRunLedgerFindByIdempotencyCommand(tenantId, idempotencyKey)
    )
    const row = result.rows[0]
    return row ? rowToRunLedgerRecord(row) : null
  }

  async update(input: {
    tenantId: string
    runId: string
    status: RunLedgerRecord['status']
    result: JsonValue | null
    error: JsonValue | null
    now: number
  }): Promise<RunLedgerRecord> {
    const result = await this.executor.query(buildRunLedgerUpdateCommand(input))
    const row = result.rows[0]
    if (!row) throw new Error('Run ledger record not found')
    return rowToRunLedgerRecord(row)
  }
}

export default { PostgresRunLedgerAdapter }
