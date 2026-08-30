/**
 * Identity seed contract.
 *
 * The factory does not create a privileged or password-bearing account in a
 * shared database. Operators can pass approved, already-hashed fixtures to
 * seedIdentity when a local database is explicitly available.
 */

export interface IdentitySeedRecord {
  id: string
  email: string
  normalizedEmail: string
  displayName: string
}

export interface IdentitySeedClient {
  user: {
    upsert(args: {
      where: { normalizedEmail: string }
      create: IdentitySeedRecord
      update: { displayName: string }
    }): Promise<unknown>
  }
}

export function buildIdentitySeed(): IdentitySeedRecord[] {
  return []
}

export async function seedIdentity(
  client: IdentitySeedClient,
  records: IdentitySeedRecord[] = buildIdentitySeed()
): Promise<void> {
  for (const record of records) {
    await client.user.upsert({
      where: { normalizedEmail: record.normalizedEmail },
      create: record,
      update: { displayName: record.displayName },
    })
  }
}

export interface TenantSeedRecord {
  tenantId: string
  organizationName: string
  slug: string
  workspaceId: string
  roleId: string
  permissions: string[]
  actorId: string
}

export interface TenantSeedClient {
  organization: {
    upsert(args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>
  }
  workspace: {
    upsert(args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>
  }
  tenantRole: {
    upsert(args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>
  }
  membership: {
    upsert(args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>
  }
}

/** Explicit fixtures only. Production and shared databases receive no default tenant. */
export function buildTenantSeed(): TenantSeedRecord[] {
  return []
}

export async function seedTenant(
  client: TenantSeedClient,
  records: TenantSeedRecord[] = buildTenantSeed()
): Promise<void> {
  for (const record of records) {
    const now = new Date()
    await client.organization.upsert({
      where: { id: record.tenantId },
      create: { id: record.tenantId, name: record.organizationName, slug: record.slug, defaultWorkspaceId: record.workspaceId, createdAt: now, updatedAt: now },
      update: { name: record.organizationName, slug: record.slug, defaultWorkspaceId: record.workspaceId },
    })
    await client.workspace.upsert({
      where: { id: record.workspaceId },
      create: { id: record.workspaceId, organizationId: record.tenantId, name: 'Default', slug: 'default', createdAt: now, updatedAt: now },
      update: { name: 'Default', slug: 'default' },
    })
    await client.tenantRole.upsert({
      where: { id: record.roleId },
      create: { id: record.roleId, tenantId: record.tenantId, name: 'Owner', permissions: record.permissions, resourceScopes: ['*'], createdAt: now },
      update: { permissions: record.permissions, resourceScopes: ['*'] },
    })
    await client.membership.upsert({
      where: { id: `${record.tenantId}:${record.actorId}` },
      create: { id: `${record.tenantId}:${record.actorId}`, organizationId: record.tenantId, workspaceId: record.workspaceId, userId: record.actorId, role: record.roleId, roleIds: [record.roleId], status: 'active', createdAt: now, updatedAt: now },
      update: { role: record.roleId, roleIds: [record.roleId], status: 'active' },
    })
  }
}

export interface OwnershipSeedRecord {
  dataClass: string
  owner: 'postgresql' | 'b2-lineage'
  rebuildStrategy: 'restore-backup' | 'rebuild-from-postgres-outbox' | 'rebuild-from-lineage'
}

export interface DatabaseOwnershipSeedClient {
  ownershipRecord: {
    upsert(args: {
      where: { dataClass: string }
      create: OwnershipSeedRecord
      update: { owner: string; rebuildStrategy: string }
    }): Promise<unknown>
  }
}

/** No privileged identities or ownership rows are created implicitly. */
export function buildDatabaseSeed(): OwnershipSeedRecord[] {
  return []
}

export async function seedDatabaseOwnership(
  client: DatabaseOwnershipSeedClient,
  records: OwnershipSeedRecord[] = buildDatabaseSeed()
): Promise<void> {
  for (const record of records) {
    await client.ownershipRecord.upsert({
      where: { dataClass: record.dataClass },
      create: record,
      update: {
        owner: record.owner,
        rebuildStrategy: record.rebuildStrategy,
      },
    })
  }
}
