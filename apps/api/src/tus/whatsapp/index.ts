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
}

export class PrismaWhatsAppActionStore implements WhatsAppActionStorePort {
  private readonly audits: WhatsAppActionAudit[] = []
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
    this.audit = { list: (tenantId) => this.store.listAudits(tenantId) }
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
    if (!input.consent) return this.handoff(input, 'messaging_consent_required')
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

  private async auditRecord(input: WhatsAppActionRequest, action: string, outcome: WhatsAppActionAudit['outcome']): Promise<void> {
    await this.store.recordAudit({
      action,
      outcome,
      tenantId: input.tenantId,
      actorId: input.subjectId,
      senderId: input.senderId,
      correlationId: input.correlationId,
      createdAt: new Date(this.now()).toISOString(),
    })
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
