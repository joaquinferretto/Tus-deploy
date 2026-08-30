import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  ACTIVATION_GATE_KEYS,
  DEFAULT_TUS_ACTIVATION_REQUEST,
  TUS_EVIDENCE_CLASSES,
  createActivationReport,
  createDisablementPlan,
  evaluateTusActivation,
} from '../../scripts/activation/tus-readiness.mjs'

const root = join(import.meta.dirname, '..', '..')
const now = '2026-08-27T12:00:00.000Z'

function readEvidenceDocuments() {
  return {
    matrix: readFileSync(join(root, 'docs', 'evidence', 'readiness', 'tus-matrix.md'), 'utf8'),
    nativeSmoke: readFileSync(join(root, 'docs', 'evidence', 'native-smoke.md'), 'utf8'),
  }
}

const authorizedEvidence = Object.fromEntries(
  ACTIVATION_GATE_KEYS.map((gate) => [
    gate,
    {
      evidenceId: `evidence-${gate}`,
      approved: true,
      approvalStatus: 'approved',
      profile: 'render-native',
      scope: 'tus-stage-1-pilot',
      owner: `owner-${gate}`,
      evidenceType: 'authorized-smoke',
      evidenceRef: `vault://evidence/${gate}`,
      policyVersion: 'tus-activation.v1',
      issuedAt: '2026-08-26T12:00:00.000Z',
      expiresAt: '2026-09-27T12:00:00.000Z',
      revoked: false,
      source: 'authorized-external',
    },
  ]),
)

test('PR10 exposes every independent activation gate with safe defaults', () => {
  assert.deepEqual(DEFAULT_TUS_ACTIVATION_REQUEST, {
    api: true,
    web: true,
    workers: true,
    tusRoutes: false,
    providers: false,
    releaseJobs: false,
    fleetJobs: false,
    mercadoPago: false,
    whatsapp: false,
    aws: false,
    render: false,
    cloud: false,
    legal: false,
    tax: false,
    kyc: false,
    kyb: false,
    postgresql: false,
    browser: false,
    device: false,
    posPilot: false,
    productionOperations: false,
  })
  assert.deepEqual([...ACTIVATION_GATE_KEYS], [
    'mercadoPago',
    'whatsapp',
    'aws',
    'render',
    'cloud',
    'legal',
    'tax',
    'kyc',
    'kyb',
    'postgresql',
    'browser',
    'device',
    'posPilot',
    'productionOperations',
  ])
})

test('missing evidence fails closed independently and keeps provider-free services composable', () => {
  const result = evaluateTusActivation({
    profile: 'render-native',
    now,
    requested: {
      tusRoutes: true,
      providers: true,
      releaseJobs: true,
      fleetJobs: true,
      mercadoPago: true,
      whatsapp: true,
      aws: true,
      render: true,
      cloud: true,
      legal: true,
      tax: true,
      kyc: true,
      kyb: true,
      postgresql: true,
      browser: true,
      device: true,
      posPilot: true,
      productionOperations: true,
    },
    evidence: {},
  })

  assert.equal(result.status, 'not-production-ready')
  assert.equal(result.liveConformance, false)
  assert.equal(result.planOnly, true)
  assert.equal(result.provisioned, false)
  assert.equal(result.cloudCalls, false)
  assert.deepEqual(result.deployment.enabled, {
    api: true,
    web: true,
    workers: true,
    tusRoutes: false,
    providers: false,
    releaseJobs: false,
    fleetJobs: false,
  })
  assert.equal(result.gates.mercadoPago.status, 'disabled')
  assert.equal(result.gates.mercadoPago.reason, 'missing')
  assert.ok(result.blockers.includes('mercadoPago:missing'))
  assert.ok(result.blockers.includes('whatsapp:missing'))
  assert.ok(result.blockers.includes('postgresql:missing'))
  assert.ok(result.blockers.includes('browser:missing'))
  assert.ok(result.blockers.includes('posPilot:missing'))
  assert.deepEqual(result.excludedScopes, [
    'global-launch',
    'rentals',
    'regulated-healthcare',
    'financing-credit',
    'custody-escrow',
    'open-driver-bidding',
    'mature-dispatch',
    'warehouse-automation',
    'unbounded-ai-authority',
  ])
})

