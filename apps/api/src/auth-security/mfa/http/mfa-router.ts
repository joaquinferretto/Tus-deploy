import express, { type Request, type Response, type Router } from 'express'
import type { MfaService } from '../application/mfa-service.js'
import type { AuthenticatedSubject, MfaFailure } from '../domain.js'
import { otpauthUri } from '../adapters/totp.js'
import { hasPlatformAdminPermission } from '../admin-gate.js'
import type { SignInResult } from '../../application/auth-service.js'
import { SECURITY_NOTIFICATION, type SecurityNotificationKind } from '../../ports/security.js'
import { deliverSession, type SessionCookieSettings } from '../../http/session-cookie.js'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../../tus/ports/index.ts'
import { asyncHandler } from '../../../presentation/middleware/error.ts'

export interface MfaRouterDependencies {
  // null when the server has no TUS_MFA_ENCRYPTION_KEY: every MFA route answers 503.
  service: MfaService | null
  // RAW session resolver (admin permissions not yet gated), to know who is an admin candidate.
  sessions: TusSessionResolverPort
  accounts: { getOwnAccount(accountId: string): Promise<{ email: string } | null> }
  reauthenticate: (accountId: string, password: string) => Promise<'ok' | 'mismatch' | 'no_password'>
  // Live allowlist + verified email check (defaults to the permission in the session scope).
  adminCandidate?: (context: TusAuthenticatedTenantContext) => Promise<boolean>
  // Session rotation after the second factor (new token; the old one is revoked).
  rotate?: (accessToken: string) => Promise<SignInResult>
  cookies?: SessionCookieSettings
  notify?: (accountId: string, kind: SecurityNotificationKind) => Promise<void>
  issuer?: string
  now?: () => number
}

// Accounts without a password re-authenticate with a second factor verified in this session
// within the last 10 minutes (the admin always has a password: it signs in with email + password).
const RECENT_ELEVATION_MS = 10 * 60 * 1000

