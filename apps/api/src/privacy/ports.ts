import type {
  ConsentRecord,
  LegalHold,
  PrivacyRecord,
  PrivacyRequest,
  RectificationRecord,
  RetentionSchedule,
  RetentionAction,
  PropagationAction,
} from './domain.js'

export interface PrivacyStore {
  readonly records: Map<string, PrivacyRecord>
  readonly consents: Map<string, ConsentRecord>
  readonly requests: Map<string, PrivacyRequest>
  readonly rectifications: Map<string, RectificationRecord>
  readonly schedules: Map<string, RetentionSchedule>
  readonly legalHolds: Map<string, LegalHold>
  saveRecord(record: PrivacyRecord): Promise<void>
  findRecord(recordId: string): Promise<PrivacyRecord | undefined>
  listRecords(tenantId: string, subjectUserId?: string): Promise<PrivacyRecord[]>
  saveConsent(consent: ConsentRecord): Promise<void>
  listConsents(tenantId: string, subjectUserId: string): Promise<ConsentRecord[]>
  saveRequest(request: PrivacyRequest): Promise<void>
  findRequest(tenantId: string, subjectUserId: string, type: string, idempotencyKey: string): Promise<PrivacyRequest | undefined>
  saveRectification(rectification: RectificationRecord): Promise<void>
  findRectification(tenantId: string, recordId: string, idempotencyKey: string): Promise<RectificationRecord | undefined>
  saveSchedule(schedule: RetentionSchedule): Promise<void>
  findSchedule(tenantId: string, resourceType: string, purpose: string): Promise<RetentionSchedule | undefined>
  saveLegalHold(hold: LegalHold): Promise<void>
  listLegalHolds(tenantId: string, subjectUserId?: string, recordId?: string): Promise<LegalHold[]>
}

export interface PrivacyIdGenerator {
  next(prefix: string): string
}

export interface PrivacyClock {
  now(): number
}

export interface PrivacyPropagationRequest {
  action: RetentionAction
  record: PrivacyRecord
  occurredAt: number
}

export interface PrivacyPropagationPort {
  readonly actions: readonly PropagationAction[]
  propagate(request: PrivacyPropagationRequest): Promise<void>
}
