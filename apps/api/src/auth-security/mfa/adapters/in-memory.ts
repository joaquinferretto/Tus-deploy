import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { MfaAuditEvent, MfaChallenge, MfaEnrollment, MfaEnrollmentStatus, MfaRecoveryCode, MfaSessionElevation } from '../domain.js'
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
  readonly elevations = new Map<string, MfaSessionElevation>()

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

  async findEnrollmentForAccount(accountId: string, status: MfaEnrollmentStatus): Promise<MfaEnrollment | undefined> {
    return [...this.enrollments.values()].reverse().find((item) => item.accountId === accountId && item.status === status)
  }

  async invalidateRecoveryCodes(accountId: string, at: number): Promise<void> {
    for (const code of this.recoveryCodes.values()) if (code.accountId === accountId && !code.invalidatedAt) code.invalidatedAt = at
  }

  async saveElevation(elevation: MfaSessionElevation): Promise<void> {
    this.elevations.set(elevation.sessionId, { ...elevation })
  }

  async findElevation(sessionId: string): Promise<MfaSessionElevation | undefined> {
    const elevation = this.elevations.get(sessionId)
    return elevation ? { ...elevation } : undefined
  }

  async revokeElevations(accountId: string, at: number): Promise<void> {
    for (const elevation of this.elevations.values()) if (elevation.accountId === accountId && elevation.revokedAt === null) elevation.revokedAt = at
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
