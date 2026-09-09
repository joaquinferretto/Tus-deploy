import { randomUUID } from 'node:crypto'
import type { IdentityStore } from '../../ports/identity-store.js'
import type { AuditSink } from '../../ports/security.js'
import type {
  Account,
  Device,
  PasswordCredential,
  RecoveryToken,
  Session,
  VerificationToken,
} from '../../domain/models.js'
import {
  mapAccountRow,
  mapCredentialRow,
  mapSessionRow,
  mapTokenRow,
  toDate,
  toRequiredDate,
  type AccountRow,
  type CredentialRow,
  type SessionRow,
  type TokenRow,
} from './mappers.js'

interface UserRow {
  id: string
  email: string
  normalizedEmail: string
  displayName: string
}

interface AccountWithoutUser extends Omit<AccountRow, 'user'> {
  userId: string
}

interface UserWithAccounts extends UserRow {
  accounts: AccountWithoutUser[]
}

interface UserDelegate {
  findUnique(args: {
    where: { normalizedEmail: string }
    include: { accounts: { take: number } }
  }): Promise<UserWithAccounts | null>
  create(args: { data: UserCreateData }): Promise<UserRow>
  update(args: {
    where: { id: string }
    data: { email: string; normalizedEmail: string; displayName: string }
  }): Promise<UserRow>
}

interface AccountDelegate {
  findUnique(args: { where: { id: string }; include: { user: true } }): Promise<AccountRow | null>
  create(args: { data: AccountCreateData }): Promise<AccountRow>
  update(args: { where: { id: string }; data: AccountUpdateData }): Promise<AccountRow>
}

interface CredentialDelegate {
  findUnique(args: { where: { accountId: string } }): Promise<CredentialRow | null>
  create(args: { data: CredentialCreateData }): Promise<CredentialRow>
  update(args: { where: { id: string }; data: CredentialUpdateData }): Promise<CredentialRow>
}

interface TokenDelegate<T extends TokenRow> {
  findUnique(args: { where: { tokenDigest: string } }): Promise<T | null>
  create(args: { data: TokenCreateData }): Promise<T>
  update(args: { where: { id: string }; data: { consumedAt: Date | null } }): Promise<T>
}

interface SessionDelegate {
  findUnique(args: { where: { accessTokenDigest: string } }): Promise<SessionRow | null>
  create(args: { data: SessionCreateData }): Promise<SessionRow>
  update(args: { where: { id: string }; data: { revokedAt: Date } }): Promise<SessionRow>
  updateMany(args: {
    where: { accountId: string; revokedAt: null }
    data: { revokedAt: Date }
  }): Promise<{ count: number }>
}

interface DeviceDelegate {
  upsert(args: {
    where: { accountId_deviceId: { accountId: string; deviceId: string } }
    create: DeviceCreateData
    update: DeviceUpdateData
  }): Promise<unknown>
}

export interface PrismaIdentityClient {
  user: UserDelegate
  account: AccountDelegate
  passwordCredential: CredentialDelegate
  verificationToken: TokenDelegate<VerificationTokenRow>
  recoveryToken: TokenDelegate<RecoveryTokenRow>
  session: SessionDelegate
  device: DeviceDelegate
  auditEvent?: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
  }
  $transaction<T>(callback: (client: PrismaIdentityClient) => Promise<T>): Promise<T>
}

interface UserCreateData {
  id: string
  email: string
  normalizedEmail: string
  displayName: string
}

