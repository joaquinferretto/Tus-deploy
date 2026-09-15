import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  APPROVED_POSTGRES_ENV_VARS,
  REQUIRED_SCHEMA_COLUMNS,
  POSTGRES_SEED_CONFIRMATION_FLAG,
  buildPostgresChildEnvironment,
  cleanupSmokeFixture,
  createSmokeFixture,
  resolvePostgresSmokeEvidence,
  resolvePostgresTarget,
  runTusPostgresHttpSmoke,
  stopSmokeApi,
} from '../../../scripts/test-runner-lib.mjs'

const ROOT_URL_SECRET = 'postgresql://root-user:root-secret@127.0.0.1:5432/tus?sslmode=require'

async function withRootEnv(contents, callback) {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'tus-postgres-smoke-'))
  await writeFile(join(rootDirectory, '.env'), contents, 'utf8')
  try {
    return await callback(rootDirectory)
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
}

const localEnv = 'DATABASE_URL="' + ROOT_URL_SECRET + '"\nFACTORY_PROFILE=local\nNODE_ENV=development\n'

test('PostgreSQL target uses only root DATABASE_URL and ignores alternate URL variables', async () => {
  await withRootEnv(localEnv, async (rootDirectory) => {
    const target = resolvePostgresTarget({
      rootDirectory,
      environment: {
        DATABASE_URL: 'postgresql://ambient:ambient-secret@shared.example.test/tus?sslmode=require',
        TUS_POSTGRES_URL: 'postgresql://legacy:legacy-secret@shared.example.test/tus?sslmode=require',
        NODE_ENV: 'development',
        FACTORY_PROFILE: 'local',
      },
    })

    assert.equal(target.status, 'ready')
    assert.equal(target.source, 'root-dotenv-DATABASE_URL')
    assert.equal(target.environment, 'local')
    assert.equal(target.redactedTarget, 'postgresql://<redacted-host>/<redacted-database>')
    assert.deepEqual(APPROVED_POSTGRES_ENV_VARS, ['DATABASE_URL'])
    assert.doesNotMatch(JSON.stringify(target), /root-secret|ambient-secret|legacy-secret/u)
  })
})

test('the authorized seed command is explicit and development-only', () => {
  assert.equal(POSTGRES_SEED_CONFIRMATION_FLAG, '--confirm-development-target')
  assert.equal('NODE_ENV=development node scripts/postgres-seed.mjs seed --confirm-development-target'.includes('DATABASE_URL'), false)
})

test('missing root DATABASE_URL is deferred without ambient dotenv discovery', async () => {
  await withRootEnv('FACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const target = resolvePostgresTarget({
      rootDirectory,
      environment: {
        DATABASE_URL: 'postgresql://ambient:must-not-read@localhost/tus',
        DATABASE_URL_FILE: 'postgresql://file:must-not-read@localhost/tus',
      },
    })

    assert.equal(target.status, 'deferred')
    assert.equal(target.source, null)
    assert.equal(target.reason, 'no-database-url')
    assert.doesNotMatch(JSON.stringify(target), /must-not-read|postgresql:\/\//u)
  })
})

test('production NODE_ENV or FACTORY_PROFILE is refused before transport', async () => {
  await withRootEnv(localEnv, async (rootDirectory) => {
    for (const environment of [
      { NODE_ENV: 'production', FACTORY_PROFILE: 'local' },
      { NODE_ENV: 'development', FACTORY_PROFILE: 'production' },
      { NODE_ENV: 'development', FACTORY_PROFILE: 'render' },
    ]) {
      const target = resolvePostgresTarget({ rootDirectory, environment })
      assert.equal(target.status, 'invalid')
      assert.equal(target.reason, 'production-target-refused')
    }
  })
})

test('HTTP harness refuses a remote development target without explicit confirmation before transport', async () => {
  await withRootEnv('DATABASE_URL=postgresql://free-tier-user:free-tier-secret@db.example.test/tus?sslmode=require\n', async (rootDirectory) => {
    const calls = []
    const evidence = await runTusPostgresHttpSmoke({
      rootDirectory,
      environment: { NODE_ENV: 'development' },
      operations: {
        validatePrismaSchema: async () => calls.push('schema'),
        connectSmokePool: async () => calls.push('connection'),
      },
    })

    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.reason, 'non-production-target-unproven')
    assert.equal(evidence.target.classification, 'remote-development-unattested')
    assert.deepEqual(calls, [])
    assert.doesNotMatch(JSON.stringify(evidence), /free-tier-user|free-tier-secret|db\.example\.test/u)
  })
})

