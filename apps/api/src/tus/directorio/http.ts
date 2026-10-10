import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { catalogoUbicacionesPublico, categoriasPublicas } from '../catalogo/publico.ts'
import { zonasCorrientes } from '../solicitudes/modelo.ts'
import { catalogoPublico } from './oficios.ts'
import type { ServicioDirectorio } from './servicio.ts'

// Directorio "Buscar trabajador" y asistente "Buscar servicios".
// - GET  /tus/v1/public/oficios                 catálogo canónico de oficios y barrios.
// - GET  /tus/v1/public/prestadores             directorio público (filtros, orden, paginado).
// - GET  /tus/v1/public/prestadores/:id         perfil público.
// - GET  /tus/v1/prestador/perfil-publico       perfil del prestador autenticado.
// - PUT  /tus/v1/prestador/perfil-publico       crear/editar el perfil público.
// - GET  /tus/v1/public/prestadores/:id/foto    foto de un perfil visible.
// - PUT|DELETE /tus/v1/prestador/perfil-publico/foto  foto del prestador autenticado (octet-stream).
// - DELETE /tus/v1/admin/prestadores/:id/foto   quitar la foto de cualquier perfil (admin).
// - GET|PUT|DELETE /tus/v1/prestador/ubicacion  pin del prestador (su sesión) y si se muestra exacto.
// - GET|PUT|DELETE /tus/v1/admin/prestadores/:id/ubicacion  lo mismo para cualquier perfil (admin).
// - POST /tus/v1/asistente/interpretar          interpreta el texto (oficio, barrio, urgencia).
// - POST /tus/v1/asistente/candidatos           prestadores compatibles (requiere sesión).
export function crearRouterDirectorio({ servicio, sessions, adminSave }: {
  servicio: ServicioDirectorio
  sessions: TusSessionResolverPort
  adminSave?: (context: TusAuthenticatedTenantContext, body: Record<string, unknown>) => Promise<{ status: number; code?: string; fields?: string[]; profile?: unknown }>
}): Router {
  const router = express.Router()

  router.post('/tus/v1/admin/prestadores', asyncHandler(async (request, response) => {
    const context = await autenticar(request, response, sessions)
    if (!context) return
    if (!context.permissions.includes('tus:providers:admin')) {
      enviarError(response, 403, 'FORBIDDEN', 'Administration requires an elevated admin session')
      return
    }
    if (!adminSave) { enviarError(response, 503, 'UNAVAILABLE', 'Administration unavailable'); return }
    const { status, ...result } = await adminSave(context, comoRegistro(request.body))
    response.status(status).json(result)
  }))

  router.get('/tus/v1/public/oficios', (_request: Request, response: Response) => {
    // Never `public`: the response carries per-request headers (CORS for the caller's Origin,
    // X-Correlation-Id, rate limit) and a shared cache in front of the API replayed it to other
    // callers ignoring `Vary: Origin`. The administration can also change the catalog at any time.
    response.setHeader('cache-control', 'private, no-store')
    response.status(200).json({
      items: catalogoPublico(),
      zones: zonasCorrientes().map((zona) => zona.nombre),
      categories: categoriasPublicas(),
      locations: catalogoUbicacionesPublico(),
    })
  })

  router.get(
    '/tus/v1/public/prestadores',
    asyncHandler(async (request: Request, response: Response) => {
      const resultado = await servicio.listar({
        oficio: request.query['oficio'],
        categoria: request.query['categoria'],
        mapa: request.query['mapa'],
        zona: request.query['zona'],
        q: request.query['q'],
        verificados: request.query['verificados'],
        atiendeHoy: request.query['hoy'],
        orden: request.query['orden'],
        pagina: request.query['pagina'],
      })
      response.setHeader('cache-control', 'private, no-store')
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
      response.setHeader('cache-control', 'private, no-store')
      response.status(200).json(perfil)
    })
  )

  // ---- ubicación en el mapa ----------------------------------------------------------------------
  // Provider: ALWAYS its own profile (tenant from the session); authority fields in the body are
  // refused. Admin: any profile by its public id, behind the elevated admin permission.
  const CLAVES_AUTORIDAD = ['tenantId', 'prestadorId', 'merchantId', 'perfilId', 'profileId', 'id']
  const responderUbicacion = (response: Response, result: Awaited<ReturnType<ServicioDirectorio['guardarMiUbicacion']>>) => {
    if (result.ok) response.status(200).json({ location: result.ubicacion })
    else if (result.code === 'INVALID_LOCATION') enviarError(response, 422, result.code, 'Latitude must be between -90 and 90 and longitude between -180 and 180')
    else enviarError(response, 404, result.code, 'Provider profile not found')
  }
  router.get('/tus/v1/prestador/ubicacion', asyncHandler(async (request: Request, response: Response) => {
    const context = await autenticar(request, response, sessions)
    if (!context) return
    if (!context.permissions.includes('tus:marketplace:write')) { enviarError(response, 403, 'FORBIDDEN', 'Provider session required'); return }
    response.status(200).json({ location: await servicio.miUbicacion(context.tenantId) })
  }))
  router.put('/tus/v1/prestador/ubicacion', asyncHandler(async (request: Request, response: Response) => {
    const context = await autenticar(request, response, sessions)
    if (!context) return
    const body = comoRegistro(request.body)
    if (!context.permissions.includes('tus:marketplace:write') || CLAVES_AUTORIDAD.some((key) => key in body)) { enviarError(response, 403, 'FORBIDDEN', 'Only your own location can be changed'); return }
    responderUbicacion(response, await servicio.guardarMiUbicacion(context.tenantId, { lat: body['lat'], lng: body['lng'], mostrarExacta: body['showExact'] }))
  }))
  router.delete('/tus/v1/prestador/ubicacion', asyncHandler(async (request: Request, response: Response) => {
    const context = await autenticar(request, response, sessions)
    if (!context) return
    if (!context.permissions.includes('tus:marketplace:write')) { enviarError(response, 403, 'FORBIDDEN', 'Provider session required'); return }
    responderUbicacion(response, await servicio.guardarMiUbicacion(context.tenantId, { quitar: true }))
  }))
  const admin = async (request: Request, response: Response) => {
    const context = await autenticar(request, response, sessions)
    if (!context) return null
    if (!context.permissions.includes('tus:providers:admin')) { enviarError(response, 403, 'FORBIDDEN', 'Administration requires an elevated admin session'); return null }
    return context
  }
  router.get('/tus/v1/admin/prestadores/:id/ubicacion', asyncHandler(async (request: Request, response: Response) => {
    if (!(await admin(request, response))) return
    const location = await servicio.ubicacionDePerfil(String(request.params['id'] ?? ''))
    if (!location) { enviarError(response, 404, 'NOT_FOUND', 'Provider profile not found'); return }
    response.status(200).json({ location })
  }))
  router.put('/tus/v1/admin/prestadores/:id/ubicacion', asyncHandler(async (request: Request, response: Response) => {
    if (!(await admin(request, response))) return
    const body = comoRegistro(request.body)
    responderUbicacion(response, await servicio.guardarUbicacionDePerfil(String(request.params['id'] ?? ''), { lat: body['lat'], lng: body['lng'], mostrarExacta: body['showExact'] }))
  }))
  router.delete('/tus/v1/admin/prestadores/:id/ubicacion', asyncHandler(async (request: Request, response: Response) => {
    if (!(await admin(request, response))) return
    responderUbicacion(response, await servicio.guardarUbicacionDePerfil(String(request.params['id'] ?? ''), { quitar: true }))
  }))

  // ---- foto de perfil ---------------------------------------------------------------------------
  // Owner: ALWAYS its own profile (tenant from the session; there is no id to tamper with). The
  // body is the raw image; its Content-Type and any file name are ignored (magic bytes decide).
  const responderFoto = (response: Response, result: Awaited<ReturnType<ServicioDirectorio['guardarMiFoto']>>) => {
    if (result.ok) response.status(200).json({ photoUrl: result.photoUrl })
    else if (result.code === 'NOT_FOUND') enviarError(response, 404, result.code, 'Provider profile not found')
    else if (result.code === 'UNAVAILABLE') enviarError(response, 503, result.code, 'Profile photos are not available')
    else if (result.code === 'RATE_LIMITED') enviarError(response, 429, result.code, 'Too many photo uploads; try again later')
    else if (result.code === 'PHOTO_TOO_LARGE') enviarError(response, 413, result.code, 'Use a photo of up to 2 MB')
    else if (result.code === 'PHOTO_TYPE_NOT_ALLOWED') enviarError(response, 415, result.code, 'Use a JPG, PNG or WEBP photo')
    else enviarError(response, 422, result.code, 'Use a JPG, PNG or WEBP photo between 96 and 4096 pixels per side')
  }
  router.put('/tus/v1/prestador/perfil-publico/foto', asyncHandler(async (request: Request, response: Response) => {
    const context = await autenticar(request, response, sessions)
    if (!context) return
    if (!context.permissions.includes('tus:marketplace:write')) { enviarError(response, 403, 'FORBIDDEN', 'Provider session required'); return }
    if (!Buffer.isBuffer(request.body)) { enviarError(response, 415, 'PHOTO_TYPE_NOT_ALLOWED', 'Send the photo as application/octet-stream'); return }
    responderFoto(response, await servicio.guardarMiFoto(context.tenantId, request.body))
  }))
  router.delete('/tus/v1/prestador/perfil-publico/foto', asyncHandler(async (request: Request, response: Response) => {
    const context = await autenticar(request, response, sessions)
    if (!context) return
    if (!context.permissions.includes('tus:marketplace:write')) { enviarError(response, 403, 'FORBIDDEN', 'Provider session required'); return }
    responderFoto(response, await servicio.quitarMiFoto(context.tenantId))
  }))
  router.delete('/tus/v1/admin/prestadores/:id/foto', asyncHandler(async (request: Request, response: Response) => {
    if (!(await admin(request, response))) return
    responderFoto(response, await servicio.quitarFotoDePerfil(request.params['id']))
  }))
  router.get('/tus/v1/public/prestadores/:id/foto', asyncHandler(async (request: Request, response: Response) => {
    const foto = await servicio.fotoPublica(request.params['id'])
    if (!foto) { enviarError(response, 404, 'NOT_FOUND', 'Photo not found'); return }
    // The type is the one TUS detected, never the one the uploader declared; the browser must not
    // guess another, and the response can run nothing. Only the browser caches it: a profile that
    // is hidden stops serving its photo, and a shared cache would keep doing it.
    response.setHeader('content-type', foto.tipoMime)
    response.setHeader('content-length', String(foto.contenido.length))
    response.setHeader('cache-control', 'private, max-age=3600')
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('content-security-policy', "default-src 'none'; sandbox")
    response.setHeader('content-disposition', 'inline')
    response.setHeader('cross-origin-resource-policy', 'cross-origin')
    response.status(200).end(foto.contenido)
  }))

  router.get(
    '/tus/v1/prestador/perfil-publico',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      // `publicName`: PRESTADOR-TIPO-01, what the form shows instead of a field when it is derived.
      response.status(200).json({ profile: await servicio.miPerfil(context), publicName: await servicio.reglaNombrePublico(context.tenantId) })
    })
  )

  router.put(
    '/tus/v1/prestador/perfil-publico',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const body = comoRegistro(request.body)
      if (!context.permissions.includes('tus:marketplace:write') || ['tenantId', 'prestadorId', 'merchantId', 'id', 'verified', 'completedJobs', 'rating', 'address', 'direccion', 'street', 'houseNumber', 'latitude', 'longitude', 'lat', 'lng', 'exactLatitude', 'exactLongitude', 'documentAddress'].some((key) => key in body)) {
        enviarError(response, 403, 'FORBIDDEN', 'This profile cannot be edited with this session')
        return
      }
      const result = await servicio.guardarPerfil(context, body)
      if (result.ok) response.status(200).json({ profile: result.perfil })
      else if (result.code === 'INVALID_PROFILE') response.status(422).json({ code: result.code, error: 'The profile has invalid fields', fields: result.fields })
      else if (result.code === 'PUBLIC_NAME_DERIVED') enviarError(response, 422, result.code, 'The public name of a person is the full name of the holder of the account')
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
