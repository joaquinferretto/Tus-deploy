import {
  isAuthenticatedSubject,
  MFA_ELEVATION_METHOD,
  MFA_ENROLLMENT_STATUS,
  MFA_RESULT_CODE,
  type AuthenticatedSubject,
  type MfaElevationMethod,
  type MfaEnrollment,
  type MfaFailure,
  type MfaResultCode,
} from '../domain.js'
import type {
  MfaAuditSink,
  MfaCodeVerifier,
  MfaIdGenerator,
  MfaRateLimiter,
  MfaRecoveryCodeGenerator,
  MfaSecretGenerator,
  MfaStore,
  MfaTokenIssuer,
} from '../ports.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const RECOVERY_CODE_COUNT = 8
// A second-factor proof is valid for this session at most 12 h (the session may end earlier).
export const MFA_ELEVATION_TTL_MS = 12 * 60 * 60 * 1000

export interface MfaServiceDependencies {
  store: MfaStore
  verifier: MfaCodeVerifier
  secretGenerator: MfaSecretGenerator
  tokens: MfaTokenIssuer
  ids: MfaIdGenerator
  rateLimiter: MfaRateLimiter
  audit: MfaAuditSink
  now: () => number
  recoveryCodes?: MfaRecoveryCodeGenerator
}

export type MfaLifecycleResult = { ok: true } | MfaFailure

export type MfaEnrollmentResult = { ok: true; enrollmentId: string; secret: string } | MfaFailure

export type MfaConfirmationResult = { ok: true; recoveryCodes: string[] } | MfaFailure

export type MfaChallengeResult = { ok: true; challenge: string; expiresAt: number } | MfaFailure

export interface MfaStatus {
  enrolled: boolean
  pendingEnrollmentId: string | null
  elevated: boolean
  elevatedUntil: number | null
}

export class MfaService {
  private readonly dependencies: MfaServiceDependencies

  constructor(dependencies: MfaServiceDependencies) {
    this.dependencies = dependencies
  }

  // The secret is returned ONLY here, while the enrollment is pending. Once confirmed it is never
  // shown again (the store keeps it encrypted).
  async enroll(input: {
    accountId: string
    subject: AuthenticatedSubject | undefined
    label: string
  }): Promise<MfaEnrollmentResult> {
    if (!isAuthenticatedSubject(input.subject, input.accountId)) {
      return this.fail(input.accountId, MFA_RESULT_CODE.FORBIDDEN, 'MFA enrollment is not permitted')
    }
    if (!input.label.trim()) {
      return this.fail(input.accountId, MFA_RESULT_CODE.VALIDATION_FAILED, 'MFA label is invalid')
    }
    if (await this.dependencies.store.findEnrollmentForAccount(input.accountId, MFA_ENROLLMENT_STATUS.ACTIVE)) {
      return this.fail(input.accountId, MFA_RESULT_CODE.CONFLICT, 'MFA is already active')
    }
    // A new enrollment replaces an unconfirmed one.
    const pending = await this.dependencies.store.findEnrollmentForAccount(input.accountId, MFA_ENROLLMENT_STATUS.PENDING)
    if (pending) {
      pending.status = MFA_ENROLLMENT_STATUS.DISABLED
      pending.disabledAt = this.dependencies.now()
      await this.dependencies.store.saveEnrollment(pending)
    }
    const enrollment: MfaEnrollment = {
      id: this.dependencies.ids.next(),
      accountId: input.accountId,
      label: input.label.trim(),
      secret: this.dependencies.secretGenerator.next(),
      status: MFA_ENROLLMENT_STATUS.PENDING,
      createdAt: this.dependencies.now(),
      confirmedAt: null,
      lastUsedStep: null,
      disabledAt: null,
    }
    await this.dependencies.store.saveEnrollment(enrollment)
    await this.record(input.accountId, 'mfa.enrollment_started', 'accepted', 'authenticated_subject')
    return { ok: true, enrollmentId: enrollment.id, secret: enrollment.secret }
  }

