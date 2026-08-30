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
  /AKIA[0-9A-Z]{16}/,
  /(?:ghp_|gho_|github_pat_|xox[baprs]-|npm_|sk_live_)[A-Za-z0-9_-]{16,}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)\b\s*=\s*["']?(?!your-|change-|fictitious|example|local:)[A-Za-z0-9+/=_\-.]{20,}/,
  /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key)\s*[:=]\s*["'](?!your-|change-|fictitious|example|local:)[^"']{16,}["']/i,
]

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
  if (content !== null && secretPatterns.some((pattern) => pattern.test(content))) {
    // Never print matching content: report only the path and remediation category.
    console.error(`Secret-like content detected in ${shownPath}`)
    findings += 1
  }
}

process.exit(findings === 0 ? 0 : 1)
