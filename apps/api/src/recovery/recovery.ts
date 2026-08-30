import { eventKey, jobKey, runLedgerKey } from '../platform/jobs/domain.js'
import type { DurableJobPlatformPort } from '../platform/jobs/ports.js'
import { DurableJobService } from '../platform/jobs/application/durable-job-service.js'
import {
  cloneRecoveryState,
  countRecoveryState,
  RECOVERY_STATUS,
  type BackupEvidence,
  type RecoveryReplayEvidence,
  type RecoveryState,
  type RestoreResult,
} from './domain.js'
import { InMemoryBackupStore, type CreateBackupInput } from './backup.js'

export interface RecoveryCoordinatorDependencies {
  backups: InMemoryBackupStore
  now: () => number
}

export interface RestoreAndReconcileInput {
  tenantId: string
  backupId: string
  platform: DurableJobPlatformPort
  jobs: DurableJobService
  replayJobIds?: readonly string[]
  now: number
}

export function snapshotDurableState(
  platform: DurableJobPlatformPort,
  tenantId: string
): RecoveryState {
  return {
    jobs: platform.jobs.list(tenantId),
    runs: platform.runs.list(tenantId),
    events: platform.events.list(tenantId),
    sagas: [],
    privacyRecords: [],
    privacyRequests: [],
  }
}

export function restoreDurableState(
  platform: DurableJobPlatformPort,
  state: RecoveryState,
  tenantId = inferTenantId(state)
): void {
  restoreTenantRecords(
    platform.jobs.snapshot(),
    state.jobs,
    (records) => platform.jobs.replace(records),
    jobKey,
    (record) => record.jobId,
    tenantId
  )
  restoreTenantRecords(
    platform.runs.snapshot(),
    state.runs,
    (records) => platform.runs.replace(records),
    runLedgerKey,
    (record) => record.id,
    tenantId
  )
  restoreTenantRecords(
    platform.events.snapshot(),
    state.events,
    (records) => platform.events.replace(records),
    eventKey,
    (record) => record.eventId,
    tenantId
  )
  restoreTenantRecords(
    platform.sagas.snapshot(),
    state.sagas,
    (records) => platform.sagas.replace(records),
    runLedgerKey,
    (record) => record.runId,
    tenantId
  )
}

export class RecoveryCoordinator {
  constructor(private readonly dependencies: RecoveryCoordinatorDependencies) {}

  captureAndVerify(
    input: Omit<CreateBackupInput, 'createdAt'> & { state: RecoveryState }
  ): BackupEvidence {
    this.dependencies.backups.create({
      ...input,
      createdAt: this.dependencies.now(),
    })
    return this.dependencies.backups.verify(input.tenantId, input.backupId, this.dependencies.now())
  }

  restore(input: { tenantId: string; backupId: string }): RestoreResult {
    return this.dependencies.backups.restore(
      input.tenantId,
      input.backupId,
      this.dependencies.now()
    )
  }

  async restoreAndReconcile(input: RestoreAndReconcileInput): Promise<RecoveryReplayEvidence> {
    const restored = this.restore({ tenantId: input.tenantId, backupId: input.backupId })
    restoreDurableState(input.platform, restored.state, input.tenantId)
    const reconciliation = await input.jobs.reconcile({ tenantId: input.tenantId, now: input.now })
    let replayed = 0
    let alreadyQueued = 0
    for (const jobId of input.replayJobIds ?? []) {
      const replay = await input.jobs.replay({ tenantId: input.tenantId, jobId, now: input.now })
      if (replay.status === 'replayed') replayed += 1
      if (replay.status === 'already_queued') alreadyQueued += 1
    }
    return {
      status: RECOVERY_STATUS.RECOVERED,
      backupId: input.backupId,
      tenantId: input.tenantId,
      restored: restored.status === 'restored',
      reconciliation: {
        recoveredJobs: reconciliation.recoveredJobs,
        recoverableRuns: reconciliation.recoverableRuns,
        pendingEvents: reconciliation.pendingEvents,
        status: reconciliation.status,
      },
      replayed,
      alreadyQueued,
      liveConformance: false,
    }
  }
}

function restoreTenantRecords<
  TRecord extends { tenantId: string },
  TMap extends Map<string, TRecord>,
>(
  existing: TMap,
  incoming: readonly TRecord[],
  replace: (records: TMap) => void,
  key: (tenantId: string, id: string) => string,
  id: (record: TRecord) => string,
  tenantId: string
): void {
  for (const [recordKey, record] of existing)
    if (record.tenantId === tenantId) existing.delete(recordKey)
  for (const record of incoming) {
    existing.set(key(record.tenantId, id(record)), structuredClone(record) as TRecord)
  }
  replace(existing)
}

function inferTenantId(state: RecoveryState): string {
  const record = [
    ...state.jobs,
    ...state.runs,
    ...state.events,
    ...state.sagas,
    ...state.privacyRecords,
    ...state.privacyRequests,
  ][0]
  if (!record) throw new Error('Recovery state tenant is required when the snapshot is empty')
  return record.tenantId
}

export function cloneRestoredState(state: RecoveryState): RecoveryState {
  return cloneRecoveryState(state)
}

export function restoredStateCounts(state: RecoveryState) {
  return countRecoveryState(state)
}

export default {
  RecoveryCoordinator,
  restoreDurableState,
  snapshotDurableState,
}
