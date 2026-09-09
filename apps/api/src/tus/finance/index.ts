import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CommitmentContext, TusCommitment } from '@factory/contracts'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import { createCompletionEvidence, type CompletionEvidenceInput } from '../domain/evidence.ts'
import { isReleaseEligible, type ReleaseEligibility } from '../domain/settlement.ts'
import type { TusReadinessGuard, TusReadinessProfile } from '../readiness/index.ts'

export const FINANCIAL_GATE_KEYS = ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'reconciliation'] as const
export const FINANCIAL_PAYOUT_GATE_KEYS = ['payout', 'custody'] as const
export type FinancialGateKey = (typeof FINANCIAL_GATE_KEYS)[number]
export type FinancialPayoutGateKey = (typeof FINANCIAL_PAYOUT_GATE_KEYS)[number]
export type FinancialReadiness = Record<FinancialGateKey, boolean> & Partial<Record<FinancialPayoutGateKey, boolean>>

export const FINANCE_PROVIDER_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  CHARGED_BACK: 'charged_back',
  PROVIDER_ERROR: 'provider_error',
} as const
export type FinancePaymentProviderStatus = (typeof FINANCE_PROVIDER_STATUSES)[keyof typeof FINANCE_PROVIDER_STATUSES]
export type FinanceCommercialStatus = 'held' | 'released' | 'frozen' | 'refunded'
export type FinanceLedgerEntryType =
  | 'gross_authorized'
  | 'commission_reserved'
  | 'merchant_payable_held'
  | 'merchant_release'
  | 'refund_compensation'
  | 'chargeback_compensation'
  | 'reconciliation_compensation'

export interface FinanceSplitPolicy {
  name: 'five-day-intermediary'
  version: string
  holdDays: 5
  releaseRule: 'completion-confirmation-or-approved-policy'
  merchantOfRecord: 'tus-intermediary'
  providerEvidenceId: string | null
  legalEvidenceId: string | null
}

export interface FinancePaymentIntent {
  contractVersion: typeof TUS_CONTRACT_VERSION
  paymentId: string
  tenantId: string
  commitmentId: string
  provider: 'mercado-pago'
  providerReference: string | null
  providerStatus: FinancePaymentProviderStatus
  commercialStatus: FinanceCommercialStatus
  amount: number
  currency: string
  idempotencyKey: string
  correlationId: string
  credentialsCollected: false
  source: 'authorized' | 'deterministic-test-only' | 'held-no-provider'
  orderId: string
  posOperationId: string | null
  merchantOfRecord: 'tus-intermediary'
  collectionModel: 'intermediary'
  splitPolicy: FinanceSplitPolicy
  releaseAt: number
  providerEventAt: number | null
  providerError: 'timeout' | 'unavailable' | 'failed' | null
  createdAt: number
  updatedAt: number
}

export interface FinanceProviderPaymentInput {
  tenantId: string
  commitmentId: string
  amount: number
  currency: string
  correlationId: string
  idempotencyKey: string
}

export interface FinanceProviderPaymentResult {
  providerReference: string
  status: Extract<FinancePaymentProviderStatus, 'pending' | 'approved' | 'rejected'>
}

export interface FinancePaymentProvider {
  readonly source: 'authorized' | 'deterministic-test-only'
  createPaymentIntent(input: FinanceProviderPaymentInput): Promise<FinanceProviderPaymentResult>
}

export interface FinanceReleaseJobTransport {
  enqueue(input: { tenantId: string; jobId: string }): Promise<{ status: 'queued'; tenantId: string; jobId: string }>
}

export interface FinanceCommissionSnapshot {
  contractVersion: typeof TUS_CONTRACT_VERSION
  snapshotId: string
  tenantId: string
  commitmentId: string
  context: CommitmentContext
  grossAmount: number
  deductions: number
  commissionableBase: number
  rateBps: number
  ruleVersion: string
  commissionAmount: number
  netAmount: number
  currency: string
  providerReference: string
  evidenceId: string
  ledgerStatus: 'held' | 'released' | 'frozen' | 'compensated'
  createdAt: number
}

export interface FinanceLedgerEntry {
  entryId: string
  tenantId: string
  commitmentId: string
  entryType: FinanceLedgerEntryType
  amount: number
  currency: string
  linkedEntryId: string | null
  reason: string
  immutable: true
  createdAt: number
}

export interface FinancialEvidence {
  contractVersion: typeof TUS_CONTRACT_VERSION
  evidenceId: string
  tenantId: string
  commitmentId: string
  actorId: string
  correlationId: string
  kind: 'completion' | 'check-in' | 'delivery-accepted'
  occurredAt: string
}

export interface FinancialFreeze {
  freezeId: string
  tenantId: string
  commitmentId: string
  reason: 'dispute' | 'chargeback' | 'refund' | 'reserve' | 'fraud-risk' | 'missing-evidence' | 'unresolved-incident' | 'provider-mismatch'
  actorId: string
  correlationId: string
  active: true
  createdAt: number
}

export interface Confirmation {
  confirmationId: string
  tenantId: string
  commitmentId: string
  actorId: string
  correlationId: string
  confirmedAt: string
}

interface FinanceIdempotencyRecord {
  requestHash: string
  response: unknown
}

