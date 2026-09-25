import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import type { ImagenSolicitud } from './modelo.ts'
import type { ServicioSolicitudes } from './servicio.ts'

// Solicitudes de servicio (una sola solicitud TUS para mapa, directorio, asistente y WhatsApp).
// - GET  /tus/v1/public/solicitudes                         público (home): sin PII, solo públicas.
// - GET  /tus/v1/public/solicitudes/:id/imagenes/:orden     foto de una solicitud pública.
// - GET  /tus/v1/solicitudes/mias                           solicitudes de la cuenta (con asignación).
// - POST /tus/v1/solicitudes                                publicar; con `providerId` queda dirigida.
// - POST /tus/v1/solicitudes/:id/cerrar                     cerrar (una dirigida pendiente se cancela).
// - POST /tus/v1/solicitudes/:id/imagenes                   subir foto (octet-stream, hasta 2).
// - GET  /tus/v1/solicitudes/:id/imagenes/:orden            foto para la dueña o el prestador destino.
// - GET  /tus/v1/prestador/solicitudes                      bandeja del prestador (dirigidas a él).
// - POST /tus/v1/prestador/solicitudes/:id/(aceptar|rechazar)
// Postulaciones a solicitudes públicas (el cliente decide a quién acepta):
// - POST /tus/v1/prestador/solicitudes/:id/postular               el prestador se ofrece.
// - GET  /tus/v1/prestador/postulaciones                          sus postulaciones.
// - POST /tus/v1/prestador/postulaciones/:id/retirar              se baja antes de la decisión.
// - GET  /tus/v1/solicitudes/:id/postulaciones                    postulantes (solo la dueña).
// - POST /tus/v1/solicitudes/:id/postulaciones/:pid/(aceptar|rechazar)
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
    '/tus/v1/public/solicitudes/:id/imagenes/:orden',
    asyncHandler(async (request: Request, response: Response) => {
      const imagen = await servicio.imagenPublica(request.params['id'], request.params['orden'])
      if (!imagen) {
        enviarError(response, 404, 'NOT_FOUND', 'Image not found')
        return
      }
      enviarImagen(response, imagen, 'public, max-age=300')
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
      // La Web solo puede declarar orígenes Web; cualquier otro valor se rechaza.
      const origen = body['origin'] === undefined ? undefined : servicio.origenWeb(body['origin'])
      if (body['origin'] !== undefined && !origen) {
        response.status(422).json({ code: 'INVALID_REQUEST', error: 'The request has invalid fields', fields: ['origin'] })
        return
      }
      const result = await servicio.publicar(context.subjectId, body, origen ? { origen } : {})
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
      if (result.code === 'PROVIDER_NOT_AVAILABLE') {
        enviarError(response, 409, result.code, 'The selected provider is not available')
        return
      }
      if (result.code === 'SELF_REQUEST') {
        enviarError(response, 409, result.code, 'A provider cannot request its own services')
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

  router.post(
    '/tus/v1/solicitudes/:id/imagenes',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      if (!Buffer.isBuffer(request.body)) {
        enviarError(response, 415, 'INVALID_IMAGE', 'Send the image as application/octet-stream')
        return
      }
      const result = await servicio.agregarImagen(context.subjectId, request.params['id'], request.body)
      if (result.ok) response.status(201).json({ images: result.images })
      else if (result.code === 'IMAGE_LIMIT') enviarError(response, 409, result.code, 'A request accepts up to two images')
      else if (result.code === 'INVALID_IMAGE') enviarError(response, 422, result.code, 'Use a JPG, PNG or WEBP photo of up to 3 MB')
      else enviarError(response, 404, 'NOT_FOUND', 'Service request not found')
    })
  )

  router.get(
    '/tus/v1/solicitudes/:id/imagenes/:orden',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const imagen = await servicio.imagenPrivada({ cuentaId: context.subjectId, tenantId: context.tenantId }, request.params['id'], request.params['orden'])
      if (!imagen) {
        enviarError(response, 404, 'NOT_FOUND', 'Image not found')
        return
      }
      enviarImagen(response, imagen, 'private, no-store')
    })
  )

  router.get(
    '/tus/v1/prestador/solicitudes',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      // La bandeja se limita siempre al tenant de la sesión (prestador destino).
      response.status(200).json({ items: await servicio.recibidas(context.tenantId) })
    })
  )

  router.post(
    ['/tus/v1/prestador/solicitudes/:id/aceptar', '/tus/v1/prestador/solicitudes/:id/rechazar'],
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      if (!context.permissions.includes('tus:marketplace:write')) {
        enviarError(response, 403, 'FORBIDDEN', 'Only the provider can answer this request')
        return
      }
      const decision = request.path.endsWith('/aceptar') ? 'aceptada' : 'rechazada'
      const result = await servicio.responder(context.tenantId, request.params['id'], decision)
      if (result.ok) response.status(200).json(result.solicitud)
      else enviarError(response, 404, 'NOT_FOUND', 'Pending request not found')
    })
  )

  router.post(
    '/tus/v1/prestador/solicitudes/:id/postular',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      if (!context.permissions.includes('tus:marketplace:write')) {
        enviarError(response, 403, 'FORBIDDEN', 'Only providers can apply to service requests')
        return
      }
      const body = comoRegistro(request.body)
      if (autoridadFalsificada(body, context)) {
        enviarError(response, 403, 'FORBIDDEN', 'Client authority fields are not accepted')
        return
      }
      const result = await servicio.postular({ tenantId: context.tenantId, cuentaId: context.subjectId }, request.params['id'], body)
      if (result.ok) response.status(201).json(result.postulacion)
      else if (result.code === 'INVALID_REQUEST') response.status(422).json({ code: result.code, error: 'The application has invalid fields', fields: result.fields })
      else if (result.code === 'ALREADY_APPLIED') enviarError(response, 409, result.code, 'You already applied to this request')
      else if (result.code === 'REQUEST_FULL') enviarError(response, 409, result.code, 'This request is not taking more applications')
      else if (result.code === 'SELF_REQUEST') enviarError(response, 409, result.code, 'You cannot apply to your own request')
      else if (result.code === 'PROVIDER_NOT_AVAILABLE') enviarError(response, 403, result.code, 'Complete and publish your provider profile to apply')
      else enviarError(response, 404, 'NOT_FOUND', 'Open service request not found')
    })
  )

  router.get(
    '/tus/v1/prestador/postulaciones',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      // Siempre limitadas al tenant de la sesión.
      response.status(200).json({ items: await servicio.misPostulaciones(context.tenantId) })
    })
  )

  router.post(
    '/tus/v1/prestador/postulaciones/:id/retirar',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      if (!context.permissions.includes('tus:marketplace:write')) {
        enviarError(response, 403, 'FORBIDDEN', 'Only the provider can withdraw this application')
        return
      }
      const result = await servicio.retirarPostulacion(context.tenantId, request.params['id'])
      if (result.ok) response.status(200).json({ status: 'retirada' })
      else enviarError(response, 404, 'NOT_FOUND', 'Pending application not found')
    })
  )

  router.get(
    '/tus/v1/solicitudes/:id/postulaciones',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const result = await servicio.postulantes(context.subjectId, request.params['id'])
      if (result.ok) response.status(200).json({ items: result.items })
      else enviarError(response, 404, 'NOT_FOUND', 'Service request not found')
    })
  )

  router.post(
    ['/tus/v1/solicitudes/:id/postulaciones/:postulacionId/aceptar', '/tus/v1/solicitudes/:id/postulaciones/:postulacionId/rechazar'],
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      if (request.path.endsWith('/aceptar')) {
        const result = await servicio.elegirPostulante(context.subjectId, request.params['id'], request.params['postulacionId'])
        if (result.ok) response.status(200).json(result.solicitud)
        else enviarError(response, 409, 'NOT_AVAILABLE', 'The request or the application is no longer pending')
        return
      }
      const result = await servicio.rechazarPostulante(context.subjectId, request.params['id'], request.params['postulacionId'])
      if (result.ok) response.status(200).json({ status: 'rechazada' })
      else enviarError(response, 404, 'NOT_FOUND', 'Pending application not found')
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
  const forbidden = ['cuentaId', 'accountId', 'estado', 'status', 'latitud', 'longitud', 'lat', 'lng', 'nombrePublico', 'requesterName', 'assignment', 'prestadorTenantId', 'prestadorId', 'visibility']
  if (forbidden.some((key) => key in body)) return true
  return (typeof body['tenantId'] === 'string' && body['tenantId'] !== context.tenantId) || (typeof body['actorId'] === 'string' && body['actorId'] !== context.subjectId)
}

function comoRegistro(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value) ? (value as Record<string, unknown>) : {}
}

function enviarImagen(response: Response, imagen: ImagenSolicitud, cache: string): void {
  response.setHeader('content-type', imagen.tipoMime)
  response.setHeader('cache-control', cache)
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('content-security-policy', "default-src 'none'")
  response.setHeader('cross-origin-resource-policy', 'cross-origin')
  response.status(200).end(imagen.contenido)
}

function enviarError(response: Response, status: number, code: string, error: string): void {
  response.status(status).json({ code, error })
}
