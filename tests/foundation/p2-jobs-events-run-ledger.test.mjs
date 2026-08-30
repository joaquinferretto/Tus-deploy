import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

const submit = {
  tenantId: 'tenant-a',
  jobId: 'job-1',
  runId: 'run-1',
  idempotencyKey: 'request-1',
  requestHash: 'hash-a',
  runType: 'asset.process',
  jobType: 'asset.process',
  input: { assetId: 'asset-1' },
  maxAttempts: 2,
  now: 100,
}

test('P2.10 submits tenant-scoped jobs idempotently and preserves producer events', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryDurableJobPlatform, DurableJobService } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const service = new DurableJobService(platform)
    const first = await service.submit(${JSON.stringify(submit)})
    const replay = await service.submit(${JSON.stringify(submit)})
    const conflict = await service.submit({ ...${JSON.stringify(submit)}, requestHash: 'hash-b', jobId: 'job-2', runId: 'run-2' })
    const otherTenant = await service.submit({ ...${JSON.stringify(submit)}, tenantId: 'tenant-b', jobId: 'job-b', runId: 'run-b', idempotencyKey: 'request-1' })
    console.log(JSON.stringify({ first, replay, conflict, otherTenant, events: platform.events.list('tenant-a') }))
  `)

  assert.equal(result.first.status, 'created')
  assert.equal(result.replay.status, 'replay')
  assert.equal(result.conflict.status, 'conflict')
  assert.equal(result.otherTenant.status, 'created')
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'run.queued')
})

test('P2.10 serializes concurrent submissions for one tenant-scoped idempotency key', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryDurableJobPlatform, DurableJobService } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const service = new DurableJobService(platform)
    const [first, second] = await Promise.all([
      service.submit(${JSON.stringify(submit)}),
      service.submit({ ...${JSON.stringify(submit)}, jobId: 'job-2', runId: 'run-2' }),
    ])
    console.log(JSON.stringify({ statuses: [first.status, second.status].sort(), runs: platform.runs.list('tenant-a'), jobs: platform.jobs.list('tenant-a'), events: platform.events.list('tenant-a') }))
  `)

  assert.deepEqual(result.statuses, ['created', 'replay'])
  assert.equal(result.runs.length, 1)
  assert.equal(result.jobs.length, 1)
  assert.equal(result.events.length, 1)
})

test('P2.10 redelivers a job after crash-before-ack and marks the run recoverable', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryDurableJobPlatform, DurableJobService } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const service = new DurableJobService(platform)
    await service.submit(${JSON.stringify(submit)})
    const first = await service.claim({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 100, leaseMs: 10 })
    const recovered = await service.reconcile({ tenantId: 'tenant-a', now: 111 })
    const redelivered = await service.claim({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-b', now: 112, leaseMs: 10 })
    console.log(JSON.stringify({ first, recovered, redelivered, run: platform.runs.find('tenant-a', 'run-1') }))
  `)

  assert.equal(result.first.status, 'claimed')
  assert.equal(result.recovered.recoveredJobs, 1)
  assert.equal(result.recovered.recoverableRuns, 1)
  assert.equal(result.redelivered.status, 'claimed')
  assert.equal(result.redelivered.record.attempts, 2)
  assert.equal(result.run.status, 'running')
})

test('P2.10 retries deterministically, quarantines poison jobs, and supports explicit idempotent replay', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryDurableJobPlatform, DurableJobService } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const service = new DurableJobService(platform)
    await service.submit(${JSON.stringify(submit)})
    await service.claim({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 100, leaseMs: 10 })
    const retry = await service.fail({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 101, error: 'temporary' })
    await service.claim({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 202, leaseMs: 10 })
    const deadLetter = await service.fail({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 203, error: 'poison' })
    const replay = await service.replay({ tenantId: 'tenant-a', jobId: 'job-1', now: 300 })
    const replayAgain = await service.replay({ tenantId: 'tenant-a', jobId: 'job-1', now: 301 })
    console.log(JSON.stringify({ retry, deadLetter, replay, replayAgain, job: platform.jobs.find('tenant-a', 'job-1'), run: platform.runs.find('tenant-a', 'run-1'), saga: platform.sagas.find('tenant-a', 'run-1') }))
  `)

  assert.equal(result.retry.status, 'retryable')
  assert.equal(result.deadLetter.status, 'dead_letter')
  assert.equal(result.deadLetter.recoverable, true)
  assert.equal(result.replay.status, 'replayed')
  assert.equal(result.replayAgain.status, 'already_queued')
  assert.equal(result.job.status, 'pending')
  assert.equal(result.run.status, 'replaying')
  assert.equal(result.saga.status, 'compensated')
})

