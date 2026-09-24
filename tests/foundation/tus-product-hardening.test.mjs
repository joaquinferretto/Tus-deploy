import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

function safeRoot() {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'tus-hardening-safe-'))
  writeFileSync(join(rootDirectory, '.env'), `DATABASE_URL="${SAFE_URL}"\nFACTORY_PROFILE=local\nNODE_ENV=development\n`)
  return rootDirectory
}

test('safe target loads only root DATABASE_URL and requires an explicit non-production profile', () => {
  const rootDirectory = safeRoot()
  const safe = resolveSafeTarget({
    rootDirectory,
    environment: { DATABASE_URL: 'ambient-secret', NODE_ENV: 'development', FACTORY_PROFILE: 'local' },
  })

  assert.equal(safe.status, 'ready')
  assert.equal(safe.source, 'root-dotenv-DATABASE_URL')
  assert.equal(safe.environment, 'local')
  assert.equal(safe.proof.nonProduction, true)
  assert.doesNotMatch(JSON.stringify(safe), /ambient-secret|runner:secret/u)

  const unsafe = resolveSafeTarget({
    rootDirectory,
    environment: { NODE_ENV: 'production', FACTORY_PROFILE: 'local' },
  })
  assert.equal(unsafe.status, 'invalid')
  assert.equal(unsafe.reason, 'production-target-refused')
})

test('native application source prefers root DATABASE_URL while the safe target stays redacted', () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'tus-hardening-env-'))
  writeFileSync(join(rootDirectory, '.env'), `DATABASE_URL="${SAFE_URL}"\nFACTORY_PROFILE=local\nNODE_ENV=development\nOTHER_SECRET=not-consumed\n`)
  assert.equal(resolveDatabaseUrl({
    rootDirectory,
    processEnv: { DATABASE_URL: 'ambient-secret' },
  }), SAFE_URL)

  const target = resolveNativeSafeTarget({
    rootDirectory,
    processEnv: { NODE_ENV: 'development', FACTORY_PROFILE: 'local' },
  })
  assert.equal(target.status, 'ready')
  assert.doesNotMatch(JSON.stringify(target), /secret|127\.0\.0\.1/u)
})

test('owned child verifies exact launch identity and bounded cleanup', async () => {
  const child = {
    pid: 42,
    spawncwd: process.cwd(),
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

test('production profile is refused even when an ambient database value is present', () => {
  const rootDirectory = safeRoot()
  const target = resolveSafeTarget({
    rootDirectory,
    environment: {
      NODE_ENV: 'production',
      FACTORY_PROFILE: 'production',
      DATABASE_URL: 'postgresql://ambient-secret@production.invalid/tus?sslmode=require',
    },
  })
  assert.equal(target.status, 'invalid')
  assert.equal(target.reason, 'production-target-refused')
})

test('ambient DATABASE_URL cannot substitute for the explicit root dotenv source', () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'tus-hardening-empty-root-'))
  const target = resolveSafeTarget({
    rootDirectory,
    environment: { NODE_ENV: 'development', FACTORY_PROFILE: 'local', DATABASE_URL: SAFE_URL },
  })

  assert.equal(target.status, 'deferred')
  assert.equal(target.source, null)
  assert.equal(target.reason, 'no-database-url')
})

test('native child environment is allowlisted and carries only safe profile metadata', () => {
  const environment = buildNativeChildEnvironment({
    baseEnvironment: { PATH: 'safe', AWS_SECRET_ACCESS_KEY: 'must-not-pass', DATABASE_URL: SAFE_URL, NODE_ENV: 'development', FACTORY_PROFILE: 'local', CORS_ORIGINS: 'http://localhost:3000', TUS_ROUTES_ENABLED: 'true', TUS_PROVIDER_ACTIONS_ENABLED: 'false' },
    databaseUrl: SAFE_URL,
  })
  assert.equal(environment.DATABASE_URL, SAFE_URL)
  assert.equal('AWS_SECRET_ACCESS_KEY' in environment, false)
  assert.equal(environment.FACTORY_PROFILE, 'local')
  assert.equal(environment.CORS_ORIGINS, 'http://localhost:3000')
  assert.equal(environment.TUS_ROUTES_ENABLED, 'true')
  assert.equal(environment.TUS_PROVIDER_ACTIONS_ENABLED, 'false')
  assert.equal('TUS_TEST_TARGET_ID' in environment, false)
})

