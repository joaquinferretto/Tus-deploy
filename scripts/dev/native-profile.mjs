import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAX_CHILD_DEADLINE_MS, OwnedChild, resolveSafeTarget } from '../test-runner-lib.mjs'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const packageManagerCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
export const NATIVE_API_PORT = '3101'
export const NATIVE_WEB_PORT = '3000'
export const NATIVE_WEB_API_URL = 'http://localhost:3101'
const SAFE_NATIVE_ENV_KEYS = Object.freeze([
  'PATH', 'Path', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'API_PORT', 'NODE_ENV', 'FACTORY_PROFILE', 'NEXT_PUBLIC_API_URL',
  'CORS_ORIGINS', 'TUS_ROUTES_ENABLED', 'TUS_PROVIDER_ACTIONS_ENABLED',
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

export function buildNativeChildEnvironment({ baseEnvironment = process.env, databaseUrl, proof = {}, webApiUrl } = {}) {
  const environment = Object.fromEntries(
    SAFE_NATIVE_ENV_KEYS
      .filter((name) => typeof baseEnvironment?.[name] === 'string' && baseEnvironment[name].length > 0)
      .map((name) => [name, baseEnvironment[name]]),
  )
  if (databaseUrl) environment.DATABASE_URL = databaseUrl
  environment.API_PORT = baseEnvironment?.API_PORT || NATIVE_API_PORT
  if (webApiUrl) environment.NEXT_PUBLIC_API_URL = webApiUrl
  return environment
}

export function formatNativeDiagnostic({ databaseConfigured }) {
  return `native profile database-configured=${databaseConfigured ? 'true' : 'false'}`
}

export async function runChild(command, args, {
  cwd = repositoryRoot,
  env = process.env,
  requestMs = MAX_CHILD_DEADLINE_MS,
  shutdownMs = MAX_CHILD_DEADLINE_MS,
} = {}) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: false, windowsHide: true })
  child.spawncwd = cwd
  const owned = new OwnedChild({ child, command, args, cwd, requestMs, shutdownMs })
  let timedOut = false
  let cleanupRequired = false
  let timer
  const completion = new Promise((resolveCode, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      resolveCode(124)
    }, Math.min(Number(requestMs) || MAX_CHILD_DEADLINE_MS, MAX_CHILD_DEADLINE_MS))
    child.once('error', (error) => {
      cleanupRequired = true
      reject(error)
    })
    child.once('close', (code) => resolveCode(code ?? 1))
  })

  try {
    return await completion
  } finally {
    clearTimeout(timer)
    if (timedOut || cleanupRequired) await owned.stop()
  }
}

export async function runNativeProfile(profile) {
  if (profile !== 'api' && profile !== 'web') {
    throw new Error('Native profile must be api or web')
  }

  const databaseUrl = resolveDatabaseUrl()
  const target = resolveNativeSafeTarget()
  if (databaseUrl && target.status !== 'ready') throw new Error(`Native profile database target rejected: ${target.reason}`)
  const env = buildNativeChildEnvironment({
    databaseUrl,
    webApiUrl: profile === 'web' ? process.env.NEXT_PUBLIC_API_URL || NATIVE_WEB_API_URL : undefined,
  })
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