// MFA for platform administration (only admin candidates). Always bound to the authenticated
// session (Bearer or HttpOnly cookie): the account is never taken from the request body/headers.
export function createMfaRouter(dependencies: MfaRouterDependencies): Router {
  const router = express.Router()
  const now = dependencies.now ?? (() => Date.now())
  const issuer = dependencies.issuer ?? 'TUS'
  const notify = async (accountId: string, kind: SecurityNotificationKind) => {
    await dependencies.notify?.(accountId, kind).catch(() => undefined)
  }

  const guard = async (request: Request, response: Response): Promise<{ service: MfaService; context: TusAuthenticatedTenantContext; subject: AuthenticatedSubject } | null> => {
    response.setHeader('cache-control', 'no-store')
    const context = await authenticate(request, dependencies.sessions)
    if (!context) {
      sendError(response, 401, 'UNAUTHORIZED', 'authentication required')
      return null
    }
    const candidate = dependencies.adminCandidate ? await dependencies.adminCandidate(context) : hasPlatformAdminPermission(context)
    if (!candidate) {
      sendError(response, 403, 'FORBIDDEN', 'MFA is only available for platform administration')
      return null
    }
    if (!dependencies.service) {
      sendError(response, 503, 'MFA_UNAVAILABLE', 'MFA is not configured on this server')
      return null
    }
    return { service: dependencies.service, context, subject: { accountId: context.subjectId, sessionId: context.sessionId } }
  }

  // After a successful second factor the session is rotated: a token issued before MFA never
  // becomes an admin token. The Web gets the new token in the HttpOnly cookie.
  const elevated = async (request: Request, response: Response, service: MfaService, subject: AuthenticatedSubject, body: Record<string, unknown> = {}) => {
    const token = bearerToken(request)
    const rotated = dependencies.rotate && token ? await dependencies.rotate(token) : null
    if (rotated && rotated.ok) {
      await service.moveElevation(subject, { accountId: subject.accountId, sessionId: rotated.session.id })
      const session = dependencies.cookies ? deliverSession(request, response, rotated.session, dependencies.cookies, now) : rotated.session
      response.status(200).json({ ...body, session })
      return
    }
    response.status(200).json(body)
  }

  router.get('/auth/mfa/status', asyncHandler(async (request: Request, response: Response) => {
    const auth = await guard(request, response)
    if (!auth) return
    response.status(200).json({ required: true, ...(await auth.service.status(auth.subject)) })
  }))

  // The secret and its otpauth:// URI are returned ONLY here (pending enrollment).
  router.post('/auth/mfa/enroll', asyncHandler(async (request: Request, response: Response) => {
    const auth = await guard(request, response)
    if (!auth) return
    const account = await dependencies.accounts.getOwnAccount(auth.context.subjectId)
    const label = account?.email ?? 'TUS admin'
    const result = await auth.service.enroll({ accountId: auth.subject.accountId, subject: auth.subject, label })
    if (!result.ok) return sendFailure(response, result)
    response.status(201).json({
      enrollmentId: result.enrollmentId,
      secret: result.secret,
      otpauthUri: otpauthUri({ issuer, accountName: label, secret: result.secret }),
    })
  }))

  router.post('/auth/mfa/enroll/confirm', asyncHandler(async (request: Request, response: Response) => {
    const auth = await guard(request, response)
    if (!auth) return
    const body = asRecord(request.body)
    const result = await auth.service.confirmEnrollment({ subject: auth.subject, enrollmentId: readString(body, 'enrollmentId'), code: readString(body, 'code') })
    if (!result.ok) return sendFailure(response, result)
    await notify(auth.subject.accountId, SECURITY_NOTIFICATION.MFA_ENABLED)
    await elevated(request, response, auth.service, auth.subject, { recoveryCodes: result.recoveryCodes })
  }))

  // Step-up: challenge + authenticator code elevates (and rotates) this session.
  router.post('/auth/mfa/verify', asyncHandler(async (request: Request, response: Response) => {
    const auth = await guard(request, response)
    if (!auth) return
    const enrollmentId = await auth.service.activeEnrollmentId(auth.subject.accountId)
    if (!enrollmentId) return sendFailure(response, { ok: false, code: 'INVALID', message: 'MFA enrollment is not active' })
    const challenge = await auth.service.beginChallenge({ subject: auth.subject, enrollmentId })
    if (!challenge.ok) return sendFailure(response, challenge)
    const result = await auth.service.verifyChallenge({ subject: auth.subject, challenge: challenge.challenge, code: readString(asRecord(request.body), 'code') })
    if (!result.ok) return sendFailure(response, result)
    await elevated(request, response, auth.service, auth.subject)
  }))

  // A single-use recovery code instead of the authenticator.
  router.post('/auth/mfa/recover', asyncHandler(async (request: Request, response: Response) => {
    const auth = await guard(request, response)
    if (!auth) return
    if (!(await auth.service.activeEnrollmentId(auth.subject.accountId)))
      return sendFailure(response, { ok: false, code: 'INVALID', message: 'MFA enrollment is not active' })
    const result = await auth.service.recoverWithCode({ subject: auth.subject, code: readString(asRecord(request.body), 'code') })
    if (!result.ok) return sendFailure(response, result)
    await elevated(request, response, auth.service, auth.subject)
  }))

  router.post('/auth/mfa/recovery-codes', asyncHandler(async (request: Request, response: Response) => {
    const auth = await guard(request, response)
    if (!auth) return
    const result = await auth.service.regenerateRecoveryCodes({ subject: auth.subject, code: readString(asRecord(request.body), 'code') })
    if (!result.ok) return sendFailure(response, result)
    await notify(auth.subject.accountId, SECURITY_NOTIFICATION.RECOVERY_CODES_REGENERATED)
    response.status(200).json({ recoveryCodes: result.recoveryCodes })
  }))

  // Re-authentication: current password (or, without a password, a second factor verified in
  // this session in the last 10 minutes) PLUS a current authenticator or recovery code.
  router.post('/auth/mfa/disable', asyncHandler(async (request: Request, response: Response) => {
    const auth = await guard(request, response)
    if (!auth) return
    const body = asRecord(request.body)
    const password = await dependencies.reauthenticate(auth.subject.accountId, readString(body, 'password'))
    const elevatedAt = password === 'no_password' ? await auth.service.elevatedAt(auth.subject) : null
    const reauthenticated = password === 'ok' || (elevatedAt !== null && now() - elevatedAt <= RECENT_ELEVATION_MS)
    const result = await auth.service.disable({ subject: auth.subject, code: readString(body, 'code'), reauthenticated })
    if (!result.ok) return sendFailure(response, result)
    await notify(auth.subject.accountId, SECURITY_NOTIFICATION.MFA_DISABLED)
    response.status(204).send()
  }))

  return router
}

function sendFailure(response: Response, failure: MfaFailure | { ok: false; code: string; message: string }): void {
  const status =
    failure.code === 'FORBIDDEN' ? 403
      : failure.code === 'RATE_LIMITED' ? 429
        : failure.code === 'CONFLICT' ? 409
          : failure.code === 'REAUTHENTICATION_REQUIRED' ? 401
            : 400
  sendError(response, status, failure.code, failure.message)
}

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } })
}

function bearerToken(request: Request): string {
  const authorization = request.header('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
}

async function authenticate(request: Request, sessions: TusSessionResolverPort): Promise<TusAuthenticatedTenantContext | null> {
  const token = bearerToken(request)
  const correlationId = request.header('x-correlation-id') ?? ''
  if (!token || !correlationId) return null
  return sessions.resolve(token, correlationId)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value : ''
}