test('P2.10 acknowledges successful jobs and keeps event consumers tenant-scoped', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryDurableJobPlatform, DurableJobService } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const service = new DurableJobService(platform)
    await service.submit(${JSON.stringify(submit)})
    await service.claim({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 100, leaseMs: 10 })
    const acknowledged = await service.acknowledge({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 101, result: { output: 'ok' } })
    const foreign = await service.acknowledge({ tenantId: 'tenant-b', jobId: 'job-1', workerId: 'worker-a', now: 102, result: { output: 'nope' } })
    const events = platform.events.list('tenant-a')
    console.log(JSON.stringify({ acknowledged, foreign, run: platform.runs.find('tenant-a', 'run-1'), eventTypes: events.map((event) => event.type) }))
  `)

  assert.equal(result.acknowledged.status, 'succeeded')
  assert.equal(result.foreign.status, 'forbidden')
  assert.equal(result.run.status, 'succeeded')
  assert.deepEqual(result.eventTypes, ['run.queued', 'run.started', 'run.succeeded'])
})

test('P2.10 compensates saga steps before exposing a recoverable failure', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryDurableJobPlatform, DurableJobService } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const service = new DurableJobService(platform)
    await service.submit({ ...${JSON.stringify(submit)}, sagaSteps: ['reserve', 'publish'] })
    await service.claim({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 100, leaseMs: 10 })
    await service.fail({ tenantId: 'tenant-a', jobId: 'job-1', workerId: 'worker-a', now: 101, error: 'fatal', terminal: true })
    console.log(JSON.stringify({ saga: platform.sagas.find('tenant-a', 'run-1'), run: platform.runs.find('tenant-a', 'run-1') }))
  `)

  assert.equal(result.saga.status, 'compensated')
  assert.deepEqual(
    result.saga.steps.map((step) => step.status),
    ['compensated', 'compensated']
  )
  assert.equal(result.run.status, 'recoverable')
})

