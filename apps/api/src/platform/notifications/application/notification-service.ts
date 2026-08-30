import {
  cloneNotification,
  NOTIFICATION_RESULT_CODE,
  NOTIFICATION_STATUS,
  validNotificationContext,
  validNotificationRequest,
  type NotificationFailure,
  type NotificationRecord,
  type NotificationRequest,
} from '../domain.js'
import type {
  NotificationEmailMessage,
  NotificationRetryInput,
  NotificationRetryOptions,
  NotificationServiceDependencies,
} from '../ports.js'

export type NotificationOperationResult =
  { ok: true; notification: NotificationRecord; idempotent?: boolean } | NotificationFailure

export class NotificationService {
  private readonly options: Required<NotificationRetryOptions>

  constructor(
    private readonly dependencies: NotificationServiceDependencies,
    options: NotificationRetryOptions = {}
  ) {
    this.options = {
      baseDelayMs: options.baseDelayMs ?? 1_000,
      maxDelayMs: options.maxDelayMs ?? 60_000,
      maxAttempts: options.maxAttempts ?? 3,
    }
  }

  async send(input: NotificationRequest): Promise<NotificationOperationResult> {
    if (!validNotificationContext(input.context) || !validNotificationRequest(input))
      return failure(NOTIFICATION_RESULT_CODE.INVALID, 'invalid_notification_request')
    const context = input.context
    const existing = await this.dependencies.store.findByIdempotency(
      context.tenantId,
      context.workspaceId,
      input.idempotencyKey
    )
    if (existing) return { ok: true, notification: existing, idempotent: true }

    const now = input.now ?? this.dependencies.clock.now()
    const record: NotificationRecord = {
      contractVersion: '1.0.0',
      notificationId: this.dependencies.ids.next(),
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: input.userId,
      recipient: input.recipient,
      category: input.category,
      template: input.template,
      variables: { ...input.variables },
      idempotencyKey: input.idempotencyKey,
      status: NOTIFICATION_STATUS.QUEUED,
      attempts: 0,
      nextAttemptAt: null,
      providerMessageId: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    }
    await this.dependencies.store.save(record)

    const optedIn =
      (await this.dependencies.preferences.isTenantOptedIn(context.tenantId, input.category)) &&
      (await this.dependencies.preferences.isUserOptedIn(
        context.tenantId,
        input.userId,
        input.category
      ))
    if (!optedIn)
      return this.persist({ ...record, status: NOTIFICATION_STATUS.SUPPRESSED, updatedAt: now })

    const quota = await this.dependencies.quota.reserve(context.tenantId, 1)
    if (!quota.allowed) {
      const limited = {
        ...record,
        status: NOTIFICATION_STATUS.QUOTA_EXCEEDED,
        failureReason: 'notification_quota_exceeded',
        updatedAt: now,
      }
      await this.dependencies.store.save(limited)
      return failure(
        NOTIFICATION_RESULT_CODE.QUOTA_EXCEEDED,
        'notification_quota_exceeded',
        limited
      )
    }
    return this.attempt(record, now)
  }

  async retry(input: NotificationRetryInput): Promise<NotificationOperationResult> {
    if (!validNotificationContext(input.context))
      return failure(NOTIFICATION_RESULT_CODE.INVALID, 'invalid_notification_context')
    const context = input.context
    const record = await this.dependencies.store.findById(
      context.tenantId,
      context.workspaceId,
      input.notificationId
    )
    if (!record) return failure(NOTIFICATION_RESULT_CODE.NOT_FOUND, 'notification_not_found')
    const now = input.now ?? this.dependencies.clock.now()
    if (
      record.status === NOTIFICATION_STATUS.SENT ||
      record.status === NOTIFICATION_STATUS.SUPPRESSED
    )
      return { ok: true, notification: record, idempotent: true }
    if (
      record.status === NOTIFICATION_STATUS.QUOTA_EXCEEDED ||
      record.status === NOTIFICATION_STATUS.FAILED
    )
      return failure(
        NOTIFICATION_RESULT_CODE.PROVIDER_FAILED,
        record.failureReason ?? 'notification_not_retryable',
        record
      )
    if (record.nextAttemptAt !== null && now < record.nextAttemptAt)
      return failure(NOTIFICATION_RESULT_CODE.RETRY_NOT_DUE, 'notification_retry_not_due', record)
    return this.attempt(record, now)
  }

  private async attempt(
    record: NotificationRecord,
    now: number
  ): Promise<NotificationOperationResult> {
    const sending = {
      ...record,
      status: NOTIFICATION_STATUS.SENDING,
      attempts: record.attempts + 1,
      updatedAt: now,
    }
    await this.dependencies.store.save(sending)
    try {
      const result = await this.dependencies.provider.send(toEmailMessage(sending))
      return this.persist({
        ...sending,
        status: NOTIFICATION_STATUS.SENT,
        nextAttemptAt: null,
        providerMessageId: result.providerMessageId,
        failureReason: null,
        updatedAt: now,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'notification_provider_failed'
      if (sending.attempts >= this.options.maxAttempts) {
        const failed = {
          ...sending,
          status: NOTIFICATION_STATUS.FAILED,
          nextAttemptAt: null,
          failureReason: reason,
          updatedAt: now,
        }
        await this.dependencies.store.save(failed)
        return failure(NOTIFICATION_RESULT_CODE.PROVIDER_FAILED, reason, failed)
      }
      const delay = Math.min(
        this.options.maxDelayMs,
        this.options.baseDelayMs * 2 ** (sending.attempts - 1)
      )
      const retryable = {
        ...sending,
        status: NOTIFICATION_STATUS.RETRYABLE,
        nextAttemptAt: now + delay,
        failureReason: reason,
        updatedAt: now,
      }
      await this.dependencies.store.save(retryable)
      return this.persist(retryable)
    }
  }

  private async persist(
    record: NotificationRecord
  ): Promise<{ ok: true; notification: NotificationRecord }> {
    await this.dependencies.store.save(record)
    return { ok: true, notification: cloneNotification(record) }
  }
}

function toEmailMessage(record: NotificationRecord): NotificationEmailMessage {
  const title = record.variables['title'] ?? record.template
  const body = record.variables['body'] ?? record.variables['message'] ?? ''
  return {
    emailId: record.notificationId,
    tenantId: record.tenantId,
    recipient: record.recipient,
    template: record.template,
    variables: { ...record.variables },
    rendered: { subject: title, text: body, html: `<p>${escapeHtml(body)}</p>` },
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>\"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character
  )
}

function failure(
  code: NotificationFailure['code'],
  reason: string,
  notification?: NotificationRecord
): NotificationFailure {
  return {
    ok: false,
    code,
    reason,
    ...(notification ? { notification: cloneNotification(notification) } : {}),
  }
}

export default { NotificationService }
