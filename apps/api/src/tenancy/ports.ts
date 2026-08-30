import type {
  Invitation,
  Membership,
  Organization,
  Role,
  TenantResource,
  TenancyAuditEvent,
  Workspace,
} from './domain.js'

export interface TenancyStore {
  saveOrganization(organization: Organization): Promise<void>
  findOrganization(organizationId: string): Promise<Organization | undefined>
  saveWorkspace(workspace: Workspace): Promise<void>
  findWorkspace(workspaceId: string): Promise<Workspace | undefined>
  saveRole(role: Role): Promise<void>
  findRole(roleId: string): Promise<Role | undefined>
  saveMembership(membership: Membership): Promise<void>
  findMembership(membershipId: string): Promise<Membership | undefined>
  findMembershipByActor(tenantId: string, actorId: string): Promise<Membership | undefined>
  listMemberships(tenantId: string): Promise<Membership[]>
  saveInvitation(invitation: Invitation): Promise<void>
  findInvitationByDigest(tokenDigest: string): Promise<Invitation | undefined>
  saveResource(resource: TenantResource): Promise<void>
  findResource(resourceId: string): Promise<TenantResource | undefined>
  listResources(tenantId: string, resourceType: string): Promise<TenantResource[]>
}

export interface TenancyAuditSink {
  readonly events: TenancyAuditEvent[]
  record(event: TenancyAuditEvent): Promise<void>
}

export interface TenancyIdGenerator {
  next(): string
}

export interface TenancyTokenIssuer {
  issue(): string
  digest(value: string): string
}

export interface TenancyClock {
  now(): number
}
