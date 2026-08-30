import type {
  BreakGlassGrant,
  ProductAdminIdentity,
  ProductPolicy,
  SupportSession,
} from '../domain.js'
import type {
  ProductAdminClock,
  ProductAdminIdGenerator,
  ProductSuperadminStore,
  ProductAdminTokenIssuer,
} from '../ports.js'

export class InMemoryProductSuperadminStore implements ProductSuperadminStore {
  readonly identities = new Map<string, ProductAdminIdentity>()
  readonly policies = new Map<string, ProductPolicy>()
  readonly breakGlassGrants = new Map<string, BreakGlassGrant>()
  readonly supportSessions = new Map<string, SupportSession>()

  async saveIdentity(identity: ProductAdminIdentity): Promise<void> {
    this.identities.set(this.identityKey(identity.productId, identity.actorId), {
      ...identity,
      permissions: [...identity.permissions],
    })
  }

  async findIdentity(productId: string, actorId: string): Promise<ProductAdminIdentity | undefined> {
    const identity = this.identities.get(this.identityKey(productId, actorId))
    return identity ? { ...identity, permissions: [...identity.permissions] } : undefined
  }

  async savePolicy(policy: ProductPolicy): Promise<void> {
    this.policies.set(policy.productId, {
      ...policy,
      versions: policy.versions.map((version) => ({
        ...version,
        permissions: [...version.permissions],
      })),
    })
  }

  async findPolicy(productId: string): Promise<ProductPolicy | undefined> {
    const policy = this.policies.get(productId)
    return policy
      ? {
          ...policy,
          versions: policy.versions.map((version) => ({
            ...version,
            permissions: [...version.permissions],
          })),
        }
      : undefined
  }

  async saveBreakGlass(grant: BreakGlassGrant): Promise<void> {
    this.breakGlassGrants.set(grant.id, { ...grant })
  }

  async findBreakGlass(id: string): Promise<BreakGlassGrant | undefined> {
    const grant = this.breakGlassGrants.get(id)
    return grant ? { ...grant } : undefined
  }

  async saveSupportSession(session: SupportSession): Promise<void> {
    this.supportSessions.set(session.id, { ...session, permissions: [...session.permissions] })
  }

  async findSupportSession(id: string): Promise<SupportSession | undefined> {
    const session = this.supportSessions.get(id)
    return session ? { ...session, permissions: [...session.permissions] } : undefined
  }

  private identityKey(productId: string, actorId: string): string {
    return `${productId}:${actorId}`
  }
}

export class DeterministicProductAdminIdGenerator implements ProductAdminIdGenerator {
  private sequence = 0

  next(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}

export class DeterministicProductAdminTokenIssuer implements ProductAdminTokenIssuer {
  private sequence = 0

  issue(): string {
    this.sequence += 1
    return `support-session-token-${this.sequence}`
  }
}

export class SystemProductAdminClock implements ProductAdminClock {
  now(): number {
    return Date.now()
  }
}
