import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { assertTusHardeningSeedTarget } from '../../../apps/api/prisma/seed.ts'
import {
  POSTGRES_SEED_CONFIRMATION_FLAG,
  parsePostgresSeedArguments,
  resolveRootSafeTarget,
  runTusPostgresSeed,
  withBoundedPostgresStartupRetry,
} from '../../../scripts/test-runner-lib.mjs'

const ROOT_URL_SECRET = 'postgresql://root-user:root-secret@127.0.0.1:5432/tus?sslmode=require'
const AMBIENT_URL_SECRET = 'postgresql://ambient-user:ambient-secret@ambient.example.test/tus?sslmode=require'

async function withRootEnv(contents, callback) {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'tus-postgres-seed-'))
  await writeFile(join(rootDirectory, '.env'), contents, 'utf8')
  try {
    return await callback(rootDirectory)
  } finally {
    await rm(rootDirectory, { recursive: true, force: true })
  }
}

test('root seed resolution uses only root dotenv DATABASE_URL and redacts target metadata', async () => {
  await withRootEnv('DATABASE_URL="' + ROOT_URL_SECRET + '"\nFACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const target = resolveRootSafeTarget({
      rootDirectory,
      environment: {
        DATABASE_URL: AMBIENT_URL_SECRET,
        TUS_POSTGRES_URL: AMBIENT_URL_SECRET,
        NODE_ENV: 'development',
        FACTORY_PROFILE: 'local',
      },
    })

    assert.equal(target.status, 'ready')
    assert.equal(target.source, 'root-dotenv-DATABASE_URL')
    assert.equal(target.environment, 'local')
    assert.equal(target.redactedTarget, 'postgresql://<redacted-host>/<redacted-database>')
    assert.doesNotMatch(JSON.stringify(target), /root-secret|ambient-secret/u)
  })
})

test('explicit production environment or profile is refused before any database action', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\nFACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    for (const environment of [
      { NODE_ENV: 'production', FACTORY_PROFILE: 'local' },
      { NODE_ENV: 'development', FACTORY_PROFILE: 'production' },
      { NODE_ENV: 'development', FACTORY_PROFILE: 'render' },
    ]) {
      const target = resolveRootSafeTarget({ rootDirectory, environment })
      assert.equal(target.status, 'invalid')
      assert.equal(target.reason, 'production-target-refused')
    }
  })
})

test('missing non-production proof fails closed with one-line remediation', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\n', async (rootDirectory) => {
    const calls = []
    const evidence = await runTusPostgresSeed({
      rootDirectory,
      intent: 'seed',
      environment: {},
      operations: { connectPool: async () => calls.push('connection') },
    })

    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.reason, 'non-production-profile-required')
    assert.match(evidence.remediation, /^Set NODE_ENV=development or FACTORY_PROFILE=local\/test and rerun the explicit seed command\.$/u)
    assert.deepEqual(calls, [])
  })
})

test('a non-local URL is not treated as safe by a profile label alone', async () => {
  await withRootEnv('DATABASE_URL=postgresql://free-tier-user:free-tier-secret@db.example.test/tus?sslmode=require\nFACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const target = resolveRootSafeTarget({ rootDirectory, environment: {} })
    assert.equal(target.status, 'invalid')
    assert.equal(target.reason, 'non-production-target-unproven')
    assert.doesNotMatch(JSON.stringify(target), /free-tier-secret/u)
  })
})

test('remote development target requires explicit process attestation and preserves redacted classification', async () => {
  await withRootEnv('DATABASE_URL=postgresql://free-tier-user:free-tier-secret@db.example.test/tus?sslmode=require\n', async (rootDirectory) => {
    const calls = []
    const evidence = await runTusPostgresSeed({
      rootDirectory,
      intent: 'seed',
      confirmed: true,
      environment: { NODE_ENV: 'development' },
      runId: 'remote-dev-gate',
      operations: {
        connectPool: async () => {
          calls.push('connection')
          return { close: async () => undefined }
        },
        isMigrationRequired: async () => false,
        seedFixture: async () => calls.push('seed'),
        verifyFixture: async () => ({ total: 1, distinctIdentity: 1, stableIdentityMatches: true }),
      },
    })

    assert.equal(evidence.status, 'passed')
    assert.equal(evidence.target.classification, 'remote-development-attested')
    assert.equal(evidence.target.proof.attestation, 'operator-confirmed')
    assert.deepEqual(calls, ['connection', 'seed', 'seed'])
    assert.doesNotMatch(JSON.stringify(evidence), /free-tier-user|free-tier-secret|db\.example\.test/u)
  })
})

