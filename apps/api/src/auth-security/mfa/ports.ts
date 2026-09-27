import type {
  MfaAuditEvent,
  MfaChallenge,
  MfaEnrollment,
  MfaEnrollmentStatus,
  MfaRecoveryCode,
  MfaSessionElevation,
} from './domain.js'

export interface MfaStore {
  saveEnrollment(enrollment: MfaEnrollment): Promise<void>
  findEnrollment(enrollmentId: string): Promise<MfaEnrollment | undefined>
  findEnrollmentForAccount(accountId: string, status: MfaEnrollmentStatus): Promise<MfaEnrollment | undefined>
  saveChallenge(challenge: MfaChallenge): Promise<void>
  findChallenge(tokenDigest: string): Promise<MfaChallenge | undefined>
  saveRecoveryCode(code: MfaRecoveryCode): Promise<void>
  findRecoveryCode(codeDigest: string): Promise<MfaRecoveryCode | undefined>
  invalidateRecoveryCodes(accountId: string, at: number): Promise<void>
  saveElevation(elevation: MfaSessionElevation): Promise<void>
  findElevation(sessionId: string): Promise<MfaSessionElevation | undefined>
  revokeElevations(accountId: string, at: number): Promise<void>
}

export interface MfaCodeVerifier {
  verify(secret: string, code: string, now: number): Promise<boolean>
  // Time-based verifiers return the matched step so the service can reject a replayed code.
  matchStep?(secret: string, code: string, now: number): Promise<number | null>
}

export interface MfaSecretGenerator {
  next(): string
}

export interface MfaRecoveryCodeGenerator {
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
  record(event: MfaAuditEvent): Promise<void>
}
