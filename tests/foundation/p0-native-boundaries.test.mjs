import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

test('native documentation separates smoke scope from the Docker Compose gate', () => {
  const runbook = read('docs/runbooks/local-profiles.md')
  const nativeEvidence = read('docs/evidence/native-smoke.md')
  const composeEvidence = read('docs/evidence/compose-smoke.md')

  assert.match(runbook, /cd backend && pnpm run dev/)
  assert.match(runbook, /cd frontend && pnpm run dev/)
  assert.match(runbook, /PostgreSQL.*required/i)
  assert.match(runbook, /MongoDB.*disabled|MongoDB.*fake/i)
  assert.match(nativeEvidence, /native.*smoke/i)
  assert.match(nativeEvidence, /Compose.*open|Compose.*unverified/i)
  assert.match(composeEvidence, /unchecked|unverified|blocked/i)
  assert.match(runbook, /ledger[\s\S]*outbox[\s\S]*DLQ/i)
  assert.match(runbook, /native-p0\.6a-failing/)
  assert.match(runbook, /stops traffic before any partial serving/i)
  assert.match(nativeEvidence, /498 passed, 0 failed, 0 skipped across 88 isolated suites/i)
  assert.match(nativeEvidence, /superseded[\s\S]*29\/29/i)
  assert.match(nativeEvidence, /rollback boundary/i)
})

test('native wrappers have no source or secret copy boundary', () => {
  for (const wrapper of ['backend', 'frontend']) {
    const manifest = read(`${wrapper}/package.json`)
    assert.doesNotMatch(manifest, /\.env/)
    assert.equal(existsSync(join(root, wrapper, 'src')), false)
    assert.equal(existsSync(join(root, wrapper, '.env')), false)
  }
})
