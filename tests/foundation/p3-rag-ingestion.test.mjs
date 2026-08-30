import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

test('P3.7 publishes strict versioned RAG source, document, chunk, and ingest schemas', () => {
  const names = ['source', 'document', 'chunk', 'ingest-result']
  const schemas = names.map((name) =>
    JSON.parse(
      readFileSync(join(root, `packages/contracts/schemas/rag/${name}.v1.schema.json`), 'utf8')
    )
  )

  assert.deepEqual(
    schemas.map((schema) => schema.$id),
    names.map((name) => `https://golden-boilerplate.dev/contracts/rag/${name}.v1.schema.json`)
  )
  assert.ok(
    schemas.every((schema) => schema.type === 'object' && schema.additionalProperties === false)
  )
  assert.ok(schemas.every((schema) => schema.properties.contractVersion.const === '1.0.0'))
  assert.ok(schemas.every((schema) => schema.required.includes('tenantId')))
})

test('P3.7 schemas make B2 ownership, checksum, lineage, retention, quarantine, and recovery explicit', () => {
  const source = JSON.parse(
    readFileSync(join(root, 'packages/contracts/schemas/rag/source.v1.schema.json'), 'utf8')
  )
  const document = JSON.parse(
    readFileSync(join(root, 'packages/contracts/schemas/rag/document.v1.schema.json'), 'utf8')
  )
  const chunk = JSON.parse(
    readFileSync(join(root, 'packages/contracts/schemas/rag/chunk.v1.schema.json'), 'utf8')
  )
  const result = JSON.parse(
    readFileSync(join(root, 'packages/contracts/schemas/rag/ingest-result.v1.schema.json'), 'utf8')
  )

  assert.equal(source.properties.source.const, 'b2')
  assert.deepEqual(source.properties.authorization.required, ['tenantId', 'workspaceId', 'actorId'])
  assert.equal(document.properties.checksum.pattern, '^[a-f0-9]{64}$')
  assert.ok(chunk.required.includes('lineage'))
  assert.deepEqual(result.properties.status.enum, [
    'completed',
    'duplicate',
    'quarantined',
    'partial',
  ])
  assert.ok(
    result.properties.properties?.additionalProperties === false ||
      result.additionalProperties === false
  )
})
