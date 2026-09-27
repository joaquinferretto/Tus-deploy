import { AuthService } from './application/auth-service.js'
import {
  InMemoryAuditSink,
  InMemoryEmailSender,
  FixedWindowRateLimiter,
} from './adapters/in-memory-auxiliaries.js'
import { InMemoryIdentityStore } from './adapters/in-memory-identity-store.js'
import {
  PrismaIdentityStore,
  PrismaSecurityAuditSink,
  type PrismaIdentityClient,
} from './adapters/postgres/prisma-identity-store.js'
import {
  OpaqueTokenIssuer,
  RandomIdGenerator,
  ScryptPasswordHasher,
} from './adapters/crypto-security.js'
import { SystemClock } from './adapters/system.js'
import type { Clock } from './ports/clock.js'
import type { IdentityStore } from './ports/identity-store.js'
import type { AuditSink, EmailSender, PasswordBreachChecker, RateLimiter } from './ports/security.js'
import { PostgresRateLimiter, type RawQueryClient } from './adapters/postgres/postgres-rate-limiter.js'
import { createEmailSenderFromEnv } from './adapters/email/email-senders.js'
import { PwnedPasswordsChecker } from './adapters/pwned-passwords.js'

export interface InMemoryAuthServiceOptions {
  now?: () => number
  platformAdminEmails?: readonly string[]
  // Production environment (email provider, durable limits, breach check). Tests omit it.
  env?: Record<string, string | undefined>
}

export interface AuthServiceFactoryOptions {
  store: IdentityStore
  now?: () => number
  audit?: AuditSink
  platformAdminEmails?: readonly string[]
  email?: EmailSender
  recoveryRateLimiter?: RateLimiter
  signInRateLimiter?: RateLimiter
  verificationResendRateLimiter?: RateLimiter
  verificationResendCooldown?: RateLimiter
  passwordBreachChecker?: PasswordBreachChecker
}

export function createAuthService(options: AuthServiceFactoryOptions) {
  const audit = options.audit ?? new InMemoryAuditSink()
  const email = options.email ?? new InMemoryEmailSender()
  const clock: Clock = options.now ? { now: options.now } : new SystemClock()
  const service = new AuthService({
    store: options.store,
    clock,
    ids: new RandomIdGenerator(),
    tokens: new OpaqueTokenIssuer(),
    passwordHasher: new ScryptPasswordHasher(),
    audit,
    email,
    recoveryRateLimiter: options.recoveryRateLimiter ?? new FixedWindowRateLimiter(),
    ...(options.platformAdminEmails ? { platformAdminEmails: options.platformAdminEmails } : {}),
    ...(options.signInRateLimiter ? { signInRateLimiter: options.signInRateLimiter } : {}),
    ...(options.verificationResendRateLimiter ? { verificationResendRateLimiter: options.verificationResendRateLimiter } : {}),
    ...(options.verificationResendCooldown ? { verificationResendCooldown: options.verificationResendCooldown } : {}),
    ...(options.passwordBreachChecker ? { passwordBreachChecker: options.passwordBreachChecker } : {}),
  })

  return {
    service,
    audit,
    email,
    register: service.register.bind(service),
    signIn: service.signIn.bind(service),
    signOut: service.signOut.bind(service),
    verifyEmail: service.verifyEmail.bind(service),
    requestPasswordRecovery: service.requestPasswordRecovery.bind(service),
    completePasswordRecovery: service.completePasswordRecovery.bind(service),
    changePassword: service.changePassword.bind(service),
    disableCredential: service.disableCredential.bind(service),
    updateAccount: service.updateAccount.bind(service),
  }
}

export function createInMemoryAuthService(options: InMemoryAuthServiceOptions = {}) {
  const store = new InMemoryIdentityStore()
  return { ...createAuthService({ store, now: options.now, platformAdminEmails: options.platformAdminEmails }), store }
}

export function createPrismaAuthService(
  client: PrismaIdentityClient,
  options: InMemoryAuthServiceOptions = {}
) {
  const store = new PrismaIdentityStore(client)
  const audit = client.auditEvent ? new PrismaSecurityAuditSink(client) : undefined
  const env = options.env ?? {}
  // Durable per-email limits (auth_rate_limits) when the client can run raw SQL.
  const raw = (client as unknown as Partial<RawQueryClient>).$queryRawUnsafe ? (client as unknown as RawQueryClient) : null
  const durable = (scope: string, max: number, windowMs: number) => (raw ? new PostgresRateLimiter(raw, scope, max, windowMs) : undefined)
  const email = options.env ? createEmailSenderFromEnv(env) : undefined
  return {
    ...createAuthService({
      store,
      now: options.now,
      audit,
      platformAdminEmails: options.platformAdminEmails,
      ...(email ? { email: email.sender } : {}),
      ...(options.env
        ? {
            recoveryRateLimiter: durable('recovery', 5, 15 * 60_000),
            signInRateLimiter: durable('sign-in', 10, 15 * 60_000),
            verificationResendRateLimiter: durable('verify-resend', 5, 60 * 60_000),
            verificationResendCooldown: durable('verify-resend-gap', 1, 60_000),
            // Pwned Passwords k-anonymity check; TUS_PWNED_PASSWORDS=disabled turns it off.
            ...(env['TUS_PWNED_PASSWORDS'] === 'disabled' ? {} : { passwordBreachChecker: new PwnedPasswordsChecker() }),
          }
        : {}),
    }),
    store,
    emailProvider: email?.provider ?? 'in-memory',
  }
}

export { AuthService } from './application/auth-service.js'
export { InMemoryIdentityStore } from './adapters/in-memory-identity-store.js'
export { PrismaIdentityStore } from './adapters/postgres/prisma-identity-store.js'
export { PrismaSecurityAuditSink } from './adapters/postgres/prisma-identity-store.js'
export {
  InMemoryAuditSink,
  InMemoryEmailSender,
  FixedWindowRateLimiter,
} from './adapters/in-memory-auxiliaries.js'
export {
  OpaqueTokenIssuer,
  RandomIdGenerator,
  ScryptPasswordHasher,
} from './adapters/crypto-security.js'
export type * from './domain/models.js'
export type * from './ports/clock.js'
export type * from './ports/identity-store.js'
export type * from './ports/security.js'

export { createInMemoryMfaService } from './mfa/composition.js'
export { createInMemoryPasskeyService } from './passkeys/composition.js'
export { createInMemoryOAuthOidcService } from './oauth-oidc/composition.js'
export { createInMemoryAccountLinkingService } from './account-linking/composition.js'
