import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function serviceSection(content, serviceName, nextServiceName) {
  const start = content.indexOf(`name: ${serviceName}`)
  const end = nextServiceName ? content.indexOf(`name: ${nextServiceName}`, start) : content.length
  return content.slice(start, end)
}

test('Render API and web contracts bind externally and expose health/readiness', () => {
  const render = read('render.yaml')
  const api = serviceSection(render, 'factory-api', 'factory-web')
  const web = serviceSection(render, 'factory-web', 'factory-workflow-worker')
  const runbook = read('docs/runbooks/tus-deployment-operations.md')
  const apiRuntime = read('apps/api/src/platform/runtime.ts')

  assert.match(api, /buildCommand:[\s\S]*preDeployCommand:[\s\S]*startCommand:/u)
  assert.match(api, /startCommand: PORT=\$PORT pnpm --filter @factory\/api start/u)
  assert.match(api, /healthCheckPath: \/health/u)
  assert.match(apiRuntime, /environment\['PORT'\]/u)
  assert.match(runbook, /GET \/health/u)
  assert.match(runbook, /GET \/ready/u)
  assert.match(web, /startCommand: PORT=\$PORT pnpm --filter @factory\/web start/u)
})

test('standalone, Vercel, and Render start contracts do not use next start', () => {
  const nextConfig = read('apps/web/next.config.js')
  const webPackage = JSON.parse(read('apps/web/package.json'))
  const vercel = read('vercel.json')
  const render = read('render.yaml')
  const renderDocs = read('docs/deployment/render.md')

  assert.match(nextConfig, /const isWindows = process\.platform === ['"]win32['"]/u)
  assert.match(nextConfig, /output:\s*isWindows\s*\?\s*undefined\s*:\s*['"]standalone['"]/u)
  assert.match(renderDocs, /Windows local builds\s+use no standalone output/u)
  assert.match(renderDocs, /Render Linux production retains/u)
  assert.match(renderDocs, /`output: 'standalone'`/u)
  assert.match(nextConfig, /ignoreBuildErrors:\s*false/u)
  assert.match(nextConfig, /ignoreDuringBuilds:\s*false/u)
  assert.equal(webPackage.scripts.start, 'node .next/standalone/server.js')
  assert.match(vercel, /"framework":\s*"nextjs"/u)
  assert.match(vercel, /"buildCommand":\s*"pnpm --filter @factory\/web(?:\.\.\.)? build"/u)
  assert.doesNotMatch(`${vercel}\n${render}\n${webPackage.scripts.start}`, /next start/u)
})

test('migration release is additive-only and backup-gated before start', () => {
  const render = read('render.yaml')
  const predeploy = read('scripts/deployment/render-predeploy.mjs')
  const migrationRunbook = read('docs/runbooks/migration-rollback.md')
  const api = serviceSection(render, 'factory-api', 'factory-web')

  assert.match(api, /preDeployCommand: node scripts\/deployment\/render-predeploy\.mjs/u)
  assert.match(predeploy, /TUS_MIGRATION_BACKUP_VERIFIED/u)
  assert.match(predeploy, /TUS_MIGRATION_PLAN/u)
  assert.match(predeploy, /migrate['"], ['"]deploy/u)
  assert.doesNotMatch(predeploy, /migrate['"], ['"]reset|db push|TRUNCATE|DROP TABLE|DELETE FROM/iu)
  assert.match(migrationRunbook, /verified backup/i)
  assert.match(migrationRunbook, /preserve the PostgreSQL ledger, outbox, idempotency records, and DLQ/i)
})

test('migration wrapper denies unsafe release metadata without invoking Prisma', async () => {
  const { validateMigrationReleaseEnvironment } = await import('../../scripts/deployment/render-predeploy.mjs')

  assert.deepEqual(validateMigrationReleaseEnvironment({}), { valid: false, reason: 'verified-backup-required' })
  assert.deepEqual(validateMigrationReleaseEnvironment({ TUS_MIGRATION_BACKUP_VERIFIED: 'true' }), {
    valid: false,
    reason: 'additive-only-migration-plan-required',
  })
  assert.deepEqual(validateMigrationReleaseEnvironment({
    TUS_MIGRATION_BACKUP_VERIFIED: 'true',
    TUS_MIGRATION_PLAN: 'additive-only',
  }), {
    valid: false,
    reason: 'migration-history-reconciliation-required',
  })
  assert.deepEqual(validateMigrationReleaseEnvironment({
    TUS_MIGRATION_BACKUP_VERIFIED: 'true',
    TUS_MIGRATION_PLAN: 'additive-only',
    TUS_MIGRATION_HISTORY_RECONCILED: 'true',
    TUS_MIGRATION_SELECTED: '20260909090000_tus_argentina_market_launch',
  }), { valid: true, reason: 'approved-additive-release' })
})

test('local API configuration ignores ambient database URLs while production uses platform injection', async () => {
  const { loadApiRuntimeConfig } = await import('../../apps/api/src/platform/configuration/domain.ts')
  const root = mkdtempSync(join(tmpdir(), 'tus-p12-config-'))
  try {
    writeFileSync(join(root, '.env'), 'DATABASE_URL=postgresql://root.example.test/tus\n', 'utf8')
    const local = loadApiRuntimeConfig({
      rootDirectory: root,
      environment: { NODE_ENV: 'development', DATABASE_URL: 'postgresql://ambient.example.test/tus' },
    })
    assert.equal(local.databaseUrl, 'postgresql://root.example.test/tus')

    const production = loadApiRuntimeConfig({
      rootDirectory: root,
      environment: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://platform.example.test/tus?sslmode=require' },
    })
    assert.equal(production.databaseUrl, 'postgresql://platform.example.test/tus?sslmode=require')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('worker activation is durable when owned and fail-closed when unavailable', () => {
  const main = read('apps/workflow-runtime-python/src/worker/main.py')
  const consumer = read('apps/workflow-runtime-python/src/worker/queue/consumer.py')
  const workerConfig = read('apps/workflow-runtime-python/src/worker/core/config.py')
  const render = read('render.yaml')
  const worker = serviceSection(render, 'factory-workflow-worker')

  assert.match(main, /consume_forever/u)
  assert.doesNotMatch(main, /run_once\(example_job_payload\(\)\)/u)
  assert.match(consumer, /stop_event/u)
  assert.match(consumer, /async def close/u)
  assert.match(workerConfig, /validation_alias=['"]REDIS_URL['"]/u)
  assert.match(workerConfig, /validation_alias=['"]QUEUE_REF['"]/u)
  assert.match(workerConfig, /consumer_ready[\s\S]*redis_url[\s\S]*queue_ref[\s\S]*queue_ownership/u)
  assert.match(worker, /WORKER_DEPLOYMENT_STATUS[\s\S]*external-blocked-placeholder/u)
  assert.match(worker, /WORKER_ENABLE_CONSUMER[\s\S]*value: false/u)
  assert.match(worker, /WORKER_QUEUE_OWNERSHIP[\s\S]*external-blocked-placeholder/u)
})

test('environment inventory and public domain contracts avoid secret values', () => {
  const inventory = read('docs/runbooks/tus-environment-consumer-inventory.md')
  const domain = read('docs/deployment/domain-contract.md')
  const render = read('render.yaml')
  const vercel = read('vercel.json')
  const workerConfig = read('apps/workflow-runtime-python/src/worker/core/config.py')
  const apiExample = read('apps/api/.env.example')
  const webExample = read('apps/web/.env.example')

  assert.match(inventory, /Root `\.env` `DATABASE_URL`/u)
  assert.match(inventory, /DATABASE_URL` as the only application\/seed database URL/u)
  assert.match(workerConfig, /repository_root.*\.env|root.*\.env/iu)
  assert.match(workerConfig, /validation_alias=['"]REDIS_URL['"]/u)
  assert.match(domain, /HTTPS|TLS/iu)
  assert.match(domain, /CORS/iu)
  assert.match(domain, /tusservicios\.com/iu)
  assert.doesNotMatch(`${render}\n${vercel}`, /postgres(?:ql)?:\/\/[^<\s]+/iu)
  assert.match(apiExample, /^DATABASE_URL\s*=.*localhost/mu)
  assert.match(apiExample, /^DIRECT_URL\s*=.*localhost/mu)
  assert.doesNotMatch(webExample, /^DATABASE_URL\s*=/mu)
})

test('CI and package scripts execute real validation instead of no-op tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const web = JSON.parse(read('apps/web/package.json'))
  const api = JSON.parse(read('apps/api/package.json'))
  const mobile = JSON.parse(read('apps/mobile/package.json'))

  for (const command of ['pnpm test', 'pnpm run typecheck', 'pnpm run build', 'pnpm run lint']) {
    assert.match(ci, new RegExp(command.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')))
  }
  for (const pkg of [web, api]) {
    assert.doesNotMatch(pkg.scripts.test, /process\.exit\(0\)/u)
    assert.match(pkg.scripts.test, /node \.\.\/\.\.\/scripts\/test-runner\.mjs/u)
  }
  assert.equal(mobile.scripts.test, 'jest --runInBand')
})

test('operations runbooks and evidence index preserve bounded cleanup and truthful claims', () => {
  const operations = read('docs/runbooks/tus-deployment-operations.md')
  const index = read('openspec/changes/tus-argentina-market-launch/evidence-index.md')
  const nativeProfile = read('scripts/dev/native-profile.mjs')

  for (const term of ['PID', 'SLO', 'alert', 'incident', 'backup', 'restore', 'DNS', 'TLS', 'rotation']) {
    assert.match(operations, new RegExp(term, 'iu'))
  }
  assert.match(operations, /only owned process|owned PID/iu)
  assert.match(index, /deterministic/u)
  assert.match(index, /external-blocked/u)
  assert.match(index, /deployment-operations-evidence\.md/u)
  assert.match(nativeProfile, /new OwnedChild/u)
  assert.doesNotMatch(nativeProfile, /taskkill|pkill|killall/u)
})
