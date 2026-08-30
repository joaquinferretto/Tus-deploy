const TENANT_FILTER_ERROR = {
  CONTEXT_REQUIRED: 'MONGO_TENANT_CONTEXT_REQUIRED',
  FILTER_MISMATCH: 'MONGO_TENANT_FILTER_MISMATCH',
} as const

export interface MongoFilter {
  id?: string
  collection?: string
}

export interface TenantScopedMongoFilter extends MongoFilter {
  tenantId: string
}

export class MongoTenantFilterError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MongoTenantFilterError'
    this.code = code
  }
}

export function buildTenantFilter(
  tenantId: unknown,
  filter: unknown = {}
): TenantScopedMongoFilter {
  if (typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new MongoTenantFilterError(
      TENANT_FILTER_ERROR.CONTEXT_REQUIRED,
      'Mongo operations require a non-empty tenant id'
    )
  }

  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
    throw new MongoTenantFilterError(
      TENANT_FILTER_ERROR.FILTER_MISMATCH,
      'Mongo filters must be tenant-scoped objects'
    )
  }

  const candidate = filter as Record<string, unknown>
  if ('tenantId' in candidate && candidate['tenantId'] !== tenantId) {
    throw new MongoTenantFilterError(
      TENANT_FILTER_ERROR.FILTER_MISMATCH,
      'Mongo filter tenant does not match the request tenant'
    )
  }

  const result: TenantScopedMongoFilter = { tenantId: tenantId.trim() }
  if (typeof candidate['id'] === 'string' && candidate['id'].trim()) {
    result.id = candidate['id']
  }
  if (typeof candidate['collection'] === 'string' && candidate['collection'].trim()) {
    result.collection = candidate['collection']
  }
  return result
}

export function assertTenantFilter(filter: unknown): TenantScopedMongoFilter {
  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
    throw new MongoTenantFilterError(
      TENANT_FILTER_ERROR.CONTEXT_REQUIRED,
      'Mongo operations require a tenant-scoped filter'
    )
  }
  const candidate = filter as Record<string, unknown>
  return buildTenantFilter(candidate['tenantId'], candidate)
}

export default { buildTenantFilter, assertTenantFilter }
