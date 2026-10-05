import express from 'express'
import type { Request, Response, Router } from 'express'
import { PasswordPolicyError, type AuthService } from '../application/auth-service.js'
import { clearSessionCookie, deliverSession, readSessionCookieSettings, type SessionCookieSettings } from './session-cookie.js'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../tus/ports/index.ts'
import { asyncHandler, createErrorEnvelope } from '../../presentation/middleware/error.ts'
import { getCorrelationId } from '../../presentation/middleware/correlation.ts'
import { normalizarTelefono } from '@factory/contracts'
import { normalizeDisplayName, normalizeEmail, validateEmail, validatePassword } from '../domain/validation.js'
import { vistaDesafio, type ServicioVerificacionTelefono } from '../phone/servicio.ts'

export interface AuthRouterDependencies {
  service: AuthService
  sessions: TusSessionResolverPort
  cookies?: SessionCookieSettings
  now?: () => number
  // What the account can do, resolved on the server (never from the Web): platformAdmin = the
  // allowlisted verified email of an email + password session (MFA still gates every admin
  // request); provider = the account has a provider (merchant) in the marketplace.
  describeCapabilities?: (accessToken: string, correlationId: string, context: TusAuthenticatedTenantContext) => Promise<SessionCapabilities>
  // Phone-first sign-up: an optional phone starts the WhatsApp verification right away.
  phones?: ServicioVerificacionTelefono
}

// Role capabilities plus the state of the personal profile (onboarding) and the map centre of the
// person's locality. The profile part is optional for compositions without the profile module.
export interface SessionCapabilities {
  platformAdmin: boolean
  provider: boolean
  profileComplete?: boolean
  profileRequired?: boolean
  mapCenter?: { latitud: number; longitud: number; origen: 'localidad' | 'predeterminado'; etiqueta: string }
}

