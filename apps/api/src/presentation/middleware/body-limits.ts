import express, { type RequestHandler } from 'express'

export const BODY_LIMITS = {
  json: '1mb',
  form: '100kb',
  upload: '10mb',
} as const

export const RAW_BODY_PATH_PREFIX = '/tus/v1/integrations/mercado-pago/webhooks'
// WHATSAPP-AI-01: Meta signs the exact bytes; the route receives a Buffer (never re-serialized
// JSON). Meta payloads can reach 3 MB.
export const WHATSAPP_WEBHOOK_PATH = '/tus/v1/integrations/whatsapp/webhook'
export const WEBHOOK_PATH_PREFIXES = [RAW_BODY_PATH_PREFIX, WHATSAPP_WEBHOOK_PATH] as const

export function createBodyLimitMiddleware(): RequestHandler[] {
  const whatsappRaw = express.raw({ type: () => true, limit: '3mb' })
  return [
    (request, response, next) => {
      if (request.method === 'POST' && String(request.path) === WHATSAPP_WEBHOOK_PATH) {
        whatsappRaw(request, response, next)
        return
      }
      next()
    },
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
