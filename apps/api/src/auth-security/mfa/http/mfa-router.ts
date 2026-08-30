import express, { type Request, type Response, type Router } from 'express'
import type { MfaService } from '../application/mfa-service.js'

export function createMfaRouter(service: MfaService): Router {
  const router = express.Router()
  router.post('/auth/mfa/enroll', async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.enroll({
      accountId: readHeader(request, 'x-account-id'),
      subject: subjectFrom(request),
      label: readString(body, 'label'),
    })
    sendResult(response, result, 201)
  })
  router.post('/auth/mfa/challenge', async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.beginChallenge({
      subject: subjectFrom(request),
      enrollmentId: readString(body, 'enrollmentId'),
    })
    sendResult(response, result, 200)
  })
  router.post('/auth/mfa/verify', async (request: Request, response: Response) => {
    const body = asRecord(request.body)
    const result = await service.verifyChallenge({
      subject: subjectFrom(request),
      challenge: readString(body, 'challenge'),
      code: readString(body, 'code'),
    })
    sendResult(response, result, 204)
  })
  return router
}

function subjectFrom(request: Request) {
  const accountId = readHeader(request, 'x-account-id')
  const sessionId = readHeader(request, 'x-session-id')
  return accountId && sessionId ? { accountId, sessionId } : undefined
}

function sendResult(
  response: Response,
  result: { ok: boolean; code?: string; message?: string },
  successStatus: number
): void {
  if (!result.ok) {
    response
      .status(result.code === 'FORBIDDEN' ? 403 : result.code === 'RATE_LIMITED' ? 429 : 422)
      .json({ error: result.message, code: result.code })
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
  return typeof body[key] === 'string' ? body[key] : ''
}

function readHeader(request: Request, key: string): string {
  return request.header(key) ?? ''
}