export function createAuthRouter({ service, sessions, cookies = readSessionCookieSettings(), now = () => Date.now(), describeCapabilities, phones }: AuthRouterDependencies): Router {
  const router = express.Router()

  // Same answer for a new email and an already registered one (no account enumeration): the
  // person is told to check the inbox. No session is issued before the email is verified.
  // With a phone, the answer also carries the WhatsApp verification (code, wa.me link, poll
  // secret): a real challenge for a new account, an identical-looking one that verifies nothing
  // for an email already registered.
  router.post('/auth/register', asyncHandler(async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    // Format only: which field is not well formed. It says nothing about any account.
    const malFormados = [
      ...(validateEmail(normalizeEmail(readString(body, 'email'))) ? [] : ['email']),
      ...(validatePassword(readString(body, 'password')) ? [] : ['password']),
      ...(normalizeDisplayName(body['displayName']) ? [] : ['displayName']),
    ]
    if (malFormados.length > 0) {
      response.status(400).json({ ...createErrorEnvelope(new Error('registration data is not valid'), getCorrelationId(request), 'INVALID_REQUEST'), fields: malFormados })
      return
    }
    let phone: string | null = null
    if (phones && typeof body['phone'] === 'string' && body['phone'].trim()) {
      const normalized = normalizarTelefono(body['phone'])
      if (!normalized.ok) {
        response.status(422).json({ error: { code: 'INVALID_PHONE', reason: normalized.motivo, message: 'phone number is not valid' } })
        return
      }
      phone = normalized.e164
      if (!(await phones.permitirRegistro(phone, request.ip))) {
        response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'too many attempts, try again later' } })
        return
      }
    }
    try {
      const outcome = await service.registerAccount({
        email: readString(body, 'email'),
        password: readString(body, 'password'),
        displayName: readString(body, 'displayName'),
      })
      let phoneVerification: Record<string, unknown> | undefined
      if (phones && phone) {
        const created = outcome.created ? await phones.iniciarRegistro(outcome.created.account.id, phone) : null
        const challenge = created?.ok ? created : phones.ficticio(phone, 'verificar_telefono')
        phoneVerification = vistaDesafio(challenge)
      }
      response.status(201).json({ status: 'pending_verification', ...(phoneVerification ? { phoneVerification } : {}) })
    } catch (error) {
      const code = error instanceof PasswordPolicyError && error.code === 'PASSWORD_BREACHED' ? 'PASSWORD_BREACHED' : 'INVALID_REQUEST'
      response.status(400).json(createErrorEnvelope(error, getCorrelationId(request), code))
    }
  }))

  // Admin activation without an email provider (TUS_ADMIN_BOOTSTRAP_CODE). Generic 400 on any failure.
  router.post('/auth/admin/bootstrap-verify', asyncHandler(async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.verifyAdminWithBootstrapCode({ email: readString(body, 'email'), code: readString(body, 'code') })
    sendLifecycleResult(response, result, 204, getCorrelationId(request))
  }))

  // "Reenviar email de verificación": always 202 (no enumeration); limited per email.
  router.post('/auth/verify-email/resend', asyncHandler(async (request: Request, response: Response) => {
    await service.resendVerification({ email: readString(asRecord(request.body), 'email') })
    response.status(202).json({ accepted: true })
  }))

  router.post('/auth/sign-in', asyncHandler(async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.signIn({
      email: readString(body, 'email'),
      password: readString(body, 'password'),
      device: {
        deviceId: readOptionalString(body, 'deviceId'),
        label: readOptionalString(body, 'deviceLabel'),
      },
    })
    if (!result.ok) {
      response.status(result.code === 'RATE_LIMITED' ? 429 : 401).json(createErrorEnvelope(new Error(result.message), getCorrelationId(request), result.code))
      return
    }
    // The Web gets the token only in the HttpOnly cookie; native clients get the Bearer token.
    response.status(200).json({ session: deliverSession(request, response, result.session, cookies, now) })
  }))

  router.get('/auth/session', asyncHandler(async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context) {
      response.status(401).json(createErrorEnvelope(new Error('authentication required'), getCorrelationId(request), 'UNAUTHORIZED'))
      return
    }
    const capabilities: SessionCapabilities = describeCapabilities
      ? await describeCapabilities(bearerToken(request), readHeader(request, 'x-correlation-id'), context).catch(() => ({ platformAdmin: false, provider: false }))
      : { platformAdmin: false, provider: false }
    response.setHeader('cache-control', 'no-store')
    response.status(200).json({ context, capabilities })
  }))

  // Own account for "Mi perfil"; the id always comes from the session.
  router.get('/auth/account', asyncHandler(async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const account = context ? await service.getOwnAccount(context.subjectId) : null
    if (!context || !account) {
      response.status(401).json(createErrorEnvelope(new Error('authentication required'), getCorrelationId(request), 'UNAUTHORIZED'))
      return
    }
    response.setHeader('cache-control', 'no-store')
    response.status(200).json({ account })
  }))

  router.post('/auth/sign-out', asyncHandler(async (request: Request, response: Response) => {
    const accessToken = bearerToken(request)
    const context = await authenticate(request, sessions)
    if (!context || !accessToken) {
      response.status(401).json(createErrorEnvelope(new Error('authentication required'), getCorrelationId(request), 'UNAUTHORIZED'))
      return
    }
    // Server-side revocation; the cookie is also cleared.
    const result = await service.signOut({ accessToken })
    clearSessionCookie(response, cookies)
    sendLifecycleResult(response, result, 204, getCorrelationId(request))
  }))

  router.post('/auth/verify-email', asyncHandler(async (request: Request, response: Response) => {
    const result = await service.verifyEmail({ token: readString(asRecord(request.body), 'token') })
    sendLifecycleResult(response, result, 204, getCorrelationId(request))
  }))

  router.post('/auth/recovery/request', asyncHandler(async (request: Request, response: Response) => {
    const result = await service.requestPasswordRecovery({
      email: readString(asRecord(request.body), 'email'),
    })
    response.status(202).json({ ...result.public, correlationId: getCorrelationId(request) })
  }))

  router.post('/auth/recovery/complete', asyncHandler(async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.completePasswordRecovery({
      token: readString(body, 'token'),
      newPassword: readString(body, 'newPassword'),
    })
    sendLifecycleResult(response, result, 204, getCorrelationId(request))
  }))

  router.patch('/auth/accounts/:accountId', asyncHandler(async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context) {
      response.status(401).json(createErrorEnvelope(new Error('authentication required'), getCorrelationId(request), 'UNAUTHORIZED'))
      return
    }
    const result = await service.updateAccount({
      actorId: context.subjectId,
      accountId: request.params['accountId'] ?? '',
      changes: asRecord(request.body),
    })
    if (!result.ok) {
      response.status(result.code === 'FORBIDDEN' ? 403 : 400)
        .json(createErrorEnvelope(new Error(result.message), getCorrelationId(request), result.code))
      return
    }
    response.status(200).json({ account: result.account })
  }))

  router.post('/auth/credentials/password', asyncHandler(async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context) {
      response.status(401).json(createErrorEnvelope(new Error('authentication required'), getCorrelationId(request), 'UNAUTHORIZED'))
      return
    }
    const body = asRecord(request.body)
    const result = await service.changePassword({
      actorId: context.subjectId,
      currentPassword: readString(body, 'currentPassword'),
      newPassword: readString(body, 'newPassword'),
    })
    sendLifecycleResult(response, result, 204, getCorrelationId(request))
  }))

  router.post(
    '/auth/credentials/:credentialId/disable',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await authenticate(request, sessions)
      if (!context) {
        response.status(401).json(createErrorEnvelope(new Error('authentication required'), getCorrelationId(request), 'UNAUTHORIZED'))
        return
      }
      const result = await service.disableCredential({
        actorId: context.subjectId,
        credentialId: request.params['credentialId'] ?? '',
      })
      sendLifecycleResult(response, result, 204, getCorrelationId(request))
    })
  )

  return router
}

function sendLifecycleResult(
  response: Response,
  result: { ok: true } | { ok: false; code: string; message: string },
  successStatus: number,
  correlationId: string,
): void {
  if (!result.ok) {
    response
      .status(result.code === 'FORBIDDEN' ? 403 : result.code === 'INVALID_TOKEN' ? 400 : result.code === 'RATE_LIMITED' ? 429 : 422)
      .json(createErrorEnvelope(new Error(result.message), correlationId, result.code))
    return
  }
  response.status(successStatus).send()
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value : ''
}

function readOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

function readHeader(request: Request, key: string): string {
  const value = request.header(key)
  return value ?? ''
}

async function authenticate(
  request: Request,
  sessions: TusSessionResolverPort
): Promise<TusAuthenticatedTenantContext | null> {
  const accessToken = bearerToken(request)
  const correlationId = readHeader(request, 'x-correlation-id')
  if (!accessToken || !correlationId) return null
  return sessions.resolve(accessToken, correlationId)
}

function bearerToken(request: Request): string {
  const authorization = readHeader(request, 'authorization')
  if (!authorization.startsWith('Bearer ')) return ''
  return authorization.slice('Bearer '.length).trim()
}

export default { createAuthRouter }
