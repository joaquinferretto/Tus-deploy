import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { ZONAS_CORRIENTES } from '../solicitudes/modelo.ts'
import { catalogoPublico } from './oficios.ts'
import type { ServicioDirectorio } from './servicio.ts'

// Directorio "Buscar trabajador" y asistente "Buscar servicios".
// - GET  /tus/v1/public/oficios                 catálogo canónico de oficios y barrios.
// - GET  /tus/v1/public/prestadores             directorio público (filtros, orden, paginado).
// - GET  /tus/v1/public/prestadores/:id         perfil público.
// - GET  /tus/v1/prestador/perfil-publico       perfil del prestador autenticado.
// - PUT  /tus/v1/prestador/perfil-publico       crear/editar el perfil público.
// - POST /tus/v1/asistente/interpretar          interpreta el texto (oficio, barrio, urgencia).
// - POST /tus/v1/asistente/candidatos           prestadores compatibles (requiere sesión).
export function crearRouterDirectorio({ servicio, sessions }: { servicio: ServicioDirectorio; sessions: TusSessionResolverPort }): Router {
  const router = express.Router()

  router.get('/tus/v1/public/oficios', (_request: Request, response: Response) => {
    response.setHeader('cache-control', 'public, max-age=300')
    response.status(200).json({ items: catalogoPublico(), zones: ZONAS_CORRIENTES.map((zona) => zona.nombre) })
  })

  router.get(
    '/tus/v1/public/prestadores',
    asyncHandler(async (request: Request, response: Response) => {
      const resultado = await servicio.listar({
        oficio: request.query['oficio'],
        zona: request.query['zona'],
        q: request.query['q'],
        verificados: request.query['verificados'],
        atiendeHoy: request.query['hoy'],
        orden: request.query['orden'],
        pagina: request.query['pagina'],
      })
      response.setHeader('cache-control', 'public, max-age=30')
      response.status(200).json(resultado)
    })
  )

  router.get(
    '/tus/v1/public/prestadores/:id',
    asyncHandler(async (request: Request, response: Response) => {
      const perfil = await servicio.perfil(request.params['id'])
      if (!perfil) {
        enviarError(response, 404, 'NOT_FOUND', 'Provider not found')
        return
      }
      response.setHeader('cache-control', 'public, max-age=30')
      response.status(200).json(perfil)
    })
  )

  router.get(
    '/tus/v1/prestador/perfil-publico',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      response.status(200).json({ profile: await servicio.miPerfil(context) })
    })
  )

  router.put(
    '/tus/v1/prestador/perfil-publico',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const body = comoRegistro(request.body)
      if (!context.permissions.includes('tus:marketplace:write') || ['tenantId', 'prestadorId', 'merchantId', 'id', 'verified', 'completedJobs', 'rating'].some((key) => key in body)) {
        enviarError(response, 403, 'FORBIDDEN', 'This profile cannot be edited with this session')
        return
      }
      const result = await servicio.guardarPerfil(context, body)
      if (result.ok) response.status(200).json({ profile: result.perfil })
      else if (result.code === 'INVALID_PROFILE') response.status(422).json({ code: result.code, error: 'The profile has invalid fields', fields: result.fields })
      else enviarError(response, 409, result.code, 'Complete your provider onboarding first')
    })
  )

  router.post('/tus/v1/asistente/interpretar', (request: Request, response: Response) => {
    const texto = comoRegistro(request.body)['text']
    if (typeof texto !== 'string' || texto.trim().length < 3 || texto.length > 600) {
      response.status(422).json({ code: 'INVALID_REQUEST', error: 'Describe what you need in 3 to 600 characters', fields: ['text'] })
      return
    }
    response.setHeader('cache-control', 'no-store')
    response.status(200).json(servicio.interpretar(texto))
  })

  router.post(
    '/tus/v1/asistente/candidatos',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const body = comoRegistro(request.body)
      const resultado = await servicio.buscarCandidatos({ oficio: body['profession'], zona: body['zone'] })
      if (resultado.reason === 'invalid_profession') {
        response.status(422).json({ code: 'INVALID_REQUEST', error: 'Choose a profession', fields: ['profession'] })
        return
      }
      response.status(200).json(resultado)
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

function comoRegistro(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value) ? (value as Record<string, unknown>) : {}
}

function enviarError(response: Response, status: number, code: string, error: string): void {
  response.status(status).json({ code, error })
}
