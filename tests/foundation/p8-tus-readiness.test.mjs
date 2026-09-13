import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  TUS_CONTRACT_VERSION,
  validateTusReadinessDecision,
  validateTusReadinessEvidence,
} from '../../packages/contracts/src/index.ts'
import {
  REQUISITOS_HABILITACION_REQUERIDOS,
  crearEvidenciaHabilitacion,
  evaluarHabilitacionPublicacionEtapa1,
  evaluarHabilitacion,
  revertirHabilitacion,
} from '../../apps/api/src/tus/readiness/index.ts'

const baseEvidence = {
  tenantId: 'tenant-a',
  capability: 'settlement',
  owner: 'readiness-owner',
  scope: 'argentina-stage-1',
  evidenceType: 'approval-record',
  policyVersion: 'tus-readiness-v1',
  expiresAt: '2027-01-01T00:00:00.000Z',
  revoked: false,
  source: 'authorized',
}

function completeEvidence(overrides = {}) {
  return REQUISITOS_HABILITACION_REQUERIDOS.map((gate) =>
    crearEvidenciaHabilitacion({
      ...baseEvidence,
      gate,
      evidenceId: `evidence-${gate}`,
      evidenceRef: `ref-${gate}`,
      ...overrides,
    }),
  )
}

test('Stage 1 readiness allows approved cohorts and records auditable non-claims', () => {
  assert.deepEqual(
    evaluarHabilitacionPublicacionEtapa1({
      tenantId: 'tenant-a',
      cohort: 'beauty-personal-care',
      regulatedHealthcare: false,
    }),
    {
      allowed: true,
      reason: 'approved_stage_1_cohort',
      tenantId: 'tenant-a',
      nonClaim: null,
    },
  )
  assert.deepEqual(
    evaluarHabilitacionPublicacionEtapa1({
      tenantId: 'tenant-a',
      cohort: 'regulated-healthcare',
      regulatedHealthcare: true,
    }),
    {
      allowed: false,
      reason: 'regulated_vertical_excluded',
      tenantId: 'tenant-a',
      nonClaim: 'regulated_vertical_excluded',
    },
  )
  assert.deepEqual(
    evaluarHabilitacionPublicacionEtapa1({
      tenantId: 'tenant-a',
      cohort: 'rentals',
      regulatedHealthcare: false,
    }),
    {
      allowed: false,
      reason: 'cohort_not_enabled',
      tenantId: 'tenant-a',
      nonClaim: 'cohort_not_enabled',
    },
  )
})

test('complete authorized evidence enables a scoped readiness capability', () => {
  const evidence = completeEvidence()
  const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'settlement',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence,
  })

  assert.equal(decision.contractVersion, TUS_CONTRACT_VERSION)
  assert.equal(decision.enabled, true)
  assert.equal(decision.disposition, 'authorized')
  assert.deepEqual(decision.failedGates, [])
  assert.deepEqual(decision.evidenceIds, evidence.map(({ evidenceId }) => evidenceId))
  assert.equal(decision.deterministic, false)
  assert.deepEqual(validateTusReadinessDecision(decision), decision)
})

test('missing, expired, or revoked evidence fails closed with exact gate reasons', () => {
  const evidence = completeEvidence({
    evidenceId: 'evidence-legal',
    evidenceRef: 'ref-legal',
  }).filter(({ gate }) => gate !== 'tax' && gate !== 'posPilot')
  evidence.push(
    crearEvidenciaHabilitacion({
      ...baseEvidence,
      gate: 'tax',
      evidenceId: 'evidence-tax',
      evidenceRef: 'ref-tax',
      expiresAt: '2026-01-01T00:00:00.000Z',
    }),
  )
  evidence.push(
    crearEvidenciaHabilitacion({
      ...baseEvidence,
      gate: 'mercadoPago',
      evidenceId: 'evidence-mercado-pago',
      evidenceRef: 'ref-mercado-pago',
      revoked: true,
    }),
  )

    const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'settlement',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence,
  })

  assert.equal(decision.enabled, false)
  assert.equal(decision.disposition, 'disabled')
  assert.deepEqual(decision.failedGates, [
    { gate: 'tax', reason: 'evidence_expired' },
    { gate: 'mercadoPago', reason: 'evidence_revoked' },
    { gate: 'posPilot', reason: 'evidence_missing' },
  ])
})

