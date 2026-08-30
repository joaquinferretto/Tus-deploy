import {
  clonePolicy,
  cloneReservation,
  cloneUsage,
  quotaScopeKey,
  type QuotaContext,
  type QuotaPolicy,
  type QuotaReservation,
  type UsageSnapshot,
} from '../domain.js'
import type { QuotaClock, QuotaIdGenerator, QuotaLedgerStore, QuotaPolicyStore } from '../ports.js'

export class InMemoryQuotaPolicyStore implements QuotaPolicyStore {
  private readonly revisions = new Map<string, Map<number, QuotaPolicy>>()
  private readonly activeVersions = new Map<string, number>()

  async save(policy: QuotaPolicy): Promise<void> {
    const key = quotaScopeKey(policy.scope, policy.scopeId, policy.resource)
    const versions = this.revisions.get(key) ?? new Map<number, QuotaPolicy>()
    versions.set(policy.version, clonePolicy(policy))
    this.revisions.set(key, versions)
  }

  async history(scopeKey: string): Promise<QuotaPolicy[]> {
    return [...(this.revisions.get(scopeKey)?.values() ?? [])]
      .sort((left, right) => left.version - right.version)
      .map(clonePolicy)
  }

  async find(scopeKey: string, version: number): Promise<QuotaPolicy | undefined> {
    const policy = this.revisions.get(scopeKey)?.get(version)
    return policy ? clonePolicy(policy) : undefined
  }

  async active(scopeKey: string): Promise<QuotaPolicy | undefined> {
    const version = this.activeVersions.get(scopeKey)
    return version === undefined ? undefined : this.find(scopeKey, version)
  }

  async activate(scopeKey: string, version: number): Promise<void> {
    if (!(await this.find(scopeKey, version)))
      throw new Error(`Quota policy not found: ${scopeKey}@${version}`)
    this.activeVersions.set(scopeKey, version)
  }

  async resolve(context: QuotaContext, resource: string): Promise<QuotaPolicy | undefined> {
    const candidates = [
      context.productId ? quotaScopeKey('product', context.productId, resource) : undefined,
      quotaScopeKey('tenant', context.tenantId, resource),
      quotaScopeKey('profile', context.profile, resource),
    ].filter((key): key is string => Boolean(key))

    for (const key of candidates) {
      const policy = await this.active(key)
      if (policy) return policy
    }
    return undefined
  }
}

export class InMemoryQuotaLedgerStore implements QuotaLedgerStore {
  readonly usage = new Map<string, UsageSnapshot>()
  readonly reservations = new Map<string, QuotaReservation>()

  async findUsage(key: string): Promise<UsageSnapshot | undefined> {
    const snapshot = this.usage.get(key)
    return snapshot ? cloneUsage(snapshot) : undefined
  }

  async saveUsage(snapshot: UsageSnapshot): Promise<void> {
    this.usage.set(
      `${snapshot.tenantId}:${snapshot.productId ?? '*'}:${snapshot.profile}:${snapshot.resource}:${snapshot.windowStart}`,
      cloneUsage(snapshot)
    )
  }

  async findReservation(reservationId: string): Promise<QuotaReservation | undefined> {
    const reservation = this.reservations.get(reservationId)
    return reservation ? cloneReservation(reservation) : undefined
  }

  async saveReservation(reservation: QuotaReservation): Promise<void> {
    this.reservations.set(reservation.reservationId, cloneReservation(reservation))
  }
}

export class DeterministicQuotaClock implements QuotaClock {
  constructor(private readonly value: number) {}

  now(): number {
    return this.value
  }
}

export class DeterministicQuotaIdGenerator implements QuotaIdGenerator {
  private sequence = 0

  next(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}

export default {
  InMemoryQuotaPolicyStore,
  InMemoryQuotaLedgerStore,
  DeterministicQuotaClock,
  DeterministicQuotaIdGenerator,
}
