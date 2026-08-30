import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

const scope = { tenantId: 'tenant-a', actorId: 'actor-a' }

test('P2.4 builds parameterized SQL for every hot-path family with tenant authorization', () => {
  const result = runTypeScriptScenario(`
    const { buildAvailabilityLockQuery } = (await import('./apps/api/src/data/postgres/sql/locks.ts')).default
    const { buildAggregateQuery, buildWindowQuery } = (await import('./apps/api/src/data/postgres/sql/aggregates.ts')).default
    const { buildBulkUpdateQuery } = (await import('./apps/api/src/data/postgres/sql/bulk.ts')).default
    const { buildFullTextQuery } = (await import('./apps/api/src/data/postgres/sql/full-text.ts')).default
    const { buildGeospatialQuery } = (await import('./apps/api/src/data/postgres/sql/geospatial.ts')).default
    const { buildHotPathQuery } = (await import('./apps/api/src/data/postgres/sql/hot-paths.ts')).default
    const malicious = "x' OR 1=1 --"
    const queries = [
      buildAvailabilityLockQuery({ scope: ${JSON.stringify(scope)}, resourceId: malicious, quantity: 2, now: 100 }),
      buildAggregateQuery({ scope: ${JSON.stringify(scope)}, category: malicious }),
      buildWindowQuery({ scope: ${JSON.stringify(scope)}, category: malicious }),
      buildBulkUpdateQuery({ scope: ${JSON.stringify(scope)}, ids: [malicious], status: malicious, now: 100 }),
      buildFullTextQuery({ scope: ${JSON.stringify(scope)}, search: malicious, limit: 10 }),
      buildGeospatialQuery({ scope: ${JSON.stringify(scope)}, latitude: 1, longitude: 2, radiusKm: 3 }),
      buildHotPathQuery({ scope: ${JSON.stringify(scope)}, resourceId: malicious }),
    ]
    console.log(JSON.stringify(queries.map((query) => ({ operation: query.operation, text: query.text, parameters: query.parameters }))))
  `)

  assert.equal(result.length, 7)
  for (const query of result) {
    assert.match(query.text, /\$1/)
    assert.match(query.text, /\$2/)
    assert.match(query.text, /tenantId/)
    assert.match(query.text, /Membership/)
    assert.doesNotMatch(query.text, /OR 1=1|x'/)
  }
  assert.deepEqual(result[0].parameters.slice(0, 2), ['tenant-a', 'actor-a'])
  assert.equal(result[0].parameters[2], "x' OR 1=1 --")
  assert.equal(result[4].parameters[2], "x' OR 1=1 --")
  assert.deepEqual(
    result.map(({ operation }) => operation),
    ['lock', 'aggregate', 'window', 'bulk', 'full-text', 'geospatial', 'hot-path']
  )
})

test('P2.4 deterministic fake serializes competing reservations and enforces tenant authorization', async () => {
  const result = runTypeScriptScenario(`
    const { InMemorySqlHotPathFake } = (await import('./apps/api/src/data/postgres/sql/fake.ts')).default
    const fake = new InMemorySqlHotPathFake([
      { id: 'inventory-a', tenantId: 'tenant-a', resourceId: 'sku-a', category: 'stock', text: 'Alpha stock', latitude: 1, longitude: 1, amount: 10, available: 1, updatedAt: 1 },
      { id: 'inventory-b', tenantId: 'tenant-b', resourceId: 'sku-a', category: 'stock', text: 'Other tenant', latitude: 1, longitude: 1, amount: 99, available: 1, updatedAt: 1 },
    ], { authorizedActors: { 'tenant-a': ['actor-a'], 'tenant-b': ['actor-b'] } })
    const requests = [1, 2].map((quantity) => fake.reserve({ scope: ${JSON.stringify(scope)}, resourceId: 'sku-a', quantity, now: 100 }))
    const results = await Promise.all(requests)
    const denied = await fake.reserve({ scope: { tenantId: 'tenant-a', actorId: 'actor-b' }, resourceId: 'sku-a', quantity: 1, now: 100 })
    const crossTenant = await fake.hotPath({ scope: ${JSON.stringify(scope)}, resourceId: 'inventory-b' })
    console.log(JSON.stringify({ results, denied, crossTenant }))
  `)

  assert.deepEqual(result.results.map(({ status }) => status).sort(), ['conflict', 'reserved'])
  assert.equal(result.results.filter(({ status }) => status === 'reserved')[0].remaining, 0)
  assert.equal(result.denied.status, 'forbidden')
  assert.equal(result.crossTenant, null)
})

test('P2.4 fake covers CTE/window aggregates, tenant-safe bulk, full text, and geospatial reads', () => {
  const result = runTypeScriptScenario(`
    const { InMemorySqlHotPathFake } = (await import('./apps/api/src/data/postgres/sql/fake.ts')).default
    const fake = new InMemorySqlHotPathFake([
      { id: 'a', tenantId: 'tenant-a', resourceId: 'r-a', category: 'alpha', text: 'Alpha north', latitude: 0, longitude: 0, amount: 5, available: 2, updatedAt: 1 },
      { id: 'b', tenantId: 'tenant-a', resourceId: 'r-b', category: 'alpha', text: 'Alpha south', latitude: 0, longitude: 1, amount: 8, available: 3, updatedAt: 2 },
      { id: 'c', tenantId: 'tenant-b', resourceId: 'r-c', category: 'alpha', text: 'Alpha other', latitude: 0, longitude: 0, amount: 100, available: 9, updatedAt: 3 },
    ], { authorizedActors: { 'tenant-a': ['actor-a'], 'tenant-b': ['actor-b'] } })
    const aggregate = await fake.aggregate({ scope: ${JSON.stringify(scope)}, category: 'alpha' })
    const window = await fake.window({ scope: ${JSON.stringify(scope)}, category: 'alpha' })
    const bulk = await fake.bulkUpdate({ scope: ${JSON.stringify(scope)}, ids: ['a', 'c'], status: 'closed', now: 50 })
    const search = await fake.fullText({ scope: ${JSON.stringify(scope)}, search: 'north' })
    const nearby = await fake.nearby({ scope: ${JSON.stringify(scope)}, latitude: 0, longitude: 0, radiusKm: 100 })
    console.log(JSON.stringify({ aggregate, window, bulk, search: search.map(({ id }) => id), nearby: nearby.map(({ id }) => id) }))
  `)

  assert.deepEqual(result.aggregate, {
    category: 'alpha',
    totalAmount: 13,
    available: 5,
    recordCount: 2,
  })
  assert.deepEqual(
    result.window.map(({ id, rank }) => ({ id, rank })),
    [
      { id: 'b', rank: 1 },
      { id: 'a', rank: 2 },
    ]
  )
  assert.deepEqual(result.bulk, { updated: 1 })
  assert.deepEqual(result.search, ['a'])
  assert.deepEqual(result.nearby, ['a'])
})

test('P2.4 SQL adapters pass typed commands to an injected executor without vendor imports', () => {
  const result = runTypeScriptScenario(`
    const { PostgresLockAdapter } = (await import('./apps/api/src/data/postgres/sql/locks.ts')).default
    const { PostgresAggregateAdapter } = (await import('./apps/api/src/data/postgres/sql/aggregates.ts')).default
    const { PostgresBulkAdapter } = (await import('./apps/api/src/data/postgres/sql/bulk.ts')).default
    const { PostgresFullTextAdapter } = (await import('./apps/api/src/data/postgres/sql/full-text.ts')).default
    const { PostgresGeospatialAdapter } = (await import('./apps/api/src/data/postgres/sql/geospatial.ts')).default
    const { PostgresHotPathAdapter } = (await import('./apps/api/src/data/postgres/sql/hot-paths.ts')).default
    const calls = []
    const executor = { query: async (command) => { calls.push(command); return { rows: [{ id: 'a', status: 'reserved', remaining: 1 }], rowCount: 1 } } }
    await new PostgresLockAdapter(executor).reserve({ scope: ${JSON.stringify(scope)}, resourceId: 'r', quantity: 1, now: 1 })
    await new PostgresAggregateAdapter(executor).aggregate({ scope: ${JSON.stringify(scope)}, category: 'c' })
    await new PostgresBulkAdapter(executor).update({ scope: ${JSON.stringify(scope)}, ids: ['a'], status: 'closed', now: 1 })
    await new PostgresFullTextAdapter(executor).search({ scope: ${JSON.stringify(scope)}, search: 'alpha' })
    await new PostgresGeospatialAdapter(executor).nearby({ scope: ${JSON.stringify(scope)}, latitude: 1, longitude: 2, radiusKm: 3 })
    await new PostgresHotPathAdapter(executor).read({ scope: ${JSON.stringify(scope)}, resourceId: 'a' })
    console.log(JSON.stringify({ operations: calls.map(({ operation }) => operation), scoped: calls.every(({ parameters }) => parameters[0] === 'tenant-a' && parameters[1] === 'actor-a'), hasRawSql: calls.some(({ text }) => text.includes('OR 1=1')) }))
  `)

  assert.deepEqual(result.operations, [
    'lock',
    'aggregate',
    'bulk',
    'full-text',
    'geospatial',
    'hot-path',
  ])
  assert.equal(result.scoped, true)
  assert.equal(result.hasRawSql, false)
})

test('P2.4 SQL boundary remains free of domain/application vendor imports', () => {
  const result = runTypeScriptScenario(`
    const { readFileSync } = await import('node:fs')
    const files = [
      './apps/api/src/data/postgres/sql/contracts.ts',
      './apps/api/src/data/postgres/sql/locks.ts',
      './apps/api/src/data/postgres/sql/aggregates.ts',
      './apps/api/src/data/postgres/sql/bulk.ts',
      './apps/api/src/data/postgres/sql/full-text.ts',
      './apps/api/src/data/postgres/sql/geospatial.ts',
      './apps/api/src/data/postgres/sql/hot-paths.ts',
      './apps/api/src/data/postgres/sql/fake.ts',
    ]
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\\n')
    console.log(JSON.stringify({ forbidden: source.includes("from '@prisma") || source.includes("from 'pg") || source.includes("from 'postgres") || source.includes("from 'mongoose") || source.includes("from 'mongodb") || source.includes("from 'express") }))
  `)

  assert.equal(result.forbidden, false)
})
