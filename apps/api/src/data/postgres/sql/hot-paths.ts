import {
  createSqlCommand,
  SQL_OPERATION,
  TENANT_AUTHORIZATION_PREDICATE,
  type SqlCommand,
  type SqlExecutor,
  type TenantSqlScope,
} from './contracts.js'
import type { HotPathRecord } from './fake.js'

export interface HotPathInput {
  scope: TenantSqlScope
  resourceId: string
}

export function buildHotPathQuery(input: HotPathInput): SqlCommand<HotPathRecord> {
  if (!input.resourceId.trim()) throw new Error('A hot-path resource id is required')
  const text = `
    SELECT "id", "tenantId", "resourceId", "category", "text", "latitude", "longitude", "amount", "available", "updatedAt"
    FROM "Inventory"
    WHERE ${TENANT_AUTHORIZATION_PREDICATE}
      AND "id" = $3
    FOR KEY SHARE`
  return createSqlCommand(SQL_OPERATION.HOT_PATH, text, input.scope, [input.resourceId])
}

export interface SqlHotPathPort {
  read(input: HotPathInput): Promise<HotPathRecord | null>
}

export class PostgresHotPathAdapter implements SqlHotPathPort {
  constructor(private readonly executor: SqlExecutor) {}

  async read(input: HotPathInput): Promise<HotPathRecord | null> {
    const result = await this.executor.query<HotPathRecord>(buildHotPathQuery(input))
    return result.rows[0] ?? null
  }
}

export default { PostgresHotPathAdapter, buildHotPathQuery }