interface AccountCreateData {
  id: string
  userId: string
  tenantId: string
  roles: string[]
  status: string
  emailVerifiedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface AccountUpdateData {
  tenantId: string
  roles: string[]
  status: string
  emailVerifiedAt: Date | null
  updatedAt: Date
}

interface CredentialCreateData {
  id: string
  accountId: string
  passwordHash: string
  status: string
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
}

interface CredentialUpdateData extends Omit<
  CredentialCreateData,
  'id' | 'accountId' | 'createdAt'
> {}

interface TokenCreateData {
  id: string
  accountId: string
  tokenDigest: string
  expiresAt: Date
  consumedAt: Date | null
}

interface VerificationTokenRow extends TokenRow {}
interface RecoveryTokenRow extends TokenRow {}

interface SessionCreateData {
  id: string
  accountId: string
  tenantId: string
  deviceId: string
  accessTokenDigest: string
  roles: string[]
  permissions: string[]
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
}

interface DeviceCreateData {
  accountId: string
  deviceId: string
  label: string
  firstSeenAt: Date
  lastSeenAt: Date
}

interface DeviceUpdateData {
  label: string
  lastSeenAt: Date
}

export class IdentityPersistenceConflictError extends Error {
  readonly code = 'IDENTITY_PERSISTENCE_CONFLICT'

  constructor() {
    super('Identity record already exists')
    this.name = 'IdentityPersistenceConflictError'
  }
}

export class PrismaIdentityStore implements IdentityStore {
  private readonly client: PrismaIdentityClient

  constructor(client: PrismaIdentityClient) {
    this.client = client
  }

  transaction<TValue>(operation: (store: IdentityStore) => Promise<TValue>): Promise<TValue> {
    return this.client.$transaction((client) => operation(new PrismaIdentityStore(client)))
  }

  async findAccountByEmail(normalizedEmail: string): Promise<Account | undefined> {
    const user = await this.client.user.findUnique({
      where: { normalizedEmail },
      include: { accounts: { take: 1 } },
    })
    const account = user?.accounts[0]
    return account ? mapAccountRow({ ...account, user }) : undefined
  }

  async getAccount(accountId: string): Promise<Account | undefined> {
    const row = await this.client.account.findUnique({
      where: { id: accountId },
      include: { user: true },
    })
    return row ? mapAccountRow(row) : undefined
  }

  async saveAccount(account: Account): Promise<void> {
    const client = this.client
    const existing = await client.account.findUnique({
      where: { id: account.id },
      include: { user: true },
    })
    if (existing) {
      await client.user.update({
        where: { id: existing.user.id },
        data: {
          email: account.email,
          normalizedEmail: account.normalizedEmail,
          displayName: account.displayName,
        },
      })
      await client.account.update({
        where: { id: account.id },
        data: {
          tenantId: account.tenantId,
          roles: [...account.roles],
          status: account.status,
          emailVerifiedAt: toDate(account.emailVerifiedAt),
          updatedAt: toRequiredDate(account.updatedAt),
        },
      })
      return
    }

    const user = await client.user.findUnique({
      where: { normalizedEmail: account.normalizedEmail },
      include: { accounts: { take: 1 } },
    })
    const userId = user?.id ?? account.id
    if (!user) {
      await client.user.create({
        data: {
          id: userId,
          email: account.email,
          normalizedEmail: account.normalizedEmail,
          displayName: account.displayName,
        },
      })
    }
    await client.account.create({
      data: {
        id: account.id,
        userId,
        tenantId: account.tenantId,
        roles: [...account.roles],
        status: account.status,
        emailVerifiedAt: toDate(account.emailVerifiedAt),
        createdAt: toRequiredDate(account.createdAt),
        updatedAt: toRequiredDate(account.updatedAt),
      },
    })
  }

  async saveCredential(credential: PasswordCredential): Promise<void> {
    const data: CredentialUpdateData = {
      passwordHash: credential.passwordHash,
      status: credential.status,
      updatedAt: toRequiredDate(credential.updatedAt),
      lastUsedAt: toDate(credential.lastUsedAt),
    }
    const existing = await this.client.passwordCredential.findUnique({
      where: { accountId: credential.accountId },
    })
    if (existing) {
      await this.client.passwordCredential.update({ where: { id: existing.id }, data })
      return
    }
    await this.client.passwordCredential.create({
      data: {
        id: credential.id,
        accountId: credential.accountId,
        passwordHash: credential.passwordHash,
        status: credential.status,
        createdAt: toRequiredDate(credential.createdAt),
        updatedAt: toRequiredDate(credential.updatedAt),
        lastUsedAt: toDate(credential.lastUsedAt),
      },
    })
  }

