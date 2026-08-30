import express, { type Request, type Response, type Router } from 'express'
import type { AccountLinkingService } from '../application/account-linking-service.js'

export function createAccountLinkingRouter(service: AccountLinkingService): Router {
  const router = express.Router()
  router.post('/auth/account-links', async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.link({
      actorId: request.header('x-actor-id') ?? '',
      accountId: request.header('x-account-id') ?? '',
      authenticatedAt: Number(request.header('x-authenticated-at') ?? 0),
      identity: {
        providerId: readString(body, 'providerId'),
        issuer: readString(body, 'issuer'),
        subject: readString(body, 'subject'),
        email: typeof body['email'] === 'string' ? body['email'] : null,
      },
    })
    response.status(result.ok ? 201 : result.code === 'FORBIDDEN' ? 403 : 409).json(result)
  })
  return router
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? body[key] : ''
}
