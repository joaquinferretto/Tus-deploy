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

export type FinancePaymentProviderStatus = 'pending' | 'approved' | 'rejected' | 'refunded' | 'cancelled'
export type FinanceCommercialStatus = 'held' | 'released' | 'frozen' | 'refunded'
export type FinanceLedgerEntryType =
  | 'gross_authorized'
  | 'commission_reserved'
  | 'merchant_payable_held'
  | 'merchant_release'
  | 'refund_compensation'
  | 'chargeback_compensation'
  | 'reconciliation_compensation'

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
  status: FinancePaymentProviderStatus
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
    if (!Number.isInteger(this.commissionRateBps) || this.commissionRateBps < 0) throw new Error('commissionRateBps must be a non-negative integer')
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

  async createPaymentIntent(input: FinanceCommandContext & { commitmentId: string; idempotencyKey: string; requestHash: string }): Promise<PaymentIntentResult> {
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
    if (!gates.enabled) {
      payment = createPayment(input, commitment, null, 'pending', 'held', 'held-no-provider', now)
      await this.store.savePayment(payment)
      const response = { status: 'held' as const, reason: 'financial_gates_incomplete' as const, payment }
      await this.store.saveIdempotency(input.tenantId, input.idempotencyKey, { requestHash: input.requestHash, response })
      return response
    }
    const providerPayment = await this.provider.createPaymentIntent({
      tenantId: input.tenantId,
      commitmentId: input.commitmentId,
      amount: commitment.amount,
      currency: commitment.currency,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    })
    payment = createPayment(input, commitment, providerPayment.providerReference, providerPayment.status, providerPayment.status === 'approved' ? 'held' : 'held', this.provider.source, now)
    await this.store.savePayment(payment)
    if (providerPayment.status === 'approved') await this.recordAuthoritativeSnapshot(input, commitment, payment, now)
    const response = { status: 'created' as const, payment }
    await this.store.saveIdempotency(input.tenantId, input.idempotencyKey, { requestHash: input.requestHash, response })
    return response
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
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > payment.amount) throw new FinanceError(400, 'INVALID_REFUND', 'refund amount is outside the payment amount')
    const result: RefundResult = { status: 'compensated', refundId: `refund-${input.commitmentId}-${input.idempotencyKey}`, commitmentId: input.commitmentId, amount: input.amount, reason: input.reason, deterministic: this.provider.source === 'deterministic-test-only' }
    await this.freeze({ ...input, reason: 'refund' })
    await this.store.appendLedger(this.entry(input, 'refund_compensation', input.amount, payment.currency, input.reason, `gross-${input.commitmentId}`, result.refundId))
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
    const matches = payment.providerReference === input.providerReference && payment.amount === input.providerAmount
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

  private async recordAuthoritativeSnapshot(input: FinanceCommandContext, commitment: TusCommitment, payment: FinancePaymentIntent, now: number): Promise<FinanceCommissionSnapshot> {
    const commissionAmount = Math.round((commitment.amount * this.commissionRateBps) / 10_000)
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
  | { status: 'held'; reason: 'financial_gates_incomplete'; payment: FinancePaymentIntent }
  | { status: 'replay'; payment: FinancePaymentIntent }
export type ReleaseResult =
  | { status: 'released'; reason: Exclude<ReleaseEligibility, { eligible: false }>['reason'] }
  | { status: 'held'; reason: Exclude<ReleaseEligibility, { eligible: true }>['reason'] | 'provider_confirmation_pending' | 'completion_confirmation_required' }
  | { status: 'frozen'; reason: 'absolute_freeze'; freeze: FinancialFreeze }
export type RefundResult = { status: 'compensated'; refundId: string; commitmentId: string; amount: number; reason: string; deterministic: boolean }

export function createCommissionSnapshot(input: Omit<FinanceCommissionSnapshot, 'contractVersion'>): FinanceCommissionSnapshot {
  if (!Number.isFinite(input.grossAmount) || input.grossAmount < 0 || !Number.isFinite(input.deductions) || input.deductions < 0 || !Number.isFinite(input.commissionableBase) || input.commissionableBase < 0 || !Number.isFinite(input.commissionAmount) || input.commissionAmount < 0 || !Number.isFinite(input.netAmount) || input.netAmount < 0) throw new Error('commission amounts must be non-negative')
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0) throw new Error('rateBps must be a non-negative integer')
  if (input.deductions > input.grossAmount || input.commissionableBase > input.grossAmount - input.deductions) throw new Error('commissionable base exceeds gross amount after deductions')
  if (input.commissionAmount !== Math.round((input.commissionableBase * input.rateBps) / 10_000)) throw new Error('commission amount does not match the snapshotted rate and base')
  if (input.netAmount !== input.grossAmount - input.deductions - input.commissionAmount) throw new Error('net amount does not match the snapshotted commission')
  return Object.freeze({ contractVersion: TUS_CONTRACT_VERSION, ...input })
}

function releaseReason(reason: string | undefined): Exclude<ReleaseEligibility, { eligible: false }>['reason'] {
  if (reason === 'service_release_window_elapsed' || reason === 'delivery_release_window_elapsed' || reason === 'local_policy_elapsed') return reason
  return 'customer_confirmed'
}

function createPayment(input: FinanceCommandContext & { commitmentId: string; idempotencyKey: string }, commitment: TusCommitment, providerReference: string | null, providerStatus: FinancePaymentProviderStatus, commercialStatus: FinanceCommercialStatus, source: FinancePaymentIntent['source'], now: number): FinancePaymentIntent {
  return { contractVersion: TUS_CONTRACT_VERSION, paymentId: `payment-${commitment.commitmentId}`, tenantId: input.tenantId, commitmentId: commitment.commitmentId, provider: 'mercado-pago', providerReference, providerStatus, commercialStatus, amount: commitment.amount, currency: commitment.currency, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, credentialsCollected: false, source, createdAt: now, updatedAt: now }
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

export default { DeterministicMercadoPagoFinanceProvider, FinanceError, InMemoryFinanceStore, TusFinanceService, UnavailableMercadoPagoFinanceProvider, createCommissionSnapshot }
