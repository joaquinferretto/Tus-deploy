import {
  createTusAuthenticatedSession,
  parseTusServerSession,
  parseTusSessionContext,
  TUS_SESSION_STATUS,
  type TusAuthenticatedSession,
  type TusSessionState,
} from '@factory/contracts'
import { parseMobileRuntimeConfig, type MobileRuntimeConfig } from '../core/config/runtime-profile.ts'

export interface MobileAuthCredentialStore {
  getTokenSnapshot(): Promise<{ accessToken: string | null; refreshToken: string | null; expiresAt: number | null }>
  setSessionToken(accessToken: string, expiresAt: number): Promise<void>
  clear(): Promise<void>
}

export interface MobileAuthRequest {
  method: 'GET' | 'POST'
  path: '/auth/sign-in' | '/auth/session' | '/auth/sign-out' | '/auth/register' | '/auth/recovery/request' | '/auth/recovery/complete'
  correlationId: string
  accessToken?: string
  body?: unknown
}

export interface MobileAuthTransport {
  request(input: MobileAuthRequest): Promise<{ status: number; body: unknown }>
}

export interface TusMobileAuthClientOptions {
  credentials: MobileAuthCredentialStore
  runtime?: MobileRuntimeConfig
  transport?: MobileAuthTransport
  createCorrelationId?: () => string
  now?: () => number
  deviceId?: string
  deviceLabel?: string
}

export interface TusMobileAuthClient {
  signIn(input: { email: string; password: string }): Promise<TusSessionState>
  register(input: { email: string; password: string; displayName: string }): Promise<MobileAuthActionState>
  requestRecovery(email: string): Promise<MobileAuthActionState>
  completeRecovery(input: { token: string; newPassword: string }): Promise<MobileAuthActionState>
  restore(): Promise<TusSessionState>
  signOut(): Promise<void>
}

export interface MobileAuthActionState {
  status: 'accepted' | 'error'
  message: string
  code?: string
}

export function createTusMobileAuthClient(options: TusMobileAuthClientOptions): TusMobileAuthClient {
  const runtime = options.runtime === undefined ? undefined : parseMobileRuntimeConfig(options.runtime)
  const transport = options.transport ?? createTusMobileAuthFetchTransport(runtime)
  const createCorrelationId = options.createCorrelationId ?? createDefaultCorrelationId
  const now = options.now ?? (() => Date.now())

  return {
    async register(input) {
      return authAction(transport, createCorrelationId, {
        method: 'POST',
        path: '/auth/register',
        body: input,
      })
    },

    async requestRecovery(email) {
      return authAction(transport, createCorrelationId, {
        method: 'POST',
        path: '/auth/recovery/request',
        body: { email },
      })
    },

    async completeRecovery(input) {
      return authAction(transport, createCorrelationId, {
        method: 'POST',
        path: '/auth/recovery/complete',
        body: input,
      })
    },

    async signIn(input) {
      try {
        const correlationId = createCorrelationId()
        const response = await transport.request({ method: 'POST', path: '/auth/sign-in', correlationId, body: { email: input.email, password: input.password, ...(options.deviceId === undefined ? {} : { deviceId: options.deviceId }), ...(options.deviceLabel === undefined ? {} : { deviceLabel: options.deviceLabel }) } })
        ensureSuccess(response)
        const serverSession = parseTusServerSession(response.body)
        const context = await bootstrapContext(transport, serverSession.accessToken, correlationId)
        if (context.sessionId !== serverSession.id || context.tenantId !== serverSession.tenantId || context.subjectId !== serverSession.accountId) throw new Error('TUS session scope mismatch')
        const session = createTusAuthenticatedSession({ accessToken: serverSession.accessToken, expiresAt: serverSession.expiresAt, context })
        await options.credentials.setSessionToken(session.accessToken, session.expiresAt)
        return authenticatedState(session)
      } catch (error: unknown) {
        return failureState(error, 'Sign-in could not be confirmed by TUS.')
      }
    },

    async restore() {
      let snapshot: { accessToken: string | null; expiresAt: number | null }
      try {
        snapshot = await options.credentials.getTokenSnapshot()
      } catch {
        return state(TUS_SESSION_STATUS.UNAVAILABLE, 'Secure session storage is unavailable. Reauthenticate when it is available.')
      }
      if (snapshot.accessToken === null || snapshot.accessToken.trim().length === 0) return state(TUS_SESSION_STATUS.UNAUTHENTICATED, 'Sign in to enter your TUS workspace.')
      if (snapshot.expiresAt === null || !Number.isFinite(snapshot.expiresAt)) return clearAndState(options.credentials, TUS_SESSION_STATUS.UNAUTHENTICATED, 'Your local session was not valid. Sign in again.')
      if (!Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= now()) return clearAndState(options.credentials, TUS_SESSION_STATUS.EXPIRED, 'Your TUS session expired. Sign in again.')

      try {
        const response = await bootstrapContext(transport, snapshot.accessToken, createCorrelationId())
        return authenticatedState(createTusAuthenticatedSession({ accessToken: snapshot.accessToken, expiresAt: snapshot.expiresAt, context: response }))
      } catch (error: unknown) {
        if (statusOf(error) === 401) return clearAndState(options.credentials, TUS_SESSION_STATUS.EXPIRED, 'Your TUS session is no longer valid. Sign in again.')
        return failureState(error, 'TUS could not restore the session. Try again.')
      }
    },

    async signOut() {
      const snapshot = await options.credentials.getTokenSnapshot().catch(() => null)
      try {
        if (snapshot?.accessToken !== null && snapshot?.accessToken !== undefined) await transport.request({ method: 'POST', path: '/auth/sign-out', correlationId: createCorrelationId(), accessToken: snapshot.accessToken })
      } finally {
        await options.credentials.clear().catch(() => undefined)
      }
    },
  }
}

