import { digestAuditValue, type AuditSink } from '../../audit/index.js'
import {
  CONSENT_REQUIRED_PURPOSES,
  DATA_PURPOSE,
  PRIVACY_REQUEST_STATUS,
  PRIVACY_REQUEST_TYPE,
  PRIVACY_RESULT_CODE,
  RETENTION_ACTION,
  anonymizeFields,
  classifyFields,
  digestPrivacyValue,
  redactFields,
  validPrivacyContext,
  type ConsentRecord,
  type DataPurpose,
  type FieldDefinition,
  type LegalHold,
  type PrivacyContext,
  type PrivacyExportData,
  type PrivacyFailure,
  type PrivacyRecord,
  type PrivacyRequest,
  type PrivacyRequestType,
  type PrivacyResultCode,
  type RectificationRecord,
  type RetentionAction,
} from '../domain.js'
import type {
  PrivacyClock,
  PrivacyIdGenerator,
  PrivacyPropagationPort,
  PrivacyStore,
} from '../ports.js'

export interface PrivacyServiceDependencies {
  store: PrivacyStore
  audit: AuditSink
  ids: PrivacyIdGenerator
  clock: PrivacyClock
  propagation: PrivacyPropagationPort
}

export interface RegisterPrivacyRecordInput {
  context?: PrivacyContext
  recordId: string
  subjectUserId: string
  resourceType: string
  purpose: DataPurpose
  fields: Record<string, unknown>
  fieldDefinitions: FieldDefinition[]
}

export interface ConsentInput {
  context?: PrivacyContext
  subjectUserId: string
  purpose: DataPurpose
  version: string
  granted: boolean
}

export interface PrivacyRequestInput {
  context?: PrivacyContext
  subjectUserId: string
  idempotencyKey: string
}

export interface RectifyInput {
  context?: PrivacyContext
  recordId: string
  values: Record<string, unknown>
  idempotencyKey: string
}

export interface RetentionScheduleInput {
  context?: PrivacyContext
  resourceType: string
  purpose: DataPurpose
  retentionMs: number
  action: RetentionAction
}

export interface LegalHoldInput {
  context?: PrivacyContext
  subjectUserId: string
  recordId?: string
  reason: string
}

export interface RetentionRunInput {
  context?: PrivacyContext
  now?: number
}

export type RecordResult = { ok: true; record: PrivacyRecord } | PrivacyFailure
export type ConsentResult = { ok: true; consent: ConsentRecord } | PrivacyFailure
export type RequestResult =
  | { ok: true; request: PrivacyRequest; data: PrivacyExportData | null; idempotent?: boolean }
  | (PrivacyFailure & { request?: PrivacyRequest })
export type RectifyResult = { ok: true; record: PrivacyRecord; idempotent?: boolean } | PrivacyFailure
export type LegalHoldResult = { ok: true; hold: LegalHold } | PrivacyFailure
export type OperationResult = { ok: true } | PrivacyFailure
export interface RetentionRunResult {
  ok: true
  purged: number
  anonymized: number
  held: number
  failed: number
}

const SELF_SERVICE_ACTIONS = new Set(['access', 'export', 'delete', 'rectify', 'consent'])
const KNOWN_PURPOSES = new Set<DataPurpose>(Object.values(DATA_PURPOSE))
const KNOWN_RETENTION_ACTIONS = new Set<RetentionAction>(Object.values(RETENTION_ACTION))

export class PrivacyService {
  constructor(private readonly dependencies: PrivacyServiceDependencies) {}

