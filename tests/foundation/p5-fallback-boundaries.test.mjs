import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')

function filesIn(path) {
  const absolute = join(root, path)
  const stat = statSync(absolute)
  if (stat.isFile()) return [path]
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => !['.turbo', 'node_modules', 'dist'].includes(entry.name))
    .flatMap((entry) => filesIn(join(path, entry.name)))
}

test('P5.5 core source has no fallback imports or vertical vocabulary', () => {
  const corePaths = [
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

  assert.doesNotMatch(source, /(?:from|import)\s*\(?\s*['"][^'"]*fallback/i)
  assert.doesNotMatch(
    source,
    /\b(?:marketplace|settlement|tusservicios|alqui|travelers|docphone|medical|companion)\b/i
  )
})
