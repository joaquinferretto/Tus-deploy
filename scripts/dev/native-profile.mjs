import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const packageManagerCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function parseDatabaseLine(line) {
  const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/)
  if (!match) return undefined

  const value = match[1].replace(/^(['"])(.*)\1$/, '$2').trim()
  return value || undefined
}

export function readRootDatabaseUrl(rootDirectory = repositoryRoot) {
  const envPath = join(rootDirectory, '.env')
  if (!existsSync(envPath)) return undefined

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const value = parseDatabaseLine(line)
    if (value !== undefined) return value
  }

  return undefined
}

export function resolveDatabaseUrl({ rootDirectory = repositoryRoot, processEnv = process.env } = {}) {
  const processValue = processEnv.DATABASE_URL?.trim()
  return processValue || readRootDatabaseUrl(rootDirectory)
}

export function formatNativeDiagnostic({ databaseConfigured }) {
  return `native profile database-configured=${databaseConfigured ? 'true' : 'false'}`
}

export function runChild(command, args, { cwd = repositoryRoot, env = process.env } = {}) {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', reject)
    child.on('close', (code) => resolveCode(code ?? 1))
  })
}

export async function runNativeProfile(profile) {
  if (profile !== 'api' && profile !== 'web') {
    throw new Error('Native profile must be api or web')
  }

  const databaseUrl = resolveDatabaseUrl()
  const env = { ...process.env }
  env.NATIVE_PROFILE = '1'
  if (databaseUrl) env.DATABASE_URL = databaseUrl
  else delete env.DATABASE_URL

  console.log(formatNativeDiagnostic({ databaseConfigured: Boolean(databaseUrl) }))
  return runChild(packageManagerCommand, ['run', 'dev'], { cwd: join(repositoryRoot, 'apps', profile), env })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNativeProfile(process.argv[2])
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Native profile failed')
      process.exitCode = 1
    })
}
