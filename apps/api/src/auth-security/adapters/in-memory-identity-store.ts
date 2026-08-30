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
}