  async registerRecord(input: RegisterPrivacyRecordInput): Promise<RecordResult> {
    if (!validPrivacyContext(input.context))
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'invalid_privacy_context')
    if (
      !input.recordId.trim() ||
      !input.subjectUserId.trim() ||
      !input.resourceType.trim() ||
      !KNOWN_PURPOSES.has(input.purpose) ||
      input.fieldDefinitions.length === 0
    ) {
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'invalid_privacy_record')
    }
    if (CONSENT_REQUIRED_PURPOSES.has(input.purpose)) {
      const consent = await this.hasConsent(input.context.tenantId, input.subjectUserId, input.purpose)
      if (!consent) return this.failure(input.context, PRIVACY_RESULT_CODE.CONSENT_REQUIRED, 'consent_required')
    }
    const existing = await this.dependencies.store.findRecord(input.recordId)
    if (existing && existing.tenantId !== input.context.tenantId)
      return this.failure(input.context, PRIVACY_RESULT_CODE.NOT_FOUND, 'privacy_record_not_found')
    if (existing) return this.failure(input.context, PRIVACY_RESULT_CODE.CONFLICT, 'privacy_record_exists')
    const classified = classifyFields(input.fields, input.fieldDefinitions)
    if (classified.missingRequiredFields.length > 0)
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'required_privacy_field_missing')
    const now = this.dependencies.clock.now()
    const record: PrivacyRecord = {
      id: input.recordId,
      tenantId: input.context.tenantId,
      subjectUserId: input.subjectUserId,
      resourceType: input.resourceType.trim(),
      purpose: input.purpose,
      values: classified.values,
      classifications: classified.classifications,
      fieldDefinitions: input.fieldDefinitions.map((definition) => ({ ...definition })),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      anonymizedAt: null,
    }
    await this.dependencies.store.saveRecord(record)
    await this.record(input.context, 'privacy:record:create', 'success', 'privacy_record_created', {
      recordIdHash: digestAuditValue(record.id),
      fieldCount: Object.keys(record.values).length,
      purpose: record.purpose,
    })
    return { ok: true, record }
  }

  async recordConsent(input: ConsentInput): Promise<ConsentResult> {
    const permission = await this.authorize(input.context, 'consent', input.subjectUserId)
    if (!permission.ok) return permission
    if (!KNOWN_PURPOSES.has(input.purpose) || !input.version.trim())
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'invalid_consent')
    const recordedAt = this.dependencies.clock.now()
    const consent: ConsentRecord = {
      id: this.dependencies.ids.next('consent'),
      tenantId: input.context?.tenantId ?? '',
      subjectUserId: input.subjectUserId,
      purpose: input.purpose,
      version: input.version.trim(),
      granted: input.granted,
      recordedAt,
      withdrawnAt: input.granted ? null : recordedAt,
    }
    await this.dependencies.store.saveConsent(consent)
    await this.record(input.context, 'privacy:consent', 'success', input.granted ? 'consent_granted' : 'consent_withdrawn', {
      subjectUserIdHash: digestPrivacyValue(input.subjectUserId),
      purpose: input.purpose,
      version: consent.version,
      granted: consent.granted,
    })
    if (!input.granted && CONSENT_REQUIRED_PURPOSES.has(input.purpose)) {
      await this.removePurposeData(consent.tenantId, consent.subjectUserId, input.purpose)
    }
    return { ok: true, consent }
  }

  async withdrawConsent(input: Omit<ConsentInput, 'granted'>): Promise<ConsentResult> {
    return this.recordConsent({ ...input, granted: false })
  }

  async requestExport(input: PrivacyRequestInput): Promise<RequestResult> {
    return this.requestData(input, PRIVACY_REQUEST_TYPE.EXPORT)
  }

  async requestAccess(input: PrivacyRequestInput): Promise<RequestResult> {
    return this.requestData(input, PRIVACY_REQUEST_TYPE.ACCESS)
  }

  async requestDeletion(input: PrivacyRequestInput): Promise<RequestResult> {
    const permission = await this.authorize(input.context, 'delete', input.subjectUserId)
    if (!permission.ok) return permission
    if (!input.idempotencyKey.trim())
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'idempotency_key_required')
    if (this.subjectExistsOutsideTenant(input.context?.tenantId ?? '', input.subjectUserId))
      return this.failure(input.context, PRIVACY_RESULT_CODE.NOT_FOUND, 'privacy_subject_not_found')

    const existing = await this.dependencies.store.findRequest(
      input.context?.tenantId ?? '',
      input.subjectUserId,
      PRIVACY_REQUEST_TYPE.DELETE,
      input.idempotencyKey
    )
    if (existing?.status === PRIVACY_REQUEST_STATUS.COMPLETED)
      return { ok: true, request: existing, data: null, idempotent: true }
    const request =
      existing ??
      this.newRequest(input.context?.tenantId ?? '', input.subjectUserId, PRIVACY_REQUEST_TYPE.DELETE, input.idempotencyKey, input.context?.actorId ?? '')
    const holds = await this.dependencies.store.listLegalHolds(input.context?.tenantId ?? '', input.subjectUserId)
    if (holds.some((hold) => hold.releasedAt === null)) {
      request.status = PRIVACY_REQUEST_STATUS.HELD
      request.attemptCount += 1
      request.lastError = 'legal_hold_active'
      await this.dependencies.store.saveRequest(request)
      await this.record(input.context, 'privacy:delete', 'denied', 'legal_hold_active', {
        requestIdHash: digestPrivacyValue(request.id),
      })
      return { ok: false, code: PRIVACY_RESULT_CODE.HELD, message: 'legal_hold_active', request }
    }
    return this.executeDeletion(input.context, request)
  }

  async rectify(input: RectifyInput): Promise<RectifyResult> {
    const record = await this.dependencies.store.findRecord(input.recordId)
    if (!record || record.tenantId !== input.context?.tenantId)
      return this.failure(input.context, PRIVACY_RESULT_CODE.NOT_FOUND, 'privacy_record_not_found')
    const permission = await this.authorize(input.context, 'rectify', record.subjectUserId)
    if (!permission.ok) return permission
    if (!input.idempotencyKey.trim())
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'idempotency_key_required')
    if (record.deletedAt !== null)
      return this.failure(input.context, PRIVACY_RESULT_CODE.CONFLICT, 'privacy_record_deleted')
    const previous = await this.dependencies.store.findRectification(
      record.tenantId,
      record.id,
      input.idempotencyKey
    )
    if (previous) return { ok: true, record, idempotent: true }
    const classified = classifyFields(input.values, record.fieldDefinitions)
    if (classified.missingRequiredFields.length > 0 || Object.keys(classified.values).length === 0)
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'invalid_rectification')
    record.values = { ...record.values, ...classified.values }
    record.classifications = { ...record.classifications, ...classified.classifications }
    record.updatedAt = this.dependencies.clock.now()
    await this.dependencies.store.saveRecord(record)
    const rectification: RectificationRecord = {
      id: this.dependencies.ids.next('rectification'),
      tenantId: record.tenantId,
      recordId: record.id,
      subjectUserId: record.subjectUserId,
      idempotencyKey: input.idempotencyKey,
      updatedAt: record.updatedAt,
    }
    await this.dependencies.store.saveRectification(rectification)
    await this.record(input.context, 'privacy:rectify', 'success', 'privacy_record_rectified', {
      recordIdHash: digestPrivacyValue(record.id),
      fieldCount: Object.keys(classified.values).length,
    })
    return { ok: true, record }
  }

  async setRetentionSchedule(input: RetentionScheduleInput): Promise<OperationResult> {
    const permission = await this.authorize(input.context, 'retention', input.context?.actorId ?? '')
    if (!permission.ok) return permission
    if (
      !input.resourceType.trim() ||
      !KNOWN_PURPOSES.has(input.purpose) ||
      !KNOWN_RETENTION_ACTIONS.has(input.action) ||
      !Number.isFinite(input.retentionMs) ||
      input.retentionMs < 0
    ) {
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'invalid_retention_schedule')
    }
    await this.dependencies.store.saveSchedule({
      tenantId: input.context?.tenantId ?? '',
      resourceType: input.resourceType.trim(),
      purpose: input.purpose,
      retentionMs: input.retentionMs,
      action: input.action,
      updatedAt: this.dependencies.clock.now(),
    })
    await this.record(input.context, 'privacy:retention:schedule', 'success', 'retention_schedule_updated', {
      resourceType: input.resourceType.trim(),
      purpose: input.purpose,
      retentionMs: input.retentionMs,
      action: input.action,
    })
    return { ok: true }
  }

  async addLegalHold(input: LegalHoldInput): Promise<LegalHoldResult> {
    const permission = await this.authorize(input.context, 'hold', input.subjectUserId)
    if (!permission.ok) return permission
    if (!input.reason.trim()) return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'hold_reason_required')
    if (input.recordId) {
      const record = await this.dependencies.store.findRecord(input.recordId)
      if (!record || record.tenantId !== input.context?.tenantId || record.subjectUserId !== input.subjectUserId)
        return this.failure(input.context, PRIVACY_RESULT_CODE.NOT_FOUND, 'privacy_record_not_found')
    }
    const active = (await this.dependencies.store.listLegalHolds(input.context?.tenantId ?? '', input.subjectUserId, input.recordId)).find(
      (hold) => hold.releasedAt === null && (hold.recordId === input.recordId || (!hold.recordId && !input.recordId))
    )
    if (active) return { ok: true, hold: active }
    const hold: LegalHold = {
      id: this.dependencies.ids.next('hold'),
      tenantId: input.context?.tenantId ?? '',
      subjectUserId: input.subjectUserId,
      recordId: input.recordId ?? null,
      reasonDigest: digestAuditValue(input.reason.trim()),
      createdAt: this.dependencies.clock.now(),
      releasedAt: null,
    }
    await this.dependencies.store.saveLegalHold(hold)
    await this.record(input.context, 'privacy:legal-hold:add', 'success', 'legal_hold_added', {
      holdIdHash: digestPrivacyValue(hold.id),
      subjectUserIdHash: digestPrivacyValue(hold.subjectUserId),
      recordIdHash: hold.recordId ? digestPrivacyValue(hold.recordId) : null,
    })
    return { ok: true, hold }
  }

  async releaseLegalHold(input: Omit<LegalHoldInput, 'reason'>): Promise<OperationResult> {
    const permission = await this.authorize(input.context, 'hold', input.subjectUserId)
    if (!permission.ok) return permission
    const holds = await this.dependencies.store.listLegalHolds(input.context?.tenantId ?? '', input.subjectUserId, input.recordId)
    const now = this.dependencies.clock.now()
    for (const hold of holds) {
      if (hold.releasedAt === null) {
        hold.releasedAt = now
        await this.dependencies.store.saveLegalHold(hold)
      }
    }
    await this.record(input.context, 'privacy:legal-hold:release', 'success', 'legal_hold_released', {
      subjectUserIdHash: digestPrivacyValue(input.subjectUserId),
      releasedCount: holds.filter((hold) => hold.releasedAt === now).length,
    })
    return { ok: true }
  }

  async runRetention(input: RetentionRunInput): Promise<RetentionRunResult> {
    const permission = await this.authorize(input.context, 'retention', input.context?.actorId ?? '')
    if (!permission.ok) return { ok: true, purged: 0, anonymized: 0, held: 0, failed: 0 }
    const now = input.now ?? this.dependencies.clock.now()
    const records = await this.dependencies.store.listRecords(input.context?.tenantId ?? '')
    let purged = 0
    let anonymized = 0
    let held = 0
    let failed = 0
    for (const record of records) {
      if (record.deletedAt !== null || record.anonymizedAt !== null) continue
      const schedule = await this.dependencies.store.findSchedule(record.tenantId, record.resourceType, record.purpose)
      if (!schedule || record.createdAt + schedule.retentionMs > now) continue
      const holds = await this.dependencies.store.listLegalHolds(record.tenantId, record.subjectUserId, record.id)
      if (holds.some((hold) => hold.releasedAt === null)) {
        held += 1
        continue
      }
      try {
        await this.dependencies.propagation.propagate({ action: schedule.action, record, occurredAt: now })
        if (schedule.action === RETENTION_ACTION.DELETE) {
          record.values = {}
          record.deletedAt = now
          purged += 1
        } else {
          record.values = anonymizeFields(record.values, record.classifications)
          record.anonymizedAt = now
          anonymized += 1
        }
        record.updatedAt = now
        await this.dependencies.store.saveRecord(record)
        await this.record(input.context, 'privacy:retention:execute', 'success', 'retention_applied', {
          recordIdHash: digestPrivacyValue(record.id),
          action: schedule.action,
        })
      } catch {
        failed += 1
      }
    }
    return { ok: true, purged, anonymized, held, failed }
  }

  private async requestData(input: PrivacyRequestInput, type: PrivacyRequestType): Promise<RequestResult> {
    const permission = await this.authorize(input.context, type, input.subjectUserId)
    if (!permission.ok) return permission
    if (!input.idempotencyKey.trim())
      return this.failure(input.context, PRIVACY_RESULT_CODE.INVALID, 'idempotency_key_required')
    if (this.subjectExistsOutsideTenant(input.context?.tenantId ?? '', input.subjectUserId))
      return this.failure(input.context, PRIVACY_RESULT_CODE.NOT_FOUND, 'privacy_subject_not_found')
    const existing = await this.dependencies.store.findRequest(
      input.context?.tenantId ?? '',
      input.subjectUserId,
      type,
      input.idempotencyKey
    )
    if (existing?.status === PRIVACY_REQUEST_STATUS.COMPLETED)
      return { ok: true, request: existing, data: existing.data, idempotent: true }
    const request =
      existing ??
      this.newRequest(input.context?.tenantId ?? '', input.subjectUserId, type, input.idempotencyKey, input.context?.actorId ?? '')
    const records = await this.dependencies.store.listRecords(request.tenantId, request.subjectUserId)
    request.data = this.exportData(request.subjectUserId, records, await this.dependencies.store.listConsents(request.tenantId, request.subjectUserId))
    request.status = PRIVACY_REQUEST_STATUS.COMPLETED
    request.completedAt = this.dependencies.clock.now()
    request.attemptCount += 1
    request.lastError = null
    await this.dependencies.store.saveRequest(request)
    await this.record(input.context, `privacy:${type}`, 'success', `privacy_${type}_completed`, {
      requestIdHash: digestPrivacyValue(request.id),
      recordCount: request.data.records.length,
    })
    return { ok: true, request, data: request.data }
  }

  private async executeDeletion(context: PrivacyContext | undefined, request: PrivacyRequest): Promise<RequestResult> {
    const records = await this.dependencies.store.listRecords(request.tenantId, request.subjectUserId)
    request.status = PRIVACY_REQUEST_STATUS.PENDING
    request.attemptCount += 1
    request.lastError = null
    await this.dependencies.store.saveRequest(request)
    try {
      const now = this.dependencies.clock.now()
      for (const record of records) {
        if (record.deletedAt !== null) continue
        await this.dependencies.propagation.propagate({ action: RETENTION_ACTION.DELETE, record, occurredAt: now })
        record.values = {}
        record.deletedAt = now
        record.updatedAt = now
        await this.dependencies.store.saveRecord(record)
      }
      request.status = PRIVACY_REQUEST_STATUS.COMPLETED
      request.completedAt = now
      await this.dependencies.store.saveRequest(request)
      await this.record(context, 'privacy:delete', 'success', 'privacy_delete_completed', {
        requestIdHash: digestPrivacyValue(request.id),
        recordCount: records.length,
      })
      return { ok: true, request, data: null }
    } catch {
      request.status = PRIVACY_REQUEST_STATUS.FAILED
      request.lastError = 'privacy_propagation_failed'
      await this.dependencies.store.saveRequest(request)
      await this.record(context, 'privacy:delete', 'denied', 'privacy_propagation_failed', {
        requestIdHash: digestPrivacyValue(request.id),
      })
      return { ok: false, code: PRIVACY_RESULT_CODE.FAILED, message: 'privacy_propagation_failed', request }
    }
  }

  private async removePurposeData(
    tenantId: string,
    subjectUserId: string,
    purpose: DataPurpose
  ): Promise<void> {
    const records = (await this.dependencies.store.listRecords(tenantId, subjectUserId)).filter(
      (record) => record.purpose === purpose && record.deletedAt === null
    )
    for (const record of records) {
      const holds = await this.dependencies.store.listLegalHolds(record.tenantId, record.subjectUserId, record.id)
      if (holds.some((hold) => hold.releasedAt === null)) {
        await this.record(
          { tenantId, actorId: subjectUserId, correlationId: 'privacy-consent-withdrawal' },
          'privacy:consent:cleanup',
          'denied',
          'legal_hold_active',
          { recordIdHash: digestPrivacyValue(record.id), purpose }
        )
        continue
      }
      try {
        await this.dependencies.propagation.propagate({
          action: RETENTION_ACTION.DELETE,
          record,
          occurredAt: this.dependencies.clock.now(),
        })
        record.values = {}
        record.deletedAt = this.dependencies.clock.now()
        record.updatedAt = record.deletedAt
        await this.dependencies.store.saveRecord(record)
        await this.record(
          { tenantId, actorId: subjectUserId, correlationId: 'privacy-consent-withdrawal' },
          'privacy:consent:cleanup',
          'success',
          'purpose_data_removed',
          { recordIdHash: digestPrivacyValue(record.id), purpose }
        )
      } catch {
        await this.record(
          { tenantId, actorId: subjectUserId, correlationId: 'privacy-consent-withdrawal' },
          'privacy:consent:cleanup',
          'denied',
          'privacy_propagation_failed',
          { recordIdHash: digestPrivacyValue(record.id), purpose }
        )
      }
    }
  }

  private exportData(
    subjectUserId: string,
    records: PrivacyRecord[],
    consents: ConsentRecord[]
  ): PrivacyExportData {
    return {
      subjectUserIdHash: digestPrivacyValue(subjectUserId),
      records: records.map((record) => ({
        id: record.id,
        resourceType: record.resourceType,
        purpose: record.purpose,
        values: redactFields(record.values, record.classifications),
        createdAt: record.createdAt,
        deletedAt: record.deletedAt,
      })),
      consents: consents.map((consent) => ({
        purpose: consent.purpose,
        version: consent.version,
        granted: consent.granted,
        recordedAt: consent.recordedAt,
      })),
    }
  }

  private newRequest(
    tenantId: string,
    subjectUserId: string,
    type: PrivacyRequestType,
    idempotencyKey: string,
    requestedBy: string
  ): PrivacyRequest {
    return {
      id: this.dependencies.ids.next(`privacy-${type}`),
      tenantId,
      subjectUserId,
      type,
      idempotencyKey,
      requestedBy,
      status: PRIVACY_REQUEST_STATUS.PENDING,
      createdAt: this.dependencies.clock.now(),
      completedAt: null,
      attemptCount: 0,
      lastError: null,
      data: null,
    }
  }

  private async hasConsent(tenantId: string, subjectUserId: string, purpose: DataPurpose): Promise<boolean> {
    const consents = await this.dependencies.store.listConsents(tenantId, subjectUserId)
    const consent = consents.filter((entry) => entry.purpose === purpose).at(-1)
    return consent?.granted === true
  }

  private subjectExistsOutsideTenant(tenantId: string, subjectUserId: string): boolean {
    return [...this.dependencies.store.records.values()].some(
      (record) => record.subjectUserId === subjectUserId && record.tenantId !== tenantId
    )
  }

  private async authorize(
    context: PrivacyContext | undefined,
    action: string,
    subjectUserId: string
  ): Promise<{ ok: true } | PrivacyFailure> {
    if (!validPrivacyContext(context))
      return this.failure(context, PRIVACY_RESULT_CODE.INVALID, 'invalid_privacy_context')
    if (context.actorId === subjectUserId && SELF_SERVICE_ACTIONS.has(action)) return { ok: true }
    if (context.permissions?.includes(`privacy:${action}`)) return { ok: true }
    return this.failure(context, PRIVACY_RESULT_CODE.FORBIDDEN, 'privacy_permission_denied')
  }

  private async record(
    context: PrivacyContext | undefined,
    action: string,
    outcome: 'success' | 'denied',
    reason: string,
    metadata: Record<string, string | number | boolean | null>
  ): Promise<void> {
    await this.dependencies.audit.record(
      {
        action,
        actorId: context?.actorId?.trim() || null,
        productId: null,
        tenantId: context?.tenantId?.trim() || null,
        correlationId: context?.correlationId?.trim() || 'missing-correlation',
        outcome,
        reason,
        metadata,
      },
      this.dependencies.clock.now()
    )
  }

  private async failure(
    context: PrivacyContext | undefined,
    code: PrivacyResultCode,
    message: string
  ): Promise<PrivacyFailure> {
    await this.record(context, 'privacy:operation', 'denied', message, {})
    return { ok: false, code, message }
  }
}
