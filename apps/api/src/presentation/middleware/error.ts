import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { redactError } from '@factory/errors'
import { getCorrelationId } from './correlation.ts'
import { createSafeLogger } from './logger.ts'

export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    correlationId: string
  }
}

export function asyncHandler(handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next)
  }
}

export function createErrorEnvelope(error: unknown, correlationId: string, code = 'INTERNAL_ERROR'): ErrorEnvelope {
  void redactError(error)
  return {
    error: {
      code,
      message: 'An unexpected error occurred',
      correlationId,
    },
  }
}

export function createNotFoundHandler(): RequestHandler {
  return (request, response) => {
    response.status(404).json(createErrorEnvelope(new Error('route not found'), getCorrelationId(request), 'NOT_FOUND'))
  }
}

export function createErrorHandler(): ErrorRequestHandler {
  const logger = createSafeLogger()
  return (error, request, response, _next) => {
    const correlationId = getCorrelationId(request)
    const status = error?.status === 413 || error?.type === 'entity.too.large' ? 413 : error?.code === 'CORS_ORIGIN_DENIED' ? 403 : 500
    const code = status === 413 ? 'REQUEST_TOO_LARGE' : status === 403 ? 'ORIGIN_NOT_ALLOWED' : 'INTERNAL_ERROR'
    logger.error('request failed', { correlationId, details: error })
    response.status(status).json(createErrorEnvelope(error, correlationId, code))
  }
}
