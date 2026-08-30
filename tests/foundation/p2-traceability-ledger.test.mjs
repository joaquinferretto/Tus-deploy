import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

const {
  TRACEABILITY_LEDGER,
  TraceabilityLedgerValidationError,
  findTraceabilityIssues,
  validateTraceabilityLedger,
} = await import('../../packages/contracts/traceability/index.ts')

test('P2.11 ledger exposes one complete independently traceable row per platform slice', () => {
  const validated = validateTraceabilityLedger(TRACEABILITY_LEDGER)

  assert.equal(validated.length, 14)
  assert.deepEqual(
    validated.map((row) => row.id),
    [
      'users',
      'sessions',
      'verification',
      'tenants',
      'roles',
      'audit',
      'crud',
      'assets',
      'notifications',
      'flags',
      'quotas',
      'idempotency-outbox',
      'jobs-events',
      'privacy',
    ],
  )

  for (const row of validated) {
    assert.ok(row.owner.length > 0)
    assert.ok(row.evidence.length > 0)
    assert.ok(row.scope.length > 0)
    assert.ok(row.rollbackRef.length > 0)
    assert.ok(row.activation.reason.length > 0)
  }
})

test('P2.11 validation names missing owner and missing evidence instead of accepting incomplete rows', () => {
  const source = TRACEABILITY_LEDGER[0]
  const incomplete = { ...source, owner: '', evidence: [] }

  assert.throws(
    () => validateTraceabilityLedger([incomplete]),
    (error) => {
      assert.ok(error instanceof TraceabilityLedgerValidationError)
      assert.match(error.message, /users.*owner/i)
      assert.match(error.message, /users.*evidence/i)
      return true
    },
  )

  assert.deepEqual(findTraceabilityIssues([incomplete]), [
    { rowId: 'users', field: 'owner', message: 'owner is required' },
    { rowId: 'users', field: 'evidence', message: 'evidence must contain at least one entry' },
  ])
})

test('P2.11 validation preserves active, gated, and deferred activation decisions', () => {
  const active = TRACEABILITY_LEDGER.find((row) => row.id === 'users')
  const gated = TRACEABILITY_LEDGER.find((row) => row.id === 'notifications')
  const deferred = TRACEABILITY_LEDGER.find((row) => row.id === 'privacy')

  assert.equal(active?.activation.state, 'active')
  assert.equal(gated?.activation.state, 'gated')
  assert.equal(deferred?.activation.state, 'deferred')
  assert.equal(validateTraceabilityLedger([active, gated, deferred]).length, 3)
})

test('P2.11 documentation mirrors the contract fields for every required ledger row', () => {
  const ledger = readFileSync(join(root, 'docs', 'architecture', 'capability-ledger.md'), 'utf8')

  assert.match(ledger, /P2\.11 Traceability Ledger/)
  for (const column of ['Scope', 'Activation / Deferred', 'Evidence', 'Rollback']) {
    assert.match(ledger, new RegExp(column.replace(/[ /]/g, '[ /]'), 'i'), column)
  }
  for (const row of TRACEABILITY_LEDGER) {
    assert.ok(ledger.toLowerCase().includes(row.capability.toLowerCase()), row.id)
    assert.match(ledger, new RegExp(`id: ${row.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), `${row.id} identifier`)
  }
})

test('P2.11 validation rejects empty evidence entries and unsupported activation states', () => {
  const source = TRACEABILITY_LEDGER[1]
  const invalid = {
    ...source,
    evidence: [''],
    rollbackRef: ' ',
    activation: { state: 'unknown', reason: '' },
  }

  const issues = findTraceabilityIssues([invalid])
  assert.deepEqual(issues, [
    { rowId: 'sessions', field: 'rollbackRef', message: 'rollbackRef is required' },
    { rowId: 'sessions', field: 'evidence', message: 'evidence must contain at least one entry' },
    { rowId: 'sessions', field: 'activation.state', message: 'activation state is unsupported' },
    { rowId: 'sessions', field: 'activation.reason', message: 'activation reason is required' },
  ])
})
