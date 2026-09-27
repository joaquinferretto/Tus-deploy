export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const

export type AccountStatus = (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS]

export const CREDENTIAL_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const

export type CredentialStatus = (typeof CREDENTIAL_STATUS)[keyof typeof CREDENTIAL_STATUS]

export const AUTH_EVENT_KIND = {
  ACCOUNT_REGISTERED: 'account.registered',
  ACCOUNT_VERIFIED: 'account.verified',
  AUTH_SIGNED_IN: 'auth.signed_in',
  AUTH_FAILED: 'auth.failed',
  CREDENTIAL_PASSWORD_CHANGED: 'credential.password_changed',
  CREDENTIAL_DISABLED: 'credential.disabled',
  RECOVERY_REQUESTED: 'recovery.requested',
  RECOVERY_COMPLETED: 'recovery.completed',
  SESSION_CREATED: 'session.created',
  SESSION_REVOKED: 'session.revoked',
  SESSION_ROTATED: 'session.rotated',
  VERIFICATION_RESENT: 'verification.resent',
  EMAIL_DELIVERY_FAILED: 'email.delivery_failed',
} as const

export type AuthEventKind = (typeof AUTH_EVENT_KIND)[keyof typeof AUTH_EVENT_KIND]

export const AUTH_RESULT_CODE = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  PASSWORD_BREACHED: 'PASSWORD_BREACHED',
} as const

export type AuthResultCode = (typeof AUTH_RESULT_CODE)[keyof typeof AUTH_RESULT_CODE]
