import type { AuthenticatedSubject } from '../mfa/domain.js'

export const PASSKEY_RESULT_CODE = {
  FORBIDDEN: 'FORBIDDEN',
  INVALID: 'INVALID',
  EXPIRED: 'EXPIRED',
  REPLAYED: 'REPLAYED',
  PHISHING_RESISTANCE_FAILED: 'PHISHING_RESISTANCE_FAILED',
} as const

export type PasskeyResultCode = (typeof PASSKEY_RESULT_CODE)[keyof typeof PASSKEY_RESULT_CODE]

export interface PasskeyCeremony {
  id: string
  accountId: string
  challenge: string
  rpId: string
  origin: string
  expiresAt: number
  consumedAt: number | null
}

export interface PasskeyCredential {
  id: string
  accountId: string
  credentialId: string
  publicKey: string
  signCount: number
  createdAt: number
}

export interface WebAuthnRegistrationResponse {
  challenge: string
  origin: string
  rpId: string
  type: 'webauthn.create'
  userVerification: boolean
  credentialId: string
  proof: string
}

export interface WebAuthnExpected {
  challenge: string
  origin: string
  rpId: string
  type: 'webauthn.create'
}

export interface WebAuthnVerification {
  credentialId: string
  publicKey: string
  signCount: number
}

export type PasskeyFailure = { ok: false; code: PasskeyResultCode; message: string }

export interface PasskeySubject {
  subject: AuthenticatedSubject
}
