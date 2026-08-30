import assert from 'node:assert/strict'
import { test } from 'node:test'

const { EventActivationError, EventBridgeAdapter, LambdaAdapter, InMemoryEventPublisher } =
  await import('../../packages/events/src/index.ts')

function event(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    eventId: 'event-1',
    tenantId: 'tenant-a',
    actorId: 'actor-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'idempotency-1',
    type: 'workflow.completed',
    occurredAt: '2026-01-01T00:00:00.000Z',
    payload: { result: 'ok', authorization: 'super-secret' },
    ...overrides,
  }
}

test('EventBridge stays disabled until explicitly activated and publishes redacted detail', async () => {
  const sent = []
  const adapter = new EventBridgeAdapter({
    eventBusRef: 'aws.eventbridge.bus-ref',
    sender: async (request) => sent.push(request),
  })

  await assert.rejects(() => adapter.publish(event()), EventActivationError)
  adapter.activate()
  const result = await adapter.publish(event())

  assert.equal(result.status, 'published')
  assert.equal(sent[0].detail.payload.authorization, '[REDACTED]')
  assert.doesNotMatch(JSON.stringify(sent[0]), /super-secret/)
  assert.equal(sent[0].eventBusRef, 'aws.eventbridge.bus-ref')
})

test('EventBridge retries deterministically and redacts provider errors', async () => {
  let attempts = 0
  const adapter = new EventBridgeAdapter({
    eventBusRef: 'event-bus-ref',
    maxAttempts: 3,
    baseBackoffMs: 100,
    maxBackoffMs: 250,
    sender: async () => {
      attempts += 1
      if (attempts < 3) throw new Error('Authorization: Bearer provider-secret')
    },
  })
  adapter.activate()

  const result = await adapter.publish(event(), { now: 1000 })

  assert.equal(result.status, 'published')
  assert.equal(result.attempts, 3)
  assert.equal(result.retryDelaysMs.join(','), '100,200')
  assert.doesNotMatch(JSON.stringify(result), /provider-secret/)
})

test('Lambda adapter uses the same activation, redaction, and retry boundary', async () => {
  const invocations = []
  const adapter = new LambdaAdapter({
    functionRef: 'aws.lambda.function-ref',
    sender: async (request) => invocations.push(request),
  })

  await assert.rejects(() => adapter.invoke(event()), EventActivationError)
  adapter.activate()
  const result = await adapter.invoke(event({ type: 'workflow.failed' }))

  assert.equal(result.status, 'invoked')
  assert.equal(invocations[0].detail.payload.authorization, '[REDACTED]')
  assert.doesNotMatch(JSON.stringify(invocations[0]), /super-secret/)
})

test('in-memory event publisher records immutable tenant-scoped events', async () => {
  const publisher = new InMemoryEventPublisher()
  const original = event()
  await publisher.publish(original)
  original.payload.result = 'mutated'

  assert.equal(publisher.events('tenant-a')[0].payload.result, 'ok')
  assert.equal(publisher.events('tenant-b').length, 0)
})
