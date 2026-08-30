import {
  createSqlCommand,
  SQL_OPERATION,
  TENANT_AUTHORIZATION_PREDICATE,
  type SqlCommand,
  type SqlExecutor,
  type TenantSqlScope,
} from './contracts.js'

export interface BulkUpdateInput {
  scope: TenantSqlScope
  ids: readonly string[]
  status: string
  now: number
}

export function buildBulkUpdateQuery(input: BulkUpdateInput): SqlCommand<never> {
  if (!input.ids.length || input.ids.some((id) => !id.trim()) || !input.status.trim()) {
    throw new Error('Bulk updates require ids and a status')
  }
  const text = `
    UPDATE "Inventory"
    SET "status" = $4, "updatedAt" = $5
    WHERE ${TENANT_AUTHORIZATION_PREDICATE}
      AND "id" = ANY($3::text[])`
  return createSqlCommand(SQL_OPERATION.BULK, text, input.scope, [
    input.ids,
    input.status,
    input.now,
  ])
}

export interface SqlBulkPort {
  update(input: BulkUpdateInput): Promise<{ updated: number }>
}

export class PostgresBulkAdapter implements SqlBulkPort {
  constructor(private readonly executor: SqlExecutor) {}

  async update(input: BulkUpdateInput): Promise<{ updated: number }> {
    const result = await this.executor.query<never>(buildBulkUpdateQuery(input))
    return { updated: result.rowCount }
  }
}

export default { PostgresBulkAdapter, buildBulkUpdateQuery }
