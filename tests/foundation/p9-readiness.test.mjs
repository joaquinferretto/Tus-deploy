import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TUS_CONTRACT_VERSION,
  validarDecisionHabilitacion,
  validarEvidenciaHabilitacion,
} from '../../packages/contracts/src/index.ts'
import {
  REQUISITOS_HABILITACION_REQUERIDOS,
  crearEvidenciaHabilitacion,
  evaluarHabilitacion,
  conciliarDecisionHabilitacion,
} from '../../apps/api/src/tus/readiness/index.ts'
import { evaluarRequisitosHabilitacion } from '../../apps/api/src/tus/domain/readiness.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

const evidenceDefaults = {
  tenantId: 'tenant-a',
  capability: 'publication',
  owner: 'owner-a',
  scope: 'argentina-stage-1',
  evidenceType: 'approval-record',
  policyVersion: 'tus-readiness-v2',
  issuedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  revoked: false,
  source: 'authorized-external',
}

function evidence(gate, overrides = {}) {
  return crearEvidenciaHabilitacion({
    ...evidenceDefaults,
    gate,
    evidenceId: `evidence-${gate}-${overrides.evidenceId ?? 'one'}`,
    evidenceRef: `ref-${gate}-${overrides.evidenceRef ?? 'one'}`,
    ...overrides,
  })
}

function completePublicationEvidence(overrides = {}) {
  return ['legal', 'kyb', 'tax', 'runtimeProvider'].map((gate) => evidence(gate, overrides))
}

test('canonical readiness contracts require issued evidence and preserve truthful evidence classes', () => {
  const record = evidence('legal')

  assert.equal(record.contractVersion, TUS_CONTRACT_VERSION)
  assert.equal(record.issuedAt, '2026-08-01T00:00:00.000Z')
  assert.equal(record.source, 'authorized-external')
  assert.deepEqual(validarEvidenciaHabilitacion(record), record)
  assert.throws(
    () => validarEvidenciaHabilitacion({ ...record, issuedAt: 'not-a-date' }),
    /issuedAt must be a valid ISO timestamp/i,
  )
})

test('duplicate current evidence for one gate fails closed and records a conflict', () => {
  const duplicateLegal = [
    ...completePublicationEvidence(),
    evidence('legal', { evidenceId: 'two', evidenceRef: 'two', owner: 'owner-b' }),
  ]

  const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'publication',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: duplicateLegal,
  })

  assert.equal(decision.enabled, false)
  assert.equal(decision.disposition, 'disabled')
  assert.deepEqual(decision.failedGates, [{ gate: 'legal', reason: 'evidence_conflict' }])
  assert.deepEqual(decision.conflicts, [
    { gate: 'legal', evidenceIds: ['evidence-legal-one', 'two'] },
  ])
  assert.deepEqual(validarDecisionHabilitacion(decision), decision)
})

test('legacy boolean readiness is a compatibility adapter and cannot override a stricter canonical decision', () => {
  const canonical = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'publication',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: completePublicationEvidence(),
  })
  const legacy = evaluarRequisitosHabilitacion({
    legal: true,
    kyc: true,
    kyb: true,
    tax: true,
    mercadoPago: true,
    posPilot: true,
    aws: true,
    groqMigration: true,
  })

  assert.equal(legacy.enabled, true)
  const reconciled = conciliarDecisionHabilitacion(canonical, { ...legacy, enabled: false, failedGates: ['legal'] })
  assert.equal(reconciled.enabled, false)
  assert.equal(reconciled.disposition, 'disabled')
  assert.deepEqual(reconciled.failedGates, [{ gate: 'legal', reason: 'legacy_conflict' }])
  assert.deepEqual(reconciled.conflicts, [{ gate: 'legal', evidenceIds: [], source: 'legacy-boolean' }])
})

test('canonical evaluation fails closed for missing, expired, revoked, and out-of-scope evidence', () => {
  const records = [
    evidence('legal', { expiresAt: '2026-01-01T00:00:00.000Z' }),
    evidence('kyb', { revoked: true }),
    evidence('tax', { scope: 'other-scope' }),
  ]
  const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'publication',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: records,
  })

  assert.equal(decision.enabled, false)
  assert.deepEqual(decision.failedGates, [
    { gate: 'legal', reason: 'evidence_expired' },
    { gate: 'kyb', reason: 'evidence_revoked' },
    { gate: 'tax', reason: 'evidence_out_of_scope' },
    { gate: 'runtimeProvider', reason: 'evidence_missing' },
  ])
})

test('provider-free evidence remains deferred without being mislabeled as deterministic authorization', () => {
  const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'publication',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: completePublicationEvidence({ source: 'local-postgresql-http' }),
  })

  assert.equal(decision.enabled, false)
  assert.equal(decision.disposition, 'unavailable-deferred')
  assert.equal(decision.deterministic, false)
  assert.equal(decision.reason, 'evidence_deferred')
  assert.ok(decision.failedGates.every(({ reason }) => reason === 'evidence_deferred'))
  assert.deepEqual(validarDecisionHabilitacion(decision), decision)
})

test('readiness migration adds canonical validity and conflict persistence without deleting evidence', () => {
  const migration = readFileSync(
    join(root, 'apps', 'api', 'prisma', 'migrations', '20260827090100_tus_canonical_readiness', 'migration.sql'),
    'utf8',
  )

  assert.match(migration, /ADD COLUMN "issuedAt" TIMESTAMP\(3\)/i)
  assert.match(migration, /ADD COLUMN "conflicts" JSONB/i)
  assert.match(migration, /TusReadinessEvidence/i)
  assert.match(migration, /TusReadinessDecision/i)
  assert.match(migration, /preserve|rollback|not delete/i)
  assert.equal(REQUISITOS_HABILITACION_REQUERIDOS.includes('runtimeProvider'), true)
})