test('explicit development confirmation reaches the HTTP harness root target resolver', async () => {
  await withRootEnv('DATABASE_URL=postgresql://free-tier-user:free-tier-secret@db.example.test/tus?sslmode=require\n', async (rootDirectory) => {
    let validatedUrl = null
    const evidence = await runTusPostgresHttpSmoke({
      rootDirectory,
      environment: { NODE_ENV: 'development' },
      confirmed: true,
      operations: {
        validatePrismaSchema: async (postgresUrl) => {
          validatedUrl = postgresUrl
          throw new Error('stop before PostgreSQL transport')
        },
      },
    })

    assert.equal(validatedUrl, 'postgresql://free-tier-user:free-tier-secret@db.example.test/tus?sslmode=require')
    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.target.classification, 'remote-development-attested')
    assert.equal(evidence.target.proof.attestation, 'operator-confirmed')
    assert.doesNotMatch(JSON.stringify(evidence), /free-tier-user|free-tier-secret|db\.example\.test/u)
  })
})

test('missing non-production profile is deferred and never treated as safe by URL syntax', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\n', async (rootDirectory) => {
    const target = resolvePostgresTarget({ rootDirectory, environment: {} })
    assert.equal(target.status, 'invalid')
    assert.equal(target.reason, 'non-production-profile-required')
    assert.equal(target.redactedTarget, 'postgresql://<redacted-host>/<redacted-database>')
  })
})

test('malformed PostgreSQL targets are invalid and never echoed', async () => {
  await withRootEnv('DATABASE_URL=https://not-postgres.example.test/?password=secret-token\nFACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const target = resolvePostgresTarget({ rootDirectory, environment: {} })
    assert.equal(target.status, 'invalid')
    assert.equal(target.reason, 'invalid-postgresql-url')
    assert.doesNotMatch(JSON.stringify(target), /secret-token|https:\/\//u)
  })
})

test('unsafe target is denied before schema, migration, connection, or fixture operations', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\nFACTORY_PROFILE=production\nNODE_ENV=production\n', async (rootDirectory) => {
    const calls = []
    const evidence = await runTusPostgresHttpSmoke({
      rootDirectory,
      applyMigrations: true,
      operations: {
        validatePrismaSchema: async () => calls.push('schema'),
        deployPrismaMigrations: async () => calls.push('migration'),
        connectSmokePool: async () => calls.push('connection'),
        createSmokeFixture: () => calls.push('fixture'),
      },
    })

    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.unavailableBoundary, 'PostgreSQL target safety')
    assert.deepEqual(calls, [])
    assert.equal(evidence.liveConformance, false)
  })
})

test('child process receives only the canonical DATABASE_URL and safe runtime values', () => {
  const environment = buildPostgresChildEnvironment({
    postgresUrl: 'postgresql://user:secret@db.example.test/tus?sslmode=require',
    baseEnvironment: {
      PATH: 'safe-path',
      SystemRoot: 'C:\\Windows',
      AWS_SECRET_ACCESS_KEY: 'must-not-pass',
      DATABASE_URL: 'stale-url',
      TUS_POSTGRES_URL: 'must-not-pass',
    },
    extra: { API_PORT: '4310', TUS_ROUTES_ENABLED: 'true', TUS_PROVIDER_ACTIONS_ENABLED: 'false', AWS_SECRET_ACCESS_KEY: 'must-not-pass' },
  })

  assert.equal(environment.DATABASE_URL, 'postgresql://user:secret@db.example.test/tus?sslmode=require')
  assert.equal(environment.PATH, 'safe-path')
  assert.equal('AWS_SECRET_ACCESS_KEY' in environment, false)
  assert.equal('TUS_POSTGRES_URL' in environment, false)
  assert.equal(environment.API_PORT, '4310')
  assert.equal(environment.TUS_ROUTES_ENABLED, 'true')
  assert.equal(environment.TUS_PROVIDER_ACTIONS_ENABLED, 'false')
})

test('PostgreSQL HTTP evidence is deferred without a root target and never claims production conformance', async () => {
  await withRootEnv('FACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const evidence = resolvePostgresSmokeEvidence({ rootDirectory, environment: {} })
    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.evidenceClass, 'local-postgresql-http')
    assert.equal(evidence.liveConformance, false)
    assert.equal(evidence.reason, 'no-database-url')
    assert.equal(evidence.scenarios.authenticatedHttp.status, 'deferred')
  })
})

test('deferred PostgreSQL orchestration records zero database side effects', async () => {
  await withRootEnv('FACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const evidence = await runTusPostgresHttpSmoke({ rootDirectory, environment: {} })
    assert.deepEqual(evidence.actions, {
      connections: 0,
      migrations: 0,
      queries: 0,
      fixtures: 0,
      providerCalls: 0,
    })
  })
})