export interface FinanceStore {
  getPayment(tenantId: string, commitmentId: string): MaybePromise<FinancePaymentIntent | null>
  savePayment(payment: FinancePaymentIntent): MaybePromise<FinancePaymentIntent>
  getSnapshot(tenantId: string, commitmentId: string): MaybePromise<FinanceCommissionSnapshot | null>
  saveSnapshot(snapshot: FinanceCommissionSnapshot): MaybePromise<FinanceCommissionSnapshot>
  appendLedger(entry: FinanceLedgerEntry): MaybePromise<FinanceLedgerEntry>
  listLedger(tenantId: string, commitmentId: string): MaybePromise<FinanceLedgerEntry[]>
  saveEvidence(evidence: FinancialEvidence): MaybePromise<FinancialEvidence>
  listEvidence(tenantId: string, commitmentId: string): MaybePromise<FinancialEvidence[]>
  saveConfirmation(confirmation: Confirmation): MaybePromise<Confirmation>
  getConfirmation(tenantId: string, commitmentId: string): MaybePromise<Confirmation | null>
  saveFreeze(freeze: FinancialFreeze): MaybePromise<FinancialFreeze>
  getFreeze(tenantId: string, commitmentId: string): MaybePromise<FinancialFreeze | null>
  getIdempotency(tenantId: string, key: string): MaybePromise<FinanceIdempotencyRecord | null>
  saveIdempotency(tenantId: string, key: string, record: FinanceIdempotencyRecord): MaybePromise<void>
  getReconciliation(tenantId: string, commitmentId: string): MaybePromise<ReconciliationResult | null>
  saveReconciliation(result: ReconciliationResult): MaybePromise<ReconciliationResult>
}

type MaybePromise<T> = T | Promise<T>

export type ReconciliationResult = {
  reconciliationId: string
  tenantId: string
  commitmentId: string
  providerReference: string
  providerAmount: number
  evidenceId: string
  actorId: string
  correlationId: string
  status: 'clean' | 'quarantined'
  reason: 'matched' | 'provider_amount_mismatch' | 'provider_reference_mismatch'
  deterministic: boolean
  createdAt: number
}

export interface FinanceWebhookInput {
  tenantId: string
  actorId: string
  correlationId: string
  commitmentId: string
  paymentId: string
  providerReference: string
  status: FinancePaymentProviderStatus
  amount: number
  currency: string
  eventId: string
  requestId: string
  timestamp: number
  signature: string
}

export type FinanceWebhookResult =
  | { status: 'processed'; payment: FinancePaymentIntent }
  | { status: 'replay'; payment: FinancePaymentIntent | null }
  | { status: 'out_of_order'; payment: FinancePaymentIntent }
  | { status: 'rejected'; reason: 'invalid_signature' | 'expired_signature' | 'invalid_request'; payment: FinancePaymentIntent | null }

export class FinanceError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'FinanceError'
    this.status = status
    this.code = code
  }
}

export class InMemoryFinanceStore implements FinanceStore {
  private readonly payments = new Map<string, FinancePaymentIntent>()
  private readonly snapshots = new Map<string, FinanceCommissionSnapshot>()
  private readonly ledger = new Map<string, FinanceLedgerEntry>()
  private readonly evidence = new Map<string, FinancialEvidence>()
  private readonly confirmations = new Map<string, Confirmation>()
  private readonly freezes = new Map<string, FinancialFreeze>()
  private readonly idempotency = new Map<string, FinanceIdempotencyRecord>()
  private readonly reconciliations = new Map<string, ReconciliationResult>()

  getPayment(tenantId: string, commitmentId: string): FinancePaymentIntent | null {
    return clone(this.payments.get(key(tenantId, commitmentId)) ?? null)
  }

  savePayment(payment: FinancePaymentIntent): FinancePaymentIntent {
    this.payments.set(key(payment.tenantId, payment.commitmentId), clone(payment))
    return clone(payment)
  }

  getSnapshot(tenantId: string, commitmentId: string): FinanceCommissionSnapshot | null {
    const snapshot = this.snapshots.get(key(tenantId, commitmentId))
    return snapshot ? Object.freeze(clone(snapshot)) : null
  }

  saveSnapshot(snapshot: FinanceCommissionSnapshot): FinanceCommissionSnapshot {
    const snapshotKey = key(snapshot.tenantId, snapshot.commitmentId)
    if (this.snapshots.has(snapshotKey)) throw new FinanceError(409, 'SNAPSHOT_IMMUTABLE', 'commission snapshot already exists')
    this.snapshots.set(snapshotKey, clone(snapshot))
    return Object.freeze(clone(snapshot))
  }