test('deterministic proof is labeled test-only and cannot activate production readiness', () => {
    const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'settlement',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: completeEvidence({ source: 'deterministic-test-only' }),
  })

  assert.equal(decision.enabled, false)
  assert.equal(decision.disposition, 'unavailable-deferred')
  assert.equal(decision.deterministic, true)
  assert.equal(decision.reason, 'deterministic_test_only')
  assert.ok(decision.failedGates.every(({ reason }) => reason === 'deterministic_test_only'))
})

test('rollback disables readiness while preserving evidence and audit references', () => {
    const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'settlement',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: completeEvidence(),
  })

  assert.deepEqual(revertirHabilitacion(decision, 'provider-readiness-regressed', '2026-08-26T13:00:00.000Z'), {
    contractVersion: TUS_CONTRACT_VERSION,
    tenantId: 'tenant-a',
    capability: 'settlement',
    evaluatedAt: '2026-08-26T13:00:00.000Z',
    enabled: false,
    disposition: 'disabled',
    failedGates: [],
    evidenceIds: decision.evidenceIds,
    deterministic: false,
    reason: 'provider-readiness-regressed',
    evidencePreserved: true,
    auditPreserved: true,
  })
})

test('readiness evidence carries versioned ownership, scope, policy, expiry, and revocation fields', () => {
  const evidence = crearEvidenciaHabilitacion({
    ...baseEvidence,
    gate: 'legal',
    evidenceId: 'evidence-legal-contract',
    evidenceRef: 'legal/argentina/approval-1',
  })

  assert.deepEqual(validateTusReadinessEvidence(evidence), evidence)
  assert.throws(
    () => validateTusReadinessEvidence({ ...evidence, contractVersion: '0.0.0' }),
    /unsupported contract version/i,
  )
})

test('capability evaluation honors scope and non-expiring evidence explicitly', () => {
  const evidence = completeEvidence({ capability: 'publication', expiresAt: null })
  const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'publication',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence,
  })

  assert.equal(decision.enabled, true)
  assert.deepEqual(decision.failedGates, [])

  const outOfScope = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'publication',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: completeEvidence({ capability: 'publication', scope: 'other-scope' }),
  })

  assert.equal(outOfScope.enabled, false)
  assert.deepEqual(outOfScope.failedGates, [
    { gate: 'legal', reason: 'evidence_out_of_scope' },
    { gate: 'kyb', reason: 'evidence_out_of_scope' },
    { gate: 'tax', reason: 'evidence_out_of_scope' },
    { gate: 'runtimeProvider', reason: 'evidence_out_of_scope' },
  ])
})

test('readiness contracts reject malformed timestamps and contradictory dispositions', () => {
  assert.throws(
    () =>
      crearEvidenciaHabilitacion({
        ...baseEvidence,
        gate: 'legal',
        evidenceId: 'evidence-invalid-expiry',
        evidenceRef: 'ref-invalid-expiry',
        expiresAt: 'not-a-date',
      }),
    /expiresAt must be a valid ISO timestamp/i,
  )

  const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'publication',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: completeEvidence({ capability: 'publication', expiresAt: null }),
  })

  assert.throws(
    () => validateTusReadinessDecision({ ...decision, enabled: true, disposition: 'disabled' }),
    /disposition must match readiness state/i,
  )
})

test('readiness contracts accept RFC3339 offsets and preserve deferred deterministic state', () => {
  const evidence = crearEvidenciaHabilitacion({
    ...baseEvidence,
    capability: 'publication',
    gate: 'legal',
    evidenceId: 'evidence-offset-expiry',
    evidenceRef: 'ref-offset-expiry',
    expiresAt: '2027-01-01T00:00:00+03:00',
  })

  assert.equal(evidence.expiresAt, '2027-01-01T00:00:00+03:00')

  const decision = evaluarHabilitacion({
    tenantId: 'tenant-a',
    capability: 'publication',
    scope: 'argentina-stage-1',
    now: '2026-08-26T12:00:00.000Z',
    evidence: completeEvidence({ capability: 'publication', expiresAt: null, source: 'deterministic-test-only' }),
  })

  assert.equal(decision.disposition, 'unavailable-deferred')
  assert.equal(validateTusReadinessDecision(decision).deterministic, true)
})