async function authAction(
  transport: MobileAuthTransport,
  createCorrelationId: () => string,
  input: Omit<MobileAuthRequest, 'correlationId'>,
): Promise<MobileAuthActionState> {
  try {
    const response = await transport.request({ ...input, correlationId: createCorrelationId() })
    ensureSuccess(response)
    return { status: 'accepted', message: 'TUS accepted the request. Continue only after the server confirms the next state.' }
  } catch (error: unknown) {
    const code = safeCode(error)
    return {
      status: 'error',
      message: 'The request could not be completed. Try again or contact support.',
      ...(code === undefined ? {} : { code }),
    }
  }
}

export function createTusMobileAuthFetchTransport(runtime?: MobileRuntimeConfig): MobileAuthTransport {
  const baseUrl = (runtime === undefined ? readExpoRuntime() : parseMobileRuntimeConfig(runtime)).apiUrl
  return {
    async request(input) {
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': input.correlationId }
      if (input.accessToken !== undefined) headers.Authorization = `Bearer ${input.accessToken}`
      const response = await fetch(`${baseUrl}${input.path}`, { method: input.method, headers, ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new MobileAuthError(response.status, 'TUS authentication request was not confirmed.')
      return { status: response.status, body }
    },
  }
}

function readExpoRuntime(): MobileRuntimeConfig {
  const constantsModule = require('expo-constants') as { default?: ExpoConstantsLike } & ExpoConstantsLike
  const constants = constantsModule.default ?? constantsModule
  return parseMobileRuntimeConfig(constants.expoConfig?.extra?.runtime)
}

interface ExpoConstantsLike {
  expoConfig?: { extra?: { runtime?: unknown } }
}

export function sanitizeTusReturnTo(value: string | undefined, fallback = '/(app)'): string {
  if (value === undefined || value.trim().length === 0) return fallback
  const candidate = value.trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback
  try {
    const parsed = new URL(candidate, 'https://tus.internal')
    return parsed.origin === 'https://tus.internal' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback
  } catch {
    return fallback
  }
}

async function bootstrapContext(transport: MobileAuthTransport, accessToken: string, correlationId: string) {
  const response = await transport.request({ method: 'GET', path: '/auth/session', correlationId, accessToken })
  ensureSuccess(response)
  return parseTusSessionContext(response.body)
}

async function clearAndState(credentials: MobileAuthCredentialStore, status: 'expired' | 'unauthenticated', message: string): Promise<TusSessionState> {
  await credentials.clear().catch(() => undefined)
  return state(status, message)
}

function ensureSuccess(response: { status: number; body: unknown }): void {
  if (response.status < 200 || response.status >= 300) throw new MobileAuthError(response.status, 'TUS authentication request was not confirmed.')
}

function authenticatedState(session: TusAuthenticatedSession): TusSessionState {
  return { status: TUS_SESSION_STATUS.AUTHENTICATED, message: 'TUS confirmed your session and tenant scope.', session }
}

function failureState(error: unknown, fallback: string): TusSessionState {
  return { status: statusOf(error) === 401 ? TUS_SESSION_STATUS.UNAUTHENTICATED : TUS_SESSION_STATUS.UNAVAILABLE, message: fallback }
}

function state(status: TusSessionState['status'], message: string): TusSessionState {
  return { status, message }
}

function statusOf(error: unknown): number | undefined {
  return error instanceof MobileAuthError ? error.status : undefined
}

function safeCode(error: unknown): string | undefined {
  const value = error instanceof MobileAuthError ? error.code : undefined
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : undefined
}

class MobileAuthError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
    this.name = 'MobileAuthError'
  }
}

function createDefaultCorrelationId(): string {
  return `mobile-auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default { createTusMobileAuthClient, createTusMobileAuthFetchTransport, sanitizeTusReturnTo }
