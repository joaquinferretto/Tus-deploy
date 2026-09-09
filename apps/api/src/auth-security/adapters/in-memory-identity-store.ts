import type { IdentityStore } from '../ports/identity-store.js'
import type {
  Account,
  Device,
  PasswordCredential,
  RecoveryToken,
  Session,
  VerificationToken,
} from '../domain/models.js'

export class InMemoryIdentityStore implements IdentityStore {
  readonly accounts = new Map<string, Account>()
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

  async getAccount(accountId: string): Promise<Account | undefined> {
    return this.accounts.get(accountId)
  }

  async saveAccount(account: Account): Promise<void> {
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
      accounts: cloneMap(this.accounts),
      credentials: cloneMap(this.credentials),
      verificationTokens: cloneMap(this.verificationTokens),
      recoveryTokens: cloneMap(this.recoveryTokens),
      sessions: cloneMap(this.sessions),
      devices: cloneMap(this.devices),
    }
    try {
      return await operation(this)
    } catch (error) {
      restoreMap(this.accounts, snapshot.accounts)
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
}

function cloneMap<TKey, TValue>(source: Map<TKey, TValue>): Map<TKey, TValue> {
  return new Map([...source].map(([key, value]) => [key, structuredClone(value)]))
}

function restoreMap<TKey, TValue>(target: Map<TKey, TValue>, source: Map<TKey, TValue>): void {
  target.clear()
  for (const [key, value] of source) target.set(key, structuredClone(value))
}