test('authorized evidence remains scoped but cannot claim production readiness without the complete evidence envelope', () => {
  const result = evaluateTusActivation({
    profile: 'render-native',
    now,
    requested: { mercadoPago: true },
    evidence: { mercadoPago: authorizedEvidence.mercadoPago },
  })

  assert.equal(result.status, 'not-production-ready')
  assert.equal(result.liveConformance, false)
  assert.equal(result.gates.mercadoPago.status, 'enabled')
  assert.equal(result.gates.mercadoPago.evidenceId, 'evidence-mercadoPago')
  assert.equal(result.gates.mercadoPago.owner, 'owner-mercadoPago')
  assert.equal(result.gates.mercadoPago.expiresAt, '2026-09-27T12:00:00.000Z')
  assert.equal(result.deployment.enabled.providers, false)
  assert.equal(result.deployment.enabled.releaseJobs, false)
  assert.equal(result.claims.liveAuthorization, false)
  assert.deepEqual(result.claims.enabledCapabilities, [])
  for (const gate of ['postgresql', 'cloud', 'browser', 'device', 'legal', 'posPilot']) {
    assert.ok(result.productionReadinessBlockers.includes(`${gate}:missing`), gate)
  }
})

test('activation evidence taxonomy distinguishes local deterministic proof from deferred external evidence', () => {
  const deterministic = evaluateTusActivation({
    profile: 'render-native',
    now,
    requested: { render: true },
    evidence: {
      render: {
        evidenceId: 'local-render-check',
        approved: true,
        profile: 'render-native',
        scope: 'local-verification',
        source: 'local-deterministic',
      },
    },
  })
  const deferred = createActivationReport({ profile: 'render-native', now })

  assert.deepEqual([...TUS_EVIDENCE_CLASSES], [
    'local-deterministic',
    'local-postgresql-http',
    'authorized-external',
    'deferred',
  ])
  assert.equal(deterministic.evidenceClass, 'local-deterministic')
  assert.equal(deterministic.liveConformance, false)
  assert.equal(deferred.evidenceClass, 'deferred')
  assert.ok(deferred.evidenceClasses.includes('deferred'))
  assert.equal(deferred.claims.liveAuthorization, false)
})

test('local PostgreSQL evidence is reported precisely but never authorizes a live gate', () => {
  const result = evaluateTusActivation({
    profile: 'render-native',
    now,
    requested: { postgresql: true, tusRoutes: true },
    evidence: {
      postgresql: {
        evidenceId: 'local-postgres-smoke',
        approved: true,
        approvalStatus: 'approved',
        profile: 'render-native',
        scope: 'tus-stage-1-pilot',
        owner: 'local-runtime',
        evidenceType: 'postgres-http-smoke',
        evidenceRef: 'local://postgres-smoke',
        policyVersion: 'tus-activation.v1',
        issuedAt: '2026-08-26T12:00:00.000Z',
        expiresAt: null,
        revoked: false,
        source: 'local-postgresql-http',
      },
    },
  })

  assert.equal(result.gates.postgresql.status, 'disabled')
  assert.equal(result.gates.postgresql.reason, 'local-postgresql-http')
  assert.equal(result.evidenceClass, 'local-postgresql-http')
  assert.equal(result.liveConformance, false)
  assert.equal(result.deployment.enabled.tusRoutes, false)
  assert.match(result.claims.statement, /no production readiness/i)
})

test('readiness output enumerates every gate and keeps unavailable evidence explicit', () => {
  const report = createActivationReport({
    profile: 'render-native',
    now,
    requested: Object.fromEntries(ACTIVATION_GATE_KEYS.map((gate) => [gate, true])),
  })

  assert.deepEqual(Object.keys(report.gates), [...ACTIVATION_GATE_KEYS])
  assert.deepEqual(report.readiness, {
    decision: 'not-production-ready',
    evidenceBoundary: 'deferred',
    externalEvidenceRequired: true,
    unavailableGates: [...ACTIVATION_GATE_KEYS],
  })
  for (const gate of ACTIVATION_GATE_KEYS) {
    assert.equal(report.gates[gate].status, 'disabled', gate)
    assert.equal(report.gates[gate].reason, 'missing', gate)
  }
  assert.equal(report.claims.liveAuthorization, false)
  assert.deepEqual(report.composition.enabled, {
    api: true,
    web: true,
    workers: true,
    tusRoutes: false,
    providers: false,
    releaseJobs: false,
    fleetJobs: false,
  })
})

