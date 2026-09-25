import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import type { ServicioSolicitudes } from './servicio.ts'

// Solicitudes de servicio.
// - GET  /tus/v1/public/solicitudes           público (home): solo zona aproximada y nombre abreviado.
// - GET  /tus/v1/solicitudes/mias             la cuenta ve sus solicitudes.
// - POST /tus/v1/solicitudes                  publicar (cuenta verificada; límites anti-abuso).
// - POST /tus/v1/solicitudes/:id/cerrar       cerrar una solicitud propia.
export function crearRouterSolicitudes({ servicio, sessions }: { servicio: ServicioSolicitudes; sessions: TusSessionResolverPort }): Router {
  const router = express.Router()

  router.get(
    '/tus/v1/public/solicitudes',
    asyncHandler(async (request: Request, response: Response) => {
      const solicitudes = await servicio.listarPublicas({ categoria: request.query['categoria'] })
      // Datos públicos y sin PII; un cache corto alivia la home sin demorar las nuevas.
      response.setHeader('cache-control', 'public, max-age=30')
      response.status(200).json({ items: solicitudes })
    })
  )

  router.get(
    '/tus/v1/solicitudes/mias',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      response.status(200).json({ items: await servicio.mias(context.subjectId) })
    })
  )

  router.post(
    '/tus/v1/solicitudes',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const body = comoRegistro(request.body)
      if (autoridadFalsificada(body, context)) {
        enviarError(response, 403, 'FORBIDDEN', 'Client authority fields are not accepted')
        return
      }
      const result = await servicio.publicar(context.subjectId, body)
      if (result.ok) {
        response.status(201).json(result.solicitud)
        return
      }
      if (result.code === 'INVALID_REQUEST') {
        response.status(422).json({ code: result.code, error: 'The request has invalid fields', fields: result.fields })
        return
      }
      if (result.code === 'RATE_LIMITED') {
        enviarError(response, 429, result.code, 'Too many service requests; try again later')
        return
      }
      enviarError(response, 403, result.code, 'This account cannot publish service requests')
    })
  )

  router.post(
    '/tus/v1/solicitudes/:id/cerrar',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const result = await servicio.cerrar(context.subjectId, request.params['id'])
      if (result.ok) response.status(200).json({ status: 'cerrada' })
      else enviarError(response, 404, 'NOT_FOUND', 'Service request not found')
    })
  )

  return router
}

async function autenticar(request: Request, response: Response, sessions: TusSessionResolverPort): Promise<TusAuthenticatedTenantContext | null> {
  const authorization = request.header('authorization') ?? ''
  const correlationId = request.header('x-correlation-id')?.trim() ?? ''
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
  const context = accessToken && correlationId ? await sessions.resolve(accessToken, correlationId) : null
  if (!context) {
    enviarError(response, 401, 'UNAUTHORIZED', 'Authentication required')
    return null
  }
  response.setHeader('cache-control', 'no-store')
  return context
}

function autoridadFalsificada(body: Record<string, unknown>, context: TusAuthenticatedTenantContext): boolean {
  const forbidden = ['cuentaId', 'accountId', 'estado', 'status', 'latitud', 'longitud', 'lat', 'lng', 'nombrePublico', 'requesterName']
  if (forbidden.some((key) => key in body)) return true
  return (typeof body['tenantId'] === 'string' && body['tenantId'] !== context.tenantId) || (typeof body['actorId'] === 'string' && body['actorId'] !== context.subjectId)
}

function comoRegistro(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function enviarError(response: Response, status: number, code: string, error: string): void {
  response.status(status).json({ code, error })
}
