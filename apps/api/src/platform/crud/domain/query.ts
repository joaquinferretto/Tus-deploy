import { CrudQueryError } from './errors.js'
import {
  CRUD_FILTER_OPERATOR as FILTER_OPERATOR,
  CRUD_SORT_DIRECTION as SORT_DIRECTION,
  type CrudFilter,
  type CrudFilterValue,
  type CrudQuery,
  type CrudResourceDefinition,
  type CrudScalarValue,
} from './types.js'

export const CRUD_FILTER_OPERATOR = FILTER_OPERATOR
export const CRUD_SORT_DIRECTION = SORT_DIRECTION

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_FILTERS = 20
const MAX_SEARCH_LENGTH = 256
const RESERVED_FIELDS = new Set(['__proto__', 'prototype', 'constructor'])

export function validateCrudQuery(input: unknown, definition: CrudResourceDefinition): CrudQuery {
  const record = asRecord(input, 'CRUD_QUERY_INVALID')
  const page = readPositiveInteger(record['page'], DEFAULT_PAGE, 'CRUD_QUERY_INVALID_PAGE')
  const pageSize = readPositiveInteger(record['pageSize'], DEFAULT_PAGE_SIZE, 'CRUD_QUERY_INVALID_PAGE_SIZE')
  if (pageSize > MAX_PAGE_SIZE) throw new CrudQueryError('CRUD_QUERY_INVALID_PAGE_SIZE', 'pageSize exceeds the maximum')

  const filters = readFilters(record['filters'], definition)
  const sort = readSort(record['sort'], definition)
  const search = readSearch(record['search'], definition)

  return {
    page,
    pageSize,
    search,
    filters,
    sort: appendStableSort(sort),
  }
}

export function validateTenantId(tenantId: unknown): string {
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new CrudQueryError('CRUD_TENANT_REQUIRED', 'tenantId is required')
  return tenantId.trim()
}

function readPositiveInteger(value: unknown, fallback: number, code: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || Number(value) < 1) throw new CrudQueryError(code, 'value must be a positive integer')
  return Number(value)
}

function readFilters(value: unknown, definition: CrudResourceDefinition): CrudFilter[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_FILTERS) throw new CrudQueryError('CRUD_QUERY_INVALID_FILTERS', 'filters must be a bounded array')
  return value.map((candidate) => {
    const filter = asRecord(candidate, 'CRUD_QUERY_INVALID_FILTER')
    const field = readAllowedField(filter['field'], definition.filterableFields)
    const operator = readOperator(filter['operator'])
    return { field, operator, value: readFilterValue(filter['value'], operator) }
  })
}

function readSort(value: unknown, definition: CrudResourceDefinition): { field: string; direction: 'asc' | 'desc' }[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_FILTERS) throw new CrudQueryError('CRUD_QUERY_INVALID_SORT', 'sort must be a bounded array')
  return value.map((candidate) => {
    const sort = asRecord(candidate, 'CRUD_QUERY_INVALID_SORT')
    const field = readAllowedField(sort['field'], definition.sortableFields, true)
    if (sort['direction'] !== SORT_DIRECTION.ASC && sort['direction'] !== SORT_DIRECTION.DESC) throw new CrudQueryError('CRUD_QUERY_INVALID_DIRECTION', 'sort direction is unsupported')
    return { field, direction: sort['direction'] }
  })
}

function readSearch(value: unknown, definition: CrudResourceDefinition): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new CrudQueryError('CRUD_QUERY_INVALID_SEARCH', 'search must be a string')
  const search = value.trim()
  if (search.length > MAX_SEARCH_LENGTH) throw new CrudQueryError('CRUD_QUERY_SEARCH_TOO_LONG', 'search exceeds the maximum length')
  if (search && definition.searchableFields.length === 0) throw new CrudQueryError('CRUD_QUERY_SEARCH_UNSUPPORTED', 'search is not supported for this resource')
  return search || undefined
}

function readAllowedField(value: unknown, fields: readonly string[], allowId = false): string {
  if (typeof value !== 'string' || RESERVED_FIELDS.has(value) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw new CrudQueryError('CRUD_QUERY_INVALID_FIELD', 'field is not safe')
  if ((allowId && value === 'id') || fields.includes(value)) return value
  throw new CrudQueryError('CRUD_QUERY_INVALID_FIELD', `field '${value}' is not allowed`)
}

function readOperator(value: unknown) {
  if (!Object.values(FILTER_OPERATOR).includes(value as never)) throw new CrudQueryError('CRUD_QUERY_INVALID_OPERATOR', 'filter operator is unsupported')
  return value as (typeof FILTER_OPERATOR)[keyof typeof FILTER_OPERATOR]
}

function readFilterValue(value: unknown, operator: ReturnType<typeof readOperator>): CrudFilterValue {
  if (operator === FILTER_OPERATOR.IN) {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => !isScalar(item))) throw new CrudQueryError('CRUD_QUERY_INVALID_VALUE', 'in filters require scalar values')
    return value as CrudScalarValue[]
  }
  if (!isScalar(value)) throw new CrudQueryError('CRUD_QUERY_INVALID_VALUE', 'filter value must be scalar')
  return value
}

function isScalar(value: unknown): value is CrudScalarValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function appendStableSort(sort: readonly { field: string; direction: 'asc' | 'desc' }[]) {
  const normalized = [...sort]
  if (!normalized.some((entry) => entry.field === 'id')) normalized.push({ field: 'id', direction: 'asc' })
  return normalized
}

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CrudQueryError(code, 'value must be an object')
  return value as Record<string, unknown>
}

export default { CRUD_FILTER_OPERATOR, CRUD_SORT_DIRECTION, validateCrudQuery, validateTenantId }
