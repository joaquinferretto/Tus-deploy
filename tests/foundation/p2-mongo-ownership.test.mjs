import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

test('P2.2 exposes explicit Mongo ownership and rejects undocumented collections', () => {
  const result = runTypeScriptScenario(`
    const { MONGO_COLLECTION, ownershipForMongoCollection } = (await import('./apps/api/src/data/ownership/mongo-ownership.ts')).default
    let unknownCode
    try { ownershipForMongoCollection('unlisted') } catch (error) { unknownCode = error.code }
    console.log(JSON.stringify({
      documents: ownershipForMongoCollection(MONGO_COLLECTION.OWNED_DOCUMENTS),
      projection: ownershipForMongoCollection(MONGO_COLLECTION.TENANT_READ_MODEL),
      unknownCode,
    }))
  `)

  assert.deepEqual(result.documents, {
    collection: 'owned_documents',
    owner: 'mongodb',
    dataClass: 'document',
    sourceOfTruth: 'mongodb',
    rebuildStrategy: 'restore-mongodb-backup',
    tenantScoped: true,
  })
  assert.deepEqual(result.projection, {
    collection: 'tenant_read_model',
    owner: 'mongodb',
    dataClass: 'read-model',
    sourceOfTruth: 'postgresql',
    rebuildStrategy: 'replay-postgres-outbox',
    tenantScoped: true,
  })
  assert.equal(result.unknownCode, 'UNKNOWN_MONGO_COLLECTION')
})

test('P2.2 requires a tenant filter and rejects missing or incorrect tenant predicates', () => {
  const result = runTypeScriptScenario(`
    const { buildTenantFilter } = (await import('./apps/api/src/data/mongo/ports/tenant-filter.ts')).default
    const errors = []
    for (const input of [
      () => buildTenantFilter(''),
      () => buildTenantFilter('tenant-a', { tenantId: 'tenant-b' }),
    ]) {
      try { input() } catch (error) { errors.push({ code: error.code, message: error.message }) }
    }
    console.log(JSON.stringify({ filter: buildTenantFilter('tenant-a', { id: 'doc-1' }), errors }))
  `)

  assert.deepEqual(result.filter, { tenantId: 'tenant-a', id: 'doc-1' })
  assert.deepEqual(result.errors.map(({ code }) => code), [
    'MONGO_TENANT_CONTEXT_REQUIRED',
    'MONGO_TENANT_FILTER_MISMATCH',
  ])
})

test('P2.2 fake adapter enforces cross-tenant isolation even when identifiers are guessed', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryMongoDocumentStore } = (await import('./apps/api/src/data/mongo/adapters/in-memory-mongo.ts')).default
    const store = new InMemoryMongoDocumentStore()
    await store.upsert({ id: 'same-id', tenantId: 'tenant-a', collection: 'owned_documents', version: 1, payload: { value: 'a' } })
    await store.upsert({ id: 'same-id', tenantId: 'tenant-b', collection: 'owned_documents', version: 1, payload: { value: 'b' } })
    const a = await store.find({ tenantId: 'tenant-a', id: 'same-id' })
    const b = await store.find({ tenantId: 'tenant-b', id: 'same-id' })
    let unscopedCode
    try { await store.find({ id: 'same-id' }) } catch (error) { unscopedCode = error.code }
    console.log(JSON.stringify({ a, b, unscopedCode }))
  `)

  assert.deepEqual(result.a.map((document) => document.payload), [{ value: 'a' }])
  assert.deepEqual(result.b.map((document) => document.payload), [{ value: 'b' }])
  assert.equal(result.unscopedCode, 'MONGO_TENANT_CONTEXT_REQUIRED')
})

test('P2.2 applies multi-document writes inside a Mongo session transaction', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryMongoDocumentStore } = (await import('./apps/api/src/data/mongo/adapters/in-memory-mongo.ts')).default
    const store = new InMemoryMongoDocumentStore()
    const transaction = await store.withSession(async (session) => {
      await store.upsert({ id: 'one', tenantId: 'tenant-a', collection: 'owned_documents', version: 1, payload: { n: 1 } }, session)
      await store.upsert({ id: 'two', tenantId: 'tenant-a', collection: 'owned_documents', version: 1, payload: { n: 2 } }, session)
      return { sessionId: session.id, supportsTransactions: session.supportsTransactions }
    })
    console.log(JSON.stringify({ transaction, documents: await store.find({ tenantId: 'tenant-a', collection: 'owned_documents' }) }))
  `)

  assert.equal(typeof result.transaction.sessionId, 'string')
  assert.equal(result.transaction.supportsTransactions, true)
  assert.equal(result.documents.length, 2)
})

