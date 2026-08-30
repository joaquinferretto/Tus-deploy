export const SUPERADMIN_RESULT_CODE = {
  ALLOWED: 'ALLOWED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID: 'INVALID',
  NOT_FOUND: 'NOT_FOUND',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
  CONFLICT: 'CONFLICT',
} as const

export type SuperadminResultCode =
  (typeof SUPERADMIN_RESULT_CODE)[keyof typeof SUPERADMIN_RESULT_CODE]

export const SUPERADMIN_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const

export type SuperadminStatus = (typeof SUPERADMIN_STATUS)[keyof typeof SUPERADMIN_STATUS]

export const SUPPORT_SESSION_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
} as const

export type SupportSessionStatus =
  (typeof SUPPORT_SESSION_STATUS)[keyof typeof SUPPORT_SESSION_STATUS]

export interface ProductAdminIdentity {
  id: string
  productId: string
  actorId: string
  permissions: string[]
  status: SuperadminStatus
  createdAt: number
  revokedAt: number | null
}

export interface ProductPolicyVersion {
  productId: string
  version: number
  permissions: string[]
  createdBy: string
  approvedBy: string
  reason: string
  createdAt: number
  status: 'active' | 'superseded' | 'rolled_back'
}

export interface ProductPolicy {
  productId: string
  activeVersion: number
  versions: ProductPolicyVersion[]
  disabledAt: number | null
  disabledReason: string | null
}

export interface BreakGlassGrant {
  id: string
  productId: string
  actorId: string
  approvedBy: string
  reason: string
  issuedAt: number
  expiresAt: number
  revokedAt: number | null
}

export interface SupportSession {
  id: string
  productId: string
  actorId: string
  tenantId: string
  targetActorId: string | null
  permissions: string[]
  status: SupportSessionStatus
  issuedAt: number
  expiresAt: number
  revokedAt: number | null
}

export interface ProductAdminContext {
  productId: string
  actorId: string
  action: string
  tenantId?: string
  breakGlassId?: string
  correlationId: string
}

export type ProductAdminFailure = {
  ok: false
  code: SuperadminResultCode
  message: string
}

export type ProductAdminDecision =
  | { ok: true; code: typeof SUPERADMIN_RESULT_CODE.ALLOWED; reason: string }
  | ProductAdminFailure

export function isHighRiskAction(action: string): boolean {
  return (
    action === 'policy:rollback' ||
    action === 'policy:write' ||
    action === 'support:impersonate' ||
    action === 'support:write' ||
    action === 'admin:grant'
  )
}
