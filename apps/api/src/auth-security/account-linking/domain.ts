export const ACCOUNT_LINKING_RESULT_CODE = {
  FORBIDDEN: 'FORBIDDEN',
  IDENTITY_COLLISION: 'IDENTITY_COLLISION',
  RECENT_AUTH_REQUIRED: 'RECENT_AUTH_REQUIRED',
  LAST_AUTHENTICATOR: 'LAST_AUTHENTICATOR',
  NOT_FOUND: 'NOT_FOUND',
} as const

export type AccountLinkingResultCode =
  (typeof ACCOUNT_LINKING_RESULT_CODE)[keyof typeof ACCOUNT_LINKING_RESULT_CODE]

export interface ExternalIdentity {
  providerId: string
  issuer: string
  subject: string
  email: string | null
}

export interface LinkedIdentity extends ExternalIdentity {
  accountId: string
  linkedAt: number
}

export interface AccountAuthenticationState {
  accountId: string
  passwordCredential: boolean
}

export interface AccountLinkingAuditEvent {
  kind: string
  accountId: string
  outcome: 'success' | 'denied'
  reason: string
  occurredAt: string
  metadata: Record<string, string | number | boolean | null>
}

export type AccountLinkingFailure = {
  ok: false
  code: AccountLinkingResultCode
  message: string
}