test('explicit development attestation authorizes an approved remote pooler-shaped target without calling it production-safe', async () => {
  await withRootEnv('DATABASE_URL=postgresql://free-tier-user:free-tier-secret@free-tier-pooler.example.test/tus?sslmode=require\n', async (rootDirectory) => {
    const evidence = await runTusPostgresSeed({
      rootDirectory,
      intent: 'seed',
      confirmed: true,
      environment: { NODE_ENV: 'development' },
      operations: {
        connectPool: async () => ({ close: async () => undefined }),
        isMigrationRequired: async () => false,
        seedFixture: async () => undefined,
        verifyFixture: async () => ({ total: 1, distinctIdentity: 1, stableIdentityMatches: true }),
      },
    })

    assert.equal(evidence.status, 'passed')
    assert.equal(evidence.target.classification, 'remote-development-attested')
    assert.equal(evidence.target.proof.targetSafety, 'operator-attested-development-only')
    assert.doesNotMatch(JSON.stringify(evidence), /free-tier-user|free-tier-secret|free-tier-pooler\.example\.test/u)
  })
})

test('the tagged fixture contract accepts only an explicitly attested remote development target', () => {
  assert.doesNotThrow(() => assertTusHardeningSeedTarget({
    status: 'ready',
    proof: {
      environment: 'development',
      nonProduction: true,
      attestation: 'operator-confirmed',
      targetSafety: 'operator-attested-development-only',
    },
  }))
  assert.throws(
    () => assertTusHardeningSeedTarget({ status: 'ready', proof: { environment: 'development', nonProduction: true } }),
    /approved non-production target/u,
  )
})

test('remote development target without the confirmation flag is denied before connection', async () => {
  await withRootEnv('DATABASE_URL=postgresql://free-tier-user:free-tier-secret@db.example.test/tus?sslmode=require\n', async (rootDirectory) => {
    const calls = []
    const evidence = await runTusPostgresSeed({
      rootDirectory,
      intent: 'seed',
      environment: { NODE_ENV: 'development' },
      operations: { connectPool: async () => calls.push('connection') },
    })

    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.reason, 'non-production-target-unproven')
    assert.equal(evidence.target.classification, 'remote-development-unattested')
    assert.deepEqual(calls, [])
    assert.doesNotMatch(JSON.stringify(evidence), /free-tier-user|free-tier-secret|db\.example\.test/u)
  })
})

test('seed requires explicit seed intent and does not reach the database by default', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\nFACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const calls = []
    const evidence = await runTusPostgresSeed({
      rootDirectory,
      operations: { connectPool: async () => calls.push('connection') },
    })

    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.reason, 'explicit-seed-intent-required')
    assert.match(evidence.remediation, /postgres-seed\.mjs seed/u)
    assert.deepEqual(calls, [])
  })
})

test('CLI parser accepts only the explicit seed confirmation contract', () => {
  assert.deepEqual(parsePostgresSeedArguments(['seed', POSTGRES_SEED_CONFIRMATION_FLAG]), {
    intent: 'seed',
    confirmed: true,
    invalidArguments: [],
  })
  assert.deepEqual(parsePostgresSeedArguments(['seed']), {
    intent: 'seed',
    confirmed: false,
    invalidArguments: [],
  })
  assert.deepEqual(parsePostgresSeedArguments(['seed', '--confirm-development-target', '--alternate-url=secret']), {
    intent: 'seed',
    confirmed: true,
    invalidArguments: ['--alternate-url=secret'],
  })
})

test('seed requires the explicit development confirmation flag after the seed intent', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\nFACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const calls = []
    const evidence = await runTusPostgresSeed({
      rootDirectory,
      intent: 'seed',
      environment: { NODE_ENV: 'development' },
      operations: { connectPool: async () => calls.push('connection') },
    })

    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.reason, 'explicit-development-confirmation-required')
    assert.match(evidence.remediation, new RegExp(`NODE_ENV=development node scripts/postgres-seed\\.mjs seed ${POSTGRES_SEED_CONFIRMATION_FLAG}`, 'u'))
    assert.deepEqual(calls, [])
  })
})

test('seed confirmation is accepted only with an explicit development environment', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\nFACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    for (const nodeEnv of ['test', undefined]) {
      const calls = []
      const environment = nodeEnv ? { NODE_ENV: nodeEnv } : {}
      const evidence = await runTusPostgresSeed({
        rootDirectory,
        intent: 'seed',
        confirmed: true,
        environment,
        operations: { connectPool: async () => calls.push('connection') },
      })

      assert.equal(evidence.status, 'deferred')
      assert.equal(evidence.reason, 'development-environment-required')
      assert.deepEqual(calls, [])
    }
  })
})

test('production refuses even when development confirmation is supplied', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\nFACTORY_PROFILE=local\nNODE_ENV=development\n', async (rootDirectory) => {
    const calls = []
    const evidence = await runTusPostgresSeed({
      rootDirectory,
      intent: 'seed',
      confirmed: true,
      environment: { NODE_ENV: 'production' },
      operations: { connectPool: async () => calls.push('connection') },
    })

    assert.equal(evidence.status, 'deferred')
    assert.equal(evidence.reason, 'production-target-refused')
    assert.deepEqual(calls, [])
  })
})