  // Confirming proves possession of the authenticator: the session is elevated and the recovery
  // codes are returned once (only their hashes are stored).
  async confirmEnrollment(input: {
    subject: AuthenticatedSubject | undefined
    enrollmentId: string
    code: string
  }): Promise<MfaConfirmationResult> {
    const enrollment = await this.dependencies.store.findEnrollment(input.enrollmentId)
    if (!enrollment || !isAuthenticatedSubject(input.subject, enrollment.accountId)) {
      return this.fail(enrollment?.accountId ?? 'unknown', MFA_RESULT_CODE.FORBIDDEN, 'MFA enrollment is not permitted')
    }
    if (enrollment.status !== MFA_ENROLLMENT_STATUS.PENDING) {
      return this.fail(enrollment.accountId, MFA_RESULT_CODE.REPLAYED, 'MFA enrollment is not available')
    }
    const now = this.dependencies.now()
    if (!this.dependencies.rateLimiter.allow(`${enrollment.accountId}:confirm`, now)) {
      return this.fail(enrollment.accountId, MFA_RESULT_CODE.RATE_LIMITED, 'MFA confirmation rate limit exceeded')
    }
    if (!(await this.acceptCode(enrollment, input.code, now))) {
      return this.fail(enrollment.accountId, MFA_RESULT_CODE.INVALID, 'MFA code is invalid')
    }
    enrollment.status = MFA_ENROLLMENT_STATUS.ACTIVE
    enrollment.confirmedAt = now
    await this.dependencies.store.saveEnrollment(enrollment)
    const recoveryCodes = await this.issueRecoveryCodes(enrollment)
    await this.elevate(input.subject!, MFA_ELEVATION_METHOD.ENROLLMENT, now)
    await this.record(enrollment.accountId, 'mfa.enrollment_confirmed', 'success', 'code_verified')
    return { ok: true, recoveryCodes }
  }

  async beginChallenge(input: {
    subject: AuthenticatedSubject | undefined
    enrollmentId: string
  }): Promise<MfaChallengeResult> {
    const enrollment = await this.dependencies.store.findEnrollment(input.enrollmentId)
    if (!enrollment || !isAuthenticatedSubject(input.subject, enrollment.accountId)) {
      return this.fail(enrollment?.accountId ?? 'unknown', MFA_RESULT_CODE.FORBIDDEN, 'MFA challenge is not permitted')
    }
    if (enrollment.status !== MFA_ENROLLMENT_STATUS.ACTIVE) {
      return this.fail(enrollment.accountId, MFA_RESULT_CODE.INVALID, 'MFA enrollment is not active')
    }
    const now = this.dependencies.now()
    if (!this.dependencies.rateLimiter.allow(`${enrollment.accountId}:challenge`, now)) {
      return this.fail(enrollment.accountId, MFA_RESULT_CODE.RATE_LIMITED, 'MFA challenge rate limit exceeded')
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
    await this.record(enrollment.accountId, 'mfa.challenge_started', 'accepted', 'one_time_challenge')
    return { ok: true, challenge, expiresAt: now + CHALLENGE_TTL_MS }
  }

  async verifyChallenge(input: {
    subject: AuthenticatedSubject | undefined
    challenge: string
    code: string
  }): Promise<MfaLifecycleResult> {
    const challenge = await this.dependencies.store.findChallenge(this.dependencies.tokens.digest(input.challenge))
    if (!challenge || !isAuthenticatedSubject(input.subject, challenge.accountId)) {
      return this.fail(challenge?.accountId ?? 'unknown', MFA_RESULT_CODE.FORBIDDEN, 'MFA challenge is not permitted')
    }
    const now = this.dependencies.now()
    if (challenge.consumedAt !== null)
      return this.fail(challenge.accountId, MFA_RESULT_CODE.REPLAYED, 'MFA challenge was already used')
    if (challenge.expiresAt <= now)
      return this.fail(challenge.accountId, MFA_RESULT_CODE.EXPIRED, 'MFA challenge expired')
    const enrollment = await this.dependencies.store.findEnrollment(challenge.enrollmentId)
    if (!enrollment || enrollment.status !== MFA_ENROLLMENT_STATUS.ACTIVE) {
      return this.fail(challenge.accountId, MFA_RESULT_CODE.INVALID, 'MFA enrollment is not active')
    }
    if (!this.dependencies.rateLimiter.allow(`${challenge.accountId}:verify`, now)) {
      return this.fail(challenge.accountId, MFA_RESULT_CODE.RATE_LIMITED, 'MFA verification rate limit exceeded')
    }
    if (!(await this.acceptCode(enrollment, input.code, now))) {
      return this.fail(challenge.accountId, MFA_RESULT_CODE.INVALID, 'MFA code is invalid')
    }
    challenge.consumedAt = now
    await this.dependencies.store.saveChallenge(challenge)
    await this.elevate(input.subject!, MFA_ELEVATION_METHOD.TOTP, now)
    await this.record(challenge.accountId, 'mfa.challenge_verified', 'success', 'code_verified')
    return { ok: true }
  }

  // A recovery code replaces the authenticator ONCE for this session.
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
    const consumed = await this.consumeRecoveryCode(accountId, input.code, now)
    if (!consumed.ok) return consumed
    await this.elevate(input.subject, MFA_ELEVATION_METHOD.RECOVERY_CODE, now)
    await this.record(accountId, 'mfa.recovery_used', 'success', 'one_time_recovery_code')
    return { ok: true }
  }

