import type { Clock } from '../ports/clock.js'
import type { IdentityStore } from '../ports/identity-store.js'
import {
  SECURITY_NOTIFICATION,
  type AuditSink,
  type EmailSender,
  type IdGenerator,
  type PasswordBreachChecker,
  type PasswordHasher,
  type RateLimiter,
  type SecurityNotificationKind,
  type TokenIssuer,
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
const OWNER_PERMISSIONS = [...MEMBER_PERMISSIONS, 'tus:marketplace:write'] as const

// Platform administration. These permissions are NEVER derived from roles: only a session of an
// account whose VERIFIED email is in the operator-configured allowlist (TUS_PLATFORM_ADMIN_EMAILS,
// set in the API environment, never in the repository) receives them, and only at sign-in on the
// Web/API (the WhatsApp resolver uses alcanceDeCuenta and never grants them).
export const PLATFORM_ADMIN_PERMISSIONS = ['tus:payments:admin', 'tus:identity:admin', 'tus:whatsapp:support', 'tus:providers:admin'] as const

export function leerAdminsPlataforma(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(item)))]
}

// Single source of the session scope of an account (also used by WhatsApp to derive the CURRENT
// authority of a linked account on every turn instead of trusting a stored role).
export function alcanceDeCuenta(roles: readonly string[]): { roles: string[]; permissions: string[] } {
  return { roles: [...roles], permissions: roles.includes('owner') ? [...OWNER_PERMISSIONS] : [...MEMBER_PERMISSIONS] }
}

export interface RegisterInput {
  email: string
  password: string
  displayName: string
}

// The public answer to a sign-up is always the same ("check your email"), whether the email was
// new or already registered (no account enumeration). The account/token are only returned to
// in-process callers and tests for NEW accounts.
export interface RegisterResult {
  status: 'pending_verification'
  account: SafeAccount
  credential: SafeCredential
  verificationToken: string
}

export interface RegisterOutcome {
  status: 'pending_verification'
  created?: RegisterResult
}

export class PasswordPolicyError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'PASSWORD_BREACHED') {
    super(code === 'PASSWORD_BREACHED' ? 'Password appears in known data breaches' : 'Invalid registration input')
    this.name = 'PasswordPolicyError'
  }
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
  // Verified emails allowed to administer the platform (normalized, lowercase).
  platformAdminEmails?: readonly string[]
  recoveryRateLimiter: RateLimiter
  // Per normalized email (durable in production): sign-in attempts and verification re-sends.
  signInRateLimiter?: RateLimiter
  verificationResendRateLimiter?: RateLimiter
  verificationResendCooldown?: RateLimiter
  passwordBreachChecker?: PasswordBreachChecker
}

export class AuthService {
  private readonly dependencies: AuthServiceDependencies

  constructor(dependencies: AuthServiceDependencies) {
    this.dependencies = dependencies
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const outcome = await this.registerAccount(input)
    if (!outcome.created) throw new Error('Account already exists')
    return outcome.created
  }

  // Email sign-up for the HTTP boundary: same answer for new and existing emails. An existing
  // unverified account gets a new verification link; a verified one gets a security notice.
  async registerAccount(input: RegisterInput): Promise<RegisterOutcome> {
    const normalizedEmail = normalizeEmail(input.email)
    if (!validateEmail(normalizedEmail) || !validatePassword(input.password) || input.displayName.trim().length === 0) {
      throw new PasswordPolicyError('VALIDATION_FAILED')
    }
    if (await this.passwordIsBreached(input.password)) throw new PasswordPolicyError('PASSWORD_BREACHED')
    const existing = await this.dependencies.store.findAccountByEmail(normalizedEmail)
    if (existing) {
      if (!existing.emailVerifiedAt) await this.resendVerification({ email: normalizedEmail })
      else await this.notify(existing, SECURITY_NOTIFICATION.REGISTRATION_ATTEMPT)
      return { status: 'pending_verification' }
    }
    const created = await this.runTransaction((store) => this.registerWithinStore(input, store))
    await this.deliver(created.account.id, created.account.tenantId, () =>
      this.dependencies.email.sendVerification({ email: created.account.email, token: created.verificationToken })
    )
    return { status: 'pending_verification', created }
  }

