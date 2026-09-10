import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CAPABILITY_KEYS,
  EVIDENCE_CLASSES,
  PILOT_FLAG_KEYS,
  DEFAULT_PILOT_FLAGS,
  createCapabilityMatrix,
  evaluatePilotGoLive,
  applyLaunchDecision,
  createP0RollbackPlan,
  evaluateStagedActivation,
} from '../../scripts/launch/pilot-readiness.mjs'

const root = join(import.meta.dirname, '..', '..')
const now = '2026-09-09T12:00:00.000Z'

function directEvidence(capability, overrides = {}) {
  return {
    evidenceId: `direct-${capability}`,
    capability,
    evidenceClass: 'deployment',
    source: 'authorized-external',
    direct: true,
    approved: true,
    owner: `owner-${capability}`,
    profile: 'render-native',
    scope: 'argentina-stage-1',
    issuedAt: '2026-09-09T10:00:00.000Z',
    expiresAt: '2026-09-10T12:00:00.000Z',
    revoked: false,
    ...overrides,
  }
}

test('Phase 13 exposes the complete capability and evidence taxonomy with safe flags', () => {
  assert.deepEqual([...CAPABILITY_KEYS], [
    'database', 'schema', 'tenancy', 'pos', 'payments', 'whatsapp',
    'delivery', 'billing', 'web', 'mobile', 'deployment',
  ])
  assert.deepEqual([...EVIDENCE_CLASSES], [
    'deterministic', 'real-postgresql', 'provider', 'browser/mobile',
    'deployment', 'legal/tax', 'external-blocked',
  ])
  assert.deepEqual([...PILOT_FLAG_KEYS], ['providers', 'payments', 'worker', 'delivery', 'broadLaunch'])
  assert.deepEqual(DEFAULT_PILOT_FLAGS, {
    providers: false,
    payments: false,
    worker: false,
    delivery: false,
    broadLaunch: false,
  })

  const matrix = createCapabilityMatrix()
  assert.equal(Object.keys(matrix).length, CAPABILITY_KEYS.length)
  assert.ok(Object.values(matrix).every((row) => row.status === 'blocked'))
  assert.ok(Object.values(matrix).every((row) => row.evidenceClass === 'external-blocked'))
})

test('missing direct evidence fails closed and never enables live conformance or launch flags', () => {
  const result = evaluatePilotGoLive({ now, requestedFlags: Object.fromEntries(PILOT_FLAG_KEYS.map((key) => [key, true])) })

  assert.equal(result.status, 'not-production-ready')
  assert.equal(result.liveConformance, false)
  assert.equal(result.p0.passed, false)
  assert.equal(result.flags.providers, false)
  assert.equal(result.flags.payments, false)
  assert.equal(result.flags.worker, false)
  assert.equal(result.flags.delivery, false)
  assert.equal(result.flags.broadLaunch, false)
  assert.ok(result.blockers.includes('database:direct-evidence-required'))
  assert.ok(result.blockers.includes('deployment:direct-evidence-required'))
})

test('expired, revoked, conflicting, deterministic, and out-of-scope evidence remain blockers', () => {
  const evidence = [
    directEvidence('database', { expiresAt: '2026-09-09T11:59:59.000Z' }),
    directEvidence('schema', { revoked: true }),
    directEvidence('tenancy', { evidenceClass: 'deterministic', direct: false }),
    directEvidence('pos', { profile: 'aws-terraform' }),
    directEvidence('payments'),
    directEvidence('payments', { evidenceId: 'direct-payments-duplicate' }),
  ]
  const result = evaluatePilotGoLive({ now, evidence, requestedFlags: { payments: true } })

  assert.equal(result.liveConformance, false)
  assert.ok(result.blockers.includes('database:expired'))
  assert.ok(result.blockers.includes('schema:revoked'))
  assert.ok(result.blockers.includes('tenancy:deterministic-only'))
  assert.ok(result.blockers.includes('pos:out-of-scope'))
  assert.ok(result.blockers.includes('payments:conflict'))
})

