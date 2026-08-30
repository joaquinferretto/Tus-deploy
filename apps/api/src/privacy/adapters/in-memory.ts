import type {
  ConsentRecord,
  LegalHold,
  PrivacyRecord,
  PrivacyRequest,
  PropagationAction,
  RectificationRecord,
  RetentionSchedule,
} from '../domain.js'
import type {
  PrivacyClock,
  PrivacyIdGenerator,
  PrivacyPropagationPort,
  PrivacyPropagationRequest,
  PrivacyStore,
} from '../ports.js'

function copyRecord(record: PrivacyRecord): PrivacyRecord {
  return {
    ...record,
    values: { ...record.values },
    classifications: { ...record.classifications },
    fieldDefinitions: record.fieldDefinitions.map((definition) => ({ ...definition })),
  }
}

function copyRequest(request: PrivacyRequest): PrivacyRequest {
  return {
    ...request,
    data: request.data
      ? {
          ...request.data,
          records: request.data.records.map((record) => ({ ...record, values: { ...record.values } })),
          consents: request.data.consents.map((consent) => ({ ...consent })),
        }
      : null,
  }
}

export class InMemoryPrivacyStore implements PrivacyStore {
  readonly records = new Map<string, PrivacyRecord>()
  readonly consents = new Map<string, ConsentRecord>()
  readonly requests = new Map<string, PrivacyRequest>()
  readonly rectifications = new Map<string, RectificationRecord>()
  readonly schedules = new Map<string, RetentionSchedule>()
  readonly legalHolds = new Map<string, LegalHold>()

  async saveRecord(record: PrivacyRecord): Promise<void> {
    this.records.set(record.id, copyRecord(record))
  }

  async findRecord(recordId: string): Promise<PrivacyRecord | undefined> {
    const record = this.records.get(recordId)
    return record ? copyRecord(record) : undefined
  }

  async listRecords(tenantId: string, subjectUserId?: string): Promise<PrivacyRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId && (!subjectUserId || record.subjectUserId === subjectUserId))
      .map(copyRecord)
  }

  async saveConsent(consent: ConsentRecord): Promise<void> {
    this.consents.set(this.consentKey(consent.tenantId, consent.subjectUserId, consent.purpose), {
      ...consent,
    })
  }

  async listConsents(tenantId: string, subjectUserId: string): Promise<ConsentRecord[]> {
    return [...this.consents.values()]
      .filter((consent) => consent.tenantId === tenantId && consent.subjectUserId === subjectUserId)
      .map((consent) => ({ ...consent }))
  }

  async saveRequest(request: PrivacyRequest): Promise<void> {
    this.requests.set(this.requestKey(request.tenantId, request.subjectUserId, request.type, request.idempotencyKey), copyRequest(request))
  }

  async findRequest(tenantId: string, subjectUserId: string, type: string, idempotencyKey: string): Promise<PrivacyRequest | undefined> {
    const request = this.requests.get(this.requestKey(tenantId, subjectUserId, type, idempotencyKey))
    return request ? copyRequest(request) : undefined
  }

  async saveRectification(rectification: RectificationRecord): Promise<void> {
    this.rectifications.set(this.rectificationKey(rectification.tenantId, rectification.recordId, rectification.idempotencyKey), {
      ...rectification,
    })
  }

  async findRectification(tenantId: string, recordId: string, idempotencyKey: string): Promise<RectificationRecord | undefined> {
    const rectification = this.rectifications.get(this.rectificationKey(tenantId, recordId, idempotencyKey))
    return rectification ? { ...rectification } : undefined
  }

  async saveSchedule(schedule: RetentionSchedule): Promise<void> {
    this.schedules.set(this.scheduleKey(schedule.tenantId, schedule.resourceType, schedule.purpose), {
      ...schedule,
    })
  }

  async findSchedule(tenantId: string, resourceType: string, purpose: string): Promise<RetentionSchedule | undefined> {
    const schedule = this.schedules.get(this.scheduleKey(tenantId, resourceType, purpose))
    return schedule ? { ...schedule } : undefined
  }

  async saveLegalHold(hold: LegalHold): Promise<void> {
    this.legalHolds.set(hold.id, { ...hold })
  }

  async listLegalHolds(tenantId: string, subjectUserId?: string, recordId?: string): Promise<LegalHold[]> {
    return [...this.legalHolds.values()]
      .filter(
        (hold) =>
          hold.tenantId === tenantId &&
          (!subjectUserId || hold.subjectUserId === subjectUserId) &&
          (!recordId || hold.recordId === null || hold.recordId === recordId)
      )
      .map((hold) => ({ ...hold }))
  }

  private consentKey(tenantId: string, subjectUserId: string, purpose: string): string {
    return `${tenantId}:${subjectUserId}:${purpose}`
  }

  private requestKey(tenantId: string, subjectUserId: string, type: string, idempotencyKey: string): string {
    return `${tenantId}:${subjectUserId}:${type}:${idempotencyKey}`
  }

  private rectificationKey(tenantId: string, recordId: string, idempotencyKey: string): string {
    return `${tenantId}:${recordId}:${idempotencyKey}`
  }

  private scheduleKey(tenantId: string, resourceType: string, purpose: string): string {
    return `${tenantId}:${resourceType}:${purpose}`
  }
}

export class DeterministicPrivacyIdGenerator implements PrivacyIdGenerator {
  private sequence = 0

  next(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}

export class SystemPrivacyClock implements PrivacyClock {
  now(): number {
    return Date.now()
  }
}

export class InMemoryPrivacyPropagationAdapter implements PrivacyPropagationPort {
  readonly actions: PropagationAction[] = []
  failNext = false

  async propagate(request: PrivacyPropagationRequest): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('privacy propagation unavailable; retryable local boundary failure')
    }
    this.actions.push({
      action: request.action,
      recordId: request.record.id,
      tenantId: request.record.tenantId,
      subjectUserId: request.record.subjectUserId,
      occurredAt: request.occurredAt,
    })
  }
}

export class UnavailablePrivacyPropagationAdapter implements PrivacyPropagationPort {
  readonly actions: readonly PropagationAction[] = []

  async propagate(_request: PrivacyPropagationRequest): Promise<void> {
    throw new Error('durable privacy propagation is not activated')
  }
}