test('bounded PostgreSQL startup gives each attempt at most 60 seconds and retries exactly once', async () => {
  const attempts = []
  const backoffs = []
  const result = await withBoundedPostgresStartupRetry(
    async ({ attempt, timeoutMs }) => {
      attempts.push({ attempt, timeoutMs })
      if (attempt === 1) throw new Error('connection password=do-not-report')
      return 'connected'
    },
    {
      attemptTimeoutMs: 120_000,
      backoffMs: 7,
      sleep: async (durationMs) => backoffs.push(durationMs),
    },
  )

  assert.equal(result.value, 'connected')
  assert.deepEqual(attempts, [
    { attempt: 1, timeoutMs: 60_000 },
    { attempt: 2, timeoutMs: 60_000 },
  ])
  assert.deepEqual(backoffs, [7])
  assert.deepEqual(result.diagnostics.map(({ attempt, status }) => ({ attempt, status })), [
    { attempt: 1, status: 'failed' },
    { attempt: 2, status: 'passed' },
  ])
  assert.doesNotMatch(JSON.stringify(result), /password|do-not-report/u)
})

test('bounded PostgreSQL startup stops after the single retry with redacted diagnostics', async () => {
  let calls = 0
  await assert.rejects(
    withBoundedPostgresStartupRetry(
      async () => {
        calls += 1
        throw new Error('postgresql://user:secret@host/db')
      },
      { attemptTimeoutMs: 5, backoffMs: 1, sleep: async () => undefined },
    ),
    (error) => {
      assert.equal(calls, 2)
      assert.equal(error.message, 'PostgreSQL startup failed after two bounded attempts; diagnostics redacted')
      assert.equal(error.attempts, 2)
      assert.doesNotMatch(JSON.stringify(error), /secret|postgresql:\/\//u)
      return true
    },
  )
})

test('a timed-out PostgreSQL startup attempt receives exactly one bounded retry', async () => {
  const attempts = []
  const result = await withBoundedPostgresStartupRetry(
    ({ attempt, timeoutMs }) => {
      attempts.push({ attempt, timeoutMs })
      if (attempt === 1) return new Promise(() => {})
      return 'connected-after-timeout'
    },
    { attemptTimeoutMs: 5, backoffMs: 1, sleep: async () => undefined },
  )

  assert.equal(result.value, 'connected-after-timeout')
  assert.deepEqual(attempts, [
    { attempt: 1, timeoutMs: 5 },
    { attempt: 2, timeoutMs: 5 },
  ])
  assert.deepEqual(result.diagnostics.map(({ attempt, status }) => ({ attempt, status })), [
    { attempt: 1, status: 'failed' },
    { attempt: 2, status: 'passed' },
  ])
})

test('explicit seed intent runs a stable namespaced fixture twice without duplicates', async () => {
  await withRootEnv('DATABASE_URL=' + ROOT_URL_SECRET + '\nFACTORY_PROFILE=test\nNODE_ENV=test\n', async (rootDirectory) => {
    const rows = new Map()
    const evidence = await runTusPostgresSeed({
      rootDirectory,
      intent: 'seed',
      confirmed: true,
      environment: { NODE_ENV: 'development' },
      operations: {
        connectPool: async () => ({ close: async () => undefined }),
        isMigrationRequired: async () => false,
        seedFixture: async (_pool, _target, fixture) => {
          rows.set(`${fixture.tag}:${fixture.version}:${fixture.runId}`, fixture)
        },
        verifyFixture: async () => ({ total: rows.size, distinctIdentity: rows.size, stableIdentityMatches: rows.size === 1 }),
      },
    })

    assert.equal(evidence.status, 'passed')
    assert.equal(evidence.seedRuns, 2)
    assert.deepEqual(evidence.verification, {
      firstRun: { total: 1, distinctIdentity: 1, stableIdentityMatches: true },
      secondRun: { total: 1, distinctIdentity: 1, stableIdentityMatches: true },
      duplicateFixtures: 0,
    })
    assert.equal(evidence.sideEffects.deletes, 0)
  })
})

test('the seed migration creates only its missing additive fixture table before indexes', async () => {
  const migration = await readFile(new URL('../../../apps/api/prisma/migrations/20260831170000_tus_real_db_runtime_audit/migration.sql', import.meta.url), 'utf8')

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "TusHardeningFixture"/u)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "TusHardeningFixture_tag_version_runId_key"/u)
  assert.doesNotMatch(migration, /\b(?:TRUNCATE|DROP TABLE|CASCADE DELETE|DELETE FROM)\b/iu)
})
