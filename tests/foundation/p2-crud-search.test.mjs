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

test('P2.3 publishes strict CRUD query contracts and canonical schemas', () => {
  const result = runTypeScriptScenario(`
    const { CRUD_FILTER_OPERATOR, CRUD_SORT_DIRECTION, validateCrudQuery } = (await import('./apps/api/src/platform/crud/domain/query.ts')).default
    const definition = { resourceType: 'document', filterableFields: ['status'], sortableFields: ['name', 'id'], searchableFields: ['name', 'description'] }
    const query = validateCrudQuery({ page: 2, pageSize: 5, search: '  alpha  ', filters: [{ field: 'status', operator: 'eq', value: 'ready' }], sort: [{ field: 'name', direction: 'asc' }] }, definition)
    let invalidCode
    try { validateCrudQuery({ filters: [{ field: '__proto__', operator: 'eq', value: 'x' }] }, definition) } catch (error) { invalidCode = error.code }
    console.log(JSON.stringify({ query, invalidCode, operators: CRUD_FILTER_OPERATOR, directions: CRUD_SORT_DIRECTION }))
  `)

  assert.deepEqual(result.query, {
    page: 2,
    pageSize: 5,
    search: 'alpha',
    filters: [{ field: 'status', operator: 'eq', value: 'ready' }],
    sort: [{ field: 'name', direction: 'asc' }, { field: 'id', direction: 'asc' }],
  })
  assert.equal(result.invalidCode, 'CRUD_QUERY_INVALID_FIELD')
  assert.deepEqual(result.operators, { EQ: 'eq', NE: 'ne', CONTAINS: 'contains', STARTS_WITH: 'startsWith', IN: 'in', GT: 'gt', GTE: 'gte', LT: 'lt', LTE: 'lte' })
  assert.deepEqual(result.directions, { ASC: 'asc', DESC: 'desc' })

  const schema = JSON.parse(readFileSync(join(root, 'packages/contracts/schemas/crud/query.schema.json'), 'utf8'))
  assert.equal(schema.$id, 'https://golden-boilerplate.dev/contracts/crud/query.v1.schema.json')
  assert.equal(schema.additionalProperties, false)
})

test('P2.3 rejects missing tenant context, invalid pagination, and filter/search injection boundaries', () => {
  const result = runTypeScriptScenario(`
    const { validateCrudQuery } = (await import('./apps/api/src/platform/crud/domain/query.ts')).default
    const definition = { resourceType: 'document', filterableFields: ['status'], sortableFields: ['id'], searchableFields: ['name'] }
    const errors = []
    for (const input of [
      { page: 0 },
      { pageSize: 101 },
      { filters: [{ field: 'status', operator: 'rawSql', value: 'x' }] },
      { filters: [{ field: 'status', operator: 'contains', value: { $ne: null } }] },
      { search: 'x'.repeat(257) },
    ]) {
      try { validateCrudQuery(input, definition) } catch (error) { errors.push(error.code) }
    }
    console.log(JSON.stringify({ errors }))
  `)

  assert.deepEqual(result.errors, [
    'CRUD_QUERY_INVALID_PAGE',
    'CRUD_QUERY_INVALID_PAGE_SIZE',
    'CRUD_QUERY_INVALID_OPERATOR',
    'CRUD_QUERY_INVALID_VALUE',
    'CRUD_QUERY_SEARCH_TOO_LONG',
  ])
})

test('P2.3 application CRUD is authorized before tenant-scoped deterministic repository access', () => {
  const result = runTypeScriptScenario(`
    const { CrudService } = (await import('./apps/api/src/platform/crud/application/crud-service.ts')).default
    const { InMemoryCrudRepository } = (await import('./apps/api/src/platform/crud/adapters/in-memory-repository.ts')).default
    const repository = new InMemoryCrudRepository()
    const decisions = []
    const authorization = { authorize: async (request) => { decisions.push(request); return { allowed: request.context?.tenantId === 'tenant-a', code: request.context?.tenantId === 'tenant-a' ? 'ALLOWED' : 'FORBIDDEN', reason: request.context?.tenantId === 'tenant-a' ? 'permission_granted' : 'permission_denied' } } }
    const service = new CrudService({ repository, authorization, ids: { next: () => 'generated-id' }, clock: { now: () => 1000 } }, { resourceType: 'document', filterableFields: ['status'], sortableFields: ['name', 'id'], searchableFields: ['name'] })
    const allowed = await service.create({ context: { tenantId: 'tenant-a', actorId: 'actor-a', correlationId: 'corr-a' }, data: { name: 'Alpha', status: 'ready' } })
    const denied = await service.create({ context: { tenantId: 'tenant-b', actorId: 'actor-b', correlationId: 'corr-b' }, data: { name: 'Beta', status: 'ready' } })
    console.log(JSON.stringify({ allowed, denied, decisions: decisions.map(({ action, resourceTenantId }) => ({ action, resourceTenantId })), tenantB: await repository.search('tenant-b', { page: 1, pageSize: 20, filters: [], sort: [{ field: 'id', direction: 'asc' }] }) }))
  `)

  assert.equal(result.allowed.ok, true)
  assert.equal(result.allowed.record.tenantId, 'tenant-a')
  assert.equal(result.denied.code, 'FORBIDDEN')
  assert.equal(result.tenantB.total, 0)
  assert.deepEqual(result.decisions, [
    { action: 'resource:write', resourceTenantId: 'tenant-a' },
    { action: 'resource:write', resourceTenantId: 'tenant-b' },
  ])
})

