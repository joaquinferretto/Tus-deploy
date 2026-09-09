import { TUS_CONTRACT_VERSION } from '@factory/contracts'

export const BILLING_CURRENCY = 'ARS' as const
export const BILLING_TAX_AUTHORITY = 'ARCA/AFIP-external' as const
export const BILLING_INVOICE_STATUSES = { DRAFT: 'draft', ISSUED: 'issued', BLOCKED: 'blocked', VOID: 'void' } as const
export const BILLING_SUBSCRIPTION_STATUSES = { ACTIVE: 'active', PAST_DUE: 'past_due', CANCELLED: 'cancelled', ENDED: 'ended' } as const

export type BillingInvoiceStatus = (typeof BILLING_INVOICE_STATUSES)[keyof typeof BILLING_INVOICE_STATUSES]
export type BillingSubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[keyof typeof BILLING_SUBSCRIPTION_STATUSES]
export type BillingContext = { tenantId: string; actorId: string; correlationId: string }
export type BillingCommandContext = BillingContext & { idempotencyKey: string; requestHash: string }
export type BillingPartyRole = 'merchant' | 'customer' | 'platform'

export interface BillingTaxSnapshot {
  authority: typeof BILLING_TAX_AUTHORITY
  taxIdentity: string
  taxCategory: string
  ivaTreatment: string | null
  withholdingTreatment: string | null
  evidenceReference: string | null
  externalApprovalReference: string | null
}

export interface BillingTaxGate {
  approved: boolean
  externalReference: string | null
}

export interface BillingAccount {
  contractVersion: typeof TUS_CONTRACT_VERSION
  billingAccountId: string
  tenantId: string
  partyId: string
  role: BillingPartyRole
  status: 'active' | 'blocked'
  createdAt: number
  updatedAt: number
}

export interface BillingSubscriptionPlan {
  contractVersion: typeof TUS_CONTRACT_VERSION
  planId: string
  tenantId: string
  name: string
  amountMinor: bigint
  currency: typeof BILLING_CURRENCY
  interval: 'monthly' | 'annual' | 'custom'
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}

export interface BillingSubscription {
  contractVersion: typeof TUS_CONTRACT_VERSION
  subscriptionId: string
  tenantId: string
  customerId: string
  planId: string
  planSnapshot: Readonly<BillingSubscriptionPlan>
  currency: typeof BILLING_CURRENCY
  amountMinor: bigint
  interval: BillingSubscriptionPlan['interval']
  status: BillingSubscriptionStatus
  dunningAttempt: number
  cancelledAt: number | null
  cancelReason: string | null
  createdAt: number
  updatedAt: number
}

export interface BillingInvoiceLine {
  lineId: string
  description: string
  quantity: number
  unitMinor: bigint
  taxMinor: bigint
  totalMinor: bigint
  currency: typeof BILLING_CURRENCY
}

