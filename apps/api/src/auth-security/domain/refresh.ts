export const REFRESH_ROTATION_CODE = {
  INVALID: 'REFRESH_TOKEN_INVALID',
  EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  REPLAY: 'REFRESH_TOKEN_REPLAY',
  FAMILY_REVOKED: 'REFRESH_FAMILY_REVOKED',
} as const

export type RefreshRotationCode = (typeof REFRESH_ROTATION_CODE)[keyof typeof REFRESH_ROTATION_CODE]

export const REFRESH_OUTBOX_EVENT_TYPE = {
  ROTATED: 'auth.refresh_rotated',
  FAMILY_COMPROMISED: 'auth.refresh_family_compromised',
} as const

export type RefreshOutboxEventType =
  (typeof REFRESH_OUTBOX_EVENT_TYPE)[keyof typeof REFRESH_OUTBOX_EVENT_TYPE]

export interface RefreshRotationRecord {
  idempotencyKey: string
  presentedTokenDigest: string
  replacementTokenDigest: string
  replacementAccessTokenDigest: string
  generation: number
  rotatedAt: number
}

export interface RefreshTokenFamily {
  id: string
  accountId: string
  tenantId: string
  deviceId: string
  sessionId: string
  currentTokenDigest: string
  usedTokenDigests: string[]
  generation: number
  expiresAt: number
  createdAt: number
  updatedAt: number
  revokedAt: number | null
  compromisedAt: number | null
  lastRotation: RefreshRotationRecord | null
}

export interface RefreshRotationRequest {
  presentedTokenDigest: string
  replacementTokenDigest: string
  replacementAccessTokenDigest: string
  idempotencyKey: string
  now: number
}

export interface RefreshRotationSuccess {
  ok: true
  familyId: string
  accountId: string
  tenantId: string
  deviceId: string
  sessionId: string
  generation: number
  replacementTokenDigest: string
  replacementAccessTokenDigest: string
  idempotent: boolean
}

export interface RefreshRotationFailure {
  ok: false
  code: RefreshRotationCode
  familyCompromised: boolean
}

export type RefreshRotationOutcome = RefreshRotationSuccess | RefreshRotationFailure

export interface RefreshOutboxEventPayload {
  accountId: string
  tenantId: string
  deviceId: string
  sessionId: string
  generation: number
}

export interface RefreshOutboxEvent {
  contractVersion: '1.0.0'
  type: RefreshOutboxEventType
  aggregateType: 'refresh_token_family'
  aggregateId: string
  occurredAt: string
  payload: RefreshOutboxEventPayload
}
