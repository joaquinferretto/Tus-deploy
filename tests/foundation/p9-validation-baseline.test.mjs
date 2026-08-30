import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_TEST_TIMEOUT_MS,
  classifyFailure,
  createFailureRecord,
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

test('explicit test selection is deterministic regardless of argument order', () => {
  const selected = selectTestFiles(root, [
    'tests/foundation/p9-validation-baseline.test.mjs',
    'tests/foundation/p1-auth-lifecycle.test.mjs',
  ])

  assert.deepEqual(selected, [
    'tests/foundation/p1-auth-lifecycle.test.mjs',
    'tests/foundation/p9-validation-baseline.test.mjs',
  ])
})

test('explicit test selection is unique when callers repeat a file', () => {
  const selected = selectTestFiles(root, [
    'tests/foundation/p9-validation-baseline.test.mjs',
    'tests/foundation/p9-validation-baseline.test.mjs',
  ])

  assert.deepEqual(selected, ['tests/foundation/p9-validation-baseline.test.mjs'])
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
    output: 'Expected /Validated 90 JSON Schema contract(s)/ but received Validated 98 JSON Schema contract(s).',
  })

  assert.deepEqual(failure, {
    disposition: 'resolved',
    owner: 'contracts validation',
    cause: 'stale schema-count assertion',
    rerunCommand:
      'pnpm exec node --experimental-strip-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test --test-concurrency=1 tests/foundation/p1-auth-lifecycle.test.mjs',
    blocksCompletion: false,
  })
})

test('runner failure records preserve unexplained failures and rerun guidance', () => {
  const record = createFailureRecord({
    file: 'tests/foundation/new-regression.test.mjs',
    exitCode: 1,
    output: 'AssertionError: unexpected regression',
  })

  assert.deepEqual(record, {
    file: 'tests/foundation/new-regression.test.mjs',
    exitCode: 1,
    disposition: 'unexplained',
    owner: 'validation owner',
    cause: 'unclassified test failure (exit 1)',
    rerunCommand:
      'pnpm exec node --experimental-strip-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test --test-concurrency=1 tests/foundation/new-regression.test.mjs',
    blocksCompletion: true,
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

test('Node 22 strip-only execution loads the TUS WhatsApp action module', () => {
  const modulePath = pathToFileURL(join(root, 'apps/api/src/tus/whatsapp/index.ts')).href
  const output = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      `const loaded = await import(${JSON.stringify(modulePath)}); console.log(JSON.stringify({ service: typeof loaded.TusWhatsAppService === 'function' }))`,
    ],
    { cwd: root, encoding: 'utf8' },
  )

  assert.deepEqual(JSON.parse(output.trim()), { service: true })
})

test('Node 22 strip-only execution loads the TUS reporting dependency used by marketplace tests', () => {
  const modulePath = pathToFileURL(join(root, 'apps/api/src/tus/reporting/index.ts')).href
  const output = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      `const loaded = await import(${JSON.stringify(modulePath)}); console.log(JSON.stringify({ store: typeof loaded.PrismaReportingStore === 'function' }))`,
    ],
    { cwd: root, encoding: 'utf8' },
  )

  assert.deepEqual(JSON.parse(output.trim()), { store: true })
})

test('Node 22 strip-only execution resolves emitted JavaScript specifiers to TypeScript sources', () => {
  const modulePath = pathToFileURL(join(root, 'apps/api/src/auth-security/composition.ts')).href
  const loaderPath = pathToFileURL(join(root, 'scripts/node-strip-types-loader.mjs')).href
  const output = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--experimental-loader',
      loaderPath,
      '--input-type=module',
      '--eval',
      `const loaded = await import(${JSON.stringify(modulePath)}); console.log(JSON.stringify({ factory: typeof loaded.createInMemoryAuthService === 'function' }))`,
    ],
    { cwd: root, encoding: 'utf8' },
  )

  assert.deepEqual(JSON.parse(output.trim()), { factory: true })
})

test('root validation gates declare serial, task-complete commands', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const turbo = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8'))
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')

  assert.equal(packageJson.scripts.build, 'turbo run build --concurrency=1')
  assert.equal(
    packageJson.scripts['test:foundation'],
    'node --experimental-strip-types --experimental-loader ./scripts/node-strip-types-loader.mjs --test tests/foundation/*.test.mjs',
  )
  assert.equal(packageJson.scripts.lint, 'turbo run lint --concurrency=1')
  assert.equal(packageJson.scripts.typecheck, 'turbo run typecheck --concurrency=1')
  assert.deepEqual(turbo.pipeline.typecheck, { dependsOn: ['^build'], outputs: [] })
  assert.match(workspace, /- apps\/\*/) 
  assert.match(workspace, /- packages\/\*/) 
  assert.match(ci, /node-version: 22/) 
  assert.match(ci, /pnpm run typecheck/) 
  assert.match(ci, /pnpm run lint/) 
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
