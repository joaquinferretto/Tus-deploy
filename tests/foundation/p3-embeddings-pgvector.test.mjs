import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

test('P3.8 owns vectors and retrieval metadata in PostgreSQL/PGVector with a B2 rebuild path', () => {
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  assert.match(schema, /model RagEmbedding \{/) 
  assert.match(schema, /tenantId\s+String/) 
  assert.match(schema, /embeddingVersion\s+String/) 
  assert.match(schema, /indexVersion\s+String/) 
  assert.match(schema, /sourceChecksum\s+String/) 
  assert.match(schema, /sourceUri\s+String/) 
  assert.match(schema, /vector\s+Unsupported\("vector"\)/)
  assert.match(schema, /@@unique\(\[tenantId, sourceId, chunkIndex, embeddingVersion, indexVersion\]\)/)
})

test('P3.8 migration enables PGVector and indexes every tenant/version boundary', () => {
  const migration = readFileSync(
    join(root, 'apps/api/prisma/migrations/20260824150000_p3_embeddings_pgvector/migration.sql'),
    'utf8',
  )
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS vector/)
  assert.match(migration, /CREATE TABLE "RagEmbedding"/)
  assert.match(migration, /"tenantId" TEXT NOT NULL/)
  assert.match(migration, /"embeddingVersion" TEXT NOT NULL/)
  assert.match(migration, /"indexVersion" TEXT NOT NULL/)
  assert.match(migration, /"vector" vector\(1024\) NOT NULL/)
  assert.match(migration, /RagEmbedding_tenantId_sourceId_chunkIndex_embeddingVersion_indexVersion_key/)
  assert.match(migration, /RagEmbedding_tenantId_indexVersion_idx/)
})
