import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

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

function revision(overrides = {}) {
  return {
    scope: 'profile',
    profile: 'native',
    version: 1,
    requiredKeys: ['database.provider'],
    values: { 'database.provider': 'local', 'feature.region': 'test' },
    flags: { 'catalog.v2': false },
    ...overrides,
  }
}

test('P2.7 exposes typed profile, tenant, product scopes and deterministic flag resolution', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryConfigurationService } = (await import('./apps/api/src/platform/configuration/composition.ts')).default
    const service = createInMemoryConfigurationService()
    await service.publish(${JSON.stringify(revision({ values: { 'database.provider': 'local', color: 'blue' }, flags: { 'catalog.v2': false, 'search.v2': false } }))})
    await service.publish(${JSON.stringify(revision({ scope: 'tenant', tenantId: 'tenant-a', version: 1, values: { color: 'green' }, flags: { 'search.v2': true } }))})
    await service.publish(${JSON.stringify(revision({ scope: 'product', tenantId: 'tenant-a', productId: 'product-a', version: 1, values: { color: 'purple' }, flags: { 'catalog.v2': true } }))})
    const resolved = await service.resolve({ profile: 'native', tenantId: 'tenant-a', productId: 'product-a' })
    const otherTenant = await service.resolve({ profile: 'native', tenantId: 'tenant-b', productId: 'product-b' })
    console.log(JSON.stringify({
      color: resolved.values.color,
      flags: resolved.flags,
      otherColor: otherTenant.values.color,
      otherFlags: otherTenant.flags,
      versions: resolved.versions,
    }))
  `)

  assert.deepEqual(result, {
    color: 'purple',
    flags: { 'catalog.v2': true, 'search.v2': true },
    otherColor: 'blue',
    otherFlags: { 'catalog.v2': false, 'search.v2': false },
    versions: { profile: 1, tenant: 1, product: 1 },
  })
})

test('P2.7 resolves the same result regardless of insertion order', () => {
  const result = runTypeScriptScenario(`
    const { resolveConfigurationLayers } = await import('./packages/config/src/feature-flags.ts')
    const context = { profile: 'render-native', tenantId: 'tenant-a', productId: 'product-a' }
    const layers = [
      { scope: 'profile', profile: 'render-native', version: 4, requiredKeys: [], values: { z: 3, a: 1 }, flags: { beta: false, stable: true } },
      { scope: 'tenant', profile: 'render-native', tenantId: 'tenant-a', version: 2, requiredKeys: [], values: { z: 4 }, flags: { beta: true } },
      { scope: 'product', profile: 'render-native', tenantId: 'tenant-a', productId: 'product-a', version: 7, requiredKeys: [], values: { a: 9 }, flags: { stable: false } },
    ]
    const first = resolveConfigurationLayers(layers, context)
    const second = resolveConfigurationLayers([...layers].reverse(), context)
    console.log(JSON.stringify({ first, equal: JSON.stringify(first) === JSON.stringify(second) }))
  `)

  assert.equal(result.equal, true)
  assert.deepEqual(result.first.values, { a: 9, z: 4 })
  assert.deepEqual(result.first.flags, { beta: true, stable: false })
})

test('P2.7 fails fast on invalid scopes and missing required configuration without exposing values', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryConfigurationService } = (await import('./apps/api/src/platform/configuration/composition.ts')).default
    const service = createInMemoryConfigurationService()
    const errors = []
    for (const input of [
      ${JSON.stringify(revision({ scope: 'tenant', tenantId: '', values: { 'database.provider': 'local' } }))},
      ${JSON.stringify(revision({ requiredKeys: ['secret.store.ref'], values: { 'database.provider': 'local' } }))},
    ]) {
      try { await service.publish(input) } catch (error) { errors.push(error.message) }
    }
    console.log(JSON.stringify({ errors }))
  `)

  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0], /tenantId|required/i)
  assert.match(result.errors[1], /secret\.store\.ref|required/i)
  assert.doesNotMatch(result.errors.join(' '), /secret-value|database-password/i)
})

test('P2.7 versions are reversible and rollback preserves the previous configuration', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryConfigurationService } = (await import('./apps/api/src/platform/configuration/composition.ts')).default
    const service = createInMemoryConfigurationService()
    await service.publish(${JSON.stringify(revision({ values: { 'database.provider': 'local', color: 'blue' }, flags: { beta: false } }))})
    await service.publish(${JSON.stringify(revision({ version: 2, values: { 'database.provider': 'local', color: 'red' }, flags: { beta: true } }))})
    const before = await service.resolve({ profile: 'native' })
    const rolledBack = await service.rollback({ profile: 'native', targetVersion: 1 })
    const after = await service.resolve({ profile: 'native' })
    console.log(JSON.stringify({ before: before.values.color, beforeFlag: before.flags.beta, rollback: rolledBack.version, after: after.values.color, afterFlag: after.flags.beta, activeVersion: after.versions.profile }))
  `)

  assert.deepEqual(result, {
    before: 'red',
    beforeFlag: true,
    rollback: 1,
    after: 'blue',
    afterFlag: false,
    activeVersion: 1,
  })
})

test('P2.7 configuration and flag boundaries remain provider-free', () => {
  const result = runTypeScriptScenario(`
    const { readFileSync } = await import('node:fs')
    const files = [
      './packages/config/src/feature-flags.ts',
      './apps/api/src/platform/flags/domain.ts',
      './apps/api/src/platform/flags/ports.ts',
      './apps/api/src/platform/configuration/domain.ts',
      './apps/api/src/platform/configuration/ports.ts',
      './apps/api/src/platform/configuration/adapters/in-memory.ts',
      './apps/api/src/platform/configuration/application/configuration-service.ts',
    ]
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\\n')
    console.log(JSON.stringify({ forbidden: /@aws-sdk|aws-sdk|boto3|@google-cloud|azure|redis|prisma|mongoose/i.test(source), hasRollback: source.includes('rollback') }))
  `)

  assert.deepEqual(result, { forbidden: false, hasRollback: true })
})

test('P2.7 package config entrypoint exports feature-flag contracts', async () => {
  const config = await import('../../packages/config/src/index.ts')

  assert.equal(config.DELIVERY_PROFILE.NATIVE, 'native')
  assert.equal(config.CONFIGURATION_SCOPE.PRODUCT, 'product')
})
