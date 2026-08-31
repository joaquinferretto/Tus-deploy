import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  APPROVED_POSTGRES_ENV_VARS,
  REQUIRED_SCHEMA_COLUMNS,
  buildPostgresChildEnvironment,
  cleanupSmokeFixture,
  createSmokeFixture,
  resolvePostgresTarget,
  resolvePostgresSmokeEvidence,
  runTusPostgresHttpSmoke,
  stopSmokeApi,
} from '../../../scripts/test-runner-lib.mjs'

test('PostgreSQL target resolution uses only approved variables and prefers TUS_POSTGRES_URL', () => {
  const secretUrl = 'postgresql://smoke-user:super-secret@db.example.test/tus?sslmode=require&token=do-not-report'
  const target = resolvePostgresTarget({
    TUS_POSTGRES_URL: secretUrl,
    DATABASE_URL: 'postgresql://fallback:secret@fallback.example.test/tus?sslmode=require',
    TUS_POSTGRES_DISPOSABLE: '1',
    TUS_POSTGRES_TARGET_ID: 'tus-test-001',
    TUS_POSTGRES_PROFILE: 'test-disposable',
    UNAPPROVED_SECRET: 'must-not-be-read',
  })

  assert.equal(target.status, 'ready')
  assert.equal(target.source, 'TUS_POSTGRES_URL')
  assert.equal(target.targetId, 'tus-test-001')
  assert.equal(target.profile, 'test-disposable')
  assert.equal(target.environment, 'test')
  assert.equal(target.runtimeRole, 'validation-runner')
  assert.equal(target.service, 'tus-postgres-http-smoke')
  assert.equal(target.providerMode, 'provider-free')
  assert.equal(target.databaseMode, 'postgresql-disposable-only')
  assert.equal(target.productionSecretStore, 'not-used')
  assert.equal(target.redactedTarget, 'postgresql://<redacted-host>/<redacted-database>')
  assert.equal(JSON.stringify(target).includes('super-secret'), false)
  assert.equal(JSON.stringify(target).includes('do-not-report'), false)
  assert.deepEqual(APPROVED_POSTGRES_ENV_VARS, [
    'TUS_POSTGRES_URL',
    'DATABASE_URL',
    'TUS_POSTGRES_DISPOSABLE',
    'TUS_POSTGRES_TARGET_ID',
    'TUS_POSTGRES_PROFILE',
  ])
})

test('missing PostgreSQL target is classified deterministically without filesystem dotenv discovery', () => {
  const target = resolvePostgresTarget({
    TUS_POSTGRES_URL: '   ',
    DATABASE_URL: '',
    DATABASE_URL_FILE: 'postgresql://must-not-be-discovered',
    TUS_POSTGRES_APPLY_MIGRATIONS: '1',
  })

  assert.deepEqual(target, {
    status: 'no-target',
    source: null,
    redactedTarget: null,
    targetId: null,
    profile: null,
    environment: 'local',
    runtimeRole: 'validation-runner',
    service: 'tus-postgres-http-smoke',
    providerMode: 'provider-free',
    databaseMode: 'postgresql-disposable-only',
    productionSecretStore: 'not-used',
    reason: 'no-approved-postgresql-target',
    owner: 'runtime owner',
    rerunCommand: 'TUS_POSTGRES_URL=<authorized-disposable-postgres-url> TUS_POSTGRES_DISPOSABLE=1 TUS_POSTGRES_TARGET_ID=<unique-disposable-target-id> TUS_POSTGRES_PROFILE=<local-disposable|test-disposable> pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs',
  })
})

test('malformed or non-PostgreSQL targets are invalid and never echoed', () => {
  for (const postgresUrl of [
    'https://not-postgres.example.test/?password=secret-token',
    'postgresql://bad host/tus',
  ]) {
    const target = resolvePostgresTarget({
      TUS_POSTGRES_URL: postgresUrl,
      TUS_POSTGRES_DISPOSABLE: '1',
      TUS_POSTGRES_TARGET_ID: 'tus-test-invalid',
      TUS_POSTGRES_PROFILE: 'test-disposable',
    })

    assert.equal(target.status, 'invalid-target')
    assert.equal(target.reason, 'invalid-postgresql-url')
    assert.equal(target.redactedTarget, null)
    assert.equal(JSON.stringify(target).includes('secret-token'), false)
    assert.equal(JSON.stringify(target).includes(postgresUrl), false)
  }
})

