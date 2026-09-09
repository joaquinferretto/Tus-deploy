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
import type { AuditSink } from './ports/security.js'

export interface InMemoryAuthServiceOptions {
  now?: () => number
}

export interface AuthServiceFactoryOptions {
  store: IdentityStore
  now?: () => number
  audit?: AuditSink
}

export function createAuthService(options: AuthServiceFactoryOptions) {
  const audit = options.audit ?? new InMemoryAuditSink()
  const email = new InMemoryEmailSender()
  const clock: Clock = options.now ? { now: options.now } : new SystemClock()
  const service = new AuthService({
    store: options.store,
    clock,
    ids: new RandomIdGenerator(),
    tokens: new OpaqueTokenIssuer(),
    passwordHasher: new ScryptPasswordHasher(),
    audit,
    email,
    recoveryRateLimiter: new FixedWindowRateLimiter(),
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
  return { ...createAuthService({ store, now: options.now }), store }
}

export function createPrismaAuthService(
  client: PrismaIdentityClient,
  options: InMemoryAuthServiceOptions = {}
) {
  const store = new PrismaIdentityStore(client)
  const audit = client.auditEvent ? new PrismaSecurityAuditSink(client) : undefined
  return { ...createAuthService({ store, now: options.now, audit }), store }
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
