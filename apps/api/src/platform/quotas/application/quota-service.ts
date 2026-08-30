import {
  cloneReservation,
  QUOTA_CONTRACT_VERSION,
  QUOTA_RESULT_CODE,
  RESERVATION_STATUS,
  usageKey,
  validQuotaContext,
  validQuotaPolicy,
  type QuotaContext,
  type QuotaFailure,
  type QuotaPolicy,
  type QuotaReservation,
  type UsageSnapshot,
} from '../domain.js'
import type {
  QuotaServiceDependencies,
  QuotaServiceOptions,
  PublishQuotaPolicyInput,
  ReservationActionInput,
  ReserveQuotaInput,
  UsageQueryInput,
} from '../ports.js'

export type QuotaPolicyResult = { ok: true; policy: QuotaPolicy } | QuotaFailure
export type QuotaReservationResult = { ok: true; reservation: QuotaReservation } | QuotaFailure

export class QuotaService {
  private readonly reservationTtlMs: number

  constructor(
    private readonly dependencies: QuotaServiceDependencies,
    options: QuotaServiceOptions = {}
  ) {
    this.reservationTtlMs = options.reservationTtlMs ?? 60_000
    if (!Number.isSafeInteger(this.reservationTtlMs) || this.reservationTtlMs < 1)
      throw new Error('reservationTtlMs must be a positive integer')
  }

  async publishPolicy(input: PublishQuotaPolicyInput): Promise<QuotaPolicyResult> {
    if (!validQuotaPolicy(input)) return failure(QUOTA_RESULT_CODE.INVALID, 'invalid_quota_policy')
    const key = `${input.scope}:${input.scopeId}:${input.resource}`
    const history = await this.dependencies.policies.history(key)
    const expectedVersion = (history.at(-1)?.version ?? 0) + 1
    if (input.version !== expectedVersion)
      return failure(QUOTA_RESULT_CODE.VERSION_CONFLICT, 'quota_policy_version_conflict')

    const policy: QuotaPolicy = {
      contractVersion: QUOTA_CONTRACT_VERSION,
      id: input.id ?? this.dependencies.ids.next('quota-policy'),
      scope: input.scope,
      scopeId: input.scopeId,
      resource: input.resource,
      version: input.version,
      limitUnits: input.limitUnits,
      budgetUnits: input.budgetUnits,
      windowMs: input.windowMs,
      rateLimit: { ...input.rateLimit },
    }
    await this.dependencies.policies.save(policy)
    await this.dependencies.policies.activate(key, policy.version)
    return { ok: true, policy }
  }

  async resolvePolicy(context: QuotaContext, resource: string): Promise<QuotaPolicyResult> {
    if (!validQuotaContext(context) || !resource.trim())
      return failure(QUOTA_RESULT_CODE.INVALID, 'invalid_quota_context')
    const policy = await this.dependencies.policies.resolve(context, resource)
    return policy
      ? { ok: true, policy }
      : failure(QUOTA_RESULT_CODE.POLICY_NOT_FOUND, 'quota_policy_not_found')
  }

  async rollbackPolicy(input: {
    scope: QuotaPolicy['scope']
    scopeId: string
    resource: string
    targetVersion: number
  }): Promise<QuotaPolicyResult> {
    if (!input.scopeId.trim() || !input.resource.trim() || input.targetVersion < 1)
      return failure(QUOTA_RESULT_CODE.INVALID, 'invalid_quota_rollback')
    const key = `${input.scope}:${input.scopeId}:${input.resource}`
    const policy = await this.dependencies.policies.find(key, input.targetVersion)
    if (!policy) return failure(QUOTA_RESULT_CODE.POLICY_NOT_FOUND, 'quota_policy_not_found')
    await this.dependencies.policies.activate(key, policy.version)
    return { ok: true, policy }
  }

