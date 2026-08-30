import type {
  RefreshOutboxEvent,
  RefreshRotationOutcome,
  RefreshRotationRequest,
  RefreshTokenFamily,
} from '../domain/refresh.js'

export interface RefreshRotationSnapshot {
  families: RefreshTokenFamily[]
}

export interface OutboxPort {
  append(event: RefreshOutboxEvent): Promise<void>
}

export interface SessionRevocationSnapshot {
  accountId: string
  deviceId: string
  revokedAt: number
}

export interface SessionRevocationPort {
  revokeDeviceSessions(accountId: string, deviceId: string, revokedAt: number): Promise<void>
  snapshot(): SessionRevocationSnapshot[]
  restore(snapshot: SessionRevocationSnapshot[]): void
}

export interface RefreshRotationStore {
  createFamily(family: RefreshTokenFamily): Promise<void>
  rotate(input: RefreshRotationRequest): Promise<RefreshRotationOutcome>
  revokeFamily(familyId: string, revokedAt: number): Promise<void>
  exportState(): RefreshRotationSnapshot
}
