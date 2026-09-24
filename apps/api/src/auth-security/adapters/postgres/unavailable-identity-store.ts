import type { IdentityStore } from '../../ports/identity-store.js'
import type {
  Account,
  Device,
  PasswordCredential,
  RecoveryToken,
  Session,
  VerificationToken,
} from '../../domain/models.js'

export class IdentityPersistenceUnavailableError extends Error {
  readonly code = 'IDENTITY_PERSISTENCE_UNAVAILABLE'

  constructor(reason?: string) {
    super('Identity persistence is unavailable')
    this.name = 'IdentityPersistenceUnavailableError'
    if (reason) this.cause = reason
  }
}

export class UnavailableIdentityStore implements IdentityStore {
  private readonly error: IdentityPersistenceUnavailableError

  constructor(reason?: string) {
    this.error = new IdentityPersistenceUnavailableError(reason)
  }

  async findAccountByEmail(): Promise<Account | undefined> {
    return this.unavailable()
  }

  async getAccount(): Promise<Account | undefined> {
    return this.unavailable()
  }

  async hasActiveMembership(): Promise<boolean> {
    return this.unavailable()
  }

  async saveAccount(): Promise<void> {
    return this.unavailable()
  }

  async saveCredential(): Promise<void> {
    return this.unavailable()
  }

  async findPasswordCredential(): Promise<PasswordCredential | undefined> {
    return this.unavailable()
  }

  async saveVerificationToken(): Promise<void> {
    return this.unavailable()
  }

  async findVerificationToken(): Promise<VerificationToken | undefined> {
    return this.unavailable()
  }

  async saveRecoveryToken(): Promise<void> {
    return this.unavailable()
  }

  async findRecoveryToken(): Promise<RecoveryToken | undefined> {
    return this.unavailable()
  }

  async saveSession(): Promise<void> {
    return this.unavailable()
  }

  async findSessionByAccessTokenDigest(): Promise<Session | undefined> {
    return this.unavailable()
  }

  async revokeSession(): Promise<Account | undefined> {
    return this.unavailable()
  }

  async revokeSessions(): Promise<void> {
    return this.unavailable()
  }

  async saveDevice(): Promise<void> {
    return this.unavailable()
  }

  private unavailable(): never {
    throw this.error
  }
}
