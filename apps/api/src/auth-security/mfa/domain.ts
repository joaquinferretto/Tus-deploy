export const MFA_RESULT_CODE = {
  FORBIDDEN: 'FORBIDDEN',
  INVALID: 'INVALID',
  EXPIRED: 'EXPIRED',
  REPLAYED: 'REPLAYED',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const

export type MfaResultCode = (typeof MFA_RESULT_CODE)[keyof typeof MFA_RESULT_CODE]

export const MFA_ENROLLMENT_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const

export type MfaEnrollmentStatus = (typeof MFA_ENROLLMENT_STATUS)[keyof typeof MFA_ENROLLMENT_STATUS]

export interface AuthenticatedSubject {
  accountId: string
  sessionId: string
}

export interface MfaEnrollment {
  id: string
  accountId: string
  label: string
  secret: string
  status: MfaEnrollmentStatus
  createdAt: number
  confirmedAt: number | null
}

export interface MfaChallenge {
  id: string
  accountId: string
  enrollmentId: string
  tokenDigest: string
  expiresAt: number
  consumedAt: number | null
}

export interface MfaRecoveryCode {
  id: string
  accountId: string
  codeDigest: string
  consumedAt: number | null
}

export interface MfaAuditEvent {
  kind: string
  accountId: string
  outcome: 'success' | 'denied' | 'accepted'
  reason: string
  occurredAt: string
  metadata: Record<string, string | number | boolean | null>
}

export type MfaFailure = { ok: false; code: MfaResultCode; message: string }

export function isAuthenticatedSubject(
  subject: AuthenticatedSubject | undefined,
  accountId: string
): subject is AuthenticatedSubject {
  return Boolean(subject?.accountId && subject.accountId === accountId && subject.sessionId)
}
