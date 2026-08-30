import type {
  Account,
  Device,
  PasswordCredential,
  RecoveryToken,
  Session,
  VerificationToken,
} from '../domain/models.js'

export interface IdentityStore {
  readonly accounts?: Map<string, Account>
  readonly credentials?: Map<string, PasswordCredential>
  readonly verificationTokens?: Map<string, VerificationToken>
  readonly recoveryTokens?: Map<string, RecoveryToken>
  readonly sessions?: Map<string, Session>
  readonly devices?: Map<string, Device>
  findAccountByEmail(normalizedEmail: string): Promise<Account | undefined>
  getAccount(accountId: string): Promise<Account | undefined>
  saveAccount(account: Account): Promise<void>
  saveCredential(credential: PasswordCredential): Promise<void>
  findPasswordCredential(accountId: string): Promise<PasswordCredential | undefined>
  saveVerificationToken(token: VerificationToken): Promise<void>
  findVerificationToken(tokenDigest: string): Promise<VerificationToken | undefined>
  saveRecoveryToken(token: RecoveryToken): Promise<void>
  findRecoveryToken(tokenDigest: string): Promise<RecoveryToken | undefined>
  saveSession(session: Session): Promise<void>
  findSessionByAccessTokenDigest(accessTokenDigest: string): Promise<Session | undefined>
  revokeSession(accessTokenDigest: string, revokedAt: number): Promise<Account | undefined>
  revokeSessions(accountId: string, revokedAt: number): Promise<void>
  saveDevice(accountId: string, device: Device): Promise<void>
}
