import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { TusOperationsTelemetry } from '@factory/observability'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../readiness/index.ts'

const SUPPORT_PERMISSIONS = {
  WRITE: 'tus:support:write',
  DECIDE: 'tus:disputes:decide',
} as const

export const SUPPORT_OUTBOX_EVENT_TYPES = {
  CASE_OPENED: 'support.case.opened',
  EVIDENCE_SUBMITTED: 'support.evidence.submitted',
  CASE_RESOLVED: 'support.case.resolved',
} as const

const CASE_STATUS = {
  OPEN: 'open',
  RESOLVED: 'resolved',
} as const

const DISPUTE_OUTCOMES = {
  NO_REFUND: 'no-refund',
  PARTIAL_REFUND: 'partial-refund',
  FULL_REFUND: 'full-refund',
} as const

type CaseStatus = (typeof CASE_STATUS)[keyof typeof CASE_STATUS]
type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[keyof typeof DISPUTE_OUTCOMES]
type EvidenceParty = 'customer' | 'merchant'

export interface SupportCase {
  caseId: string
  disputeId: string
  tenantId: string
  correlationId: string
  commitmentId: string
  openedBy: string
  category: string
  status: CaseStatus
  outcome: DisputeOutcome | null
  createdAt: string
  resolvedAt: string | null
}

export interface SupportEvidence {
  evidenceId: string
  caseId: string
  tenantId: string
  correlationId: string
  party: EvidenceParty
  summary: string
  submittedBy: string
  createdAt: string
}

export interface SupportTimelineEntry {
  entryId: string
  caseId: string
  tenantId: string
  correlationId: string
  action: string
  actorId: string
  createdAt: string
}

export interface SupportCompensatingEntry {
  entryId: string
  caseId: string
  tenantId: string
  correlationId: string
  amount: number
  currency: 'ARS'
  reason: string
  status: 'recorded'
  settlement: 'not-released'
}

export interface SupportOutboxRecord {
  eventId: string
  tenantId: string
  correlationId: string
  eventType: (typeof SUPPORT_OUTBOX_EVENT_TYPES)[keyof typeof SUPPORT_OUTBOX_EVENT_TYPES]
  aggregateId: string
  payload: Record<string, unknown>
  status: 'pending'
  createdAt: string
}

export interface ResolvedSupportCase extends SupportCase {
  evidence: SupportEvidence[]
  compensatingEntry: SupportCompensatingEntry | null
}

export interface SupportStorePort {
  cases: {
    save(value: SupportCase): Promise<void>
    find(tenantId: string, caseId: string): Promise<SupportCase | null>
    list(tenantId: string): Promise<SupportCase[]>
  }
  evidence: {
    save(value: SupportEvidence): Promise<void>
    list(tenantId: string, caseId: string): Promise<SupportEvidence[]>
  }
  timeline: {
    append(value: SupportTimelineEntry): Promise<void>
    list(tenantId: string, caseId: string): SupportTimelineEntry[]
  }
  compensations: {
    save(value: SupportCompensatingEntry): Promise<void>
    find(tenantId: string, caseId: string): Promise<SupportCompensatingEntry | null>
  }
  outbox: {
    append(value: SupportOutboxRecord): Promise<void>
    list(tenantId: string): SupportOutboxRecord[] | Promise<SupportOutboxRecord[]>
  }
}

export class SupportError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'SupportError'
    this.status = status
    this.code = code
  }
}

export class InMemorySupportStore implements SupportStorePort {
  private readonly caseRecords = new Map<string, SupportCase>()
  private readonly evidenceRecords = new Map<string, SupportEvidence>()
  private readonly timelineRecords = new Map<string, SupportTimelineEntry>()
  private readonly compensationRecords = new Map<string, SupportCompensatingEntry>()
  private readonly outboxRecords = new Map<string, SupportOutboxRecord>()

  readonly cases = {
    save: async (value: SupportCase): Promise<void> => { this.caseRecords.set(key(value.tenantId, value.caseId), clone(value)) },
    find: async (tenantId: string, caseId: string) => clone(this.caseRecords.get(key(tenantId, caseId)) ?? null),
    list: async (tenantId: string) => [...this.caseRecords.values()].filter((value) => value.tenantId === tenantId).map(clone),
  }

  readonly evidence = {
    save: async (value: SupportEvidence): Promise<void> => { this.evidenceRecords.set(key(value.tenantId, value.evidenceId), clone(value)) },
    list: async (tenantId: string, caseId: string) => [...this.evidenceRecords.values()].filter((value) => value.tenantId === tenantId && value.caseId === caseId).map(clone),
  }

