import { createHash } from 'node:crypto'
import type {
  Invitation,
  Membership,
  Organization,
  Role,
  TenantResource,
  TenancyAuditEvent,
  Workspace,
} from '../domain.js'
import type {
  TenancyAuditSink,
  TenancyIdGenerator,
  TenancyStore,
  TenancyTokenIssuer,
} from '../ports.js'

export class InMemoryTenancyStore implements TenancyStore {
  readonly organizations = new Map<string, Organization>()
  readonly workspaces = new Map<string, Workspace>()
  readonly roles = new Map<string, Role>()
  readonly memberships = new Map<string, Membership>()
  readonly invitations = new Map<string, Invitation>()
  readonly resources = new Map<string, TenantResource>()

  async saveOrganization(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, { ...organization })
  }

  async findOrganization(organizationId: string): Promise<Organization | undefined> {
    const organization = this.organizations.get(organizationId)
    return organization ? { ...organization } : undefined
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, { ...workspace })
  }

  async findWorkspace(workspaceId: string): Promise<Workspace | undefined> {
    const workspace = this.workspaces.get(workspaceId)
    return workspace ? { ...workspace } : undefined
  }

  async saveRole(role: Role): Promise<void> {
    this.roles.set(role.id, {
      ...role,
      permissions: [...role.permissions],
      resourceScopes: [...role.resourceScopes],
    })
  }

  async findRole(roleId: string): Promise<Role | undefined> {
    const role = this.roles.get(roleId)
    return role
      ? { ...role, permissions: [...role.permissions], resourceScopes: [...role.resourceScopes] }
      : undefined
  }

  async saveMembership(membership: Membership): Promise<void> {
    this.memberships.set(membership.id, { ...membership, roleIds: [...membership.roleIds] })
  }

  async findMembership(membershipId: string): Promise<Membership | undefined> {
    const membership = this.memberships.get(membershipId)
    return membership ? { ...membership, roleIds: [...membership.roleIds] } : undefined
  }

  async findMembershipByActor(tenantId: string, actorId: string): Promise<Membership | undefined> {
    const membership = [...this.memberships.values()].find(
      (candidate) => candidate.tenantId === tenantId && candidate.userId === actorId
    )
    return membership ? { ...membership, roleIds: [...membership.roleIds] } : undefined
  }

  async listMemberships(tenantId: string): Promise<Membership[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.tenantId === tenantId)
      .map((membership) => ({ ...membership, roleIds: [...membership.roleIds] }))
  }

  async saveInvitation(invitation: Invitation): Promise<void> {
    this.invitations.set(invitation.tokenDigest, {
      ...invitation,
      roleIds: [...invitation.roleIds],
    })
  }

  async findInvitationByDigest(tokenDigest: string): Promise<Invitation | undefined> {
    const invitation = this.invitations.get(tokenDigest)
    return invitation ? { ...invitation, roleIds: [...invitation.roleIds] } : undefined
  }

  async saveResource(resource: TenantResource): Promise<void> {
    this.resources.set(resource.id, { ...resource })
  }

  async findResource(resourceId: string): Promise<TenantResource | undefined> {
    const resource = this.resources.get(resourceId)
    return resource ? { ...resource } : undefined
  }

  async listResources(tenantId: string, resourceType: string): Promise<TenantResource[]> {
    return [...this.resources.values()]
      .filter((resource) => resource.tenantId === tenantId && resource.type === resourceType)
      .map((resource) => ({ ...resource }))
  }
}

export class InMemoryTenancyAuditSink implements TenancyAuditSink {
  readonly events: TenancyAuditEvent[] = []

  async record(event: TenancyAuditEvent): Promise<void> {
    this.events.push({ ...event, metadata: { ...event.metadata } })
  }
}

export class DeterministicTenancyIdGenerator implements TenancyIdGenerator {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `tenancy-${this.sequence}`
  }
}

export class DeterministicTenancyTokenIssuer implements TenancyTokenIssuer {
  private sequence = 0

  issue(): string {
    this.sequence += 1
    return `invitation-token-${this.sequence}`
  }

  digest(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}
