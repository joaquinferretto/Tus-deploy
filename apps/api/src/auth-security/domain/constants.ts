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
  // Changes made by a platform admin on someone else's account: actorId is the ADMIN and the
  // metadata names the target account, the action and the changed fields.
  ACCOUNT_ADMIN_CREATED: 'account.admin_created',
  ACCOUNT_ADMIN_UPDATED: 'account.admin_updated',
  ACCOUNT_ADMIN_SUSPENDED: 'account.admin_suspended',
  ACCOUNT_ADMIN_REACTIVATED: 'account.admin_reactivated',
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
  // Phone identity (user-initiated WhatsApp challenge). Metadata carries masked numbers only.
  PHONE_CHALLENGE_CREATED: 'phone.challenge_created',
  PHONE_VERIFIED: 'phone.verified',
  PHONE_CHANGED: 'phone.changed',
  PHONE_VERIFICATION_FAILED: 'phone.verification_failed',
  PHONE_RECOVERY_VERIFIED: 'phone.recovery_verified',
  PHONE_CONFIRMATION_FAILED: 'phone.confirmation_failed',
  PHONE_ADMIN_PENDING_SET: 'phone.admin_pending_set',
  PHONE_ADMIN_CLEARED: 'phone.admin_cleared',
  PHONE_VERIFIED_BY_ADMIN: 'phone.verified_by_admin',
  ACCOUNT_ADMIN_IDENTITY_UPDATED: 'account.admin_identity_updated',
  PHONE_UNVERIFIED_BY_ADMIN: 'phone.unverified_by_admin',
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