  async reserve(input: ReserveQuotaInput): Promise<QuotaReservationResult> {
    if (!validQuotaContext(input.context) || !input.resource.trim() || !validAmount(input))
      return failure(QUOTA_RESULT_CODE.INVALID, 'invalid_quota_reservation')
    const now = input.now ?? this.dependencies.clock.now()
    const policy = await this.dependencies.policies.resolve(input.context, input.resource)
    if (!policy) return failure(QUOTA_RESULT_CODE.POLICY_NOT_FOUND, 'quota_policy_not_found')

    const usageWindowStart = windowStart(now, policy.windowMs)
    const rateWindowStart = windowStart(now, policy.rateLimit.windowMs)
    const key = usageKey(input.context, input.resource, usageWindowStart)
    const current =
      (await this.dependencies.ledger.findUsage(key)) ??
      emptyUsage(
        input.context,
        input.resource,
        input.unit ?? 'requests',
        usageWindowStart,
        policy.windowMs,
        rateWindowStart
      )
    if (current.rateWindowStart !== rateWindowStart) {
      current.rateWindowStart = rateWindowStart
      current.requestCount = 0
    }

    const remainingUnits = policy.limitUnits - current.units - current.reservedUnits
    const remainingBudgetUnits = policy.budgetUnits - current.costUnits - current.reservedCostUnits
    if (input.units > remainingUnits)
      return failure(QUOTA_RESULT_CODE.QUOTA_EXCEEDED, 'quota_exhausted', {
        remainingUnits: Math.max(0, remainingUnits),
        remainingBudgetUnits: Math.max(0, remainingBudgetUnits),
        retryAt: usageWindowStart + policy.windowMs,
      })
    if (input.costUnits > remainingBudgetUnits)
      return failure(QUOTA_RESULT_CODE.BUDGET_EXCEEDED, 'budget_exhausted', {
        remainingUnits: Math.max(0, remainingUnits),
        remainingBudgetUnits: Math.max(0, remainingBudgetUnits),
        retryAt: usageWindowStart + policy.windowMs,
      })
    if (current.requestCount >= policy.rateLimit.maxRequests)
      return failure(QUOTA_RESULT_CODE.RATE_LIMITED, 'rate_limit_exhausted', {
        remainingUnits: Math.max(0, remainingUnits),
        remainingBudgetUnits: Math.max(0, remainingBudgetUnits),
        retryAt: rateWindowStart + policy.rateLimit.windowMs,
      })

    current.reservedUnits += input.units
    current.reservedCostUnits += input.costUnits
    current.requestCount += 1
    await this.dependencies.ledger.saveUsage(current)
    const reservation: QuotaReservation = {
      contractVersion: QUOTA_CONTRACT_VERSION,
      reservationId: this.dependencies.ids.next('quota-reservation'),
      profile: input.context.profile,
      tenantId: input.context.tenantId,
      productId: input.context.productId ?? null,
      resource: input.resource,
      unit: input.unit ?? 'requests',
      units: input.units,
      costUnits: input.costUnits,
      policyVersion: policy.version,
      usageWindowStart,
      rateWindowStart,
      status: RESERVATION_STATUS.HELD,
      createdAt: now,
      expiresAt: now + this.reservationTtlMs,
      completedAt: null,
    }
    await this.dependencies.ledger.saveReservation(reservation)
    return { ok: true, reservation }
  }

  async commit(input: ReservationActionInput): Promise<QuotaReservationResult> {
    return this.finishReservation(input, RESERVATION_STATUS.COMMITTED)
  }

  async recordUsage(input: ReserveQuotaInput): Promise<QuotaReservationResult> {
    const reserved = await this.reserve(input)
    if (!reserved.ok) return reserved
    return this.commit({
      context: input.context,
      reservationId: reserved.reservation.reservationId,
      now: input.now,
    })
  }

  async consume(input: ReserveQuotaInput): Promise<QuotaReservationResult> {
    return this.recordUsage(input)
  }

  async release(input: ReservationActionInput): Promise<QuotaReservationResult> {
    return this.finishReservation(input, RESERVATION_STATUS.RELEASED)
  }

