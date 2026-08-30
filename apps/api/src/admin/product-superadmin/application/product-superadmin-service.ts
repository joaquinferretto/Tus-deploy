import { digestAuditValue, type AuditSink } from '../../../audit/index.js'
import {
  SUPERADMIN_RESULT_CODE,
  SUPERADMIN_STATUS,
  SUPPORT_SESSION_STATUS,
  type BreakGlassGrant,
  type ProductAdminContext,
  type ProductAdminDecision,
  type ProductAdminFailure,
  type ProductAdminIdentity,
  type ProductPolicy,
  type ProductPolicyVersion,
  type SuperadminResultCode,
  type SupportSession,
} from '../domain.js'
import type {
  ProductAdminClock,
  ProductAdminIdGenerator,
  ProductSuperadminStore,
} from '../ports.js'

const MAX_BREAK_GLASS_TTL_MS = 15 * 60 * 1000
const MAX_SUPPORT_SESSION_TTL_MS = 30 * 60 * 1000

export interface ProductSuperadminServiceDependencies {
  store: ProductSuperadminStore
  audit: AuditSink
  ids: ProductAdminIdGenerator
  clock: ProductAdminClock
}

export interface SeedSuperadminInput {
  productId: string
  actorId: string
  permissions: string[]
}

export interface BreakGlassInput {
  productId: string
  actorId: string
  reason: string
  approvedBy: string
  ttlMs?: number
  correlationId: string
}

export interface PublishPolicyInput extends BreakGlassInput {
  permissions: string[]
}

export interface RollbackPolicyInput extends BreakGlassInput {
  version: number
}

export interface SupportSessionInput {
  productId: string
  actorId: string
  tenantId: string
  targetActorId?: string
  reason: string
  approvedBy?: string
  ttlMs?: number
  correlationId: string
}

export interface SupportSessionDecisionInput {
  sessionId: string
  action: string
  tenantId: string
  correlationId: string
}

export interface EmergencyRevokeInput {
  productId: string
  actorId: string
  sessionId?: string
  targetActorId?: string
  reason: string
  correlationId: string
}

export interface DisableProductInput {
  productId: string
  actorId: string
  reason: string
  correlationId: string
}

export type SeedSuperadminResult = { ok: true; identity: ProductAdminIdentity } | ProductAdminFailure
export type BreakGlassResult = { ok: true; breakGlassId: string; expiresAt: number } | ProductAdminFailure
export type PolicyResult = { ok: true; version: ProductPolicyVersion } | ProductAdminFailure
export type SupportSessionResult =
  | { ok: true; sessionId: string; expiresAt: number; targetActorId: string | null }
  | ProductAdminFailure
export type OperationResult = { ok: true } | ProductAdminFailure

export class ProductSuperadminService {
  constructor(private readonly dependencies: ProductSuperadminServiceDependencies) {}

  async seedSuperadmin(input: SeedSuperadminInput): Promise<SeedSuperadminResult> {
    if (!input.productId.trim() || !input.actorId.trim() || input.permissions.length === 0)
      return this.failure('INVALID', 'invalid_superadmin_identity')
    const identity: ProductAdminIdentity = {
      id: this.dependencies.ids.next('superadmin'),
      productId: input.productId,
      actorId: input.actorId,
      permissions: [...new Set(input.permissions)].sort(),
      status: SUPERADMIN_STATUS.ACTIVE,
      createdAt: this.dependencies.clock.now(),
      revokedAt: null,
    }
    await this.dependencies.store.saveIdentity(identity)
    return { ok: true, identity }
  }

