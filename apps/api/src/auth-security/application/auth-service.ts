import type { Clock } from '../ports/clock.js'
import type { IdentityStore } from '../ports/identity-store.js'
import type {
  AuditSink,
  EmailSender,
  IdGenerator,
  PasswordHasher,
  RateLimiter,
  TokenIssuer,
} from '../ports/security.js'
import type {
  Account,
  PasswordCredential,
  SafeAccount,
  SafeCredential,
  SecurityEvent,
  Session,
} from '../domain/models.js'
import { AUTH_EVENT_KIND, AUTH_RESULT_CODE, CREDENTIAL_STATUS } from '../domain/constants.js'
import { failure, type AuthFailure } from '../domain/errors.js'
import {
  GENERIC_AUTH_FAILURE_MESSAGE,
  GENERIC_RECOVERY_MESSAGE,
  hasPrivilegeMutation,
  normalizeEmail,
  validateEmail,
  validatePassword,
} from '../domain/validation.js'

const CONTRACT_VERSION = '1.0.0' as const
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const RECOVERY_TTL_MS = 60 * 60 * 1000
const SESSION_TTL_MS = 60 * 60 * 1000
const MEMBER_PERMISSIONS = ['tus:checkout', 'tus:marketplace:read', 'tus:read'] as const

export interface RegisterInput {
  email: string
  password: string
  displayName: string
  tenantId?: string
}

export interface RegisterResult {
  account: SafeAccount
  credential: SafeCredential
  verificationToken: string
}

export interface SignInInput {
  email: string
  password: string
  device?: { deviceId?: string; label?: string }
}

export interface SessionView {
  id: string
  accessToken: string
  accountId: string
  tenantId: string
  deviceId: string
  scope: { tenantId: string; roles: string[]; permissions: string[] }
  expiresAt: number
}

export type SignInResult = { ok: true; session: SessionView } | AuthFailure
export type LifecycleResult = { ok: true } | AuthFailure
export type AccountUpdateResult = { ok: true; account: SafeAccount } | AuthFailure

export interface RecoveryPublicResult {
  accepted: true
  message: string
}

export interface RecoveryRequestResult {
  public: RecoveryPublicResult
  recoveryToken?: string
}

export interface AuthServiceDependencies {
  store: IdentityStore
  clock: Clock
  ids: IdGenerator
  tokens: TokenIssuer
  passwordHasher: PasswordHasher
  audit: AuditSink
  email: EmailSender
  recoveryRateLimiter: RateLimiter
}

export class AuthService {
  private readonly dependencies: AuthServiceDependencies

  constructor(dependencies: AuthServiceDependencies) {
    this.dependencies = dependencies
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    return this.runTransaction((store) => this.registerWithinStore(input, store))
  }