  // New recovery codes need a current authenticator code; every previous code stops working.
  async regenerateRecoveryCodes(input: {
    subject: AuthenticatedSubject | undefined
    code: string
  }): Promise<MfaConfirmationResult> {
    const accountId = input.subject?.accountId ?? 'unknown'
    if (!isAuthenticatedSubject(input.subject, accountId))
      return this.fail(accountId, MFA_RESULT_CODE.FORBIDDEN, 'MFA recovery codes are not permitted')
    const enrollment = await this.dependencies.store.findEnrollmentForAccount(accountId, MFA_ENROLLMENT_STATUS.ACTIVE)
    if (!enrollment) return this.fail(accountId, MFA_RESULT_CODE.INVALID, 'MFA enrollment is not active')
    const now = this.dependencies.now()
    if (!this.dependencies.rateLimiter.allow(`${accountId}:regenerate`, now)) {
      return this.fail(accountId, MFA_RESULT_CODE.RATE_LIMITED, 'MFA recovery codes rate limit exceeded')
    }
    if (!(await this.acceptCode(enrollment, input.code, now))) {
      return this.fail(accountId, MFA_RESULT_CODE.INVALID, 'MFA code is invalid')
    }
    await this.dependencies.store.invalidateRecoveryCodes(accountId, now)
    const recoveryCodes = await this.issueRecoveryCodes(enrollment)
    await this.record(accountId, 'mfa.recovery_codes_regenerated', 'success', 'code_verified')
    return { ok: true, recoveryCodes }
  }

  // Turning MFA off needs re-authentication (checked by the caller, e.g. the current password)
  // AND the second factor (authenticator or recovery code). It revokes every elevation.
  async disable(input: {
    subject: AuthenticatedSubject | undefined
    code: string
    reauthenticated: boolean
  }): Promise<MfaLifecycleResult> {
    const accountId = input.subject?.accountId ?? 'unknown'
    if (!isAuthenticatedSubject(input.subject, accountId))
      return this.fail(accountId, MFA_RESULT_CODE.FORBIDDEN, 'MFA disable is not permitted')
    if (!input.reauthenticated)
      return this.fail(accountId, MFA_RESULT_CODE.REAUTHENTICATION_REQUIRED, 'Re-authentication is required')
    const enrollment = await this.dependencies.store.findEnrollmentForAccount(accountId, MFA_ENROLLMENT_STATUS.ACTIVE)
    if (!enrollment) return this.fail(accountId, MFA_RESULT_CODE.INVALID, 'MFA enrollment is not active')
    const now = this.dependencies.now()
    if (!this.dependencies.rateLimiter.allow(`${accountId}:disable`, now)) {
      return this.fail(accountId, MFA_RESULT_CODE.RATE_LIMITED, 'MFA disable rate limit exceeded')
    }
    const second = (await this.acceptCode(enrollment, input.code, now)) || (await this.consumeRecoveryCode(accountId, input.code, now, false)).ok
    if (!second) return this.fail(accountId, MFA_RESULT_CODE.INVALID, 'MFA code is invalid')
    enrollment.status = MFA_ENROLLMENT_STATUS.DISABLED
    enrollment.disabledAt = now
    await this.dependencies.store.saveEnrollment(enrollment)
    await this.dependencies.store.invalidateRecoveryCodes(accountId, now)
    await this.dependencies.store.revokeElevations(accountId, now)
    await this.record(accountId, 'mfa.disabled', 'success', 'reauthenticated')
    return { ok: true }
  }

  async status(subject: AuthenticatedSubject): Promise<MfaStatus> {
    const active = await this.dependencies.store.findEnrollmentForAccount(subject.accountId, MFA_ENROLLMENT_STATUS.ACTIVE)
    const pending = active ? undefined : await this.dependencies.store.findEnrollmentForAccount(subject.accountId, MFA_ENROLLMENT_STATUS.PENDING)
    const elevation = active ? await this.liveElevation(subject) : undefined
    return {
      enrolled: Boolean(active),
      pendingEnrollmentId: pending?.id ?? null,
      elevated: Boolean(elevation),
      elevatedUntil: elevation?.expiresAt ?? null,
    }
  }

