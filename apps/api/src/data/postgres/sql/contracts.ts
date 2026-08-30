export const SQL_OPERATION = {
  LOCK: 'lock',
  AGGREGATE: 'aggregate',
  WINDOW: 'window',
  BULK: 'bulk',
  FULL_TEXT: 'full-text',
  GEOSPATIAL: 'geospatial',
  HOT_PATH: 'hot-path',
} as const

export type SqlOperation = (typeof SQL_OPERATION)[keyof typeof SQL_OPERATION]

export type SqlScalar = string | number | boolean | null
export type SqlParameter = SqlScalar | readonly SqlScalar[]

export interface TenantSqlScope {
  tenantId: string
  actorId: string
}

export interface SqlCommand<TRow = unknown> {
  operation: SqlOperation
  text: string
  parameters: readonly SqlParameter[]
  scope: TenantSqlScope
}

export interface SqlQueryResult<TRow> {
  rows: readonly TRow[]
  rowCount: number
}

export interface SqlExecutor {
  query<TRow>(command: SqlCommand<TRow>): Promise<SqlQueryResult<TRow>>
}

export function validateSqlScope(input: TenantSqlScope): TenantSqlScope {
  if (!input.tenantId.trim() || !input.actorId.trim()) {
    throw new Error('Tenant and actor identifiers are required')
  }
  return { tenantId: input.tenantId.trim(), actorId: input.actorId.trim() }
}

export function createSqlCommand<TRow>(
  operation: SqlOperation,
  text: string,
  scopeInput: TenantSqlScope,
  parameters: readonly SqlParameter[]
): SqlCommand<TRow> {
  const scope = validateSqlScope(scopeInput)
  return {
    operation,
    text,
    parameters: Object.freeze([scope.tenantId, scope.actorId, ...parameters]),
    scope,
  }
}

export const TENANT_AUTHORIZATION_PREDICATE = `
  "tenantId" = $1
  AND EXISTS (
    SELECT 1
    FROM "Membership" AS "membership"
    WHERE "membership"."tenantId" = $1
      AND "membership"."userId" = $2
      AND "membership"."status" = 'active'
  )`

export function cloneSqlValue<TValue>(value: TValue): TValue {
  return structuredClone(value)
}

export default { SQL_OPERATION, createSqlCommand, validateSqlScope }
