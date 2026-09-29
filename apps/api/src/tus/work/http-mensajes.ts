import express, { type Request, type Response, type Router } from 'express'
import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { ErrorMensajesTrabajo, type ServicioMensajesTrabajo } from './mensajes.ts'

// Private chat of a work (client <-> chosen provider).
// - GET  /tus/v1/trabajos/:id/mensajes?antesDe=   last 100 messages (oldest first); `mine` per message.
// - POST /tus/v1/trabajos/:id/mensajes            { text, clientMessageId } -> 201 (200 on a retry).
// Only the work's client or provider (derived from the session tenant); anyone else: 404.
// Message texts are never logged.
export function crearRouterMensajesTrabajo({ servicio, sessions }: { servicio: ServicioMensajesTrabajo; sessions: TusSessionResolverPort }): Router {
  const router = express.Router()

  router.get(
    ['/tus/v1/trabajos/:id/mensajes', '/tus/v1/work/:id/messages'],
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions, 'tus:marketplace:read')
      if (!context) return
      try {
        response.status(200).json(await servicio.listar({ tenantId: context.tenantId, actorId: context.subjectId }, request.params['id'], { antesDe: request.query['antesDe'] }))
      } catch (error) {
        enviarErrorMensajes(response, error)
      }
    })
  )

  router.post(
    ['/tus/v1/trabajos/:id/mensajes', '/tus/v1/work/:id/messages'],
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions, 'tus:marketplace:write')
      if (!context) return
      const body = typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {}
      try {
        const result = await servicio.enviar({ tenantId: context.tenantId, actorId: context.subjectId }, request.params['id'], { text: body['text'], clientMessageId: body['clientMessageId'] })
        response.status(result.created ? 201 : 200).json(result.message)
      } catch (error) {
        enviarErrorMensajes(response, error)
      }
    })
  )

  return router
}

function enviarErrorMensajes(response: Response, error: unknown): void {
  if (error instanceof ErrorMensajesTrabajo) {
    response.status(error.status).json({ code: error.code, error: error.message })
    return
  }
  throw error
}

async function autenticar(request: Request, response: Response, sessions: TusSessionResolverPort, permission: string): Promise<TusAuthenticatedTenantContext | null> {
  const authorization = request.header('authorization') ?? ''
  const correlationId = request.header('x-correlation-id')?.trim() ?? ''
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
  const context = accessToken && correlationId ? await sessions.resolve(accessToken, correlationId) : null
  response.setHeader('cache-control', 'no-store')
  if (!context) {
    response.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' })
    return null
  }
  if (!context.permissions.includes(permission)) {
    response.status(403).json({ code: 'FORBIDDEN', error: 'This session cannot use the work chat' })
    return null
  }
  return context
}
