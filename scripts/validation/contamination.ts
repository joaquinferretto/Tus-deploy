import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export const CONTAMINATION_VALIDATION_VERSION = 'core-contamination.v1'

const CORE_PATHS = [
  'packages/config/src',
  'packages/contracts/src/base.ts',
  'packages/contracts/src/index.ts',
  'packages/contracts/traceability',
  'packages/observability/src',
] as const

const VERTICAL_VOCABULARY =
  /\b(?:marketplace|settlement|tusservicios|alqui|travelers|docphone|medical|companion)\b/i
const FALLBACK_IMPORT =
  /(?:from|import)\s*\(?\s*['"][^'"]*fallback/i

export interface ContaminationFinding {
  path: string
  rule: 'vertical-vocabulary' | 'fallback-import'
  match: string
}

export interface ContaminationReport {
  version: string
  valid: boolean
  scannedFiles: number
  scannedRoots: string[]
  findings: ContaminationFinding[]
  exclusions: string[]
}

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function sourceFiles(rootDirectory: string, path: string): string[] {
  const absolutePath = join(rootDirectory, path)
  if (!existsSync(absolutePath)) return []
  const stat = statSync(absolutePath)
  if (stat.isFile()) return /\.(?:ts|tsx|js|mjs|py)$/.test(path) ? [path] : []

  return readdirSync(absolutePath, { withFileTypes: true })
    .filter((entry) => !['.git', '.next', '.turbo', 'dist', 'node_modules'].includes(entry.name))
    .flatMap((entry) => sourceFiles(rootDirectory, join(path, entry.name)))
}

function findingFor(path: string, source: string): ContaminationFinding[] {
  const findings: ContaminationFinding[] = []
  const vertical = source.match(VERTICAL_VOCABULARY)
  if (vertical) findings.push({ path, rule: 'vertical-vocabulary', match: vertical[0] })

  const fallback = source.match(FALLBACK_IMPORT)
  if (fallback) findings.push({ path, rule: 'fallback-import', match: fallback[0] })
  return findings
}

export function scanContamination(rootDirectory = repositoryRoot()): ContaminationReport {
  const normalizedRoot = resolve(rootDirectory)
  const paths = [...new Set(CORE_PATHS.flatMap((path) => sourceFiles(normalizedRoot, path)))]
  const findings = paths.flatMap((path) => {
    const source = readFileSync(join(normalizedRoot, path), 'utf8')
    return findingFor(path, source)
  })

  return {
    version: CONTAMINATION_VALIDATION_VERSION,
    valid: findings.length === 0,
    scannedFiles: paths.length,
    scannedRoots: [...CORE_PATHS],
    findings,
    exclusions: [
      'node_modules/**',
      'dist/**',
      '.next/**',
      '.turbo/**',
    ],
  }
}

export function formatContaminationReport(report: ContaminationReport): string {
  return JSON.stringify(report, null, 2)
}

export default { scanContamination, formatContaminationReport }

const invokedFile = process.argv[1] === fileURLToPath(import.meta.url)
if (invokedFile) {
  const report = scanContamination()
  process.stdout.write(`${formatContaminationReport(report)}\n`)
  if (!report.valid) process.exitCode = 1
}
