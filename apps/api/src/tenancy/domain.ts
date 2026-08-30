export const TENANCY_RESULT_CODE = {
  ALLOWED: 'ALLOWED',
  INVALID_TENANT_CONTEXT: 'INVALID_TENANT_CONTEXT',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  EXPIRED: 'EXPIRED',
  REPLAYED: 'REPLAYED',
  INVALID: 'INVALID',
} as const

export type TenancyResultCode = (typeof TENANCY_RESULT_CODE)[keyof typeof TENANCY_RESULT_CODE]

export const MEMBERSHIP_STATUS = {
  ACTIVE: 'active',
  INVITED: 'invited',
  SUSPENDED: 'suspended',
  REVOKED: 'revoked',
} as const

export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[keyof typeof MEMBERSHIP_STATUS]

export const INVITATION_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
} as const

export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS]

export interface TenantContext {
  tenantId: string
  actorId: string
  correlationId: string
}

export interface ResourceScope {
  resourceType: string
  resourceId?: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  defaultWorkspaceId: string
  createdAt: number
}

export interface Workspace {
  id: string
  organizationId: string
  name: string
  slug: string
  createdAt: number
}

export interface Role {
  id: string
  tenantId: string
  name: string
  permissions: string[]
  resourceScopes: string[]
  createdAt: number
}

export interface Membership {
  id: string
  tenantId: string
  userId: string
  roleIds: string[]
  status: MembershipStatus
  createdAt: number
  revokedAt: number | null
}

export interface Invitation {
  id: string
  tenantId: string
  email: string
  roleIds: string[]
  tokenDigest: string
  status: InvitationStatus
  expiresAt: number
  createdAt: number
  acceptedAt: number | null
}

export interface TenantResource {
  id: string
  tenantId: string
  type: string
  value: string
}

export interface AuditMetadata {
  action?: string
  resourceType?: string
  emailHash?: string
  roleCount?: number
  membershipId?: string
}

export interface TenancyAuditEvent {
  action: string
  actorId: string | null
  tenantId: string | null
  correlationId: string
  outcome: 'success' | 'denied'
  reason: string
  occurredAt: string
  metadata: AuditMetadata
}

export interface AuthorizationRequest {
  context?: TenantContext
  action: string
  resourceType: string
  resourceId?: string
  resourceTenantId?: string
}

export interface AuthorizationDecision {
  allowed: boolean
  code: TenancyResultCode
  reason: string
}

export type TenancyFailure = { ok: false; code: TenancyResultCode; message: string }

export function validTenantContext(context: TenantContext | undefined): context is TenantContext {
  return Boolean(context?.tenantId.trim() && context.actorId.trim() && context.correlationId.trim())
}

export function scopeMatches(scope: string, resource: ResourceScope): boolean {
  return (
    scope === '*' ||
    scope === `${resource.resourceType}:*` ||
    (Boolean(resource.resourceId) && scope === `${resource.resourceType}:${resource.resourceId}`)
  )
}