  async findPasswordCredential(accountId: string): Promise<PasswordCredential | undefined> {
    const row = await this.client.passwordCredential.findUnique({ where: { accountId } })
    return row ? mapCredentialRow(row) : undefined
  }

  async saveVerificationToken(token: VerificationToken): Promise<void> {
    await this.saveToken(this.client.verificationToken, token)
  }

  async findVerificationToken(tokenDigest: string): Promise<VerificationToken | undefined> {
    const row = await this.client.verificationToken.findUnique({ where: { tokenDigest } })
    return row ? (mapTokenRow(row) as VerificationToken) : undefined
  }

  async saveRecoveryToken(token: RecoveryToken): Promise<void> {
    await this.saveToken(this.client.recoveryToken, token)
  }

  async findRecoveryToken(tokenDigest: string): Promise<RecoveryToken | undefined> {
    const row = await this.client.recoveryToken.findUnique({ where: { tokenDigest } })
    return row ? (mapTokenRow(row) as RecoveryToken) : undefined
  }

  async saveSession(session: Session): Promise<void> {
    await this.client.session.create({
      data: {
        id: session.id,
        accountId: session.accountId,
        tenantId: session.tenantId,
        deviceId: session.deviceId,
        accessTokenDigest: session.accessTokenDigest,
        roles: [...session.scope.roles],
        permissions: [...session.scope.permissions],
        createdAt: toRequiredDate(session.createdAt),
        expiresAt: toRequiredDate(session.expiresAt),
        revokedAt: toDate(session.revokedAt),
      },
    })
  }

  async findSessionByAccessTokenDigest(accessTokenDigest: string): Promise<Session | undefined> {
    const row = await this.client.session.findUnique({ where: { accessTokenDigest } })
    return row ? mapSessionRow(row) : undefined
  }

  async revokeSession(accessTokenDigest: string, revokedAt: number): Promise<Account | undefined> {
    const session = await this.client.session.findUnique({ where: { accessTokenDigest } })
    if (!session || session.revokedAt !== null) return undefined
    await this.client.session.update({
      where: { id: session.id },
      data: { revokedAt: toRequiredDate(revokedAt) },
    })
    return this.getAccount(session.accountId)
  }

  async revokeSessions(accountId: string, revokedAt: number): Promise<void> {
    await this.client.session.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: toRequiredDate(revokedAt) },
    })
  }

  async saveDevice(accountId: string, device: Device): Promise<void> {
    await this.client.device.upsert({
      where: { accountId_deviceId: { accountId, deviceId: device.deviceId } },
      create: {
        accountId,
        deviceId: device.deviceId,
        label: device.label,
        firstSeenAt: toRequiredDate(device.firstSeenAt),
        lastSeenAt: toRequiredDate(device.lastSeenAt),
      },
      update: { label: device.label, lastSeenAt: toRequiredDate(device.lastSeenAt) },
    })
  }

  private async saveToken<T extends VerificationToken | RecoveryToken>(
    delegate: TokenDelegate<TokenRow>,
    token: T
  ): Promise<void> {
    const existing = await delegate.findUnique({ where: { tokenDigest: token.tokenDigest } })
    const data = {
      id: token.id,
      accountId: token.accountId,
      tokenDigest: token.tokenDigest,
      expiresAt: toRequiredDate(token.expiresAt),
      consumedAt: toDate(token.consumedAt),
    }
    if (existing) {
      await delegate.update({ where: { id: existing.id }, data: { consumedAt: data.consumedAt } })
      return
    }
    await delegate.create({ data })
  }
}

export class PrismaSecurityAuditSink implements AuditSink {
  constructor(private readonly client: PrismaIdentityClient) {}

  async record(event: Parameters<AuditSink['record']>[0]): Promise<void> {
    await this.client.auditEvent?.create({
      data: {
        id: randomUUID(),
        tenantId: event.tenantId,
        actorId: event.actorId === 'anonymous' ? null : event.actorId,
        correlationId: event.correlationId,
        eventType: event.kind,
        outcome: event.outcome,
        metadata: event.metadata,
        occurredAt: new Date(event.occurredAt),
      },
    })
  }
}