export interface BillingInvoice {
  contractVersion: typeof TUS_CONTRACT_VERSION
  invoiceId: string
  tenantId: string
  accountId: string
  commitmentId: string
  paymentId: string
  orderId: string
  posOperationId: string | null
  currency: typeof BILLING_CURRENCY
  subtotalMinor: bigint
  taxMinor: bigint
  feeMinor: bigint
  totalMinor: bigint
  status: BillingInvoiceStatus
  number: string | null
  invoiceType: string
  taxSnapshot: Readonly<BillingTaxSnapshot>
  lines: readonly BillingInvoiceLine[]
  snapshotVersion: number
  issuedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface BillingCreditNote {
  creditNoteId: string
  tenantId: string
  invoiceId: string
  paymentId: string
  orderId: string
  posOperationId: string | null
  currency: typeof BILLING_CURRENCY
  amountMinor: bigint
  reason: string
  status: 'accepted'
  createdAt: number
}

export interface BillingRefund {
  refundId: string
  tenantId: string
  invoiceId: string
  paymentId: string
  orderId: string
  posOperationId: string | null
  currency: typeof BILLING_CURRENCY
  amountMinor: bigint
  reason: string
  status: 'accepted'
  createdAt: number
}

export type BillingLedgerEntryType = 'invoice_issued' | 'credit_compensation' | 'refund_compensation'

export interface BillingLedgerEntry {
  entryId: string
  tenantId: string
  invoiceId: string
  entryType: BillingLedgerEntryType
  amountMinor: bigint
  currency: typeof BILLING_CURRENCY
  linkedEntryId: string | null
  creditNoteId: string | null
  refundId: string | null
  paymentId: string
  orderId: string
  posOperationId: string | null
  immutable: true
  createdAt: number
}

export interface BillingAuditRecord {
  auditId: string
  tenantId: string
  actorId: string
  correlationId: string
  action: string
  resourceId: string
  outcome: 'allowed' | 'blocked' | 'replayed'
  reason: string | null
  createdAt: number
}

export interface BillingOutboxRecord {
  eventId: string
  tenantId: string
  correlationId: string
  eventType: string
  aggregateId: string
  payload: Record<string, unknown>
  status: 'pending' | 'published' | 'dead-letter'
  attempts: number
  availableAt: number
  createdAt: number
}

export interface BillingDunningRecord {
  dunningId: string
  tenantId: string
  subscriptionId: string
  attempt: number
  reason: string
  status: 'retryable' | 'blocked' | 'cancelled'
  retryAt: number | null
  createdAt: number
}

export interface BillingAccountingExport {
  exportId: string
  tenantId: string
  invoiceIds: readonly string[]
  ledgerEntryIds: readonly string[]
  externalApprovalReference: string
  status: 'prepared'
  postedExternally: false
  createdAt: number
}

export interface BillingIdempotencyRecord {
  requestHash: string
  response: unknown
}

export interface BillingStore {
  saveAccount(account: BillingAccount): Promise<BillingAccount>
  getAccount(tenantId: string, billingAccountId: string): Promise<BillingAccount | null>
  savePlan(plan: BillingSubscriptionPlan): Promise<BillingSubscriptionPlan>
  getPlan(tenantId: string, planId: string): Promise<BillingSubscriptionPlan | null>
  saveSubscription(subscription: BillingSubscription): Promise<BillingSubscription>
  getSubscription(tenantId: string, subscriptionId: string): Promise<BillingSubscription | null>
  saveInvoice(invoice: BillingInvoice): Promise<BillingInvoice>
  getInvoice(tenantId: string, invoiceId: string): Promise<BillingInvoice | null>
  nextInvoiceNumber(tenantId: string): Promise<string>
  saveCreditNote(note: BillingCreditNote): Promise<BillingCreditNote>
  getCreditNote(tenantId: string, creditNoteId: string): Promise<BillingCreditNote | null>
  saveRefund(refund: BillingRefund): Promise<BillingRefund>
  getRefund(tenantId: string, refundId: string): Promise<BillingRefund | null>
  appendLedger(entry: BillingLedgerEntry): Promise<BillingLedgerEntry>
  listLedger(tenantId: string): Promise<BillingLedgerEntry[]>
  saveDunning(record: BillingDunningRecord): Promise<BillingDunningRecord>
  getIdempotency(tenantId: string, key: string): Promise<BillingIdempotencyRecord | null>
  saveIdempotency(tenantId: string, key: string, record: BillingIdempotencyRecord): Promise<void>
  appendAudit(record: BillingAuditRecord): Promise<void>
  listAudit(tenantId: string): Promise<BillingAuditRecord[]>
  appendOutbox(record: BillingOutboxRecord): Promise<void>
  listOutbox(tenantId: string): Promise<BillingOutboxRecord[]>
  saveAccountingExport(value: BillingAccountingExport): Promise<BillingAccountingExport>
}

export class BillingError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'BillingError'
    this.status = status
    this.code = code
  }
}

export class InMemoryBillingStore implements BillingStore {
  private readonly accounts = new Map<string, BillingAccount>()
  private readonly plans = new Map<string, BillingSubscriptionPlan>()
  private readonly subscriptions = new Map<string, BillingSubscription>()
  private readonly invoices = new Map<string, BillingInvoice>()
  private readonly credits = new Map<string, BillingCreditNote>()
  private readonly refunds = new Map<string, BillingRefund>()
  private readonly ledger = new Map<string, BillingLedgerEntry>()
  private readonly dunning = new Map<string, BillingDunningRecord>()
  private readonly idempotency = new Map<string, BillingIdempotencyRecord>()
  private readonly audits = new Map<string, BillingAuditRecord>()
  private readonly outbox = new Map<string, BillingOutboxRecord>()
  private readonly exports = new Map<string, BillingAccountingExport>()
  private readonly invoiceSequences = new Map<string, number>()

  async saveAccount(value: BillingAccount): Promise<BillingAccount> { return this.put(this.accounts, value.tenantId, value.billingAccountId, value) }
  async getAccount(tenantId: string, billingAccountId: string): Promise<BillingAccount | null> { return this.get(this.accounts, tenantId, billingAccountId) }
  async savePlan(value: BillingSubscriptionPlan): Promise<BillingSubscriptionPlan> { return this.put(this.plans, value.tenantId, value.planId, value) }
  async getPlan(tenantId: string, planId: string): Promise<BillingSubscriptionPlan | null> { return this.get(this.plans, tenantId, planId) }
  async saveSubscription(value: BillingSubscription): Promise<BillingSubscription> { return this.put(this.subscriptions, value.tenantId, value.subscriptionId, value) }
  async getSubscription(tenantId: string, subscriptionId: string): Promise<BillingSubscription | null> { return this.get(this.subscriptions, tenantId, subscriptionId) }

  async saveInvoice(value: BillingInvoice): Promise<BillingInvoice> {
    const invoiceKey = key(value.tenantId, value.invoiceId)
    const existing = this.invoices.get(invoiceKey)
    if (existing) {
      const issuingDraft = existing.status === 'draft' && value.status === 'issued'
      const sameSnapshot = issuingDraft ? invoiceContentFingerprint(existing) === invoiceContentFingerprint(value) : invoiceFingerprint(existing) === invoiceFingerprint(value)
      if (!sameSnapshot) throw new BillingError(409, 'INVOICE_IMMUTABLE', 'invoice snapshot is immutable')
      if (existing.status === 'issued' && value.status !== 'issued') throw new BillingError(409, 'INVOICE_IMMUTABLE', 'issued invoice cannot change status')
      if (existing.status === 'issued' && existing.number !== value.number) throw new BillingError(409, 'INVOICE_IMMUTABLE', 'issued invoice number is immutable')
    }
    const stored = freezeInvoice(value)
    this.invoices.set(invoiceKey, stored)
    return freezeInvoice(stored)
  }