test('expired, revoked, out-of-scope, and deterministic evidence never become live authorization', () => {
  const evidence = structuredClone(authorizedEvidence)
  evidence.mercadoPago.expiresAt = '2026-08-27T12:00:00.000Z'
  evidence.whatsapp.revoked = true
  evidence.aws.profile = 'aws-terraform'
  evidence.render.source = 'local-deterministic'

  const result = evaluateTusActivation({
    profile: 'render-native',
    now,
    requested: { mercadoPago: true, whatsapp: true, aws: true, render: true },
    evidence,
  })

  assert.equal(result.status, 'not-production-ready')
  assert.equal(result.liveConformance, false)
  assert.equal(result.claims.liveAuthorization, false)
  assert.equal(result.gates.mercadoPago.reason, 'expired')
  assert.equal(result.gates.whatsapp.reason, 'revoked')
  assert.equal(result.gates.aws.reason, 'out-of-scope')
  assert.equal(result.gates.render.reason, 'deterministic-test-only')
  assert.ok(result.blockers.includes('mercadoPago:expired'))
  assert.ok(result.blockers.includes('whatsapp:revoked'))
  assert.ok(result.blockers.includes('aws:out-of-scope'))
  assert.ok(result.blockers.includes('render:deterministic-test-only'))
})

test('duplicate current evidence is a conflict and malformed evidence is redacted from the report', () => {
  const duplicate = structuredClone(authorizedEvidence.mercadoPago)
  duplicate.evidenceId = 'evidence-mercadoPago-duplicate'
  const evidence = { ...authorizedEvidence, mercadoPago: [authorizedEvidence.mercadoPago, duplicate] }
  const result = evaluateTusActivation({
    profile: 'render-native',
    now,
    requested: { mercadoPago: true },
    evidence,
  })

  assert.equal(result.gates.mercadoPago.reason, 'conflict')
  assert.equal(result.liveConformance, false)
  assert.ok(result.blockers.includes('mercadoPago:conflict'))
  assert.doesNotMatch(JSON.stringify(result), /vault:\/\/evidence\/mercadoPago/)
})

test('disablement stops intake, drains or quarantines work, and preserves durable evidence', () => {
  const plan = createDisablementPlan({
    capability: 'releaseJobs',
    reason: 'pos pilot evidence revoked',
    now,
    inFlight: 3,
  })

  assert.deepEqual(plan, {
    capability: 'releaseJobs',
    status: 'disabled',
    reason: 'pos pilot evidence revoked',
    disabledAt: now,
    stopIntake: true,
    drain: true,
    quarantine: true,
    inFlight: 3,
    preserved: { audit: true, evidence: true, ledger: true, outbox: true, dlq: true },
    financialRollback: 'append-only-compensation',
    replay: 'requires-new-authorized-evidence',
    destructiveRollback: false,
  })
})

test('activation report is provider-free, auditable, and makes no unsupported live claim', () => {
  const report = createActivationReport({ profile: 'aws-terraform', now })

  assert.equal(report.schema, 'tus.activation-report.v1')
  assert.equal(report.profile, 'aws-terraform')
  assert.equal(report.evidenceClass, 'deferred')
  assert.equal(report.status, 'not-production-ready')
  assert.equal(report.liveConformance, false)
  assert.equal(report.claims.liveAuthorization, false)
  assert.match(report.claims.statement, /no production readiness/i)
  assert.equal(report.composition.planOnly, true)
  assert.equal(report.composition.cloudCalls, false)
  assert.equal(report.composition.provisioned, false)
})

