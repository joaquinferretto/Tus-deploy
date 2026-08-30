import { validateCrudQuery, validateTenantId } from '../domain/query.js'
import type { CrudFilter, CrudPage, CrudQuery, CrudResourceDefinition, TenantCrudRecord } from '../domain/types.js'
import type { CrudRepository } from '../ports/repository.js'

export class InMemoryCrudRepository<TRecord extends TenantCrudRecord = TenantCrudRecord> implements CrudRepository<TRecord> {
  private readonly records = new Map<string, TRecord>()

  constructor(private readonly definition?: CrudResourceDefinition) {}

  async create(record: TRecord): Promise<TRecord> {
    const tenantId = validateTenantId(record.tenantId)
    if (!record.id.trim()) throw new Error('CRUD record id is required')
    const key = recordKey(tenantId, record.id)
    if (this.records.has(key)) throw new Error('CRUD record already exists')
    const copy = clone(record)
    this.records.set(key, copy)
    return clone(copy)
  }

  async findById(tenantId: string, id: string): Promise<TRecord | null> {
    const record = this.records.get(recordKey(validateTenantId(tenantId), id))
    return record ? clone(record) : null
  }

  async update(tenantId: string, id: string, patch: Partial<Omit<TRecord, 'id' | 'tenantId'>>): Promise<TRecord | null> {
    const key = recordKey(validateTenantId(tenantId), id)
    const current = this.records.get(key)
    if (!current) return null
    const copy = clone({ ...current, ...patch, id: current.id, tenantId: current.tenantId } as TRecord)
    this.records.set(key, copy)
    return clone(copy)
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    return this.records.delete(recordKey(validateTenantId(tenantId), id))
  }

  async search(tenantId: string, query: CrudQuery): Promise<CrudPage<TRecord>> {
    const scopedTenant = validateTenantId(tenantId)
    const normalizedQuery = validateCrudQuery(query, this.definition ?? definitionFromQuery(query, this.records))
    const matching = [...this.records.values()]
      .filter((record) => record.tenantId === scopedTenant)
      .filter((record) => normalizedQuery.filters.every((filter) => matchesFilter(record, filter)))
      .filter((record) => matchesSearch(record, normalizedQuery.search, this.definition?.searchableFields))
      .sort((left, right) => compareRecords(left, right, normalizedQuery))
    const start = (normalizedQuery.page - 1) * normalizedQuery.pageSize
    return { items: matching.slice(start, start + normalizedQuery.pageSize).map(clone), page: normalizedQuery.page, pageSize: normalizedQuery.pageSize, total: matching.length }
  }
}

function recordKey(tenantId: string, id: string): string { return `${tenantId}:${id}` }

function definitionFromQuery(query: CrudQuery, records: ReadonlyMap<string, TenantCrudRecord>): CrudResourceDefinition {
  const fields = new Set<string>(['id'])
  for (const filter of query.filters) fields.add(filter.field)
  for (const sort of query.sort) fields.add(sort.field)
  for (const record of records.values()) for (const field of Object.keys(record)) fields.add(field)
  return { resourceType: 'generic', filterableFields: [...fields], sortableFields: [...fields], searchableFields: query.search ? [...fields].filter((field) => field !== 'id' && field !== 'tenantId') : [] }
}

function matchesFilter(record: TenantCrudRecord, filter: CrudFilter): boolean {
  const actual = record[filter.field]
  const expected = filter.value
  switch (filter.operator) {
    case 'eq': return actual === expected
    case 'ne': return actual !== expected
    case 'contains': return typeof actual === 'string' && typeof expected === 'string' && actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
    case 'startsWith': return typeof actual === 'string' && typeof expected === 'string' && actual.toLocaleLowerCase().startsWith(expected.toLocaleLowerCase())
    case 'in': return Array.isArray(expected) && expected.some((item) => actual === item)
    case 'gt': return compareScalar(actual, expected) > 0
    case 'gte': return compareScalar(actual, expected) >= 0
    case 'lt': return compareScalar(actual, expected) < 0
    case 'lte': return compareScalar(actual, expected) <= 0
  }
}

function matchesSearch(record: TenantCrudRecord, search: string | undefined, fields?: readonly string[]): boolean {
  if (!search) return true
  const candidates = fields?.map((field) => record[field]) ?? Object.entries(record).filter(([field]) => field !== 'id' && field !== 'tenantId').map(([, value]) => value)
  const needle = search.toLocaleLowerCase()
  return candidates.some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle))
}

function compareRecords(left: TenantCrudRecord, right: TenantCrudRecord, query: CrudQuery): number {
  for (const sort of query.sort) {
    const compared = compareScalar(left[sort.field], right[sort.field])
    if (compared !== 0) return sort.direction === 'asc' ? compared : -compared
  }
  return left.id.localeCompare(right.id)
}

function compareScalar(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' })
}

function clone<T>(value: T): T { return structuredClone(value) }

export default { InMemoryCrudRepository }
