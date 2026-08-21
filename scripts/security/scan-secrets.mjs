import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const args = new Set(process.argv.slice(2))
const paths = args.has('--tracked')
  ? [...new Set([
      ...execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/),
      ...execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).split(/\r?\n/),
    ].filter(Boolean))]
  : process.argv.slice(2).filter((value) => value !== '--paths')

const ignored = new Set(['.env', '.env.local', '.env.production', '.env.staging'])
const patterns = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)\b\s*=\s*["']?(?!your-|change-|fictitious|example|local:)[A-Za-z0-9+/=_\-.]{20,}/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'](?!your-|change-|fictitious|example|local:)[^"']{16,}["']/i,
]

let findings = 0
for (const path of paths) {
  if (ignored.has(path) || path.endsWith('.env')) continue
  if (!existsSync(path)) continue
  const content = readFileSync(path, 'utf8')
  if (patterns.some((pattern) => pattern.test(content))) {
    // Never print matching content: the scanner reports only the path.
    console.error(`Secret-like content detected in ${path}`)
    findings += 1
  }
}

process.exit(findings === 0 ? 0 : 1)
