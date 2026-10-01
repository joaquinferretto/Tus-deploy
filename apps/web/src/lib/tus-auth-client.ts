import {
  createTusAuthenticatedSession,
  parseTusServerSession,
  parseTusSessionContext,
  TUS_SESSION_STATUS,
  type CentroMapaDTO,
  type TusAuthenticatedSession,
  type TusSessionState,
} from '@factory/contracts'

import {
  createTusWebSession,
  TUS_SESSION_STORAGE_KEY,
  type TusWebSession,
} from './tus-ui-contract'
import { resolveWebApiBaseUrl } from './api-url.ts'
import { authorizationHeader } from './session-credentials'

const DEFAULT_RETURN_TO = '/'
const COOKIE_SESSION_LIFETIME_MS = 60 * 60 * 1000

export interface TusWebAuthRequest {
  method: 'GET' | 'POST'
  path:
    | '/auth/sign-in'
    | '/auth/session'
    | '/auth/sign-out'
    | '/auth/register'
    | '/auth/verify-email'
    | '/auth/verify-email/resend'
    | '/auth/admin/bootstrap-verify'
    | '/auth/recovery/request'
    | '/auth/recovery/complete'
    | '/auth/oauth/providers'
    | '/auth/oauth/exchange'
    | '/auth/oauth/signup'
    | '/auth/oauth/signup/preview'
    | '/auth/oauth/link'
    | '/auth/oauth/link/preview'
  correlationId: string
  accessToken?: string
  body?: unknown
}

export interface TusWebAuthTransport {
  request<TResponse>(input: TusWebAuthRequest): Promise<TResponse>
}

export interface TusWebAuthStorage {
  read(): string | null
  write(value: string): void
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
  verifyEmail(token: string): Promise<TusAuthActionState>
  resendVerification(email: string): Promise<TusAuthActionState>
  verifyAdminWithBootstrapCode(input: { email: string; code: string }): Promise<TusAuthActionState>
  requestRecovery(email: string): Promise<TusAuthActionState>
  completeRecovery(input: { token: string; newPassword: string }): Promise<TusAuthActionState>
  restore(returnTo?: string): Promise<TusSessionState>
  // Server-resolved capabilities of the signed-in account (null without a session).
  capabilities(): Promise<TusAccountCapabilities | null>
  signOut(): Promise<void>
  clearLocalSession(): void
  // Google (OpenID Connect through the TUS API). The API validates Google and issues the SAME
  // session type as password sign-in; the Web only exchanges single-use codes.
  googleAvailable(): Promise<boolean>
  googleExchange(code: string): Promise<TusSessionState>
  googleSignupPreview(code: string): Promise<{ email: string | null; name: string | null } | null>
  googleSignup(input: { code: string; displayName: string; acceptedTerms: boolean }): Promise<TusSessionState>
  googleLinkPreview(code: string): Promise<{ emailMasked: string | null } | null>
  googleLink(code: string): Promise<TusAuthActionState>
}

