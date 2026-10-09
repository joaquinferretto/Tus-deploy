import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
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
import { ACCOUNT_STATUS, AUTH_EVENT_KIND, AUTH_RESULT_CODE, CREDENTIAL_STATUS } from '../domain/constants.js'
import { cuentaVerificada, type AccountOrigin } from '../domain/models.js'
import { normalizarTelefono } from '@factory/contracts'
import { failure, type AuthFailure } from '../domain/errors.js'
import {
  GENERIC_AUTH_FAILURE_MESSAGE,
  GENERIC_RECOVERY_MESSAGE,
  OWN_ACCOUNT_FIELDS,
  hasPrivilegeMutation,
  normalizeDisplayName,
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
  // Email, or the identity phone once verified by WhatsApp (any written form: it is normalized).
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

// `mustChangePassword`: the password was set by the administration (ADMIN-CONTRASENA-TEMPORAL-01).
export type SignInResult = { ok: true; session: SessionView; mustChangePassword?: boolean } | AuthFailure

// A temporary password the administration hands over once: 16 characters from an alphabet with no
// look-alikes (no 0/O, 1/l/I), drawn with the system's secure generator. Never stored in clear.
const ALFABETO_TEMPORAL = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
export function generarContrasenaTemporal(): string {
  return Array.from({ length: 16 }, () => ALFABETO_TEMPORAL[randomInt(ALFABETO_TEMPORAL.length)]).join('')
}
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
  // Operator-chosen one-time code (TUS_ADMIN_BOOTSTRAP_CODE, >= 24 chars) that verifies an
  // allowlisted admin email without an email provider. Knowing it proves control of the server env.
  adminBootstrapCode?: string
  adminBootstrapRateLimiter?: RateLimiter
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
    if (!validateEmail(normalizedEmail) || !validatePassword(input.password) || !normalizeDisplayName(input.displayName)) {
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

  // Admin bootstrap without email delivery: an account already registered with email + password,
  // whose email is in TUS_PLATFORM_ADMIN_EMAILS, is verified with the operator's bootstrap code.
  // Same generic failure for every reason; 5 attempts per 15 min per email. MFA is still required.
  async verifyAdminWithBootstrapCode(input: { email: string; code: string }): Promise<LifecycleResult> {
    const normalizedEmail = normalizeEmail(input.email)
    const expected = (this.dependencies.adminBootstrapCode ?? '').trim()
    const deny = async (reason: string, account?: Account) => {
      await this.record(account, AUTH_EVENT_KIND.ACCOUNT_VERIFIED, 'denied', reason)
      return failure(AUTH_RESULT_CODE.INVALID_TOKEN, 'Invalid bootstrap request')
    }
    if (expected.length < 24) return deny('bootstrap_disabled')
    const limiter = this.dependencies.adminBootstrapRateLimiter
    if (limiter && !(await limiter.allow(normalizedEmail, this.dependencies.clock.now()))) return deny('rate_limited')
    const given = createHash('sha256').update(input.code.trim()).digest()
    const matches = timingSafeEqual(given, createHash('sha256').update(expected).digest())
    const account = await this.dependencies.store.findAccountByEmail(normalizedEmail)
    const allowlisted = (this.dependencies.platformAdminEmails ?? []).includes(normalizedEmail)
    if (!matches || !allowlisted || !account || account.status !== 'active') return deny('bootstrap_rejected', account)
    if (!(await this.dependencies.store.findPasswordCredential(account.id))) return deny('bootstrap_requires_password', account)
    if (!account.emailVerifiedAt) {
      const now = this.dependencies.clock.now()
      account.emailVerifiedAt = now
      account.updatedAt = now
      await this.dependencies.store.saveAccount(account)
    }
    await this.record(account, AUTH_EVENT_KIND.ACCOUNT_VERIFIED, 'success', 'admin_bootstrap_code')
    return { ok: true }
  }

  // Provider loaded by a platform admin (offline onboarding, tests): an account WITHOUT password
  // and with the email unverified, so nobody can sign in with it; it only owns a directory profile.
  async createManagedProviderAccount(input: { email: string; displayName: string }): Promise<{ ok: true; accountId: string; tenantId: string } | AuthFailure> {
    const normalizedEmail = normalizeEmail(input.email)
    const displayName = input.displayName.trim().slice(0, 120)
    if (!validateEmail(normalizedEmail) || !displayName) return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Invalid provider account')
    return this.runTransaction(async (store) => {
      if (await store.findAccountByEmail(normalizedEmail)) return failure(AUTH_RESULT_CODE.CONFLICT, 'Account already exists')
      const now = this.dependencies.clock.now()
      const account: Account = {
        id: this.dependencies.ids.next(),
        email: normalizedEmail,
        normalizedEmail,
        displayName,
        tenantId: this.dependencies.ids.next(),
        roles: ['owner'],
        status: 'active',
        emailVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
        origin: 'admin',
      }
      await store.saveAccount(account, { bootstrapTenant: true })
      await this.record(account, AUTH_EVENT_KIND.ACCOUNT_REGISTERED, 'success', 'managed_provider_account_created')
      return { ok: true, accountId: account.id, tenantId: account.tenantId }
    })
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

  private async registerWithinStore(input: RegisterInput, store: IdentityStore, origin: AccountOrigin = 'self'): Promise<RegisterResult> {
    const normalizedEmail = normalizeEmail(input.email)
    if (await store.findAccountByEmail(normalizedEmail)) {
      throw new Error('Account already exists')
    }

    const now = this.dependencies.clock.now()
    const account: Account = {
      id: this.dependencies.ids.next(),
      email: input.email.trim(),
      normalizedEmail,
      displayName: normalizeDisplayName(input.displayName) ?? input.displayName.trim(),
      tenantId: this.dependencies.ids.next(),
      roles: ['owner'],
      status: 'active',
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
      origin,
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
    if (limiter && !(await limiter.allow(this.signInKey(input.email), this.dependencies.clock.now()))) {
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
      if (!current || current.revokedAt !== null || current.expiresAt <= now || !account || account.status !== 'active' || !cuentaVerificada(account)) {
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

  // "a@b.com" is an email; anything without "@" that normalizes as a phone is a phone. One key per
  // identity for the attempt limiter, whatever the written form.
  private signInKey(identifier: string): string {
    if (identifier.includes('@')) return normalizeEmail(identifier)
    const phone = normalizarTelefono(identifier)
    return phone.ok ? `phone:${phone.e164}` : normalizeEmail(identifier)
  }

  private async findSignInAccount(identifier: string, store: IdentityStore): Promise<Account | undefined> {
    if (identifier.includes('@') || !store.findAccountIdByPhone) return store.findAccountByEmail(normalizeEmail(identifier))
    const phone = normalizarTelefono(identifier)
    if (!phone.ok) return undefined
    const accountId = await store.findAccountIdByPhone(phone.e164)
    return accountId ? store.getAccount(accountId) : undefined
  }

  private async signInWithinStore(input: SignInInput, store: IdentityStore): Promise<SignInResult> {
    const account = await this.findSignInAccount(input.email, store)
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
      // Verified by email OR by the phone (WhatsApp): phone-first accounts can sign in.
      !cuentaVerificada(account) ||
      !passwordMatches
    ) {
      await this.record(account, AUTH_EVENT_KIND.AUTH_FAILED, 'denied', 'invalid_credentials')
      return failure(AUTH_RESULT_CODE.INVALID_CREDENTIALS, GENERIC_AUTH_FAILURE_MESSAGE)
    }

    const now = this.dependencies.clock.now()
    credential.lastUsedAt = now
    credential.updatedAt = now
    await store.saveCredential(credential)
    const emitida = await this.issueSession(store, account, input.device, 'credential_verified', { platformAdmin: true })
    // ADMIN-CONTRASENA-TEMPORAL-01: the session exists, but every router of TUS refuses it until
    // the person chooses its own password (the resolver decides; this only tells the client).
    return emitida.ok && account.mustChangePassword === true ? { ...emitida, mustChangePassword: true } : emitida
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

  // Password recovery proved through WhatsApp (phone module): the same single-use recovery token
  // as the email flow, completed by completePasswordRecovery (sessions revoked, MFA kept).
  async issueRecoveryTokenForAccount(accountId: string): Promise<string> {
    return this.runTransaction(async (store) => {
      const account = await store.getAccount(accountId)
      if (!account || account.status !== 'active') throw new Error('Account not allowed')
      const recoveryToken = this.dependencies.tokens.issue()
      await store.saveRecoveryToken({
        id: this.dependencies.ids.next(),
        accountId: account.id,
        tokenDigest: this.dependencies.tokens.digest(recoveryToken),
        expiresAt: this.dependencies.clock.now() + RECOVERY_TTL_MS,
        consumedAt: null,
      })
      await this.record(account, AUTH_EVENT_KIND.RECOVERY_REQUESTED, 'accepted', 'phone_verified')
      return recoveryToken
    })
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
    if (account.mustChangePassword === true) {
      account.mustChangePassword = false
      account.updatedAt = now
      await store.saveAccount(account)
    }
    await store.revokeSessions(account.id, now)
    await this.record(account, AUTH_EVENT_KIND.RECOVERY_COMPLETED, 'success', 'credential_reset')
    return { ok: true, accountId: account.id }
  }

  // Re-authentication for sensitive actions (e.g. turning MFA off): 'ok' only when the current
  // password matches an active password credential. Constant work when there is none.
  // A registered account that never verified (neither email nor phone) proves it is its owner
  // with the password to restart the phone verification. Same limiter, timing and generic
  // failure as sign-in: it reveals nothing that sign-in does not.
  async accountPendingVerification(identifier: string, password: string): Promise<{ id: string } | null> {
    const limiter = this.dependencies.signInRateLimiter
    if (limiter && !(await limiter.allow(this.signInKey(identifier), this.dependencies.clock.now()))) return null
    const store = this.dependencies.store
    const account = await this.findSignInAccount(identifier, store)
    const credential = account ? await store.findPasswordCredential(account.id) : undefined
    const matches = await this.dependencies.passwordHasher.verify(password, credential?.status === CREDENTIAL_STATUS.ACTIVE ? credential.passwordHash : this.dependencies.passwordHasher.dummyHash)
    if (!account || !credential || credential.status !== CREDENTIAL_STATUS.ACTIVE || account.status !== 'active' || cuentaVerificada(account) || !matches) return null
    return { id: account.id }
  }

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
    // The person chose its own password: the temporary one of the administration is over.
    if (account.mustChangePassword === true) {
      account.mustChangePassword = false
      account.updatedAt = now
      await store.saveAccount(account)
    }
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

  // Account created by a platform admin from the Users panel. Unlike public sign-up (which answers
  // the same for new and existing emails and never reveals them), an existing email is an explicit
  // CONFLICT here: the admin is authorized to know it, and nothing is sent to the existing owner.
  // Always a client account: provider and admin authority have their own flows.
  async createAccountAsAdmin(input: RegisterInput & { actorId: string }): Promise<{ ok: true; account: SafeAccount } | AuthFailure> {
    const normalizedEmail = normalizeEmail(input.email)
    if (!validateEmail(normalizedEmail) || !validatePassword(input.password) || input.displayName.trim().length < 2 || input.displayName.trim().length > 120)
      return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Invalid account data')
    if (await this.dependencies.store.findAccountByEmail(normalizedEmail))
      return failure(AUTH_RESULT_CODE.CONFLICT, 'Email already registered')
    if (await this.passwordIsBreached(input.password)) return failure(AUTH_RESULT_CODE.PASSWORD_BREACHED, 'Password appears in known data breaches')
    let created: RegisterResult
    try {
      created = await this.runTransaction((store) => this.registerWithinStore(input, store, 'admin'))
    } catch (error) {
      // Two concurrent creations of the same email: the second one loses on the unique email.
      if (error instanceof Error && (error.message === 'Account already exists' || (error as Error & { code?: unknown }).code === 'P2002'))
        return failure(AUTH_RESULT_CODE.CONFLICT, 'Email already registered')
      throw error
    }
    await this.recordAdminAction(input.actorId, created.account, AUTH_EVENT_KIND.ACCOUNT_ADMIN_CREATED, { action: 'created', changedFields: 'email,displayName,password' })
    await this.deliver(created.account.id, created.account.tenantId, () =>
      this.dependencies.email.sendVerification({ email: created.account.email, token: created.verificationToken })
    )
    return { ok: true, account: created.account }
  }

  // ADMIN-CONTRASENA-TEMPORAL-01. The administration sets a TEMPORARY password on an account IT
  // created (origin 'admin'), so that person can enter its own account. With the canonical hasher
  // of the sign-in; every session of the account is closed; the person must choose its own
  // password at its first sign-in. The same account: nothing of its business data is touched and
  // no account is created. An account a person registered by itself is NOT reachable here (its
  // owner uses the recovery email): this is never a way to take somebody's account over. The
  // password and its hash never reach the audit, a log or an answer (the generated one is handed
  // back ONCE to the administrator, to give it to the person).
  async setTemporaryPasswordAsAdmin(input: { actorId: string; accountId: string; password?: unknown; generate?: unknown; reason: unknown }): Promise<{ ok: true; generatedPassword: string | null } | AuthFailure> {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
    if (reason.length < 5 || reason.length > 300) return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'REASON_REQUIRED')
    const generar = input.generate === true
    const password = generar ? generarContrasenaTemporal() : typeof input.password === 'string' ? input.password : ''
    if (!validatePassword(password)) return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Password does not meet policy')
    const account = await this.dependencies.store.getAccount(input.accountId)
    if (!account) return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Account not found')
    if (input.actorId === account.id) return failure(AUTH_RESULT_CODE.FORBIDDEN, 'Use the security page for the current account')
    if (account.origin !== 'admin') return failure(AUTH_RESULT_CODE.FORBIDDEN, 'NOT_ADMIN_CREATED')
    if (this.isPlatformAdminEmail(account.normalizedEmail ?? account.email)) return failure(AUTH_RESULT_CODE.FORBIDDEN, 'A platform administrator sets its own password')
    if (!generar && (await this.passwordIsBreached(password))) return failure(AUTH_RESULT_CODE.PASSWORD_BREACHED, 'Password appears in known data breaches')
    const passwordHash = await this.dependencies.passwordHasher.hash(password)
    await this.runTransaction(async (store) => {
      const now = this.dependencies.clock.now()
      const actual = await store.getAccount(account.id)
      if (!actual) return
      const existente = await store.findPasswordCredential(actual.id)
      await store.saveCredential(existente
        ? { ...existente, passwordHash, status: CREDENTIAL_STATUS.ACTIVE, updatedAt: now }
        : { id: this.dependencies.ids.next(), accountId: actual.id, passwordHash, status: CREDENTIAL_STATUS.ACTIVE, createdAt: now, updatedAt: now, lastUsedAt: null })
      actual.mustChangePassword = true
      actual.updatedAt = now
      await store.saveAccount(actual)
      await store.revokeSessions(actual.id, now)
    })
    await this.recordAdminAction(input.actorId, account, AUTH_EVENT_KIND.ACCOUNT_ADMIN_UPDATED, { action: 'temporary_password_set', changedFields: 'password', reason, sessionsRevoked: true, mustChangePassword: true, generated: generar })
    return { ok: true, generatedPassword: generar ? password : null }
  }

  // Admin detail of one account: business fields only (never a hash, token or MFA secret).
  async getAccountAsAdmin(accountId: string): Promise<(SafeAccount & { hasPassword: boolean; createdAt: number; updatedAt: number; platformAdmin: boolean; phoneNumber: string | null; origin: AccountOrigin; mustChangePassword: boolean; phoneVerifiedAt: number | null; phonePending: string | null }) | null> {
    const account = await this.dependencies.store.getAccount(accountId)
    if (!account) return null
    const credential = await this.dependencies.store.findPasswordCredential(account.id)
    return {
      ...this.safeAccount(account),
      hasPassword: Boolean(credential && credential.status === 'active'),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      platformAdmin: this.isPlatformAdminEmail(account.normalizedEmail ?? account.email),
      phoneNumber: account.phoneNumber ?? null,
      phoneVerifiedAt: account.phoneVerifiedAt ?? null,
      phonePending: account.phonePending ?? null,
      origin: account.origin ?? 'self',
      mustChangePassword: account.mustChangePassword === true,
    }
  }

  private isPlatformAdminEmail(email: string): boolean {
    return (this.dependencies.platformAdminEmails ?? []).map((item) => item.trim().toLowerCase()).includes(email.trim().toLowerCase())
  }

  // Admin edition of an account. Platform admin authority is the environment allowlist, so an
  // admin can never create it from here: an allowlisted account's email/verification is not
  // editable, and no account may receive an allowlisted email. Changing the email resets its
  // verification and revokes the sessions. Every change is audited without personal data.
  async updateAccountAsAdmin(input: {
    actorId: string
    accountId: string
    displayName?: unknown
    status?: unknown
    reason?: unknown
    email?: unknown
    emailVerified?: unknown
  }): Promise<AccountUpdateResult> {
    return this.runTransaction(async (store) => {
      const account = await store.getAccount(input.accountId)
      if (!account) return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Account not found')
      const displayName = input.displayName
      const status = input.status
      if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 120))
        return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Display name is invalid')
      if (status !== undefined && status !== ACCOUNT_STATUS.ACTIVE && status !== ACCOUNT_STATUS.SUSPENDED)
        return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Account status is invalid')
      if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.trim().length > 200))
        return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Reason is invalid')
      if (input.emailVerified !== undefined && typeof input.emailVerified !== 'boolean')
        return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Email verification is invalid')
      if (input.actorId === account.id && status === ACCOUNT_STATUS.SUSPENDED)
        return failure(AUTH_RESULT_CODE.FORBIDDEN, 'An administrator cannot suspend the current account')
      const currentEmail = account.normalizedEmail ?? normalizeEmail(account.email)
      let nextEmail: string | null = null
      if (input.email !== undefined) {
        if (typeof input.email !== 'string') return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Email is invalid')
        const normalized = normalizeEmail(input.email)
        if (!validateEmail(normalized)) return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Email is invalid')
        if (normalized !== currentEmail) nextEmail = normalized
      }
      const touchesIdentity = nextEmail !== null || input.emailVerified !== undefined
      // No privilege escalation: never an allowlisted email, never the admin's own identity.
      if (touchesIdentity && (input.actorId === account.id || this.isPlatformAdminEmail(currentEmail) || (nextEmail !== null && this.isPlatformAdminEmail(nextEmail))))
        return failure(AUTH_RESULT_CODE.FORBIDDEN, 'Platform administrator identities are managed by configuration')
      if (nextEmail !== null) {
        const owner = await store.findAccountByEmail(nextEmail)
        if (owner && owner.id !== account.id) return failure(AUTH_RESULT_CODE.CONFLICT, 'Email already registered')
      }
      const verifiedChange = nextEmail === null && typeof input.emailVerified === 'boolean' && input.emailVerified !== Boolean(account.emailVerifiedAt)
      const changedFields = [
        ...(typeof displayName === 'string' && displayName.trim() !== account.displayName ? ['displayName'] : []),
        ...(status !== undefined && status !== account.status ? ['status'] : []),
        ...(nextEmail !== null ? ['email', 'emailVerified'] : []),
        ...(verifiedChange ? ['emailVerified'] : []),
      ]
      const previousStatus = account.status
      if (typeof displayName === 'string') account.displayName = displayName.trim()
      if (status === ACCOUNT_STATUS.ACTIVE || status === ACCOUNT_STATUS.SUSPENDED) account.status = status
      account.updatedAt = this.dependencies.clock.now()
      if (nextEmail !== null) {
        account.email = nextEmail
        account.normalizedEmail = nextEmail
        account.emailVerifiedAt = null
      } else if (verifiedChange) {
        account.emailVerifiedAt = input.emailVerified === true ? account.updatedAt : null
      }
      try {
        await store.saveAccount(account)
      } catch (error) {
        // Two admins giving the same email at once: the unique email decides.
        if ((error as Error & { code?: unknown }).code === 'P2002') return failure(AUTH_RESULT_CODE.CONFLICT, 'Email already registered')
        throw error
      }
      const revoke = status === ACCOUNT_STATUS.SUSPENDED || nextEmail !== null
      if (revoke) await store.revokeSessions(account.id, account.updatedAt)
      const kind = previousStatus !== ACCOUNT_STATUS.SUSPENDED && account.status === ACCOUNT_STATUS.SUSPENDED
        ? AUTH_EVENT_KIND.ACCOUNT_ADMIN_SUSPENDED
        : previousStatus === ACCOUNT_STATUS.SUSPENDED && account.status === ACCOUNT_STATUS.ACTIVE
          ? AUTH_EVENT_KIND.ACCOUNT_ADMIN_REACTIVATED
          : AUTH_EVENT_KIND.ACCOUNT_ADMIN_UPDATED
      const action = kind === AUTH_EVENT_KIND.ACCOUNT_ADMIN_SUSPENDED ? 'suspended' : kind === AUTH_EVENT_KIND.ACCOUNT_ADMIN_REACTIVATED ? 'reactivated' : 'updated'
      await this.recordAdminAction(input.actorId, account, kind, {
        action,
        changedFields: changedFields.join(',') || 'none',
        ...(typeof input.reason === 'string' && input.reason.trim() ? { reason: input.reason.trim() } : {}),
        ...(revoke ? { sessionsRevoked: true } : {}),
        ...(nextEmail !== null ? { emailChanged: true } : {}),
        ...(verifiedChange ? { emailVerified: input.emailVerified === true } : {}),
      })
      return { ok: true, account: this.safeAccount(account) }
    })
  }

  // Safe admin actions instead of editing secrets: close every session, or close them and send
  // the owner a password recovery email (the admin never sees or sets the password).
  async adminAccountAction(input: { actorId: string; accountId: string; action: unknown }): Promise<{ ok: true } | AuthFailure> {
    if (input.action !== 'revoke_sessions' && input.action !== 'password_reset') return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Unknown action')
    const account = await this.dependencies.store.getAccount(input.accountId)
    if (!account) return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Account not found')
    if (input.actorId === account.id) return failure(AUTH_RESULT_CODE.FORBIDDEN, 'Use the security page for the current account')
    const now = this.dependencies.clock.now()
    await this.runTransaction((store) => store.revokeSessions(account.id, now))
    let resetSent = false
    if (input.action === 'password_reset' && account.status === ACCOUNT_STATUS.ACTIVE) {
      const result = await this.requestPasswordRecovery({ email: account.email })
      resetSent = Boolean(result.recoveryToken)
    }
    await this.recordAdminAction(input.actorId, account, AUTH_EVENT_KIND.ACCOUNT_ADMIN_UPDATED, {
      action: input.action === 'password_reset' ? 'password_reset_requested' : 'sessions_revoked',
      changedFields: 'none',
      sessionsRevoked: true,
      ...(input.action === 'password_reset' ? { recoveryEmailSent: resetSent } : {}),
    })
    return { ok: true }
  }

  // Existing audit sink (AuditEvent), with the ADMIN as actor and the modified account as target.
  // Never the email, name or any secret in the metadata.
  // An administrator loaded or corrected the identity (names, document) of an account. The change
  // itself is made by the profile service; this is its audit trail, with the other admin actions.
  // `details` carries field names and masked values only.
  async recordAdminIdentityChange(input: { actorId: string; accountId: string; details: Record<string, string | boolean> }): Promise<boolean> {
    const account = await this.dependencies.store.getAccount(input.accountId)
    if (!account) return false
    await this.recordAdminAction(input.actorId, account, AUTH_EVENT_KIND.ACCOUNT_ADMIN_IDENTITY_UPDATED, { action: 'identity_updated', ...input.details })
    return true
  }

  private async recordAdminAction(
    actorId: string,
    target: { id: string; tenantId: string },
    kind: SecurityEvent['kind'],
    details: Record<string, string | boolean>
  ): Promise<void> {
    await this.dependencies.audit.record({
      contractVersion: CONTRACT_VERSION,
      kind,
      occurredAt: new Date(this.dependencies.clock.now()).toISOString(),
      actorId,
      tenantId: target.tenantId,
      outcome: 'success',
      correlationId: this.dependencies.ids.next(),
      metadata: { actorType: 'platform_admin', targetType: 'account', targetAccountId: target.id, ...details },
    })
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
    // A closed form: a field that is not one of the account's own is refused, never ignored.
    if (Object.keys(input.changes).some((key) => !(OWN_ACCOUNT_FIELDS as readonly string[]).includes(key)))
      return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Unknown account field')
    const displayName = input.changes['displayName']
    const normalizedName = displayName === undefined ? undefined : normalizeDisplayName(displayName)
    if (normalizedName === null) return failure(AUTH_RESULT_CODE.VALIDATION_FAILED, 'Display name is invalid')
    if (normalizedName !== undefined) account.displayName = normalizedName
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