test('valid syntax without a proven disposable TLS boundary is unsafe', () => {
  const cases = [
    {
      environment: {
        TUS_POSTGRES_URL: 'postgresql://user:secret@db.example.test/tus?sslmode=require',
        TUS_POSTGRES_PROFILE: 'test-disposable',
        TUS_POSTGRES_TARGET_ID: 'tus-test-unsafe',
      },
      reason: 'disposable-proof-required',
    },
    {
      environment: {
        TUS_POSTGRES_URL: 'postgresql://user:secret@db.example.test/tus?sslmode=disable',
        TUS_POSTGRES_DISPOSABLE: '1',
        TUS_POSTGRES_PROFILE: 'test-disposable',
        TUS_POSTGRES_TARGET_ID: 'tus-test-no-tls',
      },
      reason: 'tls-required',
    },
    {
      environment: {
        TUS_POSTGRES_URL: 'postgresql://user:secret@production-db.example.test/tus?sslmode=require',
        TUS_POSTGRES_DISPOSABLE: '1',
        TUS_POSTGRES_PROFILE: 'production',
        TUS_POSTGRES_TARGET_ID: 'production-db',
      },
      reason: 'non-production-profile-required',
    },
  ]

  for (const { environment, reason } of cases) {
    const target = resolvePostgresTarget(environment)
    assert.equal(target.status, 'unsafe-target')
    assert.equal(target.reason, reason)
    assert.equal(target.redactedTarget, 'postgresql://<redacted-host>/<redacted-database>')
    assert.equal(JSON.stringify(target).includes('secret'), false)
  }
})

test('unsafe target is denied before Prisma, connection, migration, or fixture operations', async () => {
  const calls = []
  const evidence = await runTusPostgresHttpSmoke({
    applyMigrations: true,
    environment: {
      TUS_POSTGRES_URL: 'postgresql://user:secret@shared-db.example.test/tus?sslmode=require',
      TUS_POSTGRES_DISPOSABLE: '1',
      TUS_POSTGRES_PROFILE: 'test-disposable',
      TUS_POSTGRES_TARGET_ID: 'tus-test-shared',
    },
    operations: {
      validatePrismaSchema: async () => calls.push('schema'),
      deployPrismaMigrations: async () => calls.push('migration'),
      connectSmokePool: async () => calls.push('connection'),
      createSmokeFixture: () => calls.push('fixture'),
    },
  })

  assert.equal(evidence.status, 'deferred')
  assert.equal(evidence.unavailableBoundary, 'PostgreSQL target safety')
  assert.equal(evidence.target.status, 'unsafe-target')
  assert.deepEqual(calls, [])
  assert.equal(evidence.liveConformance, false)
  assert.equal(JSON.stringify(evidence).includes('secret'), false)
})

test('child process environment passes only the explicit PostgreSQL target and safe runtime values', () => {
  const environment = buildPostgresChildEnvironment({
    postgresUrl: 'postgresql://user:secret@db.example.test/tus?sslmode=require',
    baseEnvironment: {
      PATH: 'safe-path',
      SystemRoot: 'C:\\Windows',
      AWS_SECRET_ACCESS_KEY: 'must-not-pass',
      DATABASE_URL: 'stale-url',
      TUS_POSTGRES_URL: 'must-not-pass',
    },
    extra: { API_PORT: '4310', AWS_SECRET_ACCESS_KEY: 'must-not-pass' },
  })

  assert.equal(environment.DATABASE_URL, 'postgresql://user:secret@db.example.test/tus?sslmode=require')
  assert.equal(environment.PATH, 'safe-path')
  assert.equal(environment.SystemRoot, 'C:\\Windows')
  assert.equal('AWS_SECRET_ACCESS_KEY' in environment, false)
  assert.equal('TUS_POSTGRES_URL' in environment, false)
  assert.equal(environment.API_PORT, '4310')
  assert.equal(Object.keys(environment).includes('DATABASE_URL'), true)
})

