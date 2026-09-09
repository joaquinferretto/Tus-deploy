import express, { type RequestHandler } from 'express'

export const BODY_LIMITS = {
  json: '1mb',
  form: '100kb',
  upload: '10mb',
} as const

export function createBodyLimitMiddleware(): RequestHandler[] {
  return [
    express.json({ limit: BODY_LIMITS.json, strict: true }),
    express.urlencoded({ extended: false, limit: BODY_LIMITS.form, parameterLimit: 1000 }),
    express.raw({ type: ['application/octet-stream', 'application/zip'], limit: BODY_LIMITS.upload }),
  ]
}
