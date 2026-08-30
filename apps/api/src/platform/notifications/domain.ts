export const NOTIFICATION_CONTRACT_VERSION = '1.0.0' as const

export const NOTIFICATION_STATUS = {
  QUEUED: 'queued',
  SENDING: 'sending',
  SENT: 'sent',
  RETRYABLE: 'retryable',
  FAILED: 'failed',
  SUPPRESSED: 'suppressed',
  QUOTA_EXCEEDED: 'quota_exceeded',
} as const

export type NotificationStatus = (typeof NOTIFICATION_STATUS)[keyof typeof NOTIFICATION_STATUS]

export const NOTIFICATION_RESULT_CODE = {
  INVALID: 'INVALID',
  NOT_FOUND: 'NOT_FOUND',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  RETRY_NOT_DUE: 'RETRY_NOT_DUE',
} as const

export type NotificationResultCode =
  (typeof NOTIFICATION_RESULT_CODE)[keyof typeof NOTIFICATION_RESULT_CODE]

export type NotificationCategory = 'product' | 'security' | 'marketing'
export type NotificationTemplate = 'verification' | 'recovery' | 'invitation' | 'notification'

export interface NotificationContext {
  tenantId: string
  workspaceId: string
  actorId: string
  correlationId: string
}

export interface NotificationRequest {
  context?: NotificationContext
  userId: string
  recipient: string
  category: NotificationCategory
  template: NotificationTemplate
  variables: Readonly<Record<string, string>>
  idempotencyKey: string
  now?: number
}

export interface NotificationRecord {
  contractVersion: typeof NOTIFICATION_CONTRACT_VERSION
  notificationId: string
  tenantId: string
  workspaceId: string
  userId: string
  recipient: string
  category: NotificationCategory
  template: NotificationTemplate
  variables: Readonly<Record<string, string>>
  idempotencyKey: string
  status: NotificationStatus
  attempts: number
  nextAttemptAt: number | null
  providerMessageId: string | null
  failureReason: string | null
  createdAt: number
  updatedAt: number
}

export interface NotificationFailure {
  ok: false
  code: NotificationResultCode
  reason: string
  notification?: NotificationRecord
}

export function validNotificationContext(
  context: NotificationContext | undefined
): context is NotificationContext {
  return Boolean(
    context?.tenantId.trim() &&
    context.workspaceId.trim() &&
    context.actorId.trim() &&
    context.correlationId.trim()
  )
}

export function validNotificationRequest(input: NotificationRequest): boolean {
  return Boolean(
    input.userId.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient) &&
    input.idempotencyKey.trim() &&
    input.category &&
    input.template
  )
}

export function cloneNotification(record: NotificationRecord): NotificationRecord {
  return { ...record, variables: { ...record.variables } }
}

export default {
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_STATUS,
  NOTIFICATION_RESULT_CODE,
  validNotificationContext,
  validNotificationRequest,
}
