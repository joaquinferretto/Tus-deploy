import {
  isAuthenticatedSubject,
  MFA_ENROLLMENT_STATUS,
  MFA_RESULT_CODE,
  type AuthenticatedSubject,
  type MfaEnrollment,
  type MfaFailure,
  type MfaResultCode,
} from '../domain.js'
import type {
  MfaAuditSink,
  MfaCodeVerifier,
  MfaIdGenerator,
  MfaRateLimiter,
  MfaSecretGenerator,
  MfaStore,
  MfaTokenIssuer,
} from '../ports.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const RECOVERY_CODE_COUNT = 8

export interface MfaServiceDependencies {
  store: MfaStore
  verifier: MfaCodeVerifier
  secretGenerator: MfaSecretGenerator
  tokens: MfaTokenIssuer
  ids: MfaIdGenerator
  rateLimiter: MfaRateLimiter
  audit: MfaAuditSink
  now: () => number
}

export type MfaLifecycleResult = { ok: true } | MfaFailure

export type MfaEnrollmentResult = { ok: true; enrollmentId: string; secret: string } | MfaFailure

export type MfaConfirmationResult = { ok: true; recoveryCodes: string[] } | MfaFailure

export type MfaChallengeResult = { ok: true; challenge: string; expiresAt: number } | MfaFailure

export class MfaService {
  private readonly dependencies: MfaServiceDependencies

  constructor(dependencies: MfaServiceDependencies) {
    this.dependencies = dependencies
  }

  async enroll(input: {
    accountId: string
    subject: AuthenticatedSubject | undefined
    label: string
  }): Promise<MfaEnrollmentResult> {
    if (!isAuthenticatedSubject(input.subject, input.accountId)) {
      return this.fail(
        input.accountId,
        MFA_RESULT_CODE.FORBIDDEN,
        'MFA enrollment is not permitted'
      )
    }
    if (!input.label.trim()) {
      return this.fail(input.accountId, MFA_RESULT_CODE.VALIDATION_FAILED, 'MFA label is invalid')
    }
    const enrollment: MfaEnrollment = {
      id: this.dependencies.ids.next(),
      accountId: input.accountId,
      label: input.label.trim(),
      secret: this.dependencies.secretGenerator.next(),
      status: MFA_ENROLLMENT_STATUS.PENDING,
      createdAt: this.dependencies.now(),
      confirmedAt: null,
    }
    await this.dependencies.store.saveEnrollment(enrollment)
    await this.record(
      input.accountId,
      'mfa.enrollment_started',
      'accepted',
      'authenticated_subject'
    )
    return { ok: true, enrollmentId: enrollment.id, secret: enrollment.secret }
  }

  async confirmEnrollment(input: {
    subject: AuthenticatedSubject | undefined
    enrollmentId: string
    code: string
  }): Promise<MfaConfirmationResult> {
    const enrollment = await this.dependencies.store.findEnrollment(input.enrollmentId)
    if (!enrollment || !isAuthenticatedSubject(input.subject, enrollment.accountId)) {
      return this.fail(
        enrollment?.accountId ?? 'unknown',
        MFA_RESULT_CODE.FORBIDDEN,
        'MFA enrollment is not permitted'
      )
    }
    if (enrollment.status !== MFA_ENROLLMENT_STATUS.PENDING) {
      return this.fail(
        enrollment.accountId,
        MFA_RESULT_CODE.REPLAYED,
        'MFA enrollment is not available'
      )
    }
    const valid = await this.dependencies.verifier.verify(
      enrollment.secret,
      input.code,
      this.dependencies.now()
    )
    if (!valid)
      return this.fail(enrollment.accountId, MFA_RESULT_CODE.INVALID, 'MFA code is invalid')

    enrollment.status = MFA_ENROLLMENT_STATUS.ACTIVE
    enrollment.confirmedAt = this.dependencies.now()
    await this.dependencies.store.saveEnrollment(enrollment)
    const recoveryCodes: string[] = []
    for (let index = 0; index < RECOVERY_CODE_COUNT; index += 1) {
      const code = `recovery-${String(index + 1).padStart(2, '0')}-${this.dependencies.ids.next()}`
      recoveryCodes.push(code)
      await this.dependencies.store.saveRecoveryCode({
        id: this.dependencies.ids.next(),
        accountId: enrollment.accountId,
        codeDigest: this.dependencies.tokens.digest(code),
        consumedAt: null,
      })
    }
    await this.record(enrollment.accountId, 'mfa.enrollment_confirmed', 'success', 'code_verified')
    return { ok: true, recoveryCodes }
  }

