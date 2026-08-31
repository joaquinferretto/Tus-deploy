import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  OwnedChild,
  resolveSafeTarget,
} from '../../scripts/test-runner-lib.mjs'
import {
  resolveDatabaseUrl,
  resolveNativeSafeTarget,
  buildNativeChildEnvironment,
} from '../../scripts/dev/native-profile.mjs'

const root = join(import.meta.dirname, '..', '..')

const SAFE_URL = 'postgresql://runner:secret@127.0.0.1:5432/tus?sslmode=require'

function proof(overrides = {}) {
  return {
    TUS_TEST_TARGET_IDENTITY: 'local-test-postgres',
    TUS_TEST_TARGET_ID: 'tus-local-disposable-001',
    TUS_TEST_TARGET_OWNER: 'runtime-owner',
    TUS_TEST_TARGET_DISPOSABLE: 'true',
    TUS_TEST_TARGET_ENV: 'test',
    TUS_TEST_TARGET_NON_PRODUCTION: 'true',
    ...overrides,
  }
}

test('safe target loads only root DATABASE_URL and refuses incomplete proof before side effects', () => {
  const safe = resolveSafeTarget({
    rootDirectory: import.meta.dirname,
    environment: { ...proof(), DATABASE_URL: SAFE_URL },
  })

  assert.equal(safe.status, 'ready')
  assert.equal(safe.source, 'root-dotenv-DATABASE_URL')
  assert.equal(safe.identity, 'local-test-postgres')
  assert.equal(safe.proof.disposable, true)
  assert.equal(safe.proof.nonProduction, true)
  assert.doesNotMatch(JSON.stringify(safe), /secret|127\.0\.0\.1|tus\?/)

  const unsafe = resolveSafeTarget({
    rootDirectory: import.meta.dirname,
    environment: { ...proof(), DATABASE_URL: SAFE_URL, TUS_TEST_TARGET_DISPOSABLE: 'false' },
  })
  assert.equal(unsafe.status, 'invalid')
  assert.equal(unsafe.reason, 'disposable-proof-required')
})

test('native application source prefers root DATABASE_URL while the safe target stays redacted', () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'tus-hardening-env-'))
  writeFileSync(join(rootDirectory, '.env'), `DATABASE_URL="${SAFE_URL}"\nOTHER_SECRET=not-consumed\n`)
  assert.equal(resolveDatabaseUrl({
    rootDirectory,
    processEnv: { DATABASE_URL: 'ambient-secret' },
  }), SAFE_URL)

  const target = resolveNativeSafeTarget({
    rootDirectory: import.meta.dirname,
    processEnv: { ...proof(), DATABASE_URL: SAFE_URL },
  })
  assert.equal(target.status, 'ready')
  assert.doesNotMatch(JSON.stringify(target), /secret|127\.0\.0\.1/)
})

test('owned child verifies exact launch identity and bounded cleanup', async () => {
  const child = {
    pid: 42,
    spawnfile: 'node',
    spawnargs: ['node', '-e', 'setTimeout(() => undefined, 1000)'],
    exitCode: null,
    once: (_event, callback) => setImmediate(() => { child.exitCode = 0; callback(0, 'SIGTERM') }),
    kill: (signal) => { child.signal = signal },
  }
  const owned = new OwnedChild({
    child,
    command: 'node',
    args: ['-e', 'setTimeout(() => undefined, 1000)'],
    cwd: process.cwd(),
    startupMs: 120_000,
    requestMs: 120_000,
    shutdownMs: 120_000,
  })

  assert.equal(await owned.verify(), true)
  await owned.stop()
  assert.equal(child.signal, 'SIGTERM')
  assert.equal(child.exitCode, 0)
  assert.equal(owned.shutdownMs <= 120_000, true)
})

test('explicit runner override still requires the complete target proof', () => {
  const target = resolveSafeTarget({
    rootDirectory: import.meta.dirname,
    environment: {
      ...proof(),
      TUS_TEST_RUNNER_POSTGRES_URL: SAFE_URL,
      DATABASE_URL: 'postgresql://ambient-secret@production.invalid/tus?sslmode=require',
    },
  })
  assert.equal(target.status, 'ready')
  assert.equal(target.source, 'test-runner-override')

  const mismatched = resolveSafeTarget({
    rootDirectory: import.meta.dirname,
    environment: { ...proof(), TUS_TEST_RUNNER_POSTGRES_URL: SAFE_URL, TUS_TEST_TARGET_IDENTITY: '' },
  })
  assert.equal(mismatched.status, 'invalid')
  assert.equal(mismatched.reason, 'target-identity-required')
})

