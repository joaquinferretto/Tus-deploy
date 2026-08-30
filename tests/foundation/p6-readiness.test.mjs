import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

const readinessPaths = [
  'docs/evidence/readiness/README.md',
  'docs/runbooks/provider-disablement.md',
  'docs/runbooks/migration-rollback.md',
  'docs/runbooks/job-replay.md',
  'docs/runbooks/backup-restore.md',
  'docs/runbooks/secret-rotation.md',
  'docs/runbooks/profile-rollback.md',
  'docs/rollback/README.md',
]

function loadReadinessArtifacts() {
  return readinessPaths.map((path) => readFileSync(join(root, path), 'utf8')).join('\n')
}

function evaluateReadiness(evidence, now) {
  const blockers = evidence.flatMap((record) => {
    if (record.status === 'missing') return [`missing:${record.gate}`]
    if (record.status === 'expired') return [`expired:${record.gate}`]
    if (record.status === 'unauthorized') return [`unauthorized:${record.gate}`]
    if (record.expiresAt <= now) return [`expired:${record.gate}`]
    if (record.liveRequired && record.kind !== 'authorized-cloud-smoke') {
      return [`unauthorized:${record.gate}`]
    }
    return []
  })

  return {
    status: blockers.length === 0 ? 'production-ready' : 'not-production-ready',
    liveConformance: blockers.length === 0,
    blockers,
    deterministicVerificationMayContinue: true,
  }
}

test('P6.7 readiness artifacts define every reversible operational boundary', () => {
  const content = loadReadinessArtifacts().toLowerCase()

  for (const required of [
    'provider disablement',
    'migration rollback',
    'job replay',
    'backup restore',
    'secret rotation',
    'profile rollback',
    'production-ready',
    'not-production-ready',
    'missing',
    'expired',
    'unauthorized',
    'liveconformance',
    'deterministic',
    'rollback boundary',
    'ledger',
    'outbox',
    'dlq',
    'last passing',
    'do not claim',
  ]) {
    assert.match(content, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('missing readiness evidence blocks production readiness without blocking deterministic checks', () => {
  const result = evaluateReadiness(
    [
      {
        gate: 'profile-smoke',
        status: 'missing',
        kind: 'unavailable-deferred',
        expiresAt: 1_900_000_000_000,
        liveRequired: true,
      },
    ],
    1_700_000_000_000
  )

  assert.deepEqual(result, {
    status: 'not-production-ready',
    liveConformance: false,
    blockers: ['missing:profile-smoke'],
    deterministicVerificationMayContinue: true,
  })
})

test('expired readiness evidence blocks production readiness even when the prior smoke passed', () => {
  const result = evaluateReadiness(
    [
      {
        gate: 'security-scan',
        status: 'verified',
        kind: 'authorized-cloud-smoke',
        expiresAt: 1_699_999_999_999,
        liveRequired: true,
      },
    ],
    1_700_000_000_000
  )

  assert.deepEqual(result, {
    status: 'not-production-ready',
    liveConformance: false,
    blockers: ['expired:security-scan'],
    deterministicVerificationMayContinue: true,
  })
})

test('live-unauthorized readiness evidence cannot become a passing live claim', () => {
  const result = evaluateReadiness(
    [
      {
        gate: 'provider-smoke',
        status: 'unauthorized',
        kind: 'cloud-plan-validation',
        expiresAt: 1_900_000_000_000,
        liveRequired: true,
      },
    ],
    1_700_000_000_000
  )

  assert.deepEqual(result, {
    status: 'not-production-ready',
    liveConformance: false,
    blockers: ['unauthorized:provider-smoke'],
    deterministicVerificationMayContinue: true,
  })
})

test('complete current evidence can support a scoped readiness claim', () => {
  const result = evaluateReadiness(
    [
      {
        gate: 'security-scan',
        status: 'verified',
        kind: 'authorized-cloud-smoke',
        expiresAt: 1_900_000_000_000,
        liveRequired: true,
      },
      {
        gate: 'recovery-drill',
        status: 'verified',
        kind: 'native-smoke',
        expiresAt: 1_900_000_000_000,
        liveRequired: false,
      },
    ],
    1_700_000_000_000
  )

  assert.deepEqual(result, {
    status: 'production-ready',
    liveConformance: true,
    blockers: [],
    deterministicVerificationMayContinue: true,
  })
})