  async activeEnrollmentId(accountId: string): Promise<string | null> {
    return (await this.dependencies.store.findEnrollmentForAccount(accountId, MFA_ENROLLMENT_STATUS.ACTIVE))?.id ?? null
  }

  // True only when the account has an ACTIVE enrollment and THIS session passed the second factor
  // recently. Used by the backend to honor platform admin permissions.
  async isElevated(subject: AuthenticatedSubject): Promise<boolean> {
    if (!subject.accountId || !subject.sessionId) return false
    if (!(await this.dependencies.store.findEnrollmentForAccount(subject.accountId, MFA_ENROLLMENT_STATUS.ACTIVE))) return false
    return Boolean(await this.liveElevation(subject))
  }

  // When this session last proved the second factor (null without a live elevation).
  async elevatedAt(subject: AuthenticatedSubject): Promise<number | null> {
    return (await this.liveElevation(subject))?.verifiedAt ?? null
  }

  private async liveElevation(subject: AuthenticatedSubject) {
    const elevation = await this.dependencies.store.findElevation(subject.sessionId)
    const now = this.dependencies.now()
    if (!elevation || elevation.accountId !== subject.accountId || elevation.revokedAt !== null || elevation.expiresAt <= now) return undefined
    return elevation
  }

  private async elevate(subject: AuthenticatedSubject, method: MfaElevationMethod, now: number): Promise<void> {
    await this.dependencies.store.saveElevation({
      sessionId: subject.sessionId,
      accountId: subject.accountId,
      method,
      verifiedAt: now,
      expiresAt: now + MFA_ELEVATION_TTL_MS,
      revokedAt: null,
    })
  }

  // TOTP codes are single use: a code whose time step is not newer than the last accepted one is
  // rejected even inside the drift window.
  private async acceptCode(enrollment: MfaEnrollment, code: string, now: number): Promise<boolean> {
    const verifier = this.dependencies.verifier
    if (!verifier.matchStep) return verifier.verify(enrollment.secret, code, now)
    const step = await verifier.matchStep(enrollment.secret, code, now)
    if (step === null || (enrollment.lastUsedStep != null && step <= enrollment.lastUsedStep)) return false
    enrollment.lastUsedStep = step
    await this.dependencies.store.saveEnrollment(enrollment)
    return true
  }

  private async issueRecoveryCodes(enrollment: MfaEnrollment): Promise<string[]> {
    const recoveryCodes: string[] = []
    for (let index = 0; index < RECOVERY_CODE_COUNT; index += 1) {
      const code = this.dependencies.recoveryCodes?.next() ?? `recovery-${String(index + 1).padStart(2, '0')}-${this.dependencies.ids.next()}`
      recoveryCodes.push(code)
      await this.dependencies.store.saveRecoveryCode({
        id: this.dependencies.ids.next(),
        accountId: enrollment.accountId,
        enrollmentId: enrollment.id,
        codeDigest: this.digestRecoveryCode(code),
        consumedAt: null,
        invalidatedAt: null,
      })
    }
    return recoveryCodes
  }

  private async consumeRecoveryCode(accountId: string, code: string, now: number, audit = true): Promise<MfaLifecycleResult> {
    const deny = (resultCode: MfaResultCode, message: string): Promise<MfaFailure> | MfaFailure =>
      audit ? this.fail(accountId, resultCode, message) : { ok: false, code: resultCode, message }
    const recoveryCode = code.trim() ? await this.dependencies.store.findRecoveryCode(this.digestRecoveryCode(code)) : undefined
    if (!recoveryCode || recoveryCode.accountId !== accountId || recoveryCode.invalidatedAt)
      return deny(MFA_RESULT_CODE.INVALID, 'MFA recovery code is invalid')
    if (recoveryCode.consumedAt !== null) return deny(MFA_RESULT_CODE.REPLAYED, 'MFA recovery code was already used')
    recoveryCode.consumedAt = now
    await this.dependencies.store.saveRecoveryCode(recoveryCode)
    return { ok: true }
  }

  private digestRecoveryCode(code: string): string {
    return this.dependencies.tokens.digest(code.replace(/[\s-]/gu, '').toUpperCase())
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
