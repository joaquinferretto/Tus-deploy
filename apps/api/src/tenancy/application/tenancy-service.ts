import {
  INVITATION_STATUS,
  MEMBERSHIP_STATUS,
  TENANCY_RESULT_CODE,
  scopeMatches,
  validTenantContext,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type Invitation,
  type Membership,
  type Organization,
  type Role,
  type TenantContext,
  type TenantResource,
  type TenancyAuditEvent,
  type TenancyFailure,
  type TenancyResultCode,
  type Workspace,
} from '../domain.js'
import type {
  TenancyAuditSink,
  TenancyClock,
  TenancyIdGenerator,
  TenancyStore,
  TenancyTokenIssuer,
} from '../ports.js'

const OWNER_PERMISSIONS = [
  'membership:invite',
  'membership:revoke',
  'resource:read',
  'resource:write',
  'role:manage',
  'workspace:write',
].sort()

export interface TenancyServiceDependencies {
  store: TenancyStore
  audit: TenancyAuditSink
  ids: TenancyIdGenerator
  tokens: TenancyTokenIssuer
  clock: TenancyClock
}

export interface CreateOrganizationInput {
  actorId: string
  name: string
  slug: string
  correlationId: string
  organizationId?: string
}

export interface CreateWorkspaceInput {
  context?: TenantContext
  name: string
  slug: string
}

export interface CreateRoleInput {
  context?: TenantContext
  name: string
  permissions: string[]
  resourceScopes: string[]
}

export interface AddMembershipInput {
  context?: TenantContext
  userId: string
  roleIds: string[]
}

export interface InviteMemberInput {
  context?: TenantContext
  email: string
  roleIds: string[]
  ttlMs?: number
}

export interface AcceptInvitationInput {
  token: string
  userId: string
  email: string
  correlationId: string
}

export interface RevokeMembershipInput {
  context?: TenantContext
  membershipId: string
}

export interface ResourceRequestContext {
  context?: TenantContext
  resourceType: string
  resourceId: string
}

export interface WriteResourceInput {
  context?: TenantContext
  resource: TenantResource
}

export type OrganizationResult =
  | {
      ok: true
      organization: Organization
      workspace: Workspace
      role: Role
      membership: Membership
    }
  | TenancyFailure

export type WorkspaceResult = { ok: true; workspace: Workspace } | TenancyFailure
export type RoleResult = { ok: true; role: Role } | TenancyFailure
export type MembershipResult = { ok: true; membership: Membership } | TenancyFailure
export type InvitationResult = { ok: true; invitation: Invitation; token: string } | TenancyFailure
export type ResourceResult = { ok: true; resource: TenantResource } | TenancyFailure
export type ResourceListResult = { ok: true; resources: TenantResource[] } | TenancyFailure

export class TenancyService {
  private readonly dependencies: TenancyServiceDependencies

  constructor(dependencies: TenancyServiceDependencies) {
    this.dependencies = dependencies
  }