  private async registerWithinStore(input: RegisterInput, store: IdentityStore): Promise<RegisterResult> {
    const normalizedEmail = normalizeEmail(input.email)
    if (
      !validateEmail(normalizedEmail) ||
      !validatePassword(input.password) ||
      input.displayName.trim().length === 0
    ) {
      throw new Error('Invalid registration input')
    }
    if (await store.findAccountByEmail(normalizedEmail)) {
      throw new Error('Account already exists')
    }

    const now = this.dependencies.clock.now()
    const account: Account = {
      id: this.dependencies.ids.next(),
      email: input.email.trim(),
      normalizedEmail,
      displayName: input.displayName.trim(),
      tenantId: input.tenantId?.trim() || this.dependencies.ids.next(),
      roles: ['member'],
      status: 'active',
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const credential: PasswordCredential = {
      id: this.dependencies.ids.next(),
      accountId: account.id,
      passwordHash: await this.dependencies.passwordHasher.hash(input.password),
      status: CREDENTIAL_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    }
    const verificationToken = this.dependencies.tokens.issue()

    await store.saveAccount(account)
    await store.saveCredential(credential)
    await store.saveVerificationToken({
      id: this.dependencies.ids.next(),
      accountId: account.id,
      tokenDigest: this.dependencies.tokens.digest(verificationToken),
      expiresAt: now + VERIFICATION_TTL_MS,
      consumedAt: null,
    })
    await this.dependencies.email.sendVerification({
      email: account.email,
      token: verificationToken,
    })
    await this.record(account, AUTH_EVENT_KIND.ACCOUNT_REGISTERED, 'success', 'account_created')

    return {
      account: this.safeAccount(account),
      credential: this.safeCredential(credential),
      verificationToken,
    }
  }

  private runTransaction<TValue>(operation: (store: IdentityStore) => Promise<TValue>): Promise<TValue> {
    return this.dependencies.store.transaction
      ? this.dependencies.store.transaction(operation)
      : operation(this.dependencies.store)
  }

  async signIn(input: SignInInput): Promise<SignInResult> {
    return this.runTransaction((store) => this.signInWithinStore(input, store))
  }

  private async signInWithinStore(input: SignInInput, store: IdentityStore): Promise<SignInResult> {
    const normalizedEmail = normalizeEmail(input.email)
    const account = await store.findAccountByEmail(normalizedEmail)
    const credential = account
      ? await store.findPasswordCredential(account.id)
      : undefined
    const hash = credential?.passwordHash ?? this.dependencies.passwordHasher.dummyHash
    const passwordMatches = await this.dependencies.passwordHasher.verify(input.password, hash)

    if (
      !account ||
      !credential ||
      credential.status !== CREDENTIAL_STATUS.ACTIVE ||
      account.status !== 'active' ||
      !account.emailVerifiedAt ||
      !passwordMatches
    ) {
      await this.record(account, AUTH_EVENT_KIND.AUTH_FAILED, 'denied', 'invalid_credentials')
      return failure(AUTH_RESULT_CODE.INVALID_CREDENTIALS, GENERIC_AUTH_FAILURE_MESSAGE)
    }

    const now = this.dependencies.clock.now()
    const deviceId = input.device?.deviceId?.trim() || this.dependencies.ids.next()
    const deviceLabel = input.device?.label?.trim() || 'Unspecified device'
    await store.saveDevice(account.id, {
      deviceId,
      label: deviceLabel,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    credential.lastUsedAt = now
    credential.updatedAt = now
    await store.saveCredential(credential)

    const accessToken = this.dependencies.tokens.issue()
    const session: Session = {
      id: this.dependencies.ids.next(),
      accountId: account.id,
      tenantId: account.tenantId,
      deviceId,
      accessTokenDigest: this.dependencies.tokens.digest(accessToken),
      scope: {
        tenantId: account.tenantId,
        roles: [...account.roles],
        permissions: [...MEMBER_PERMISSIONS],
      },
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      revokedAt: null,
    }
    await store.saveSession(session)
    await this.record(account, AUTH_EVENT_KIND.AUTH_SIGNED_IN, 'success', 'credential_verified')
    await this.record(account, AUTH_EVENT_KIND.SESSION_CREATED, 'success', 'scoped_session_issued')

    return {
      ok: true,
      session: {
        id: session.id,
        accessToken,
        accountId: session.accountId,
        tenantId: session.tenantId,
        deviceId: session.deviceId,
        scope: {
          ...session.scope,
          roles: [...session.scope.roles],
          permissions: [...session.scope.permissions],
        },
        expiresAt: session.expiresAt,
      },
    }
  }

  async verifyEmail(input: { token: string }): Promise<LifecycleResult> {
    return this.runTransaction((store) => this.verifyEmailWithinStore(input, store))
  }

  private async verifyEmailWithinStore(input: { token: string }, store: IdentityStore): Promise<LifecycleResult> {
    const now = this.dependencies.clock.now()
    const token = await store.findVerificationToken(
      this.dependencies.tokens.digest(input.token)
    )
    const account = token ? await store.getAccount(token.accountId) : undefined
    if (!token || !account || token.consumedAt !== null || token.expiresAt <= now) {
      await this.record(
        account,
        AUTH_EVENT_KIND.ACCOUNT_VERIFIED,
        'denied',
        'invalid_or_expired_token'
      )
      return failure(AUTH_RESULT_CODE.INVALID_TOKEN, 'Invalid or expired token')
    }

    token.consumedAt = now
    account.emailVerifiedAt = now
    account.updatedAt = now
    await store.saveVerificationToken(token)
    await store.saveAccount(account)
    await this.record(account, AUTH_EVENT_KIND.ACCOUNT_VERIFIED, 'success', 'email_verified')
    return { ok: true }
  }

  async signOut(input: { accessToken: string }): Promise<LifecycleResult> {
    return this.runTransaction((store) => this.signOutWithinStore(input, store))
  }

  private async signOutWithinStore(input: { accessToken: string }, store: IdentityStore): Promise<LifecycleResult> {
    const account = await store.revokeSession(
      this.dependencies.tokens.digest(input.accessToken),
      this.dependencies.clock.now()
    )
    if (!account) return failure(AUTH_RESULT_CODE.INVALID_TOKEN, 'Invalid or expired session')
    await this.record(account, AUTH_EVENT_KIND.SESSION_REVOKED, 'success', 'session_revoked')
    return { ok: true }
  }

  async requestPasswordRecovery(input: { email: string }): Promise<RecoveryRequestResult> {
    return this.runTransaction((store) => this.requestPasswordRecoveryWithinStore(input, store))
  }

  private async requestPasswordRecoveryWithinStore(input: { email: string }, store: IdentityStore): Promise<RecoveryRequestResult> {
    const normalizedEmail = normalizeEmail(input.email)
    const allowed = this.dependencies.recoveryRateLimiter.allow(
      normalizedEmail,
      this.dependencies.clock.now()
    )
    const account = await store.findAccountByEmail(normalizedEmail)
    if (!allowed) {
      await this.record(account, AUTH_EVENT_KIND.RECOVERY_REQUESTED, 'accepted', 'rate_limited')
      return { public: { accepted: true, message: GENERIC_RECOVERY_MESSAGE } }
    }
    if (!account || account.status !== 'active') {
      await this.record(
        account,
        AUTH_EVENT_KIND.RECOVERY_REQUESTED,
        'accepted',
        'request_processed'
      )
      return { public: { accepted: true, message: GENERIC_RECOVERY_MESSAGE } }
    }

    const recoveryToken = this.dependencies.tokens.issue()
    await store.saveRecoveryToken({
      id: this.dependencies.ids.next(),
      accountId: account.id,
      tokenDigest: this.dependencies.tokens.digest(recoveryToken),
      expiresAt: this.dependencies.clock.now() + RECOVERY_TTL_MS,
      consumedAt: null,
    })
    await this.dependencies.email.sendRecovery({ email: account.email, token: recoveryToken })
    await this.record(account, AUTH_EVENT_KIND.RECOVERY_REQUESTED, 'accepted', 'request_processed')
    return { public: { accepted: true, message: GENERIC_RECOVERY_MESSAGE }, recoveryToken }
  }

  async completePasswordRecovery(input: {
    token: string
    newPassword: string
  }): Promise<LifecycleResult> {
    return this.runTransaction((store) => this.completePasswordRecoveryWithinStore(input, store))
  }

  private async completePasswordRecoveryWithinStore(input: {
    token: string
    newPassword: string
  }, store: IdentityStore): Promise<LifecycleResult> {
    if (!validatePassword(input.newPassword)) {
      return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Password does not meet policy')
    }
    const now = this.dependencies.clock.now()
    const token = await store.findRecoveryToken(
      this.dependencies.tokens.digest(input.token)
    )
    const account = token ? await store.getAccount(token.accountId) : undefined
    if (!token || !account || token.consumedAt !== null || token.expiresAt <= now) {
      await this.record(
        account,
        AUTH_EVENT_KIND.RECOVERY_COMPLETED,
        'denied',
        'invalid_or_expired_token'
      )
      return failure(AUTH_RESULT_CODE.INVALID_TOKEN, 'Invalid or expired token')
    }

    const credential = await store.findPasswordCredential(account.id)
    if (!credential) {
      await this.record(
        account,
        AUTH_EVENT_KIND.RECOVERY_COMPLETED,
        'denied',
        'credential_not_found'
      )
      return failure(AUTH_RESULT_CODE.INVALID_TOKEN, 'Invalid or expired token')
    }
    credential.passwordHash = await this.dependencies.passwordHasher.hash(input.newPassword)
    credential.status = CREDENTIAL_STATUS.ACTIVE
    credential.updatedAt = now
    token.consumedAt = now
    await store.saveCredential(credential)
    await store.saveRecoveryToken(token)
    await store.revokeSessions(account.id, now)
    await this.record(account, AUTH_EVENT_KIND.RECOVERY_COMPLETED, 'success', 'credential_reset')
    return { ok: true }
  }

  async changePassword(input: {
    actorId: string
    currentPassword: string
    newPassword: string
  }): Promise<LifecycleResult> {
    return this.runTransaction((store) => this.changePasswordWithinStore(input, store))
  }

  private async changePasswordWithinStore(input: {
    actorId: string
    currentPassword: string
    newPassword: string
  }, store: IdentityStore): Promise<LifecycleResult> {
    if (!validatePassword(input.newPassword)) {
      return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Password does not meet policy')
    }
    const account = await store.getAccount(input.actorId)
    const credential = account
      ? await store.findPasswordCredential(account.id)
      : undefined
    const currentMatches = credential
      ? await this.dependencies.passwordHasher.verify(
          input.currentPassword,
          credential.passwordHash
        )
      : await this.dependencies.passwordHasher.verify(
          input.currentPassword,
          this.dependencies.passwordHasher.dummyHash
        )
    if (
      !account ||
      !credential ||
      credential.status !== CREDENTIAL_STATUS.ACTIVE ||
      !currentMatches
    ) {
      await this.record(account, AUTH_EVENT_KIND.AUTH_FAILED, 'denied', 'password_change_denied')
      return failure(AUTH_RESULT_CODE.FORBIDDEN, 'Password change is not permitted')
    }

    credential.passwordHash = await this.dependencies.passwordHasher.hash(input.newPassword)
    const now = this.dependencies.clock.now()
    credential.updatedAt = now
    await store.saveCredential(credential)
    await store.revokeSessions(account.id, now)
    await this.record(
      account,
      AUTH_EVENT_KIND.CREDENTIAL_PASSWORD_CHANGED,
      'success',
      'password_changed'
    )
    return { ok: true }
  }

  async disableCredential(input: {
    actorId: string
    credentialId: string
  }): Promise<LifecycleResult> {
    return this.runTransaction((store) => this.disableCredentialWithinStore(input, store))
  }

  private async disableCredentialWithinStore(input: {
    actorId: string
    credentialId: string
  }, store: IdentityStore): Promise<LifecycleResult> {
    const account = await store.getAccount(input.actorId)
    const credential = account
      ? await store.findPasswordCredential(account.id)
      : undefined
    if (!account || !credential || credential.id !== input.credentialId) {
      await this.record(
        account,
        AUTH_EVENT_KIND.CREDENTIAL_DISABLED,
        'denied',
        'credential_not_owned'
      )
      return failure(AUTH_RESULT_CODE.FORBIDDEN, 'Credential change is not permitted')
    }
    credential.status = CREDENTIAL_STATUS.DISABLED
    const now = this.dependencies.clock.now()
    credential.updatedAt = now
    await store.saveCredential(credential)
    await store.revokeSessions(account.id, now)
    await this.record(
      account,
      AUTH_EVENT_KIND.CREDENTIAL_DISABLED,
      'success',
      'credential_disabled'
    )
    return { ok: true }
  }

  async updateAccount(input: {
    actorId: string
    accountId: string
    changes: Record<string, unknown>
  }): Promise<AccountUpdateResult> {
    return this.runTransaction((store) => this.updateAccountWithinStore(input, store))
  }

  private async updateAccountWithinStore(input: {
    actorId: string
    accountId: string
    changes: Record<string, unknown>
  }, store: IdentityStore): Promise<AccountUpdateResult> {
    const account = await store.getAccount(input.accountId)
    if (!account || account.id !== input.actorId || hasPrivilegeMutation(input.changes)) {
      await this.record(account, AUTH_EVENT_KIND.AUTH_FAILED, 'denied', 'account_update_forbidden')
      return failure(AUTH_RESULT_CODE.FORBIDDEN, 'Account update is not permitted')
    }
    const displayName = input.changes['displayName']
    if (
      displayName !== undefined &&
      (typeof displayName !== 'string' || displayName.trim().length === 0)
    ) {
      return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Display name is invalid')
    }
    if (typeof displayName === 'string') account.displayName = displayName.trim()
    account.updatedAt = this.dependencies.clock.now()
    await store.saveAccount(account)
    return { ok: true, account: this.safeAccount(account) }
  }

  private safeAccount(account: Account): SafeAccount {
    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      tenantId: account.tenantId,
      roles: [...account.roles],
      status: account.status,
      emailVerifiedAt: account.emailVerifiedAt,
    }
  }

  private safeCredential(credential: PasswordCredential): SafeCredential {
    return {
      id: credential.id,
      accountId: credential.accountId,
      status: credential.status,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      lastUsedAt: credential.lastUsedAt,
    }
  }

  private async record(
    account: Account | undefined,
    kind: SecurityEvent['kind'],
    outcome: SecurityEvent['outcome'],
    reason: string
  ): Promise<void> {
    const now = this.dependencies.clock.now()
    await this.dependencies.audit.record({
      contractVersion: CONTRACT_VERSION,
      kind,
      occurredAt: new Date(now).toISOString(),
      actorId: account?.id ?? 'anonymous',
      tenantId: account?.tenantId ?? 'unknown',
      outcome,
      correlationId: this.dependencies.ids.next(),
      metadata: { reason },
    })
  }
}
