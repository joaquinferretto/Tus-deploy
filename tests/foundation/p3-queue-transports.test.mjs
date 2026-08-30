import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  return JSON.parse(
    execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  )
}

function message(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    messageId: 'message-1',
    jobId: 'job-1',
    runId: 'run-1',
    jobType: 'workflow.execute',
    tenantId: 'tenant-a',
    actorId: 'actor-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'idempotency-1',
    lineage: { rootMessageId: 'message-1', source: 'p3.4-test' },
    payload: { input: { value: 1 } },
    maxAttempts: 3,
    createdAt: 100,
    ...overrides,
  }
}

test('P3.4 fake transport preserves tenant context and claims then acknowledges exactly once', async () => {
  const result = runTypeScriptScenario(`
    const { InMemoryQueueTransport, QUEUE_STATUS } = (await import('./packages/queues/src/index.ts')).default
    const transport = new InMemoryQueueTransport()
    const queued = await transport.enqueue(${JSON.stringify(message())})
    const foreign = await transport.claim({ tenantId: 'tenant-b', workerId: 'worker-a', now: 100, visibilityTimeoutMs: 50 })
    const claim = await transport.claim({ tenantId: 'tenant-a', workerId: 'worker-a', now: 100, visibilityTimeoutMs: 50 })
    const acknowledged = await transport.acknowledge({ tenantId: 'tenant-a', workerId: 'worker-a', receiptId: claim.receiptId, now: 101 })
    const repeated = await transport.acknowledge({ tenantId: 'tenant-a', workerId: 'worker-a', receiptId: claim.receiptId, now: 102 })
    console.log(JSON.stringify({ queued, foreign, claim, acknowledged, repeated, statuses: QUEUE_STATUS }))
  `)

  assert.equal(result.queued.message.tenantId, 'tenant-a')
  assert.equal(result.queued.message.actorId, 'actor-1')
  assert.equal(result.queued.message.idempotencyKey, 'idempotency-1')
  assert.equal(result.foreign.status, 'empty')
  assert.equal(result.claim.message.runId, 'run-1')
  assert.equal(result.acknowledged.status, 'acknowledged')
  assert.equal(result.repeated.status, 'empty')
})

test('P3.4 retry applies deterministic exponential backoff and quarantines poison messages', async () => {
  const result = runTypeScriptScenario(`
    const { InMemoryQueueTransport } = (await import('./packages/queues/src/index.ts')).default
    const transport = new InMemoryQueueTransport({ baseBackoffMs: 100, maxBackoffMs: 250 })
    await transport.enqueue(${JSON.stringify(message({ maxAttempts: 2 }))})
    const first = await transport.claim({ tenantId: 'tenant-a', workerId: 'worker-a', now: 100, visibilityTimeoutMs: 50 })
    const retry = await transport.retry({ tenantId: 'tenant-a', workerId: 'worker-a', receiptId: first.receiptId, now: 101, error: 'temporary' })
    const notYet = await transport.claim({ tenantId: 'tenant-a', workerId: 'worker-b', now: 200, visibilityTimeoutMs: 50 })
    const second = await transport.claim({ tenantId: 'tenant-a', workerId: 'worker-b', now: 201, visibilityTimeoutMs: 50 })
    const deadLetter = await transport.retry({ tenantId: 'tenant-a', workerId: 'worker-b', receiptId: second.receiptId, now: 202, error: 'poison' })
    console.log(JSON.stringify({ retry, notYet, second, deadLetter, deadLetters: await transport.deadLetters('tenant-a') }))
  `)

  assert.equal(result.retry.status, 'retryable')
  assert.equal(result.retry.availableAt, 201)
  assert.equal(result.notYet.status, 'empty')
  assert.equal(result.second.attempt, 2)
  assert.equal(result.deadLetter.status, 'dead_letter')
  assert.equal(result.deadLetters.length, 1)
  assert.equal(result.deadLetters[0].lastError, 'poison')
})

test('P3.4 cancellation and reconciliation recover expired delivery without owning ledger state', async () => {
  const result = runTypeScriptScenario(`
    const { RedisLocalQueueTransport } = (await import('./packages/queues/src/index.ts')).default
    const transport = new RedisLocalQueueTransport()
    await transport.enqueue(${JSON.stringify(message({ messageId: 'message-2', jobId: 'job-2', runId: 'run-2' }))})
    const claim = await transport.claim({ tenantId: 'tenant-a', workerId: 'worker-a', now: 100, visibilityTimeoutMs: 10 })
    const recovered = await transport.reconcile({ tenantId: 'tenant-a', now: 111, knownRunIds: ['run-2'] })
    const redelivery = await transport.claim({ tenantId: 'tenant-a', workerId: 'worker-b', now: 111, visibilityTimeoutMs: 10 })
    await transport.enqueue(${JSON.stringify(message({ messageId: 'message-3', jobId: 'job-3', runId: 'run-3' }))})
    const cancelled = await transport.cancel({ tenantId: 'tenant-a', jobId: 'job-3', now: 112, reason: 'operator requested' })
    console.log(JSON.stringify({ claim, recovered, redelivery, cancelled }))
  `)

  assert.equal(result.claim.message.jobId, 'job-2')
  assert.equal(result.recovered.expiredClaims, 1)
  assert.equal(result.recovered.orphanedMessages, 0)
  assert.equal(result.redelivery.message.jobId, 'job-2')
  assert.equal(result.cancelled.status, 'cancelled')
  assert.equal(result.cancelled.queueOwnsBusinessState, false)
})

test('P3.4 SQS adapter is unavailable until explicitly activated and never claims live AWS by default', async () => {
  const result = runTypeScriptScenario(`
    const { SqsDlqQueueTransport, QueueActivationError } = (await import('./packages/queues/src/index.ts')).default
    const transport = new SqsDlqQueueTransport({ queueUrlRef: 'sqs://queue-ref', dlqUrlRef: 'sqs://dlq-ref' })
    let disabled = null
    try { await transport.enqueue(${JSON.stringify(message())}) } catch (error) { disabled = error instanceof QueueActivationError }
    let deadLettersDisabled = null
    try { await transport.deadLetters('tenant-a') } catch (error) { deadLettersDisabled = error instanceof QueueActivationError }
    transport.activate()
    const queued = await transport.enqueue(${JSON.stringify(message())})
    console.log(JSON.stringify({ disabled, deadLettersDisabled, queued, activation: transport.activation }))
  `)

  assert.equal(result.disabled, true)
  assert.equal(result.deadLettersDisabled, true)
  assert.equal(result.queued.message.jobId, 'job-1')
  assert.equal(result.activation, 'enabled')
})