  async usage(context: QuotaContext, resource: string, now?: number): Promise<UsageSnapshot> {
    const policy = await this.dependencies.policies.resolve(context, resource)
    if (!policy) throw new Error('quota_policy_not_found')
    const timestamp = now ?? this.dependencies.clock.now()
    const start = windowStart(timestamp, policy.windowMs)
    const existing = await this.dependencies.ledger.findUsage(usageKey(context, resource, start))
    return (
      existing ??
      emptyUsage(
        context,
        resource,
        'requests',
        start,
        policy.windowMs,
        windowStart(timestamp, policy.rateLimit.windowMs)
      )
    )
  }

  async queryUsage(input: UsageQueryInput): Promise<UsageSnapshot> {
    return this.usage(input.context, input.resource, input.now)
  }

  private async finishReservation(
    input: ReservationActionInput,
    target: typeof RESERVATION_STATUS.COMMITTED | typeof RESERVATION_STATUS.RELEASED
  ): Promise<QuotaReservationResult> {
    if (!validQuotaContext(input.context) || !input.reservationId.trim())
      return failure(QUOTA_RESULT_CODE.INVALID, 'invalid_reservation_action')
    const reservation = await this.dependencies.ledger.findReservation(input.reservationId)
    if (!reservation)
      return failure(QUOTA_RESULT_CODE.RESERVATION_NOT_FOUND, 'reservation_not_found')
    if (
      reservation.tenantId !== input.context.tenantId ||
      reservation.profile !== input.context.profile ||
      reservation.productId !== (input.context.productId ?? null)
    )
      return failure(QUOTA_RESULT_CODE.RESERVATION_CONTEXT_MISMATCH, 'reservation_context_mismatch')
    if (reservation.status !== RESERVATION_STATUS.HELD)
      return failure(QUOTA_RESULT_CODE.RESERVATION_NOT_ACTIVE, 'reservation_not_active')

    const now = input.now ?? this.dependencies.clock.now()
    const usage = await this.dependencies.ledger.findUsage(
      usageKey(input.context, reservation.resource, reservation.usageWindowStart)
    )
    if (!usage)
      return failure(QUOTA_RESULT_CODE.RESERVATION_NOT_FOUND, 'reservation_usage_not_found')
    usage.reservedUnits = Math.max(0, usage.reservedUnits - reservation.units)
    usage.reservedCostUnits = Math.max(0, usage.reservedCostUnits - reservation.costUnits)

    const expired = now >= reservation.expiresAt
    reservation.status = expired ? RESERVATION_STATUS.EXPIRED : target
    reservation.completedAt = now
    if (!expired && target === RESERVATION_STATUS.COMMITTED) {
      usage.units += reservation.units
      usage.costUnits += reservation.costUnits
    }
    await this.dependencies.ledger.saveUsage(usage)
    await this.dependencies.ledger.saveReservation(reservation)
    return { ok: true, reservation: cloneReservation(reservation) }
  }
}

function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs
}

function emptyUsage(
  context: QuotaContext,
  resource: string,
  unit: UsageSnapshot['unit'],
  windowStartValue: number,
  windowMs: number,
  rateWindowStart: number
): UsageSnapshot {
  return {
    contractVersion: QUOTA_CONTRACT_VERSION,
    profile: context.profile,
    tenantId: context.tenantId,
    productId: context.productId ?? null,
    resource,
    unit,
    windowStart: windowStartValue,
    windowEnd: windowStartValue + windowMs,
    rateWindowStart,
    units: 0,
    costUnits: 0,
    reservedUnits: 0,
    reservedCostUnits: 0,
    requestCount: 0,
  }
}

function validAmount(input: ReserveQuotaInput): boolean {
  return (
    Number.isFinite(input.units) &&
    input.units > 0 &&
    Number.isFinite(input.costUnits) &&
    input.costUnits >= 0
  )
}

function failure(
  code: QuotaFailure['code'],
  reason: string,
  details: Partial<QuotaFailure> = {}
): QuotaFailure {
  return { ok: false, code, reason, ...details }
}

export default { QuotaService }
