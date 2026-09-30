import type { IdentityStore } from '../ports/identity-store.js'
import type {
  Account,
  Device,
  PasswordCredential,
  RecoveryToken,
  Session,
  VerificationToken,
} from '../domain/models.js'

interface InMemoryUser {
  id: string
  email: string
  normalizedEmail: string
  displayName: string
}

interface InMemoryTenant {
  id: string
  slug: string
  name: string
  status: string
  createdAt: number
  updatedAt: number
}

interface InMemoryOrganization {
  id: string
  name: string
  slug: string
  defaultWorkspaceId: string
  createdAt: number
  updatedAt: number
}

interface InMemoryWorkspace {
  id: string
  organizationId: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
}

interface InMemoryRole {
  id: string
  tenantId: string
  name: string
  permissions: string[]
  resourceScopes: string[]
  createdAt: number
}

interface InMemoryMembership {
  id: string
  organizationId: string
  workspaceId: string
  userId: string
  role: string
  roleIds: string[]
  status: string
  createdAt: number
  updatedAt: number
}

const BOOTSTRAP_PERMISSIONS = [
  'membership:invite',
  'membership:revoke',
  'resource:read',
  'resource:write',
  'role:manage',
  'tus:marketplace:write',
  'workspace:write',
]

export class InMemoryIdentityStore implements IdentityStore {
  readonly users = new Map<string, InMemoryUser>()
  readonly accounts = new Map<string, Account>()
  readonly tenants = new Map<string, InMemoryTenant>()
  readonly organizations = new Map<string, InMemoryOrganization>()
  readonly workspaces = new Map<string, InMemoryWorkspace>()
  readonly roles = new Map<string, InMemoryRole>()
  readonly memberships = new Map<string, InMemoryMembership>()
  readonly credentials = new Map<string, PasswordCredential>()
  readonly verificationTokens = new Map<string, VerificationToken>()
  readonly recoveryTokens = new Map<string, RecoveryToken>()
  readonly sessions = new Map<string, Session>()
  readonly devices = new Map<string, Device>()
  private transactionTail: Promise<void> = Promise.resolve()

  async findAccountByEmail(normalizedEmail: string): Promise<Account | undefined> {
    return [...this.accounts.values()].find(
      (account) => account.normalizedEmail === normalizedEmail
    )
  }

  async findAccountIdByPhone(phone: string): Promise<string | null> {
    return [...this.accounts.values()].find((account) => account.phoneNumber === phone)?.id ?? null
  }

  async getAccount(accountId: string): Promise<Account | undefined> {
    return this.accounts.get(accountId)
  }

  async hasActiveMembership(accountId: string, tenantId: string): Promise<boolean> {
    const account = this.accounts.get(accountId)
    const membership = account ? this.memberships.get(`${tenantId}:${account.id}`) : undefined
    return account?.status === 'active' && account.tenantId === tenantId && membership?.status === 'active'
  }

  async saveAccount(account: Account, options: { bootstrapTenant?: boolean } = {}): Promise<void> {
    const existing = this.accounts.get(account.id)
    if (!existing && options.bootstrapTenant) this.bootstrapTenant(account)
    this.users.set(account.id, {
      id: account.id,
      email: account.email,
      normalizedEmail: account.normalizedEmail,
      displayName: account.displayName,
    })
    this.accounts.set(account.id, account)
  }

  async saveCredential(credential: PasswordCredential): Promise<void> {
    this.credentials.set(credential.id, credential)
  }

  async findPasswordCredential(accountId: string): Promise<PasswordCredential | undefined> {
    return [...this.credentials.values()].find((credential) => credential.accountId === accountId)
  }

  async saveVerificationToken(token: VerificationToken): Promise<void> {
    this.verificationTokens.set(token.tokenDigest, token)
  }

  async findVerificationToken(tokenDigest: string): Promise<VerificationToken | undefined> {
    return this.verificationTokens.get(tokenDigest)
  }

  async saveRecoveryToken(token: RecoveryToken): Promise<void> {
    this.recoveryTokens.set(token.tokenDigest, token)
  }

