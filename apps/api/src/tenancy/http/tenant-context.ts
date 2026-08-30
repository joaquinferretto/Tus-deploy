import type { TenantContext } from '../domain.js'

export interface TenantHeaders {
  'x-tenant-id'?: string
  'x-actor-id'?: string
  'x-correlation-id'?: string
}

export function tenantContextFromHeaders(headers: TenantHeaders): TenantContext | null {
  const tenantId = headers['x-tenant-id']?.trim()
  const actorId = headers['x-actor-id']?.trim()
  const correlationId = headers['x-correlation-id']?.trim()
  if (!tenantId || !actorId || !correlationId) return null
  return { tenantId, actorId, correlationId }
}
