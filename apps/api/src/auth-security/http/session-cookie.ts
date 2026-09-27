import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { readCorsOrigins } from '../../presentation/middleware/cors.ts'

// Web sessions travel in an HttpOnly cookie: the token never reaches JavaScript, so an XSS on the
// Web cannot read it. Native clients (no Origin header) keep receiving the Bearer token.
//
// - The cookie is host-only on the API host (`__Host-` prefix: Secure, Path=/, no Domain) and
//   SameSite=Strict. tusservicios.shop and api.tusservicios.shop are the same site, so the Web's
//   fetches carry it; a request started by another site never does.
// - The Web receives `accessToken: "cookie-session"` (a marker, not a secret) so the session
//   contract stays the same.
// - CSRF: a mutating request authenticated by the cookie must come from an allowed origin
//   (Origin, or Referer when Origin is absent). SameSite=Strict already blocks cross-site
//   sending; the origin check is the second, independent defense.

export const COOKIE_SESSION_MARKER = 'cookie-session'
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface SessionCookieSettings {
  name: string
  secure: boolean
  allowedOrigins: readonly string[]
}

export function readSessionCookieSettings(env: Record<string, string | undefined> = process.env): SessionCookieSettings {
  // Only a local HTTP development setup may turn Secure off (TUS_SESSION_COOKIE_SECURE=false).
  const secure = env['TUS_SESSION_COOKIE_SECURE'] !== 'false'
  return { name: secure ? '__Host-tus_session' : 'tus_session', secure, allowedOrigins: readCorsOrigins(env) }
}

function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

// A browser on an allowed Web origin: the session goes in the cookie.
export function isWebBrowserRequest(request: Request, settings: SessionCookieSettings): boolean {
  const origin = originOf(request.header('origin'))
  return origin !== null && settings.allowedOrigins.includes(origin)
}

function serializeCookie(settings: SessionCookieSettings, value: string, maxAgeSeconds: number): string {
  return [
    `${settings.name}=${value}`,
    'Path=/',
    'HttpOnly',
    ...(settings.secure ? ['Secure'] : []),
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join('; ')
}

export function readSessionCookie(request: Request, settings: SessionCookieSettings): string | null {
  const header = request.header('cookie') ?? ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === settings.name) {
      const value = part.slice(index + 1).trim()
      return /^[A-Za-z0-9_-]{16,512}$/u.test(value) ? value : null
    }
  }
  return null
}

// Returns the session body to send. For the Web the token goes ONLY in the cookie.
export function deliverSession<T extends { accessToken: string; expiresAt: number }>(
  request: Request,
  response: Response,
  session: T,
  settings: SessionCookieSettings,
  now: () => number = () => Date.now()
): T {
  if (!isWebBrowserRequest(request, settings)) return session
  response.append('Set-Cookie', serializeCookie(settings, session.accessToken, (session.expiresAt - now()) / 1000))
  response.setHeader('cache-control', 'no-store')
  return { ...session, accessToken: COOKIE_SESSION_MARKER }
}

export function clearSessionCookie(response: Response, settings: SessionCookieSettings): void {
  response.append('Set-Cookie', serializeCookie(settings, '', 0))
}

const viaCookie = new WeakSet<Request>()

export function authenticatedByCookie(request: Request): boolean {
  return viaCookie.has(request)
}

// Runs before every router: a request without Authorization but with the session cookie is
// authenticated with the cookie (every router keeps reading `Authorization: Bearer`). A marker
// sent as Bearer by an old Web tab is replaced by the cookie too.
export function createSessionCookieMiddleware(settings: SessionCookieSettings): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization') ?? ''
    const cookie = readSessionCookie(request, settings)
    if (cookie && (!authorization || authorization === `Bearer ${COOKIE_SESSION_MARKER}`)) {
      request.headers['authorization'] = `Bearer ${cookie}`
      viaCookie.add(request)
    }
    if (viaCookie.has(request) && UNSAFE_METHODS.has(request.method)) {
      const origin = originOf(request.header('origin')) ?? originOf(request.header('referer'))
      if (!origin || !settings.allowedOrigins.includes(origin)) {
        response.status(403).json({ error: { code: 'CSRF_REJECTED', message: 'Cross-site request rejected' } })
        return
      }
    }
    next()
  }
}