  async createOrganization(input: CreateOrganizationInput): Promise<OrganizationResult> {
    if (!input.actorId.trim() || !input.name.trim() || !input.slug.trim())
      return this.failure(
        null,
        input.actorId || null,
        input.correlationId,
        'INVALID',
        'invalid_organization'
      )

    const organizationId = input.organizationId?.trim() || this.dependencies.ids.next()
    const workspace: Workspace = {
      id: this.dependencies.ids.next(),
      organizationId,
      name: 'Default',
      slug: 'default',
      createdAt: this.dependencies.clock.now(),
    }
    const organization: Organization = {
      id: organizationId,
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      defaultWorkspaceId: workspace.id,
      createdAt: this.dependencies.clock.now(),
    }
    const role: Role = {
      id: this.dependencies.ids.next(),
      tenantId: organization.id,
      name: 'Owner',
      permissions: [...OWNER_PERMISSIONS],
      resourceScopes: ['*'],
      createdAt: this.dependencies.clock.now(),
    }
    const membership: Membership = {
      id: this.dependencies.ids.next(),
      tenantId: organization.id,
      userId: input.actorId,
      roleIds: [role.id],
      status: MEMBERSHIP_STATUS.ACTIVE,
      createdAt: this.dependencies.clock.now(),
      revokedAt: null,
    }
    await this.dependencies.store.saveOrganization(organization)
    await this.dependencies.store.saveWorkspace(workspace)
    await this.dependencies.store.saveRole(role)
    await this.dependencies.store.saveMembership(membership)
    await this.record({
      action: 'organization:create',
      actorId: input.actorId,
      tenantId: organization.id,
      correlationId: input.correlationId,
      outcome: 'success',
      reason: 'organization_bootstrapped',
      metadata: {},
    })
    return { ok: true, organization, workspace, role, membership }
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceResult> {
    const decision = await this.authorize({
      context: input.context,
      action: 'workspace:write',
      resourceType: 'workspace',
    })
    if (!decision.allowed) return this.failureFromDecision(decision)
    const context = input.context
    if (!validTenantContext(context)) return this.failureFromDecision(decision)
    if (!input.name.trim() || !input.slug.trim())
      return this.failure(
        context.tenantId,
        context.actorId,
        context.correlationId,
        'INVALID',
        'invalid_workspace'
      )
    const workspace: Workspace = {
      id: this.dependencies.ids.next(),
      organizationId: context.tenantId,
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      createdAt: this.dependencies.clock.now(),
    }
    await this.dependencies.store.saveWorkspace(workspace)
    await this.recordSuccess(context, 'workspace:create', 'workspace_created', {})
    return { ok: true, workspace }
  }

  async createRole(input: CreateRoleInput): Promise<RoleResult> {
    const decision = await this.authorize({
      context: input.context,
      action: 'role:manage',
      resourceType: 'role',
    })
    if (!decision.allowed) return this.failureFromDecision(decision)
    const context = input.context
    if (!validTenantContext(context)) return this.failureFromDecision(decision)
    if (!input.name.trim() || input.permissions.length === 0)
      return this.failure(
        context.tenantId,
        context.actorId,
        context.correlationId,
        'INVALID',
        'invalid_role'
      )
    const role: Role = {
      id: this.dependencies.ids.next(),
      tenantId: context.tenantId,
      name: input.name.trim(),
      permissions: [...new Set(input.permissions)].sort(),
      resourceScopes: [...new Set(input.resourceScopes)],
      createdAt: this.dependencies.clock.now(),
    }
    await this.dependencies.store.saveRole(role)
    await this.recordSuccess(context, 'role:create', 'role_created', {
      roleCount: role.permissions.length,
    })
    return { ok: true, role }
  }

  async addMembership(input: AddMembershipInput): Promise<MembershipResult> {
    const decision = await this.authorize({
      context: input.context,
      action: 'membership:invite',
      resourceType: 'membership',
    })
    if (!decision.allowed) return this.failureFromDecision(decision)
    const context = input.context
    if (!validTenantContext(context)) return this.failureFromDecision(decision)
    const roles = await this.findTenantRoles(context.tenantId, input.roleIds)
    if (!input.userId.trim() || roles.length !== input.roleIds.length || input.roleIds.length === 0)
      return this.failure(
        context.tenantId,
        context.actorId,
        context.correlationId,
        'INVALID',
        'invalid_membership'
      )
    const existing = await this.dependencies.store.findMembershipByActor(
      context.tenantId,
      input.userId
    )
    if (existing?.status === MEMBERSHIP_STATUS.ACTIVE)
      return this.failure(
        context.tenantId,
        context.actorId,
        context.correlationId,
        'CONFLICT',
        'membership_exists'
      )
    const membership: Membership = {
      id: this.dependencies.ids.next(),
      tenantId: context.tenantId,
      userId: input.userId,
      roleIds: [...input.roleIds],
      status: MEMBERSHIP_STATUS.ACTIVE,
      createdAt: this.dependencies.clock.now(),
      revokedAt: null,
    }
    await this.dependencies.store.saveMembership(membership)
    await this.recordSuccess(context, 'membership:add', 'membership_created', {
      roleCount: roles.length,
    })
    return { ok: true, membership }
  }

  async revokeMembership(input: RevokeMembershipInput): Promise<MembershipResult> {
    const decision = await this.authorize({
      context: input.context,
      action: 'membership:revoke',
      resourceType: 'membership',
      resourceId: input.membershipId,
    })
    if (!decision.allowed) return this.failureFromDecision(decision)
    const context = input.context
    if (!validTenantContext(context)) return this.failureFromDecision(decision)
    const membership = await this.dependencies.store.findMembership(input.membershipId)
    if (!membership || membership.tenantId !== context.tenantId)
      return this.failure(
        context.tenantId,
        context.actorId,
        context.correlationId,
        'NOT_FOUND',
        'membership_not_found'
      )
    if (membership.status === MEMBERSHIP_STATUS.REVOKED)
      return this.failure(
        context.tenantId,
        context.actorId,
        context.correlationId,
        'REPLAYED',
        'membership_already_revoked'
      )
    membership.status = MEMBERSHIP_STATUS.REVOKED
    membership.revokedAt = this.dependencies.clock.now()
    await this.dependencies.store.saveMembership(membership)
    await this.recordSuccess(context, 'membership:revoke', 'membership_revoked', {
      membershipId: membership.id,
    })
    return { ok: true, membership }
  }

  async inviteMember(input: InviteMemberInput): Promise<InvitationResult> {
    const decision = await this.authorize({
      context: input.context,
      action: 'membership:invite',
      resourceType: 'invitation',
    })
    if (!decision.allowed) return this.failureFromDecision(decision)
    const context = input.context
    if (!validTenantContext(context)) return this.failureFromDecision(decision)
    const email = input.email.trim().toLowerCase()
    const roles = await this.findTenantRoles(context.tenantId, input.roleIds)
    if (!email.includes('@') || roles.length !== input.roleIds.length || input.roleIds.length === 0)
      return this.failure(
        context.tenantId,
        context.actorId,
        context.correlationId,
        'INVALID',
        'invalid_invitation'
      )
    const token = this.dependencies.tokens.issue()
    const invitation: Invitation = {
      id: this.dependencies.ids.next(),
      tenantId: context.tenantId,
      email,
      roleIds: [...input.roleIds],
      tokenDigest: this.dependencies.tokens.digest(token),
      status: INVITATION_STATUS.PENDING,
      expiresAt: this.dependencies.clock.now() + Math.max(1, input.ttlMs ?? 24 * 60 * 60 * 1000),
      createdAt: this.dependencies.clock.now(),
      acceptedAt: null,
    }
    await this.dependencies.store.saveInvitation(invitation)
    await this.recordSuccess(context, 'membership:invite', 'invitation_created', {
      emailHash: this.dependencies.tokens.digest(email).slice(0, 16),
      roleCount: roles.length,
    })
    return { ok: true, invitation, token }
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<MembershipResult> {
    const invitation = await this.dependencies.store.findInvitationByDigest(
      this.dependencies.tokens.digest(input.token)
    )
    if (!invitation)
      return this.failure(
        null,
        input.userId || null,
        input.correlationId,
        'NOT_FOUND',
        'invitation_not_found'
      )
    if (invitation.status !== INVITATION_STATUS.PENDING)
      return this.failure(
        invitation.tenantId,
        input.userId,
        input.correlationId,
        'REPLAYED',
        'invitation_unavailable'
      )
    if (invitation.expiresAt <= this.dependencies.clock.now()) {
      invitation.status = INVITATION_STATUS.EXPIRED
      await this.dependencies.store.saveInvitation(invitation)
      return this.failure(
        invitation.tenantId,
        input.userId,
        input.correlationId,
        'EXPIRED',
        'invitation_expired'
      )
    }
    if (invitation.email !== input.email.trim().toLowerCase())
      return this.failure(
        invitation.tenantId,
        input.userId,
        input.correlationId,
        'FORBIDDEN',
        'invitation_email_mismatch'
      )
    const existing = await this.dependencies.store.findMembershipByActor(
      invitation.tenantId,
      input.userId
    )
    if (existing?.status === MEMBERSHIP_STATUS.ACTIVE)
      return this.failure(
        invitation.tenantId,
        input.userId,
        input.correlationId,
        'CONFLICT',
        'membership_exists'
      )
    const membership: Membership = {
      id: this.dependencies.ids.next(),
      tenantId: invitation.tenantId,
      userId: input.userId,
      roleIds: [...invitation.roleIds],
      status: MEMBERSHIP_STATUS.ACTIVE,
      createdAt: this.dependencies.clock.now(),
      revokedAt: null,
    }
    invitation.status = INVITATION_STATUS.ACCEPTED
    invitation.acceptedAt = this.dependencies.clock.now()
    await this.dependencies.store.saveInvitation(invitation)
    await this.dependencies.store.saveMembership(membership)
    await this.record({
      action: 'membership:accept',
      actorId: input.userId,
      tenantId: invitation.tenantId,
      correlationId: input.correlationId,
      outcome: 'success',
      reason: 'invitation_accepted',
      metadata: { roleCount: membership.roleIds.length },
    })
    return { ok: true, membership }
  }

  async authorize(input: AuthorizationRequest): Promise<AuthorizationDecision> {
    const context = input.context
    if (!validTenantContext(context))
      return this.denyContext(context, input.action, input.resourceType)
    if (input.resourceTenantId && input.resourceTenantId !== context.tenantId)
      return this.deny(context, 'cross_tenant_resource', input.action, input.resourceType)
    const membership = await this.dependencies.store.findMembershipByActor(
      context.tenantId,
      context.actorId
    )
    if (!membership || membership.status !== MEMBERSHIP_STATUS.ACTIVE)
      return this.deny(context, 'membership_not_found', input.action, input.resourceType)
    const roles = await Promise.all(
      membership.roleIds.map((roleId) => this.dependencies.store.findRole(roleId))
    )
    const permitted = roles.some(
      (role) =>
        role?.tenantId === context.tenantId &&
        role.permissions.includes(input.action) &&
        role.resourceScopes.some((scope) =>
          scopeMatches(scope, { resourceType: input.resourceType, resourceId: input.resourceId })
        )
    )
    if (!permitted) return this.deny(context, 'permission_denied', input.action, input.resourceType)
    await this.recordSuccess(context, input.action, 'authorization_allowed', {
      resourceType: input.resourceType,
    })
    return { allowed: true, code: TENANCY_RESULT_CODE.ALLOWED, reason: 'permission_granted' }
  }

  async readResource(input: ResourceRequestContext): Promise<ResourceResult> {
    const resource = await this.dependencies.store.findResource(input.resourceId)
    if (!resource)
      return this.failure(
        input.context?.tenantId ?? null,
        input.context?.actorId ?? null,
        input.context?.correlationId,
        'NOT_FOUND',
        'resource_not_found'
      )
    if (resource.tenantId !== input.context?.tenantId) {
      if (validTenantContext(input.context))
        await this.deny(input.context, 'cross_tenant_resource', 'resource:read', input.resourceType)
      return this.failure(
        input.context?.tenantId ?? null,
        input.context?.actorId ?? null,
        input.context?.correlationId,
        'NOT_FOUND',
        'resource_not_found'
      )
    }
    const decision = await this.authorize({
      ...input,
      action: 'resource:read',
      resourceTenantId: resource.tenantId,
    })
    return decision.allowed ? { ok: true, resource } : this.failureFromDecision(decision)
  }

  async writeResource(input: WriteResourceInput): Promise<ResourceResult> {
    const existing = await this.dependencies.store.findResource(input.resource.id)
    if (existing && existing.tenantId !== input.resource.tenantId)
      return this.failure(
        input.context?.tenantId ?? null,
        input.context?.actorId ?? null,
        input.context?.correlationId,
        'FORBIDDEN',
        'cross_tenant_resource'
      )
    if (!validTenantContext(input.context) || input.resource.tenantId !== input.context.tenantId)
      return this.failure(
        input.context?.tenantId ?? null,
        input.context?.actorId ?? null,
        input.context?.correlationId,
        'FORBIDDEN',
        'cross_tenant_resource'
      )
    const decision = await this.authorize({
      context: input.context,
      action: 'resource:write',
      resourceType: input.resource.type,
      resourceId: input.resource.id,
      resourceTenantId: input.resource.tenantId,
    })
    if (!decision.allowed) return this.failureFromDecision(decision)
    await this.dependencies.store.saveResource(input.resource)
    return { ok: true, resource: { ...input.resource } }
  }

  async listResources(input: {
    context?: TenantContext
    resourceType: string
  }): Promise<ResourceListResult> {
    const decision = await this.authorize({
      context: input.context,
      action: 'resource:read',
      resourceType: input.resourceType,
    })
    if (!decision.allowed) return this.failureFromDecision(decision)
    const context = input.context
    if (!validTenantContext(context)) return this.failureFromDecision(decision)
    return {
      ok: true,
      resources: await this.dependencies.store.listResources(context.tenantId, input.resourceType),
    }
  }

  private async findTenantRoles(tenantId: string, roleIds: string[]): Promise<Role[]> {
    const roles = await Promise.all(
      roleIds.map((roleId) => this.dependencies.store.findRole(roleId))
    )
    return roles.filter((role): role is Role => Boolean(role && role.tenantId === tenantId))
  }

  private failureFromDecision(decision: AuthorizationDecision): TenancyFailure {
    return { ok: false, code: decision.code, message: decision.reason }
  }

  private denyContext(
    context: TenantContext | undefined,
    action: string,
    resourceType: string
  ): AuthorizationDecision {
    void this.record({
      action,
      actorId: context?.actorId ?? null,
      tenantId: null,
      correlationId: context?.correlationId?.trim() || 'missing-correlation',
      outcome: 'denied',
      reason: 'invalid_tenant_context',
      metadata: { action, resourceType },
    })
    return {
      allowed: false,
      code: TENANCY_RESULT_CODE.INVALID_TENANT_CONTEXT,
      reason: 'invalid_tenant_context',
    }
  }

  private async deny(
    context: TenantContext,
    reason: string,
    action: string,
    resourceType: string
  ): Promise<AuthorizationDecision> {
    await this.record({
      action,
      actorId: context.actorId,
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      outcome: 'denied',
      reason,
      metadata: { action, resourceType },
    })
    return { allowed: false, code: TENANCY_RESULT_CODE.FORBIDDEN, reason }
  }

  private async recordSuccess(
    context: TenantContext,
    action: string,
    reason: string,
    metadata: Record<string, string | number>
  ): Promise<void> {
    await this.record({
      action,
      actorId: context.actorId,
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      outcome: 'success',
      reason,
      metadata,
    })
  }

  private async failure(
    tenantId: string | null,
    actorId: string | null,
    correlationId: string | undefined,
    code: TenancyResultCode,
    reason: string
  ): Promise<TenancyFailure> {
    await this.record({
      action: 'tenancy:operation',
      actorId,
      tenantId,
      correlationId: correlationId?.trim() || 'missing-correlation',
      outcome: 'denied',
      reason,
      metadata: {},
    })
    return { ok: false, code, message: reason }
  }

  private async record(event: Omit<TenancyAuditEvent, 'occurredAt'>): Promise<void> {
    await this.dependencies.audit.record({
      ...event,
      occurredAt: new Date(this.dependencies.clock.now()).toISOString(),
    })
  }
}
