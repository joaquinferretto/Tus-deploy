import type {
  PrivacyRequestInput,
  RequestResult,
  RetentionRunInput,
  RetentionRunResult,
} from '../privacy/application/privacy-service.js'

export interface RetentionRunner {
  runRetention(input: RetentionRunInput): Promise<RetentionRunResult>
}

export interface DeletionPropagationAction {
  action: string
  tenantId: string
}

export interface DeletionRunner {
  requestDeletion(input: PrivacyRequestInput): Promise<RequestResult>
  propagation?: { actions: readonly DeletionPropagationAction[] }
}

export interface RetentionRecoveryEvidence {
  status: 'verified' | 'degraded'
  purged: number
  anonymized: number
  held: number
  failed: number
  propagated: number
  liveConformance: false
}

export interface DeletionRecoveryEvidence {
  status: 'verified' | 'degraded'
  completed: boolean
  idempotent: boolean
  propagated: number
  liveConformance: false
}

export async function runRetentionWithEvidence(
  runner: RetentionRunner,
  input: RetentionRunInput
): Promise<RetentionRecoveryEvidence> {
  const result = await runner.runRetention(input)
  return {
    status: result.failed === 0 ? 'verified' : 'degraded',
    purged: result.purged,
    anonymized: result.anonymized,
    held: result.held,
    failed: result.failed,
    propagated: result.purged + result.anonymized,
    liveConformance: false,
  }
}

export async function runDeletionWithEvidence(
  runner: DeletionRunner,
  input: PrivacyRequestInput
): Promise<DeletionRecoveryEvidence> {
  const before = runner.propagation?.actions.length ?? 0
  const result = await runner.requestDeletion(input)
  const after = runner.propagation?.actions.length ?? before
  const completed = result.ok && result.request.status === 'completed'
  return {
    status: completed ? 'verified' : 'degraded',
    completed,
    idempotent: result.ok && result.idempotent === true,
    propagated: Math.max(0, after - before),
    liveConformance: false,
  }
}

export default {
  runDeletionWithEvidence,
  runRetentionWithEvidence,
}
