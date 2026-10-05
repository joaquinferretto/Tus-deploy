import express, { type Request, type RequestHandler, type Response, type Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { EventoStreamAsistente } from '@factory/contracts'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { ErrorAsistente } from './modelo.ts'
import type { IdentidadAsistenteWeb, ServicioAsistenteWeb } from './web.ts'

// ASISTENTE-WEB-01. HTTP of the Web channel of the assistant (same orchestrator as WhatsApp).
// - POST /tus/v1/asistente/mensajes    free text or a confirmation action -> the assistant's reply.
//                                      `Accept: application/x-ndjson` streams the real progress
//                                      (routing, knowledge base, each tool) and then the messages.
// - GET  /tus/v1/asistente/historial   messages of the active conversation.
// - POST /tus/v1/asistente/reiniciar   closes the conversation (new memory on the next message).
//
// The session is optional. With one, the account is the session's (never the body's); without one
// the visitor only reaches public tools and `visitorId` (random browser id) gives continuity.
export function crearRouterAsistenteWeb({
  servicio,
  sessions,
  limitePorIp,
}: {
  servicio: ServicioAsistenteWeb | null
  sessions: TusSessionResolverPort
  // Every message costs model calls: bounded per IP on top of the per-conversation limit.
  limitePorIp?: RequestHandler
}): Router {
  const router = express.Router()
  const limite =
    limitePorIp ??
    rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: { code: 'RATE_LIMITED', error: 'Too many assistant messages from this IP, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
    })

  router.post(
    '/tus/v1/asistente/mensajes',
    limite,
    asyncHandler(async (request: Request, response: Response) => {
      response.setHeader('cache-control', 'private, no-store')
      if (!servicio) return void enviarError(response, 503, 'UNAVAILABLE', 'The assistant is not available right now')
      const body = comoRegistro(request.body)
      const desconocidos = Object.keys(body).filter((key) => !['text', 'replyId', 'visitorId', 'clientMessageId'].includes(key))
      if (desconocidos.length > 0) return void enviarError(response, 422, 'INVALID_REQUEST', 'Unknown fields', desconocidos)
      const correlationId = request.header('x-correlation-id')?.trim() || `asistente-web-${Date.now()}`
      const identidad = await identidadDe(request, sessions, body['visitorId'])
      const stream = (request.header('accept') ?? '').includes('application/x-ndjson')
      let abierto = false
      const linea = (evento: EventoStreamAsistente) => {
        if (!abierto) {
          response.status(200)
          response.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
          // Proxies must pass each line as it is written.
          response.setHeader('x-accel-buffering', 'no')
          response.flushHeaders()
          abierto = true
        }
        response.write(`${JSON.stringify(evento)}\n`)
      }
      try {
        const result = await servicio.enviar({
          identidad,
          text: body['text'],
          replyId: body['replyId'],
          clientMessageId: body['clientMessageId'],
          correlationId,
          ...(stream
            ? {
                onAccepted: (data) => linea({ type: 'accepted', ...data }),
                onActivity: (activity) => linea({ type: 'activity', activity }),
                onMessage: (message) => linea({ type: 'message', message }),
              }
            : {}),
        })
        if (!stream) return void response.status(200).json(result)
        linea({ type: 'done', degraded: result.degraded, authenticated: result.authenticated })
        response.end()
      } catch (error) {
        const conocido = error instanceof ErrorAsistente ? error : null
        if (!abierto) {
          if (!conocido) throw error
          return void enviarError(response, conocido.status, conocido.code, conocido.message)
        }
        // The stream already started: the failure is its last line (never a stack or a provider body).
        linea({ type: 'error', code: conocido?.code ?? 'INTERNAL_ERROR', error: conocido?.message ?? 'The assistant could not answer' })
        response.end()
      }
    })
  )

  router.get(
    '/tus/v1/asistente/historial',
    asyncHandler(async (request: Request, response: Response) => {
      response.setHeader('cache-control', 'private, no-store')
      if (!servicio) return void enviarError(response, 503, 'UNAVAILABLE', 'The assistant is not available right now')
      try {
        response.status(200).json(await servicio.historial(await identidadDe(request, sessions, request.query['visitorId'])))
      } catch (error) {
        if (!(error instanceof ErrorAsistente)) throw error
        enviarError(response, error.status, error.code, error.message)
      }
    })
  )

  router.post(
    '/tus/v1/asistente/reiniciar',
    limite,
    asyncHandler(async (request: Request, response: Response) => {
      response.setHeader('cache-control', 'private, no-store')
      if (!servicio) return void enviarError(response, 503, 'UNAVAILABLE', 'The assistant is not available right now')
      try {
        await servicio.reiniciar(await identidadDe(request, sessions, comoRegistro(request.body)['visitorId']))
        response.status(200).json({ ok: true })
      } catch (error) {
        if (!(error instanceof ErrorAsistente)) throw error
        enviarError(response, error.status, error.code, error.message)
      }
    })
  )

  return router
}

// An absent, expired or invalid session is a visitor (least privilege), never an error: the
// assistant is public. The account is only ever the one of a session resolved right here.
async function identidadDe(request: Request, sessions: TusSessionResolverPort, visitorId: unknown): Promise<IdentidadAsistenteWeb> {
  const authorization = request.header('authorization') ?? ''
  const correlationId = request.header('x-correlation-id')?.trim() ?? ''
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
  let context: TusAuthenticatedTenantContext | null = null
  if (accessToken && correlationId) context = await sessions.resolve(accessToken, correlationId).catch(() => null)
  return { context, visitorId: typeof visitorId === 'string' ? visitorId : null }
}

function comoRegistro(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value) ? (value as Record<string, unknown>) : {}
}

function enviarError(response: Response, status: number, code: string, error: string, fields?: string[]): void {
  response.status(status).json({ code, error, ...(fields ? { fields } : {}) })
}
