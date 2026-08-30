import assert from 'node:assert/strict'
import { test } from 'node:test'

const { STREAM_CONTRACT_VERSION, validateStreamFrame } =
  await import('../../packages/contracts/src/streams.ts')
const {
  InMemoryStreamTransport,
  StreamAuthorizationError,
  StreamBackpressureError,
  StreamCursorError,
  StreamProviderUnavailableError,
  UnavailableStreamTransport,
} = await import('../../apps/api/src/streams/index.ts')

function stream(overrides = {}) {
  return {
    streamId: 'stream-1',
    runId: 'run-1',
    tenantId: 'tenant-a',
    actorId: 'actor-1',
    correlationId: 'correlation-1',
    partialResultPolicy: 'emit-partial',
    maxBuffer: 8,
    ...overrides,
  }
}

function context(overrides = {}) {
  return {
    streamId: 'stream-1',
    tenantId: 'tenant-a',
    actorId: 'actor-1',
    correlationId: 'correlation-1',
    ...overrides,
  }
}

test('stream contracts preserve version, correlation, and cross-kind ordering across reconnects', () => {
  const transport = new InMemoryStreamTransport()
  transport.createStream(stream())
  transport.publish(context(), { kind: 'token', status: 'partial', payload: { text: 'Hel' } })
  transport.publish(context(), { kind: 'audio', status: 'partial', payload: { chunk: 'YQ==' } })
  transport.publish(context(), { kind: 'progress', status: 'progress', payload: { percent: 50 } })
  transport.publish(context(), { kind: 'event', status: 'completed', payload: { output: 'Hello' } })

  const first = transport.connect({ ...context(), maxInFlight: 2 })
  const batch = transport.poll({ ...context(), connectionId: first.connectionId })
  assert.equal(batch.frames.length, 2)
  assert.deepEqual(
    batch.frames.map((frame) => frame.kind),
    ['token', 'audio']
  )
  assert.deepEqual(
    batch.frames.map((frame) => frame.sequence),
    [1, 2]
  )
  assert.equal(batch.frames[0].cursor, 'stream-1:1')
  assert.equal(batch.frames[0].contractVersion, STREAM_CONTRACT_VERSION)
  assert.equal(batch.frames[0].tenantId, 'tenant-a')
  assert.equal(batch.frames[0].actorId, 'actor-1')
  assert.equal(batch.frames[0].correlationId, 'correlation-1')
  for (const frame of batch.frames) validateStreamFrame(frame)
  transport.ack({ ...context(), connectionId: first.connectionId, cursor: 'stream-1:2' })

  const reconnect = transport.connect({ ...context(), cursor: 'stream-1:2', maxInFlight: 4 })
  const resumed = transport.poll({ ...context(), connectionId: reconnect.connectionId })
  assert.deepEqual(
    resumed.frames.map((frame) => frame.sequence),
    [3, 4]
  )
  assert.equal(resumed.status, 'completed')
})

test('stream backpressure blocks unacknowledged delivery and bounded retention', () => {
  const transport = new InMemoryStreamTransport()
  transport.createStream(stream({ maxBuffer: 2 }))
  transport.publish(context(), { kind: 'token', status: 'partial', payload: { text: 'a' } })
  transport.publish(context(), { kind: 'token', status: 'partial', payload: { text: 'b' } })
  const connection = transport.connect({ ...context(), maxInFlight: 1 })
  transport.publish(context(), { kind: 'token', status: 'partial', payload: { text: 'c' } })
  assert.throws(
    () => transport.poll({ ...context(), connectionId: connection.connectionId }),
    StreamBackpressureError
  )
  transport.ack({ ...context(), connectionId: connection.connectionId, cursor: 'stream-1:1' })
  const batch = transport.poll({ ...context(), connectionId: connection.connectionId })
  assert.equal(batch.frames[0].sequence, 2)
  transport.ack({ ...context(), connectionId: connection.connectionId, cursor: 'stream-1:2' })
  assert.equal(
    transport.poll({ ...context(), connectionId: connection.connectionId }).frames[0].sequence,
    3
  )
})

test('reconnect and cancellation remain tenant/actor scoped', () => {
  const transport = new InMemoryStreamTransport()
  transport.createStream(stream({ partialResultPolicy: 'discard-on-cancel' }))
  transport.publish(context(), { kind: 'token', status: 'partial', payload: { text: 'draft' } })
  assert.throws(
    () => transport.connect({ ...context({ actorId: 'actor-2' }), maxInFlight: 2 }),
    StreamAuthorizationError
  )
  const connection = transport.connect({ ...context(), maxInFlight: 2 })
  transport.cancel({
    ...context(),
    connectionId: connection.connectionId,
    reason: 'user requested',
  })
  const cancelled = transport.poll({ ...context(), connectionId: connection.connectionId })
  assert.deepEqual(
    cancelled.frames.map((frame) => frame.kind),
    ['event']
  )
  assert.equal(cancelled.frames[0].status, 'cancelled')
  assert.equal(cancelled.frames[0].payload.reason, 'user requested')
  assert.throws(
    () => transport.connect({ ...context(), cursor: 'other-stream:1', maxInFlight: 2 }),
    StreamCursorError
  )
})

test('partial-result policies hold partials until completion and discard them on cancellation', () => {
  const held = new InMemoryStreamTransport()
  held.createStream(stream({ partialResultPolicy: 'hold-until-complete' }))
  held.publish(context(), { kind: 'token', status: 'partial', payload: { text: 'hidden' } })
  const heldConnection = held.connect({ ...context(), maxInFlight: 2 })
  assert.equal(
    held.poll({ ...context(), connectionId: heldConnection.connectionId }).frames.length,
    0
  )
  held.publish(context(), { kind: 'event', status: 'completed', payload: { output: 'final' } })
  assert.deepEqual(
    held
      .poll({ ...context(), connectionId: heldConnection.connectionId })
      .frames.map((frame) => frame.payload),
    [{ text: 'hidden' }, { output: 'final' }]
  )

  const discarded = new InMemoryStreamTransport()
  discarded.createStream(stream({ partialResultPolicy: 'discard-on-cancel' }))
  discarded.publish(context(), {
    kind: 'audio',
    status: 'partial',
    payload: { chunk: 'discard-me' },
  })
  const discardedConnection = discarded.connect({ ...context(), maxInFlight: 2 })
  discarded.cancel({ ...context(), connectionId: discardedConnection.connectionId, reason: 'stop' })
  const result = discarded.poll({ ...context(), connectionId: discardedConnection.connectionId })
  assert.deepEqual(
    result.frames.map((frame) => frame.status),
    ['cancelled']
  )
})

test('live stream transport is explicit unavailable and never calls a provider', () => {
  const unavailable = new UnavailableStreamTransport()
  assert.throws(() => unavailable.createStream(stream()), StreamProviderUnavailableError)
})