  async authorize(input: ProductAdminContext): Promise<ProductAdminDecision> {
    const identity = await this.dependencies.store.findIdentity(input.productId, input.actorId)
    if (!identity || identity.status !== SUPERADMIN_STATUS.ACTIVE)
      return this.deny(input, 'superadmin_identity_missing')

    const policy = await this.dependencies.store.findPolicy(input.productId)
    if (policy?.disabledAt !== null && policy?.disabledAt !== undefined) {
      await this.record(input, 'superadmin:authorize', 'denied', 'product_disabled', {
        action: input.action,
      })
      return this.failure('REVOKED', 'product_disabled')
    }

    if (input.breakGlassId) {
      const breakGlass = await this.dependencies.store.findBreakGlass(input.breakGlassId)
      if (!breakGlass || breakGlass.productId !== input.productId || breakGlass.actorId !== input.actorId)
        return this.deny(input, 'break_glass_not_found')
      if (breakGlass.revokedAt !== null) return this.failure('REVOKED', 'break_glass_revoked')
      if (breakGlass.expiresAt <= this.dependencies.clock.now()) {
        await this.record(input, 'break_glass:expired', 'denied', 'break_glass_expired', {})
        return this.failure('EXPIRED', 'break_glass_expired')
      }
      if (!identity.permissions.includes('break-glass:request'))
        return this.deny(input, 'break_glass_permission_denied')
      if (input.action.startsWith('tenant:')) return this.deny(input, 'tenant_authority_boundary')
      await this.record(input, 'superadmin:break-glass', 'success', 'break_glass_authorized', {
        action: input.action,
      })
      return { ok: true, code: SUPERADMIN_RESULT_CODE.ALLOWED, reason: 'break_glass_authorized' }
    }

    if (input.action.startsWith('tenant:')) return this.deny(input, 'tenant_authority_boundary')
    const effectivePermissions = policy
      ? policy.versions.find((version) => version.version === policy.activeVersion)?.permissions ?? []
      : identity.permissions
    if (!effectivePermissions.includes(input.action)) return this.deny(input, 'permission_denied')

    await this.record(input, 'superadmin:authorize', 'success', 'permission_granted', {
      action: input.action,
    })
    return { ok: true, code: SUPERADMIN_RESULT_CODE.ALLOWED, reason: 'permission_granted' }
  }

  async requestBreakGlass(input: BreakGlassInput): Promise<BreakGlassResult> {
    const ttlMs = input.ttlMs ?? 5 * 60 * 1000
    if (!input.reason.trim() || ttlMs < 1 || ttlMs > MAX_BREAK_GLASS_TTL_MS)
      return this.failure('INVALID', 'invalid_break_glass_request')
    const requester = await this.requireIdentity(input.productId, input.actorId, 'break-glass:request')
    if (!requester.ok) return requester
    const approval = await this.requireApproval(
      input.productId,
      input.actorId,
      input.approvedBy,
      'break-glass:request',
      'break-glass:approve'
    )
    if (!approval.ok) return approval
    const issuedAt = this.dependencies.clock.now()
    const grant: BreakGlassGrant = {
      id: this.dependencies.ids.next('break-glass'),
      productId: input.productId,
      actorId: input.actorId,
      approvedBy: input.approvedBy,
      reason: input.reason.trim(),
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      revokedAt: null,
    }
    await this.dependencies.store.saveBreakGlass(grant)
    await this.record(input, 'break-glass:request', 'success', 'break_glass_issued', {
      grantId: grant.id,
      expiresAt: grant.expiresAt,
      reasonHash: digestAuditValue(grant.reason),
    })
    return { ok: true, breakGlassId: grant.id, expiresAt: grant.expiresAt }
  }

