import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  buildEvidenceRecord,
  evaluateActivationGate,
  redactDiagnostics,
  resolveDeliveryProfile,
  validatePlanFixture,
} from '../../../scripts/validation/cloud-native/contracts.mjs'

const root = join(import.meta.dirname, '..', '..', '..')

test('profile selection requires an explicit active cloud-native profile', () => {
  assert.equal(resolveDeliveryProfile('render-native').id, 'render-native')
  assert.equal(resolveDeliveryProfile('aws-terraform').id, 'aws-terraform')
  assert.throws(() => resolveDeliveryProfile(), /explicit profile/i)
  assert.throws(() => resolveDeliveryProfile('compose'), /unsupported|compose/i)
})

test('each active profile declares all five managed-service boundaries', () => {
  const required = ['postgresql', 'mongodb', 'redis', 'object-storage', 'queues']

  for (const profileId of ['render-native', 'aws-terraform']) {
    const profile = resolveDeliveryProfile(profileId)
    assert.deepEqual(Object.keys(profile.boundaries), required)

    for (const boundary of Object.values(profile.boundaries)) {
      assert.ok(boundary.owner)
      assert.ok(boundary.configRef)
      assert.ok(boundary.rollbackRef)
      assert.ok(boundary.activationGate)
      assert.match(boundary.mode, /^(managed|fake|disabled)$/)
    }
  }
})

test('missing live credentials or resources preserve deterministic fake states', () => {
  const profile = resolveDeliveryProfile('aws-terraform')
  const result = evaluateActivationGate(profile.boundaries.redis, {
    credentials: false,
    resources: false,
    authorizedSmoke: false,
  })

  assert.equal(result.status, 'unavailable')
  assert.equal(result.evidenceKind, 'unavailable-deferred')
  assert.equal(result.liveConformance, false)
  assert.match(result.effectiveMode, /^(fake|disabled)$/)
  assert.match(result.reason, /credential|resource/i)
})

test('authorized smoke is gated independently from plan validation', () => {
  const boundary = resolveDeliveryProfile('render-native').boundaries.postgresql
  const planOnly = buildEvidenceRecord({
    profile: 'render-native',
    boundary: boundary.name,
    planValidated: true,
    credentials: false,
    resources: false,
    authorizedSmoke: false,
  })
  const live = buildEvidenceRecord({
    profile: 'render-native',
    boundary: boundary.name,
    planValidated: true,
    credentials: true,
    resources: true,
    authorizedSmoke: true,
  })

  assert.deepEqual(
    { kind: planOnly.kind, status: planOnly.status, liveConformance: planOnly.liveConformance },
    { kind: 'cloud-plan-validation', status: 'pass', liveConformance: false },
  )
  assert.deepEqual(
    { kind: live.kind, status: live.status, liveConformance: live.liveConformance },
    { kind: 'authorized-cloud-smoke', status: 'pass', liveConformance: true },
  )
})

test('diagnostics redact secret-like keys and values without reading environment files', () => {
  const diagnostics = redactDiagnostics({
    profile: 'aws-terraform',
    configRef: 'aws-secrets-manager/profile/database',
    secret: 'synthetic-secret-value',
    nested: { authorization: 'Bearer synthetic-token' },
  })

  assert.equal(diagnostics.profile, 'aws-terraform')
  assert.equal(diagnostics.secret, '[REDACTED]')
  assert.equal(diagnostics.nested.authorization, '[REDACTED]')
  assert.doesNotMatch(JSON.stringify(diagnostics), /synthetic-secret-value|synthetic-token/)
})

test('cloud plan fixtures are check-only and cannot claim provisioning or live conformance', () => {
  for (const profileId of ['render-native', 'aws-terraform']) {
    const fixture = JSON.parse(
      readFileSync(join(root, 'scripts', 'validation', 'cloud-native', 'fixtures', `${profileId}.json`), 'utf8'),
    )
    const result = validatePlanFixture(fixture)

    assert.equal(result.profile, profileId)
    assert.equal(result.valid, true)
    assert.equal(result.provisioned, false)
    assert.equal(result.liveConformance, false)
    assert.equal(result.cloudCalls, false)
  }

  const dishonest = validatePlanFixture({
    profile: 'aws-terraform',
    infrastructureAuthority: 'terraform',
    declaredBoundaries: ['postgresql', 'mongodb', 'redis', 'object-storage', 'queues'],
    provisioned: true,
    cloudCalls: true,
    liveConformance: true,
  })
  assert.equal(dishonest.valid, false)
  assert.match(dishonest.errors.join(' '), /must not/i)
})

test('cloud-native documentation forbids silent Compose fallback and separates evidence classes', () => {
  const profileMatrix = readFileSync(join(root, 'docs', 'architecture', 'profile-matrix.md'), 'utf8')
  const render = readFileSync(join(root, 'docs', 'deployment', 'render.md'), 'utf8')
  const aws = readFileSync(join(root, 'docs', 'deployment', 'aws.md'), 'utf8')
  const evidence = readFileSync(join(root, 'docs', 'evidence', 'cloud-native', 'README.md'), 'utf8')

  for (const content of [profileMatrix, render, aws]) {
    assert.match(content, /PostgreSQL/i)
    assert.match(content, /MongoDB/i)
    assert.match(content, /Redis/i)
    assert.match(content, /object storage/i)
    assert.match(content, /queue/i)
    assert.match(content, /owner/i)
    assert.match(content, /rollback/i)
    assert.match(content, /activation gate/i)
  }

  assert.match(render, /Render-native/i)
  assert.match(aws, /AWS Terraform/i)
  assert.match(profileMatrix, /must not silently fall back to Compose/i)
  assert.match(evidence, /cloud-plan-validation/i)
  assert.match(evidence, /authorized-cloud-smoke/i)
  assert.match(evidence, /unavailable-deferred/i)
  assert.match(evidence, /live conformance.*not claimed/i)
})
