import type { WhatsAppAction } from '@factory/contracts'
import type { TusOperationsTelemetry } from '@factory/observability'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { TusReadinessGuard, TusReadinessProfile } from '../readiness/index.ts'

const ACTION_STATUS = {
  COMPLETED: 'completed',
  CONFIRMED: 'confirmed',
  HANDOFF: 'handoff',
  REPLAY: 'replay',
} as const

const SUPPORTED_ACTIONS = new Set<WhatsAppAction['type']>([
  'search',
  'quote',
  'cart',
  'status',
  'handoff',
  'confirm',
])

const WHATSAPP_RECIPIENT_TYPES = {
  TENANT: 'tenant',
  MERCHANT: 'merchant',
  CUSTOMER: 'customer',
} as const

const WHATSAPP_CONSENT_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const

const WHATSAPP_OUTBOX_STATUS = {
  PENDING: 'pending',
} as const

type WhatsAppRecipientType = (typeof WHATSAPP_RECIPIENT_TYPES)[keyof typeof WHATSAPP_RECIPIENT_TYPES]
type WhatsAppConsentStatus = (typeof WHATSAPP_CONSENT_STATUS)[keyof typeof WHATSAPP_CONSENT_STATUS]

type ActionStatus = (typeof ACTION_STATUS)[keyof typeof ACTION_STATUS]

export interface WhatsAppActionInput {
  type: string
  tenantId: string
  commitmentId?: string
  confirmationId?: string
}

export interface WhatsAppDiscoveryItem {
  listingId: string
  tenantId: string
  name: string
  price: number
  currency: string
  availabilityVersion?: number
  available?: boolean
}

export interface WhatsAppActionRequest extends TusAuthenticatedTenantContext {
  senderId: string
  action: WhatsAppActionInput
  consent: boolean
  idempotencyKey: string
  requestHash: string
  confirmationId?: string
}

export interface WhatsAppActionResult {
  status: ActionStatus
  reason?: string
  tenantId: string
  credentialsCollected: false
  mutated: boolean
  items?: readonly WhatsAppDiscoveryItem[]
  confirmationId?: string
  expiresAt?: string
  commitment?: Record<string, unknown> | null
}

export interface WhatsAppCommitInput {
  tenantId: string
  senderId: string
  confirmationId: string
  items: readonly WhatsAppDiscoveryItem[]
}

export interface WhatsAppActionAudit {
  action: string
  outcome: 'allowed' | 'denied' | 'handoff'
  tenantId: string
  actorId: string
  senderId: string
  correlationId: string
  createdAt: string
  retentionUntil?: string
}

export interface WhatsAppConsent {
  consentId: string
  tenantId: string
  recipientType: WhatsAppRecipientType
  recipientId: string
  status: WhatsAppConsentStatus
  source: string
  grantedAt: string
  revokedAt: string | null
  updatedAt: string
  retentionUntil: string
}

export interface WhatsAppTemplateAllowlistEntry {
  name: string
  version: string
  variables: readonly string[]
}

export interface WhatsAppTemplateMessage {
  messageId: string
  tenantId: string
  recipientType: WhatsAppRecipientType
  recipientId: string
  template: string
  templateVersion: string
  consentId: string
  requestHash: string
  variables: Record<string, string>
  correlationId: string
  status: 'queued'
  createdAt: string
  retentionUntil: string
}

export interface WhatsAppTemplateOutboxRecord {
  eventId: string
  tenantId: string
  correlationId: string
  eventType: 'whatsapp.template.queued' | 'whatsapp.support.handoff'
  aggregateId: string
  payload: Record<string, unknown>
  status: (typeof WHATSAPP_OUTBOX_STATUS)[keyof typeof WHATSAPP_OUTBOX_STATUS]
  createdAt: string
  retentionUntil: string
}

export interface WhatsAppSupportHandoff {
  handoffId: string
  tenantId: string
  senderId: string
  reason: string
  status: 'handoff'
  createdAt: string
}

interface StoredAction {
  requestHash: string
  response: WhatsAppActionResult | null
}

type MaybePromise<TValue> = TValue | Promise<TValue>

export interface WhatsAppConfirmation {
  confirmationId: string
  tenantId: string
  senderId: string
  expiresAt: number
  consumed: boolean
  items: readonly WhatsAppDiscoveryItem[]
}

