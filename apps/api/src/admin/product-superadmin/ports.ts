import type {
  BreakGlassGrant,
  ProductAdminIdentity,
  ProductPolicy,
  SupportSession,
} from './domain.js'

export interface ProductSuperadminStore {
  readonly identities: Map<string, ProductAdminIdentity>
  readonly policies: Map<string, ProductPolicy>
  readonly breakGlassGrants: Map<string, BreakGlassGrant>
  readonly supportSessions: Map<string, SupportSession>
  saveIdentity(identity: ProductAdminIdentity): Promise<void>
  findIdentity(productId: string, actorId: string): Promise<ProductAdminIdentity | undefined>
  savePolicy(policy: ProductPolicy): Promise<void>
  findPolicy(productId: string): Promise<ProductPolicy | undefined>
  saveBreakGlass(grant: BreakGlassGrant): Promise<void>
  findBreakGlass(id: string): Promise<BreakGlassGrant | undefined>
  saveSupportSession(session: SupportSession): Promise<void>
  findSupportSession(id: string): Promise<SupportSession | undefined>
}

export interface ProductAdminIdGenerator {
  next(prefix: string): string
}

export interface ProductAdminClock {
  now(): number
}

export interface ProductAdminTokenIssuer {
  issue(): string
}
