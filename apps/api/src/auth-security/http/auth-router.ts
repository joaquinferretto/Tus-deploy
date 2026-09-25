import express from 'express'
import type { Request, Response, Router } from 'express'
import type { AuthService } from '../application/auth-service.js'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../tus/ports/index.ts'
import { asyncHandler, createErrorEnvelope } from '../../presentation/middleware/error.ts'
import { getCorrelationId } from '../../presentation/middleware/correlation.ts'

export interface AuthRouterDependencies {
  service: AuthService
  sessions: TusSessionResolverPort
}

export function createAuthRouter({ service, sessions }: AuthRouterDependencies): Router {
  const router = express.Router()

  router.post('/auth/register', asyncHandler(async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    try {
      const result = await service.register({
        email: readString(body, 'email'),
        password: readString(body, 'password'),
        displayName: readString(body, 'displayName'),
      })
      response.status(201).json({ account: result.account, credential: result.credential })
    } catch (error) {
      response.status(400).json(createErrorEnvelope(error, getCorrelationId(request), 'INVALID_REQUEST'))
    }
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
      response.status(401).json(createErrorEnvelope(new Error(result.message), getCorrelationId(request), result.code))
      return
    }
    response.status(200).json({ session: result.session })
  }))

  router.get('/auth/session', asyncHandler(async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context) {
      response.status(401).json(createErrorEnvelope(new Error('authentication required'), getCorrelationId(request), 'UNAUTHORIZED'))
      return
    }
    response.status(200).json({ context })
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
    sendLifecycleResult(response, await service.signOut({ accessToken }), 204, getCorrelationId(request))
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
      .status(result.code === 'FORBIDDEN' ? 403 : result.code === 'INVALID_TOKEN' ? 400 : 422)
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
