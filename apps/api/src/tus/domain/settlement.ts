import type {
  CommitmentContext,
  CompletionEvidence,
  SettlementSnapshot,
  TusDispute,
} from '@factory/contracts'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import { isCompletionEvidence } from './evidence.ts'

const MVP_RATE_BPS = 1000
const SERVICE_RELEASE_WINDOW_MS = 12 * 60 * 60 * 1000
const ONLINE_DELIVERY_RELEASE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface SettlementSnapshotInput {
  commitmentId: string
  context: CommitmentContext
  ruleVersion: string
  commissionableBase: number
  evidenceId: string
  currency?: string
  rateBps?: number
}

export function createSettlementSnapshot(input: SettlementSnapshotInput): SettlementSnapshot {
  const rateBps = input.rateBps ?? MVP_RATE_BPS
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new Error('rateBps must be a non-negative integer')
  if (!Number.isFinite(input.commissionableBase) || input.commissionableBase < 0) {
    throw new Error('commissionableBase must be non-negative')
  }

  return Object.freeze({
    contractVersion: TUS_CONTRACT_VERSION,
    commitmentId: input.commitmentId,
    context: input.context,
    ruleVersion: input.ruleVersion,
    commissionableBase: input.commissionableBase,
    rateBps,
    commissionAmount: Math.round((input.commissionableBase * rateBps) / 10_000),
    currency: input.currency ?? 'ARS',
    evidenceId: input.evidenceId,
  })
}

export interface ReleaseEligibilityInput {
  commitmentContext: CommitmentContext
  completionEvidence?: CompletionEvidence
  customerConfirmedAt?: string
  dispute?: Pick<TusDispute, 'status'>
  riskHold?: boolean
  chargeback?: boolean
  fraudRisk?: boolean
  unresolvedIncident?: boolean
  deliveryMode?: 'online' | 'long-shipment' | 'local'
  localReleaseAfterMs?: number
  now: string
}

export type ReleaseEligibility =
  | { eligible: true; reason: 'customer_confirmed' | 'service_release_window_elapsed' | 'delivery_release_window_elapsed' | 'local_policy_elapsed' }
  | { eligible: false; reason: 'absolute_freeze' | 'completion_evidence_required' | 'service_release_window_pending' | 'delivery_release_window_pending' | 'local_policy_required' }

export function isReleaseEligible(input: ReleaseEligibilityInput): ReleaseEligibility {
  if (
    input.riskHold === true ||
    input.chargeback === true ||
    input.fraudRisk === true ||
    input.unresolvedIncident === true ||
    input.dispute?.status === 'open'
  ) {
    return { eligible: false, reason: 'absolute_freeze' }
  }
  const completionEvidence = input.completionEvidence
  if (!isCompletionEvidence(completionEvidence)) {
    return { eligible: false, reason: 'completion_evidence_required' }
  }
  if (input.customerConfirmedAt !== undefined) return { eligible: true, reason: 'customer_confirmed' }

  const occurredAt = Date.parse(completionEvidence.occurredAt)
  const now = Date.parse(input.now)
  const elapsed = now - occurredAt
  if (input.commitmentContext === 'service') {
    return elapsed >= SERVICE_RELEASE_WINDOW_MS
      ? { eligible: true, reason: 'service_release_window_elapsed' }
      : { eligible: false, reason: 'service_release_window_pending' }
  }

  if (input.deliveryMode === 'local') {
    if (input.localReleaseAfterMs === undefined) return { eligible: false, reason: 'local_policy_required' }
    return elapsed >= input.localReleaseAfterMs
      ? { eligible: true, reason: 'local_policy_elapsed' }
      : { eligible: false, reason: 'delivery_release_window_pending' }
  }

  return elapsed >= ONLINE_DELIVERY_RELEASE_WINDOW_MS
    ? { eligible: true, reason: 'delivery_release_window_elapsed' }
    : { eligible: false, reason: 'delivery_release_window_pending' }
}
