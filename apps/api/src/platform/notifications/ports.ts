import type { NotificationCategory, NotificationContext, NotificationRecord } from './domain.js'

export interface NotificationEmailMessage {
  emailId: string
  tenantId: string
  recipient: string
  template: NotificationRecord['template']
  variables: Readonly<Record<string, string>>
  rendered: { subject: string; text: string; html: string }
}

export interface NotificationEmailProviderPort {
  send(message: NotificationEmailMessage): Promise<{ providerMessageId: string }>
}

export interface NotificationStorePort {
  save(record: NotificationRecord): Promise<void>
  findById(
    tenantId: string,
    workspaceId: string,
    notificationId: string
  ): Promise<NotificationRecord | null>
  findByIdempotency(
    tenantId: string,
    workspaceId: string,
    idempotencyKey: string
  ): Promise<NotificationRecord | null>
}

export interface NotificationPreferencesPort {
  isTenantOptedIn(tenantId: string, category: NotificationCategory): Promise<boolean>
  isUserOptedIn(tenantId: string, userId: string, category: NotificationCategory): Promise<boolean>
}

export interface NotificationQuotaPort {
  reserve(tenantId: string, units: number): Promise<{ allowed: boolean; remaining: number }>
}

export interface NotificationClockPort {
  now(): number
}

export interface NotificationIdPort {
  next(): string
}

export interface NotificationServiceDependencies {
  store: NotificationStorePort
  preferences: NotificationPreferencesPort
  quota: NotificationQuotaPort
  provider: NotificationEmailProviderPort
  clock: NotificationClockPort
  ids: NotificationIdPort
}

export interface NotificationRetryOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
}

export interface NotificationRetryInput {
  context?: NotificationContext
  notificationId: string
  now?: number
}

export default {}
