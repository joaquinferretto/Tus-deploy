import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveSafeTarget } from '../test-runner-lib.mjs'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const packageManagerCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const SAFE_NATIVE_ENV_KEYS = Object.freeze([
  'PATH', 'Path', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'API_PORT', 'NODE_ENV',
  'TUS_TEST_TARGET_IDENTITY', 'TUS_TEST_TARGET_ID', 'TUS_TEST_TARGET_OWNER',
  'TUS_TEST_TARGET_DISPOSABLE', 'TUS_TEST_TARGET_ENV', 'TUS_TEST_TARGET_NON_PRODUCTION',
])

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
  return readRootDatabaseUrl(rootDirectory)
}

export function resolveNativeSafeTarget({ rootDirectory = repositoryRoot, processEnv = process.env } = {}) {
  return resolveSafeTarget({ rootDirectory, environment: processEnv })
}

export function buildNativeChildEnvironment({ baseEnvironment = process.env, databaseUrl, proof = {} } = {}) {
  const environment = Object.fromEntries(
    SAFE_NATIVE_ENV_KEYS
      .filter((name) => typeof baseEnvironment?.[name] === 'string' && baseEnvironment[name].length > 0)
      .map((name) => [name, baseEnvironment[name]]),
  )
  for (const name of SAFE_NATIVE_ENV_KEYS.filter((key) => key.startsWith('TUS_TEST_'))) {
    if (typeof proof[name] === 'string' && proof[name].length > 0) environment[name] = proof[name]
  }
  if (databaseUrl) environment.DATABASE_URL = databaseUrl
  return environment
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
  const target = resolveNativeSafeTarget()
  if (databaseUrl && target.status !== 'ready') throw new Error(`Native profile database target rejected: ${target.reason}`)
  const env = buildNativeChildEnvironment({ databaseUrl })
  env.NATIVE_PROFILE = '1'

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