test('PostgreSQL HTTP smoke is an explicit opt-in boundary, never a fake local pass', () => {
  const evidence = resolvePostgresSmokeEvidence({ environment: {} })
  const { scenarios: _scenarios, ...coreEvidence } = evidence
  assert.deepEqual(coreEvidence, {
    status: 'deferred',
    evidenceClass: 'local-postgresql-http',
    execution: 'local-verification',
    liveConformance: false,
    reason: 'no-approved-postgresql-target',
    unavailableBoundary: 'PostgreSQL target safety',
    actions: {
      connections: 0,
      migrations: 0,
      queries: 0,
      fixtures: 0,
      providerCalls: 0,
    },
    target: {
      status: 'no-target',
      source: null,
      redactedTarget: null,
      targetId: null,
      profile: null,
      environment: 'local',
      runtimeRole: 'validation-runner',
      service: 'tus-postgres-http-smoke',
      providerMode: 'provider-free',
      databaseMode: 'postgresql-disposable-only',
      productionSecretStore: 'not-used',
      reason: 'no-approved-postgresql-target',
      owner: 'runtime owner',
      rerunCommand: 'TUS_POSTGRES_URL=<authorized-disposable-postgres-url> TUS_POSTGRES_DISPOSABLE=1 TUS_POSTGRES_TARGET_ID=<unique-disposable-target-id> TUS_POSTGRES_PROFILE=<local-disposable|test-disposable> pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs',
    },
    rerunCommand: 'TUS_POSTGRES_URL=<authorized-disposable-postgres-url> TUS_POSTGRES_DISPOSABLE=1 TUS_POSTGRES_TARGET_ID=<unique-disposable-target-id> TUS_POSTGRES_PROFILE=<local-disposable|test-disposable> pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs',
  })
  assert.equal(evidence.scenarios.authenticatedHttp.status, 'deferred')
  assert.equal(evidence.scenarios.restartReplay.status, 'deferred')
  assert.equal(evidence.scenarios.crossTenantIsolation.status, 'deferred')
  assert.equal(evidence.scenarios.rollback.status, 'deferred')
})

test('PostgreSQL HTTP orchestration is deterministically deferred without an authorized URL', async () => {
  const evidence = await runTusPostgresHttpSmoke({ postgresUrl: '' })

  assert.equal(evidence.status, 'deferred')
  assert.equal(evidence.evidenceClass, 'local-postgresql-http')
  assert.equal(evidence.execution, 'local-verification')
  assert.equal(evidence.liveConformance, false)
  assert.equal(evidence.reason, 'no-approved-postgresql-target')
  assert.match(evidence.rerunCommand, /TUS_POSTGRES_URL=<authorized-disposable-postgres-url>/)
  assert.equal(evidence.scenarios.authenticatedHttp.status, 'deferred')
  assert.equal(evidence.scenarios.restartReplay.status, 'deferred')
  assert.equal(evidence.scenarios.crossTenantIsolation.status, 'deferred')
  assert.equal(evidence.scenarios.rollback.status, 'deferred')
})

test('deferred PostgreSQL evidence records zero side effects across every gated boundary', async () => {
  const evidence = await runTusPostgresHttpSmoke({ postgresUrl: '' })

  assert.deepEqual(evidence.actions, {
    connections: 0,
    migrations: 0,
    queries: 0,
    fixtures: 0,
    providerCalls: 0,
  })
})

