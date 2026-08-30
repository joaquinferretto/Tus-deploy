import type { MfaAuditEvent, MfaChallenge, MfaEnrollment, MfaRecoveryCode } from './domain.js'

export interface MfaStore {
  readonly enrollments: Map<string, MfaEnrollment>
  readonly challenges: Map<string, MfaChallenge>
  readonly recoveryCodes: Map<string, MfaRecoveryCode>
  saveEnrollment(enrollment: MfaEnrollment): Promise<void>
  findEnrollment(enrollmentId: string): Promise<MfaEnrollment | undefined>
  saveChallenge(challenge: MfaChallenge): Promise<void>
  findChallenge(tokenDigest: string): Promise<MfaChallenge | undefined>
  saveRecoveryCode(code: MfaRecoveryCode): Promise<void>
  findRecoveryCode(codeDigest: string): Promise<MfaRecoveryCode | undefined>
}

export interface MfaCodeVerifier {
  verify(secret: string, code: string, now: number): Promise<boolean>
}

export interface MfaSecretGenerator {
  next(): string
}

export interface MfaTokenIssuer {
  issue(): string
  digest(value: string): string
}

export interface MfaIdGenerator {
  next(): string
}

export interface MfaRateLimiter {
  allow(key: string, now: number): boolean
}

export interface MfaAuditSink {
  readonly events: MfaAuditEvent[]
  record(event: MfaAuditEvent): Promise<void>
}
