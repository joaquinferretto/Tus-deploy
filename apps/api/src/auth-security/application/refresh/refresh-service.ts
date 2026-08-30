import type { Clock } from '../../ports/clock.js'
import type { IdGenerator, TokenIssuer } from '../../ports/security.js'
import type { RefreshRotationOutcome, RefreshTokenFamily } from '../../domain/refresh.js'
import type { RefreshRotationStore } from '../../ports/refresh-rotation.js'

const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface CreateRefreshFamilyInput {
  accountId: string
  tenantId: string
  deviceId: string
  sessionId: string
}

export interface IssuedRefreshSession {
  familyId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface RotateRefreshInput {
  refreshToken: string
  idempotencyKey: string
}

export type RotateRefreshResult =
  | (IssuedRefreshSession & {
      ok: true
      generation: number
      idempotent: boolean
      accountId: string
      tenantId: string
      deviceId: string
      sessionId: string
    })
  | RefreshRotationOutcome

export interface RefreshRotationServiceDependencies {
  store: RefreshRotationStore
  clock: Clock
  ids: IdGenerator
  tokens: TokenIssuer
  refreshTtlMs?: number
}

export class RefreshRotationService {
  private readonly dependencies: RefreshRotationServiceDependencies
  private readonly refreshTtlMs: number
  private readonly idempotentResults = new Map<string, RotateRefreshResult>()
  private readonly inFlight = new Map<string, Promise<RotateRefreshResult>>()

  constructor(dependencies: RefreshRotationServiceDependencies) {
    this.dependencies = dependencies
    this.refreshTtlMs = dependencies.refreshTtlMs ?? DEFAULT_REFRESH_TTL_MS
  }

  async createFamily(input: CreateRefreshFamilyInput): Promise<IssuedRefreshSession> {
    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.tokens.issue()
    const accessToken = this.dependencies.tokens.issue()
    const family: RefreshTokenFamily = {
      id: this.dependencies.ids.next(),
      accountId: input.accountId,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      currentTokenDigest: this.dependencies.tokens.digest(refreshToken),
      usedTokenDigests: [],
      generation: 0,
      expiresAt: now + this.refreshTtlMs,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
      compromisedAt: null,
      lastRotation: null,
    }
    await this.dependencies.store.createFamily(family)
    return {
      familyId: family.id,
      accessToken,
      refreshToken,
      expiresAt: family.expiresAt,
    }
  }

  async rotate(input: RotateRefreshInput): Promise<RotateRefreshResult> {
    const cacheKey = `${input.idempotencyKey}:${this.dependencies.tokens.digest(input.refreshToken)}`
    const cached = this.idempotentResults.get(cacheKey)
    if (cached) return cloneResult(cached)

    const inFlight = this.inFlight.get(cacheKey)
    if (inFlight) return cloneResult(await inFlight)

    const operation = this.rotateOnce(input, cacheKey)
    this.inFlight.set(cacheKey, operation)
    try {
      return cloneResult(await operation)
    } finally {
      this.inFlight.delete(cacheKey)
    }
  }

  private async rotateOnce(
    input: RotateRefreshInput,
    cacheKey: string
  ): Promise<RotateRefreshResult> {
    const replacementRefreshToken = this.dependencies.tokens.issue()
    const replacementAccessToken = this.dependencies.tokens.issue()
    const outcome = await this.dependencies.store.rotate({
      presentedTokenDigest: this.dependencies.tokens.digest(input.refreshToken),
      replacementTokenDigest: this.dependencies.tokens.digest(replacementRefreshToken),
      replacementAccessTokenDigest: this.dependencies.tokens.digest(replacementAccessToken),
      idempotencyKey: input.idempotencyKey,
      now: this.dependencies.clock.now(),
    })

    if (!outcome.ok) return outcome
    const result: RotateRefreshResult = {
      ok: true,
      familyId: outcome.familyId,
      accessToken: replacementAccessToken,
      refreshToken: replacementRefreshToken,
      expiresAt: this.dependencies.clock.now() + this.refreshTtlMs,
      generation: outcome.generation,
      idempotent: outcome.idempotent,
      accountId: outcome.accountId,
      tenantId: outcome.tenantId,
      deviceId: outcome.deviceId,
      sessionId: outcome.sessionId,
    }
    this.idempotentResults.set(cacheKey, result)
    return cloneResult(result)
  }
}

function cloneResult(result: RotateRefreshResult): RotateRefreshResult {
  return result.ok ? { ...result } : { ...result }
}
