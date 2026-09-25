import { createHash } from 'node:crypto'

// Federated sign-in (Google) on top of the TUS identity model. The permanent external identity is
// provider + issuer + subject; the email is only used to detect an existing account that must be
// linked explicitly (never silently).

export interface FederatedIdentity {
  id: string
  accountId: string
  providerId: string
  issuer: string
  subject: string
  email: string | null
  linkedAt: number
}

// Short-lived, single-use codes that hand results from the backend callback to the Web without
// ever putting a session token in a URL.
export type LoginCodeKind = 'session' | 'signup' | 'link'

export interface LoginCodePayload {
  accountId?: string
  providerId?: string
  issuer?: string
  subject?: string
  email?: string
  name?: string | null
}

export interface LoginCode {
  id: string
  codeHash: string
  kind: LoginCodeKind
  payload: LoginCodePayload
  expiresAt: number
  usedAt: number | null
}

export const LOGIN_CODE_TTL_MS: Record<LoginCodeKind, number> = {
  session: 2 * 60 * 1000,
  signup: 15 * 60 * 1000,
  link: 15 * 60 * 1000,
}

// A password session is "recent" for linking only within this window.
export const RECENT_AUTH_FOR_LINK_MS = 10 * 60 * 1000

export const FEDERATED_RESULT_CODE = {
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INVALID_CODE: 'INVALID_CODE',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  TERMS_REQUIRED: 'TERMS_REQUIRED',
  ACCOUNT_EXISTS: 'ACCOUNT_EXISTS',
  RECENT_AUTH_REQUIRED: 'RECENT_AUTH_REQUIRED',
  EMAIL_MISMATCH: 'EMAIL_MISMATCH',
  IDENTITY_COLLISION: 'IDENTITY_COLLISION',
  SIGN_IN_FAILED: 'SIGN_IN_FAILED',
} as const

export type FederatedResultCode = (typeof FEDERATED_RESULT_CODE)[keyof typeof FEDERATED_RESULT_CODE]

export type FederatedFailure = { ok: false; code: FederatedResultCode; message: string }

export function hashLoginCode(code: string): string {
  return createHash('sha256').update(`tus-oauth-login-code:${code}`).digest('hex')
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`
}
