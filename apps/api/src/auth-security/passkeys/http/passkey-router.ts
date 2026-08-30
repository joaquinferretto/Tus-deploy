import express, { type Request, type Response, type Router } from 'express'
import type { PasskeyService } from '../application/passkey-service.js'
import type { WebAuthnRegistrationResponse } from '../domain.js'

export function createPasskeyRouter(service: PasskeyService): Router {
  const router = express.Router()
  router.post(
    '/auth/passkeys/registration/options',
    async (request: Request, response: Response) => {
      const body = asRecord(request.body)
      const result = await service.beginRegistration({
        subject: subjectFrom(request),
        rpId: readString(body, 'rpId'),
        origin: readString(body, 'origin'),
      })
      response.status(result.ok ? 200 : result.code === 'FORBIDDEN' ? 403 : 422).json(result)
    }
  )
  router.post(
    '/auth/passkeys/registration/verify',
    async (request: Request, response: Response) => {
      const body = asRecord(request.body)
      const result = await service.finishRegistration({
        subject: subjectFrom(request),
        ceremonyId: readString(body, 'ceremonyId'),
        response: body['response'] as WebAuthnRegistrationResponse,
      })
      response
        .status(result.ok ? 204 : result.code === 'FORBIDDEN' ? 403 : 422)
        .json(result.ok ? undefined : result)
    }
  )
  return router
}

function subjectFrom(request: Request) {
  const accountId = request.header('x-account-id') ?? ''
  const sessionId = request.header('x-session-id') ?? ''
  return accountId && sessionId ? { accountId, sessionId } : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? body[key] : ''
}