  async publishPolicy(input: PublishPolicyInput): Promise<PolicyResult> {
    if (!input.reason.trim() || input.permissions.some((permission) => permission.startsWith('tenant:')))
      return this.failure('INVALID', 'invalid_product_policy')
    const control = await this.requireApproval(
      input.productId,
      input.actorId,
      input.approvedBy,
      'policy:write',
      'policy:approve'
    )
    if (!control.ok) return control
    const current = await this.dependencies.store.findPolicy(input.productId)
    const versionNumber = (current?.versions.at(-1)?.version ?? 0) + 1
    const version: ProductPolicyVersion = {
      productId: input.productId,
      version: versionNumber,
      permissions: [...new Set(input.permissions)].sort(),
      createdBy: input.actorId,
      approvedBy: input.approvedBy,
      reason: input.reason.trim(),
      createdAt: this.dependencies.clock.now(),
      status: 'active',
    }
    const policy: ProductPolicy = {
      productId: input.productId,
      activeVersion: versionNumber,
      versions: [...(current?.versions ?? []).map((entry) => ({ ...entry, status: 'superseded' as const })), version],
      disabledAt: current?.disabledAt ?? null,
      disabledReason: current?.disabledReason ?? null,
    }
    await this.dependencies.store.savePolicy(policy)
    await this.record(input, 'policy:publish', 'success', 'policy_version_published', {
      version: versionNumber,
      permissionsCount: version.permissions.length,
      reasonHash: digestAuditValue(version.reason),
    })
    return { ok: true, version }
  }

  async rollbackPolicy(input: RollbackPolicyInput): Promise<PolicyResult> {
    if (!input.reason.trim() || input.version < 1)
      return this.failure('INVALID', 'invalid_policy_rollback')
    const control = await this.requireApproval(
      input.productId,
      input.actorId,
      input.approvedBy,
      'policy:rollback',
      'policy:approve'
    )
    if (!control.ok) return control
    const policy = await this.dependencies.store.findPolicy(input.productId)
    const target = policy?.versions.find((version) => version.version === input.version)
    if (!policy || !target) return this.failure('NOT_FOUND', 'policy_version_not_found')
    if (policy.activeVersion === target.version) return this.failure('CONFLICT', 'policy_version_already_active')
    const versions = policy.versions.map((version) => ({
      ...version,
      status: version.version === target.version ? ('active' as const) : ('rolled_back' as const),
    }))
    const nextPolicy: ProductPolicy = { ...policy, activeVersion: target.version, versions }
    await this.dependencies.store.savePolicy(nextPolicy)
    await this.record(input, 'policy:rollback', 'success', 'policy_rolled_back', {
      version: target.version,
      reasonHash: digestAuditValue(input.reason.trim()),
    })
    return { ok: true, version: { ...target, status: 'active' } }
  }

  async startSupportSession(input: SupportSessionInput): Promise<SupportSessionResult> {
    if (!input.productId.trim() || !input.actorId.trim() || !input.tenantId.trim() || !input.reason.trim())
      return this.failure('INVALID', 'invalid_support_session')
    const identity = await this.requireIdentity(input.productId, input.actorId, 'support:access')
    if (!identity.ok) return identity
    const policyDecision = await this.authorize({
      productId: input.productId,
      actorId: input.actorId,
      action: 'support:access',
      tenantId: input.tenantId,
      correlationId: input.correlationId,
    })
    if (!policyDecision.ok) return policyDecision
    if (input.targetActorId && !identity.identity.permissions.includes('support:impersonate'))
      return this.failure('FORBIDDEN', 'impersonation_permission_denied')
    const ttlMs = input.ttlMs ?? 15 * 60 * 1000
    if (ttlMs < 1 || ttlMs > MAX_SUPPORT_SESSION_TTL_MS)
      return this.failure('INVALID', 'invalid_support_session_ttl')
    const issuedAt = this.dependencies.clock.now()
    const session: SupportSession = {
      id: this.dependencies.ids.next('support-session'),
      productId: input.productId,
      actorId: input.actorId,
      tenantId: input.tenantId,
      targetActorId: input.targetActorId ?? null,
      permissions: identity.identity.permissions.filter((permission) => permission.startsWith('support:')),
      status: SUPPORT_SESSION_STATUS.ACTIVE,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      revokedAt: null,
    }
    await this.dependencies.store.saveSupportSession(session)
    await this.record(input, 'support:session:start', 'success', 'support_session_started', {
      sessionId: session.id,
      targetActorId: session.targetActorId ?? 'none',
      tenantId: session.tenantId,
      reasonHash: digestAuditValue(input.reason.trim()),
    })
    return {
      ok: true,
      sessionId: session.id,
      expiresAt: session.expiresAt,
      targetActorId: session.targetActorId,
    }
  }