export interface WhatsAppActionStorePort {
  claim(tenantId: string, key: string, requestHash: string): MaybePromise<'claimed' | 'replay' | 'in_progress' | 'conflict'>
  response(tenantId: string, key: string): MaybePromise<WhatsAppActionResult | null>
  complete(tenantId: string, key: string, response: WhatsAppActionResult): MaybePromise<void>
  saveConfirmation(value: WhatsAppConfirmation): MaybePromise<void>
  getConfirmation(tenantId: string, confirmationId: string): MaybePromise<WhatsAppConfirmation | null>
  consumeConfirmation(tenantId: string, confirmationId: string, senderId: string, now: number): MaybePromise<boolean>
  recordAudit(value: WhatsAppActionAudit): MaybePromise<void>
  listAudits(tenantId: string): WhatsAppActionAudit[]
  saveConsent?(value: WhatsAppConsent): MaybePromise<void>
  getConsent?(tenantId: string, recipientType: WhatsAppRecipientType, recipientId: string): MaybePromise<WhatsAppConsent | null>
  saveTemplateMessage?(value: WhatsAppTemplateMessage): MaybePromise<void>
  getTemplateMessage?(tenantId: string, idempotencyKey: string): MaybePromise<WhatsAppTemplateMessage | null>
  saveOutbox?(value: WhatsAppTemplateOutboxRecord): MaybePromise<void>
  listOutbox?(tenantId: string): WhatsAppTemplateOutboxRecord[]
}

export class WhatsAppActionError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'WhatsAppActionError'
    this.status = status
    this.code = code
  }
}

export class InMemoryWhatsAppActionStore implements WhatsAppActionStorePort {
  private readonly actions = new Map<string, StoredAction>()
  private readonly confirmations = new Map<string, WhatsAppConfirmation>()
  private readonly audits: WhatsAppActionAudit[] = []
  private readonly consents = new Map<string, WhatsAppConsent>()
  private readonly templateMessages = new Map<string, WhatsAppTemplateMessage>()
  private readonly outboxRecords = new Map<string, WhatsAppTemplateOutboxRecord>()

  claim(tenantId: string, key: string, requestHash: string): 'claimed' | 'replay' | 'in_progress' | 'conflict' {
    const mapKey = `${tenantId}:${key}`
    const existing = this.actions.get(mapKey)
    if (!existing) {
      this.actions.set(mapKey, { requestHash, response: null })
      return 'claimed'
    }
    if (existing.requestHash !== requestHash) return 'conflict'
    return existing.response ? 'replay' : 'in_progress'
  }

  complete(tenantId: string, key: string, response: WhatsAppActionResult): void {
    const existing = this.actions.get(`${tenantId}:${key}`)
    if (!existing) throw new Error('WhatsApp action idempotency record not found')
    existing.response = clone(response)
  }

  response(tenantId: string, key: string): WhatsAppActionResult | null {
    const stored = this.actions.get(`${tenantId}:${key}`)?.response
    return stored ? clone(stored) : null
  }

  saveConfirmation(value: WhatsAppConfirmation): void {
    this.confirmations.set(`${value.tenantId}:${value.confirmationId}`, clone(value))
  }

  getConfirmation(tenantId: string, confirmationId: string): WhatsAppConfirmation | null {
    const value = this.confirmations.get(`${tenantId}:${confirmationId}`)
    return value ? clone(value) : null
  }

  consumeConfirmation(tenantId: string, confirmationId: string, senderId: string, now: number): boolean {
    const key = `${tenantId}:${confirmationId}`
    const confirmation = this.confirmations.get(key)
    if (!confirmation || confirmation.consumed || confirmation.senderId !== senderId || confirmation.expiresAt <= now) return false
    confirmation.consumed = true
    return true
  }

  recordAudit(value: WhatsAppActionAudit): void {
    this.audits.push(clone(value))
  }

  listAudits(tenantId: string): WhatsAppActionAudit[] {
    return this.audits.filter((audit) => audit.tenantId === tenantId).map(clone)
  }

  saveConsent(value: WhatsAppConsent): void {
    this.consents.set(`${value.tenantId}:${value.recipientType}:${value.recipientId}`, clone(value))
  }

  getConsent(tenantId: string, recipientType: WhatsAppRecipientType, recipientId: string): WhatsAppConsent | null {
    return clone(this.consents.get(`${tenantId}:${recipientType}:${recipientId}`) ?? null)
  }

  saveTemplateMessage(value: WhatsAppTemplateMessage): void {
    this.templateMessages.set(`${value.tenantId}:${value.messageId}`, clone(value))
  }

  getTemplateMessage(tenantId: string, idempotencyKey: string): WhatsAppTemplateMessage | null {
    return clone(this.templateMessages.get(`${tenantId}:${idempotencyKey}`) ?? null)
  }

  saveOutbox(value: WhatsAppTemplateOutboxRecord): void {
    this.outboxRecords.set(`${value.tenantId}:${value.eventId}`, clone(value))
  }

  listOutbox(tenantId: string): WhatsAppTemplateOutboxRecord[] {
    return [...this.outboxRecords.values()].filter((record) => record.tenantId === tenantId).map(clone)
  }
}

