import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createNativeRollbackScenario } from '../../scripts/dev/native-rollback.mjs'

const durableWork = {
  ledger: { id: 'ledger-native-001', state: 'committed' },
  outbox: { id: 'outbox-native-001', state: 'pending' },
  dlq: { id: 'dlq-native-001', state: 'eligible' },
}

function createInput(overrides = {}) {
  return {
    deployedVersion: 'native-p0.6a-failing',
    restoredVersion: 'native-p0.6a-last-pass',
    reason: 'required PostgreSQL readiness failure',
    operator: 'local-operator',
    timestamp: '2026-08-21T20:30:00.000Z',
    failingHealth: { profile: 'native', ready: false, reason: 'postgres-unavailable' },
    restoredHealth: { profile: 'native', ready: true, reason: 'postgres-ready' },
    durableWork,
    ...overrides,
  }
}

test('native rollback stops traffic before partial serving and records health evidence', () => {
  const result = createNativeRollbackScenario(createInput())

  assert.equal(result.status, 'rolled-back')
  assert.equal(result.traffic.stoppedBeforePartialServing, true)
  assert.equal(result.traffic.acceptedRequestsDuringFailure, 0)
  assert.equal(result.traffic.resumedAfterHealthVerification, true)
  assert.deepEqual(result.events, [
    'candidate-selected',
    'readiness-failed',
    'traffic-stopped',
    'durable-work-checkpointed',
    'last-passing-restored',
    'health-verified',
    'traffic-resumed',
  ])
  assert.deepEqual(result.evidence, {
    deployedVersion: 'native-p0.6a-failing',
    restoredVersion: 'native-p0.6a-last-pass',
    reason: 'required PostgreSQL readiness failure',
    operator: 'local-operator',
    timestamp: '2026-08-21T20:30:00.000Z',
    health: {
      failing: { profile: 'native', ready: false, reason: 'postgres-unavailable' },
      restored: { profile: 'native', ready: true, reason: 'postgres-ready' },
    },
  })
})

test('native rollback preserves replayable ledger, outbox, and DLQ work without mutating input', () => {
  const input = createInput()
  const before = structuredClone(input.durableWork)
  const result = createNativeRollbackScenario(input)

  assert.deepEqual(result.durableWork, {
    ledger: { preserved: true, replayable: true, record: before.ledger },
    outbox: { preserved: true, replayable: true, record: before.outbox },
    dlq: { preserved: true, replayable: true, record: before.dlq },
  })
  assert.deepEqual(input.durableWork, before)
  assert.deepEqual(result.replayableRecordIds, [
    'ledger-native-001',
    'outbox-native-001',
    'dlq-native-001',
  ])
})

test('native rollback rejects a non-failing or unhealthy restore scenario', () => {
  assert.throws(
    () => createNativeRollbackScenario(createInput({ failingHealth: { profile: 'native', ready: true } })),
    /failing version must be non-ready/,
  )
  assert.throws(
    () => createNativeRollbackScenario(createInput({ restoredHealth: { profile: 'native', ready: false } })),
    /restored version must be ready/,
  )
})