test('owned child rejects a changed argv and clamps all deadlines to two minutes', async () => {
  const child = {
    pid: 7,
    spawncwd: process.cwd(),
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

test('owned child rejects a changed working directory as well as changed argv', async () => {
  const child = {
    pid: 8,
    spawncwd: join(root, 'other-directory'),
    spawnargs: ['node', '-e', 'expected'],
    exitCode: null,
    once: (_event, callback) => setImmediate(() => { child.exitCode = 0; callback(0, 'SIGTERM') }),
    kill: () => undefined,
  }
  const owned = new OwnedChild({ child, command: 'node', args: ['-e', 'expected'], cwd: root })

  assert.equal(await owned.verify(), false)
})

test('environment inventory records canonical sources and preserves aliases without proof of removal', async () => {
  const { readFile } = await import('node:fs/promises')
  const inventory = await readFile(join(root, 'docs/runbooks/tus-environment-consumer-inventory.md'), 'utf8')
  assert.match(inventory, /Canonical name\/source/i)
  assert.match(inventory, /DATABASE_URL/)
   assert.match(inventory, /only application\/seed database URL/i)
  assert.match(inventory, /former six-field/i)
  assert.doesNotMatch(inventory, /apps\/api\/backendFiles/u)
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
  assert.match(migration, /FOREIGN KEY/i)
  assert.match(migration, /NOT VALID/i)

  const seed = await readFile(join(root, 'apps/api/prisma/seed.ts'), 'utf8')
  assert.match(seed, /TUS_HARDENING_FIXTURE_TAG/)
  assert.match(seed, /upsert/) 
  assert.match(seed, /tagged/i)
  assert.match(seed, /non-production/i)
  const schema = await readFile(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  assert.match(schema, /model TusHardeningFixture[\s\S]*?@@unique\(\[tag, version, runId\]\)/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "TusHardeningFixture"/i)
})

test('tagged fixture seeding is idempotent and makes no call for an unsafe target', async () => {
  const { buildTusHardeningFixture, seedTusHardeningFixture } = await import('../../apps/api/prisma/seed.ts')
  const fixture = buildTusHardeningFixture('run-001')
  const calls = []
  const client = { fixture: { upsert: async (args) => calls.push(args) } }
  const target = { status: 'ready', proof: { environment: 'test', nonProduction: true } }

  await seedTusHardeningFixture(client, target, fixture)
  await seedTusHardeningFixture(client, target, fixture)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].where, { tag_version_runId: { tag: 'tus-product-hardening', version: '20260830.v1', runId: 'run-001' } })
  assert.deepEqual(calls[1].create, calls[0].create)

  await assert.rejects(
    seedTusHardeningFixture(client, { ...target, proof: { ...target.proof, nonProduction: false } }, fixture),
    /approved non-production target/,
  )
  assert.equal(calls.length, 2)
})

test('local, Render, and Vercel startup contracts stay finite and fail closed', async () => {
  const { readFile } = await import('node:fs/promises')
  const render = await readFile(join(root, 'render.yaml'), 'utf8')
  const local = await readFile(join(root, 'docs/runbooks/local-profiles.md'), 'utf8')
  const deployment = await readFile(join(root, 'docs/runbooks/tus-deployment.md'), 'utf8')
   assert.doesNotMatch(render, /^[ ]{7}- key:/mu)
  assert.match(render, /pnpm --filter @factory\/api (build|start)/)
  assert.match(render, /pnpm --filter @factory\/web (build|start)/)
  assert.match(local, /root[\s\S]*\.env[\s\S]*DATABASE_URL/i)
  assert.match(local, /ambient|process.*override.*not|root.*wins/i)
  assert.match(deployment, /Vercel|Next/i)
  assert.match(deployment, /external-blocked|fail-closed/i)
})

test('POS receipt hashing uses strict-safe omission and preserves verification behavior', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(join(root, 'apps/api/src/tus/pos/index.ts'), 'utf8')
  assert.doesNotMatch(source, /delete\s+unsigned\.integrityHash/u)
  assert.match(source, /const \{ integrityHash, \.\.\.unsigned \} = receipt/u)

  const { verifyPosReceipt } = await import('../../apps/api/src/tus/pos/index.ts')
  const receipt = {
    receiptId: 'receipt-1',
    tenantId: 'tenant-1',
    operationId: 'operation-1',
    kind: 'manual-sale',
    context: 'product',
    amount: 100,
    currency: 'ARS',
    status: 'accepted',
    source: 'deterministic-test-only',
    providerCapture: 'not-claimed',
    settlement: 'not-claimed',
    integrityHash: '',
    createdAt: '2026-08-31T00:00:00.000Z',
  }
  const crypto = await import('node:crypto')
  const { integrityHash, ...unsigned } = receipt
  receipt.integrityHash = crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')

  assert.equal(verifyPosReceipt(receipt), true)
  assert.equal(verifyPosReceipt({ ...receipt, integrityHash: 'tampered' }), false)
})

test('API build contract reports a locked Prisma engine without deleting generated artifacts', async () => {
  const { readFile } = await import('node:fs/promises')
  const packageJson = JSON.parse(await readFile(join(root, 'apps/api/package.json'), 'utf8'))
  const buildScript = await readFile(join(root, 'scripts/build-api.mjs'), 'utf8')

  assert.equal(packageJson.scripts.build, 'node ../../scripts/build-api.mjs')
  assert.match(buildScript, /Windows Prisma query engine is locked/i)
  assert.match(buildScript, /stop the owned API process and retry/i)
  assert.doesNotMatch(buildScript, /rm\s+-rf|Remove-Item|unlinkSync/u)
})

test('web production API resolution requires the canonical URL while the local wrapper injects its bounded API URL', async () => {
  const { resolveWebApiBaseUrl } = await import('../../apps/web/src/lib/api-url.ts')
  const { NATIVE_WEB_API_URL, buildNativeChildEnvironment } = await import('../../scripts/dev/native-profile.mjs')

  assert.equal(
    resolveWebApiBaseUrl({ canonicalUrl: 'https://api.example.invalid/', nodeEnv: 'production' }),
    'https://api.example.invalid',
  )
  assert.throws(
    () => resolveWebApiBaseUrl({ nodeEnv: 'production' }),
    /NEXT_PUBLIC_API_URL.*production/i,
  )
  assert.equal(
    resolveWebApiBaseUrl({ nodeEnv: 'development', localDefault: NATIVE_WEB_API_URL }),
    NATIVE_WEB_API_URL,
  )
  assert.throws(
    () => resolveWebApiBaseUrl({ nodeEnv: 'development' }),
    /local wrapper explicitly/i,
  )

  const localWebEnvironment = buildNativeChildEnvironment({
    baseEnvironment: {},
    webApiUrl: NATIVE_WEB_API_URL,
  })
  assert.equal(localWebEnvironment.NEXT_PUBLIC_API_URL, NATIVE_WEB_API_URL)

  const apiClient = readFileSync(join(root, 'apps/web/src/lib/api-client.ts'), 'utf8')
  const tusClient = readFileSync(join(root, 'apps/web/src/lib/tus-client.ts'), 'utf8')
  assert.match(apiClient, /resolveWebApiBaseUrl/)
  assert.match(tusClient, /resolveWebApiBaseUrl/)
  assert.doesNotMatch(apiClient, /localhost:/)
  assert.doesNotMatch(tusClient, /localhost:/)
})

test('web API resolution accepts the retained deployment alias only when it agrees with the canonical contract', async () => {
  const { resolveWebApiBaseUrl } = await import('../../apps/web/src/lib/api-url.ts')

  assert.equal(
    resolveWebApiBaseUrl({
      canonicalUrl: 'https://api.example.invalid/',
      legacyUrl: 'https://api.example.invalid',
      nodeEnv: 'production',
    }),
    'https://api.example.invalid',
  )
  assert.throws(
    () => resolveWebApiBaseUrl({
      canonicalUrl: 'https://api.example.invalid',
      legacyUrl: 'https://old-api.example.invalid',
      nodeEnv: 'production',
    }),
    /disagree|canonical/i,
  )
  assert.throws(
    () => resolveWebApiBaseUrl({ canonicalUrl: 'http://user:password@example.invalid', nodeEnv: 'production' }),
    /credentials/i,
  )
})

test('Expo web resolver avoids Zustand import.meta incompatibility without changing application source boundaries', async () => {
  const { resolveMobileModule, WEB_ZUSTAND_MIDDLEWARE } = await import('../../apps/mobile/metro-resolver.cjs')

  const appStore = readFileSync(join(root, 'apps/mobile/src/store/app-store.ts'), 'utf8')
  const eslintConfig = readFileSync(join(root, 'apps/mobile/.eslintrc.cjs'), 'utf8')
  const resolution = resolveMobileModule({ resolveRequest: () => ({ type: 'sourceFile', filePath: 'default' }) }, 'zustand/middleware', 'web')
  const nativeResolution = resolveMobileModule({ resolveRequest: () => ({ type: 'sourceFile', filePath: 'default' }) }, 'zustand/middleware', 'ios')

  assert.equal(resolution.type, 'sourceFile')
  assert.equal(resolution.filePath, WEB_ZUSTAND_MIDDLEWARE)
  assert.deepEqual(nativeResolution, { type: 'sourceFile', filePath: 'default' })
  assert.doesNotMatch(readFileSync(WEB_ZUSTAND_MIDDLEWARE, 'utf8'), /import\.meta/)
  assert.match(appStore, /createEncryptedMMKVStateStorage/)
  assert.match(appStore, /parseMobileRuntimeConfig/)
  assert.match(eslintConfig, /ignorePatterns[\s\S]*dist\//)
})

test('deployment contracts use the canonical local API port and preserve explicit overrides', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(join(root, 'apps/api/src/server.ts'), 'utf8')
  const nativeProfile = await readFile(join(root, 'scripts/dev/native-profile.mjs'), 'utf8')
  const mobileRuntime = await readFile(join(root, 'apps/mobile/src/core/config/runtime-profile.ts'), 'utf8')
  const rootExample = await readFile(join(root, '.env.example'), 'utf8')
  const apiExample = await readFile(join(root, 'apps/api/.env.example'), 'utf8')
  const webExample = await readFile(join(root, 'apps/web/.env.example'), 'utf8')
  const compose = await readFile(join(root, 'docker-compose.yml'), 'utf8')
  const apiDockerfile = await readFile(join(root, 'apps/api/Dockerfile'), 'utf8')
  const makefile = await readFile(join(root, 'Makefile'), 'utf8')
  const readme = await readFile(join(root, 'README.md'), 'utf8')
  const architecture = await readFile(join(root, 'ARCHITECTURE.md'), 'utf8')
  const localRunbook = await readFile(join(root, 'docs/runbooks/local-profiles.md'), 'utf8')
  const deploymentRunbook = await readFile(join(root, 'docs/runbooks/tus-deployment.md'), 'utf8')

   assert.match(server, /resolveListenPort\(process\.env,\s*runtimeConfig\.environment\)/u)
   const runtime = await import('../../apps/api/src/platform/runtime.ts')
   assert.equal(runtime.resolveListenPort({ API_PORT: '3999' }, 'development'), 3999)
   assert.equal(runtime.resolveListenPort({ PORT: '4312', API_PORT: '3999' }, 'production'), 4312)
   assert.equal(runtime.resolveListenPort({}, 'development'), 3101)
  assert.match(nativeProfile, /NATIVE_API_PORT\s*=\s*'3101'/u)
  assert.match(nativeProfile, /environment\.API_PORT\s*=\s*baseEnvironment\?\.API_PORT\s*\|\|\s*NATIVE_API_PORT/u)
  const nativeModule = await import('../../scripts/dev/native-profile.mjs')
  assert.equal(nativeModule.NATIVE_API_PORT, '3101')
  assert.equal(nativeModule.buildNativeChildEnvironment({ baseEnvironment: { API_PORT: '3999' } }).API_PORT, '3999')
  assert.match(mobileRuntime, /apiUrl:\s*'http:\/\/localhost:3101'/u)
  assert.match(rootExample, /API_PORT=3101/u)
  assert.match(rootExample, /NEXT_PUBLIC_API_URL="http:\/\/localhost:3101"/u)
  assert.match(apiExample, /API_PORT=3101/u)
  assert.match(webExample, /NEXT_PUBLIC_API_URL="http:\/\/localhost:3101"/u)
  assert.match(compose, /API_PORT: 3101/u)
  assert.match(compose, /['"]3101:3101['"]/u)
  assert.match(compose, /NEXT_PUBLIC_API_URL: http:\/\/localhost:3101/u)
  assert.match(apiDockerfile, /EXPOSE 3101/u)
  assert.match(makefile, /localhost:3101/u)
  assert.match(makefile, /@factory\/web/u)
  assert.match(readme, /localhost:3101/u)
  assert.match(architecture, /API_PORT=3101/u)
  assert.match(localRunbook, /apps\/api[\s\S]*apps\/web/u)
  assert.match(localRunbook, /3101/u)
  assert.match(deploymentRunbook, /API_PORT=3101/u)
})

test('Vercel, Next, Render, Mongo, mobile, support, and worker contracts are explicit without secrets', async () => {
  const { readFile } = await import('node:fs/promises')
  const vercel = await readFile(join(root, 'vercel.json'), 'utf8')
  const nextConfig = await readFile(join(root, 'apps/web/next.config.js'), 'utf8')
  const dockerfile = await readFile(join(root, 'apps/web/Dockerfile'), 'utf8')
  const render = await readFile(join(root, 'render.yaml'), 'utf8')
  const apiPackage = JSON.parse(await readFile(join(root, 'apps/api/package.json'), 'utf8'))
  const mongoConnection = await readFile(join(root, 'apps/api/src/infrastructure/database/mongodb/connection.ts'), 'utf8')
  const inventory = await readFile(join(root, 'docs/runbooks/tus-environment-consumer-inventory.md'), 'utf8')
  const deployment = await readFile(join(root, 'docs/runbooks/tus-deployment.md'), 'utf8')
  const rootExample = await readFile(join(root, '.env.example'), 'utf8')

  assert.doesNotMatch(vercel, /NEXT_PUBLIC_API_URL\s*:\s*["'][^"']+["']/u)
  assert.match(deployment, /Vercel Project Settings[\s\S]*NEXT_PUBLIC_API_URL/u)
  assert.match(deployment, /vercel\.json[\s\S]*intentionally contains no API URL/u)
  assert.match(nextConfig, /output:\s*['"]standalone['"]/u)
  assert.match(dockerfile, /\.next\/standalone/u)
  assert.match(dockerfile, /apps\/web\/server\.js/u)
  assert.equal(apiPackage.scripts['prisma:migrate:deploy'], 'prisma migrate deploy')
  assert.match(render, /preDeployCommand:\s*pnpm --filter @factory\/api prisma:migrate:deploy/u)
  assert.match(render, /MONGODB_URL/u)
  assert.doesNotMatch(render, /key:\s*MONGODB_URI/u)
   assert.match(render, /external-blocked[\s\S]*startCommand:\s*python -m worker\.main[\s\S]*WORKER_ENABLE_CONSUMER[\s\S]*value:\s*false/u)
  assert.match(mongoConnection, /MONGODB_URL[\s\S]*MONGODB_URI/u)
  assert.match(inventory, /MONGODB_URL[\s\S]*canonical/u)
  assert.match(inventory, /MONGODB_URI[\s\S]*compatibility alias/iu)
  assert.match(rootExample, /EXPO_PUBLIC_API_URL="http:\/\/localhost:3101"/u)
  assert.match(rootExample, /NEXT_PUBLIC_SITE_URL/u)
  assert.match(rootExample, /NEXT_PUBLIC_SUPPORT_WHATSAPP_URL/u)
  assert.match(deployment, /mobile[\s\S]*EXPO_PUBLIC_API_URL[\s\S]*support[\s\S]*NEXT_PUBLIC_SUPPORT_WHATSAPP_URL/i)
})
