export const MOBILE_PROFILE = {
  DEV: 'dev',
  STAGING: 'staging',
  PROD: 'prod',
} as const

export type MobileProfile = (typeof MOBILE_PROFILE)[keyof typeof MOBILE_PROFILE]

export const MOBILE_RUNTIME_STORAGE_VERSION = 1 as const
export const MOBILE_RUNTIME_CONTRACT_VERSION = '1.0.0' as const

const PROFILE_DEFAULTS: Record<MobileProfile, { apiUrl: string; requireTls: boolean; mockAuth: boolean }> = {
  dev: { apiUrl: 'http://localhost:3101', requireTls: false, mockAuth: true },
  staging: { apiUrl: 'https://api-staging.example.invalid', requireTls: true, mockAuth: false },
  prod: { apiUrl: '', requireTls: true, mockAuth: false },
}

export interface MobileRuntimeFeatureFlags {
  offlineCache: boolean
  mockAuth: boolean
}

export interface MobileRuntimeConfig {
  profile: MobileProfile
  apiUrl: string
  requireTls: boolean
  storageVersion: typeof MOBILE_RUNTIME_STORAGE_VERSION
  tusContractVersion: typeof MOBILE_RUNTIME_CONTRACT_VERSION
  featureFlags: MobileRuntimeFeatureFlags
}

export interface MobileRuntimeConfigInput {
  profile?: unknown
  appProfile?: unknown
  publicAppProfile?: unknown
  apiUrl?: unknown
  publicApiUrl?: unknown
  requireTls?: unknown
  publicRequireTls?: unknown
  offlineCache?: unknown
  publicOfflineCache?: unknown
  mockAuth?: unknown
  publicMockAuth?: unknown
}

export class MobileRuntimeConfigError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'MobileRuntimeConfigError'
    this.field = field
  }
}

export function resolveMobileRuntimeConfig(input: MobileRuntimeConfigInput = {}): MobileRuntimeConfig {
  const resolvedProfile = resolveSingleValue('profile', [
    ['profile', input.profile],
    ['APP_PROFILE', input.appProfile],
    ['EXPO_PUBLIC_APP_PROFILE', input.publicAppProfile],
  ], parseProfile)
  if (resolvedProfile === undefined) {
    throw new MobileRuntimeConfigError('profile', 'A mobile profile is required; no development fallback is permitted')
  }
  const profile = resolvedProfile
  const defaults = PROFILE_DEFAULTS[profile]
  const apiUrl = resolveSingleValue('apiUrl', [
    ['apiUrl', input.apiUrl],
    ['EXPO_PUBLIC_API_URL', input.publicApiUrl],
  ], parseApiUrl) ?? normalizeApiUrl(defaults.apiUrl)
  const requireTls = resolveSingleValue('requireTls', [
    ['requireTls', input.requireTls],
    ['EXPO_PUBLIC_REQUIRE_TLS', input.publicRequireTls],
  ], parseBoolean) ?? defaults.requireTls

  if (requireTls !== defaults.requireTls) {
    throw new MobileRuntimeConfigError('requireTls', `${profile} requires requireTls=${String(defaults.requireTls)}`)
  }
  if (requireTls && !apiUrl.startsWith('https://')) {
    throw new MobileRuntimeConfigError('apiUrl', `${profile} requires an HTTPS API URL`)
  }
  return {
    profile,
    apiUrl,
    requireTls,
    storageVersion: MOBILE_RUNTIME_STORAGE_VERSION,
    tusContractVersion: MOBILE_RUNTIME_CONTRACT_VERSION,
    featureFlags: {
      offlineCache: resolveSingleValue('offlineCache', [
        ['offlineCache', input.offlineCache],
        ['EXPO_PUBLIC_OFFLINE_CACHE', input.publicOfflineCache],
      ], parseBoolean) ?? true,
      mockAuth: resolveSingleValue('mockAuth', [
        ['mockAuth', input.mockAuth],
        ['EXPO_PUBLIC_ENABLE_MOCK_AUTH', input.publicMockAuth],
      ], parseBoolean) ?? defaults.mockAuth,
    },
  }
}

export function parseMobileRuntimeConfig(value: unknown): MobileRuntimeConfig {
  const record = asRecord(value)
  const featureFlags = asRecord(record['featureFlags'])
  if (!('offlineCache' in featureFlags) || !('mockAuth' in featureFlags)) {
    throw new MobileRuntimeConfigError('featureFlags', 'Serialized mobile runtime feature flags are required')
  }
  const runtime = resolveMobileRuntimeConfig({
    profile: record['profile'],
    apiUrl: record['apiUrl'],
    requireTls: record['requireTls'],
    offlineCache: featureFlags['offlineCache'],
    mockAuth: featureFlags['mockAuth'],
  })

  if (record['storageVersion'] !== MOBILE_RUNTIME_STORAGE_VERSION) {
    throw new MobileRuntimeConfigError('storageVersion', 'Unsupported mobile storage version')
  }
  if (record['tusContractVersion'] !== MOBILE_RUNTIME_CONTRACT_VERSION) {
    throw new MobileRuntimeConfigError('tusContractVersion', 'Unsupported TUS contract version')
  }
  if ('strictTls' in featureFlags && featureFlags['strictTls'] !== runtime.requireTls) {
    throw new MobileRuntimeConfigError('featureFlags.strictTls', 'Serialized TLS flags contradict the runtime identity')
  }

  return runtime
}

export function readMobileRuntimeConfig(): MobileRuntimeConfig {
  const constantsModule = require('expo-constants') as { default?: ExpoConstantsLike } & ExpoConstantsLike
  const constants = constantsModule.default ?? constantsModule
  return parseMobileRuntimeConfig(constants.expoConfig?.extra?.runtime)
}

function resolveSingleValue<T>(field: string, values: Array<[string, unknown]>, parse: (value: unknown, field: string) => T | undefined): T | undefined {
  const parsed = values
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([source, value]) => [source, parse(value, field)] as const)

  if (parsed.length === 0) {
    return undefined
  }

  const first = parsed[0]
  if (first === undefined) {
    throw new MobileRuntimeConfigError(field, `Unable to resolve ${field}`)
  }
  for (const [source, value] of parsed.slice(1)) {
    if (value !== first[1]) {
      throw new MobileRuntimeConfigError(field, `Ambiguous ${field}: ${first[0]} and ${source} disagree`)
    }
  }
  return first[1]
}

function parseProfile(value: unknown, field: string): MobileProfile {
  if (value === MOBILE_PROFILE.DEV || value === MOBILE_PROFILE.STAGING || value === MOBILE_PROFILE.PROD) return value
  throw new MobileRuntimeConfigError(field, `Unknown mobile profile: ${String(value)}`)
}

function parseOptionalString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MobileRuntimeConfigError(field, `${field} must be a non-empty string`)
  }
  return value.trim()
}

function parseApiUrl(value: unknown, field: string): string {
  return normalizeApiUrl(parseOptionalString(value, field))
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  throw new MobileRuntimeConfigError(field, `${field} must be a boolean`)
}

function normalizeApiUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new MobileRuntimeConfigError('apiUrl', 'apiUrl must be a valid absolute URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MobileRuntimeConfigError('apiUrl', 'apiUrl must use HTTP or HTTPS')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new MobileRuntimeConfigError('apiUrl', 'apiUrl must not contain credentials, query parameters, or fragments')
  }
  const pathname = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.host}${pathname}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

interface ExpoConstantsLike {
  expoConfig?: { extra?: { runtime?: unknown } }
}