interface PrismaWhatsAppClient {
  tusWhatsAppAction: {
    findUnique(input: { where: { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } } }): Promise<Record<string, unknown> | null>
    findFirst(input: { where: { idempotencyKey: string } }): Promise<Record<string, unknown> | null>
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    update(input: { where: { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } }; data: Record<string, unknown> }): Promise<Record<string, unknown>>
  }
  tusWhatsAppConfirmation: {
    upsert(input: { where: { tenantId_confirmationId: { tenantId: string; confirmationId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(input: { where: { tenantId_confirmationId: { tenantId: string; confirmationId: string } } }): Promise<Record<string, unknown> | null>
    updateMany(input: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  }
  tusWhatsAppAudit: {
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
  }
  tusWhatsAppConsent?: {
    upsert(input: { where: { tenantId_recipientId: { tenantId: string; recipientId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(input: { where: { tenantId_recipientId: { tenantId: string; recipientId: string } } }): Promise<Record<string, unknown> | null>
  }
  tusWhatsAppMessage?: {
    upsert(input: { where: { tenantId_messageId: { tenantId: string; messageId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(input: { where: { tenantId_messageId: { tenantId: string; messageId: string } } }): Promise<Record<string, unknown> | null>
  }
  tusWhatsAppOutbox?: {
    create(input: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    findMany(input: { where: { tenantId: string } }): Promise<Record<string, unknown>[]>
  }
}

export class PrismaWhatsAppActionStore implements WhatsAppActionStorePort {
  private readonly audits: WhatsAppActionAudit[] = []
  private readonly outboxRecords: WhatsAppTemplateOutboxRecord[] = []
  private readonly client: PrismaWhatsAppClient

  constructor(client: PrismaWhatsAppClient) {
    this.client = client
  }

  async claim(tenantId: string, key: string, requestHash: string): Promise<'claimed' | 'replay' | 'in_progress' | 'conflict'> {
    const existing = await this.client.tusWhatsAppAction.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } } })
    const foreign = await this.client.tusWhatsAppAction.findFirst({ where: { idempotencyKey: key } })
    if (foreign && String(foreign['tenantId']) !== tenantId) return 'conflict'
    if (!existing) {
      try {
        await this.client.tusWhatsAppAction.create({ data: { id: `wa-action-${tenantId}-${key}`, tenantId, idempotencyKey: key, requestHash, status: 'pending', response: null, createdAt: new Date(), updatedAt: new Date() } })
        return 'claimed'
      } catch {
        return this.claim(tenantId, key, requestHash)
      }
    }
    if (String(existing['requestHash']) !== requestHash) return 'conflict'
    return existing['status'] === 'completed' && existing['response'] ? 'replay' : 'in_progress'
  }

  async response(tenantId: string, key: string): Promise<WhatsAppActionResult | null> {
    const row = await this.client.tusWhatsAppAction.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } } })
    return row?.['response'] ? row['response'] as WhatsAppActionResult : null
  }

  async complete(tenantId: string, key: string, response: WhatsAppActionResult): Promise<void> {
    await this.client.tusWhatsAppAction.update({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } }, data: { status: 'completed', response, updatedAt: new Date() } })
  }

  async saveConfirmation(value: WhatsAppConfirmation): Promise<void> {
    await this.client.tusWhatsAppConfirmation.upsert({
      where: { tenantId_confirmationId: { tenantId: value.tenantId, confirmationId: value.confirmationId } },
      create: { id: `${value.tenantId}:${value.confirmationId}`, confirmationId: value.confirmationId, tenantId: value.tenantId, senderId: value.senderId, expiresAt: new Date(value.expiresAt), consumedAt: null, items: value.items, createdAt: new Date() },
      update: { senderId: value.senderId, expiresAt: new Date(value.expiresAt), consumedAt: null, items: value.items },
    })
  }

  async getConfirmation(tenantId: string, confirmationId: string): Promise<WhatsAppConfirmation | null> {
    const row = await this.client.tusWhatsAppConfirmation.findUnique({ where: { tenantId_confirmationId: { tenantId, confirmationId } } })
    if (!row) return null
    return { confirmationId: String(row['confirmationId']), tenantId: String(row['tenantId']), senderId: String(row['senderId']), expiresAt: new Date(String(row['expiresAt'])).getTime(), consumed: row['consumedAt'] !== null, items: row['items'] as WhatsAppDiscoveryItem[] }
  }

  async consumeConfirmation(tenantId: string, confirmationId: string, senderId: string, now: number): Promise<boolean> {
    const result = await this.client.tusWhatsAppConfirmation.updateMany({ where: { tenantId, confirmationId, senderId, consumedAt: null, expiresAt: { gt: new Date(now) } }, data: { consumedAt: new Date(now) } })
    return result.count === 1
  }

  async recordAudit(value: WhatsAppActionAudit): Promise<void> {
    this.audits.push(clone(value))
    await this.client.tusWhatsAppAudit.create({ data: { id: `${value.tenantId}:${value.action}:${value.createdAt}:${this.audits.length}`, ...value, createdAt: new Date(value.createdAt) } })
  }

  listAudits(tenantId: string): WhatsAppActionAudit[] {
    return this.audits.filter((audit) => audit.tenantId === tenantId).map(clone)
  }

  async saveConsent(value: WhatsAppConsent): Promise<void> {
    if (!this.client.tusWhatsAppConsent) return
    await this.client.tusWhatsAppConsent.upsert({
      where: { tenantId_recipientId: { tenantId: value.tenantId, recipientId: value.recipientId } },
      create: { id: value.consentId, ...value, grantedAt: new Date(value.grantedAt), revokedAt: value.revokedAt ? new Date(value.revokedAt) : null, updatedAt: new Date(value.updatedAt), retentionUntil: new Date(value.retentionUntil) },
      update: { recipientType: value.recipientType, status: value.status, source: value.source, grantedAt: new Date(value.grantedAt), revokedAt: value.revokedAt ? new Date(value.revokedAt) : null, updatedAt: new Date(value.updatedAt), retentionUntil: new Date(value.retentionUntil) },
    })
  }

  async getConsent(tenantId: string, _recipientType: WhatsAppRecipientType, recipientId: string): Promise<WhatsAppConsent | null> {
    if (!this.client.tusWhatsAppConsent) return null
    const row = await this.client.tusWhatsAppConsent.findUnique({ where: { tenantId_recipientId: { tenantId, recipientId } } })
    if (!row) return null
    return { consentId: String(row['id']), tenantId: String(row['tenantId']), recipientType: String(row['recipientType']) as WhatsAppRecipientType, recipientId: String(row['recipientId']), status: String(row['status']) as WhatsAppConsentStatus, source: String(row['source']), grantedAt: new Date(String(row['grantedAt'])).toISOString(), revokedAt: row['revokedAt'] ? new Date(String(row['revokedAt'])).toISOString() : null, updatedAt: new Date(String(row['updatedAt'])).toISOString(), retentionUntil: new Date(String(row['retentionUntil'])).toISOString() }
  }

  async saveTemplateMessage(value: WhatsAppTemplateMessage): Promise<void> {
    if (!this.client.tusWhatsAppMessage) return
    await this.client.tusWhatsAppMessage.upsert({
      where: { tenantId_messageId: { tenantId: value.tenantId, messageId: value.messageId } },
      create: { id: `${value.tenantId}:${value.messageId}`, messageId: value.messageId, tenantId: value.tenantId, recipientId: value.recipientId, template: value.template, templateVersion: value.templateVersion, consentId: value.consentId, requestHash: value.requestHash, variables: value.variables, status: value.status, correlationId: value.correlationId, createdAt: new Date(value.createdAt), updatedAt: new Date(value.createdAt), retentionUntil: new Date(value.retentionUntil) },
      update: { variables: value.variables, status: value.status, updatedAt: new Date(value.createdAt), retentionUntil: new Date(value.retentionUntil) },
    })
  }

  async getTemplateMessage(tenantId: string, idempotencyKey: string): Promise<WhatsAppTemplateMessage | null> {
    if (!this.client.tusWhatsAppMessage) return null
    const row = await this.client.tusWhatsAppMessage.findUnique({ where: { tenantId_messageId: { tenantId, messageId: idempotencyKey } } })
    if (!row) return null
    return { messageId: String(row['messageId']), tenantId: String(row['tenantId']), recipientType: 'customer', recipientId: String(row['recipientId']), template: String(row['template']), templateVersion: String(row['templateVersion']), consentId: String(row['consentId']), requestHash: String(row['requestHash'] ?? ''), variables: row['variables'] as Record<string, string>, correlationId: String(row['correlationId']), status: 'queued', createdAt: new Date(String(row['createdAt'])).toISOString(), retentionUntil: new Date(String(row['retentionUntil'])).toISOString() }
  }

  async saveOutbox(value: WhatsAppTemplateOutboxRecord): Promise<void> {
    this.outboxRecords.push(clone(value))
    await this.client.tusWhatsAppOutbox?.create({ data: { id: `${value.tenantId}:${value.eventId}`, ...value, createdAt: new Date(value.createdAt), retentionUntil: new Date(value.retentionUntil) } })
  }

  listOutbox(tenantId: string): WhatsAppTemplateOutboxRecord[] {
    return this.outboxRecords.filter((record) => record.tenantId === tenantId).map(clone)
  }
}

export interface TusWhatsAppServiceOptions {
  store: WhatsAppActionStorePort
  discover?: (tenantId: string) => Promise<readonly WhatsAppDiscoveryItem[]>
  commitments?: (tenantId: string, commitmentId: string) => Promise<Record<string, unknown> | null>
  commit?: (input: WhatsAppCommitInput) => Promise<Record<string, unknown>>
  authorizedSenders?: Readonly<Record<string, readonly string[]>>
  authorizeSender?: (tenantId: string, senderId: string) => boolean | Promise<boolean>
  telemetry?: TusOperationsTelemetry
  now?: () => number
  confirmationTtlMs?: number
  readinessGuard?: TusReadinessGuard
  readinessProfile?: TusReadinessProfile
  readinessScope?: string
  providerEnabled?: boolean
  templateAllowlist?: readonly WhatsAppTemplateAllowlistEntry[]
  supportHandoff?: (input: { tenantId: string; senderId: string; reason: string; correlationId: string }) => Promise<{ handoffId: string }>
  retentionMs?: number
}

export class TusWhatsAppService {
  readonly store: WhatsAppActionStorePort
  readonly audit: { list(tenantId: string): WhatsAppActionAudit[] }
  private readonly discover: (tenantId: string) => Promise<readonly WhatsAppDiscoveryItem[]>
  private readonly commitments: (tenantId: string, commitmentId: string) => Promise<Record<string, unknown> | null>
  private readonly commit?: (input: WhatsAppCommitInput) => Promise<Record<string, unknown>>
  private readonly authorizedSenders?: Readonly<Record<string, readonly string[]>>
  private readonly authorizeSender?: (tenantId: string, senderId: string) => boolean | Promise<boolean>
  private readonly telemetry?: TusOperationsTelemetry
  private readonly now: () => number
  private readonly confirmationTtlMs: number
  private readonly sessions = new Map<string, string>()
  private readonly readinessGuard?: TusReadinessGuard
  private readonly readinessProfile: TusReadinessProfile
  private readonly readinessScope: string
  private readonly providerEnabled: boolean
  private readonly templateAllowlist: ReadonlyMap<string, WhatsAppTemplateAllowlistEntry>
  private readonly supportHandoff?: TusWhatsAppServiceOptions['supportHandoff']
  private readonly retentionMs: number

  constructor(options: TusWhatsAppServiceOptions) {
    this.store = options.store
    this.discover = options.discover ?? (async () => [])
    this.commitments = options.commitments ?? (async () => null)
    this.commit = options.commit
    this.authorizedSenders = options.authorizedSenders
    this.authorizeSender = options.authorizeSender
    this.telemetry = options.telemetry
    this.now = options.now ?? (() => Date.now())
    this.confirmationTtlMs = options.confirmationTtlMs ?? 5 * 60 * 1000
    this.readinessGuard = options.readinessGuard
    this.readinessProfile = options.readinessProfile ?? 'native-local'
    this.readinessScope = options.readinessScope ?? 'argentina-stage-1'
    this.providerEnabled = options.providerEnabled ?? true
    this.templateAllowlist = new Map((options.templateAllowlist ?? []).map((entry) => [`${entry.name}:${entry.version}`, { ...entry, variables: [...entry.variables] }]))
    this.supportHandoff = options.supportHandoff
    this.retentionMs = options.retentionMs ?? 365 * 24 * 60 * 60 * 1000
    this.audit = { list: (tenantId) => this.store.listAudits(tenantId) }
  }

  async recordConsent(
    context: TusAuthenticatedTenantContext,
    input: { recipientType: WhatsAppRecipientType; recipientId: string; source: string; granted: boolean },
  ): Promise<WhatsAppConsent> {
    this.authorizeMessaging(context)
    if (!isRecipientType(input.recipientType) || !input.recipientId.trim() || !input.source.trim()) {
      throw new WhatsAppActionError(400, 'INVALID_CONSENT', 'recipient type, recipient, and consent source are required')
    }
    const now = this.now()
    const previous = await this.store.getConsent?.(context.tenantId, input.recipientType, input.recipientId)
    const consent: WhatsAppConsent = {
      consentId: previous?.consentId ?? `whatsapp-consent-${context.tenantId}-${input.recipientType}-${input.recipientId}`,
      tenantId: context.tenantId,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      status: input.granted ? WHATSAPP_CONSENT_STATUS.ACTIVE : WHATSAPP_CONSENT_STATUS.REVOKED,
      source: redactText(input.source),
      grantedAt: previous?.grantedAt ?? new Date(now).toISOString(),
      revokedAt: input.granted ? null : new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      retentionUntil: new Date(now + this.retentionMs).toISOString(),
    }
    await this.store.saveConsent?.(consent)
    await this.auditRecord(context, input.granted ? 'whatsapp.consent.granted' : 'whatsapp.consent.revoked', 'allowed', input.recipientId)
    return clone(consent)
  }

  async optOut(
    context: TusAuthenticatedTenantContext,
    input: { recipientType: WhatsAppRecipientType; recipientId: string; source?: string },
  ): Promise<WhatsAppConsent> {
    return this.recordConsent(context, { ...input, source: input.source ?? 'whatsapp-opt-out', granted: false })
  }

  async sendTemplate(
    context: TusAuthenticatedTenantContext,
    input: { recipientType: WhatsAppRecipientType; recipientId: string; template: string; templateVersion: string; variables: Record<string, unknown>; idempotencyKey: string; requestHash: string },
  ): Promise<WhatsAppTemplateMessage> {
    this.authorizeMessaging(context)
    if (!this.providerEnabled) throw new WhatsAppActionError(503, 'PROVIDER_DISABLED', 'WhatsApp provider actions are disabled')
    const consent = await this.store.getConsent?.(context.tenantId, input.recipientType, input.recipientId)
    if (!consent || consent.status !== WHATSAPP_CONSENT_STATUS.ACTIVE) throw new WhatsAppActionError(409, 'CONSENT_REQUIRED', 'current WhatsApp consent is required')
    const template = this.templateAllowlist.get(`${input.template}:${input.templateVersion}`)
    if (!template) throw new WhatsAppActionError(409, 'TEMPLATE_NOT_ALLOWED', 'WhatsApp template is not allowlisted')
    if (!input.idempotencyKey.trim() || !input.requestHash.trim()) throw new WhatsAppActionError(400, 'INVALID_IDEMPOTENCY', 'template idempotency key and request hash are required')
    const prior = await this.store.getTemplateMessage?.(context.tenantId, input.idempotencyKey)
    if (prior) {
      if (prior.requestHash !== input.requestHash) throw new WhatsAppActionError(409, 'IDEMPOTENCY_CONFLICT', 'WhatsApp template idempotency key was reused with a different request')
      return clone(prior)
    }
    const variables = redactTemplateVariables(template.variables, input.variables)
    const now = this.now()
    const message: WhatsAppTemplateMessage = {
      messageId: input.idempotencyKey,
      tenantId: context.tenantId,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      template: template.name,
      templateVersion: template.version,
      consentId: consent.consentId,
      requestHash: input.requestHash,
      variables,
      correlationId: context.correlationId,
      status: 'queued',
      createdAt: new Date(now).toISOString(),
      retentionUntil: new Date(now + this.retentionMs).toISOString(),
    }
    await this.store.saveTemplateMessage?.(message)
    await this.store.saveOutbox?.({ eventId: `whatsapp-template-${input.idempotencyKey}`, tenantId: context.tenantId, correlationId: context.correlationId, eventType: 'whatsapp.template.queued', aggregateId: message.messageId, payload: { recipientType: message.recipientType, recipientId: message.recipientId, template: message.template, templateVersion: message.templateVersion, consentId: message.consentId, variables: message.variables, requestHash: input.requestHash }, status: WHATSAPP_OUTBOX_STATUS.PENDING, createdAt: message.createdAt, retentionUntil: message.retentionUntil })
    await this.auditRecord(context, 'whatsapp.template.queued', 'allowed', input.recipientId)
    return clone(message)
  }

  async handoffToSupport(context: TusAuthenticatedTenantContext, input: { senderId: string; reason: string }): Promise<WhatsAppSupportHandoff> {
    this.authorizeMessaging(context)
    if (!input.senderId.trim() || !input.reason.trim()) throw new WhatsAppActionError(400, 'INVALID_HANDOFF', 'sender and handoff reason are required')
    const handoff = await this.supportHandoff?.({ tenantId: context.tenantId, senderId: input.senderId, reason: redactText(input.reason), correlationId: context.correlationId })
    const value: WhatsAppSupportHandoff = { handoffId: handoff?.handoffId ?? `support-handoff-${context.tenantId}-${this.now()}`, tenantId: context.tenantId, senderId: input.senderId, reason: redactText(input.reason), status: 'handoff', createdAt: new Date(this.now()).toISOString() }
    await this.auditRecord(context, 'whatsapp.support.handoff', 'handoff', input.senderId)
    await this.store.saveOutbox?.({ eventId: `whatsapp-handoff-${value.handoffId}`, tenantId: context.tenantId, correlationId: context.correlationId, eventType: 'whatsapp.support.handoff', aggregateId: value.handoffId, payload: { handoffId: value.handoffId, senderId: value.senderId, reason: value.reason }, status: WHATSAPP_OUTBOX_STATUS.PENDING, createdAt: value.createdAt, retentionUntil: new Date(this.now() + this.retentionMs).toISOString() })
    return value
  }

  async execute(input: WhatsAppActionRequest): Promise<WhatsAppActionResult> {
    const startedAt = this.now()
    this.validateRequest(input)
    await this.readinessGuard?.require({ tenantId: input.tenantId, actorId: input.subjectId, correlationId: input.correlationId, capability: 'provider-actions', profile: this.readinessProfile, scope: this.readinessScope })
    const claim = await this.store.claim(input.tenantId, input.idempotencyKey, input.requestHash)
    if (claim === 'conflict') return this.finish(input, await this.handoff(input, 'idempotency_conflict'), startedAt)
    if (claim === 'replay') {
      const existing = await this.store.response(input.tenantId, input.idempotencyKey)
      if (existing) return this.finish(input, { ...existing, status: ACTION_STATUS.REPLAY }, startedAt)
    }
    if (claim === 'in_progress') return this.finish(input, await this.handoff(input, 'idempotency_in_progress'), startedAt)

    const result = await this.executeClaimed(input)
    await this.store.complete(input.tenantId, input.idempotencyKey, result)
    return this.finish(input, result, startedAt)
  }

  private async executeClaimed(input: WhatsAppActionRequest): Promise<WhatsAppActionResult> {
    if (!input.permissions.includes('tus:whatsapp:write') && !input.permissions.includes('tus:*')) return this.handoff(input, 'authorization_required')
    const knownTenant = this.sessions.get(input.sessionId)
    if (knownTenant && knownTenant !== input.tenantId) return this.handoff(input, 'tenant_boundary_denied')
    this.sessions.set(input.sessionId, input.tenantId)
    if (input.action.tenantId !== input.tenantId) return this.handoff(input, 'tenant_boundary_denied')
    const storedConsent = await this.store.getConsent?.(input.tenantId, WHATSAPP_RECIPIENT_TYPES.CUSTOMER, input.senderId)
    if (!input.consent || storedConsent?.status === WHATSAPP_CONSENT_STATUS.REVOKED) return this.handoff(input, 'messaging_consent_required')
    if (!(await this.isSenderAuthorized(input.tenantId, input.senderId))) return this.handoff(input, 'sender_not_authorized')
    if (!SUPPORTED_ACTIONS.has(input.action.type as WhatsAppAction['type'])) {
      return this.handoff(input, 'sensitive_action_requires_authenticated_handoff')
    }
    return this.executeAction(input)
  }

  private async executeAction(input: WhatsAppActionRequest): Promise<WhatsAppActionResult> {
    const type = input.action.type
    if (type === 'handoff') return this.handoff(input, 'customer_requested_handoff')
    if (type === 'search') {
      const items = await this.discover(input.tenantId)
      return this.completed(input, { items })
    }
    if (type === 'quote') {
      const items = await this.discover(input.tenantId)
      const expiresAt = this.now() + this.confirmationTtlMs
      const confirmationId = `wa-confirmation-${input.tenantId}-${input.idempotencyKey}`
      await this.store.saveConfirmation({ confirmationId, tenantId: input.tenantId, senderId: input.senderId, expiresAt, consumed: false, items: snapshotItems(items) })
      return this.completed(input, { items, confirmationId, expiresAt: new Date(expiresAt).toISOString() })
    }
    if (type === 'confirm') {
      const confirmationId = input.confirmationId ?? input.action.confirmationId ?? ''
      const confirmation = await this.store.getConfirmation(input.tenantId, confirmationId)
      if (!confirmation || confirmation.consumed || confirmation.senderId !== input.senderId || confirmation.expiresAt <= this.now()) return this.handoff(input, 'confirmation_expired_or_consumed')
      const currentItems = await this.discover(input.tenantId)
      if (!sameAvailability(confirmation.items, currentItems)) return this.handoff(input, 'quote_stale_or_unavailable')
      if (!(await this.store.consumeConfirmation(input.tenantId, confirmationId, input.senderId, this.now()))) return this.handoff(input, 'confirmation_expired_or_consumed')
      const commitment = this.commit ? await this.commit({ tenantId: input.tenantId, senderId: input.senderId, confirmationId, items: confirmation.items }) : null
      return this.completed(input, { confirmationId, status: ACTION_STATUS.CONFIRMED, mutated: this.commitmentMutated(commitment), commitment })
    }
    if (type === 'status') {
      const commitmentId = input.action.commitmentId ?? ''
      const commitment = commitmentId ? await this.commitments(input.tenantId, commitmentId) : null
      return this.completed(input, { commitment })
    }
    return this.completed(input)
  }

  private async completed(input: WhatsAppActionRequest, extra: Partial<WhatsAppActionResult> = {}): Promise<WhatsAppActionResult> {
    const result: WhatsAppActionResult = {
      status: ACTION_STATUS.COMPLETED,
      tenantId: input.tenantId,
      credentialsCollected: false,
      mutated: false,
      ...extra,
    }
    await this.auditRecord(input, 'whatsapp.action.completed', 'allowed')
    return result
  }

  private async handoff(input: WhatsAppActionRequest, reason: string): Promise<WhatsAppActionResult> {
    const result: WhatsAppActionResult = {
      status: ACTION_STATUS.HANDOFF,
      reason,
      tenantId: input.tenantId,
      credentialsCollected: false,
      mutated: false,
    }
    await this.auditRecord(input, 'whatsapp.action.denied', 'denied')
    return result
  }

  private async auditRecord(input: TusAuthenticatedTenantContext, action: string, outcome: WhatsAppActionAudit['outcome'], senderId = input.subjectId): Promise<void> {
    await this.store.recordAudit({
      action,
      outcome,
      tenantId: input.tenantId,
      actorId: input.subjectId,
      senderId,
      correlationId: input.correlationId,
      createdAt: new Date(this.now()).toISOString(),
      retentionUntil: new Date(this.now() + this.retentionMs).toISOString(),
    })
  }

  private authorizeMessaging(context: TusAuthenticatedTenantContext): void {
    if (!context.tenantId.trim() || !context.subjectId.trim() || !context.correlationId.trim() || (!context.permissions.includes('tus:whatsapp:write') && !context.permissions.includes('tus:*'))) {
      throw new WhatsAppActionError(403, 'FORBIDDEN', 'TUS WhatsApp actions are not authorized')
    }
  }

  private validateRequest(input: WhatsAppActionRequest): void {
    if (!input.sessionId.trim() || !input.tenantId.trim() || !input.subjectId.trim() || !input.correlationId.trim() || !input.senderId.trim()) throw new WhatsAppActionError(400, 'INVALID_CONTEXT', 'WhatsApp session, tenant, and sender context are required')
    if (!input.idempotencyKey.trim() || !input.requestHash.trim()) throw new WhatsAppActionError(400, 'INVALID_IDEMPOTENCY', 'WhatsApp idempotency key and request hash are required')
  }

  private async isSenderAuthorized(tenantId: string, senderId: string): Promise<boolean> {
    if (this.authorizeSender) return this.authorizeSender(tenantId, senderId)
    if (this.authorizedSenders) return this.authorizedSenders[tenantId]?.includes(senderId) ?? false
    return true
  }

  private commitmentMutated(commitment: Record<string, unknown> | null): boolean {
    return commitment !== null
  }

  private finish(input: WhatsAppActionRequest, result: WhatsAppActionResult, startedAt: number): WhatsAppActionResult {
    this.telemetry?.record({
      name: 'tus.whatsapp.action',
      outcome: result.status === ACTION_STATUS.HANDOFF ? 'denied' : 'success',
      correlationId: input.correlationId,
      tenantId: input.tenantId,
      actorId: input.subjectId,
      latencyMs: Math.max(0, this.now() - startedAt),
      attributes: { action: input.action.type, outcome: result.status },
    })
    return result
  }
}

function snapshotItems(items: readonly WhatsAppDiscoveryItem[]): WhatsAppDiscoveryItem[] {
  return items.filter((item) => item.available !== false).map((item) => ({ ...item }))
}

function isRecipientType(value: string): value is WhatsAppRecipientType {
  return Object.values(WHATSAPP_RECIPIENT_TYPES).includes(value as WhatsAppRecipientType)
}

function redactTemplateVariables(allowed: readonly string[], input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = input[key]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return []
    return [[key, redactText(String(value))]]
  }))
}

function redactText(value: string): string {
  return value
    .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:password|secret|token|credential|api[_-]?key)\s*[:=]\s*\S+/gi, '[REDACTED]')
}

function sameAvailability(snapshot: readonly WhatsAppDiscoveryItem[], current: readonly WhatsAppDiscoveryItem[]): boolean {
  const currentById = new Map(snapshotItems(current).map((item) => [item.listingId, item]))
  return snapshot.length > 0 && snapshot.every((item) => {
    const fresh = currentById.get(item.listingId)
    return fresh !== undefined && fresh.price === item.price && fresh.currency === item.currency && (fresh.availabilityVersion ?? 0) === (item.availabilityVersion ?? 0)
  })
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export default { TusWhatsAppService, InMemoryWhatsAppActionStore, PrismaWhatsAppActionStore, WhatsAppActionError }
