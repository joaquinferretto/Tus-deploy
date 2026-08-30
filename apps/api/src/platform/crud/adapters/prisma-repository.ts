import { validateCrudQuery, validateTenantId } from '../domain/query.js'
import type { CrudPage, CrudPatch, CrudQuery, CrudResourceDefinition, TenantCrudRecord } from '../domain/types.js'
import type { CrudRepository } from '../ports/repository.js'

type PrismaWhere = Record<string, unknown>
type PrismaOrder = Record<string, 'asc' | 'desc'>

export interface PrismaCrudDelegate<TRecord extends TenantCrudRecord = TenantCrudRecord> {
  create(args: { data: TRecord }): Promise<TRecord>
  findUnique(args: { where: PrismaWhere }): Promise<TRecord | null>
  update(args: { where: PrismaWhere; data: CrudPatch<TRecord> }): Promise<TRecord>
  delete(args: { where: PrismaWhere }): Promise<TRecord>
  findMany(args: { where: PrismaWhere; orderBy: readonly PrismaOrder[]; skip: number; take: number }): Promise<TRecord[]>
  count(args: { where: PrismaWhere }): Promise<number>
}

export class PrismaCrudRepository<TRecord extends TenantCrudRecord = TenantCrudRecord> implements CrudRepository<TRecord> {
  constructor(private readonly delegate: PrismaCrudDelegate<TRecord>, private readonly definition: CrudResourceDefinition) {}

  async create(record: TRecord): Promise<TRecord> {
    validateTenantId(record.tenantId)
    return this.delegate.create({ data: record })
  }

  async findById(tenantId: string, id: string): Promise<TRecord | null> {
    return this.delegate.findUnique({ where: { id, tenantId: validateTenantId(tenantId) } })
  }

  async update(tenantId: string, id: string, patch: CrudPatch<TRecord>): Promise<TRecord | null> {
    assertSafePatch(patch)
    return this.delegate.update({ where: { id, tenantId: validateTenantId(tenantId) }, data: patch })
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    await this.delegate.delete({ where: { id, tenantId: validateTenantId(tenantId) } })
    return true
  }

  async search(tenantId: string, input: CrudQuery): Promise<CrudPage<TRecord>> {
    const query = validateCrudQuery(input, this.definition)
    const where = toPrismaWhere(validateTenantId(tenantId), query, this.definition)
    const items = await this.delegate.findMany({ where, orderBy: query.sort.map(({ field, direction }) => ({ [field]: direction })), skip: (query.page - 1) * query.pageSize, take: query.pageSize })
    const total = await this.delegate.count({ where })
    return { items, page: query.page, pageSize: query.pageSize, total }
  }
}

export function toPrismaWhere(tenantId: string, query: CrudQuery, definition?: CrudResourceDefinition): PrismaWhere {
  const conditions: PrismaWhere[] = query.filters.map(({ field, operator, value }) => {
    switch (operator) {
      case 'eq': return { [field]: value }
      case 'ne': return { [field]: { not: value } }
      case 'contains': return { [field]: { contains: value, mode: 'insensitive' } }
      case 'startsWith': return { [field]: { startsWith: value, mode: 'insensitive' } }
      case 'in': return { [field]: { in: value } }
      case 'gt': return { [field]: { gt: value } }
      case 'gte': return { [field]: { gte: value } }
      case 'lt': return { [field]: { lt: value } }
      case 'lte': return { [field]: { lte: value } }
    }
  })
  if (query.search) conditions.push({ OR: (definition?.searchableFields ?? []).map((field) => ({ [field]: { contains: query.search, mode: 'insensitive' } })) })
  return conditions.length === 0 ? { tenantId } : { tenantId, AND: conditions }
}

function assertSafePatch<TRecord extends TenantCrudRecord>(patch: CrudPatch<TRecord>): void {
  for (const key of Object.keys(patch)) if (key === 'id' || key === 'tenantId' || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('CRUD patch cannot change identity or tenant scope')
}

export default { PrismaCrudRepository, toPrismaWhere }
