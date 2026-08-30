import type { TenantContext } from '../../../tenancy/domain.js'

export const CRUD_FILTER_OPERATOR = {
  EQ: 'eq',
  NE: 'ne',
  CONTAINS: 'contains',
  STARTS_WITH: 'startsWith',
  IN: 'in',
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
} as const

export type CrudFilterOperator = (typeof CRUD_FILTER_OPERATOR)[keyof typeof CRUD_FILTER_OPERATOR]

export const CRUD_SORT_DIRECTION = {
  ASC: 'asc',
  DESC: 'desc',
} as const

export type CrudSortDirection = (typeof CRUD_SORT_DIRECTION)[keyof typeof CRUD_SORT_DIRECTION]

export const CRUD_ACTION = {
  READ: 'resource:read',
  WRITE: 'resource:write',
  DELETE: 'resource:delete',
} as const

export type CrudAction = (typeof CRUD_ACTION)[keyof typeof CRUD_ACTION]

export const CRUD_RESULT_CODE = {
  ALLOWED: 'ALLOWED',
  INVALID: 'INVALID',
  INVALID_TENANT_CONTEXT: 'INVALID_TENANT_CONTEXT',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
} as const

export type CrudResultCode = (typeof CRUD_RESULT_CODE)[keyof typeof CRUD_RESULT_CODE]

export interface CrudResourceDefinition {
  resourceType: string
  filterableFields: readonly string[]
  sortableFields: readonly string[]
  searchableFields: readonly string[]
  writableFields?: readonly string[]
}

export interface TenantCrudRecord {
  id: string
  tenantId: string
  [field: string]: unknown
}

export interface CrudFilter {
  field: string
  operator: CrudFilterOperator
  value: CrudFilterValue
}

export type CrudFilterValue = string | number | boolean | null | readonly CrudScalarValue[]
export type CrudScalarValue = string | number | boolean | null

export interface CrudSort {
  field: string
  direction: CrudSortDirection
}

export interface CrudQuery {
  page: number
  pageSize: number
  filters: readonly CrudFilter[]
  sort: readonly CrudSort[]
  search?: string
}

export interface CrudPage<TRecord extends TenantCrudRecord = TenantCrudRecord> {
  items: readonly TRecord[]
  page: number
  pageSize: number
  total: number
}

export interface CrudAuthorizationRequest {
  context?: TenantContext
  action: CrudAction
  resourceType: string
  resourceId?: string
  resourceTenantId?: string
}

export interface CrudAuthorizationDecision {
  allowed: boolean
  code: string
  reason: string
}

export interface CrudAuthorizationPort {
  authorize(input: CrudAuthorizationRequest): Promise<CrudAuthorizationDecision>
}

export interface CrudIdGenerator {
  next(): string
}

export interface CrudClock {
  now(): number
}

export type CrudPatch<TRecord extends TenantCrudRecord = TenantCrudRecord> = Partial<
  Omit<TRecord, 'id' | 'tenantId'
>>

export type CrudCreateData = Record<string, unknown>

export type CrudRecordWith<TData extends CrudCreateData = CrudCreateData> = TData &
  Pick<TenantCrudRecord, 'id' | 'tenantId'>
