import { createHash } from 'node:crypto'

export const OAUTH_OIDC_RESULT_CODE = {
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INVALID_STATE: 'INVALID_STATE',
  EXPIRED: 'EXPIRED',
  REPLAYED: 'REPLAYED',
  INVALID_NONCE: 'INVALID_NONCE',
  INVALID_ISSUER: 'INVALID_ISSUER',
  INVALID_AUDIENCE: 'INVALID_AUDIENCE',
  PKCE_FAILED: 'PKCE_FAILED',
  INVALID_CALLBACK: 'INVALID_CALLBACK',
} as const

export type OAuthOidcResultCode =
  (typeof OAUTH_OIDC_RESULT_CODE)[keyof typeof OAUTH_OIDC_RESULT_CODE]

export interface OAuthOidcProviderConfig {
  id: string
  issuer: string
  clientId: string
  clientCredentialRef: string
  authorizationEndpoint: string
  tokenEndpoint: string
  enabled: boolean
  credentialAvailable: boolean
}

export interface OAuthTransaction {
  id: string
  providerId: string
  state: string
  nonce: string
  codeVerifier: string
  redirectUri: string
  expiresAt: number
  consumedAt: number | null
}

export interface OAuthIdentity {
  providerId: string
  issuer: string
  subject: string
  email: string | null
  emailVerified: boolean
  // Optional profile claims (never used as identity keys).
  name?: string | null
  picture?: string | null
}

export interface OidcTokenClaims {
  issuer: string
  audience: string
  subject: string
  nonce: string
  email: string | null
  emailVerified: boolean
  expiresAt: number
  name?: string | null
  picture?: string | null
}

export type OAuthOidcFailure = {
  ok: false
  code: OAuthOidcResultCode
  message: string
}

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