export function createTusWebAuthClient(options: TusWebAuthClientOptions = {}): TusWebAuthClient {
  const transport = options.transport ?? createTusWebAuthFetchTransport()
  const storage = options.storage ?? createBrowserSessionStorage()
  const createCorrelationId = options.createCorrelationId ?? createDefaultCorrelationId
  const now = options.now ?? (() => Date.now())

  // One path for every way of signing in: the server session is re-confirmed through
  // /auth/session before anything is stored.
  async function establish(path: TusWebAuthRequest['path'], body: unknown, fallback: string): Promise<TusSessionState> {
    try {
      const correlationId = createCorrelationId()
      const response = await transport.request<unknown>({ method: 'POST', path, correlationId, body })
      const serverSession = parseTusServerSession(response)
      const context = await bootstrapContext(transport, serverSession.accessToken, correlationId)
      if (context.sessionId !== serverSession.id || context.tenantId !== serverSession.tenantId || context.subjectId !== serverSession.accountId) {
        throw new TusAuthError('The server returned an inconsistent session scope.', 502, 'SESSION_SCOPE_MISMATCH')
      }
      const session = createTusAuthenticatedSession({ accessToken: serverSession.accessToken, expiresAt: serverSession.expiresAt, context })
      storage.write(serializeCredential(session))
      return authenticatedState(session)
    } catch (error: unknown) {
      return authState(error, undefined, fallback)
    }
  }

  return {
    async register(input) {
      return authAction(transport, createCorrelationId, {
        method: 'POST',
        path: '/auth/register',
        body: input,
      })
    },
    async verifyEmail(token) {
      return authAction(transport, createCorrelationId, { method: 'POST', path: '/auth/verify-email', body: { token } })
    },
    async verifyAdminWithBootstrapCode(input) {
      return authAction(transport, createCorrelationId, { method: 'POST', path: '/auth/admin/bootstrap-verify', body: input })
    },
    async resendVerification(email) {
      return authAction(transport, createCorrelationId, { method: 'POST', path: '/auth/verify-email/resend', body: { email } })
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
      return establish('/auth/sign-in', { email: input.email, password: input.password }, 'Sign-in could not be confirmed by TUS.')
    },

    async googleAvailable() {
      try {
        const response = await transport.request<{ google?: { available?: unknown } }>({ method: 'GET', path: '/auth/oauth/providers', correlationId: createCorrelationId() })
        return response?.google?.available === true
      } catch {
        return false
      }
    },

    async googleExchange(code) {
      return establish('/auth/oauth/exchange', { code }, 'Google sign-in could not be confirmed by TUS.')
    },

    async googleSignupPreview(code) {
      try {
        const response = await transport.request<{ email?: unknown; name?: unknown }>({ method: 'POST', path: '/auth/oauth/signup/preview', correlationId: createCorrelationId(), body: { code } })
        return { email: typeof response.email === 'string' ? response.email : null, name: typeof response.name === 'string' ? response.name : null }
      } catch {
        return null
      }
    },

    async googleSignup(input) {
      return establish('/auth/oauth/signup', { code: input.code, displayName: input.displayName, acceptedTerms: input.acceptedTerms }, 'Google sign-up could not be confirmed by TUS.')
    },

    async googleLinkPreview(code) {
      try {
        const response = await transport.request<{ emailMasked?: unknown }>({ method: 'POST', path: '/auth/oauth/link/preview', correlationId: createCorrelationId(), body: { code } })
        return { emailMasked: typeof response.emailMasked === 'string' ? response.emailMasked : null }
      } catch {
        return null
      }
    },

    async googleLink(code) {
      const credential = readCredential(storage)
      return authAction(transport, createCorrelationId, {
        method: 'POST',
        path: '/auth/oauth/link',
        body: { code },
        ...(credential === null ? {} : { accessToken: credential.accessToken }),
      })
    },

    async restore(returnTo) {
      const safeReturnTo = sanitizeTusReturnTo(returnTo)
      let raw: string | null
      try {
        raw = storage.read()
      } catch {
        return state(
          TUS_SESSION_STATUS.UNAVAILABLE,
          'TUS could not access the local session. Try again when storage is available.',
          safeReturnTo
        )
      }
      if (raw === null) {
        // The session cookie is HttpOnly and survives opening a new tab, while sessionStorage does
        // not. Confirm the cookie with the server and recreate only the non-secret local marker.
        try {
          const context = await bootstrapContext(transport, undefined, createCorrelationId())
          const session = createTusAuthenticatedSession({ accessToken: 'cookie-session', expiresAt: now() + COOKIE_SESSION_LIFETIME_MS, context })
          storage.write(serializeCredential(session))
          return authenticatedState(session, safeReturnTo)
        } catch (error: unknown) {
          if (statusOf(error) === 401) return state(TUS_SESSION_STATUS.UNAUTHENTICATED, 'Sign in to enter your TUS workspace.', safeReturnTo)
          return authState(error, safeReturnTo, 'TUS could not restore the session. Try again.')
        }
      }
      let credential: StoredCredential
      try {
        credential = parseCredential(raw)
      } catch {
        clearStorage(storage)
        return state(
          TUS_SESSION_STATUS.UNAUTHENTICATED,
          'Your local session was not valid. Sign in again.',
          safeReturnTo
        )
      }

      if (credential.expiresAt <= now()) {
        clearStorage(storage)
        return state(TUS_SESSION_STATUS.EXPIRED, 'Your TUS session expired. Sign in again to continue.', safeReturnTo)
      }

      try {
        const context = await bootstrapContext(transport, credential.accessToken, createCorrelationId())
        const session = createTusAuthenticatedSession({ accessToken: credential.accessToken, expiresAt: credential.expiresAt, context })
        return authenticatedState(session, safeReturnTo)
      } catch (error: unknown) {
        clearStorage(storage)
        if (statusOf(error) === 401) return state(TUS_SESSION_STATUS.EXPIRED, 'Your TUS session is no longer valid. Sign in again.', safeReturnTo)
        return authState(error, safeReturnTo, 'TUS could not restore the session. Try again.')
      }
    },

    async capabilities() {
      const credential = readCredential(storage)
      try {
        const response = await transport.request<{ capabilities?: { platformAdmin?: unknown; provider?: unknown; profileComplete?: unknown; profileRequired?: unknown; mapCenter?: unknown } }>({ method: 'GET', path: '/auth/session', correlationId: createCorrelationId(), ...(credential === null || credential.expiresAt <= now() ? {} : { accessToken: credential.accessToken }) })
        const raw = response?.capabilities
        const center = raw?.mapCenter as Partial<CentroMapaDTO> | undefined
        return {
          platformAdmin: raw?.platformAdmin === true,
          provider: raw?.provider === true,
          // An API without the profile module never forces onboarding.
          ...(typeof raw?.profileComplete === 'boolean' ? { profileComplete: raw.profileComplete } : {}),
          ...(typeof raw?.profileRequired === 'boolean' ? { profileRequired: raw.profileRequired } : {}),
          ...(center && typeof center.latitud === 'number' && typeof center.longitud === 'number'
            ? { mapCenter: { latitud: center.latitud, longitud: center.longitud, origen: center.origen === 'localidad' ? 'localidad' as const : 'predeterminado' as const, etiqueta: String(center.etiqueta ?? '') } }
            : {}),
        }
      } catch {
        return null
      }
    },

    async signOut() {
      const credential = readCredential(storage)
      try {
        await transport.request({ method: 'POST', path: '/auth/sign-out', correlationId: createCorrelationId(), ...(credential === null ? {} : { accessToken: credential.accessToken }) })
      } finally {
        clearStorage(storage)
      }
    },

    clearLocalSession() {
      clearStorage(storage)
    },
  }
}

