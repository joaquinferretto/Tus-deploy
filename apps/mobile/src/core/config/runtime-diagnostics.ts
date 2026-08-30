import { TUS_CONTRACT_VERSION, type TusSessionState } from '@factory/contracts'

import {
  MOBILE_RUNTIME_CONTRACT_VERSION,
  MOBILE_RUNTIME_STORAGE_VERSION,
  MobileRuntimeConfigError,
  parseMobileRuntimeConfig,
  type MobileRuntimeConfig,
} from './runtime-profile'

export const MOBILE_POS_ROUTE = '/tus/v1/pos/manual-operations' as const

const RUNTIME_DIAGNOSTIC_STATUS = {
  VALID: 'valid',
  INVALID: 'invalid',
} as const

const RUNTIME_DIAGNOSTIC_REASON = {
  VALIDATED: 'validated',
  CONFIGURATION: 'configuration',
  BOOTSTRAP: 'bootstrap',
} as const

export type RuntimeDiagnosticStatus = (typeof RUNTIME_DIAGNOSTIC_STATUS)[keyof typeof RUNTIME_DIAGNOSTIC_STATUS]
export type RuntimeDiagnosticReason = (typeof RUNTIME_DIAGNOSTIC_REASON)[keyof typeof RUNTIME_DIAGNOSTIC_REASON]

export interface MobileRuntimeDiagnostics {
  status: RuntimeDiagnosticStatus
  reason: RuntimeDiagnosticReason
  profile: MobileRuntimeConfig['profile'] | null
  apiUrl: string | null
  requireTls: boolean | null
  storageVersion: number | null
  tusContractVersion: string | null
  posRoute: typeof MOBILE_POS_ROUTE
  message: string
}

export interface MobileBootstrapDependencies {
  readRuntime: () => unknown
  initializePersistence: (runtime: MobileRuntimeConfig) => Promise<void>
  restoreSession: (runtime: MobileRuntimeConfig) => Promise<TusSessionState>
  onDiagnostics?: (diagnostics: MobileRuntimeDiagnostics) => void
}

export interface MobileBootstrapReadyResult {
  status: 'ready'
  runtime: MobileRuntimeConfig
  diagnostics: MobileRuntimeDiagnostics
  sessionState: TusSessionState
}

export interface MobileBootstrapUnavailableResult {
  status: 'unavailable'
  diagnostics: MobileRuntimeDiagnostics
  sessionState?: undefined
}

export type MobileBootstrapResult = MobileBootstrapReadyResult | MobileBootstrapUnavailableResult

export function createRuntimeDiagnostics(value: unknown): MobileRuntimeDiagnostics {
  if (value instanceof MobileRuntimeConfigError) {
    return createConfigurationDiagnostics(value)
  }

  try {
    const runtime = parseMobileRuntimeConfig(value)
    if (runtime.tusContractVersion !== MOBILE_RUNTIME_CONTRACT_VERSION || runtime.tusContractVersion !== TUS_CONTRACT_VERSION) {
      return createConfigurationDiagnostics(new MobileRuntimeConfigError('tusContractVersion', 'unsupported TUS contract version'))
    }
    if (runtime.storageVersion !== MOBILE_RUNTIME_STORAGE_VERSION) {
      return createConfigurationDiagnostics(new MobileRuntimeConfigError('storageVersion', 'unsupported mobile storage version'))
    }
    return createValidDiagnostics(runtime)
  } catch (error: unknown) {
    return createConfigurationDiagnostics(error)
  }
}