test('native child environment is allowlisted and carries only redacted proof metadata', () => {
  const environment = buildNativeChildEnvironment({
    baseEnvironment: { PATH: 'safe', AWS_SECRET_ACCESS_KEY: 'must-not-pass', DATABASE_URL: SAFE_URL },
    databaseUrl: SAFE_URL,
    proof: proof(),
  })
  assert.equal(environment.DATABASE_URL, SAFE_URL)
  assert.equal(environment.TUS_TEST_TARGET_ID, 'tus-local-disposable-001')
  assert.equal('AWS_SECRET_ACCESS_KEY' in environment, false)
  assert.equal(environment.TUS_TEST_TARGET_DISPOSABLE, 'true')
})

test('owned child rejects a changed argv and clamps all deadlines to two minutes', async () => {
  const child = {
    pid: 7,
    spawnargs: ['node', '-e', 'different'],
    exitCode: null,
    once: (_event, callback) => setImmediate(() => { child.exitCode = 0; callback(0, 'SIGTERM') }),
    kill: () => undefined,
  }
  const owned = new OwnedChild({ child, command: 'node', args: ['-e', 'expected'], cwd: process.cwd(), startupMs: 999_999, requestMs: -1, shutdownMs: 999_999 })
  assert.equal(await owned.verify(), false)
  assert.equal(owned.startupMs, 120_000)
  assert.equal(owned.requestMs, 120_000)
  assert.equal(owned.shutdownMs, 120_000)
})

test('environment inventory records canonical sources and preserves aliases without proof of removal', async () => {
  const { readFile } = await import('node:fs/promises')
  const inventory = await readFile(join(root, 'docs/runbooks/tus-environment-consumer-inventory.md'), 'utf8')
  assert.match(inventory, /Canonical name\/source/i)
  assert.match(inventory, /DATABASE_URL/)
  assert.match(inventory, /TUS_POSTGRES_URL[\s\S]*alias[\s\S]*retain/i)
  assert.match(inventory, /apps\/api\/backendFiles/)
  assert.match(inventory, /render\.yaml[\s\S]*Vercel/i)
})

test('hardening migration and fixtures are additive, tagged, and explicitly idempotent', async () => {
  const { readFile, access } = await import('node:fs/promises')
  const migrationPath = join(root, 'apps/api/prisma/migrations/20260830100000_tus_product_hardening/migration.sql')
  await access(migrationPath)
  const migration = await readFile(migrationPath, 'utf8')
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE)\b/i)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/i)
  assert.match(migration, /CHECK/i)

  const seed = await readFile(join(root, 'apps/api/prisma/seed.ts'), 'utf8')
  assert.match(seed, /TUS_HARDENING_FIXTURE_TAG/)
  assert.match(seed, /upsert/) 
  assert.match(seed, /tagged/i)
  assert.match(seed, /disposable|test-safe/i)
})

test('tagged fixture seeding is idempotent and makes no call for an unsafe target', async () => {
  const { buildTusHardeningFixture, seedTusHardeningFixture } = await import('../../apps/api/prisma/seed.ts')
  const fixture = buildTusHardeningFixture('run-001')
  const calls = []
  const client = { fixture: { upsert: async (args) => calls.push(args) } }
  const target = { status: 'ready', proof: { disposable: true, environment: 'test', nonProduction: true } }

  await seedTusHardeningFixture(client, target, fixture)
  await seedTusHardeningFixture(client, target, fixture)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].where, { tag_version_runId: { tag: 'tus-product-hardening', version: '20260830.v1', runId: 'run-001' } })
  assert.deepEqual(calls[1].create, calls[0].create)

  await assert.rejects(
    seedTusHardeningFixture(client, { ...target, proof: { ...target.proof, disposable: false } }, fixture),
    /approved disposable non-production target/,
  )
  assert.equal(calls.length, 2)
})

test('local, Render, and Vercel startup contracts stay finite and fail closed', async () => {
  const { readFile } = await import('node:fs/promises')
  const render = await readFile(join(root, 'render.yaml'), 'utf8')
  const local = await readFile(join(root, 'docs/runbooks/local-profiles.md'), 'utf8')
  const deployment = await readFile(join(root, 'docs/runbooks/tus-deployment.md'), 'utf8')
  assert.doesNotMatch(render, /^\s{7}- key:/mu)
  assert.match(render, /pnpm --filter @factory\/api (build|start)/)
  assert.match(render, /pnpm --filter @factory\/web (build|start)/)
  assert.match(local, /root[\s\S]*\.env[\s\S]*DATABASE_URL/i)
  assert.match(local, /ambient|process.*override.*not|root.*wins/i)
  assert.match(deployment, /Vercel|Next/i)
  assert.match(deployment, /external-blocked|fail-closed/i)
})
