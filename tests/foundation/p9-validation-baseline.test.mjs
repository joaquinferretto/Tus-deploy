import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_TEST_TIMEOUT_MS,
  classifyFailure,
  discoverTestFiles,
  parseTapSummary,
  selectTestFiles,
} from '../../scripts/test-runner-lib.mjs'

const root = join(import.meta.dirname, '..', '..')

test('validation runner discovers deterministic suites in stable order and keeps PostgreSQL smoke separate', () => {
  const files = discoverTestFiles(root)

  assert.ok(files.length > 0)
  assert.deepEqual(files, [...files].sort())
  assert.equal(files.some((file) => file.includes('tests/integration/')), false)
  assert.equal(files.some((file) => file.endsWith('tests/foundation/p9-validation-baseline.test.mjs')), true)
})

test('explicit test selection supports the deferred PostgreSQL smoke boundary', () => {
  const selected = selectTestFiles(root, ['tests/integration/tus/postgres-http-smoke.test.mjs'])

  assert.deepEqual(selected, ['tests/integration/tus/postgres-http-smoke.test.mjs'])
})

test('TAP summaries preserve counts needed for trustworthy evidence', () => {
  const summary = parseTapSummary(`1..4\n# tests 4\n# pass 2\n# fail 1\n# skipped 1\n# todo 0\n`)

  assert.deepEqual(summary, {
    tests: 4,
    pass: 2,
    fail: 1,
    skipped: 1,
    todo: 0,
    cancelled: 0,
  })
})

test('known validation failures receive an owner, disposition, cause, and isolated rerun', () => {
  const failure = classifyFailure({
    file: 'tests/foundation/p1-auth-lifecycle.test.mjs',
    exitCode: 1,
    output: 'Expected /Validated 81 JSON Schema contract(s)/ but received Validated 90 JSON Schema contract(s).',
  })

  assert.deepEqual(failure, {
    disposition: 'resolved',
    owner: 'contracts validation',
    cause: 'stale schema-count assertion',
    rerunCommand: 'pnpm exec node --experimental-strip-types --test --test-concurrency=1 tests/foundation/p1-auth-lifecycle.test.mjs',
    blocksCompletion: false,
  })
})

test('resource failures are isolated and never treated as a pass', () => {
  const failure = classifyFailure({
    file: 'tests/foundation/p8-tus-finance.test.mjs',
    exitCode: 1,
    timedOut: false,
    output: 'fatal error: runtime: cannot allocate memory',
  })

  assert.equal(failure.disposition, 'environmental')
  assert.equal(failure.owner, 'validation runner / host resources')
  assert.match(failure.cause, /memory/i)
  assert.match(failure.rerunCommand, /test-concurrency=1/)
})

test('unknown failures block completion instead of being silently accepted', () => {
  const failure = classifyFailure({
    file: 'tests/foundation/new-regression.test.mjs',
    exitCode: 1,
    output: 'AssertionError: unexpected regression',
  })

  assert.equal(failure.disposition, 'unexplained')
  assert.equal(failure.blocksCompletion, true)
  assert.equal(failure.owner, 'validation owner')
})

test('baseline evidence names the current commands and keeps unavailable live boundaries deferred', () => {
  const evidence = readFileSync(join(root, 'docs/evidence/readiness/validation-baseline.md'), 'utf8')

  assert.match(evidence, /19 audited failures/i)
  assert.match(evidence, /local-deterministic/)
  assert.match(evidence, /local-postgresql-http/)
  assert.match(evidence, /deferred/)
  assert.match(evidence, /Unknown failures.*block/i)
  assert.match(evidence, /pnpm test/)
  assert.match(evidence, new RegExp(`${DEFAULT_TEST_TIMEOUT_MS}ms`))
})