  async getInvoice(tenantId: string, invoiceId: string): Promise<BillingInvoice | null> { const value = this.get(this.invoices, tenantId, invoiceId); return value ? freezeInvoice(value) : null }

  async nextInvoiceNumber(tenantId: string): Promise<string> {
    const next = (this.invoiceSequences.get(tenantId) ?? 0) + 1
    this.invoiceSequences.set(tenantId, next)
    return `A-${String(next).padStart(6, '0')}`
  }

  async saveCreditNote(value: BillingCreditNote): Promise<BillingCreditNote> { return this.put(this.credits, value.tenantId, value.creditNoteId, value) }
  async getCreditNote(tenantId: string, creditNoteId: string): Promise<BillingCreditNote | null> { return this.get(this.credits, tenantId, creditNoteId) }
  async saveRefund(value: BillingRefund): Promise<BillingRefund> { return this.put(this.refunds, value.tenantId, value.refundId, value) }
  async getRefund(tenantId: string, refundId: string): Promise<BillingRefund | null> { return this.get(this.refunds, tenantId, refundId) }

  async appendLedger(value: BillingLedgerEntry): Promise<BillingLedgerEntry> {
    if (value.currency !== BILLING_CURRENCY || value.amountMinor < 0n) throw new BillingError(400, 'INVALID_MONEY', 'billing ledger money must be non-negative ARS minor units')
    const existing = this.ledger.get(key(value.tenantId, value.entryId))
    if (existing) {
      if (ledgerFingerprint(existing) !== ledgerFingerprint(value)) throw new BillingError(409, 'LEDGER_IMMUTABLE', 'billing ledger entries are append-only')
      return clone(existing)
    }
    this.ledger.set(key(value.tenantId, value.entryId), clone(value))
    return clone(value)
  }

  async listLedger(tenantId: string): Promise<BillingLedgerEntry[]> { return [...this.ledger.values()].filter((value) => value.tenantId === tenantId).map(clone) }
  async saveDunning(value: BillingDunningRecord): Promise<BillingDunningRecord> { return this.put(this.dunning, value.tenantId, value.dunningId, value) }
  async getIdempotency(tenantId: string, idempotencyKey: string): Promise<BillingIdempotencyRecord | null> { return clone(this.idempotency.get(key(tenantId, idempotencyKey)) ?? null) }
  async saveIdempotency(tenantId: string, idempotencyKey: string, value: BillingIdempotencyRecord): Promise<void> {
    const recordKey = key(tenantId, idempotencyKey)
    const existing = this.idempotency.get(recordKey)
    if (existing && recordFingerprint(existing) !== recordFingerprint(value)) throw new BillingError(409, 'IDEMPOTENCY_CONFLICT', 'billing idempotency records are immutable')
    this.idempotency.set(recordKey, clone(value))
  }
  async appendAudit(value: BillingAuditRecord): Promise<void> {
    const recordKey = key(value.tenantId, value.auditId)
    const existing = this.audits.get(recordKey)
    if (existing && recordFingerprint(existing) !== recordFingerprint(value)) throw new BillingError(409, 'BILLING_AUDIT_IMMUTABLE', 'billing audit records are append-only')
    this.audits.set(recordKey, clone(value))
  }
  async listAudit(tenantId: string): Promise<BillingAuditRecord[]> { return [...this.audits.values()].filter((value) => value.tenantId === tenantId).map(clone) }
  async appendOutbox(value: BillingOutboxRecord): Promise<void> {
    const recordKey = key(value.tenantId, value.eventId)
    const existing = this.outbox.get(recordKey)
    if (existing && outboxFingerprint(existing) !== outboxFingerprint(value)) throw new BillingError(409, 'BILLING_OUTBOX_IMMUTABLE', 'billing outbox event identity and payload are immutable')
    if (!existing) this.outbox.set(recordKey, clone(value))
  }
  async listOutbox(tenantId: string): Promise<BillingOutboxRecord[]> { return [...this.outbox.values()].filter((value) => value.tenantId === tenantId).map(clone) }
  async saveAccountingExport(value: BillingAccountingExport): Promise<BillingAccountingExport> { return this.put(this.exports, value.tenantId, value.exportId, value) }

  private put<T>(records: Map<string, T>, tenantId: string, id: string, value: T): T { records.set(key(tenantId, id), clone(value)); return clone(value) }
  private get<T>(records: Map<string, T>, tenantId: string, id: string): T | null { return clone(records.get(key(tenantId, id)) ?? null) }
}

export interface BillingServiceOptions {
  store: BillingStore
  now?: () => number
  taxGate?: BillingTaxGate
  accountingGate?: BillingTaxGate
  providerEnabled?: boolean
  maxDunningAttempts?: number
}