  async findRecoveryToken(tokenDigest: string): Promise<RecoveryToken | undefined> {
    return this.recoveryTokens.get(tokenDigest)
  }

  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session)
  }

  async findSessionByAccessTokenDigest(accessTokenDigest: string): Promise<Session | undefined> {
    return [...this.sessions.values()].find(
      (session) => session.accessTokenDigest === accessTokenDigest
    )
  }

  async revokeSession(accessTokenDigest: string, revokedAt: number): Promise<Account | undefined> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.accessTokenDigest === accessTokenDigest
    )
    if (!session || session.revokedAt !== null) return undefined
    session.revokedAt = revokedAt
    return this.accounts.get(session.accountId)
  }

  async revokeSessions(accountId: string, revokedAt: number): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.accountId === accountId && session.revokedAt === null) {
        session.revokedAt = revokedAt
      }
    }
  }

  async saveDevice(accountId: string, device: Device): Promise<void> {
    this.devices.set(`${accountId}:${device.deviceId}`, device)
  }

  async transaction<TValue>(operation: (store: IdentityStore) => Promise<TValue>): Promise<TValue> {
    const previous = this.transactionTail
    let release!: () => void
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const snapshot = {
      users: cloneMap(this.users),
      accounts: cloneMap(this.accounts),
      tenants: cloneMap(this.tenants),
      organizations: cloneMap(this.organizations),
      workspaces: cloneMap(this.workspaces),
      roles: cloneMap(this.roles),
      memberships: cloneMap(this.memberships),
      credentials: cloneMap(this.credentials),
      verificationTokens: cloneMap(this.verificationTokens),
      recoveryTokens: cloneMap(this.recoveryTokens),
      sessions: cloneMap(this.sessions),
      devices: cloneMap(this.devices),
    }
    try {
      return await operation(this)
    } catch (error) {
      restoreMap(this.users, snapshot.users)
      restoreMap(this.accounts, snapshot.accounts)
      restoreMap(this.tenants, snapshot.tenants)
      restoreMap(this.organizations, snapshot.organizations)
      restoreMap(this.workspaces, snapshot.workspaces)
      restoreMap(this.roles, snapshot.roles)
      restoreMap(this.memberships, snapshot.memberships)
      restoreMap(this.credentials, snapshot.credentials)
      restoreMap(this.verificationTokens, snapshot.verificationTokens)
      restoreMap(this.recoveryTokens, snapshot.recoveryTokens)
      restoreMap(this.sessions, snapshot.sessions)
      restoreMap(this.devices, snapshot.devices)
      throw error
    } finally {
      release()
    }
  }

  private bootstrapTenant(account: Account): void {
    if (this.tenants.has(account.tenantId)) throw new Error('Tenant already exists')
    const createdAt = account.createdAt
    const workspaceId = `${account.tenantId}:default`
    const roleId = `${account.tenantId}:owner`
    const membershipId = `${account.tenantId}:${account.id}`

    this.tenants.set(account.tenantId, {
      id: account.tenantId,
      slug: account.tenantId,
      name: account.displayName,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    })
    this.organizations.set(account.tenantId, {
      id: account.tenantId,
      name: account.displayName,
      slug: account.tenantId,
      defaultWorkspaceId: workspaceId,
      createdAt,
      updatedAt: createdAt,
    })
    this.workspaces.set(workspaceId, {
      id: workspaceId,
      organizationId: account.tenantId,
      name: 'Default',
      slug: 'default',
      createdAt,
      updatedAt: createdAt,
    })
    this.roles.set(roleId, {
      id: roleId,
      tenantId: account.tenantId,
      name: 'Owner',
      permissions: [...BOOTSTRAP_PERMISSIONS],
      resourceScopes: ['*'],
      createdAt,
    })
    this.memberships.set(membershipId, {
      id: membershipId,
      organizationId: account.tenantId,
      workspaceId,
      userId: account.id,
      role: roleId,
      roleIds: [roleId],
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    })
  }
}

function cloneMap<TKey, TValue>(source: Map<TKey, TValue>): Map<TKey, TValue> {
  return new Map([...source].map(([key, value]) => [key, structuredClone(value)]))
}

function restoreMap<TKey, TValue>(target: Map<TKey, TValue>, source: Map<TKey, TValue>): void {
  target.clear()
  for (const [key, value] of source) target.set(key, structuredClone(value))
}