export function createBootstrapFailureDiagnostics(_error: unknown, runtime?: MobileRuntimeConfig): MobileRuntimeDiagnostics {
  const apiUrl = runtime === undefined ? null : redactRuntimeEndpoint(runtime.apiUrl)
  return {
    status: RUNTIME_DIAGNOSTIC_STATUS.INVALID,
    reason: RUNTIME_DIAGNOSTIC_REASON.BOOTSTRAP,
    profile: runtime?.profile ?? null,
    apiUrl,
    requireTls: runtime?.requireTls ?? null,
    storageVersion: runtime?.storageVersion ?? null,
    tusContractVersion: runtime?.tusContractVersion ?? null,
    posRoute: MOBILE_POS_ROUTE,
    message: 'Mobile runtime is unavailable while preparing secure storage or restoring the session. Check the app configuration and restart. No further authenticated or queue operations will be attempted.',
  }
}

export function redactRuntimeEndpoint(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || url.search || url.hash) return null
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export async function bootstrapMobileRuntime(dependencies: MobileBootstrapDependencies): Promise<MobileBootstrapResult> {
  let candidate: unknown
  try {
    candidate = dependencies.readRuntime()
  } catch (error: unknown) {
    return unavailable(dependencies, createRuntimeDiagnostics(error))
  }

  const diagnostics = createRuntimeDiagnostics(candidate)
  if (diagnostics.status === RUNTIME_DIAGNOSTIC_STATUS.INVALID) {
    return unavailable(dependencies, diagnostics)
  }

  const runtime = parseMobileRuntimeConfig(candidate)
  dependencies.onDiagnostics?.(diagnostics)

  try {
    await dependencies.initializePersistence(runtime)
    const sessionState = await dependencies.restoreSession(runtime)
    return { status: 'ready', runtime, diagnostics, sessionState }
  } catch (error: unknown) {
    return unavailable(dependencies, createBootstrapFailureDiagnostics(error, runtime))
  }
}

function createValidDiagnostics(runtime: MobileRuntimeConfig): MobileRuntimeDiagnostics {
  const apiUrl = redactRuntimeEndpoint(runtime.apiUrl)
  if (apiUrl === null) {
    return createConfigurationDiagnostics(new MobileRuntimeConfigError('apiUrl', 'endpoint cannot be safely displayed'))
  }

  return {
    status: RUNTIME_DIAGNOSTIC_STATUS.VALID,
    reason: RUNTIME_DIAGNOSTIC_REASON.VALIDATED,
    profile: runtime.profile,
    apiUrl,
    requireTls: runtime.requireTls,
    storageVersion: runtime.storageVersion,
    tusContractVersion: runtime.tusContractVersion,
    posRoute: MOBILE_POS_ROUTE,
    message: `Mobile runtime ready for ${runtime.profile}: API ${apiUrl}; TLS ${runtime.requireTls ? 'required' : 'optional'}; storage ${runtime.storageVersion}; TUS ${runtime.tusContractVersion}; POS ${MOBILE_POS_ROUTE}.`,
  }
}

function createConfigurationDiagnostics(error: unknown): MobileRuntimeDiagnostics {
  const field = error instanceof MobileRuntimeConfigError ? safeField(error.field) : 'runtime configuration'
  return {
    status: RUNTIME_DIAGNOSTIC_STATUS.INVALID,
    reason: RUNTIME_DIAGNOSTIC_REASON.CONFIGURATION,
    profile: null,
    apiUrl: null,
    requireTls: null,
    storageVersion: null,
    tusContractVersion: null,
    posRoute: MOBILE_POS_ROUTE,
    message: `Mobile runtime configuration rejected (${field}). Check APP_PROFILE, the API endpoint, and TLS settings, then restart. No authenticated or queue operations were started.`,
  }
}

function unavailable(dependencies: MobileBootstrapDependencies, diagnostics: MobileRuntimeDiagnostics): MobileBootstrapUnavailableResult {
  dependencies.onDiagnostics?.(diagnostics)
  return { status: 'unavailable', diagnostics }
}

function safeField(field: string): string {
  const allowedFields = new Set(['profile', 'apiUrl', 'requireTls', 'offlineCache', 'mockAuth', 'featureFlags', 'storageVersion', 'tusContractVersion'])
  return allowedFields.has(field) ? field : 'runtime configuration'
}
