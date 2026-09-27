import { randomUUID } from 'node:crypto'
import { MfaService } from './application/mfa-service.js'
import {
  DeterministicMfaCodeVerifier,
  DeterministicMfaIdGenerator,
  DeterministicMfaSecretGenerator,
  DeterministicMfaTokenIssuer,
  FixedWindowMfaRateLimiter,
  InMemoryMfaAuditSink,
  InMemoryMfaStore,
  OpaqueMfaTokenIssuer,
  RandomMfaIdGenerator,
} from './adapters/in-memory.js'
import { RandomRecoveryCodeGenerator, TotpCodeVerifier, TotpSecretGenerator } from './adapters/totp.js'
import { createMfaSecretCipher, PrismaMfaStore, type PrismaMfaClient } from './adapters/prisma-mfa-store.js'
import type { MfaAuditEvent } from './domain.js'
import type { MfaAuditSink, MfaStore } from './ports.js'

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

// Real second factor: RFC 6238 TOTP, 160-bit random secrets, random single-use recovery codes,
// opaque challenge tokens and 5 attempts per 15 minutes per account and operation (a 6-digit
// code cannot be brute-forced behind the password).
export function createTotpMfaService(options: { store: MfaStore; audit: MfaAuditSink; now?: () => number }): MfaService {
  return new MfaService({
    store: options.store,
    verifier: new TotpCodeVerifier(),
    secretGenerator: new TotpSecretGenerator(),
    recoveryCodes: new RandomRecoveryCodeGenerator(),
    tokens: new OpaqueMfaTokenIssuer(),
    ids: new RandomMfaIdGenerator(),
    rateLimiter: new FixedWindowMfaRateLimiter(5, 15 * 60_000),
    audit: options.audit,
    now: options.now ?? (() => Date.now()),
  })
}

interface AuditEventClient {
  auditEvent?: { create(args: { data: Record<string, unknown> }): Promise<unknown> }
}

// MFA events go to the same security audit table as the rest of authentication. They never
// contain codes or secrets (only the operation, outcome and reason).
export class PrismaMfaAuditSink implements MfaAuditSink {
  constructor(private readonly client: AuditEventClient) {}

  async record(event: MfaAuditEvent): Promise<void> {
    await this.client.auditEvent?.create({
      data: {
        id: randomUUID(),
        tenantId: 'tus-platform',
        actorId: event.accountId === 'unknown' ? null : event.accountId,
        correlationId: randomUUID(),
        eventType: event.kind,
        outcome: event.outcome,
        metadata: event.metadata,
        occurredAt: new Date(event.occurredAt),
      },
    })
  }
}

// null without a valid TUS_MFA_ENCRYPTION_KEY: MFA is unavailable and admin stays closed.
export function createPrismaMfaService(client: PrismaMfaClient & AuditEventClient, env: Record<string, string | undefined>): MfaService | null {
  const cipher = createMfaSecretCipher(env['TUS_MFA_ENCRYPTION_KEY'])
  if (!cipher) return null
  return createTotpMfaService({ store: new PrismaMfaStore(client, cipher), audit: new PrismaMfaAuditSink(client) })
}

export { MfaService } from './application/mfa-service.js'
export { InMemoryMfaStore } from './adapters/in-memory.js'
export type * from './domain.js'
export type * from './ports.js'