  async authorizeSupportSession(input: SupportSessionDecisionInput): Promise<ProductAdminDecision> {
    const session = await this.dependencies.store.findSupportSession(input.sessionId)
    if (!session) return this.failure('NOT_FOUND', 'support_session_not_found')
    if (session.status === SUPPORT_SESSION_STATUS.REVOKED) {
      await this.record(
        { productId: session.productId, actorId: session.actorId, tenantId: input.tenantId, correlationId: input.correlationId },
        'support:session:authorize',
        'denied',
        'support_session_revoked',
        { sessionId: session.id }
      )
      return this.failure('REVOKED', 'support_session_revoked')
    }
    if (session.expiresAt <= this.dependencies.clock.now()) {
      session.status = SUPPORT_SESSION_STATUS.EXPIRED
      await this.dependencies.store.saveSupportSession(session)
      await this.record(
        { productId: session.productId, actorId: session.actorId, tenantId: input.tenantId, correlationId: input.correlationId },
        'support:session:authorize',
        'denied',
        'support_session_expired',
        { sessionId: session.id }
      )
      return this.failure('EXPIRED', 'support_session_expired')
    }
    if (session.tenantId !== input.tenantId) {
      await this.record(
        { productId: session.productId, actorId: session.actorId, tenantId: input.tenantId, correlationId: input.correlationId },
        'support:session:authorize',
        'denied',
        'support_tenant_boundary',
        { sessionId: session.id }
      )
      return this.failure('FORBIDDEN', 'support_tenant_boundary')
    }
    if (!session.permissions.includes(input.action)) return this.failure('FORBIDDEN', 'support_permission_denied')
    const decision = await this.authorize({
      productId: session.productId,
      actorId: session.actorId,
      action: input.action,
      tenantId: session.tenantId,
      correlationId: input.correlationId,
    })
    if (!decision.ok) return decision
    await this.record(
      { productId: session.productId, actorId: session.actorId, tenantId: input.tenantId, correlationId: input.correlationId },
      'support:session:authorize',
      'success',
      'support_session_authorized',
      { sessionId: session.id }
    )
    return decision
  }

  async emergencyRevoke(input: EmergencyRevokeInput): Promise<OperationResult> {
    const identity = await this.requireIdentity(input.productId, input.actorId, 'emergency:revoke')
    if (!identity.ok) return identity
    if (!input.reason.trim()) return this.failure('INVALID', 'invalid_emergency_revoke')
    if (input.sessionId) {
      const session = await this.dependencies.store.findSupportSession(input.sessionId)
      if (!session || session.productId !== input.productId) return this.failure('NOT_FOUND', 'support_session_not_found')
      session.status = SUPPORT_SESSION_STATUS.REVOKED
      session.revokedAt = this.dependencies.clock.now()
      await this.dependencies.store.saveSupportSession(session)
    } else if (input.targetActorId) {
      for (const session of this.dependencies.store.supportSessions.values()) {
        if (session.productId === input.productId && session.actorId === input.targetActorId) {
          session.status = SUPPORT_SESSION_STATUS.REVOKED
          session.revokedAt = this.dependencies.clock.now()
          await this.dependencies.store.saveSupportSession(session)
        }
      }
    } else {
      return this.failure('INVALID', 'revoke_target_required')
    }
    await this.record(input, 'emergency:revoke', 'success', 'support_access_revoked', {
      sessionId: input.sessionId ?? 'actor-sessions',
      targetActorId: input.targetActorId ?? 'session-target',
      reasonHash: digestAuditValue(input.reason.trim()),
    })
    return { ok: true }
  }

