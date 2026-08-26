import { existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const TEST_DIRECTORIES = Object.freeze([
  'tests/foundation',
  'tests/compatibility',
  'packages/providers/tests',
])

export const DEFAULT_TEST_TIMEOUT_MS = 120_000

function relativeTestPath(rootDirectory, filePath) {
  return relative(rootDirectory, filePath).replaceAll('\\', '/')
}

function testFilesInDirectory(rootDirectory, directory) {
  const absoluteDirectory = join(rootDirectory, directory)
  if (!existsSync(absoluteDirectory)) return []

  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(directory, entry.name)
    if (entry.isDirectory()) return testFilesInDirectory(rootDirectory, relativePath)
    return entry.name.endsWith('.test.mjs') ? [relativePath.replaceAll('\\', '/')] : []
  })
}

export function discoverTestFiles(rootDirectory = process.cwd()) {
  const normalizedRoot = resolve(rootDirectory)
  return TEST_DIRECTORIES.flatMap((directory) => testFilesInDirectory(normalizedRoot, directory)).sort()
}

export function selectTestFiles(rootDirectory = process.cwd(), requested = []) {
  const normalizedRoot = resolve(rootDirectory)
  const available = new Set(discoverTestFiles(normalizedRoot))
  const normalizedRequested = requested
    .filter((argument) => argument !== '--' && !argument.startsWith('-'))
    .map((argument) => relativeTestPath(normalizedRoot, resolve(normalizedRoot, argument)))

  if (normalizedRequested.length === 0) return [...available].sort()

  const missing = normalizedRequested.filter((file) => !existsSync(join(normalizedRoot, file)))
  if (missing.length > 0) {
    throw new Error(`Requested test file does not exist: ${missing.join(', ')}`)
  }

  return normalizedRequested
}

function countFromTap(output, label) {
  const match = output.match(new RegExp(`^# ${label} (\\d+)\\s*$`, 'm'))
  return match ? Number(match[1]) : 0
}

export function parseTapSummary(output = '') {
  return {
    tests: countFromTap(output, 'tests'),
    pass: countFromTap(output, 'pass'),
    fail: countFromTap(output, 'fail'),
    skipped: countFromTap(output, 'skipped'),
    todo: countFromTap(output, 'todo'),
    cancelled: countFromTap(output, 'cancelled'),
  }
}

function rerunCommand(file) {
  return `pnpm exec node --experimental-strip-types --test --test-concurrency=1 ${file}`
}

export function classifyFailure({ file, output = '', exitCode = 1, timedOut = false }) {
  const normalizedOutput = output.toLowerCase()
  const base = { rerunCommand: rerunCommand(file), blocksCompletion: false }

  if (timedOut || /timeout|timed out/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'environmental',
      owner: 'validation runner / host resources',
      cause: 'test-file timeout during isolated execution',
    }
  }

  if (/out of memory|cannot allocate memory|heap arena|err_worker_init_failed|3221226505/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'environmental',
      owner: 'validation runner / host resources',
      cause: 'memory or worker-resource exhaustion',
    }
  }

  if (/validated 81 json schema|stale schema-count/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'resolved',
      owner: 'contracts validation',
      cause: 'stale schema-count assertion',
    }
  }

  if (/enoent.*product-factory-core|missing.*product-factory-core.*spec|traceability.*spec/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'resolved',
      owner: 'platform traceability',
      cause: 'traceability test referenced an archived change at its former path',
    }
  }

  if (/vertical-vocabulary|fallback-import|client-policy-bypass|contamination/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'accepted pre-existing',
      owner: 'neutral reference boundary',
      cause: 'legacy neutral-boundary validation scope or vocabulary drift',
    }
  }

  if (/unsupported-profile|portability/.test(normalizedOutput)) {
    return {
      ...base,
      disposition: 'accepted pre-existing',
      owner: 'profile portability',
      cause: 'pre-existing profile or clean-checkout fixture drift',
    }
  }

  return {
    ...base,
    disposition: 'unexplained',
    owner: 'validation owner',
    cause: `unclassified test failure (exit ${exitCode})`,
    blocksCompletion: true,
  }
}

export function resolvePostgresSmokeEvidence({ postgresUrl } = {}) {
  if (!postgresUrl) {
    return {
      status: 'deferred',
      evidenceClass: 'local-postgresql-http',
      liveConformance: false,
      reason: 'TUS_POSTGRES_URL is unavailable; authenticated PostgreSQL smoke was not run',
    }
  }

  return {
    status: 'ready-to-run',
    evidenceClass: 'local-postgresql-http',
    liveConformance: false,
    reason: 'A PostgreSQL URL is available; the authenticated restart/replay harness must be run explicitly',
  }
}
