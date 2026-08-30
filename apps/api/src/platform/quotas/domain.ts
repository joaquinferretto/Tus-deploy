export const QUOTA_CONTRACT_VERSION = '1.0.0' as const

export const QUOTA_SCOPE = {
  PROFILE: 'profile',
  TENANT: 'tenant',
  PRODUCT: 'product',
} as const

export type QuotaScope = (typeof QUOTA_SCOPE)[keyof typeof QUOTA_SCOPE]

export const QUOTA_RESULT_CODE = {
  INVALID: 'INVALID',
  POLICY_NOT_FOUND: 'POLICY_NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  RESERVATION_NOT_FOUND: 'RESERVATION_NOT_FOUND',
  RESERVATION_CONTEXT_MISMATCH: 'RESERVATION_CONTEXT_MISMATCH',
  RESERVATION_NOT_ACTIVE: 'RESERVATION_NOT_ACTIVE',
} as const

export type QuotaResultCode = (typeof QUOTA_RESULT_CODE)[keyof typeof QUOTA_RESULT_CODE]

export const RESERVATION_STATUS = {
  HELD: 'held',
  COMMITTED: 'committed',
  RELEASED: 'released',
  EXPIRED: 'expired',
} as const

export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS]

export const USAGE_UNIT = {
  REQUESTS: 'requests',
  TOKENS: 'tokens',
  AUDIO_SECONDS: 'audio_seconds',
  IMAGE_UNITS: 'image_units',
  STORAGE_BYTES: 'storage_bytes',
  CUSTOM: 'custom',
} as const

export type UsageUnit = (typeof USAGE_UNIT)[keyof typeof USAGE_UNIT]

export interface QuotaContext {
  profile: string
  tenantId: string
  productId?: string
}

export interface RateLimitPolicy {
  maxRequests: number
  windowMs: number
}

export interface QuotaPolicy {
  contractVersion: typeof QUOTA_CONTRACT_VERSION
  id: string
  scope: QuotaScope
  scopeId: string
  resource: string
  version: number
  limitUnits: number
  budgetUnits: number
  windowMs: number
  rateLimit: RateLimitPolicy
}

export type QuotaPolicyInput = Omit<QuotaPolicy, 'contractVersion' | 'id'> &
  Partial<Pick<QuotaPolicy, 'contractVersion' | 'id'>>

export interface UsageAmount {
  unit: UsageUnit
  quantity: number
  costUnits: number
}

export interface QuotaReservation {
  contractVersion: typeof QUOTA_CONTRACT_VERSION
  reservationId: string
  profile: string
  tenantId: string
  productId: string | null
  resource: string
  unit: UsageUnit
  units: number
  costUnits: number
  policyVersion: number
  usageWindowStart: number
  rateWindowStart: number
  status: ReservationStatus
  createdAt: number
  expiresAt: number
  completedAt: number | null
}

export interface UsageSnapshot {
  contractVersion: typeof QUOTA_CONTRACT_VERSION
  profile: string
  tenantId: string
  productId: string | null
  resource: string
  unit: UsageUnit
  windowStart: number
  windowEnd: number
  rateWindowStart: number
  units: number
  costUnits: number
  reservedUnits: number
  reservedCostUnits: number
  requestCount: number
}

export interface QuotaFailure {
  ok: false
  code: QuotaResultCode
  reason: string
  retryAt?: number
  remainingUnits?: number
  remainingBudgetUnits?: number
}

export type QuotaResult<T> = { ok: true; value: T } | QuotaFailure

export function quotaScopeKey(scope: QuotaScope, scopeId: string, resource: string): string {
  return `${scope}:${scopeId}:${resource}`
}

export function quotaContextKey(context: QuotaContext): string {
  return `${context.tenantId}:${context.productId ?? '*'}:${context.profile}`
}

export function usageKey(context: QuotaContext, resource: string, windowStart: number): string {
  return `${quotaContextKey(context)}:${resource}:${windowStart}`
}

export function validQuotaContext(context: QuotaContext): boolean {
  return Boolean(context.profile.trim() && context.tenantId.trim())
}

export function validQuotaPolicy(input: QuotaPolicyInput): boolean {
  return Boolean(
    input.scopeId.trim() &&
    input.resource.trim() &&
    Number.isSafeInteger(input.version) &&
    input.version > 0 &&
    Number.isSafeInteger(input.limitUnits) &&
    input.limitUnits >= 0 &&
    Number.isSafeInteger(input.budgetUnits) &&
    input.budgetUnits >= 0 &&
    Number.isSafeInteger(input.windowMs) &&
    input.windowMs > 0 &&
    Number.isSafeInteger(input.rateLimit.maxRequests) &&
    input.rateLimit.maxRequests > 0 &&
    Number.isSafeInteger(input.rateLimit.windowMs) &&
    input.rateLimit.windowMs > 0
  )
}

export function clonePolicy(policy: QuotaPolicy): QuotaPolicy {
  return { ...policy, rateLimit: { ...policy.rateLimit } }
}

export function cloneReservation(reservation: QuotaReservation): QuotaReservation {
  return { ...reservation }
}

export function cloneUsage(snapshot: UsageSnapshot): UsageSnapshot {
  return { ...snapshot }
}

export default {
  QUOTA_CONTRACT_VERSION,
  QUOTA_SCOPE,
  QUOTA_RESULT_CODE,
  RESERVATION_STATUS,
  USAGE_UNIT,
  quotaScopeKey,
  quotaContextKey,
  usageKey,
  validQuotaContext,
  validQuotaPolicy,
}