test('P2.3 deterministic fake preserves tenant isolation, filtering, lexical search, pagination, and tie ordering', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryCrudRepository } = (await import('./apps/api/src/platform/crud/adapters/in-memory-repository.ts')).default
    const repository = new InMemoryCrudRepository()
    for (const record of [
      { id: 'b', tenantId: 'tenant-a', name: 'Beta', status: 'ready', description: 'alpha note' },
      { id: 'a', tenantId: 'tenant-a', name: 'Alpha', status: 'ready', description: 'first' },
      { id: 'c', tenantId: 'tenant-b', name: 'Alpha', status: 'ready', description: 'other' },
      { id: 'd', tenantId: 'tenant-a', name: 'Gamma', status: 'draft', description: 'alpha draft' },
    ]) await repository.create(record)
    const page = await repository.search('tenant-a', { page: 1, pageSize: 2, search: 'alpha', filters: [{ field: 'status', operator: 'eq', value: 'ready' }], sort: [{ field: 'name', direction: 'asc' }, { field: 'id', direction: 'asc' }] })
    const secondPage = await repository.search('tenant-a', { page: 2, pageSize: 2, filters: [], sort: [{ field: 'name', direction: 'asc' }, { field: 'id', direction: 'asc' }] })
    const crossTenant = await repository.findById('tenant-a', 'c')
    console.log(JSON.stringify({ page, secondPage, crossTenant }))
  `)

  assert.deepEqual(result.page.items.map(({ id }) => id), ['a', 'b'])
  assert.equal(result.page.total, 2)
  assert.deepEqual(result.secondPage.items.map(({ id }) => id), ['d'])
  assert.equal(result.secondPage.total, 3)
  assert.equal(result.crossTenant, null)
})

test('P2.3 Prisma adapter compiles allowlisted queries with tenant predicates and deterministic order', () => {
  const result = runTypeScriptScenario(`
    const { PrismaCrudRepository } = (await import('./apps/api/src/platform/crud/adapters/prisma-repository.ts')).default
    const calls = []
    const rows = [{ id: 'a', tenantId: 'tenant-a', name: 'Alpha', status: 'ready' }]
    const delegate = {
      create: async (args) => { calls.push({ method: 'create', args }); return args.data },
      findUnique: async (args) => { calls.push({ method: 'findUnique', args }); return rows[0] },
      update: async (args) => { calls.push({ method: 'update', args }); return args.data },
      delete: async (args) => { calls.push({ method: 'delete', args }); return rows[0] },
      findMany: async (args) => { calls.push({ method: 'findMany', args }); return rows },
      count: async (args) => { calls.push({ method: 'count', args }); return 1 },
    }
    const repository = new PrismaCrudRepository(delegate, { resourceType: 'document', filterableFields: ['status'], sortableFields: ['name', 'id'], searchableFields: ['name'] })
    await repository.create({ id: 'a', tenantId: 'tenant-a', name: 'Alpha', status: 'ready' })
    await repository.findById('tenant-a', 'a')
    await repository.update('tenant-a', 'a', { name: 'Renamed' })
    await repository.delete('tenant-a', 'a')
    await repository.search('tenant-a', { page: 1, pageSize: 10, search: 'alpha', filters: [{ field: 'status', operator: 'eq', value: 'ready' }], sort: [{ field: 'name', direction: 'asc' }, { field: 'id', direction: 'asc' }] })
    console.log(JSON.stringify({ calls }))
  `)

  assert.deepEqual(result.calls.map(({ method }) => method), ['create', 'findUnique', 'update', 'delete', 'findMany', 'count'])
  assert.deepEqual(result.calls[1].args.where, { id: 'a', tenantId: 'tenant-a' })
  assert.deepEqual(result.calls[2].args.where, { id: 'a', tenantId: 'tenant-a' })
  assert.deepEqual(result.calls[3].args.where, { id: 'a', tenantId: 'tenant-a' })
  assert.deepEqual(result.calls[4].args.where, {
    tenantId: 'tenant-a',
    AND: [{ status: 'ready' }, { OR: [{ name: { contains: 'alpha', mode: 'insensitive' } }] }],
  })
  assert.deepEqual(result.calls[4].args.orderBy, [{ name: 'asc' }, { id: 'asc' }])
  assert.equal(result.calls[4].args.skip, 0)
  assert.equal(result.calls[4].args.take, 10)
})

test('P2.3 domain and application remain free of vendor imports', () => {
  const result = runTypeScriptScenario(`
    const { readFileSync } = await import('node:fs')
    const files = ['./apps/api/src/platform/crud/domain/query.ts', './apps/api/src/platform/crud/domain/types.ts', './apps/api/src/platform/crud/application/crud-service.ts', './apps/api/src/platform/crud/ports/repository.ts']
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\\n')
    console.log(JSON.stringify({ forbidden: /@prisma|mongoose|mongodb|\\bSQL\\b|express|vendor/i.test(source) }))
  `)

  assert.equal(result.forbidden, false)
})
