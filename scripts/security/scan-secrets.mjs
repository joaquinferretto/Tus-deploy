import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'

const argumentsList = process.argv.slice(2)
const mode = argumentsList.includes('--staged')
  ? 'staged'
  : argumentsList.includes('--tracked')
    ? 'tracked'
    : 'paths'
const explicitPaths = argumentsList.filter((value) => !value.startsWith('--'))
const root = process.cwd()

const secretPatterns = [
  { category: 'AWS key', pattern: /AKIA[0-9A-Z]{16}/ },
  { category: 'provider token', pattern: /(?:ghp_|gho_|github_pat_|xox[baprs]-|npm_|sk_live_)[A-Za-z0-9_-]{16,}/ },
  { category: 'private key', pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----/ },
  { category: 'inline credential', pattern: /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key)\s*[:=]\s*["'](?!your-|change-|fictitious|example|local:)[^"'\r\n]{16,}["']/i },
]

const knownFixtureValues = [
  'fictitious-local-secret-not-for-production',
  'secret-token-must-not-be-quarantined',
  'access-token-placeholder',
  'sandbox-webhook-secret',
  'client-secret-value',
  'webhook-secret-value',
  'APP_USR-seller-access-token',
  'TG-refresh-token',
]

const documentedFixturePaths = [
  'apps/mobile/tests/unit/tus-pos.test.ts',
  'packages/mercado-pago/tests/mercado-pago.test.cjs',
  'tests/foundation/fixtures/mercado-pago-sandbox.mjs',
  'tests/foundation/p6-security.test.mjs',
  'tests/foundation/web-09d-pagos-configuracion.test.mjs',
  'tests/foundation/web-09e-mercado-pago.test.mjs',
]

function withoutKnownFixtures(content, candidatePath) {
  const normalizedPath = candidatePath.replaceAll('\\', '/')
  const isDocumentedFixture = documentedFixturePaths.some((path) => normalizedPath === path || normalizedPath.endsWith(`/${path}`))
    || content.includes('SECURITY_SCAN_FIXTURE')
  if (!isDocumentedFixture) return content
  return knownFixtureValues.reduce(
    (safeContent, fixture) => safeContent.replace(
      new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(fixture)}(?![A-Za-z0-9_-])`, 'gu'),
      'fictitious-fixture',
    ),
    content,
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function hasEnvironmentCredential(content) {
  for (const line of content.split(/\r?\n/gu)) {
    const assignment = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u)
    if (!assignment || !/(?:SECRET|TOKEN|PASSWORD|API_KEY)$/u.test(assignment[1] ?? '')) continue
    const value = (assignment[2] ?? '').replace(/^(["'])(.*)\1$/u, '$2')
    if (!/^[A-Za-z0-9+/=_\-.]+$/u.test(value)) continue
    if (value.length < 20) continue
    if (/^(?:your-|change-|fictitious|example|local:)/iu.test(value)) continue
    return true
  }
  return false
}

function gitPaths(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  } catch {
    return []
  }
}

function isEnvironmentFile(path) {
  const name = basename(path)
  return (name === '.env' || name.startsWith('.env.')) && !name.endsWith('.example')
}

function displayPath(path) {
  return isAbsolute(path) ? path : path.replaceAll('\\', '/')
}

function stagedContent(path) {
  try {
    return execFileSync('git', ['show', `:${path}`], { cwd: root, encoding: 'utf8' })
  } catch {
    return null
  }
}

function readCandidate(path, staged) {
  if (isEnvironmentFile(path)) return null
  if (staged) return stagedContent(path)
  const absolutePath = isAbsolute(path) ? path : join(root, path)
  if (!existsSync(absolutePath)) return null
  return readFileSync(absolutePath, 'utf8')
}

const paths =
  mode === 'tracked'
    ? [
        ...new Set([
          ...gitPaths(['ls-files', '-z']),
          ...gitPaths(['diff', '--cached', '--name-only', '-z']),
        ]),
      ]
    : mode === 'staged'
      ? [...new Set(gitPaths(['diff', '--cached', '--name-only', '-z']))]
      : explicitPaths

let findings = 0
for (const path of paths) {
  const shownPath = displayPath(path)
  if (isEnvironmentFile(path) && (mode === 'tracked' || mode === 'staged')) {
    console.error(`Tracked environment file detected in ${shownPath}`)
    findings += 1
    continue
  }

  const content = readCandidate(path, mode === 'tracked' || mode === 'staged')
  const safeContent = content === null ? null : withoutKnownFixtures(content, path)
  const finding = safeContent === null
    ? undefined
    : hasEnvironmentCredential(safeContent)
      ? { category: 'environment credential' }
      : secretPatterns.find(({ pattern }) => pattern.test(safeContent))
  if (finding) {
    // Never print matching content: report only the path and remediation category.
    console.error(`Secret-like ${finding.category} content detected in ${shownPath}`)
    findings += 1
  }
}

process.exit(findings === 0 ? 0 : 1)