test('schema gate covers the durable pilot aggregates and tenant-scoped identity columns', () => {
  assert.deepEqual(REQUIRED_SCHEMA_COLUMNS.TusPosOperation, [
    'tenantId', 'operationId', 'idempotencyKey', 'shiftId', 'response',
  ])
  assert.deepEqual(REQUIRED_SCHEMA_COLUMNS.TusDeliveryTask, [
    'tenantId', 'taskId', 'commitmentId', 'version', 'settlementClaim',
  ])
  assert.deepEqual(REQUIRED_SCHEMA_COLUMNS.TusReadinessEvidence, [
    'profile', 'execution', 'evidenceClass', 'liveConformance',
  ])
  assert.equal(Object.hasOwn(REQUIRED_SCHEMA_COLUMNS, 'TusPosVersion'), true)
  assert.equal(Object.hasOwn(REQUIRED_SCHEMA_COLUMNS, 'TusPosReceipt'), true)
  assert.equal(Object.hasOwn(REQUIRED_SCHEMA_COLUMNS, 'TusPosAudit'), true)
  assert.equal(Object.hasOwn(REQUIRED_SCHEMA_COLUMNS, 'TusPosOutbox'), true)
})

test('disposable pilot fixtures are unique and carry only scoped identifiers', () => {
  const first = createSmokeFixture()
  const second = createSmokeFixture()

  assert.notEqual(first.runId, second.runId)
  assert.notEqual(first.tenantA, second.tenantA)
  assert.notEqual(first.productListingId, second.productListingId)
  assert.match(first.tenantA, new RegExp(`^tus-smoke-a-${first.runId}$`))
  assert.match(first.posDeviceId, new RegExp(`^tus-smoke-pos-device-${first.runId}$`))
  assert.match(first.deliveryTaskId, new RegExp(`^tus-smoke-delivery-task-${first.runId}$`))
  assert.match(first.emailA, new RegExp(`^tus-smoke-a-${first.runId}@example\\.invalid$`))
})

test('PR2 deferred evidence preserves every durable POS journey boundary without claiming a pilot', async () => {
  const evidence = await runTusPostgresHttpSmoke({ postgresUrl: '' })
  const expectedScenarioKeys = [
    'authenticatedHttp',
    'deviceSession',
    'productPos',
    'servicePos',
    'offlineReplay',
    'versionConflict',
    'receiptIntegrity',
    'deliveryHandoff',
    'auditOutbox',
    'restartReplay',
    'crossTenantIsolation',
    'cleanup',
    'rollback',
    'providerNonInteraction',
  ]

  assert.deepEqual(Object.keys(evidence.scenarios).sort(), expectedScenarioKeys.sort())
  assert.equal(Object.values(evidence.scenarios).every(({ status }) => status === 'deferred'), true)
  assert.equal(evidence.liveConformance, false)
  assert.equal(evidence.execution, 'local-verification')
})

test('PR2 preserves the startup classification when targeted cleanup also fails', async () => {
  const evidence = await runTusPostgresHttpSmoke({
    environment: {
      TUS_POSTGRES_URL: 'postgresql://user:secret@db.example.test/tus?sslmode=require',
      TUS_POSTGRES_DISPOSABLE: '1',
      TUS_POSTGRES_TARGET_ID: 'tus-test-cleanup',
      TUS_POSTGRES_PROFILE: 'test-disposable',
    },
    operations: {
      validatePrismaSchema: async () => undefined,
      connectSmokePool: async () => ({ query: async () => ({ rows: [] }), end: async () => undefined }),
      validateDatabaseSchema: async () => undefined,
      createSmokeFixture: () => ({ runId: 'cleanup-failure', tenantA: 'tus-cleanup-a', tenantB: 'tus-cleanup-b' }),
      startSmokeApi: async () => { throw new Error('API startup failed') },
      cleanupSmokeFixture: async () => { throw new Error('cleanup failed') },
    },
  })

  assert.equal(evidence.status, 'deferred')
  assert.match(evidence.reason, /could not complete safely|startup/i)
  assert.equal(evidence.liveConformance, false)
  assert.equal(evidence.scenarios.cleanup.status, 'failed')
  assert.equal(evidence.scenarios.rollback.status, 'deferred')
  assert.equal(evidence.failure.classification, 'unavailable')
  assert.equal(evidence.failure.boundary, 'API runtime startup')
  assert.equal(evidence.cleanupFailure.classification, 'cleanup-failure')
  assert.equal(evidence.cleanupFailure.owner, 'runtime owner')
})

