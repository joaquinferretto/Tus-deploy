import {
  REFRESH_OUTBOX_EVENT_TYPE,
  REFRESH_ROTATION_CODE,
  type RefreshOutboxEvent,
  type RefreshRotationOutcome,
  type RefreshRotationRequest,
  type RefreshTokenFamily,
} from '../domain/refresh.js'
import type {
  OutboxPort,
  RefreshRotationSnapshot,
  RefreshRotationStore,
  SessionRevocationPort,
} from '../ports/refresh-rotation.js'

export interface InMemoryRefreshRotationStoreOptions {
  outbox: OutboxPort
  sessions: SessionRevocationPort
  state?: RefreshRotationSnapshot
}

export class InMemoryRefreshRotationStore implements RefreshRotationStore {
  readonly families: Map<string, RefreshTokenFamily>
  private operation = Promise.resolve()
  private readonly outbox: OutboxPort
  private readonly sessions: SessionRevocationPort

  constructor(options: InMemoryRefreshRotationStoreOptions) {
    this.outbox = options.outbox
    this.sessions = options.sessions
    this.families = new Map(
      options.state?.families.map((family) => [family.id, cloneFamily(family)]) ?? []
    )
  }

  async createFamily(family: RefreshTokenFamily): Promise<void> {
    this.families.set(family.id, cloneFamily(family))
  }

  async rotate(input: RefreshRotationRequest): Promise<RefreshRotationOutcome> {
    return this.withLock(async () => this.rotateLocked(input))
  }

  async revokeFamily(familyId: string, revokedAt: number): Promise<void> {
    return this.withLock(async () => {
      const family = this.families.get(familyId)
      if (family && family.revokedAt === null) {
        family.revokedAt = revokedAt
        family.updatedAt = revokedAt
      }
    })
  }

  exportState(): RefreshRotationSnapshot {
    return { families: [...this.families.values()].map((family) => cloneFamily(family)) }
  }

  private async rotateLocked(input: RefreshRotationRequest): Promise<RefreshRotationOutcome> {
    const family = findFamily(this.families, input.presentedTokenDigest)
    if (!family) return { ok: false, code: REFRESH_ROTATION_CODE.INVALID, familyCompromised: false }

    if (family.revokedAt !== null) {
      return { ok: false, code: REFRESH_ROTATION_CODE.FAMILY_REVOKED, familyCompromised: false }
    }
    if (
      family.lastRotation?.idempotencyKey === input.idempotencyKey &&
      family.lastRotation.presentedTokenDigest === input.presentedTokenDigest
    ) {
      return successFromFamily(family, true)
    }

    if (family.expiresAt <= input.now) {
      return { ok: false, code: REFRESH_ROTATION_CODE.EXPIRED, familyCompromised: false }
    }
    if (family.currentTokenDigest !== input.presentedTokenDigest) {
      return this.compromiseFamily(family, input.now)
    }

    const familyBefore = cloneFamily(family)
    const sessionsBefore = this.sessions.snapshot()
    family.usedTokenDigests.push(family.currentTokenDigest)
    family.currentTokenDigest = input.replacementTokenDigest
    family.generation += 1
    family.updatedAt = input.now
    family.lastRotation = {
      idempotencyKey: input.idempotencyKey,
      presentedTokenDigest: input.presentedTokenDigest,
      replacementTokenDigest: input.replacementTokenDigest,
      replacementAccessTokenDigest: input.replacementAccessTokenDigest,
      generation: family.generation,
      rotatedAt: input.now,
    }

    try {
      await this.outbox.append(rotationEvent(family, input.now))
    } catch (error: unknown) {
      this.families.set(family.id, familyBefore)
      this.sessions.restore(sessionsBefore)
      throw error
    }

    return successFromFamily(family, false)
  }

  private async compromiseFamily(
    family: RefreshTokenFamily,
    now: number
  ): Promise<RefreshRotationOutcome> {
    const familyBefore = cloneFamily(family)
    const sessionsBefore = this.sessions.snapshot()
    family.revokedAt = now
    family.compromisedAt = now
    family.updatedAt = now
    await this.sessions.revokeDeviceSessions(family.accountId, family.deviceId, now)

    try {
      await this.outbox.append(compromiseEvent(family, now))
    } catch (error: unknown) {
      this.families.set(family.id, familyBefore)
      this.sessions.restore(sessionsBefore)
      throw error
    }

    return { ok: false, code: REFRESH_ROTATION_CODE.REPLAY, familyCompromised: true }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation)
    this.operation = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}

function findFamily(
  families: Map<string, RefreshTokenFamily>,
  tokenDigest: string
): RefreshTokenFamily | undefined {
  return [...families.values()].find(
    (family) =>
      family.currentTokenDigest === tokenDigest || family.usedTokenDigests.includes(tokenDigest)
  )
}

function successFromFamily(
  family: RefreshTokenFamily,
  idempotent: boolean
): RefreshRotationOutcome {
  const rotation = family.lastRotation
  if (!rotation) {
    return { ok: false, code: REFRESH_ROTATION_CODE.INVALID, familyCompromised: false }
  }
  return {
    ok: true,
    familyId: family.id,
    accountId: family.accountId,
    tenantId: family.tenantId,
    deviceId: family.deviceId,
    sessionId: family.sessionId,
    generation: rotation.generation,
    replacementTokenDigest: rotation.replacementTokenDigest,
    replacementAccessTokenDigest: rotation.replacementAccessTokenDigest,
    idempotent,
  }
}

function rotationEvent(family: RefreshTokenFamily, now: number): RefreshOutboxEvent {
  return {
    contractVersion: '1.0.0',
    type: REFRESH_OUTBOX_EVENT_TYPE.ROTATED,
    aggregateType: 'refresh_token_family',
    aggregateId: family.id,
    occurredAt: new Date(now).toISOString(),
    payload: eventPayload(family),
  }
}

function compromiseEvent(family: RefreshTokenFamily, now: number): RefreshOutboxEvent {
  return {
    contractVersion: '1.0.0',
    type: REFRESH_OUTBOX_EVENT_TYPE.FAMILY_COMPROMISED,
    aggregateType: 'refresh_token_family',
    aggregateId: family.id,
    occurredAt: new Date(now).toISOString(),
    payload: eventPayload(family),
  }
}

function eventPayload(family: RefreshTokenFamily) {
  return {
    accountId: family.accountId,
    tenantId: family.tenantId,
    deviceId: family.deviceId,
    sessionId: family.sessionId,
    generation: family.generation,
  }
}

function cloneFamily(family: RefreshTokenFamily): RefreshTokenFamily {
  return {
    ...family,
    usedTokenDigests: [...family.usedTokenDigests],
    lastRotation: family.lastRotation ? { ...family.lastRotation } : null,
  }
}