  async beginChallenge(input: {
    subject: AuthenticatedSubject | undefined
    enrollmentId: string
  }): Promise<MfaChallengeResult> {
    const enrollment = await this.dependencies.store.findEnrollment(input.enrollmentId)
    if (!enrollment || !isAuthenticatedSubject(input.subject, enrollment.accountId)) {
      return this.fail(
        enrollment?.accountId ?? 'unknown',
        MFA_RESULT_CODE.FORBIDDEN,
        'MFA challenge is not permitted'
      )
    }
    if (enrollment.status !== MFA_ENROLLMENT_STATUS.ACTIVE) {
      return this.fail(
        enrollment.accountId,
        MFA_RESULT_CODE.INVALID,
        'MFA enrollment is not active'
      )
    }
    const now = this.dependencies.now()
    if (!this.dependencies.rateLimiter.allow(`${enrollment.accountId}:challenge`, now)) {
      return this.fail(
        enrollment.accountId,
        MFA_RESULT_CODE.RATE_LIMITED,
        'MFA challenge rate limit exceeded'
      )
    }
    const challenge = this.dependencies.tokens.issue()
    await this.dependencies.store.saveChallenge({
      id: this.dependencies.ids.next(),
      accountId: enrollment.accountId,
      enrollmentId: enrollment.id,
      tokenDigest: this.dependencies.tokens.digest(challenge),
      expiresAt: now + CHALLENGE_TTL_MS,
      consumedAt: null,
    })
    await this.record(
      enrollment.accountId,
      'mfa.challenge_started',
      'accepted',
      'one_time_challenge'
    )
    return { ok: true, challenge, expiresAt: now + CHALLENGE_TTL_MS }
  }

  async verifyChallenge(input: {
    subject: AuthenticatedSubject | undefined
    challenge: string
    code: string
  }): Promise<MfaLifecycleResult> {
    const challenge = await this.dependencies.store.findChallenge(
      this.dependencies.tokens.digest(input.challenge)
    )
    if (!challenge || !isAuthenticatedSubject(input.subject, challenge.accountId)) {
      return this.fail(
        challenge?.accountId ?? 'unknown',
        MFA_RESULT_CODE.FORBIDDEN,
        'MFA challenge is not permitted'
      )
    }
    const now = this.dependencies.now()
    if (challenge.consumedAt !== null)
      return this.fail(
        challenge.accountId,
        MFA_RESULT_CODE.REPLAYED,
        'MFA challenge was already used'
      )
    if (challenge.expiresAt <= now)
      return this.fail(challenge.accountId, MFA_RESULT_CODE.EXPIRED, 'MFA challenge expired')
    const enrollment = await this.dependencies.store.findEnrollment(challenge.enrollmentId)
    if (!enrollment || enrollment.status !== MFA_ENROLLMENT_STATUS.ACTIVE) {
      return this.fail(challenge.accountId, MFA_RESULT_CODE.INVALID, 'MFA enrollment is not active')
    }
    if (!this.dependencies.rateLimiter.allow(`${challenge.accountId}:verify`, now)) {
      return this.fail(
        challenge.accountId,
        MFA_RESULT_CODE.RATE_LIMITED,
        'MFA verification rate limit exceeded'
      )
    }
    if (!(await this.dependencies.verifier.verify(enrollment.secret, input.code, now))) {
      return this.fail(challenge.accountId, MFA_RESULT_CODE.INVALID, 'MFA code is invalid')
    }
    challenge.consumedAt = now
    await this.dependencies.store.saveChallenge(challenge)
    await this.record(challenge.accountId, 'mfa.challenge_verified', 'success', 'code_verified')
    return { ok: true }
  }

  async recoverWithCode(input: {
    subject: AuthenticatedSubject | undefined
    code: string
  }): Promise<MfaLifecycleResult> {
    const accountId = input.subject?.accountId ?? 'unknown'
    if (!isAuthenticatedSubject(input.subject, accountId))
      return this.fail(accountId, MFA_RESULT_CODE.FORBIDDEN, 'MFA recovery is not permitted')
    const now = this.dependencies.now()
    if (!this.dependencies.rateLimiter.allow(`${accountId}:recovery`, now)) {
      return this.fail(accountId, MFA_RESULT_CODE.RATE_LIMITED, 'MFA recovery rate limit exceeded')
    }
    const recoveryCode = await this.dependencies.store.findRecoveryCode(
      this.dependencies.tokens.digest(input.code)
    )
    if (!recoveryCode || recoveryCode.accountId !== accountId)
      return this.fail(accountId, MFA_RESULT_CODE.INVALID, 'MFA recovery code is invalid')
    if (recoveryCode.consumedAt !== null)
      return this.fail(accountId, MFA_RESULT_CODE.REPLAYED, 'MFA recovery code was already used')
    recoveryCode.consumedAt = now
    await this.dependencies.store.saveRecoveryCode(recoveryCode)
    await this.record(accountId, 'mfa.recovery_used', 'success', 'one_time_recovery_code')
    return { ok: true }
  }

  private async fail(accountId: string, code: MfaResultCode, message: string): Promise<MfaFailure> {
    await this.record(accountId, 'mfa.operation_denied', 'denied', code)
    return { ok: false, code, message }
  }

  private async record(
    accountId: string,
    kind: string,
    outcome: 'success' | 'denied' | 'accepted',
    reason: string
  ): Promise<void> {
    await this.dependencies.audit.record({
      kind,
      accountId,
      outcome,
      reason,
      occurredAt: new Date(this.dependencies.now()).toISOString(),
      metadata: { reason },
    })
  }
}