  async disableProduct(input: DisableProductInput): Promise<OperationResult> {
    const identity = await this.requireIdentity(input.productId, input.actorId, 'emergency:revoke')
    if (!identity.ok) return identity
    if (!input.reason.trim()) return this.failure('INVALID', 'invalid_product_disable')
    const existing = await this.dependencies.store.findPolicy(input.productId)
    const policy: ProductPolicy = existing ?? {
      productId: input.productId,
      activeVersion: 0,
      versions: [],
      disabledAt: null,
      disabledReason: null,
    }
    policy.disabledAt = this.dependencies.clock.now()
    policy.disabledReason = input.reason.trim()
    await this.dependencies.store.savePolicy(policy)
    await this.record(input, 'emergency:disable-product', 'success', 'product_disabled', {
      reasonHash: digestAuditValue(input.reason.trim()),
    })
    return { ok: true }
  }

  async revokeSuperadmin(input: EmergencyRevokeInput): Promise<OperationResult> {
    if (!input.targetActorId || input.targetActorId === input.actorId)
      return this.failure('FORBIDDEN', 'self_revoke_not_allowed')
    const identity = await this.requireIdentity(input.productId, input.actorId, 'emergency:revoke')
    if (!identity.ok) return identity
    const target = await this.dependencies.store.findIdentity(input.productId, input.targetActorId)
    if (!target) return this.failure('NOT_FOUND', 'superadmin_identity_not_found')
    target.status = SUPERADMIN_STATUS.REVOKED
    target.revokedAt = this.dependencies.clock.now()
    await this.dependencies.store.saveIdentity(target)
    await this.record(input, 'emergency:revoke-superadmin', 'success', 'superadmin_revoked', {
      targetActorId: target.actorId,
      reasonHash: digestAuditValue(input.reason.trim()),
    })
    return { ok: true }
  }

  private async requireIdentity(
    productId: string,
    actorId: string,
    permission: string
  ): Promise<{ ok: true; identity: ProductAdminIdentity } | ProductAdminFailure> {
    const identity = await this.dependencies.store.findIdentity(productId, actorId)
    if (!identity || identity.status !== SUPERADMIN_STATUS.ACTIVE)
      return this.failure('FORBIDDEN', 'superadmin_identity_missing')
    if (!identity.permissions.includes(permission)) return this.failure('FORBIDDEN', 'permission_denied')
    return { ok: true, identity }
  }

  private async requireApproval(
    productId: string,
    actorId: string,
    approvedBy: string,
    permission: string,
    approverPermission: string
  ): Promise<{ ok: true } | ProductAdminFailure> {
    if (!approvedBy.trim() || approvedBy === actorId)
      return this.failure('FORBIDDEN', 'dual_control_required')
    const requester = await this.requireIdentity(productId, actorId, permission)
    if (!requester.ok) return requester
    const approver = await this.dependencies.store.findIdentity(productId, approvedBy)
    if (!approver || approver.status !== SUPERADMIN_STATUS.ACTIVE)
      return this.failure('FORBIDDEN', 'approval_permission_denied')
    if (!approver.permissions.includes(approverPermission) && !approver.permissions.includes(permission))
      return this.failure('FORBIDDEN', 'approval_permission_denied')
    return { ok: true }
  }

  private async deny(input: ProductAdminContext, reason: string): Promise<ProductAdminFailure> {
    await this.record(input, 'superadmin:authorize', 'denied', reason, {
      action: input.action,
    })
    return this.failure('FORBIDDEN', reason)
  }

  private failure(code: SuperadminResultCode, message: string): ProductAdminFailure {
    return { ok: false, code, message }
  }

  private async record(
    context: { productId: string; actorId: string; tenantId?: string; correlationId: string },
    action: string,
    outcome: 'success' | 'denied',
    reason: string,
    metadata: Record<string, string | number | boolean | null>
  ): Promise<void> {
    await this.dependencies.audit.record(
      {
        action,
        actorId: context.actorId,
        productId: context.productId,
        tenantId: context.tenantId ?? null,
        correlationId: context.correlationId?.trim() || 'missing-correlation',
        outcome,
        reason,
        metadata,
      },
      this.dependencies.clock.now()
    )
  }
}
