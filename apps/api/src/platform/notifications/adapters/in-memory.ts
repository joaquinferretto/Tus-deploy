import {
  cloneNotification,
  type NotificationCategory,
  type NotificationContext,
  type NotificationRecord,
} from '../domain.js'
import type {
  NotificationClockPort,
  NotificationEmailMessage,
  NotificationEmailProviderPort,
  NotificationIdPort,
  NotificationPreferencesPort,
  NotificationQuotaPort,
  NotificationStorePort,
} from '../ports.js'

function key(tenantId: string, workspaceId: string, value: string): string {
  return `${tenantId}:${workspaceId}:${value}`
}

export class InMemoryNotificationStore implements NotificationStorePort {
  readonly records = new Map<string, NotificationRecord>()
  readonly idempotency = new Map<string, string>()

  async save(record: NotificationRecord): Promise<void> {
    const cloned = cloneNotification(record)
    this.records.set(key(record.tenantId, record.workspaceId, record.notificationId), cloned)
    this.idempotency.set(
      key(record.tenantId, record.workspaceId, record.idempotencyKey),
      record.notificationId
    )
  }

  async findById(
    tenantId: string,
    workspaceId: string,
    notificationId: string
  ): Promise<NotificationRecord | null> {
    const record = this.records.get(key(tenantId, workspaceId, notificationId))
    return record ? cloneNotification(record) : null
  }

  async findByIdempotency(
    tenantId: string,
    workspaceId: string,
    idempotencyKey: string
  ): Promise<NotificationRecord | null> {
    const notificationId = this.idempotency.get(key(tenantId, workspaceId, idempotencyKey))
    return notificationId ? this.findById(tenantId, workspaceId, notificationId) : null
  }
}

export class InMemoryNotificationPreferences implements NotificationPreferencesPort {
  private readonly tenantPreferences = new Map<string, boolean>()
  private readonly userPreferences = new Map<string, boolean>()

  setTenantOptIn(tenantId: string, enabled: boolean): void {
    this.tenantPreferences.set(tenantId, enabled)
  }

  setUserOptIn(
    tenantId: string,
    userId: string,
    enabled: boolean,
    category: NotificationCategory = 'product'
  ): void {
    this.userPreferences.set(`${tenantId}:${userId}:${category}`, enabled)
  }

  async isTenantOptedIn(tenantId: string, _category: NotificationCategory): Promise<boolean> {
    return this.tenantPreferences.get(tenantId) === true
  }

  async isUserOptedIn(
    tenantId: string,
    userId: string,
    category: NotificationCategory
  ): Promise<boolean> {
    return this.userPreferences.get(`${tenantId}:${userId}:${category}`) === true
  }
}

export class InMemoryNotificationQuota implements NotificationQuotaPort {
  private readonly limits = new Map<string, number>()
  private readonly used = new Map<string, number>()

  setLimit(tenantId: string, limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new Error('notification quota must be a non-negative integer')
    this.limits.set(tenantId, limit)
  }

  async reserve(tenantId: string, units: number): Promise<{ allowed: boolean; remaining: number }> {
    const limit = this.limits.get(tenantId) ?? 100
    const current = this.used.get(tenantId) ?? 0
    if (current + units > limit) return { allowed: false, remaining: Math.max(0, limit - current) }
    this.used.set(tenantId, current + units)
    return { allowed: true, remaining: limit - current - units }
  }
}

export class DeterministicNotificationEmailProvider implements NotificationEmailProviderPort {
  readonly sent: NotificationEmailMessage[] = []
  failNext = 0
  available = true

  async send(message: NotificationEmailMessage): Promise<{ providerMessageId: string }> {
    if (!this.available) throw providerUnavailable('deterministic email provider outage')
    if (this.failNext > 0) {
      this.failNext -= 1
      throw providerUnavailable('deterministic email provider failure')
    }
    this.sent.push({
      ...message,
      variables: { ...message.variables },
      rendered: { ...message.rendered },
    })
    return { providerMessageId: `fake-notification-email-${this.sent.length}` }
  }
}

export class DeterministicNotificationClock implements NotificationClockPort {
  constructor(private readonly value: number) {}

  now(): number {
    return this.value
  }
}

export class DeterministicNotificationIdGenerator implements NotificationIdPort {
  private sequence = 0

  next(): string {
    this.sequence += 1
    return `notification-${this.sequence}`
  }
}

export function providerUnavailable(reason: string): Error & { code: 'PROVIDER_UNAVAILABLE' } {
  const error = new Error(reason) as Error & { code: 'PROVIDER_UNAVAILABLE' }
  error.code = 'PROVIDER_UNAVAILABLE'
  return error
}

export function validNotificationContext(context: NotificationContext): boolean {
  return Boolean(
    context.tenantId && context.workspaceId && context.actorId && context.correlationId
  )
}

export default {
  InMemoryNotificationStore,
  InMemoryNotificationPreferences,
  InMemoryNotificationQuota,
  DeterministicNotificationEmailProvider,
  DeterministicNotificationClock,
  DeterministicNotificationIdGenerator,
}