test('activation tooling does not discover credentials or claim external authorization from configuration', () => {
  const source = readFileSync(join(root, 'scripts', 'activation', 'tus-readiness.mjs'), 'utf8')

  assert.doesNotMatch(source, /process\.env|dotenv|readFileSync|fetch\(|AWS_ACCESS_KEY|MERCADOPAGO_ACCESS_TOKEN|WHATSAPP_TOKEN/)
})

test('deployment plans document all provider-free activation switches and excluded scopes', () => {
  const content = [
    readFileSync(join(root, 'render.yaml'), 'utf8'),
    readFileSync(join(root, 'infra', 'terraform', 'environments', 'render', 'main.tf'), 'utf8'),
    readFileSync(join(root, 'infra', 'terraform', 'environments', 'aws', 'main.tf'), 'utf8'),
    readFileSync(join(root, 'docs', 'activation-gates.md'), 'utf8'),
  ].join('\n').toLowerCase()

  for (const required of [
    'mercadopago',
    'whatsapp',
    'aws',
    'render',
    'cloud',
    'legal',
    'tax',
    'kyc',
    'kyb',
    'postgresql',
    'browser',
    'device',
    'pospilot',
    'productionoperations',
    'owner',
    'expiresat',
    'revoked',
    'drain',
    'quarantine',
    'global-launch',
    'no live authorization',
  ]) {
    assert.match(content, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required)
  }
})

test('operational readiness docs define stop, drain, quarantine, retry, and rollback boundaries', () => {
  const documents = [
    readFileSync(join(root, 'docs', 'deployment', 'tus-readiness.md'), 'utf8'),
    readFileSync(join(root, 'docs', 'runbooks', 'tus-deployment.md'), 'utf8'),
    readFileSync(join(root, 'docs', 'runbooks', 'migration-rollback.md'), 'utf8'),
    readFileSync(join(root, 'docs', 'runbooks', 'job-replay.md'), 'utf8'),
  ].join('\n').toLowerCase()

  for (const required of [
    'stop intake',
    'drain',
    'quarantine',
    'retry',
    'rollback',
    'preserve',
    'append-only',
    'not-production-ready',
  ]) {
    assert.match(documents, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required)
  }
})

test('readiness matrix is complete and does not publish a stronger status than its evidence', () => {
  const { matrix, nativeSmoke } = readEvidenceDocuments()
  const documents = `${matrix}\n${nativeSmoke}`

  for (const required of [
    'command or artifact',
    'execution environment',
    'revision/date',
    'owner',
    'scope',
    'status',
    'evidence class',
    'local-deterministic',
    'local-postgresql-http',
    'authorized-external',
    'deferred',
    'postgresql',
    'provider',
    'cloud',
    'browser',
    'device',
    'legal',
    'pos pilot',
    'not-production-ready',
    'global-launch',
    'financing-credit',
  ]) {
    assert.match(matrix, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), required)
  }

  assert.doesNotMatch(matrix, /status:\s*production-ready/i)
  assert.doesNotMatch(matrix, /liveConformance:\s*true/i)

  assert.match(documents, /pnpm test[^\n]*exit 0[^\n]*498 passed, 0 failed, 0 skipped/i)
  assert.match(documents, /498 passed, 0 failed, 0 skipped across 88 isolated suites/i)
  assert.doesNotMatch(matrix, /pnpm test[^\n]*(?:440 passed|29\/29)/i)
  assert.doesNotMatch(nativeSmoke, /(?:full tests|pnpm test)[^\n]*(?:440 passed|29\/29)/i)
  assert.doesNotMatch(nativeSmoke, /secret scan[^\n]*blocked/i)
  assert.match(nativeSmoke, /superseded[\s\S]*29\/29/i)

  for (const required of [
    'local-deterministic',
    'deferred',
    'postgresql',
    'provider',
    'cloud',
    'browser',
    'device',
    'pos pilot',
    'compliance',
    'production operations',
    'not-production-ready',
    'unavailable-deferred',
    'liveconformance: false',
  ]) {
    assert.match(documents.toLowerCase(), new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required)
  }

  assert.match(matrix, /No row below authorizes a provider, cloud resource, browser\/device release, POS pilot, legal operation, or production traffic/i)
  assert.match(nativeSmoke, /not\s+production-readiness/i)
  assert.match(matrix, /98 JSON Schema contracts validated/i)
  assert.match(nativeSmoke, /98 JSON Schema contracts validated/i)
  assert.match(nativeSmoke, /local-postgresql-http[\s\S]*deferred/i)
  assert.match(matrix, /pnpm test[^\n]*exit 0[^\n]*498 passed, 0 failed, 0 skipped across 88 isolated suites/i)
  assert.match(nativeSmoke, /pnpm test[^\n]*exit 0[^\n]*498 passed, 0 failed, 0 skipped across 88 isolated suites/i)

  for (const currentReceipt of [matrix.split('## Argentina-first boundaries and non-goals')[0], nativeSmoke.split('## Superseded history')[0]]) {
    assert.doesNotMatch(currentReceipt, /(?:pnpm test|full deterministic suite)[^\n]*(?:361|435|440|29\/29)/i)
  }
  assert.doesNotMatch(matrix, /pnpm contracts:validate[^\n]*(?:81 schemas|81 contracts)/i)
  assert.doesNotMatch(nativeSmoke, /pnpm contracts:validate[^\n]*(?:81 schemas|81 contracts)/i)

  for (const claim of [
    /pnpm contracts:validate[^\n]*exit 0[^\n]*(?:98 schemas|98 JSON Schema contracts)/i,
    /pnpm (?:run )?security:scan[^\n]*exit 0[^\n]*no tracked-secret findings/i,
    /validate-policy\.mjs[^\n]*exit 0/i,
    /pnpm build[^\n]*exit 0/i,
    /pnpm typecheck[^\n]*exit 0/i,
    /pnpm lint[^\n]*exit 1/i,
    /cloud-native[^\n]*exit 0[^\n]*plan-only/i,
    /tus-readiness\.mjs (?:render-native|aws-terraform)[\s\S]*not-production-ready/i,
  ]) {
    assert.match(matrix, claim)
  }

  assert.doesNotMatch(matrix, /status:\s*`?production-ready`?/i)
  assert.match(matrix, /activation switches remain disabled:[\s\S]*tusRoutes[\s\S]*providers[\s\S]*releaseJobs[\s\S]*fleetJobs/i)
})
