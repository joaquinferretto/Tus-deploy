import {
  createTusAuthenticatedSession,
  parseTusServerSession,
  parseTusSessionContext,
  TUS_SESSION_STATUS,
  type TusAuthenticatedSession,
  type TusSessionState,
} from '@factory/contracts'

import { createTusWebSession, type TusWebSession } from './tus-ui-contract'
import { resolveWebApiBaseUrl } from './api-url.ts'

export const TUS_WEB_SESSION_STORAGE_KEY = 'tus.session.v1'
const DEFAULT_RETURN_TO = '/tus'

let volatileCredential: StoredCredential | null = null

export interface TusWebAuthRequest {
  method: 'GET' | 'POST'
  path:
    | '/auth/sign-in'
    | '/auth/session'
    | '/auth/sign-out'
    | '/auth/register'
    | '/auth/recovery/request'
    | '/auth/recovery/complete'
  correlationId: string
  accessToken?: string
  body?: unknown
}

export interface TusWebAuthTransport {
  request<TResponse>(input: TusWebAuthRequest): Promise<TResponse>
}

export interface TusWebAuthStorage {
  clear(): void
}

export interface TusWebAuthClientOptions {
  transport?: TusWebAuthTransport
  storage?: TusWebAuthStorage
  createCorrelationId?: () => string
  now?: () => number
}

export interface TusWebAuthClient {
  signIn(input: { email: string; password: string }): Promise<TusSessionState>
  register(input: { email: string; password: string; displayName: string }): Promise<TusAuthActionState>
  requestRecovery(email: string): Promise<TusAuthActionState>
  completeRecovery(input: { token: string; newPassword: string }): Promise<TusAuthActionState>
  restore(returnTo?: string): Promise<TusSessionState>
  signOut(): Promise<void>
  clearLocalSession(): void
}

export function createTusWebAuthClient(options: TusWebAuthClientOptions = {}): TusWebAuthClient {
  const transport = options.transport ?? createTusWebAuthFetchTransport()
  const storage = options.storage ?? createBrowserSessionStorage()
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
        const response = await transport.request<unknown>({ method: 'POST', path: '/auth/sign-in', correlationId, body: { email: input.email, password: input.password } })
        const serverSession = parseTusServerSession(response)
        const context = await bootstrapContext(transport, serverSession.accessToken, correlationId)
        if (context.sessionId !== serverSession.id || context.tenantId !== serverSession.tenantId || context.subjectId !== serverSession.accountId) {
          throw new TusAuthError('The server returned an inconsistent session scope.', 502, 'SESSION_SCOPE_MISMATCH')
        }
        const session = createTusAuthenticatedSession({ accessToken: serverSession.accessToken, expiresAt: serverSession.expiresAt, context })
        volatileCredential = { accessToken: session.accessToken, expiresAt: session.expiresAt }
        return authenticatedState(session)
      } catch (error: unknown) {
        return authState(error, undefined, 'Sign-in could not be confirmed by TUS.')
      }
    },

    async restore(returnTo) {
      const safeReturnTo = sanitizeTusReturnTo(returnTo)
      const credential = volatileCredential
      if (credential === null) {
        clearStorage(storage)
        return state(TUS_SESSION_STATUS.UNAUTHENTICATED, 'Sign in to enter your TUS workspace.', safeReturnTo)
      }

      if (credential.expiresAt <= now()) {
        volatileCredential = null
        clearStorage(storage)
        return state(TUS_SESSION_STATUS.EXPIRED, 'Your TUS session expired. Sign in again to continue.', safeReturnTo)
      }

      try {
        const context = await bootstrapContext(transport, credential.accessToken, createCorrelationId())
        const session = createTusAuthenticatedSession({ accessToken: credential.accessToken, expiresAt: credential.expiresAt, context })
        return authenticatedState(session, safeReturnTo)
      } catch (error: unknown) {
        volatileCredential = null
        clearStorage(storage)
        if (statusOf(error) === 401) return state(TUS_SESSION_STATUS.EXPIRED, 'Your TUS session is no longer valid. Sign in again.', safeReturnTo)
        return authState(error, safeReturnTo, 'TUS could not restore the session. Try again.')
      }
    },

    async signOut() {
      const credential = volatileCredential
      try {
        if (credential !== null) await transport.request({ method: 'POST', path: '/auth/sign-out', correlationId: createCorrelationId(), accessToken: credential.accessToken })
      } finally {
        volatileCredential = null
        clearStorage(storage)
      }
    },

    clearLocalSession() {
      volatileCredential = null
      clearStorage(storage)
    },
  }
}