  appendLedger(entry: FinanceLedgerEntry): FinanceLedgerEntry {
    if (!isSafeMinor(entry.amount) || !entry.currency.trim()) throw new FinanceError(400, 'INVALID_MONEY', 'ledger amount must be an exact minor unit')
    const existing = this.ledger.get(entry.entryId)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(entry)) throw new FinanceError(409, 'LEDGER_IMMUTABLE', 'ledger entries are append-only')
      return clone(existing)
    }
    this.ledger.set(entry.entryId, clone(entry))
    return clone(entry)
  }

  listLedger(tenantId: string, commitmentId: string): FinanceLedgerEntry[] {
    return [...this.ledger.values()]
      .filter((entry) => entry.tenantId === tenantId && entry.commitmentId === commitmentId)
      .map(clone)
  }

  saveEvidence(evidence: FinancialEvidence): FinancialEvidence {
    this.evidence.set(key(evidence.tenantId, evidence.evidenceId), clone(evidence))
    return clone(evidence)
  }

  listEvidence(tenantId: string, commitmentId: string): FinancialEvidence[] {
    return [...this.evidence.values()]
      .filter((evidence) => evidence.tenantId === tenantId && evidence.commitmentId === commitmentId)
      .map(clone)
  }

  saveConfirmation(confirmation: Confirmation): Confirmation {
    this.confirmations.set(key(confirmation.tenantId, confirmation.commitmentId), clone(confirmation))
    return clone(confirmation)
  }

  getConfirmation(tenantId: string, commitmentId: string): Confirmation | null {
    return clone(this.confirmations.get(key(tenantId, commitmentId)) ?? null)
  }

  saveFreeze(freeze: FinancialFreeze): FinancialFreeze {
    const freezeKey = key(freeze.tenantId, freeze.commitmentId)
    if (this.freezes.has(freezeKey)) return clone(this.freezes.get(freezeKey)!)
    this.freezes.set(freezeKey, clone(freeze))
    return clone(freeze)
  }

  getFreeze(tenantId: string, commitmentId: string): FinancialFreeze | null {
    return clone(this.freezes.get(key(tenantId, commitmentId)) ?? null)
  }

  getIdempotency(tenantId: string, idempotencyKey: string): FinanceIdempotencyRecord | null {
    return clone(this.idempotency.get(key(tenantId, idempotencyKey)) ?? null)
  }

  saveIdempotency(tenantId: string, idempotencyKey: string, record: FinanceIdempotencyRecord): void {
    this.idempotency.set(key(tenantId, idempotencyKey), clone(record))
  }

  getReconciliation(tenantId: string, commitmentId: string): ReconciliationResult | null {
    return clone(this.reconciliations.get(key(tenantId, commitmentId)) ?? null)
  }

  saveReconciliation(result: ReconciliationResult): ReconciliationResult {
    this.reconciliations.set(key(result.tenantId, result.commitmentId), clone(result))
    return clone(result)
  }
}

export class DeterministicMercadoPagoFinanceProvider implements FinancePaymentProvider {
  readonly source = 'deterministic-test-only' as const
  createCalls = 0
  private next: FinanceProviderPaymentResult = { providerReference: 'deterministic-payment', status: 'pending' }

  setNext(result: FinanceProviderPaymentResult): void {
    this.next = { ...result }
  }

  async createPaymentIntent(_input: FinanceProviderPaymentInput): Promise<FinanceProviderPaymentResult> {
    this.createCalls += 1
    return { ...this.next }
  }
}

export class UnavailableMercadoPagoFinanceProvider implements FinancePaymentProvider {
  readonly source = 'authorized' as const

  async createPaymentIntent(_input: FinanceProviderPaymentInput): Promise<FinanceProviderPaymentResult> {
    throw new FinanceError(503, 'PROVIDER_UNAVAILABLE', 'Mercado Pago payment execution is unavailable')
  }
}

export interface TusFinanceServiceOptions {
  store: FinanceStore
  provider: FinancePaymentProvider
  readiness?: Partial<FinancialReadiness>
  commitmentLookup: (commitmentId: string) => Promise<TusCommitment | null>
  now?: () => number
  commissionRateBps?: number
  ruleVersion?: string
  releaseJobs?: FinanceReleaseJobTransport
  readinessGuard?: TusReadinessGuard
  readinessProfile?: TusReadinessProfile
  readinessScope?: string
  providerEnabled?: boolean
  webhookSecret?: string
  providerRetry?: { maxAttempts: number; delayMs?: number }
  splitPolicy?: Partial<FinanceSplitPolicy>
  enforceFiveDayHold?: boolean
}

export class TusFinanceService {
  readonly store: FinanceStore
  private readonly provider: FinancePaymentProvider
  private readonly readiness: FinancialReadiness
  private readonly commitmentLookup: TusFinanceServiceOptions['commitmentLookup']
  private readonly now: () => number
  private readonly commissionRateBps: number
  private readonly ruleVersion: string
  private readonly releaseJobs?: FinanceReleaseJobTransport
  private readonly readinessGuard?: TusReadinessGuard
  private readonly readinessProfile: TusReadinessProfile
  private readonly readinessScope: string
  private readonly providerEnabled: boolean
  private readonly webhookSecret: string
  private readonly providerRetry: { maxAttempts: number; delayMs: number }
  private readonly splitPolicy: FinanceSplitPolicy
  private readonly enforceFiveDayHold: boolean

  constructor(options: TusFinanceServiceOptions) {
    this.store = options.store
    this.provider = options.provider
    this.readiness = { legal: false, kyc: false, kyb: false, tax: false, mercadoPago: false, reconciliation: false, ...options.readiness }
    this.commitmentLookup = options.commitmentLookup
    this.now = options.now ?? (() => Date.now())
    this.commissionRateBps = options.commissionRateBps ?? 1000
    this.ruleVersion = options.ruleVersion ?? 'mvp-10-percent-v1'
    this.releaseJobs = options.releaseJobs
    this.readinessGuard = options.readinessGuard
    this.readinessProfile = options.readinessProfile ?? 'native-local'
    this.readinessScope = options.readinessScope ?? 'argentina-stage-1'
    this.providerEnabled = options.providerEnabled ?? true
    this.webhookSecret = options.webhookSecret?.trim() ?? ''
    this.providerRetry = { maxAttempts: options.providerRetry?.maxAttempts ?? 1, delayMs: options.providerRetry?.delayMs ?? 0 }
    this.splitPolicy = {
      name: 'five-day-intermediary',
      version: options.splitPolicy?.version ?? 'argentina-five-day-v1',
      holdDays: 5,
      releaseRule: 'completion-confirmation-or-approved-policy',
      merchantOfRecord: 'tus-intermediary',
      providerEvidenceId: options.splitPolicy?.providerEvidenceId ?? null,
      legalEvidenceId: options.splitPolicy?.legalEvidenceId ?? null,
    }
    this.enforceFiveDayHold = options.enforceFiveDayHold ?? false
    if (!Number.isInteger(this.commissionRateBps) || this.commissionRateBps < 0) throw new Error('commissionRateBps must be a non-negative integer')
    if (!Number.isInteger(this.providerRetry.maxAttempts) || this.providerRetry.maxAttempts < 1) throw new Error('providerRetry.maxAttempts must be positive')
    if (!Number.isFinite(this.providerRetry.delayMs) || this.providerRetry.delayMs < 0) throw new Error('providerRetry.delayMs must be non-negative')
  }

