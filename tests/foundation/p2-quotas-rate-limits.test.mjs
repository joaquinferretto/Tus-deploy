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

function context(overrides = {}) {
  return {
    profile: 'native',
    tenantId: 'tenant-a',
    productId: 'product-a',
    ...overrides,
  }
}

function policy(overrides = {}) {
  return {
    scope: 'profile',
    scopeId: 'native',
    resource: 'api.requests',
    version: 1,
    limitUnits: 10,
    budgetUnits: 100,
    windowMs: 1_000,
    rateLimit: { maxRequests: 3, windowMs: 1_000 },
    ...overrides,
  }
}

test('P2.8 publishes typed quota, usage, reservation, and rate-limit schemas', () => {
  const names = ['policy', 'reservation', 'usage', 'rate-limit']
  const schemas = names.map((name) =>
    JSON.parse(
      readFileSync(join(root, `packages/contracts/schemas/quotas/${name}.schema.json`), 'utf8')
    )
  )

  assert.deepEqual(
    schemas.map((schema) => schema.$id),
    names.map((name) => `https://golden-boilerplate.dev/contracts/quotas/${name}.v1.schema.json`)
  )
  assert.ok(
    schemas.every((schema) => schema.type === 'object' && schema.additionalProperties === false)
  )
})

test('quota policy resolution is deterministic across product, tenant, and profile scopes', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryQuotaService } = (await import('./apps/api/src/platform/quotas/composition.ts')).default
    const service = createInMemoryQuotaService({ now: () => 100 })
    await service.publishPolicy(${JSON.stringify(policy({ limitUnits: 10 }))})
    await service.publishPolicy(${JSON.stringify(policy({ scope: 'tenant', scopeId: 'tenant-a', limitUnits: 20 }))})
    await service.publishPolicy(${JSON.stringify(policy({ scope: 'product', scopeId: 'product-a', limitUnits: 30 }))})
    const resolved = await service.resolvePolicy(${JSON.stringify(context())}, 'api.requests')
    const otherProduct = await service.resolvePolicy(${JSON.stringify(context({ productId: 'product-b' }))}, 'api.requests')
    const otherTenant = await service.resolvePolicy(${JSON.stringify(context({ tenantId: 'tenant-b', productId: 'product-b' }))}, 'api.requests')
    console.log(JSON.stringify({ resolved: resolved.policy.limitUnits, otherProduct: otherProduct.policy.limitUnits, otherTenant: otherTenant.policy.limitUnits }))
  `)

  assert.deepEqual(result, { resolved: 30, otherProduct: 20, otherTenant: 10 })
})

test('reservation commits usage and cost units while release returns held capacity', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryQuotaService } = (await import('./apps/api/src/platform/quotas/composition.ts')).default
    const service = createInMemoryQuotaService({ now: () => 100 })
    await service.publishPolicy(${JSON.stringify(policy({ limitUnits: 5, budgetUnits: 50 }))})
    const held = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 2, costUnits: 12, now: 100 })
    const released = await service.release({ context: ${JSON.stringify(context())}, reservationId: held.reservation.reservationId, now: 101 })
    const second = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 4, costUnits: 20, now: 102 })
    const committed = await service.commit({ context: ${JSON.stringify(context())}, reservationId: second.reservation.reservationId, now: 103 })
    const usage = await service.usage(${JSON.stringify(context())}, 'api.requests', 103)
    console.log(JSON.stringify({ held: held.ok, released: released.reservation.status, second: second.ok, committed: committed.reservation.status, usage: { units: usage.units, costUnits: usage.costUnits, reservedUnits: usage.reservedUnits } }))
  `)

  assert.deepEqual(result, {
    held: true,
    released: 'released',
    second: true,
    committed: 'committed',
    usage: { units: 4, costUnits: 20, reservedUnits: 0 },
  })
})