export class BillingService {
  readonly store: BillingStore
  private readonly now: () => number
  private readonly taxGate: BillingTaxGate
  private readonly accountingGate: BillingTaxGate
  private readonly providerEnabled: boolean
  private readonly maxDunningAttempts: number

  constructor(options: BillingServiceOptions) {
    this.store = options.store
    this.now = options.now ?? (() => Date.now())
    this.taxGate = options.taxGate ?? { approved: false, externalReference: null }
    this.accountingGate = options.accountingGate ?? { approved: false, externalReference: null }
    this.providerEnabled = options.providerEnabled ?? false
    this.maxDunningAttempts = options.maxDunningAttempts ?? 3
  }

  async createBillingAccount(input: BillingContext & { billingAccountId: string; partyId: string; role: BillingPartyRole }): Promise<BillingAccount> {
    assertContext(input)
    if (!input.billingAccountId.trim() || !input.partyId.trim()) throw new BillingError(400, 'INVALID_ACCOUNT', 'billing account identity is required')
    const now = this.now()
    const account = { contractVersion: TUS_CONTRACT_VERSION, billingAccountId: input.billingAccountId, tenantId: input.tenantId, partyId: input.partyId, role: input.role, status: 'active' as const, createdAt: now, updatedAt: now }
    const saved = await this.store.saveAccount(account)
    await this.recordEffects(input, 'billing.account.created', saved.billingAccountId, 'allowed', null, { role: saved.role })
    return saved
  }

  async getBillingAccount(tenantId: string, billingAccountId: string): Promise<BillingAccount> {
    const account = await this.store.getAccount(tenantId, billingAccountId)
    if (!account) throw new BillingError(404, 'NOT_FOUND', 'billing account was not found')
    return account
  }

  async createPlan(input: BillingCommandContext & { planId: string; name: string; amountMinor: bigint; currency: string; interval: BillingSubscriptionPlan['interval'] }): Promise<BillingSubscriptionPlan> {
    assertCommand(input)
    const money = createBillingMoney(input.currency, input.amountMinor)
    if (!input.planId.trim() || !input.name.trim()) throw new BillingError(400, 'INVALID_PLAN', 'subscription plan identity is required')
    const now = this.now()
    const plan = { contractVersion: TUS_CONTRACT_VERSION, planId: input.planId, tenantId: input.tenantId, name: input.name.trim(), amountMinor: money.minor, currency: BILLING_CURRENCY, interval: input.interval, status: 'active' as const, createdAt: now, updatedAt: now }
    const saved = await this.store.savePlan(plan)
    await this.recordEffects(input, 'billing.plan.created', saved.planId, 'allowed', null, { amountMinor: saved.amountMinor.toString(), currency: saved.currency })
    return saved
  }

  async startSubscription(input: BillingCommandContext & { subscriptionId: string; customerId: string; planId: string }): Promise<BillingSubscription> {
    assertCommand(input)
    const plan = await this.store.getPlan(input.tenantId, input.planId)
    if (!plan) throw new BillingError(404, 'PLAN_NOT_FOUND', 'subscription plan was not found')
    if (plan.status !== 'active') throw new BillingError(409, 'PLAN_INACTIVE', 'subscription plan is not active')
    const now = this.now()
    const subscription = freezeSubscription({ contractVersion: TUS_CONTRACT_VERSION, subscriptionId: input.subscriptionId, tenantId: input.tenantId, customerId: input.customerId, planId: plan.planId, planSnapshot: plan, currency: plan.currency, amountMinor: plan.amountMinor, interval: plan.interval, status: 'active', dunningAttempt: 0, cancelledAt: null, cancelReason: null, createdAt: now, updatedAt: now })
    const saved = await this.store.saveSubscription(subscription)
    await this.recordEffects(input, 'billing.subscription.started', saved.subscriptionId, 'allowed', null, { planId: saved.planId })
    return saved
  }

  async renewSubscription(input: BillingCommandContext & { subscriptionId: string }): Promise<{ status: 'blocked' | 'renewed'; reason?: 'provider_disabled' | 'subscription_cancelled'; subscription: BillingSubscription }> {
    assertCommand(input)
    const subscription = await this.requireSubscription(input.tenantId, input.subscriptionId)
    if (subscription.status === 'cancelled' || subscription.status === 'ended') throw new BillingError(409, 'SUBSCRIPTION_CANCELLED', 'cancelled subscriptions cannot renew')
    const existing = await this.idempotent(input)
    if (existing) return existing as { status: 'blocked' | 'renewed'; reason?: 'provider_disabled' | 'subscription_cancelled'; subscription: BillingSubscription }
    if (!this.providerEnabled) {
      const blocked = { ...subscription, status: 'past_due' as const, dunningAttempt: subscription.dunningAttempt + 1, updatedAt: this.now() }
      const response = { status: 'blocked' as const, reason: 'provider_disabled' as const, subscription: await this.store.saveSubscription(blocked) }
      await this.completeIdempotency(input, response)
      await this.recordEffects(input, 'billing.subscription.renewal.blocked', subscription.subscriptionId, 'blocked', 'provider_disabled', { providerCall: false })
      return response
    }
    throw new BillingError(503, 'PROVIDER_EXTERNAL_GATE_REQUIRED', 'recurring provider execution requires an approved external integration')
  }