  readinessStatus(): { enabled: boolean; failedGates: FinancialGateKey[] } {
    const failedGates = FINANCIAL_GATE_KEYS.filter((gate) => this.readiness[gate] !== true)
    return { enabled: failedGates.length === 0, failedGates }
  }

  payoutReadinessStatus(): { enabled: boolean; failedGates: FinancialPayoutGateKey[] } {
    const failedGates = FINANCIAL_PAYOUT_GATE_KEYS.filter((gate) => this.readiness[gate] !== true)
    return { enabled: failedGates.length === 0, failedGates }
  }

  async enqueueReleaseJob(input: FinanceCommandContext & { commitmentId: string }): Promise<{ status: 'queued'; tenantId: string; jobId: string }> {
    assertContext(input)
    await this.requireReadiness(input, 'release-jobs')
    if (!this.readinessStatus().enabled || !this.payoutReadinessStatus().enabled) throw new FinanceError(409, 'FINANCIAL_GATES_INCOMPLETE', 'release jobs are disabled until Argentina financial and payout custody gates pass')
    if (!this.releaseJobs) throw new FinanceError(503, 'RELEASE_JOBS_UNAVAILABLE', 'release job transport is unavailable')
    return this.releaseJobs.enqueue({ tenantId: input.tenantId, jobId: `release-${input.commitmentId}` })
  }