test('PR3 cleanup targets only generated mutable fixtures and preserves durable evidence tables', async () => {
  const statements = []
  const pool = {
    query: async (text, parameters) => {
      statements.push({ text, parameters })
      return { rows: [] }
    },
  }
  const fixture = createSmokeFixture()

  await cleanupSmokeFixture(pool, fixture, {
    status: 'ready',
    targetId: 'tus-test-cleanup',
    profile: 'test-disposable',
  })

  const sql = statements.map(({ text }) => text).join('\n')
  assert.equal(sql.includes('DELETE FROM "TusPosAudit"'), false)
  assert.equal(sql.includes('DELETE FROM "TusPosOutbox"'), false)
  assert.equal(sql.includes('DELETE FROM "TusPosReceipt"'), false)
  assert.equal(sql.includes('DELETE FROM "TusPosOperation"'), false)
  assert.equal(sql.includes('DELETE FROM "TusDeliveryAudit"'), false)
  assert.equal(sql.includes('DELETE FROM "TusDeliveryOutbox"'), false)
  assert.equal(sql.includes('DELETE FROM "OutboxEvent"'), false)
  assert.equal(sql.includes('DELETE FROM "TusMerchant" WHERE "id" IN'), true)
  assert.equal(sql.includes('DELETE FROM "TusListing" WHERE "id" IN'), true)
  assert.equal(statements.some(({ parameters = [] }) => parameters.includes(fixture.tenantA)), false)
  assert.equal(statements.some(({ parameters = [] }) => parameters.includes(fixture.productMerchantId)), true)
})

test('cleanup refuses without an approved disposable target and performs zero SQL side effects', async () => {
  const statements = []
  const pool = { query: async (text) => { statements.push(text); return { rows: [] } } }
  await assert.rejects(cleanupSmokeFixture(pool, createSmokeFixture()), /approved disposable target/)
  assert.deepEqual(statements, [])
})

test('PR3 awaits a child process shutdown and does not leave a live API child behind', async () => {
  const events = []
  const child = {
    exitCode: null,
    once: (_event, callback) => { events.push('wait'); setImmediate(() => { child.exitCode = 0; callback(0, 'SIGTERM') }) },
    kill: (signal) => events.push(`kill:${signal}`),
  }

  await stopSmokeApi({ child })

  assert.deepEqual(events, ['wait', 'kill:SIGTERM'])
  assert.equal(child.exitCode, 0)
})

test('PR3 classifies startup timeouts separately and still closes the PostgreSQL pool', async () => {
  let poolClosed = false
  const evidence = await runTusPostgresHttpSmoke({
    environment: {
      TUS_POSTGRES_URL: 'postgresql://user:secret@db.example.test/tus?sslmode=require',
      TUS_POSTGRES_DISPOSABLE: '1',
      TUS_POSTGRES_TARGET_ID: 'tus-test-timeout',
      TUS_POSTGRES_PROFILE: 'test-disposable',
    },
    operations: {
      validatePrismaSchema: async () => undefined,
      connectSmokePool: async () => ({ query: async () => ({ rows: [] }), end: async () => { poolClosed = true } }),
      validateDatabaseSchema: async () => undefined,
      createSmokeFixture,
      startSmokeApi: async () => { throw new Error('API startup timed out') },
    },
  })

  assert.equal(evidence.status, 'deferred')
  assert.equal(evidence.failure.classification, 'timeout')
  assert.equal(evidence.failure.boundary, 'API runtime startup')
  assert.equal(evidence.scenarios.cleanup.status, 'passed')
  assert.equal(poolClosed, true)
})