  async cancelSubscription(input: BillingCommandContext & { subscriptionId: string; reason: string }): Promise<BillingSubscription> {
    assertCommand(input)
    const existing = await this.idempotent(input)
    if (existing) return existing as BillingSubscription
    const subscription = await this.requireSubscription(input.tenantId, input.subscriptionId)
    const cancelled = freezeSubscription({ ...subscription, status: 'cancelled', cancelledAt: this.now(), cancelReason: input.reason.trim(), updatedAt: this.now() })
    const saved = await this.store.saveSubscription(cancelled)
    await this.completeIdempotency(input, saved)
    await this.recordEffects(input, 'billing.subscription.cancelled', saved.subscriptionId, 'allowed', null, { reason: saved.cancelReason })
    return saved
  }

  async createInvoice(input: BillingCommandContext & { invoiceId: string; accountId?: string; commitmentId: string; paymentId: string; orderId: string; posOperationId?: string | null; lines: Array<{ lineId: string; description: string; quantity: number; unitMinor: bigint; taxMinor: bigint }>; taxProfile: { taxIdentity: string; taxCategory: string; ivaTreatment?: string | null; withholdingTreatment?: string | null; evidenceRef?: string | null }; taxGate?: BillingTaxGate; invoiceType?: string }): Promise<BillingInvoice> {
    assertCommand(input)
    const existing = await this.idempotent(input)
    if (existing) return existing as BillingInvoice
    if (!input.invoiceId.trim() || !input.commitmentId.trim() || !input.paymentId.trim() || !input.orderId.trim()) throw new BillingError(400, 'INVALID_INVOICE', 'invoice linkage is required')
    if (input.accountId?.trim()) {
      const account = await this.store.getAccount(input.tenantId, input.accountId.trim())
      if (!account || account.status !== 'active') throw new BillingError(404, 'BILLING_ACCOUNT_NOT_FOUND', 'billing account was not found')
    }
    const lines = input.lines.map((line) => createInvoiceLine(line))
    if (lines.length === 0) throw new BillingError(400, 'INVALID_INVOICE', 'invoice requires at least one line')
    const subtotalMinor = lines.reduce((sum, line) => sum + line.unitMinor * BigInt(line.quantity), 0n)
    const taxMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0n)
    const totalMinor = subtotalMinor + taxMinor
    const gate = input.taxGate ?? this.taxGate
    const taxSnapshot = createTaxSnapshot(input.taxProfile, gate)
    const now = this.now()
    const invoice = freezeInvoice({ contractVersion: TUS_CONTRACT_VERSION, invoiceId: input.invoiceId, tenantId: input.tenantId, accountId: input.accountId?.trim() || `account-${input.tenantId}`, commitmentId: input.commitmentId, paymentId: input.paymentId, orderId: input.orderId, posOperationId: input.posOperationId?.trim() || null, currency: BILLING_CURRENCY, subtotalMinor, taxMinor, feeMinor: 0n, totalMinor, status: 'draft', number: null, invoiceType: input.invoiceType?.trim() || 'commercial', taxSnapshot, lines, snapshotVersion: 1, issuedAt: null, createdAt: now, updatedAt: now })
    const saved = await this.store.saveInvoice(invoice)
    await this.completeIdempotency(input, saved)
    await this.recordEffects(input, 'billing.invoice.created', saved.invoiceId, 'allowed', null, { totalMinor: saved.totalMinor.toString(), currency: saved.currency })
    return saved
  }

  async issueInvoice(input: BillingCommandContext & { invoiceId: string }): Promise<{ status: 'issued' | 'blocked'; reason?: 'tax_external_approval_required'; invoice: BillingInvoice }> {
    assertCommand(input)
    const existing = await this.idempotent(input)
    if (existing) return existing as { status: 'issued' | 'blocked'; reason?: 'tax_external_approval_required'; invoice: BillingInvoice }
    const invoice = await this.requireInvoice(input.tenantId, input.invoiceId)
    const gate = this.taxGate
    if (!gate.approved || !gate.externalReference?.trim()) {
      const response = { status: 'blocked' as const, reason: 'tax_external_approval_required' as const, invoice }
      await this.completeIdempotency(input, response)
      await this.recordEffects(input, 'billing.invoice.issue.blocked', invoice.invoiceId, 'blocked', 'tax_external_approval_required', { providerCall: false })
      return response
    }
    if (invoice.status === 'issued') return { status: 'issued', invoice }
    const issued = freezeInvoice({ ...invoice, status: 'issued', number: await this.store.nextInvoiceNumber(input.tenantId), issuedAt: this.now(), taxSnapshot: freezeTaxSnapshot({ ...invoice.taxSnapshot, externalApprovalReference: gate.externalReference }), updatedAt: this.now() })
    const saved = await this.store.saveInvoice(issued)
    await this.store.appendLedger(this.ledgerForInvoice(input, saved))
    const response = { status: 'issued' as const, invoice: saved }
    await this.completeIdempotency(input, response)
    await this.recordEffects(input, 'billing.invoice.issued', saved.invoiceId, 'allowed', null, { number: saved.number, ledgerEntryId: `invoice-${saved.invoiceId}` })
    return response
  }

  async createCredit(input: BillingCommandContext & { creditNoteId: string; invoiceId: string; amountMinor: bigint; reason: string; paymentId: string; orderId: string; posOperationId?: string | null }): Promise<BillingCreditNote> {
    return await this.createCompensation('credit', input) as BillingCreditNote
  }

  async recordRefund(input: BillingCommandContext & { refundId: string; invoiceId: string; amountMinor: bigint; reason: string; paymentId: string; orderId: string; posOperationId?: string | null }): Promise<BillingRefund> {
    return await this.createCompensation('refund', input) as BillingRefund
  }

  async recordDunning(input: BillingCommandContext & { subscriptionId: string; attempt: number; reason: string; retryAt: number | null }): Promise<BillingDunningRecord> {
    assertCommand(input)
    if (!Number.isInteger(input.attempt) || input.attempt <= 0 || !input.reason.trim()) throw new BillingError(400, 'INVALID_DUNNING', 'dunning attempt and reason are required')
    const existing = await this.idempotent(input)
    if (existing) return existing as BillingDunningRecord
    const record: BillingDunningRecord = { dunningId: `dunning-${input.subscriptionId}-${input.attempt}`, tenantId: input.tenantId, subscriptionId: input.subscriptionId, attempt: input.attempt, reason: input.reason.trim(), status: input.attempt < this.maxDunningAttempts ? 'retryable' : 'blocked', retryAt: input.attempt < this.maxDunningAttempts ? input.retryAt : null, createdAt: this.now() }
    const saved = await this.store.saveDunning(record)
    await this.completeIdempotency(input, saved)
    await this.recordEffects(input, 'billing.subscription.dunning', saved.subscriptionId, saved.status === 'retryable' ? 'allowed' : 'blocked', saved.status === 'blocked' ? 'max_dunning_attempts' : null, { attempt: saved.attempt, retryAt: saved.retryAt })
    return saved
  }

  async prepareAccountingExport(input: BillingCommandContext & { exportId: string; invoiceIds: string[] }): Promise<BillingAccountingExport> {
    assertCommand(input)
    if (!this.accountingGate.approved || !this.accountingGate.externalReference?.trim()) throw new BillingError(409, 'ACCOUNTING_EXTERNAL_APPROVAL_REQUIRED', 'accounting export requires external approval')
    const existing = await this.idempotent(input)
    if (existing) return existing as BillingAccountingExport
    const invoices = await Promise.all(input.invoiceIds.map((invoiceId) => this.requireInvoice(input.tenantId, invoiceId)))
    if (invoices.some((invoice) => invoice.status !== 'issued')) throw new BillingError(409, 'INVOICE_NOT_ISSUED', 'only issued invoices can be exported')
    const ledger = (await this.store.listLedger(input.tenantId)).filter((entry) => input.invoiceIds.includes(entry.invoiceId))
    const value: BillingAccountingExport = { exportId: input.exportId, tenantId: input.tenantId, invoiceIds: [...input.invoiceIds], ledgerEntryIds: ledger.map((entry) => entry.entryId), externalApprovalReference: this.accountingGate.externalReference, status: 'prepared', postedExternally: false, createdAt: this.now() }
    const saved = await this.store.saveAccountingExport(value)
    await this.completeIdempotency(input, saved)
    await this.recordEffects(input, 'billing.accounting.export.prepared', saved.exportId, 'allowed', null, { postedExternally: false, ledgerEntryCount: saved.ledgerEntryIds.length })
    return saved
  }

  private async createCompensation(kind: 'credit' | 'refund', input: BillingCommandContext & { creditNoteId?: string; refundId?: string; invoiceId: string; amountMinor: bigint; reason: string; paymentId: string; orderId: string; posOperationId?: string | null }): Promise<BillingCreditNote | BillingRefund> {
    assertCommand(input)
    const existing = await this.idempotent(input)
    if (existing) return existing as BillingCreditNote | BillingRefund
    const invoice = await this.requireInvoice(input.tenantId, input.invoiceId)
    if (invoice.status !== 'issued') throw new BillingError(409, 'INVOICE_NOT_ISSUED', 'compensation requires an issued invoice')
    if (input.paymentId !== invoice.paymentId || input.orderId !== invoice.orderId || normalizeOptional(input.posOperationId) !== normalizeOptional(invoice.posOperationId)) throw new BillingError(409, 'BILLING_LINKAGE_MISMATCH', 'compensation linkage must match the invoice payment and order')
    const money = createBillingMoney(invoice.currency, input.amountMinor)
    if (money.minor <= 0n || money.minor > invoice.totalMinor) throw new BillingError(409, 'COMPENSATION_EXCEEDS_INVOICE', 'compensation exceeds the invoice total')
    if (!input.reason.trim() || !input.paymentId.trim() || !input.orderId.trim()) throw new BillingError(400, 'INVALID_COMPENSATION', 'compensation linkage and reason are required')
    const now = this.now()
    const common = { tenantId: input.tenantId, invoiceId: invoice.invoiceId, paymentId: input.paymentId, orderId: input.orderId, posOperationId: input.posOperationId?.trim() || null, currency: BILLING_CURRENCY, amountMinor: money.minor, reason: input.reason.trim(), status: 'accepted' as const, createdAt: now }
    if (kind === 'credit') {
      const note: BillingCreditNote = { creditNoteId: input.creditNoteId!, ...common }
       const saved = await this.store.saveCreditNote(note)
       await this.store.appendLedger(this.ledgerForCompensation(input, invoice, 'credit_compensation', saved.amountMinor, saved.creditNoteId, null))
       await this.completeIdempotency(input, saved)
       await this.recordEffects(input, 'billing.credit.accepted', saved.creditNoteId, 'allowed', null, { amountMinor: saved.amountMinor.toString(), linkedInvoiceId: invoice.invoiceId })
      return saved
    }
    const refund: BillingRefund = { refundId: input.refundId!, ...common }
    const saved = await this.store.saveRefund(refund)
    await this.store.appendLedger(this.ledgerForCompensation(input, invoice, 'refund_compensation', saved.amountMinor, null, saved.refundId))
    await this.completeIdempotency(input, saved)
    await this.recordEffects(input, 'billing.refund.accepted', saved.refundId, 'allowed', null, { amountMinor: saved.amountMinor.toString(), providerCall: false })
    return saved
  }

  private async requireInvoice(tenantId: string, invoiceId: string): Promise<BillingInvoice> { const invoice = await this.store.getInvoice(tenantId, invoiceId); if (!invoice) throw new BillingError(404, 'INVOICE_NOT_FOUND', 'invoice was not found'); return invoice }
  private async requireSubscription(tenantId: string, subscriptionId: string): Promise<BillingSubscription> { const subscription = await this.store.getSubscription(tenantId, subscriptionId); if (!subscription) throw new BillingError(404, 'SUBSCRIPTION_NOT_FOUND', 'subscription was not found'); return subscription }
  private async idempotent(input: BillingCommandContext): Promise<unknown> { const existing = await this.store.getIdempotency(input.tenantId, input.idempotencyKey); if (!existing) return null; if (existing.requestHash !== input.requestHash) throw new BillingError(409, 'IDEMPOTENCY_CONFLICT', 'billing idempotency key was already used for another request'); return clone(existing.response) }
  private async completeIdempotency(input: BillingCommandContext, response: unknown): Promise<void> { await this.store.saveIdempotency(input.tenantId, input.idempotencyKey, { requestHash: input.requestHash, response: clone(response) }) }
  private async recordEffects(input: BillingContext, eventType: string, aggregateId: string, outcome: BillingAuditRecord['outcome'], reason: string | null, payload: Record<string, unknown>): Promise<void> {
    const now = this.now()
    await this.store.appendAudit({ auditId: `billing-audit-${input.correlationId}-${eventType}-${aggregateId}`, tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId, action: eventType, resourceId: aggregateId, outcome, reason, createdAt: now })
    await this.store.appendOutbox({ eventId: `billing-outbox-${eventType}-${aggregateId}`, tenantId: input.tenantId, correlationId: input.correlationId, eventType, aggregateId, payload, status: 'pending', attempts: 0, availableAt: now, createdAt: now })
  }
  private ledgerForInvoice(input: BillingContext, invoice: BillingInvoice): BillingLedgerEntry { return { entryId: `invoice-${invoice.invoiceId}`, tenantId: input.tenantId, invoiceId: invoice.invoiceId, entryType: 'invoice_issued', amountMinor: invoice.totalMinor, currency: invoice.currency, linkedEntryId: null, creditNoteId: null, refundId: null, paymentId: invoice.paymentId, orderId: invoice.orderId, posOperationId: invoice.posOperationId, immutable: true, createdAt: this.now() } }
  private ledgerForCompensation(input: BillingContext, invoice: BillingInvoice, entryType: 'credit_compensation' | 'refund_compensation', amountMinor: bigint, creditNoteId: string | null, refundId: string | null): BillingLedgerEntry { const id = creditNoteId ?? refundId!; return { entryId: id, tenantId: input.tenantId, invoiceId: invoice.invoiceId, entryType, amountMinor, currency: invoice.currency, linkedEntryId: `invoice-${invoice.invoiceId}`, creditNoteId, refundId, paymentId: invoice.paymentId, orderId: invoice.orderId, posOperationId: invoice.posOperationId, immutable: true, createdAt: this.now() } }
}