  async createPaymentIntent(input: FinanceCommandContext & { commitmentId: string; orderId?: string; posOperationId?: string | null; idempotencyKey: string; requestHash: string }): Promise<PaymentIntentResult> {
    assertContext(input)
    await this.requireReadiness(input, 'provider-actions')
    if (!input.idempotencyKey.trim() || !input.requestHash.trim()) throw new FinanceError(400, 'INVALID', 'idempotencyKey and requestHash are required')
    const existing = await this.store.getIdempotency(input.tenantId, input.idempotencyKey)
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new FinanceError(409, 'CONFLICT', 'payment idempotency key was already used for another request')
      return { status: 'replay', ...(clone(existing.response) as { payment: FinancePaymentIntent }) }
    }
    const commitment = await this.requireCommitment(input.tenantId, input.commitmentId)
    const now = this.now()
    const gates = this.readinessStatus()
    let payment: FinancePaymentIntent
    if (!gates.enabled || !this.providerEnabled) {
      payment = createPayment(input, commitment, null, 'pending', 'held', 'held-no-provider', now, this.splitPolicy)
      await this.store.savePayment(payment)
      const response = { status: 'held' as const, reason: !this.providerEnabled ? 'provider_disabled' as const : 'financial_gates_incomplete' as const, payment }
      await this.store.saveIdempotency(input.tenantId, input.idempotencyKey, { requestHash: input.requestHash, response })
      return response
    }
    let providerPayment: FinanceProviderPaymentResult
    try {
      providerPayment = await this.createProviderPayment({
        tenantId: input.tenantId,
        commitmentId: input.commitmentId,
        amount: commitment.amount,
        currency: commitment.currency,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
      })
    } catch (error) {
      const reason = error instanceof FinanceError && error.code === 'PROVIDER_TIMEOUT' ? 'timeout' : 'unavailable'
      payment = createPayment(input, commitment, null, 'provider_error', 'frozen', 'held-no-provider', now, this.splitPolicy)
      payment = { ...payment, providerError: reason }
      await this.store.savePayment(payment)
      const response = { status: 'frozen' as const, reason: reason === 'timeout' ? 'provider_timeout' as const : 'provider_unavailable' as const, payment }
      await this.store.saveIdempotency(input.tenantId, input.idempotencyKey, { requestHash: input.requestHash, response })
      return response
    }
    payment = createPayment(input, commitment, providerPayment.providerReference, providerPayment.status, 'held', this.provider.source, now, this.splitPolicy)
    await this.store.savePayment(payment)
    if (providerPayment.status === 'approved') await this.recordAuthoritativeSnapshot(input, commitment, payment, now)
    const response = { status: 'created' as const, payment }
    await this.store.saveIdempotency(input.tenantId, input.idempotencyKey, { requestHash: input.requestHash, response })
    return response
  }

  async handleWebhook(input: FinanceWebhookInput, nowMs = this.now()): Promise<FinanceWebhookResult> {
    assertContext(input)
    if (!input.eventId.trim() || !input.requestId.trim() || !input.paymentId.trim() || !input.providerReference.trim() || !isSafeMinor(input.amount) || !input.currency.trim() || !Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) {
      return { status: 'rejected', reason: 'invalid_request', payment: null }
    }
    if (!this.webhookSecret || !verifyFinanceWebhookSignature(this.webhookSecret, input)) return { status: 'rejected', reason: 'invalid_signature', payment: null }
    if (Math.abs(nowMs - input.timestamp * 1_000) > 300_000) return { status: 'rejected', reason: 'expired_signature', payment: null }
    const payment = await this.requirePayment(input.tenantId, input.commitmentId)
    if (payment.paymentId !== input.paymentId || payment.providerReference !== input.providerReference) return { status: 'rejected', reason: 'invalid_request', payment: null }
    if (payment.amount !== input.amount || payment.currency !== input.currency) {
      await this.freeze({ ...input, reason: 'provider-mismatch' })
      return { status: 'rejected', reason: 'invalid_request', payment: payment }
    }
    const idempotencyKey = `webhook:${input.eventId}`
    const existing = await this.store.getIdempotency(input.tenantId, idempotencyKey)
    if (existing) return { status: 'replay', payment: clone(existing.response) as FinancePaymentIntent | null }
    const eventAt = input.timestamp * 1_000
    if (payment.providerEventAt !== null && eventAt <= payment.providerEventAt) {
      await this.store.saveIdempotency(input.tenantId, idempotencyKey, { requestHash: webhookHash(input), response: payment })
      return { status: 'out_of_order', payment }
    }
    if (!isAllowedProviderTransition(payment.providerStatus, input.status)) return { status: 'rejected', reason: 'invalid_request', payment }
    const updated = { ...payment, providerStatus: input.status, commercialStatus: input.status === 'charged_back' ? 'frozen' as const : input.status === 'refunded' ? 'refunded' as const : payment.commercialStatus, providerEventAt: eventAt, updatedAt: this.now(), providerError: null }
    await this.store.savePayment(updated)
    if (input.status === 'approved' && !await this.store.getSnapshot(input.tenantId, input.commitmentId)) {
      await this.recordAuthoritativeSnapshot({ tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId, commitmentId: input.commitmentId }, await this.requireCommitment(input.tenantId, input.commitmentId), updated, this.now())
    }
    if (input.status === 'charged_back') await this.freeze({ ...input, reason: 'chargeback' })
    await this.store.saveIdempotency(input.tenantId, idempotencyKey, { requestHash: webhookHash(input), response: updated })
    return { status: 'processed', payment: updated }
  }

  private async createProviderPayment(input: FinanceProviderPaymentInput): Promise<FinanceProviderPaymentResult> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.providerRetry.maxAttempts; attempt += 1) {
      try {
        return await this.provider.createPaymentIntent(input)
      } catch (error) {
        lastError = error
        if (attempt < this.providerRetry.maxAttempts && this.providerRetry.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.providerRetry.delayMs))
      }
    }
    const reason = providerErrorReason(lastError)
    throw new FinanceError(503, reason === 'timeout' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE', `Mercado Pago provider ${reason}`)
  }

  async recordEvidence(input: CompletionEvidenceInput): Promise<FinancialEvidence> {
    assertContext(input)
    await this.requireReadiness(input, 'provider-actions')
    const commitment = await this.requireCommitment(input.tenantId, input.commitmentId)
    if (!['completion', 'check-in', 'delivery-accepted'].includes(input.kind)) throw new FinanceError(400, 'INVALID_EVIDENCE', 'unsupported financial evidence kind')
    if (!Number.isFinite(Date.parse(input.occurredAt))) throw new FinanceError(400, 'INVALID_EVIDENCE', 'evidence timestamp is invalid')
    void commitment
    return this.store.saveEvidence(createCompletionEvidence(input))
  }

  async confirmCompletion(input: FinanceCommandContext & { commitmentId: string; confirmationId: string; confirmedAt: string }): Promise<ReleaseResult> {
    assertContext(input)
    await this.requireReadiness(input, 'settlement')
    await this.requireCommitment(input.tenantId, input.commitmentId)
    if (!Number.isFinite(Date.parse(input.confirmedAt))) throw new FinanceError(400, 'INVALID', 'confirmation timestamp is invalid')
    await this.store.saveConfirmation({ confirmationId: input.confirmationId, tenantId: input.tenantId, commitmentId: input.commitmentId, actorId: input.actorId, correlationId: input.correlationId, confirmedAt: input.confirmedAt })
    return this.release({ ...input, now: input.confirmedAt })
  }

  async release(input: FinanceCommandContext & { commitmentId: string; now: string }): Promise<ReleaseResult> {
    assertContext(input)
    await this.requireReadiness(input, 'settlement')
    if (!this.readinessStatus().enabled) throw new FinanceError(409, 'FINANCIAL_GATES_INCOMPLETE', 'settlement release is held until Argentina financial gates pass')
    const payment = await this.requirePayment(input.tenantId, input.commitmentId)
    if (payment.commercialStatus === 'released') {
      const previousRelease = (await this.store.listLedger(input.tenantId, input.commitmentId)).find((entry) => entry.entryType === 'merchant_release')
      return { status: 'released', reason: releaseReason(previousRelease?.reason) }
    }
    if (this.enforceFiveDayHold && Date.parse(input.now) < payment.releaseAt) return { status: 'held', reason: 'five_day_hold_pending' }
    if (payment.providerStatus !== 'approved') return { status: 'held', reason: 'provider_confirmation_pending' }
    const freeze = await this.store.getFreeze(input.tenantId, input.commitmentId)
    if (freeze) return { status: 'frozen', reason: 'absolute_freeze', freeze }
    const evidence = (await this.store.listEvidence(input.tenantId, input.commitmentId)).find((item) => item.kind === 'completion' || item.kind === 'delivery-accepted')
    const commitment = await this.requireCommitment(input.tenantId, input.commitmentId)
    const evidenceEligibility = isReleaseEligible({
      commitmentContext: commitment.context,
      completionEvidence: evidence,
      now: input.now,
    })
    if (!evidenceEligibility.eligible && evidenceEligibility.reason === 'completion_evidence_required') {
      return { status: 'held', reason: 'completion_evidence_required' }
    }
    const confirmation = await this.store.getConfirmation(input.tenantId, input.commitmentId)
    if (!confirmation) return { status: 'held', reason: 'completion_confirmation_required' }
    const eligibility = isReleaseEligible({
      commitmentContext: commitment.context,
      completionEvidence: evidence,
      customerConfirmedAt: confirmation.confirmedAt,
      now: input.now,
    })
    if (!eligibility.eligible) return { status: 'held', reason: eligibility.reason }
    const released = { ...payment, commercialStatus: 'released' as const, updatedAt: this.now() }
    await this.store.savePayment(released)
    await this.store.appendLedger(this.entry(input, 'merchant_release', payment.amount - ((await this.store.getSnapshot(input.tenantId, input.commitmentId))?.commissionAmount ?? 0), payment.currency, eligibility.reason, null))
    return { status: 'released', reason: eligibility.reason }
  }

  async freeze(input: FinanceCommandContext & { commitmentId: string; reason: FinancialFreeze['reason'] }): Promise<{ status: 'frozen'; freeze: FinancialFreeze }> {
    assertContext(input)
    await this.requireReadiness(input, 'settlement')
    await this.requirePayment(input.tenantId, input.commitmentId)
    const freeze = await this.store.saveFreeze({ freezeId: `freeze-${input.commitmentId}-${this.now()}`, tenantId: input.tenantId, commitmentId: input.commitmentId, reason: input.reason, actorId: input.actorId, correlationId: input.correlationId, active: true, createdAt: this.now() })
    const payment = (await this.store.getPayment(input.tenantId, input.commitmentId))!
    await this.store.savePayment({ ...payment, commercialStatus: 'frozen', updatedAt: this.now() })
    return { status: 'frozen', freeze }
  }

  async openDispute(input: FinanceCommandContext & { commitmentId: string }): Promise<{ status: 'frozen'; freeze: FinancialFreeze }> {
    return this.freeze({ ...input, reason: 'dispute' })
  }

  async refund(input: FinanceCommandContext & { commitmentId: string; amount: number; reason: string; idempotencyKey: string }): Promise<RefundResult> {
    assertContext(input)
    await this.requireReadiness(input, 'settlement')
    const requestHash = `refund:${input.commitmentId}:${input.amount}:${input.reason}`
    const existing = await this.store.getIdempotency(input.tenantId, input.idempotencyKey)
    if (existing) {
      if (existing.requestHash !== requestHash) throw new FinanceError(409, 'CONFLICT', 'refund idempotency key was already used for another request')
      return clone(existing.response) as RefundResult
    }
    const payment = await this.requirePayment(input.tenantId, input.commitmentId)
    if (!isSafeMinor(input.amount) || input.amount <= 0) throw new FinanceError(400, 'INVALID_REFUND', 'refund amount is outside the payment amount')
    const refundedAmount = sumMinor((await this.store.listLedger(input.tenantId, input.commitmentId)).filter((entry) => entry.entryType === 'refund_compensation').map((entry) => entry.amount))
    if (input.amount > payment.amount - refundedAmount) throw new FinanceError(409, 'REFUND_EXCEEDS_REMAINING', 'refund amount exceeds the remaining payment')
    const result: RefundResult = { status: 'compensated', refundId: `refund-${input.commitmentId}-${input.idempotencyKey}`, commitmentId: input.commitmentId, amount: input.amount, reason: input.reason, deterministic: this.provider.source === 'deterministic-test-only' }
    await this.freeze({ ...input, reason: 'refund' })
    await this.store.appendLedger(this.entry(input, 'refund_compensation', input.amount, payment.currency, input.reason, `gross-${input.commitmentId}`, result.refundId))
    if (input.amount === payment.amount - refundedAmount) await this.store.savePayment({ ...payment, providerStatus: 'refunded', commercialStatus: 'refunded', updatedAt: this.now() })
    await this.store.saveIdempotency(input.tenantId, input.idempotencyKey, { requestHash, response: result })
    return result
  }

  async chargeback(input: FinanceCommandContext & { commitmentId: string }): Promise<{ status: 'frozen'; freeze: FinancialFreeze }> {
    const result = await this.freeze({ ...input, reason: 'chargeback' })
    const payment = await this.requirePayment(input.tenantId, input.commitmentId)
    await this.store.appendLedger(this.entry(input, 'chargeback_compensation', payment.amount, payment.currency, 'provider-chargeback', null, `chargeback-${input.commitmentId}`))
    return result
  }

  async reconcile(input: FinanceCommandContext & { commitmentId: string; providerReference: string; providerAmount: number }): Promise<ReconciliationResult> {
    assertContext(input)
    await this.requireReadiness(input, 'settlement')
    const existing = await this.store.getReconciliation(input.tenantId, input.commitmentId)
    if (existing) return existing
    const payment = await this.requirePayment(input.tenantId, input.commitmentId)
    const matches = payment.providerReference === input.providerReference && isSafeMinor(input.providerAmount) && payment.amount === input.providerAmount
    const result: ReconciliationResult = {
      reconciliationId: `reconciliation-${input.commitmentId}`,
      tenantId: input.tenantId,
      commitmentId: input.commitmentId,
      providerReference: input.providerReference,
      providerAmount: input.providerAmount,
      evidenceId: `reconciliation-evidence-${input.commitmentId}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
      status: matches ? 'clean' : 'quarantined',
      reason: matches ? 'matched' : payment.providerReference !== input.providerReference ? 'provider_reference_mismatch' : 'provider_amount_mismatch',
      deterministic: this.provider.source === 'deterministic-test-only',
      createdAt: this.now(),
    }
    await this.store.saveReconciliation(result)
    if (!matches) {
      await this.freeze({ ...input, reason: 'provider-mismatch' })
      await this.store.appendLedger(this.entry(input, 'reconciliation_compensation', input.providerAmount, payment.currency, `reconciliation:${result.reason}`, `gross-${input.commitmentId}`, `reconciliation-${input.commitmentId}`))
    }
    return result
  }

  private async requireCommitment(tenantId: string, commitmentId: string): Promise<TusCommitment> {
    const commitment = await this.commitmentLookup(commitmentId)
    if (!commitment) throw new FinanceError(404, 'NOT_FOUND', 'commitment was not found')
    if (commitment.tenantId !== tenantId) throw new FinanceError(403, 'FORBIDDEN', 'commitment is outside the authenticated tenant')
    return commitment
  }

  private requireReadiness(
    input: FinanceCommandContext,
    capability: 'provider-actions' | 'settlement' | 'release-jobs',
  ): Promise<unknown> {
    return this.readinessGuard?.require({
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      capability,
      profile: this.readinessProfile,
      scope: this.readinessScope,
    }) ?? Promise.resolve()
  }

  private async requirePayment(tenantId: string, commitmentId: string): Promise<FinancePaymentIntent> {
    const payment = await this.store.getPayment(tenantId, commitmentId)
    if (!payment) throw new FinanceError(404, 'PAYMENT_NOT_FOUND', 'payment intent was not found')
    return payment
  }

  private async recordAuthoritativeSnapshot(input: FinanceCommandContext & { commitmentId: string }, commitment: TusCommitment, payment: FinancePaymentIntent, now: number): Promise<FinanceCommissionSnapshot> {
    const commissionAmount = calculateCommissionAmount(commitment.amount, this.commissionRateBps)
    const snapshot = createCommissionSnapshot({ snapshotId: `snapshot-${commitment.commitmentId}`, tenantId: input.tenantId, commitmentId: commitment.commitmentId, context: commitment.context, grossAmount: commitment.amount, deductions: 0, commissionableBase: commitment.amount, rateBps: this.commissionRateBps, ruleVersion: this.ruleVersion, currency: commitment.currency, providerReference: payment.providerReference!, evidenceId: `payment-authorized:${payment.paymentId}`, commissionAmount, netAmount: commitment.amount - commissionAmount, ledgerStatus: 'held', createdAt: now })
    await this.store.saveSnapshot(snapshot)
    const ledgerContext = { ...input, commitmentId: commitment.commitmentId }
    await this.store.appendLedger(this.entry(ledgerContext, 'gross_authorized', commitment.amount, commitment.currency, 'provider-approved', null, `gross-${commitment.commitmentId}`))
    await this.store.appendLedger(this.entry(ledgerContext, 'commission_reserved', commissionAmount, commitment.currency, this.ruleVersion, `gross-${commitment.commitmentId}`, `commission-${commitment.commitmentId}`))
    await this.store.appendLedger(this.entry(ledgerContext, 'merchant_payable_held', commitment.amount - commissionAmount, commitment.currency, 'confirmation-first-hold', `commission-${commitment.commitmentId}`, `payable-${commitment.commitmentId}`))
    return snapshot
  }

  private entry(input: FinanceCommandContext & { commitmentId: string }, entryType: FinanceLedgerEntryType, amount: number, currency: string, reason: string, linkedEntryId: string | null, entryId = `${entryType}-${input.commitmentId}-${this.now()}`): FinanceLedgerEntry {
    return { entryId, tenantId: input.tenantId, commitmentId: input.commitmentId, entryType, amount, currency, linkedEntryId, reason, immutable: true, createdAt: this.now() }
  }
}

export type FinanceCommandContext = { tenantId: string; actorId: string; correlationId: string }
export type PaymentIntentResult =
  | { status: 'created'; payment: FinancePaymentIntent }
  | { status: 'held'; reason: 'financial_gates_incomplete' | 'provider_disabled'; payment: FinancePaymentIntent }
  | { status: 'frozen'; reason: 'provider_timeout' | 'provider_unavailable'; payment: FinancePaymentIntent }
  | { status: 'replay'; payment: FinancePaymentIntent }
export type ReleaseResult =
  | { status: 'released'; reason: Exclude<ReleaseEligibility, { eligible: false }>['reason'] }
  | { status: 'held'; reason: Exclude<ReleaseEligibility, { eligible: true }>['reason'] | 'provider_confirmation_pending' | 'completion_confirmation_required' | 'five_day_hold_pending' }
  | { status: 'frozen'; reason: 'absolute_freeze'; freeze: FinancialFreeze }
export type RefundResult = { status: 'compensated'; refundId: string; commitmentId: string; amount: number; reason: string; deterministic: boolean }

export function createCommissionSnapshot(input: Omit<FinanceCommissionSnapshot, 'contractVersion'>): FinanceCommissionSnapshot {
  if (!isSafeMinor(input.grossAmount) || !isSafeMinor(input.deductions) || !isSafeMinor(input.commissionableBase) || !isSafeMinor(input.commissionAmount) || !isSafeMinor(input.netAmount)) throw new Error('commission amounts must be non-negative exact minor units')
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0) throw new Error('rateBps must be a non-negative integer')
  if (input.deductions > input.grossAmount || input.commissionableBase > input.grossAmount - input.deductions) throw new Error('commissionable base exceeds gross amount after deductions')
  if (input.commissionAmount !== calculateCommissionAmount(input.commissionableBase, input.rateBps)) throw new Error('commission amount does not match the snapshotted rate and base')
  if (input.netAmount !== input.grossAmount - input.deductions - input.commissionAmount) throw new Error('net amount does not match the snapshotted commission')
  return Object.freeze({ contractVersion: TUS_CONTRACT_VERSION, ...input })
}

function releaseReason(reason: string | undefined): Exclude<ReleaseEligibility, { eligible: false }>['reason'] {
  if (reason === 'service_release_window_elapsed' || reason === 'delivery_release_window_elapsed' || reason === 'local_policy_elapsed') return reason
  return 'customer_confirmed'
}

function createPayment(input: FinanceCommandContext & { commitmentId: string; orderId?: string; posOperationId?: string | null; idempotencyKey: string }, commitment: TusCommitment, providerReference: string | null, providerStatus: FinancePaymentProviderStatus, commercialStatus: FinanceCommercialStatus, source: FinancePaymentIntent['source'], now: number, splitPolicy: FinanceSplitPolicy): FinancePaymentIntent {
  assertExactMoney(commitment.currency, commitment.amount)
  return { contractVersion: TUS_CONTRACT_VERSION, paymentId: `payment-${commitment.commitmentId}`, tenantId: input.tenantId, commitmentId: commitment.commitmentId, provider: 'mercado-pago', providerReference, providerStatus, commercialStatus, amount: commitment.amount, currency: commitment.currency, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, credentialsCollected: false, source, orderId: input.orderId?.trim() || commitment.cartId, posOperationId: input.posOperationId?.trim() || null, merchantOfRecord: 'tus-intermediary', collectionModel: 'intermediary', splitPolicy: Object.freeze({ ...splitPolicy }), releaseAt: now + 5 * 24 * 60 * 60 * 1000, providerEventAt: null, providerError: null, createdAt: now, updatedAt: now }
}

export function createFinanceMoney(currency: string, minor: bigint): { currency: string; minor: bigint } {
  const normalizedCurrency = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(normalizedCurrency)) throw new Error('currency must be an ISO 4217 code')
  if (typeof minor !== 'bigint' || minor < 0n) throw new TypeError('money minor units must be a non-negative bigint')
  return { currency: normalizedCurrency, minor }
}

export function createFinanceWebhookSignature(input: { secret: string; eventId: string; requestId: string; timestamp: number }): string {
  if (!input.secret.trim() || !input.eventId.trim() || !input.requestId.trim() || !Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) throw new Error('webhook signing context is invalid')
  const manifest = `id:${input.eventId};request-id:${input.requestId};ts:${input.timestamp};`
  return `ts=${input.timestamp},v1=${createHmac('sha256', input.secret).update(manifest).digest('hex')}`
}

export function verifyFinanceWebhookSignature(secret: string, input: Pick<FinanceWebhookInput, 'eventId' | 'requestId' | 'timestamp' | 'signature'>): boolean {
  if (!secret.trim()) return false
  const expected = createFinanceWebhookSignature({ secret, eventId: input.eventId, requestId: input.requestId, timestamp: input.timestamp }).split('v1=')[1] ?? ''
  const parts = input.signature.split(',').map((part) => part.trim())
  const signedTimestamp = Number(parts.find((part) => part.startsWith('ts='))?.slice(3) ?? Number.NaN)
  if (!Number.isSafeInteger(signedTimestamp) || signedTimestamp !== input.timestamp) return false
  const supplied = parts.find((part) => part.startsWith('v1='))?.slice(3) ?? ''
  const expectedBytes = Buffer.from(expected, 'hex')
  const suppliedBytes = Buffer.from(supplied, 'hex')
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}

function isSafeMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function sumMinor(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!isSafeMinor(total)) throw new FinanceError(409, 'MONEY_OVERFLOW', 'money total exceeds the supported exact range')
  return total
}

function calculateCommissionAmount(base: number, rateBps: number): number {
  const amount = (BigInt(base) * BigInt(rateBps) + 5_000n) / 10_000n
  const normalized = Number(amount)
  if (!isSafeMinor(normalized)) throw new FinanceError(409, 'MONEY_OVERFLOW', 'commission exceeds the supported exact range')
  return normalized
}

function assertExactMoney(currency: string, minor: number): void {
  createFinanceMoney(currency, BigInt(minor))
}

function providerErrorReason(error: unknown): 'timeout' | 'unavailable' {
  return error instanceof Error && (error as Error & { code?: string }).code === 'PROVIDER_TIMEOUT' ? 'timeout' : 'unavailable'
}

function webhookHash(input: FinanceWebhookInput): string {
  return `${input.eventId}:${input.paymentId}:${input.status}:${input.timestamp}`
}

function isAllowedProviderTransition(current: FinancePaymentProviderStatus, next: FinancePaymentProviderStatus): boolean {
  if (current === next) return true
  if (current === 'pending') return true
  if (current === 'approved') return next === 'refunded' || next === 'charged_back'
  return false
}

function assertContext(input: FinanceCommandContext): void {
  if (!input.tenantId.trim() || !input.actorId.trim() || !input.correlationId.trim()) throw new FinanceError(400, 'INVALID_CONTEXT', 'financial authorization context is required')
}

function key(tenantId: string, id: string): string {
  return `${tenantId}:${id}`
}

function clone<T>(value: T): T {
  return value === null ? value : structuredClone(value)
}

export default { DeterministicMercadoPagoFinanceProvider, FinanceError, InMemoryFinanceStore, TusFinanceService, UnavailableMercadoPagoFinanceProvider, createCommissionSnapshot, createFinanceMoney, createFinanceWebhookSignature, verifyFinanceWebhookSignature }
