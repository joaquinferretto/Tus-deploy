import {
  createSqlCommand,
  SQL_OPERATION,
  TENANT_AUTHORIZATION_PREDICATE,
  type SqlCommand,
  type SqlExecutor,
  type TenantSqlScope,
} from './contracts.js'

export interface AggregateInput {
  scope: TenantSqlScope
  category: string
}

export interface AggregateResult {
  category: string
  totalAmount: number
  available: number
  recordCount: number
}

export interface WindowResult extends AggregateResult {
  id: string
  rank: number
}

export function buildAggregateQuery(input: AggregateInput): SqlCommand<AggregateResult> {
  const text = `
    WITH scoped AS (
      SELECT "category", "amount", "available"
      FROM "Inventory"
      WHERE ${TENANT_AUTHORIZATION_PREDICATE}
        AND "category" = $3
    )
    SELECT "category", COALESCE(SUM("amount"), 0) AS "totalAmount",
           COALESCE(SUM("available"), 0) AS "available", COUNT(*)::integer AS "recordCount"
    FROM scoped
    GROUP BY "category"`
  return createSqlCommand(SQL_OPERATION.AGGREGATE, text, input.scope, [input.category])
}

export function buildWindowQuery(input: AggregateInput): SqlCommand<WindowResult> {
  const text = `
    WITH scoped AS (
      SELECT "id", "category", "amount", "available",
             ROW_NUMBER() OVER (PARTITION BY "category" ORDER BY "amount" DESC, "id" ASC) AS "rank"
      FROM "Inventory"
      WHERE ${TENANT_AUTHORIZATION_PREDICATE}
        AND "category" = $3
    )
    SELECT "id", "category", "amount" AS "totalAmount", "available", "rank"
    FROM scoped
    ORDER BY "rank" ASC`
  return createSqlCommand(SQL_OPERATION.WINDOW, text, input.scope, [input.category])
}

export interface SqlAggregatePort {
  aggregate(input: AggregateInput): Promise<AggregateResult | null>
  window(input: AggregateInput): Promise<readonly WindowResult[]>
}

export class PostgresAggregateAdapter implements SqlAggregatePort {
  constructor(private readonly executor: SqlExecutor) {}

  async aggregate(input: AggregateInput): Promise<AggregateResult | null> {
    const result = await this.executor.query<AggregateResult>(buildAggregateQuery(input))
    return result.rows[0] ?? null
  }

  async window(input: AggregateInput): Promise<readonly WindowResult[]> {
    const result = await this.executor.query<WindowResult>(buildWindowQuery(input))
    return result.rows
  }
}

export default { PostgresAggregateAdapter, buildAggregateQuery, buildWindowQuery }