export interface TusAuthActionState {
  status: 'accepted' | 'error'
  message: string
  code?: string
}

async function authAction(
  transport: TusWebAuthTransport,
  createCorrelationId: () => string,
  input: Omit<TusWebAuthRequest, 'correlationId'>,
): Promise<TusAuthActionState> {
  try {
    await transport.request({ ...input, correlationId: createCorrelationId() })
    return { status: 'accepted', message: 'TUS accepted the request. Continue only after the server confirms the next state.' }
  } catch (error: unknown) {
    return { status: 'error', message: 'The request could not be completed. Try again or contact support.', ...(safeCode(error) === undefined ? {} : { code: safeCode(error) }) }
  }
}

function safeCode(error: unknown): string | undefined {
  const value = error instanceof Error && 'code' in error ? (error as Error & { code?: unknown }).code : undefined
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : undefined
}

export function createTusWebAuthFetchTransport(): TusWebAuthTransport {
  const baseUrl = resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })
  return {
    async request<TResponse>(input: TusWebAuthRequest) {
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Correlation-Id': input.correlationId }
      if (input.accessToken !== undefined) headers['Authorization'] = `Bearer ${input.accessToken}`
       const response = await fetch(`${baseUrl}${input.path}`, { method: input.method, headers, credentials: 'omit', ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as Record<string, unknown> | null
        throw new TusAuthError('The authentication service did not confirm this request.', response.status, typeof body?.['code'] === 'string' ? body['code'] : undefined)
      }
      if (response.status === 204) return undefined as TResponse
      return await response.json() as TResponse
    },
  }
}

export function sanitizeTusReturnTo(value: string | undefined, fallback = DEFAULT_RETURN_TO): string {
  if (value === undefined || value.trim().length === 0) return fallback
  const candidate = value.trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback
  try {
    const parsed = new URL(candidate, 'https://tus.internal')
    if (parsed.origin !== 'https://tus.internal') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function toTusWebSession(session: TusAuthenticatedSession): TusWebSession {
  return createTusWebSession({ accessToken: session.accessToken, tenantId: session.tenantId, actorId: session.subjectId, correlationId: session.correlationId, sessionId: session.sessionId, roles: session.roles, permissions: session.permissions, expiresAt: session.expiresAt })
}

interface StoredCredential {
  accessToken: string
  expiresAt: number
}

class TusAuthError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message)
    this.name = 'TusAuthError'
  }
}

async function bootstrapContext(transport: TusWebAuthTransport, accessToken: string, correlationId: string) {
  const response = await transport.request<unknown>({ method: 'GET', path: '/auth/session', correlationId, accessToken })
  return parseTusSessionContext(response)
}

function authenticatedState(session: TusAuthenticatedSession, returnTo?: string): TusSessionState {
  return { status: TUS_SESSION_STATUS.AUTHENTICATED, message: 'TUS confirmed your session and tenant scope.', session, ...(returnTo === undefined ? {} : { returnTo }) }
}

function authState(error: unknown, returnTo: string | undefined, fallback: string): TusSessionState {
  const status = statusOf(error)
  const code = error instanceof TusAuthError ? error.code : undefined
  return { status: status === 401 ? TUS_SESSION_STATUS.UNAUTHENTICATED : TUS_SESSION_STATUS.UNAVAILABLE, message: fallback, ...(code === undefined ? {} : { code }), ...(returnTo === undefined ? {} : { returnTo }) }
}

function state(status: TusSessionState['status'], message: string, returnTo: string): TusSessionState {
  return { status, message, returnTo }
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof TusAuthError) return error.status
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') return error.status
  return undefined
}

function clearStorage(storage: TusWebAuthStorage): void {
  try { storage.clear() } catch { /* Local cleanup is best effort; no secret is logged. */ }
}

function createBrowserSessionStorage(): TusWebAuthStorage {
  return { clear: () => window.sessionStorage.removeItem(TUS_WEB_SESSION_STORAGE_KEY) }
}

function createDefaultCorrelationId(): string {
  return `web-auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default { createTusWebAuthClient, createTusWebAuthFetchTransport, sanitizeTusReturnTo, toTusWebSession }
