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

function context(tenantId, actorId, permissions = ['asset:read', 'asset:write', 'asset:delete']) {
  return {
    tenantId,
    workspaceId: `${tenantId}-workspace`,
    actorId,
    correlationId: `${tenantId}-${actorId}`,
    permissions,
  }
}

function metadata(assetId, tenantId, workspaceId = `${tenantId}-workspace`) {
  return {
    contractVersion: '1.0.0',
    assetId,
    mimeType: 'application/pdf',
    sourceUri: `b2://${tenantId}/${assetId}`,
    checksum: { algorithm: 'sha256', value: '0123456789abcdef0123456789abcdef' },
    sizeBytes: 7,
    capturedAt: '2026-08-24T00:00:00.000Z',
    ownership: { tenantId, workspaceId },
  }
}

test('P2.5 publishes explicit asset metadata, lineage, access, and deletion schemas', () => {
  const names = ['record', 'lineage', 'delete']
  const schemas = names.map((name) =>
    JSON.parse(
      readFileSync(join(root, `packages/contracts/schemas/assets/${name}.schema.json`), 'utf8')
    )
  )

  assert.deepEqual(
    schemas.map((schema) => schema.$id),
    names.map((name) => `https://golden-boilerplate.dev/contracts/assets/${name}.v1.schema.json`)
  )
  assert.ok(
    schemas.every((schema) => schema.type === 'object' && schema.additionalProperties === false)
  )
})

test('asset service enforces ownership/access policy and tenant-isolated durable B2 storage', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAssetService } = (await import('./apps/api/src/platform/assets/composition.ts')).default
    const service = createInMemoryAssetService({ now: () => 100 })
    const owner = ${JSON.stringify(context('tenant-a', 'actor-a'))}
    const other = ${JSON.stringify(context('tenant-b', 'actor-b'))}
    const created = await service.create({ context: owner, metadata: ${JSON.stringify(metadata('asset-a', 'tenant-a'))}, data: 'source-a', retentionUntil: 200 })
    const allowed = await service.get({ context: owner, assetId: 'asset-a' })
    const denied = await service.get({ context: other, assetId: 'asset-a' })
    const source = await service.source.get({ tenantId: 'tenant-a', workspaceId: 'tenant-a-workspace', assetId: 'asset-a' })
    console.log(JSON.stringify({ created: created.ok, key: source?.key, allowed: allowed.ok, denied: denied.code }))
  `)

  assert.deepEqual(result, {
    created: true,
    key: 'tenants/tenant-a/workspaces/tenant-a-workspace/assets/asset-a',
    allowed: true,
    denied: 'NOT_FOUND',
  })
})

test('lineage is tenant-scoped and deletion invalidates descendants without cross-tenant disclosure', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAssetService } = (await import('./apps/api/src/platform/assets/composition.ts')).default
    const service = createInMemoryAssetService({ now: () => 100 })
    const owner = ${JSON.stringify(context('tenant-a', 'actor-a'))}
    const other = ${JSON.stringify(context('tenant-b', 'actor-b'))}
    await service.create({ context: owner, metadata: ${JSON.stringify(metadata('source-a', 'tenant-a'))}, data: 'source' })
    await service.create({ context: owner, metadata: ${JSON.stringify(metadata('derived-a', 'tenant-a'))}, data: 'derived' })
    const lineage = await service.recordLineage({ context: owner, assetId: 'derived-a', parents: [{ assetId: 'source-a', relationship: 'source' }], operation: { stage: 'transform', tool: 'fake-transform', performedBy: 'actor-a', jobId: 'job-a' } })
    const crossTenant = await service.recordLineage({ context: other, assetId: 'derived-a', parents: [{ assetId: 'source-a', relationship: 'source' }], operation: { stage: 'transform', tool: 'fake-transform', performedBy: 'actor-b', jobId: 'job-b' } })
    const deleted = await service.delete({ context: owner, assetId: 'source-a', idempotencyKey: 'delete-source' })
    const events = await service.lineage.list('tenant-a', 'derived-a')
    console.log(JSON.stringify({ lineage: lineage.ok, crossTenant: crossTenant.code, deleted: deleted.ok, invalidated: events[0]?.invalidatedAt }))
  `)

  assert.equal(result.lineage, true)
  assert.equal(result.crossTenant, 'NOT_FOUND')
  assert.equal(result.deleted, true)
  assert.equal(result.invalidated, 100)
})