test('valid direct evidence only enables the requested scoped capability and never broad launch by implication', () => {
  const evidence = ['database', 'schema', 'tenancy', 'pos', 'payments', 'whatsapp', 'delivery', 'billing', 'web', 'mobile', 'deployment']
    .map((capability) => directEvidence(capability))
  const result = evaluatePilotGoLive({
    now,
    evidence,
    requestedFlags: { payments: true, providers: true, worker: true, delivery: true },
    activation: { stage: 'pilot', tenantIds: ['tenant-canary'], customerIds: ['customer-canary'] },
  })

  assert.equal(result.p0.passed, true)
  assert.equal(result.liveConformance, true)
  assert.equal(result.flags.payments, true)
  assert.equal(result.flags.providers, true)
  assert.equal(result.flags.worker, true)
  assert.equal(result.flags.delivery, true)
  assert.equal(result.flags.broadLaunch, false)
  assert.equal(result.activation.stage, 'pilot')
  assert.deepEqual(result.activation.tenantIds, ['tenant-canary'])
})

test('idempotent decision replay returns the first decision and conflicting reuse fails closed', () => {
  const first = applyLaunchDecision({ ledger: [], idempotencyKey: 'launch-1', requestHash: 'hash-a', decision: { liveConformance: true } })
  const replay = applyLaunchDecision({ ledger: first.ledger, idempotencyKey: 'launch-1', requestHash: 'hash-a', decision: { liveConformance: false } })
  const conflict = applyLaunchDecision({ ledger: replay.ledger, idempotencyKey: 'launch-1', requestHash: 'hash-b', decision: { liveConformance: true } })

  assert.equal(first.outcome, 'accepted')
  assert.equal(replay.outcome, 'replay')
  assert.deepEqual(replay.decision, first.decision)
  assert.equal(conflict.outcome, 'conflict')
  assert.equal(conflict.decision.liveConformance, false)
  assert.equal(conflict.ledger.length, 1)
})

test('replayed or revoked launch evidence cannot authorize a new activation', () => {
  const result = evaluatePilotGoLive({
    now,
    evidence: [directEvidence('database', { replayed: true }), directEvidence('deployment', { revoked: true })],
    requestedFlags: { broadLaunch: true },
  })

  assert.equal(result.liveConformance, false)
  assert.ok(result.blockers.includes('database:replay'))
  assert.ok(result.blockers.includes('deployment:revoked'))
  assert.equal(result.flags.broadLaunch, false)
})

test('P0 rollback stops intake, drains/quarantines work, and preserves durable evidence', () => {
  assert.deepEqual(createP0RollbackPlan({ now, reason: 'deployment evidence revoked' }), {
    status: 'rollback-required',
    reason: 'deployment evidence revoked',
    stopIntake: true,
    drain: true,
    quarantine: true,
    preserve: ['audit', 'evidence', 'ledger', 'outbox', 'dlq', 'idempotency'],
    financialCorrection: 'append-only-compensation',
    destructiveRollback: false,
    liveConformance: false,
    rolledBackAt: now,
  })
})

test('staged activation rejects unnamed tenants/customers and broad launch without explicit authorization', () => {
  const blocked = evaluateStagedActivation({ requested: { stage: 'pilot', tenantIds: [], customerIds: [] }, liveConformance: false })
  const broad = evaluateStagedActivation({ requested: { stage: 'broad', tenantIds: ['tenant-a'], customerIds: ['customer-a'] }, liveConformance: false })

  assert.equal(blocked.enabled, false)
  assert.deepEqual(blocked.blockers, ['tenant-allowlist-required', 'customer-allowlist-required'])
  assert.equal(broad.enabled, false)
  assert.deepEqual(broad.blockers, ['broad-launch-direct-evidence-required'])
})

test('go-live docs preserve evidence separation, user-owned inputs, and no production claim', () => {
  const evidence = readFileSync(join(root, 'openspec', 'changes', 'tus-argentina-market-launch', 'go-live-evidence.md'), 'utf8')
  const runbook = readFileSync(join(root, 'docs', 'runbooks', 'tus-pilot-go-live.md'), 'utf8')
  for (const required of [
    'database', 'schema', 'tenancy', 'payments', 'whatsapp', 'delivery', 'billing', 'mobile', 'deployment',
    'deterministic', 'real-postgresql', 'provider', 'browser/mobile', 'legal/tax', 'external-blocked',
    'liveConformance: false', 'not-production-ready', 'user-owned', 'go/no-go',
  ]) assert.match(evidence, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), required)
  for (const required of ['support', 'incident', 'backup', 'restore', 'rollback', 'stop intake', 'quarantine', 'preserve']) {
    assert.match(runbook, new RegExp(required, 'i'), required)
  }
})