  readonly timeline = {
    append: async (value: SupportTimelineEntry): Promise<void> => { this.timelineRecords.set(value.entryId, clone(value)) },
    list: (tenantId: string, caseId: string) => [...this.timelineRecords.values()].filter((value) => value.tenantId === tenantId && value.caseId === caseId).map(clone),
  }

  readonly compensations = {
    save: async (value: SupportCompensatingEntry): Promise<void> => { this.compensationRecords.set(key(value.tenantId, value.caseId), clone(value)) },
    find: async (tenantId: string, caseId: string) => clone(this.compensationRecords.get(key(tenantId, caseId)) ?? null),
  }

  readonly outbox = {
    append: async (value: SupportOutboxRecord): Promise<void> => { if (!this.outboxRecords.has(key(value.tenantId, value.eventId))) this.outboxRecords.set(key(value.tenantId, value.eventId), clone(value)) },
    list: (tenantId: string): SupportOutboxRecord[] => [...this.outboxRecords.values()].filter((value) => value.tenantId === tenantId).map(clone),
  }
  listOutbox(tenantId: string): SupportOutboxRecord[] { return this.outbox.list(tenantId) }
}

interface PrismaSupportClient {
  tusSupportCase: {
    upsert(input: { where: { tenantId_caseId: { tenantId: string; caseId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(input: { where: { tenantId_caseId: { tenantId: string; caseId: string } } }): Promise<Record<string, unknown> | null>
    findMany(input: { where: { tenantId: string } }): Promise<Record<string, unknown>[]>
  }
  tusSupportEvidence: {
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    findMany(input: { where: { tenantId: string; caseId: string } }): Promise<Record<string, unknown>[]>
  }
  tusSupportTimeline: {
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    findMany(input: { where: { tenantId: string; caseId: string } }): Promise<Record<string, unknown>[]>
  }
  tusSupportOutbox: {
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    findMany(input: { where: { tenantId: string } }): Promise<Record<string, unknown>[]>
  }
  tusSupportCompensation: {
    upsert(input: { where: { tenantId_caseId: { tenantId: string; caseId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(input: { where: { tenantId_caseId: { tenantId: string; caseId: string } } }): Promise<Record<string, unknown> | null>
  }
}

export class PrismaSupportStore implements SupportStorePort {
  private readonly client: PrismaSupportClient
  private readonly timelineCache = new Map<string, SupportTimelineEntry>()

  constructor(client: PrismaSupportClient) {
    this.client = client
  }

  readonly cases = {
    save: async (value: SupportCase): Promise<void> => {
      await this.client.tusSupportCase.upsert({ where: { tenantId_caseId: { tenantId: value.tenantId, caseId: value.caseId } }, create: { id: `${value.tenantId}:${value.caseId}`, ...value, createdAt: new Date(value.createdAt), resolvedAt: value.resolvedAt ? new Date(value.resolvedAt) : null }, update: { ...value, resolvedAt: value.resolvedAt ? new Date(value.resolvedAt) : null } })
    },
    find: async (tenantId: string, caseId: string): Promise<SupportCase | null> => {
      const row = await this.client.tusSupportCase.findUnique({ where: { tenantId_caseId: { tenantId, caseId } } })
      return row ? toSupportCase(row) : null
    },
    list: async (tenantId: string): Promise<SupportCase[]> => (await this.client.tusSupportCase.findMany({ where: { tenantId } })).map(toSupportCase),
  }

  readonly evidence = {
    save: async (value: SupportEvidence): Promise<void> => {
      await this.client.tusSupportEvidence.create({ data: { id: `${value.tenantId}:${value.evidenceId}`, ...value, createdAt: new Date(value.createdAt) } })
    },
    list: async (tenantId: string, caseId: string): Promise<SupportEvidence[]> => (await this.client.tusSupportEvidence.findMany({ where: { tenantId, caseId } })).map(toSupportEvidence),
  }

  readonly timeline = {
    append: async (value: SupportTimelineEntry): Promise<void> => {
      this.timelineCache.set(`${value.tenantId}:${value.entryId}`, clone(value))
      await this.client.tusSupportTimeline.create({ data: { id: `${value.tenantId}:${value.entryId}`, ...value, createdAt: new Date(value.createdAt) } })
    },
    list: (tenantId: string, caseId: string): SupportTimelineEntry[] => [...this.timelineCache.values()].filter((value) => value.tenantId === tenantId && value.caseId === caseId).map(clone),
  }

  readonly compensations = {
    save: async (value: SupportCompensatingEntry): Promise<void> => {
      await this.client.tusSupportCompensation.upsert({
        where: { tenantId_caseId: { tenantId: value.tenantId, caseId: value.caseId } },
        create: { id: `${value.tenantId}:${value.entryId}`, ...value, createdAt: new Date() },
        update: {},
      })
    },
    find: async (tenantId: string, caseId: string): Promise<SupportCompensatingEntry | null> => {
      const row = await this.client.tusSupportCompensation.findUnique({ where: { tenantId_caseId: { tenantId, caseId } } })
      return row ? toSupportCompensation(row) : null
    },
  }

  readonly outbox = {
    append: async (value: SupportOutboxRecord): Promise<void> => { await this.client.tusSupportOutbox.create({ data: { id: `${value.tenantId}:${value.eventId}`, ...value, createdAt: new Date(value.createdAt) } }) },
    list: async (tenantId: string): Promise<SupportOutboxRecord[]> => (await this.client.tusSupportOutbox.findMany({ where: { tenantId } })).map(toSupportOutbox),
  }
  listOutbox(tenantId: string): Promise<SupportOutboxRecord[]> { return this.outbox.list(tenantId) as Promise<SupportOutboxRecord[]> }
}

export interface TusSupportServiceOptions {
  store: SupportStorePort
  commitmentLookup?: (commitmentId: string) => Promise<{ tenantId: string } | null>
  now?: () => number
  telemetry?: TusOperationsTelemetry
  evaluadorHabilitacion?: EvaluadorHabilitacion
  perfilHabilitacion?: PerfilHabilitacion
  alcanceHabilitacion?: string
}

export class TusSupportService {
  readonly store: SupportStorePort
  readonly audit: { list(tenantId: string): SupportTimelineEntry[] }
  private readonly now: () => number
  private readonly telemetry?: TusOperationsTelemetry
  private readonly auditRecords: SupportTimelineEntry[] = []
  private readonly sessions = new Map<string, string>()
  private readonly evaluadorHabilitacion?: EvaluadorHabilitacion
  private readonly perfilHabilitacion: PerfilHabilitacion
  private readonly alcanceHabilitacion: string
  private readonly commitmentLookup?: TusSupportServiceOptions['commitmentLookup']

  constructor(options: TusSupportServiceOptions) {
    this.store = options.store
    this.now = options.now ?? (() => Date.now())
    this.telemetry = options.telemetry
    this.evaluadorHabilitacion = options.evaluadorHabilitacion
    this.perfilHabilitacion = options.perfilHabilitacion ?? 'native-local'
    this.alcanceHabilitacion = options.alcanceHabilitacion ?? 'argentina-stage-1'
    this.commitmentLookup = options.commitmentLookup
    this.audit = { list: (tenantId) => this.auditRecords.filter((entry) => entry.tenantId === tenantId).map(clone) }
  }

  async openCase(
    context: TusAuthenticatedTenantContext,
    input: { caseId: string; commitmentId: string; category: string; disputeId?: string },
  ): Promise<SupportCase> {
    this.authorize(context, SUPPORT_PERMISSIONS.WRITE)
    await this.requerirHabilitacion(context)
    if (!input.caseId.trim() || !input.commitmentId.trim() || !input.category.trim()) {
      throw new SupportError(400, 'INVALID', 'case, commitment, and category are required')
    }
    await this.requireCommitment(context, input.commitmentId)
    const now = this.timestamp()
    const supportCase: SupportCase = {
      caseId: input.caseId,
      disputeId: input.disputeId?.trim() || `dispute-${input.caseId}`,
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      commitmentId: input.commitmentId,
      openedBy: context.subjectId,
      category: input.category.trim(),
      status: CASE_STATUS.OPEN,
      outcome: null,
      createdAt: now,
      resolvedAt: null,
    }
    await this.store.cases.save(supportCase)
    await this.record(context, supportCase.caseId, SUPPORT_OUTBOX_EVENT_TYPES.CASE_OPENED, { commitmentId: supportCase.commitmentId })
    return clone(supportCase)
  }

  async submitEvidence(
    context: TusAuthenticatedTenantContext,
    input: { caseId: string; evidenceId: string; party: EvidenceParty; summary: string },
  ): Promise<SupportEvidence> {
    this.authorize(context, SUPPORT_PERMISSIONS.WRITE)
    await this.requerirHabilitacion(context)
    const supportCase = await this.requireCase(context, input.caseId)
    if (supportCase.status !== CASE_STATUS.OPEN) throw new SupportError(409, 'CASE_RESOLVED', 'resolved support cases cannot accept evidence')
    if (!input.evidenceId.trim() || !input.summary.trim() || !['customer', 'merchant'].includes(input.party)) {
      throw new SupportError(400, 'INVALID_EVIDENCE', 'evidence identity, party, and summary are required')
    }
    const evidence: SupportEvidence = {
      evidenceId: input.evidenceId,
      caseId: supportCase.caseId,
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      party: input.party,
      summary: redactText(input.summary.trim()),
      submittedBy: context.subjectId,
      createdAt: this.timestamp(),
    }
    await this.store.evidence.save(evidence)
    await this.record(context, supportCase.caseId, `support.evidence.${input.party}.submitted`, { commitmentId: supportCase.commitmentId, party: input.party, evidenceId: evidence.evidenceId }, SUPPORT_OUTBOX_EVENT_TYPES.EVIDENCE_SUBMITTED)
    return clone(evidence)
  }

  async resolveCase(
    context: TusAuthenticatedTenantContext,
    input: { caseId: string; outcome: DisputeOutcome; amount?: number; reason: string },
  ): Promise<ResolvedSupportCase> {
    this.authorize(context, SUPPORT_PERMISSIONS.DECIDE)
    await this.requerirHabilitacion(context)
    const supportCase = await this.requireCase(context, input.caseId)
    if (supportCase.status !== CASE_STATUS.OPEN) throw new SupportError(409, 'CASE_RESOLVED', 'support case is already resolved')
    const evidence = await this.store.evidence.list(context.tenantId, supportCase.caseId)
    const parties = new Set(evidence.map((entry) => entry.party))
    if (!parties.has('customer') || !parties.has('merchant')) throw new SupportError(409, 'BILATERAL_EVIDENCE_REQUIRED', 'customer and merchant evidence are required before resolution')
    if (!input.reason.trim() || !Object.values(DISPUTE_OUTCOMES).includes(input.outcome)) throw new SupportError(400, 'INVALID_DECISION', 'outcome and reason are required')
    const amount = input.amount ?? 0
    if (!Number.isFinite(amount) || amount < 0 || (input.outcome === DISPUTE_OUTCOMES.NO_REFUND && amount !== 0)) throw new SupportError(400, 'INVALID_COMPENSATION', 'compensation amount is invalid')
    const resolvedAt = this.timestamp()
    const updated: SupportCase = { ...supportCase, status: CASE_STATUS.RESOLVED, outcome: input.outcome, resolvedAt }
    const compensatingEntry = input.outcome === DISPUTE_OUTCOMES.NO_REFUND ? null : {
      entryId: `support-compensation-${supportCase.caseId}`,
      caseId: supportCase.caseId,
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      amount,
      currency: 'ARS' as const,
      reason: redactText(input.reason.trim()),
      status: 'recorded' as const,
      settlement: 'not-released' as const,
    }
    await this.store.cases.save(updated)
    if (compensatingEntry) await this.store.compensations.save(compensatingEntry)
    await this.record(context, supportCase.caseId, SUPPORT_OUTBOX_EVENT_TYPES.CASE_RESOLVED, { commitmentId: supportCase.commitmentId, outcome: input.outcome, ...(compensatingEntry ? { compensationEntryId: compensatingEntry.entryId } : {}) })
    return { ...clone(updated), evidence: evidence.map(clone), compensatingEntry: compensatingEntry ? clone(compensatingEntry) : null }
  }

  async getCase(context: TusAuthenticatedTenantContext, caseId: string): Promise<ResolvedSupportCase> {
    this.authorize(context, SUPPORT_PERMISSIONS.WRITE)
    const supportCase = await this.requireCase(context, caseId)
    return {
      ...supportCase,
      evidence: await this.store.evidence.list(context.tenantId, caseId),
      compensatingEntry: await this.store.compensations.find(context.tenantId, caseId),
    }
  }

  async listCases(context: TusAuthenticatedTenantContext): Promise<SupportCase[]> {
    this.authorize(context, SUPPORT_PERMISSIONS.WRITE)
    return this.store.cases.list(context.tenantId)
  }

  timeline(tenantId: string, caseId: string): SupportTimelineEntry[] {
    return this.store.timeline.list(tenantId, caseId)
  }

  private async requireCase(context: TusAuthenticatedTenantContext, caseId: string): Promise<SupportCase> {
    const supportCase = await this.store.cases.find(context.tenantId, caseId)
    if (!supportCase) throw new SupportError(403, 'FORBIDDEN', 'support case is outside the authenticated tenant')
    return supportCase
  }

  private async requireCommitment(context: TusAuthenticatedTenantContext, commitmentId: string): Promise<void> {
    if (!this.commitmentLookup) return
    const commitment = await this.commitmentLookup(commitmentId)
    if (!commitment) throw new SupportError(404, 'NOT_FOUND', 'commitment was not found')
    if (commitment.tenantId !== context.tenantId) throw new SupportError(403, 'FORBIDDEN', 'commitment is outside the authenticated tenant')
  }

  private requerirHabilitacion(context: TusAuthenticatedTenantContext): Promise<unknown> {
    return this.evaluadorHabilitacion?.require({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, capability: 'settlement', profile: this.perfilHabilitacion, scope: this.alcanceHabilitacion }) ?? Promise.resolve()
  }

  private authorize(context: TusAuthenticatedTenantContext, permission: string): void {
    if (!context.tenantId.trim() || !context.subjectId.trim() || !context.correlationId.trim() || (!context.permissions.includes(permission) && !context.permissions.includes('tus:*'))) {
      throw new SupportError(403, 'FORBIDDEN', 'TUS support operation is not authorized')
    }
    const knownTenant = this.sessions.get(context.sessionId)
    if (knownTenant && knownTenant !== context.tenantId) throw new SupportError(403, 'FORBIDDEN', 'support tenant is outside the authenticated session')
    this.sessions.set(context.sessionId, context.tenantId)
  }

  private async record(context: TusAuthenticatedTenantContext, caseId: string, action: string, payload: Record<string, unknown>, eventType: SupportOutboxRecord['eventType'] = action as SupportOutboxRecord['eventType']): Promise<void> {
    const entry = { entryId: `${action}-${caseId}-${this.now()}`, caseId, tenantId: context.tenantId, correlationId: context.correlationId, action, actorId: context.subjectId, createdAt: this.timestamp() }
    this.auditRecords.push(clone(entry))
    await this.store.timeline.append(entry)
    await this.store.outbox.append({ eventId: entry.entryId, tenantId: context.tenantId, correlationId: context.correlationId, eventType, aggregateId: caseId, payload: { ...payload, caseId, correlationId: context.correlationId }, status: 'pending', createdAt: entry.createdAt })
    this.telemetry?.record({
      name: action,
      outcome: 'success',
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      actorId: context.subjectId,
      latencyMs: 0,
      attributes: { caseId: redactText(caseId) },
    })
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString()
  }
}

function redactText(value: string): string {
  return value
    .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:password|secret|token|credential|api[_-]?key)\s*[:=]\s*\S+/gi, '[REDACTED]')
}

function key(tenantId: string, value: string): string {
  return `${tenantId}:${value}`
}

function clone<T>(value: T): T {
  return value === null ? value : structuredClone(value)
}

export default { InMemorySupportStore, PrismaSupportStore, SupportError, TusSupportService }

function toSupportCase(row: Record<string, unknown>): SupportCase {
  return {
    caseId: String(row['caseId']), disputeId: String(row['disputeId']), tenantId: String(row['tenantId']), correlationId: String(row['correlationId'] ?? 'legacy'), commitmentId: String(row['commitmentId']), openedBy: String(row['openedBy']), category: String(row['category']), status: row['status'] as CaseStatus, outcome: row['outcome'] ? row['outcome'] as DisputeOutcome : null, createdAt: new Date(String(row['createdAt'])).toISOString(), resolvedAt: row['resolvedAt'] ? new Date(String(row['resolvedAt'])).toISOString() : null,
  }
}

function toSupportEvidence(row: Record<string, unknown>): SupportEvidence {
  return { evidenceId: String(row['evidenceId']), caseId: String(row['caseId']), tenantId: String(row['tenantId']), correlationId: String(row['correlationId'] ?? 'legacy'), party: row['party'] as EvidenceParty, summary: redactText(String(row['summary'])), submittedBy: String(row['submittedBy']), createdAt: new Date(String(row['createdAt'])).toISOString() }
}

function toSupportCompensation(row: Record<string, unknown>): SupportCompensatingEntry {
  return { entryId: String(row['entryId']), caseId: String(row['caseId']), tenantId: String(row['tenantId']), correlationId: String(row['correlationId'] ?? 'legacy'), amount: Number(row['amount']), currency: 'ARS', reason: redactText(String(row['reason'])), status: 'recorded', settlement: 'not-released' }
}

function toSupportOutbox(row: Record<string, unknown>): SupportOutboxRecord {
  return { eventId: String(row['eventId']), tenantId: String(row['tenantId']), correlationId: String(row['correlationId']), eventType: row['eventType'] as SupportOutboxRecord['eventType'], aggregateId: String(row['aggregateId']), payload: row['payload'] as Record<string, unknown>, status: 'pending', createdAt: new Date(String(row['createdAt'])).toISOString() }
}