test('encrypted S3 staging is activation-gated, transient, tenant-scoped, and lifecycle-cleaned', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryS3Staging, S3StagingStorage, StorageActivationError } = (await import('./packages/storage/src/index.ts')).default
    const fake = new InMemoryS3Staging()
    const staging = new S3StagingStorage(fake, { activation: 'enabled', encryptionKeyRef: 'kms/test-key', retentionSeconds: 60 })
    const staged = await staging.put({ tenantId: 'tenant-a', workspaceId: 'workspace-a', assetId: 'asset-a', data: 'temporary', contentType: 'application/pdf', now: 100 })
    const before = await fake.get(staged.key)
    const removed = await staging.cleanup(161)
    const after = await fake.get(staged.key)
    let disabled = false
    try { await new S3StagingStorage(fake, { activation: 'disabled', encryptionKeyRef: 'kms/test-key', retentionSeconds: 60 }).put({ tenantId: 'tenant-a', workspaceId: 'workspace-a', assetId: 'asset-b', data: 'blocked', now: 100 }) } catch (error) { disabled = error instanceof StorageActivationError }
    console.log(JSON.stringify({ key: staged.key, encrypted: before?.metadata.encryptionKeyRef, expiresAt: staged.expiresAt, removed, after, disabled }))
  `)

  assert.equal(result.key, 'staging/tenants/tenant-a/workspaces/workspace-a/assets/asset-a')
  assert.equal(result.encrypted, 'kms/test-key')
  assert.equal(result.expiresAt, 160)
  assert.equal(result.removed, 1)
  assert.equal(result.after, null)
  assert.equal(result.disabled, true)
})

test('asset deletion preserves retryability after a transient provider failure and respects retention isolation', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAssetService } = (await import('./apps/api/src/platform/assets/composition.ts')).default
    const service = createInMemoryAssetService({ now: () => 100 })
    const owner = ${JSON.stringify(context('tenant-a', 'actor-a'))}
    const other = ${JSON.stringify(context('tenant-b', 'actor-b'))}
    await service.create({ context: owner, metadata: ${JSON.stringify(metadata('retry-a', 'tenant-a'))}, data: 'retry', retentionUntil: 200 })
    await service.create({ context: other, metadata: ${JSON.stringify(metadata('expired-b', 'tenant-b'))}, data: 'other', retentionUntil: 50 })
    service.source.failNextDelete = true
    const failed = await service.delete({ context: owner, assetId: 'retry-a', idempotencyKey: 'retry-delete' })
    const recovered = await service.delete({ context: owner, assetId: 'retry-a', idempotencyKey: 'retry-delete' })
    const cleanup = await service.cleanup({ context: owner, now: 300 })
    const otherStillExists = (await service.get({ context: other, assetId: 'expired-b' })).ok
    console.log(JSON.stringify({ failed: failed.code, recovered: recovered.ok, recoveredIdempotent: recovered.idempotent, cleanup: cleanup.deleted, otherStillExists }))
  `)

  assert.equal(result.failed, 'RETRYABLE')
  assert.equal(result.recovered, true)
  assert.equal(result.recoveredIdempotent, true)
  assert.equal(result.cleanup, 0)
  assert.equal(result.otherStillExists, true)
})

test('storage ports and asset domain stay vendor-free while adapters require explicit activation', () => {
  const result = runTypeScriptScenario(`
    const { readFileSync } = await import('node:fs')
    const files = [
      './apps/api/src/platform/assets/domain.ts',
      './apps/api/src/platform/assets/ports.ts',
      './apps/api/src/platform/assets/application/asset-service.ts',
      './packages/storage/src/ports/index.ts',
      './packages/storage/src/b2/index.ts',
      './packages/storage/src/s3-staging/index.ts',
      './packages/storage/src/fakes/index.ts',
    ]
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\\n')
    console.log(JSON.stringify({ forbidden: /@aws-sdk|aws-sdk|boto3|@google-cloud|azure|vendor/i.test(source), activation: source.includes('activation') }))
  `)

  assert.equal(result.forbidden, false)
  assert.equal(result.activation, true)
})
