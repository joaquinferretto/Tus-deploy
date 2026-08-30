import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { MfaAuditEvent, MfaChallenge, MfaEnrollment, MfaRecoveryCode } from '../domain.js'
import type {
  MfaAuditSink,
  MfaCodeVerifier,
  MfaIdGenerator,
  MfaRateLimiter,
  MfaSecretGenerator,
  MfaStore,
  MfaTokenIssuer,
} from '../ports.js'

export class InMemoryMfaStore implements MfaStore {
  readonly enrollments = new Map<string, MfaEnrollment>()
  readonly challenges = new Map<string, MfaChallenge>()
  readonly recoveryCodes = new Map<string, MfaRecoveryCode>()

  async saveEnrollment(enrollment: MfaEnrollment): Promise<void> {
    this.enrollments.set(enrollment.id, enrollment)
  }

  async findEnrollment(enrollmentId: string): Promise<MfaEnrollment | undefined> {
    return this.enrollments.get(enrollmentId)
  }

  async saveChallenge(challenge: MfaChallenge): Promise<void> {
    this.challenges.set(challenge.tokenDigest, challenge)
  }

  async findChallenge(tokenDigest: string): Promise<MfaChallenge | undefined> {
    return this.challenges.get(tokenDigest)
  }

  async saveRecoveryCode(code: MfaRecoveryCode): Promise<void> {
    this.recoveryCodes.set(code.codeDigest, code)
  }

  async findRecoveryCode(codeDigest: string): Promise<MfaRecoveryCode | undefined> {
    return this.recoveryCodes.get(codeDigest)
  }
}

export class InMemoryMfaAuditSink implements MfaAuditSink {
  readonly events: MfaAuditEvent[] = []

  async record(event: MfaAuditEvent): Promise<void> {
    this.events.push({ ...event, metadata: { ...event.metadata } })
  }
}

export class DeterministicMfaCodeVerifier implements MfaCodeVerifier {
  private readonly acceptedCode: string

  constructor(acceptedCode = '654321') {
    this.acceptedCode = acceptedCode
  }

  async verify(_secret: string, code: string, _now: number): Promise<boolean> {
    return code === this.acceptedCode
  }
}

export class RandomMfaSecretGenerator implements MfaSecretGenerator {
  next(): string {
    return randomBytes(20).toString('base64url')
  }
}

export class DeterministicMfaSecretGenerator implements MfaSecretGenerator {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `mfa-secret-${this.sequence}`
  }
}

export class OpaqueMfaTokenIssuer implements MfaTokenIssuer {
  issue(): string {
    return randomBytes(32).toString('base64url')
  }

  digest(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}

export class DeterministicMfaTokenIssuer implements MfaTokenIssuer {
  private sequence = 0

  issue(): string {
    this.sequence += 1
    return `mfa-token-${this.sequence}`
  }

  digest(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}

export class RandomMfaIdGenerator implements MfaIdGenerator {
  next(): string {
    return randomUUID()
  }
}

export class DeterministicMfaIdGenerator implements MfaIdGenerator {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `mfa-id-${this.sequence}`
  }
}

export class FixedWindowMfaRateLimiter implements MfaRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>()
  private readonly maxAttempts: number
  private readonly windowMs: number

  constructor(maxAttempts = 5, windowMs = 60_000) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
  }

  allow(key: string, now: number): boolean {
    const current = this.windows.get(key)
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 })
      return true
    }
    if (current.count >= this.maxAttempts) return false
    current.count += 1
    return true
  }
}