export function createBillingMoney(currency: string, minor: bigint): { currency: typeof BILLING_CURRENCY; minor: bigint } {
  if (typeof currency !== 'string' || currency.trim().toUpperCase() !== BILLING_CURRENCY) throw new BillingError(400, 'UNSUPPORTED_CURRENCY', 'Argentina billing accepts ARS only')
  if (typeof minor !== 'bigint' || minor < 0n) throw new BillingError(400, 'INVALID_MONEY', 'billing money must be a non-negative bigint minor unit')
  return { currency: BILLING_CURRENCY, minor }
}

function createInvoiceLine(input: { lineId: string; description: string; quantity: number; unitMinor: bigint; taxMinor: bigint }): BillingInvoiceLine {
  if (!input.lineId.trim() || !input.description.trim() || !Number.isInteger(input.quantity) || input.quantity <= 0) throw new BillingError(400, 'INVALID_INVOICE_LINE', 'invoice line identity and positive quantity are required')
  const unit = createBillingMoney(BILLING_CURRENCY, input.unitMinor)
  const tax = createBillingMoney(BILLING_CURRENCY, input.taxMinor)
  return Object.freeze({ lineId: input.lineId, description: input.description.trim(), quantity: input.quantity, unitMinor: unit.minor, taxMinor: tax.minor, totalMinor: unit.minor * BigInt(input.quantity) + tax.minor, currency: BILLING_CURRENCY })
}

 function createTaxSnapshot(input: { taxIdentity: string; taxCategory: string; ivaTreatment?: string | null; withholdingTreatment?: string | null; evidenceRef?: string | null }, gate: BillingTaxGate): BillingTaxSnapshot {
   if (!input.taxIdentity.trim() || !input.taxCategory.trim()) throw new BillingError(400, 'INVALID_TAX_PROFILE', 'tax identity and category are required')
   return freezeTaxSnapshot({ authority: BILLING_TAX_AUTHORITY, taxIdentity: input.taxIdentity.trim(), taxCategory: input.taxCategory.trim(), ivaTreatment: input.ivaTreatment?.trim() || null, withholdingTreatment: input.withholdingTreatment?.trim() || null, evidenceReference: input.evidenceRef?.trim() || null, externalApprovalReference: gate.approved && gate.externalReference?.trim() ? gate.externalReference.trim() : null })
}

