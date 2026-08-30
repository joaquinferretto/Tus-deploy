import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps', 'api', 'node_modules', 'tsx', 'dist', 'cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

function stateFixture(tenantId = 'tenant-a') {
  return {
    jobs: [
      {
        contractVersion: '1.0.0',
        jobId: 'job-1',
        tenantId,
        runId: 'run-1',
        jobType: 'recovery-fixture',
        payload: { value: 'synthetic' },
        status: 'pending',
        attempts: 0,
        maxAttempts: 2,
        availableAt: '2026-08-25T00:00:00.000Z',
        createdAt: '2026-08-25T00:00:00.000Z',
        claim: null,
        lastError: null,
      },
    ],
    runs: [
      {
        id: 'run-1',
        tenantId,
        idempotencyKey: 'request-1',
        requestHash: 'request-hash',
        runType: 'recovery-fixture',
        status: 'queued',
        input: { value: 'synthetic' },
        result: null,
        error: null,
        createdAt: Date.parse('2026-08-25T00:00:00.000Z'),
        updatedAt: Date.parse('2026-08-25T00:00:00.000Z'),
      },
    ],
    events: [],
    sagas: [],
    privacyRecords: [],
    privacyRequests: [],
  }
}

test('backup capture verifies and restores a tenant-scoped durable snapshot without live claims', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryBackupStore, RecoveryCoordinator } = (await import('./apps/api/src/recovery/index.ts')).default
    const state = ${JSON.stringify(stateFixture())}
    const backups = new InMemoryBackupStore()
    const coordinator = new RecoveryCoordinator({ backups, now: () => Date.parse('2026-08-25T01:00:00.000Z') })
    const evidence = coordinator.captureAndVerify({ tenantId: 'tenant-a', backupId: 'backup-1', profile: 'aws-terraform', state })
    const restored = coordinator.restore({ tenantId: 'tenant-a', backupId: 'backup-1' })
    console.log(JSON.stringify({ evidence, restored, status: 'verified', state }))
  `)

  assert.equal(result.evidence.status, result.status)
  assert.equal(result.evidence.verified, true)
  assert.equal(result.evidence.liveConformance, false)
  assert.equal(result.restored.status, 'restored')
  assert.deepEqual(result.restored.state, result.state)
  assert.equal(JSON.stringify(result.restored).includes('DATABASE_URL'), false)
})

test('backup activation remains deferred until every paid/live gate is explicitly true', () => {
  const result = runTypeScriptScenario(`
    const { evaluateBackupActivationGate } = (await import('./apps/api/src/recovery/index.ts')).default
    console.log(JSON.stringify({
      deferred: evaluateBackupActivationGate({ credentials: false, resources: true, authorizedSmoke: true }),
      authorized: evaluateBackupActivationGate({ credentials: true, resources: true, authorizedSmoke: true }),
    }))
  `)
  assert.deepEqual(result.deferred, {
    status: 'deferred',
    liveConformance: false,
    effectiveMode: 'deterministic-fake',
    missing: ['credentials'],
  })
  assert.deepEqual(result.authorized, {
    status: 'authorized',
    liveConformance: true,
    effectiveMode: 'managed',
    missing: [],
  })
})

test('crashed claimed work is restored, reconciled, and marked recoverable', async () => {
  const result = runTypeScriptScenario(`
    const { InMemoryBackupStore, RecoveryCoordinator, snapshotDurableState } = (await import('./apps/api/src/recovery/index.ts')).default
    const { createInMemoryDurableJobPlatform, DurableJobService } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const jobs = new DurableJobService(platform)
    await jobs.submit({ tenantId: 'tenant-a', jobId: 'crashed-job', runId: 'crashed-run', idempotencyKey: 'crashed-request', requestHash: 'crashed-hash', runType: 'recovery', jobType: 'crash-fixture', input: { value: 'before-crash' }, maxAttempts: 2, now: 1_000 })
    await jobs.claim({ tenantId: 'tenant-a', jobId: 'crashed-job', workerId: 'worker-a', now: 1_000, leaseMs: 10 })
    const backups = new InMemoryBackupStore()
    const coordinator = new RecoveryCoordinator({ backups, now: () => 2_000 })
    coordinator.captureAndVerify({ tenantId: 'tenant-a', backupId: 'crash-backup', profile: 'native', state: snapshotDurableState(platform, 'tenant-a') })
    const recovery = await coordinator.restoreAndReconcile({ tenantId: 'tenant-a', backupId: 'crash-backup', platform, jobs, now: 2_000 })
    console.log(JSON.stringify({ recovery, runStatus: platform.runs.find('tenant-a', 'crashed-run').status }))
  `)

  assert.equal(result.recovery.status, 'recovered')
  assert.equal(result.recovery.reconciliation.recoveredJobs, 1)
  assert.equal(result.recovery.reconciliation.recoverableRuns, 1)
  assert.equal(result.runStatus, 'recoverable')
})

test('dead-letter work is restored and replayed through the run ledger exactly once', async () => {
  const result = runTypeScriptScenario(`
    const { InMemoryBackupStore, RecoveryCoordinator, snapshotDurableState } = (await import('./apps/api/src/recovery/index.ts')).default
    const { createInMemoryDurableJobPlatform, DurableJobService } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const jobs = new DurableJobService(platform)
    await jobs.submit({ tenantId: 'tenant-a', jobId: 'poison-job', runId: 'poison-run', idempotencyKey: 'poison-request', requestHash: 'poison-hash', runType: 'recovery', jobType: 'poison-fixture', input: { value: 'retry-me' }, maxAttempts: 1, now: 1_000 })
    await jobs.claim({ tenantId: 'tenant-a', jobId: 'poison-job', workerId: 'worker-a', now: 1_000, leaseMs: 100 })
    await jobs.fail({ tenantId: 'tenant-a', jobId: 'poison-job', workerId: 'worker-a', now: 1_001, error: 'synthetic failure' })
    const backups = new InMemoryBackupStore()
    const coordinator = new RecoveryCoordinator({ backups, now: () => 2_000 })
    coordinator.captureAndVerify({ tenantId: 'tenant-a', backupId: 'dlq-backup', profile: 'render-native', state: snapshotDurableState(platform, 'tenant-a') })
    const recovery = await coordinator.restoreAndReconcile({ tenantId: 'tenant-a', backupId: 'dlq-backup', platform, jobs, replayJobIds: ['poison-job', 'poison-job'], now: 2_000 })
    console.log(JSON.stringify({ recovery, jobStatus: platform.jobs.find('tenant-a', 'poison-job').status, runStatus: platform.runs.find('tenant-a', 'poison-run').status }))
  `)

  assert.equal(result.recovery.status, 'recovered')
  assert.equal(result.recovery.replayed, 1)
  assert.equal(result.recovery.alreadyQueued, 1)
  assert.equal(result.jobStatus, 'pending')
  assert.equal(result.runStatus, 'replaying')
})

test('retention and deletion propagation produce recovery evidence and retry after failure', async () => {
  const result = runTypeScriptScenario(`
    const { runDeletionWithEvidence, runRetentionWithEvidence } = (await import('./apps/api/src/recovery/index.ts')).default
    const { createInMemoryPrivacyService } = (await import('./apps/api/src/privacy/composition.ts')).default
    const privacy = createInMemoryPrivacyService({ now: () => 1_700_000_000_000 })
    const context = { tenantId: 'tenant-a', actorId: 'operator-a', correlationId: 'tenant-a-operator-a', permissions: ['privacy:consent', 'privacy:retention', 'privacy:delete'] }
    await privacy.setRetentionSchedule({ context, resourceType: 'event', purpose: 'analytics', retentionMs: 1, action: 'delete' })
    await privacy.recordConsent({ context, subjectUserId: 'user-a', purpose: 'analytics', version: 'v1', granted: true })
    await privacy.registerRecord({ context, recordId: 'event-1', subjectUserId: 'user-a', resourceType: 'event', purpose: 'analytics', fields: { note: 'synthetic' }, fieldDefinitions: [{ name: 'note', classification: 'personal' }] })
    const retention = await runRetentionWithEvidence(privacy, { context, now: 1_700_000_000_002 })
    await privacy.registerRecord({ context, recordId: 'event-2', subjectUserId: 'user-a', resourceType: 'event', purpose: 'service_delivery', fields: { note: 'delete-me' }, fieldDefinitions: [{ name: 'note', classification: 'personal' }] })
    const deletion = await runDeletionWithEvidence(privacy, { context, subjectUserId: 'user-a', idempotencyKey: 'delete-recovery' })
    console.log(JSON.stringify({ retention, deletion }))
  `)

  assert.deepEqual(result.retention, {
    status: 'verified',
    purged: 1,
    anonymized: 0,
    held: 0,
    failed: 0,
    propagated: 1,
    liveConformance: false,
  })
  assert.equal(result.deletion.status, 'verified')
  assert.equal(result.deletion.propagated, 1)
  assert.equal(result.deletion.completed, true)
  assert.equal(result.deletion.liveConformance, false)
})

test('recovery artifacts declare restore, replay, retention, deletion, and activation boundaries', () => {
  const terraform = readFileSync(
    join(root, 'infra', 'terraform', 'modules', 'backup', 'main.tf'),
    'utf8'
  )
  const backupDoc = readFileSync(join(root, 'docs', 'operations', 'backup.md'), 'utf8')
  const recoveryDoc = readFileSync(join(root, 'docs', 'operations', 'recovery.md'), 'utf8')
  const retentionDoc = readFileSync(join(root, 'docs', 'operations', 'retention.md'), 'utf8')
  const content = `${terraform}\n${backupDoc}\n${recoveryDoc}\n${retentionDoc}`.toLowerCase()

  for (const required of [
    'verified',
    'restore',
    'dlq',
    'reconciliation',
    'retention',
    'deletion',
    'disabled-until-approved',
  ]) {
    assert.match(content, new RegExp(required))
  }
  assert.match(content, /contract-only-no-provisioning/)
  assert.match(content, /live conformance/)
})

test('restoring a snapshot replaces only the selected tenant state', async () => {
  const result = runTypeScriptScenario(`
    const { restoreDurableState } = (await import('./apps/api/src/recovery/index.ts')).default
    const { createInMemoryDurableJobPlatform } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const source = ${JSON.stringify(stateFixture('tenant-a'))}
    restoreDurableState(platform, source)
    platform.jobs.enqueue({ tenantId: 'tenant-b', jobId: 'other-job', runId: 'other-run', idempotencyKey: 'other-request', requestHash: 'other-hash', runType: 'other', jobType: 'other', input: { value: 'other' }, maxAttempts: 1, now: 1_000 })
    restoreDurableState(platform, source)
    console.log(JSON.stringify({ tenantA: platform.jobs.find('tenant-a', 'job-1').tenantId, tenantB: platform.jobs.find('tenant-b', 'other-job').tenantId }))
  `)

  assert.equal(result.tenantA, 'tenant-a')
  assert.equal(result.tenantB, 'tenant-b')
})
