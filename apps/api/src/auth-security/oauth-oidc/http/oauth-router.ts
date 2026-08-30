import express, { type Request, type Response, type Router } from 'express'
import type { OAuthOidcService } from '../application/oauth-oidc-service.js'

export function createOAuthOidcRouter(service: OAuthOidcService): Router {
  const router = express.Router()
  router.get('/auth/oauth/:providerId/start', async (request: Request, response: Response) => {
    const result = await service.beginAuthorization({
      providerId: request.params['providerId'] ?? '',
      redirectUri:
        typeof request.query['redirect_uri'] === 'string' ? request.query['redirect_uri'] : '',
    })
    response.status(result.ok ? 302 : 503).json(result)
  })
  router.get('/auth/oauth/:providerId/callback', async (request: Request, response: Response) => {
    const result = await service.handleCallback({
      providerId: request.params['providerId'] ?? '',
      redirectUri:
        typeof request.query['redirect_uri'] === 'string' ? request.query['redirect_uri'] : '',
      state: typeof request.query['state'] === 'string' ? request.query['state'] : '',
      code: typeof request.query['code'] === 'string' ? request.query['code'] : '',
    })
    response.status(result.ok ? 200 : 400).json(result)
  })
  return router
}
