import express, { type Request, type Response, type Router } from 'express'
import { asyncHandler, createErrorEnvelope } from '../../../presentation/middleware/error.ts'
import { getCorrelationId } from '../../../presentation/middleware/correlation.ts'
import type { FederatedAuthService } from '../application/federated-auth-service.js'
import type { FederatedFailure } from '../domain.js'

// Google sign-in / sign-up. The Web navigates to /start; Google returns to /callback (registered
// redirect URI); the Web then exchanges the single-use code for the normal TUS session.
export function createFederatedAuthRouter(service: FederatedAuthService, webBaseUrl: string | null): Router {
  const router = express.Router()
  const web = (webBaseUrl ?? '').replace(/\/+$/u, '')

  router.get('/auth/oauth/providers', (_request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    response.status(200).json({ google: { available: service.available() } })
  })

  router.get('/auth/oauth/google/start', asyncHandler(async (_request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    const result = await service.start()
    if (!result.ok) {
      if (web) response.redirect(303, `${web}/sign-in?error=google_unavailable`)
      else response.status(503).json({ code: result.code, error: 'Google sign-in is unavailable' })
      return
    }
    response.redirect(303, result.authorizationUrl)
  }))

  router.get('/auth/oauth/google/callback', asyncHandler(async (request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('referrer-policy', 'no-referrer')
    const { redirectTo } = await service.callback({ state: request.query['state'], code: request.query['code'], error: request.query['error'] })
    response.redirect(303, redirectTo)
  }))

  router.post('/auth/oauth/exchange', asyncHandler(async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.exchange({ code: body['code'], device: device(body) })
    if (!result.ok) return fail(request, response, result, 401)
    response.setHeader('cache-control', 'no-store')
    response.status(200).json({ session: result.session })
  }))

  router.post('/auth/oauth/signup/preview', asyncHandler(async (request: Request, response: Response) => {
    const result = await service.previewSignup({ code: asRecord(request.body)['code'] })
    if (!result.ok) return fail(request, response, result, 400)
    response.setHeader('cache-control', 'no-store')
    response.status(200).json({ email: result.email, name: result.name })
  }))

  router.post('/auth/oauth/signup', asyncHandler(async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.completeSignup({ code: body['code'], displayName: body['displayName'], acceptedTerms: body['acceptedTerms'], device: device(body) })
    if (!result.ok) return fail(request, response, result, result.code === 'ACCOUNT_EXISTS' ? 409 : 400)
    response.setHeader('cache-control', 'no-store')
    response.status(201).json({ session: result.session })
  }))

  router.post('/auth/oauth/link/preview', asyncHandler(async (request: Request, response: Response) => {
    const result = await service.previewLink({ code: asRecord(request.body)['code'] })
    if (!result.ok) return fail(request, response, result, 400)
    response.setHeader('cache-control', 'no-store')
    response.status(200).json({ emailMasked: result.emailMasked })
  }))

  router.post('/auth/oauth/link', asyncHandler(async (request: Request, response: Response) => {
    const authorization = request.header('authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : null
    const result = await service.link({ code: asRecord(request.body)['code'], accessToken: token })
    if (!result.ok) return fail(request, response, result, result.code === 'RECENT_AUTH_REQUIRED' ? 401 : 409)
    response.status(200).json({ linked: true })
  }))

  return router
}

function fail(request: Request, response: Response, result: { code: string; message: string }, status: number) {
  response.status(status).json(createErrorEnvelope(new Error(result.message), getCorrelationId(request), result.code))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function device(body: Record<string, unknown>) {
  const label = typeof body['deviceLabel'] === 'string' ? body['deviceLabel'].slice(0, 80) : undefined
  return label ? { label } : undefined
}