test('quota, budget, and deterministic rate-limit exhaustion reject without leaking capacity across tenants', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryQuotaService } = (await import('./apps/api/src/platform/quotas/composition.ts')).default
    const service = createInMemoryQuotaService({ now: () => 100 })
    await service.publishPolicy(${JSON.stringify(policy({ limitUnits: 5, budgetUnits: 20, rateLimit: { maxRequests: 2, windowMs: 1_000 } }))})
    const first = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 2, costUnits: 10, now: 100 })
    const second = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 1, costUnits: 5, now: 101 })
    const rateLimited = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 1, costUnits: 1, now: 102 })
    const otherTenant = await service.reserve({ context: ${JSON.stringify(context({ tenantId: 'tenant-b' }))}, resource: 'api.requests', units: 2, costUnits: 10, now: 103 })
    const nextWindow = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 1, costUnits: 1, now: 1_100 })
    console.log(JSON.stringify({ first: first.ok, second: second.ok, rateLimited: rateLimited.code, otherTenant: otherTenant.ok, nextWindow: nextWindow.ok }))
  `)

  assert.deepEqual(result, {
    first: true,
    second: true,
    rateLimited: 'RATE_LIMITED',
    otherTenant: true,
    nextWindow: true,
  })
})

test('cost budget exhaustion is distinct from unit quota exhaustion and expired reservations release deterministically', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryQuotaService } = (await import('./apps/api/src/platform/quotas/composition.ts')).default
    const service = createInMemoryQuotaService({ now: () => 100, reservationTtlMs: 10 })
    await service.publishPolicy(${JSON.stringify(policy({ limitUnits: 100, budgetUnits: 10, rateLimit: { maxRequests: 10, windowMs: 1_000 } }))})
    const held = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 1, costUnits: 9, now: 100 })
    const budget = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 1, costUnits: 2, now: 101 })
    const expired = await service.release({ context: ${JSON.stringify(context())}, reservationId: held.reservation.reservationId, now: 111 })
    const available = await service.reserve({ context: ${JSON.stringify(context())}, resource: 'api.requests', units: 1, costUnits: 10, now: 112 })
    console.log(JSON.stringify({ budget: budget.code, expired: expired.reservation.status, available: available.ok }))
  `)

  assert.deepEqual(result, { budget: 'BUDGET_EXCEEDED', expired: 'expired', available: true })
})

test('activation-gated quota adapter refuses live work without credentials or activation', () => {
  const result = runTypeScriptScenario(`
    const { ActivationGatedQuotaAdapter, QuotaProviderUnavailableError } = (await import('./apps/api/src/platform/quotas/adapters/activation-gated.ts')).default
    const adapter = new ActivationGatedQuotaAdapter({ activation: 'disabled', configRef: 'secret://quota-provider' }, { record: async () => undefined })
    let code = ''
    try { await adapter.record({ tenantId: 'tenant-a', resource: 'api.requests', units: 1, costUnits: 1 }) } catch (error) { code = error instanceof QuotaProviderUnavailableError ? error.code : 'WRONG_ERROR' }
    console.log(JSON.stringify({ code, configRef: adapter.configRef }))
  `)

  assert.deepEqual(result, { code: 'PROVIDER_UNAVAILABLE', configRef: 'secret://quota-provider' })
})

test('quota domain, application, and fake adapters remain vendor-free', () => {
  const result = runTypeScriptScenario(`
    const { readFileSync } = await import('node:fs')
    const files = [
      './apps/api/src/platform/quotas/domain.ts',
      './apps/api/src/platform/quotas/ports.ts',
      './apps/api/src/platform/quotas/application/quota-service.ts',
      './apps/api/src/platform/quotas/adapters/in-memory.ts',
      './apps/api/src/platform/quotas/adapters/activation-gated.ts',
    ]
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\\n')
    console.log(JSON.stringify({ forbidden: /@aws-sdk|aws-sdk|boto3|@google-cloud|azure/i.test(source), activation: source.includes('activation') }))
  `)

  assert.deepEqual(result, { forbidden: false, activation: true })
})
