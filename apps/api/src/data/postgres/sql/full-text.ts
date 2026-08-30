import {
  createSqlCommand,
  SQL_OPERATION,
  TENANT_AUTHORIZATION_PREDICATE,
  type SqlCommand,
  type SqlExecutor,
  type TenantSqlScope,
} from './contracts.js'
import type { HotPathRecord } from './fake.js'

export interface FullTextInput {
  scope: TenantSqlScope
  search: string
  limit?: number
}

export function buildFullTextQuery(input: FullTextInput): SqlCommand<HotPathRecord> {
  const limit = input.limit ?? 20
  if (!input.search.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Full-text search requires a bounded search and limit')
  }
  const text = `
    SELECT "id", "tenantId", "resourceId", "category", "text", "latitude", "longitude", "amount", "available", "updatedAt"
    FROM "Inventory"
    WHERE ${TENANT_AUTHORIZATION_PREDICATE}
      AND "searchVector" @@ plainto_tsquery('simple', $3)
    ORDER BY ts_rank("searchVector", plainto_tsquery('simple', $3)) DESC, "id" ASC
    LIMIT $4`
  return createSqlCommand(SQL_OPERATION.FULL_TEXT, text, input.scope, [input.search, limit])
}

export interface SqlFullTextPort {
  search(input: FullTextInput): Promise<readonly HotPathRecord[]>
}

export class PostgresFullTextAdapter implements SqlFullTextPort {
  constructor(private readonly executor: SqlExecutor) {}

  async search(input: FullTextInput): Promise<readonly HotPathRecord[]> {
    const result = await this.executor.query<HotPathRecord>(buildFullTextQuery(input))
    return result.rows
  }
}

export default { PostgresFullTextAdapter, buildFullTextQuery }