test('P2.10 activation gate keeps managed job transport unavailable until enabled', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryJobTransport, ActivationGatedJobTransport } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const gated = new ActivationGatedJobTransport(new InMemoryJobTransport())
    let disabled = null
    try { await gated.enqueue({ tenantId: 'tenant-a', jobId: 'job-1' }) } catch (error) { disabled = error.code }
    gated.activate()
    const enabled = await gated.enqueue({ tenantId: 'tenant-a', jobId: 'job-1' })
    console.log(JSON.stringify({ disabled, enabled }))
  `)

  assert.equal(result.disabled, 'PROVIDER_UNAVAILABLE')
  assert.equal(result.enabled.status, 'queued')
})

test('P2.10 publishes canonical producer and consumer JSON contracts', () => {
  const jobSchema = JSON.parse(
    readFileSync(join(root, 'packages/contracts/schemas/jobs/durable-job.v1.schema.json'), 'utf8')
  )
  const eventSchema = JSON.parse(
    readFileSync(join(root, 'packages/contracts/schemas/jobs/run-event.v1.schema.json'), 'utf8')
  )

  assert.equal(jobSchema.$id, 'https://golden-boilerplate.dev/contracts/durable-job.v1.schema.json')
  assert.ok(jobSchema.required.includes('tenantId'))
  assert.ok(jobSchema.properties.status.enum.includes('dead_letter'))
  assert.equal(eventSchema.$id, 'https://golden-boilerplate.dev/contracts/run-event.v1.schema.json')
  assert.deepEqual(eventSchema.required, [
    'contractVersion',
    'eventId',
    'tenantId',
    'runId',
    'type',
    'createdAt',
    'payload',
  ])
})

test('P2.10 runtime records and emitted events use canonical fields and ISO date-times', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryDurableJobPlatform, DurableJobService, toDurableJobContract, toRunEventContract } = (await import('./apps/api/src/platform/jobs/index.ts')).default
    const platform = createInMemoryDurableJobPlatform()
    const service = new DurableJobService(platform)
    const created = await service.submit(${JSON.stringify(submit)})
    console.log(JSON.stringify({
      job: created.job,
      event: platform.events.list('tenant-a')[0],
      jobContract: toDurableJobContract(created.job),
      eventContract: toRunEventContract(platform.events.list('tenant-a')[0]),
    }))
  `)

  assert.equal(result.job.contractVersion, '1.0.0')
  assert.equal(result.job.jobId, 'job-1')
  assert.equal(result.job.id, undefined)
  assert.equal(result.job.availableAt, '1970-01-01T00:00:00.100Z')
  assert.equal(result.job.createdAt, '1970-01-01T00:00:00.100Z')
  assert.deepEqual(result.job.claim, null)
  assert.equal(result.event.contractVersion, '1.0.0')
  assert.equal(result.event.eventId, 'event-run-1-run.queued')
  assert.equal(result.event.id, undefined)
  assert.equal(result.event.createdAt, '1970-01-01T00:00:00.100Z')
  assert.equal(result.event.status, 'pending')
  assert.equal(result.jobContract.contractVersion, '1.0.0')
  assert.equal(result.eventContract.eventId, result.event.eventId)
  assert.equal(result.eventContract.status, undefined)
})

test('P2.10 checked-in job and event fixtures preserve the canonical cross-runtime contract', () => {
  const job = JSON.parse(
    readFileSync(join(root, 'packages/contracts/fixtures/jobs/durable-job.v1.json'), 'utf8')
  )
  const event = JSON.parse(
    readFileSync(join(root, 'packages/contracts/fixtures/jobs/run-event.v1.json'), 'utf8')
  )

  assert.equal(job.contractVersion, '1.0.0')
  assert.equal(job.jobId, 'job-fixture')
  assert.match(job.availableAt, /^\d{4}-\d{2}-\d{2}T.*Z$/)
  assert.equal(event.contractVersion, '1.0.0')
  assert.equal(event.eventId, 'event-fixture')
  assert.match(event.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/)
})

test('P2.10 run-ledger adapter emits parameterized PostgreSQL ownership commands', () => {
  const result = runTypeScriptScenario(`
    const { PostgresRunLedgerAdapter } = (await import('./apps/api/src/platform/run-ledger/postgres.ts')).default
    const calls = []
    const executor = { query: async (command) => { calls.push(command); return { rows: [{ id: 'run-1', tenantId: 'tenant-a', idempotencyKey: 'request-1', requestHash: 'hash-a', runType: 'asset.process', status: 'queued', input: { assetId: 'asset-1' }, result: null, error: null, createdAt: 100, updatedAt: 100 }], rowCount: 1 } } }
    const ledger = new PostgresRunLedgerAdapter(executor)
    await ledger.create({ id: 'run-1', tenantId: 'tenant-a', idempotencyKey: 'request-1', requestHash: 'hash-a', runType: 'asset.process', input: { assetId: 'asset-1' }, now: 100 })
    await ledger.find('tenant-a', 'run-1')
    const createSql = calls.find(({ operation }) => operation === 'run-ledger-create').text
    console.log(JSON.stringify({ operations: calls.map(({ operation }) => operation), scoped: calls.every(({ parameters }) => parameters[0] === 'tenant-a'), interpolated: calls.some(({ text }) => text.includes('tenant-a') || text.includes('asset-1')), atomic: createSql.includes('ON CONFLICT') && createSql.includes('idempotencyKey') }))
  `)

  assert.deepEqual(result.operations, ['run-ledger-create', 'run-ledger-find'])
  assert.equal(result.scoped, true)
  assert.equal(result.interpolated, false)
  assert.equal(result.atomic, true)
})