test('P2.2 session failure rolls back staged writes and exposes a deterministic failed outcome', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryMongoDocumentStore } = (await import('./apps/api/src/data/mongo/adapters/in-memory-mongo.ts')).default
    const store = new InMemoryMongoDocumentStore({ failTransactions: true })
    let errorCode
    try {
      await store.withSession(async (session) => {
        await store.upsert({ id: 'failed', tenantId: 'tenant-a', collection: 'owned_documents', version: 1, payload: { n: 1 } }, session)
      })
    } catch (error) { errorCode = error.code }
    console.log(JSON.stringify({ errorCode, documents: await store.find({ tenantId: 'tenant-a' }) }))
  `)

  assert.equal(result.errorCode, 'MONGO_SESSION_FAILED')
  assert.deepEqual(result.documents, [])
})

test('P2.2 projection rebuild reconciles PostgreSQL outbox events and reports completion', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryMongoDocumentStore } = (await import('./apps/api/src/data/mongo/adapters/in-memory-mongo.ts')).default
    const { InMemoryProjectionSource, ProjectionReconciler } = (await import('./apps/api/src/data/mongo/reconciliation/projection-reconciler.ts')).default
    const store = new InMemoryMongoDocumentStore()
    const source = new InMemoryProjectionSource([
      { eventId: 'event-1', tenantId: 'tenant-a', collection: 'tenant_read_model', documentId: 'doc-1', version: 1, operation: 'upsert', payload: { status: 'ready' } },
      { eventId: 'event-2', tenantId: 'tenant-a', collection: 'tenant_read_model', documentId: 'doc-1', version: 2, operation: 'upsert', payload: { status: 'done' } },
    ])
    const report = await new ProjectionReconciler(store, source).rebuild({ tenantId: 'tenant-a', collection: 'tenant_read_model' })
    console.log(JSON.stringify({ report, documents: await store.find({ tenantId: 'tenant-a', collection: 'tenant_read_model' }) }))
  `)

  assert.equal(result.report.status, 'completed')
  assert.equal(result.report.applied, 2)
  assert.equal(result.report.failed, 0)
  assert.equal(result.documents[0].version, 2)
  assert.deepEqual(result.documents[0].payload, { status: 'done' })
})

test('P2.2 Mongo outage is unavailable and leaves PostgreSQL projection events retryable', () => {
  const result = runTypeScriptScenario(`
    const { UnavailableMongoDocumentStore } = (await import('./apps/api/src/data/mongo/adapters/unavailable-mongo.ts')).default
    const { InMemoryProjectionSource, ProjectionReconciler } = (await import('./apps/api/src/data/mongo/reconciliation/projection-reconciler.ts')).default
    const source = new InMemoryProjectionSource([{ eventId: 'event-1', tenantId: 'tenant-a', collection: 'tenant_read_model', documentId: 'doc-1', version: 1, operation: 'upsert', payload: { status: 'ready' } }])
    const report = await new ProjectionReconciler(new UnavailableMongoDocumentStore('local Mongo is not activated'), source).rebuild({ tenantId: 'tenant-a', collection: 'tenant_read_model' })
    console.log(JSON.stringify({ report, pending: source.pending('tenant-a', 'tenant_read_model') }))
  `)

  assert.equal(result.report.status, 'unavailable')
  assert.equal(result.report.applied, 0)
  assert.equal(result.report.failed, 1)
  assert.equal(result.report.retryable, true)
  assert.equal(result.pending, 1)
})