  // "Reenviar email de verificación": always the same public answer. At most 5 per hour and one
  // per minute for the same email (durable limiter in production).
  async resendVerification(input: { email: string }): Promise<{ accepted: true }> {
    const normalizedEmail = normalizeEmail(input.email)
    const now = this.dependencies.clock.now()
    if (!validateEmail(normalizedEmail)) return { accepted: true }
    const cooldown = this.dependencies.verificationResendCooldown
    const limiter = this.dependencies.verificationResendRateLimiter
    if ((cooldown && !(await cooldown.allow(normalizedEmail, now))) || (limiter && !(await limiter.allow(normalizedEmail, now)))) {
      return { accepted: true }
    }
    const account = await this.dependencies.store.findAccountByEmail(normalizedEmail)
    if (!account || account.emailVerifiedAt || account.status !== 'active') return { accepted: true }
    const token = this.dependencies.tokens.issue()
    await this.dependencies.store.saveVerificationToken({
      id: this.dependencies.ids.next(),
      accountId: account.id,
      tokenDigest: this.dependencies.tokens.digest(token),
      expiresAt: now + VERIFICATION_TTL_MS,
      consumedAt: null,
    })
    await this.record(account, AUTH_EVENT_KIND.VERIFICATION_RESENT, 'accepted', 'verification_resent')
    await this.deliver(account.id, account.tenantId, () => this.dependencies.email.sendVerification({ email: account.email, token }))
    return { accepted: true }
  }