export function tusGoogleStartUrl(): string {
  const baseUrl = resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })
  return `${baseUrl}/auth/oauth/google/start`
}

export interface TusAccountCapabilities {
  platformAdmin: boolean
  provider: boolean
  // Personal profile (onboarding) and map centre of the person's locality, decided by the API.
  profileComplete?: boolean
  profileRequired?: boolean
  mapCenter?: CentroMapaDTO
}

// Onboarding: a required personal profile that is still incomplete.
export function needsProfile(capabilities: TusAccountCapabilities | null): boolean {
  return capabilities?.profileRequired === true && capabilities.profileComplete === false
}

export const PROFILE_ROUTE = '/mi-perfil'
const PROFILE_EXEMPT = ['/mi-perfil', '/sign-in', '/registro', '/auth', '/ingresar', '/activar-admin', '/olvide-contrasena', '/recovery', '/recuperar-por-whatsapp', '/restablecer-contrasena', '/verificar-email', '/verificar-telefono', '/tus/admin']

// Routes an account with an incomplete profile may still open: the profile itself, the auth
// screens (sign-in, sign-out, verification) and the platform administration panel.
export function exemptFromProfile(path: string): boolean {
  return PROFILE_EXEMPT.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))
}

// Where to send the person to complete the profile, keeping the destination they wanted.
export function profileRoute(destination: string): string {
  const safe = sanitizeTusReturnTo(destination, '')
  return safe && !exemptFromProfile(safe) ? `${PROFILE_ROUTE}?returnTo=${encodeURIComponent(safe)}` : PROFILE_ROUTE
}

// A platform administration account that is not a provider has no work of its own.
export function isPlatformOnly(capabilities: TusAccountCapabilities | null): boolean {
  return capabilities?.platformAdmin === true && capabilities.provider !== true
}

export interface AccountLink {
  href: '/tus/admin' | '/prestador/solicitudes' | '/mis-solicitudes' | '/mi-perfil' | '/trabajos'
  label: string
  primary?: boolean
}

// Account links of the header, the mobile menu and the footer: ONE list derived from the real
// capabilities. "Mis trabajos" exists only for accounts that can have works (clients, providers).
export function accountLinks(capabilities: TusAccountCapabilities | null): AccountLink[] {
  return [
    { ...panelFor(capabilities), primary: true },
    { href: '/mi-perfil', label: 'Mi perfil' },
    ...(isPlatformOnly(capabilities) ? [] : [{ href: '/trabajos' as const, label: 'Mis trabajos' }]),
  ]
}

