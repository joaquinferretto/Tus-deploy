import {
  BACKUP_STATUS,
  cloneRecoveryState,
  countRecoveryState,
  type BackupEvidence,
  type BackupRecord,
  type RecoveryState,
  type RestoreResult,
} from './domain.js'

export interface BackupActivationInput {
  credentials: boolean
  resources: boolean
  authorizedSmoke: boolean
}

export interface BackupActivationResult {
  status: 'authorized' | 'deferred'
  liveConformance: boolean
  effectiveMode: 'managed' | 'deterministic-fake'
  missing: string[]
}

export interface BackupStorePort {
  create(input: CreateBackupInput): BackupRecord
  verify(tenantId: string, backupId: string, verifiedAt: number): BackupEvidence
  restore(tenantId: string, backupId: string, restoredAt: number): RestoreResult
}

export interface CreateBackupInput {
  backupId: string
  tenantId: string
  profile: BackupRecord['profile']
  createdAt: number
  state: RecoveryState
}

export function evaluateBackupActivationGate(input: BackupActivationInput): BackupActivationResult {
  const missing = [
    !input.credentials ? 'credentials' : null,
    !input.resources ? 'resources' : null,
    !input.authorizedSmoke ? 'authorizedSmoke' : null,
  ].filter((value): value is string => value !== null)
  if (missing.length > 0) {
    return {
      status: 'deferred',
      liveConformance: false,
      effectiveMode: 'deterministic-fake',
      missing,
    }
  }
  return {
    status: 'authorized',
    liveConformance: true,
    effectiveMode: 'managed',
    missing: [],
  }
}

export class InMemoryBackupStore implements BackupStorePort {
  private readonly backups = new Map<string, BackupRecord>()

  create(input: CreateBackupInput): BackupRecord {
    requireText(input.backupId, input.tenantId)
    if (!Number.isFinite(input.createdAt)) throw new Error('Backup creation time is required')
    assertTenantState(input.tenantId, input.state)
    const key = backupKey(input.tenantId, input.backupId)
    const existing = this.backups.get(key)
    if (existing) return structuredClone(existing)
    const record: BackupRecord = {
      schemaVersion: 'factory.recovery.v1',
      backupId: input.backupId,
      tenantId: input.tenantId,
      profile: input.profile,
      createdAt: input.createdAt,
      verifiedAt: null,
      status: BACKUP_STATUS.CREATED,
      state: cloneRecoveryState(input.state),
      liveConformance: false,
    }
    this.backups.set(key, record)
    return structuredClone(record)
  }

  verify(tenantId: string, backupId: string, verifiedAt: number): BackupEvidence {
    const record = this.require(tenantId, backupId)
    if (!Number.isFinite(verifiedAt)) throw new Error('Backup verification time is required')
    assertTenantState(tenantId, record.state)
    record.status = BACKUP_STATUS.VERIFIED
    record.verifiedAt = verifiedAt
    this.backups.set(backupKey(tenantId, backupId), record)
    return {
      backupId,
      tenantId,
      profile: record.profile,
      status: 'verified',
      verified: true,
      stateCounts: countRecoveryState(record.state),
      verifiedAt,
      liveConformance: false,
    }
  }

  restore(tenantId: string, backupId: string, restoredAt: number): RestoreResult {
    const record = this.require(tenantId, backupId)
    if (record.status !== BACKUP_STATUS.VERIFIED || record.verifiedAt === null)
      throw new Error('Only a verified backup can be restored')
    if (!Number.isFinite(restoredAt)) throw new Error('Backup restore time is required')
    return {
      backupId,
      tenantId,
      status: 'restored',
      state: cloneRecoveryState(record.state),
      restoredAt,
      liveConformance: false,
    }
  }

  get(tenantId: string, backupId: string): BackupRecord | null {
    const record = this.backups.get(backupKey(tenantId, backupId))
    return record ? structuredClone(record) : null
  }

  private require(tenantId: string, backupId: string): BackupRecord {
    const record = this.backups.get(backupKey(tenantId, backupId))
    if (!record) throw new Error('Verified backup not found')
    return record
  }
}

function backupKey(tenantId: string, backupId: string): string {
  return `${tenantId}:${backupId}`
}

function assertTenantState(tenantId: string, state: RecoveryState): void {
  const records = [
    ...state.jobs,
    ...state.runs,
    ...state.events,
    ...state.sagas,
    ...state.privacyRecords,
    ...state.privacyRequests,
  ]
  for (const record of records) {
    if (record.tenantId !== tenantId) throw new Error('Recovery snapshot crosses tenant boundary')
  }
}

function requireText(...values: string[]): void {
  if (values.some((value) => !value.trim())) throw new Error('Backup identifiers are required')
}

export default {
  InMemoryBackupStore,
  evaluateBackupActivationGate,
}
