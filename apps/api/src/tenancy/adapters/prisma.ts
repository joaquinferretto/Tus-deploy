import type {
  Invitation,
  Membership,
  Organization,
  Role,
  TenantResource,
  Workspace,
} from '../domain.js'
import type { TenancyStore } from '../ports.js'

interface OrganizationRow { id: string; name: string; slug: string; defaultWorkspaceId: string; createdAt: Date }
interface WorkspaceRow { id: string; organizationId: string; name: string; slug: string; createdAt: Date }
interface RoleRow { id: string; tenantId: string; name: string; permissions: string[]; resourceScopes: string[]; createdAt: Date }
interface MembershipRow { id: string; organizationId: string; userId: string; roleIds: string[]; status: string; createdAt: Date }
interface InvitationRow { id: string; tenantId: string; email: string; roleIds: string[]; tokenDigest: string; status: string; expiresAt: Date; createdAt: Date; acceptedAt: Date | null }
interface ResourceRow { id: string; tenantId: string; type: string; value: string }

export interface TenantPrismaClient {
  organization: {
    findUnique(args: { where: { id: string } }): Promise<OrganizationRow | null>
    create(args: { data: Record<string, unknown> }): Promise<OrganizationRow>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<OrganizationRow>
  }
  workspace: {
    findUnique(args: { where: { id: string } }): Promise<WorkspaceRow | null>
    findFirst(args: { where: { organizationId: string } }): Promise<WorkspaceRow | null>
    create(args: { data: Record<string, unknown> }): Promise<WorkspaceRow>
  }
  tenantRole: {
    findUnique(args: { where: { id: string } }): Promise<RoleRow | null>
    create(args: { data: Record<string, unknown> }): Promise<RoleRow>
  }
  membership: {
    findUnique(args: { where: { id: string } }): Promise<MembershipRow | null>
    findFirst(args: { where: { organizationId: string; userId: string } }): Promise<MembershipRow | null>
    findMany(args: { where: { organizationId: string } }): Promise<MembershipRow[]>
    create(args: { data: Record<string, unknown> }): Promise<MembershipRow>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MembershipRow>
  }
  invitation: {
    findUnique(args: { where: { tokenDigest: string } }): Promise<InvitationRow | null>
    create(args: { data: Record<string, unknown> }): Promise<InvitationRow>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<InvitationRow>
  }
  tenantResource: {
    findUnique(args: { where: { id: string } }): Promise<ResourceRow | null>
    findMany(args: { where: { tenantId: string; type: string } }): Promise<ResourceRow[]>
    upsert(args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<ResourceRow>
  }
}

export class PrismaTenancyStore implements TenancyStore {
  private readonly client: TenantPrismaClient

  constructor(client: TenantPrismaClient) {
    this.client = client
  }

  async saveOrganization(value: Organization): Promise<void> {
    const existing = await this.client.organization.findUnique({ where: { id: value.id } })
    if (!existing) await this.client.organization.create({ data: { id: value.id, name: value.name, slug: value.slug, defaultWorkspaceId: value.defaultWorkspaceId, createdAt: new Date(value.createdAt), updatedAt: new Date(value.createdAt) } })
    else await this.client.organization.update({ where: { id: value.id }, data: { name: value.name, slug: value.slug, defaultWorkspaceId: value.defaultWorkspaceId } })
  }

  async findOrganization(id: string): Promise<Organization | undefined> {
    const row = await this.client.organization.findUnique({ where: { id } })
    return row ? { id: row.id, name: row.name, slug: row.slug, defaultWorkspaceId: row.defaultWorkspaceId, createdAt: row.createdAt.getTime() } : undefined
  }

  async saveWorkspace(value: Workspace): Promise<void> {
    const existing = await this.client.workspace.findUnique({ where: { id: value.id } })
    if (!existing) await this.client.workspace.create({ data: { id: value.id, organizationId: value.organizationId, name: value.name, slug: value.slug, createdAt: new Date(value.createdAt), updatedAt: new Date(value.createdAt) } })
  }

  async findWorkspace(id: string): Promise<Workspace | undefined> {
    const row = await this.client.workspace.findUnique({ where: { id } })
    return row ? { id: row.id, organizationId: row.organizationId, name: row.name, slug: row.slug, createdAt: row.createdAt.getTime() } : undefined
  }