export type TusDefaultRoute = '/' | '/tus/admin' | '/prestador/solicitudes'

export function getDefaultRouteForUser(capabilities: TusAccountCapabilities | null): TusDefaultRoute {
  if (capabilities?.platformAdmin) return '/tus/admin'
  if (capabilities?.provider) return '/prestador/solicitudes'
  return '/'
}

export function canAccessReturnTo(path: string, capabilities: TusAccountCapabilities | null): boolean {
  if (path === '/sign-in' || path.startsWith('/sign-in?') || path.startsWith('/auth/') || path.startsWith('/ingresar/')) return false
  if (path === '/tus/admin' || path.startsWith('/tus/admin/')) return capabilities?.platformAdmin === true
  if (path === '/prestador/solicitudes' || path.startsWith('/prestador/solicitudes/')) return capabilities?.provider === true
  return true
}

export function resolvePostLoginRoute(capabilities: TusAccountCapabilities | null, requested?: string | null): string {
  const safe = requested ? sanitizeTusReturnTo(requested, '') : ''
  const destination = safe && canAccessReturnTo(safe, capabilities) ? safe : getDefaultRouteForUser(capabilities)
  // Incomplete personal profile: complete it first, then continue to the destination.
  return needsProfile(capabilities) && !exemptFromProfile(destination) ? profileRoute(destination) : destination
}

// "Ir a mi panel" goes to the dashboard of the account's real role (decided by the API).
export function panelFor(capabilities: TusAccountCapabilities | null): { href: '/tus/admin' | '/prestador/solicitudes' | '/mis-solicitudes'; label: string } {
  if (capabilities?.platformAdmin) return { href: '/tus/admin', label: 'Panel admin' }
  if (capabilities?.provider) return { href: '/prestador/solicitudes', label: 'Panel prestador' }
  return { href: '/mis-solicitudes', label: 'Mis solicitudes' }
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
      Object.assign(headers, authorizationHeader(input.accessToken))
       const response = await fetch(`${baseUrl}${input.path}`, { method: input.method, headers, credentials: 'include', ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as Record<string, unknown> | null
        // API errors are { error: { code } } (older routes: { code }).
        const nested = body?.['error'] as Record<string, unknown> | undefined
        const code = typeof nested?.['code'] === 'string' ? nested['code'] : typeof body?.['code'] === 'string' ? body['code'] : undefined
        throw new TusAuthError('The authentication service did not confirm this request.', response.status, code)
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

async function bootstrapContext(transport: TusWebAuthTransport, accessToken: string | undefined, correlationId: string) {
  const response = await transport.request<unknown>({ method: 'GET', path: '/auth/session', correlationId, ...(accessToken === undefined ? {} : { accessToken }) })
  return parseTusSessionContext(response)
}

function parseCredential(raw: string): StoredCredential {
  const parsed: unknown = JSON.parse(raw)
  const record =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  if (
    typeof record['accessToken'] !== 'string' ||
    record['accessToken'].trim().length === 0 ||
    typeof record['expiresAt'] !== 'number' ||
    !Number.isFinite(record['expiresAt'])
  )
    throw new Error('Invalid stored credential')
  return { accessToken: record['accessToken'], expiresAt: record['expiresAt'] }
}

function serializeCredential(session: TusAuthenticatedSession): string {
  return JSON.stringify({ accessToken: session.accessToken, expiresAt: session.expiresAt })
}

function readCredential(storage: TusWebAuthStorage): StoredCredential | null {
  try {
    const raw = storage.read()
    return raw === null ? null : parseCredential(raw)
  } catch {
    return null
  }
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
  return {
    read: () => window.sessionStorage.getItem(TUS_SESSION_STORAGE_KEY),
    write: (value) => window.sessionStorage.setItem(TUS_SESSION_STORAGE_KEY, value),
    clear: () => window.sessionStorage.removeItem(TUS_SESSION_STORAGE_KEY),
  }
}

function createDefaultCorrelationId(): string {
  return `web-auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const tusAuthClientModule = {
  createTusWebAuthClient,
  createTusWebAuthFetchTransport,
  sanitizeTusReturnTo,
  toTusWebSession,
}

export default tusAuthClientModule
