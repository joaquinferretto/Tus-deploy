export {
  CONFIGURATION_ERROR_CODE,
  CONFIGURATION_SCOPE,
  DELIVERY_PROFILE,
  ConfigurationValidationError,
  configurationScopeKey,
  resolveConfigurationLayers,
  validateConfigurationRevision,
  type ConfigurationContext,
  type ConfigurationErrorCode,
  type ConfigurationRevision,
  type ConfigurationScope,
  type ConfigurationValue,
  type DeliveryProfile,
  type ResolvedConfiguration,
} from '@factory/config'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DATABASE_ATTEMPT_TIMEOUT_MS = 60_000 as const
export const DATABASE_MAX_ATTEMPTS = 2 as const
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000 as const

export interface ApiRuntimeConfig {
  databaseUrl: string
  dbAttemptTimeoutMs: typeof DATABASE_ATTEMPT_TIMEOUT_MS
  dbMaxAttempts: typeof DATABASE_MAX_ATTEMPTS
  shutdownTimeoutMs: number
  environment: string
  providersEnabled: false
}

export interface ApiRuntimeConfigOptions {
  rootDirectory?: string
  environment?: Record<string, string | undefined>
  shutdownTimeoutMs?: number
}

export type SeedSafetyReason =
  | 'ready'
  | 'development-environment-required'
  | 'explicit-development-confirmation-required'

/** Read only the canonical database setting from the repository-root .env. */
export function readRootDatabaseUrl(rootDirectory: string = findRepositoryRoot(process.cwd())): string | undefined {
  const envPath = join(rootDirectory, '.env')
  if (!existsSync(envPath)) return undefined

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/u)
    if (!match) continue
    const value = (match[1] ?? '').replace(/^(['"])(.*)\1$/u, '$2').trim()
    return value || undefined
  }

  return undefined
}

export function loadApiRuntimeConfig(options: ApiRuntimeConfigOptions = {}): ApiRuntimeConfig {
  const environment = options.environment ?? process.env
  const environmentName = environment['NODE_ENV'] ?? 'development'
  const databaseUrl = environmentName === 'production'
    ? environment['DATABASE_URL']?.trim()
    : readRootDatabaseUrl(options.rootDirectory)

  if (!databaseUrl) throw new Error('Missing canonical PostgreSQL configuration')
  if (!/^postgres(?:ql)?:\/\//iu.test(databaseUrl)) throw new Error('Invalid canonical PostgreSQL configuration')

  const shutdownTimeoutMs = Number(options.shutdownTimeoutMs ?? environment['SHUTDOWN_TIMEOUT_MS'] ?? DEFAULT_SHUTDOWN_TIMEOUT_MS)
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new Error('Invalid shutdown timeout configuration')
  }

  return {
    databaseUrl,
    dbAttemptTimeoutMs: DATABASE_ATTEMPT_TIMEOUT_MS,
    dbMaxAttempts: DATABASE_MAX_ATTEMPTS,
    shutdownTimeoutMs: Math.min(shutdownTimeoutMs, 120_000),
    environment: environmentName,
    providersEnabled: false,
  }
}

export function validateDevelopmentSeedRequest(input: {
  environment: string
  confirmed: boolean
}): SeedSafetyReason {
  if (input.environment !== 'development') return 'development-environment-required'
  if (!input.confirmed) return 'explicit-development-confirmation-required'
  return 'ready'
}

function findRepositoryRoot(startDirectory: string): string {
  let current = startDirectory
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    const parent = join(current, '..')
    if (parent === current) return startDirectory
    current = parent
  }
}