test('configured PostgreSQL evidence remains pending until the real harness connects', () => {
  assert.equal(resolvePostgresSmokeEvidence({
    environment: {
      TUS_POSTGRES_URL: 'postgresql://127.0.0.1:5432/tus?sslmode=require',
      TUS_POSTGRES_DISPOSABLE: '1',
      TUS_POSTGRES_TARGET_ID: 'tus-local-001',
      TUS_POSTGRES_PROFILE: 'local-disposable',
    },
  }).target.status, 'ready')
  assert.deepEqual(resolvePostgresSmokeEvidence({
    environment: {
      TUS_POSTGRES_URL: 'postgresql://127.0.0.1:5432/tus?sslmode=require',
      TUS_POSTGRES_DISPOSABLE: '1',
      TUS_POSTGRES_TARGET_ID: 'tus-local-001',
      TUS_POSTGRES_PROFILE: 'local-disposable',
    },
  }), {
    status: 'ready-to-run',
    evidenceClass: 'local-postgresql-http',
    liveConformance: false,
    target: {
      status: 'ready',
      source: 'TUS_POSTGRES_URL',
      redactedTarget: 'postgresql://<redacted-host>/<redacted-database>',
      targetId: 'tus-local-001',
      profile: 'local-disposable',
      environment: 'local',
      runtimeRole: 'validation-runner',
      service: 'tus-postgres-http-smoke',
      providerMode: 'provider-free',
      databaseMode: 'postgresql-disposable-only',
      productionSecretStore: 'not-used',
      reason: 'authorized-disposable-target',
      owner: 'runtime owner',
      rerunCommand: 'TUS_POSTGRES_URL=<authorized-disposable-postgres-url> TUS_POSTGRES_DISPOSABLE=1 TUS_POSTGRES_TARGET_ID=<unique-disposable-target-id> TUS_POSTGRES_PROFILE=<local-disposable|test-disposable> pnpm test -- tests/integration/tus/postgres-http-smoke.test.mjs',
    },
    reason: 'A PostgreSQL URL is available; the authenticated restart/replay harness must be run explicitly',
  })
})

test('DATABASE_URL is the approved fallback when TUS_POSTGRES_URL is absent', () => {
  const target = resolvePostgresTarget({
    DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5432/tus?sslmode=require',
    TUS_POSTGRES_DISPOSABLE: '1',
    TUS_POSTGRES_TARGET_ID: 'tus-local-fallback',
    TUS_POSTGRES_PROFILE: 'local-disposable',
  })

  assert.equal(target.status, 'ready')
  assert.equal(target.source, 'DATABASE_URL')
  assert.equal(target.redactedTarget, 'postgresql://<redacted-host>/<redacted-database>')
  assert.equal(JSON.stringify(target).includes('secret'), false)
})

test('invalid PostgreSQL configuration is deferred without attempting a transport', async () => {
  const evidence = await runTusPostgresHttpSmoke({ postgresUrl: 'https://not-postgres.example.invalid' })

  assert.equal(evidence.status, 'deferred')
  assert.equal(evidence.evidenceClass, 'local-postgresql-http')
  assert.equal(evidence.liveConformance, false)
  assert.equal(evidence.unavailableBoundary, 'PostgreSQL target safety')
  assert.equal(evidence.reason, 'invalid-postgresql-url')
})

test('configured smoke reports only truthful local PostgreSQL evidence', async () => {
  if (!process.env['TUS_POSTGRES_URL'] && !process.env['DATABASE_URL']) return

  const evidence = await runTusPostgresHttpSmoke()

  assert.ok(['passed', 'deferred'].includes(evidence.status))
  assert.equal(evidence.evidenceClass, 'local-postgresql-http')
  assert.equal(evidence.liveConformance, false)
  if (evidence.status === 'passed') {
    assert.equal(evidence.execution, 'local-verification')
    assert.equal(evidence.scenarios.restartReplay.status, 'passed')
    assert.equal(evidence.scenarios.crossTenantIsolation.status, 'passed')
    assert.equal(evidence.scenarios.rollback.status, 'passed')
  }
})
