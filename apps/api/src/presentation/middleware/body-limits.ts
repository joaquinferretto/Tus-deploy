import express, { type RequestHandler } from 'express'

export const BODY_LIMITS = {
  json: '1mb',
  form: '100kb',
  upload: '10mb',
} as const

export const RAW_BODY_PATH_PREFIX = '/tus/v1/integrations/mercado-pago/webhooks'

export function createBodyLimitMiddleware(): RequestHandler[] {
  return [
    express.json({
      limit: BODY_LIMITS.json,
      strict: true,
      // WEB-09E: provider webhooks keep the exact bytes for auditing; only that path stores them.
      verify: (request, _response, buffer) => {
        if (String((request as { url?: string }).url ?? '').startsWith(RAW_BODY_PATH_PREFIX))
          (request as { rawBody?: string }).rawBody = buffer.toString('utf8')
      },
    }),
    express.urlencoded({ extended: false, limit: BODY_LIMITS.form, parameterLimit: 1000 }),
    express.raw({ type: ['application/octet-stream', 'application/zip'], limit: BODY_LIMITS.upload }),
  ]
}
