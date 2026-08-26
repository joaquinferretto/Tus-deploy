import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

function filesIn(path) {
  const absolute = join(root, path)
  const stat = statSync(absolute)
  if (stat.isFile()) return [path]
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => !['.turbo', 'node_modules', 'dist'].includes(entry.name))
    .flatMap((entry) => filesIn(join(path, entry.name)))
}

test('P5.5 fallback fixtures expose deterministic marketplace, messaging, and settlement proof', () => {
  const result = runTypeScriptScenario(`
    const { createMarketplaceFallbackFixture } = (await import('./apps/reference/fallback/marketplace/index.ts')).default
    const { createMessagingCapabilityFixture } = (await import('./apps/reference/fallback/messaging/index.ts')).default
    const { createSettlementFallbackFixture } = (await import('./apps/reference/fallback/settlement/index.ts')).default
    const marketplace = createMarketplaceFallbackFixture()
    const messaging = createMessagingCapabilityFixture()
    const settlement = createSettlementFallbackFixture()
    console.log(JSON.stringify({ marketplace, messaging, settlement }))
  `)

  assert.equal(result.marketplace.context.tenantId, 'fixture-tenant')
  assert.equal(result.marketplace.records[0].ownerTenantId, 'fixture-tenant')
  assert.equal(result.marketplace.foreignRecordVisible, false)
  assert.equal(result.marketplace.rollback.status, 'restored')
  assert.equal(result.messaging.delivery.status, 'delivered')
  assert.equal(result.messaging.replay.status, 'replay')
  assert.equal(result.messaging.retry.status, 'retryable')
  assert.equal(result.settlement.reconciliation.status, 'reconciled')
  assert.equal(result.settlement.compensation.status, 'compensated')
  assert.equal(result.settlement.foreignRecordVisible, false)
})

test('P5.5 fallback fixtures use explicit boundaries and remain isolated from core imports', () => {
  const result = runTypeScriptScenario(`
    const marketplace = (await import('./apps/reference/fallback/marketplace/index.ts')).default
    const messaging = (await import('./apps/reference/fallback/messaging/index.ts')).default
    const settlement = (await import('./apps/reference/fallback/settlement/index.ts')).default
    console.log(JSON.stringify({
      marketplaceExports: Object.keys(marketplace).sort(),
      messagingExports: Object.keys(messaging).sort(),
      settlementExports: Object.keys(settlement).sort(),
    }))
  `)

  assert.deepEqual(result.marketplaceExports, ['createMarketplaceFallbackFixture', 'default'])
  assert.deepEqual(result.messagingExports, [
    'createMessagingCapabilityFixture',
    'createMessagingFallbackFixture',
    'default',
  ])
  assert.deepEqual(result.settlementExports, ['createSettlementFallbackFixture', 'default'])
})

test('P5.5 fallback fixtures can triangulate tenant boundaries with a second deterministic context', () => {
  const result = runTypeScriptScenario(`
    const { createMarketplaceFallbackFixture } = (await import('./apps/reference/fallback/marketplace/index.ts')).default
    const { createMessagingCapabilityFixture } = (await import('./apps/reference/fallback/messaging/index.ts')).default
    const { createSettlementFallbackFixture } = (await import('./apps/reference/fallback/settlement/index.ts')).default
    const options = { tenantId: 'fixture-tenant-b', actorId: 'fixture-actor-b', correlationId: 'fixture-correlation-b' }
    const marketplace = createMarketplaceFallbackFixture(options)
    const messaging = createMessagingCapabilityFixture(options)
    const settlement = createSettlementFallbackFixture(options)
    console.log(JSON.stringify({ marketplace, messaging, settlement }))
  `)

  assert.equal(result.marketplace.context.tenantId, 'fixture-tenant-b')
  assert.equal(result.marketplace.records[0].ownerTenantId, 'fixture-tenant-b')
  assert.equal(result.messaging.context.actorId, 'fixture-actor-b')
  assert.equal(result.messaging.delivery.tenantId, 'fixture-tenant-b')
  assert.equal(result.settlement.context.correlationId, 'fixture-correlation-b')
  assert.equal(result.settlement.record.ownerTenantId, 'fixture-tenant-b')
})

test('P5.5 core source has no fallback imports or vertical vocabulary', () => {
  const corePaths = [
    'apps/reference/api/src',
    'apps/reference/web/src',
    'apps/reference/mobile/src',
    'apps/web/src/lib/neutral-contract-client.ts',
    'apps/mobile/src/application/neutral-contract-client.ts',
    'packages/config/src',
    'packages/contracts/src/base.ts',
    'packages/contracts/src/index.ts',
    'packages/contracts/traceability',
    'packages/observability/src',
  ]
  const source = corePaths
    .flatMap((path) => filesIn(path))
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .map((path) => readFileSync(join(root, path), 'utf8'))
    .join('\n')

  assert.doesNotMatch(source, /apps[\\/]reference[\\/]fallback/i)
  assert.doesNotMatch(
    source,
    /\b(?:marketplace|settlement|tusservicios|alqui|travelers|docphone|medical|companion)\b/i
  )
})
