import type {
  JobRecord,
  RunEventRecord,
  RunLedgerRecord,
  SagaRecord,
  StoredRunEventRecord,
} from '../platform/jobs/domain.js'
import type { PrivacyRecord, PrivacyRequest } from '../privacy/domain.js'

export const BACKUP_STATUS = {
  CREATED: 'created',
  VERIFIED: 'verified',
  RESTORED: 'restored',
  FAILED: 'failed',
} as const

export type BackupStatus = (typeof BACKUP_STATUS)[keyof typeof BACKUP_STATUS]

export const RECOVERY_STATUS = {
  RECOVERED: 'recovered',
  DEGRADED: 'degraded',
  FAILED: 'failed',
} as const

export type RecoveryStatus = (typeof RECOVERY_STATUS)[keyof typeof RECOVERY_STATUS]

export interface RecoveryState {
  jobs: readonly JobRecord[]
  runs: readonly RunLedgerRecord[]
  events: readonly StoredRunEventRecord[]
  sagas: readonly SagaRecord[]
  privacyRecords: readonly PrivacyRecord[]
  privacyRequests: readonly PrivacyRequest[]
}

export interface BackupRecord {
  schemaVersion: 'factory.recovery.v1'
  backupId: string
  tenantId: string
  profile: 'native' | 'render-native' | 'aws-terraform'
  createdAt: number
  verifiedAt: number | null
  status: BackupStatus
  state: RecoveryState
  liveConformance: false
}

export interface BackupEvidence {
  backupId: string
  tenantId: string
  profile: BackupRecord['profile']
  status: 'verified' | 'deferred'
  verified: boolean
  stateCounts: RecoveryStateCounts
  verifiedAt: number | null
  liveConformance: false
}

export interface RestoreResult {
  backupId: string
  tenantId: string
  status: 'restored' | 'failed'
  state: RecoveryState
  restoredAt: number
  liveConformance: false
}

export interface RecoveryStateCounts {
  jobs: number
  runs: number
  events: number
  sagas: number
  privacyRecords: number
  privacyRequests: number
}

export interface RecoveryReplayEvidence {
  status: RecoveryStatus
  backupId: string
  tenantId: string
  restored: boolean
  reconciliation: {
    recoveredJobs: number
    recoverableRuns: number
    pendingEvents: number
    status: 'clean' | 'recovered'
  }
  replayed: number
  alreadyQueued: number
  liveConformance: false
}

export function cloneRecoveryState(state: RecoveryState): RecoveryState {
  return structuredClone(state)
}

export function countRecoveryState(state: RecoveryState): RecoveryStateCounts {
  return {
    jobs: state.jobs.length,
    runs: state.runs.length,
    events: state.events.length,
    sagas: state.sagas.length,
    privacyRecords: state.privacyRecords.length,
    privacyRequests: state.privacyRequests.length,
  }
}

export function toRecoveryState(input: {
  jobs?: readonly JobRecord[]
  runs?: readonly RunLedgerRecord[]
  events?: readonly (RunEventRecord | StoredRunEventRecord)[]
  sagas?: readonly SagaRecord[]
  privacyRecords?: readonly PrivacyRecord[]
  privacyRequests?: readonly PrivacyRequest[]
}): RecoveryState {
  return {
    jobs: structuredClone(input.jobs ?? []),
    runs: structuredClone(input.runs ?? []),
    events: structuredClone(
      (input.events ?? []).map((event) =>
        'status' in event ? event : { ...event, status: 'pending', claimId: null }
      )
    ) as StoredRunEventRecord[],
    sagas: structuredClone(input.sagas ?? []),
    privacyRecords: structuredClone(input.privacyRecords ?? []),
    privacyRequests: structuredClone(input.privacyRequests ?? []),
  }
}

export default {
  BACKUP_STATUS,
  RECOVERY_STATUS,
  cloneRecoveryState,
  countRecoveryState,
  toRecoveryState,
}