  async saveRole(value: Role): Promise<void> {
    const existing = await this.client.tenantRole.findUnique({ where: { id: value.id } })
    if (!existing) await this.client.tenantRole.create({ data: { id: value.id, tenantId: value.tenantId, name: value.name, permissions: value.permissions, resourceScopes: value.resourceScopes, createdAt: new Date(value.createdAt) } })
  }

  async findRole(id: string): Promise<Role | undefined> {
    const row = await this.client.tenantRole.findUnique({ where: { id } })
    return row ? { id: row.id, tenantId: row.tenantId, name: row.name, permissions: [...row.permissions], resourceScopes: [...row.resourceScopes], createdAt: row.createdAt.getTime() } : undefined
  }

  async saveMembership(value: Membership): Promise<void> {
    const existing = await this.client.membership.findUnique({ where: { id: value.id } })
    if (!existing) {
      const workspace = await this.client.workspace.findFirst({ where: { organizationId: value.tenantId } })
      if (!workspace) throw new Error('Tenant workspace is required before membership')
      await this.client.membership.create({ data: { id: value.id, organizationId: value.tenantId, workspaceId: workspace.id, userId: value.userId, role: value.roleIds[0] ?? '', roleIds: value.roleIds, status: value.status, createdAt: new Date(value.createdAt), updatedAt: new Date(value.createdAt) } })
    } else await this.client.membership.update({ where: { id: value.id }, data: { role: value.roleIds[0] ?? '', roleIds: value.roleIds, status: value.status, updatedAt: new Date() } })
  }

  async findMembership(id: string): Promise<Membership | undefined> {
    const row = await this.client.membership.findUnique({ where: { id } })
    return row ? this.mapMembership(row) : undefined
  }

  async findMembershipByActor(tenantId: string, actorId: string): Promise<Membership | undefined> {
    const row = await this.client.membership.findFirst({ where: { organizationId: tenantId, userId: actorId } })
    return row ? this.mapMembership(row) : undefined
  }

  async listMemberships(tenantId: string): Promise<Membership[]> {
    return (await this.client.membership.findMany({ where: { organizationId: tenantId } })).map((row) => this.mapMembership(row))
  }

  async saveInvitation(value: Invitation): Promise<void> {
    const existing = await this.client.invitation.findUnique({ where: { tokenDigest: value.tokenDigest } })
    if (existing) await this.client.invitation.update({ where: { id: existing.id }, data: { status: value.status, acceptedAt: value.acceptedAt === null ? null : new Date(value.acceptedAt) } })
    else await this.client.invitation.create({ data: { id: value.id, tenantId: value.tenantId, email: value.email, roleIds: value.roleIds, tokenDigest: value.tokenDigest, status: value.status, expiresAt: new Date(value.expiresAt), createdAt: new Date(value.createdAt), acceptedAt: null } })
  }

  async findInvitationByDigest(digest: string): Promise<Invitation | undefined> {
    const row = await this.client.invitation.findUnique({ where: { tokenDigest: digest } })
    return row ? { ...row, expiresAt: row.expiresAt.getTime(), createdAt: row.createdAt.getTime(), acceptedAt: row.acceptedAt?.getTime() ?? null, status: row.status as Invitation['status'], roleIds: [...row.roleIds] } : undefined
  }

  async saveResource(value: TenantResource): Promise<void> {
    await this.client.tenantResource.upsert({ where: { id: value.id }, create: { id: value.id, tenantId: value.tenantId, type: value.type, value: value.value }, update: { tenantId: value.tenantId, type: value.type, value: value.value } })
  }

  async findResource(id: string): Promise<TenantResource | undefined> {
    const row = await this.client.tenantResource.findUnique({ where: { id } })
    return row ? { ...row } : undefined
  }

  async listResources(tenantId: string, type: string): Promise<TenantResource[]> {
    return (await this.client.tenantResource.findMany({ where: { tenantId, type } })).map((row) => ({ ...row }))
  }

  private mapMembership(row: MembershipRow): Membership {
    return { id: row.id, tenantId: row.organizationId, userId: row.userId, roleIds: [...row.roleIds], status: row.status as Membership['status'], createdAt: row.createdAt.getTime(), revokedAt: row.status === 'revoked' ? row.createdAt.getTime() : null }
  }
}

export default { PrismaTenancyStore }
