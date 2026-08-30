import { MfaService } from './application/mfa-service.js'
import {
  DeterministicMfaCodeVerifier,
  DeterministicMfaIdGenerator,
  DeterministicMfaSecretGenerator,
  DeterministicMfaTokenIssuer,
  FixedWindowMfaRateLimiter,
  InMemoryMfaAuditSink,
  InMemoryMfaStore,
} from './adapters/in-memory.js'
import type { MfaStore } from './ports.js'

export interface InMemoryMfaServiceOptions {
  now?: () => number
  enrollmentCode?: string
}

export function createMfaService(options: {
  store: MfaStore
  now?: () => number
  enrollmentCode?: string
}) {
  const audit = new InMemoryMfaAuditSink()
  const service = new MfaService({
    store: options.store,
    verifier: new DeterministicMfaCodeVerifier(options.enrollmentCode),
    secretGenerator: new DeterministicMfaSecretGenerator(),
    tokens: new DeterministicMfaTokenIssuer(),
    ids: new DeterministicMfaIdGenerator(),
    rateLimiter: new FixedWindowMfaRateLimiter(),
    audit,
    now: options.now ?? (() => Date.now()),
  })
  return {
    service,
    store: options.store,
    audit,
    enroll: service.enroll.bind(service),
    confirmEnrollment: service.confirmEnrollment.bind(service),
    beginChallenge: service.beginChallenge.bind(service),
    verifyChallenge: service.verifyChallenge.bind(service),
    recoverWithCode: service.recoverWithCode.bind(service),
  }
}

export function createInMemoryMfaService(options: InMemoryMfaServiceOptions = {}) {
  return createMfaService({ store: new InMemoryMfaStore(), ...options })
}

export { MfaService } from './application/mfa-service.js'
export { InMemoryMfaStore } from './adapters/in-memory.js'
export type * from './domain.js'
export type * from './ports.js'
