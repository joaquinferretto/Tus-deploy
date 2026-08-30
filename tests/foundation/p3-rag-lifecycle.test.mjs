import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

test('P3.10 documents source lifecycle, stale reconciliation, and rollback selector', () => {
  const lifecycle = readFileSync(join(root, 'docs/rag/update-delete-reindex.md'), 'utf8')
  assert.match(lifecycle, /B2 as the source of truth/)
  assert.match(lifecycle, /tenant-scoped/)
  assert.match(lifecycle, /last-passing index/i)
  assert.match(lifecycle, /privacy deletion/i)
})

test('P3.10 documents deterministic RAG evaluation dimensions and unavailable adapters', () => {
  const evaluation = readFileSync(join(root, 'docs/rag/evaluations.md'), 'utf8')
  for (const dimension of ['recall', 'tenant isolation', 'citation correctness', 'quality', 'latency', 'cost']) {
    assert.match(evaluation.toLowerCase(), new RegExp(dimension))
  }
  assert.match(evaluation, /deterministic/i)
  assert.match(evaluation, /no live provider/i)
})