test('the real database migration remains forward-only and excludes destructive data cleanup', async () => {
  const { readFile } = await import('node:fs/promises')
  const migration = await readFile(new URL('../../../apps/api/prisma/migrations/20260831170000_tus_real_db_runtime_audit/migration.sql', import.meta.url), 'utf8')
  const schema = await readFile(new URL('../../../apps/api/prisma/schema.prisma', import.meta.url), 'utf8')

  assert.match(migration, /CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ADD CONSTRAINT/u)
  assert.doesNotMatch(migration, /\b(?:TRUNCATE|DROP TABLE|CASCADE DELETE|DELETE FROM)\b/iu)
  assert.match(migration, /TusHardeningFixture_tag_version_runId_key/u)
  assert.match(schema, /model TusHardeningFixture[\s\S]*@@unique\(\[tag, version, runId\]\)[\s\S]*@@index\(\[tenantId, tag, version\]\)/u)
})

test('schema gate covers durable tenant-scoped POS and delivery structures', () => {
  assert.deepEqual(REQUIRED_SCHEMA_COLUMNS.operaciones_pos, ['tenant_id', 'operacion_id', 'clave_idempotencia', 'turno_id', 'respuesta'])
  assert.deepEqual(REQUIRED_SCHEMA_COLUMNS.tareas_entrega, ['tenant_id', 'tarea_id', 'compromiso_id', 'version', 'reclamo_liquidacion'])
  assert.equal(Object.hasOwn(REQUIRED_SCHEMA_COLUMNS, 'versiones_pos'), true)
  assert.equal(Object.hasOwn(REQUIRED_SCHEMA_COLUMNS, 'comprobantes_pos'), true)
  assert.equal(Object.hasOwn(REQUIRED_SCHEMA_COLUMNS, 'auditoria_pos'), true)
  assert.equal(Object.hasOwn(REQUIRED_SCHEMA_COLUMNS, 'outbox_pos'), true)
})

test('generated smoke fixtures are unique and namespaced', () => {
  const first = createSmokeFixture()
  const second = createSmokeFixture()
  assert.notEqual(first.runId, second.runId)
  assert.match(first.tenantA, new RegExp(`^tus-smoke-a-${first.runId}$`))
  assert.match(first.posDeviceId, new RegExp(`^tus-smoke-pos-device-${first.runId}$`))
  assert.match(first.deliveryTaskId, new RegExp(`^tus-smoke-delivery-task-${first.runId}$`))
})

test('cleanup allows only generated tagged resources and preserves durable evidence tables', async () => {
  const statements = []
  const pool = { query: async (text, parameters) => { statements.push({ text, parameters }); return { rows: [] } } }
  const fixture = createSmokeFixture()

  await cleanupSmokeFixture(pool, fixture, {
    status: 'ready',
    proof: { nonProduction: true },
  })

  const sql = statements.map(({ text }) => text).join('\n')
  assert.equal(sql.includes('DELETE FROM "TusPosAudit"'), false)
  assert.equal(sql.includes('DELETE FROM "TusPosOutbox"'), false)
  assert.equal(sql.includes('DELETE FROM "TusPosReceipt"'), false)
  assert.equal(sql.includes('DELETE FROM "TusPosOperation"'), false)
  assert.equal(sql.includes('DELETE FROM "OutboxEvent"'), false)
  assert.equal(sql.includes('DELETE FROM "prestadores" WHERE "id" IN'), true)
  assert.equal(sql.includes('DELETE FROM "publicaciones" WHERE "id" IN'), true)
  assert.equal(statements.some(({ parameters = [] }) => parameters.includes(fixture.tenantA)), false)
})

test('cleanup refuses without a ready non-production target and performs no SQL', async () => {
  const statements = []
  const pool = { query: async (text) => { statements.push(text); return { rows: [] } } }
  await assert.rejects(cleanupSmokeFixture(pool, createSmokeFixture()), /approved non-production target/)
  assert.deepEqual(statements, [])
})

test('owned API shutdown waits for termination', async () => {
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

test('configured root PostgreSQL evidence remains local and non-production only', async () => {
  await withRootEnv(localEnv, async (rootDirectory) => {
    const evidence = resolvePostgresSmokeEvidence({ rootDirectory, environment: {} })
    assert.equal(evidence.status, 'ready-to-run')
    assert.equal(evidence.target.status, 'ready')
    assert.equal(evidence.target.source, 'root-dotenv-DATABASE_URL')
    assert.equal(evidence.target.environment, 'local')
    assert.equal(evidence.liveConformance, false)
    assert.doesNotMatch(JSON.stringify(evidence), /root-secret/u)
  })
})
