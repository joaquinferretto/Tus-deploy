import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const SELECTED_ADDITIVE_MIGRATION = '20260909090000_tus_argentina_market_launch'

export function validateMigrationReleaseEnvironment(environment = process.env) {
  if (environment.TUS_MIGRATION_BACKUP_VERIFIED !== 'true') {
    return { valid: false, reason: 'verified-backup-required' }
  }
  if (environment.TUS_MIGRATION_PLAN !== 'additive-only') {
    return { valid: false, reason: 'additive-only-migration-plan-required' }
  }
  if (environment.TUS_MIGRATION_HISTORY_RECONCILED !== 'true') {
    return { valid: false, reason: 'migration-history-reconciliation-required' }
  }
  if (environment.TUS_MIGRATION_SELECTED !== SELECTED_ADDITIVE_MIGRATION) {
    return { valid: false, reason: 'selected-additive-migration-required' }
  }
  return { valid: true, reason: 'approved-additive-release' }
}

export function runRenderPredeploy({ environment = process.env, platform = process.platform } = {}) {
  const validation = validateMigrationReleaseEnvironment(environment)
  if (!validation.valid) {
    process.stderr.write(`Render migration denied: ${validation.reason}\n`)
    return 1
  }

  const command = platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(command, ['--filter', '@factory/api', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: repositoryRoot,
    env: { ...environment },
    stdio: ['ignore', 'ignore', 'ignore'],
    shell: false,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    process.stderr.write('Render additive migration command failed; diagnostics redacted\n')
    return 1
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = runRenderPredeploy()
}