function freezeTaxSnapshot(value: BillingTaxSnapshot): Readonly<BillingTaxSnapshot> { return Object.freeze({ ...value }) }
 function freezeSubscription(value: BillingSubscription): BillingSubscription { return Object.freeze({ ...value, planSnapshot: Object.freeze({ ...value.planSnapshot }), }) }
 function freezeInvoice(value: BillingInvoice): BillingInvoice { return Object.freeze({ ...value, taxSnapshot: freezeTaxSnapshot(value.taxSnapshot), lines: Object.freeze(value.lines.map((line) => Object.freeze({ ...line }))) }) }
 function invoiceFingerprint(value: BillingInvoice): string { return [value.invoiceId, value.tenantId, value.accountId, value.commitmentId, value.paymentId, value.orderId, value.posOperationId, value.currency, value.subtotalMinor, value.taxMinor, value.feeMinor, value.totalMinor, value.invoiceType, value.snapshotVersion, value.taxSnapshot.authority, value.taxSnapshot.taxIdentity, value.taxSnapshot.taxCategory, value.taxSnapshot.ivaTreatment, value.taxSnapshot.withholdingTreatment, value.taxSnapshot.evidenceReference, value.taxSnapshot.externalApprovalReference, value.lines.map((line) => [line.lineId, line.description, line.quantity, line.unitMinor, line.taxMinor, line.totalMinor].join(':')).join('|')].map(String).join('|') }
 function invoiceContentFingerprint(value: BillingInvoice): string { return invoiceFingerprint({ ...value, taxSnapshot: { ...value.taxSnapshot, externalApprovalReference: null } }) }
 function ledgerFingerprint(value: BillingLedgerEntry): string { return [value.entryId, value.tenantId, value.invoiceId, value.entryType, value.amountMinor, value.currency, value.linkedEntryId, value.creditNoteId, value.refundId, value.paymentId, value.orderId, value.posOperationId].map(String).join('|') }
 function recordFingerprint(value: unknown): string { return JSON.stringify(value, (_key: string, item: unknown) => typeof item === 'bigint' ? `${item}n` : item) ?? '' }
 function outboxFingerprint(value: BillingOutboxRecord): string { return recordFingerprint({ eventId: value.eventId, tenantId: value.tenantId, correlationId: value.correlationId, eventType: value.eventType, aggregateId: value.aggregateId, payload: value.payload, createdAt: value.createdAt }) }
 function normalizeOptional(value: string | null | undefined): string | null { return value?.trim() || null }
function assertContext(input: BillingContext): void { if (!input.tenantId.trim() || !input.actorId.trim() || !input.correlationId.trim()) throw new BillingError(400, 'INVALID_CONTEXT', 'billing authorization context is required') }
function assertCommand(input: BillingCommandContext): void { assertContext(input); if (!input.idempotencyKey.trim() || !input.requestHash.trim()) throw new BillingError(400, 'INVALID_IDEMPOTENCY', 'billing idempotency key and request hash are required') }
function key(tenantId: string, id: string): string { return `${tenantId}:${id}` }
function clone<T>(value: T): T { return value === null ? value : structuredClone(value) }

export default { BillingError, BillingService, InMemoryBillingStore, createBillingMoney }
