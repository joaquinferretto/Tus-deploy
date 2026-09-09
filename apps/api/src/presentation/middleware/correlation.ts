import { randomUUID } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import { createSafeLogger } from './logger.ts'

export function getCorrelationId(request: Pick<Request, 'headers'> | { headers?: Record<string, string | string[] | undefined> }): string {
  const header = request.headers?.['x-correlation-id']
  const value = Array.isArray(header) ? header[0] : header
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/u.test(value)
    ? value
    : `corr-${randomUUID()}`
}

export function createCorrelationMiddleware(): RequestHandler {
  const logger = createSafeLogger()
  return (request, response, next) => {
    const correlationId = getCorrelationId(request)
    response.setHeader('X-Correlation-Id', correlationId)
    response.locals['correlationId'] = correlationId
    logger.info('request started', { correlationId })
    response.once('finish', () => logger.info('request completed', { correlationId }))
    next()
  }
}

export const correlationMiddleware = createCorrelationMiddleware()