  private async registerWithinStore(input: RegisterInput, store: IdentityStore): Promise<RegisterResult> {
    const normalizedEmail = normalizeEmail(input.email)
    if (await store.findAccountByEmail(normalizedEmail)) {
      throw new Error('Account already exists')
    }

    const now = this.dependencies.clock.now()
    const account: Account = {
      id: this.dependencies.ids.next(),
      email: input.email.trim(),
      normalizedEmail,
      displayName: input.displayName.trim(),
      tenantId: this.dependencies.ids.next(),
      roles: ['owner'],
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

    await store.saveAccount(account, { bootstrapTenant: true })
    await store.saveCredential(credential)
    await store.saveVerificationToken({
      id: this.dependencies.ids.next(),
      accountId: account.id,
      tokenDigest: this.dependencies.tokens.digest(verificationToken),
      expiresAt: now + VERIFICATION_TTL_MS,
      consumedAt: null,
    })
    await this.record(account, AUTH_EVENT_KIND.ACCOUNT_REGISTERED, 'success', 'account_created')

    return {
      status: 'pending_verification',
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
    // Same limit for existing and unknown emails (no enumeration); it slows password guessing on
    // one account without locking the whole site.
    const limiter = this.dependencies.signInRateLimiter
    if (limiter && !(await limiter.allow(normalizeEmail(input.email), this.dependencies.clock.now()))) {
      await this.record(undefined, AUTH_EVENT_KIND.AUTH_FAILED, 'denied', 'rate_limited')
      return failure(AUTH_RESULT_CODE.RATE_LIMITED, 'Too many attempts, try again later')
    }
    return this.runTransaction((store) => this.signInWithinStore(input, store))
  }

  // New session for the same account (fresh token and id, scope re-evaluated) and revocation of
  // the old one: used after the second factor so a token issued before MFA never gains power.
  async rotateSession(input: { accessToken: string }): Promise<SignInResult> {
    return this.runTransaction(async (store) => {
      const now = this.dependencies.clock.now()
      const digest = this.dependencies.tokens.digest(input.accessToken)
      const current = await store.findSessionByAccessTokenDigest(digest)
      const account = current ? await store.getAccount(current.accountId) : undefined
      if (!current || current.revokedAt !== null || current.expiresAt <= now || !account || account.status !== 'active' || !account.emailVerifiedAt) {
        return failure(AUTH_RESULT_CODE.INVALID_TOKEN, 'Invalid or expired session')
      }
      await store.revokeSession(digest, now)
      // Rotation keeps the admin eligibility of the ORIGINAL session (a Google session stays non-admin).
      const wasAdmin = PLATFORM_ADMIN_PERMISSIONS.some((permission) => current.scope.permissions.includes(permission))
      const rotated = await this.issueSession(store, account, { deviceId: current.deviceId }, 'session_rotated', { platformAdmin: wasAdmin })
      await this.record(account, AUTH_EVENT_KIND.SESSION_ROTATED, 'success', 'session_rotated')
      return rotated
    })
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
    credential.lastUsedAt = now
    credential.updatedAt = now
    await store.saveCredential(credential)
    return this.issueSession(store, account, input.device, 'credential_verified', { platformAdmin: true })
  }

  // Federated sign-in (Google): the identity was already verified by the OIDC boundary. The same
  // account gates as password sign-in apply and the SAME session type is issued, so the rest of
  // TUS never knows how the person authenticated.
  async signInFederated(input: { accountId: string; device?: SignInInput['device'] }): Promise<SignInResult> {
    return this.runTransaction(async (store) => {
      const account = await store.getAccount(input.accountId)
      if (!account || account.status !== 'active' || !account.emailVerifiedAt || !(await store.hasActiveMembership(account.id, account.tenantId))) {
        await this.record(account, AUTH_EVENT_KIND.AUTH_FAILED, 'denied', 'federated_account_unavailable')
        return failure(AUTH_RESULT_CODE.INVALID_CREDENTIALS, GENERIC_AUTH_FAILURE_MESSAGE)
      }
      // Platform administration is never reachable through Google: the admin always signs in
      // with the TUS email + password (then MFA). A federated session never carries admin scope.
      return this.issueSession(store, account, input.device, 'federated_identity_verified', { platformAdmin: false })
    })
  }

  // Account for a verified federated identity: no password credential. The email is verified
  // only because the identity provider asserted email_verified=true (checked by the caller).
  async registerFederated(input: { email: string; displayName: string }): Promise<{ ok: true; account: SafeAccount } | AuthFailure> {
    return this.runTransaction(async (store) => {
      const normalizedEmail = normalizeEmail(input.email)
      const displayName = input.displayName.trim().slice(0, 120)
      if (!validateEmail(normalizedEmail) || displayName.length === 0)
        return failure(AUTH_RESULT_CODE.INVALID_CREDENTIALS, 'Invalid registration input')
      if (await store.findAccountByEmail(normalizedEmail))
        return failure(AUTH_RESULT_CODE.INVALID_CREDENTIALS, 'Account already exists')
      const now = this.dependencies.clock.now()
      const account: Account = {
        id: this.dependencies.ids.next(),
        email: input.email.trim(),
        normalizedEmail,
        displayName,
        tenantId: this.dependencies.ids.next(),
        roles: ['owner'],
        status: 'active',
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      }
      await store.saveAccount(account, { bootstrapTenant: true })
      await this.record(account, AUTH_EVENT_KIND.ACCOUNT_REGISTERED, 'success', 'federated_account_created')
      return { ok: true, account: this.safeAccount(account) }
    })
  }

  private async issueSession(
    store: IdentityStore,
    account: Account,
    device: SignInInput['device'],
    reason: string,
    options: { platformAdmin: boolean }
  ): Promise<SignInResult> {
    const now = this.dependencies.clock.now()
    const deviceId = device?.deviceId?.trim() || this.dependencies.ids.next()
    const deviceLabel = device?.label?.trim() || 'Unspecified device'
    await store.saveDevice(account.id, {
      deviceId,
      label: deviceLabel,
      firstSeenAt: now,
      lastSeenAt: now,
    })

    const accessToken = this.dependencies.tokens.issue()
    const session: Session = {
      id: this.dependencies.ids.next(),
      accountId: account.id,
      tenantId: account.tenantId,
      deviceId,
      accessTokenDigest: this.dependencies.tokens.digest(accessToken),
      scope: {
        tenantId: account.tenantId,
        ...(options.platformAdmin ? this.alcanceDeSesion(account) : alcanceDeCuenta(account.roles)),
      },
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      revokedAt: null,
    }
    await store.saveSession(session)
    await this.record(account, AUTH_EVENT_KIND.AUTH_SIGNED_IN, 'success', reason)
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
    const result = await this.runTransaction((store) => this.requestPasswordRecoveryWithinStore(input, store))
    if (result.recoveryToken && result.recipient) {
      const { recipient, recoveryToken } = result
      await this.deliver(recipient.accountId, recipient.tenantId, () => this.dependencies.email.sendRecovery({ email: recipient.email, token: recoveryToken }))
    }
    return { public: result.public, ...(result.recoveryToken ? { recoveryToken: result.recoveryToken } : {}) }
  }

  private async requestPasswordRecoveryWithinStore(input: { email: string }, store: IdentityStore): Promise<RecoveryRequestResult & { recipient?: { accountId: string; tenantId: string; email: string } }> {
    const normalizedEmail = normalizeEmail(input.email)
    const allowed = await this.dependencies.recoveryRateLimiter.allow(
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
    await this.record(account, AUTH_EVENT_KIND.RECOVERY_REQUESTED, 'accepted', 'request_processed')
    return { public: { accepted: true, message: GENERIC_RECOVERY_MESSAGE }, recoveryToken, recipient: { accountId: account.id, tenantId: account.tenantId, email: account.email } }
  }

  // A reset only changes the password: sessions are revoked and an admin still needs the second
  // factor on the next sign-in (MFA is never skipped by a reset).
  async completePasswordRecovery(input: {
    token: string
    newPassword: string
  }): Promise<LifecycleResult> {
    if (validatePassword(input.newPassword) && (await this.passwordIsBreached(input.newPassword)))
      return failure(AUTH_RESULT_CODE.PASSWORD_BREACHED, 'Password appears in known data breaches')
    const result = await this.runTransaction((store) => this.completePasswordRecoveryWithinStore(input, store))
    if (result.ok) await this.notifyAccount(result.accountId, SECURITY_NOTIFICATION.PASSWORD_RESET)
    return result.ok ? { ok: true } : result
  }

  private async completePasswordRecoveryWithinStore(input: {
    token: string
    newPassword: string
  }, store: IdentityStore): Promise<{ ok: true; accountId: string } | AuthFailure> {
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
    return { ok: true, accountId: account.id }
  }

  // Re-authentication for sensitive actions (e.g. turning MFA off): 'ok' only when the current
  // password matches an active password credential. Constant work when there is none.
  async verifyCurrentPassword(accountId: string, password: string): Promise<'ok' | 'mismatch' | 'no_password'> {
    const account = await this.dependencies.store.getAccount(accountId)
    const credential = account ? await this.dependencies.store.findPasswordCredential(account.id) : undefined
    const active = Boolean(credential && credential.status === CREDENTIAL_STATUS.ACTIVE)
    const matches = await this.dependencies.passwordHasher.verify(password, active ? credential!.passwordHash : this.dependencies.passwordHasher.dummyHash)
    if (!active) return 'no_password'
    return matches ? 'ok' : 'mismatch'
  }

  async changePassword(input: {
    actorId: string
    currentPassword: string
    newPassword: string
  }): Promise<LifecycleResult> {
    if (validatePassword(input.newPassword) && (await this.passwordIsBreached(input.newPassword)))
      return failure(AUTH_RESULT_CODE.PASSWORD_BREACHED, 'Password appears in known data breaches')
    const result = await this.runTransaction((store) => this.changePasswordWithinStore(input, store))
    if (result.ok) await this.notifyAccount(input.actorId, SECURITY_NOTIFICATION.PASSWORD_CHANGED)
    return result
  }

  // Security email for an account (MFA changes, password changes). Never blocks the action: a
  // delivery failure is audited.
  async notifyAccount(accountId: string, kind: SecurityNotificationKind): Promise<void> {
    const account = await this.dependencies.store.getAccount(accountId)
    if (account) await this.notify(account, kind)
  }

  private async notify(account: Account, kind: SecurityNotificationKind): Promise<void> {
    const send = this.dependencies.email.sendSecurityNotification
    if (!send) return
    await this.deliver(account.id, account.tenantId, () => send.call(this.dependencies.email, { email: account.email, kind }))
  }

  private async deliver(accountId: string, tenantId: string, send: () => Promise<void>): Promise<void> {
    try {
      await send()
    } catch (error) {
      const reason = error instanceof Error && 'reason' in error && typeof error.reason === 'string' ? error.reason : 'delivery_failed'
      await this.dependencies.audit.record({
        contractVersion: CONTRACT_VERSION,
        kind: AUTH_EVENT_KIND.EMAIL_DELIVERY_FAILED,
        occurredAt: new Date(this.dependencies.clock.now()).toISOString(),
        actorId: accountId,
        tenantId,
        outcome: 'denied',
        correlationId: this.dependencies.ids.next(),
        metadata: { reason },
      })
    }
  }

  private async passwordIsBreached(password: string): Promise<boolean> {
    return this.dependencies.passwordBreachChecker ? this.dependencies.passwordBreachChecker.isBreached(password) : false
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

  // "Mi perfil": the session's own account only (never another id), in its safe shape.
  async getOwnAccount(actorId: string): Promise<SafeAccount | null> {
    const account = await this.dependencies.store.getAccount(actorId)
    return account ? this.safeAccount(account) : null
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

  // Session scope: role-derived permissions plus platform administration only for an allowlisted
  // account with a verified email.
  private alcanceDeSesion(account: Account): { roles: string[]; permissions: string[] } {
    const scope = alcanceDeCuenta(account.roles)
    const admins = this.dependencies.platformAdminEmails ?? []
    const email = (account.normalizedEmail ?? account.email).trim().toLowerCase()
    if (!account.emailVerifiedAt || !admins.includes(email)) return scope
    return { roles: scope.roles, permissions: [...new Set([...scope.permissions, ...PLATFORM_ADMIN_PERMISSIONS])] }
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
