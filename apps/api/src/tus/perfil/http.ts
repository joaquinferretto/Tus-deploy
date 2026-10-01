import express, { type Request, type Response, type Router } from 'express'
import { CAMPOS_PERFIL } from '@factory/contracts'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import type { ServicioPerfil } from './servicio.ts'

// PERFIL-GEO-01.
// - GET /tus/v1/geografia/paises                       countries                              [public]
// - GET /tus/v1/geografia/provincias?paisId=           provinces of a country                 [public]
// - GET /tus/v1/geografia/localidades?provinciaId=&q=  localities of a province               [public]
// - GET /tus/v1/perfil                                 own personal profile                   [session]
// - PUT /tus/v1/perfil                                 names, document and residence          [session]
// The account is always the session's. The personal profile is private: no public endpoint serves
// a document, an address or a phone.
export function crearRouterPerfil({ servicio, sessions }: { servicio: ServicioPerfil; sessions: TusSessionResolverPort }): Router {
  const router = express.Router()

  const sesion = async (request: Request, response: Response): Promise<TusAuthenticatedTenantContext | null> => {
    response.setHeader('cache-control', 'no-store')
    const authorization = request.header('authorization') ?? ''
    const correlationId = request.header('x-correlation-id')?.trim() ?? ''
    const context = authorization.startsWith('Bearer ') && correlationId ? await sessions.resolve(authorization.slice(7).trim(), correlationId) : null
    if (!context) response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'authentication required' } })
    return context
  }
  // Reference data, but never `public`: a shared cache would replay the CORS and per-request
  // headers of whoever asked first.
  const catalogo = (response: Response) => response.setHeader('cache-control', 'private, max-age=300')
  const id = (value: unknown) => {
    const text = String(value ?? '').trim()
    return /^[A-Za-z0-9._:-]{1,120}$/u.test(text) ? text : ''
  }

  router.get('/tus/v1/geografia/paises', asyncHandler(async (_request: Request, response: Response) => {
    catalogo(response)
    response.status(200).json({ items: await servicio.paises() })
  }))

  router.get('/tus/v1/geografia/provincias', asyncHandler(async (request: Request, response: Response) => {
    const paisId = id(request.query['paisId'])
    if (!paisId) return void response.status(422).json({ error: { code: 'INVALID_REQUEST', message: 'paisId is required', fields: ['paisId'] } })
    catalogo(response)
    response.status(200).json({ items: await servicio.provincias(paisId) })
  }))

  router.get('/tus/v1/geografia/localidades', asyncHandler(async (request: Request, response: Response) => {
    const provinciaId = id(request.query['provinciaId'])
    if (!provinciaId) return void response.status(422).json({ error: { code: 'INVALID_REQUEST', message: 'provinciaId is required', fields: ['provinciaId'] } })
    catalogo(response)
    response.status(200).json({ items: await servicio.localidades(provinciaId, String(request.query['q'] ?? '').trim().slice(0, 60)) })
  }))

  router.get('/tus/v1/perfil', asyncHandler(async (request: Request, response: Response) => {
    const context = await sesion(request, response)
    if (!context) return
    const perfil = await servicio.obtener(context.subjectId)
    if (!perfil) return void response.status(404).json({ error: { code: 'NOT_FOUND', message: 'account not found' } })
    response.status(200).json({ perfil })
  }))

  router.put('/tus/v1/perfil', asyncHandler(async (request: Request, response: Response) => {
    const context = await sesion(request, response)
    if (!context) return
    const body = typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {}
    // Strict: an account id, a role or any other field is rejected, never ignored.
    const desconocidos = Object.keys(body).filter((key) => !(CAMPOS_PERFIL as readonly string[]).includes(key))
    if (desconocidos.length > 0) return void response.status(422).json({ error: { code: 'INVALID_PROFILE', message: 'unknown fields', fields: desconocidos } })
    const resultado = await servicio.actualizar(context.subjectId, body)
    if (resultado.ok) return void response.status(200).json({ perfil: resultado.perfil })
    if (resultado.code === 'INVALID_PROFILE') return void response.status(422).json({ error: { code: resultado.code, message: 'profile rejected', fields: Object.keys(resultado.errores), details: resultado.errores } })
    if (resultado.code === 'DOCUMENT_ALREADY_REGISTERED') return void response.status(409).json({ error: { code: resultado.code, message: 'the document belongs to another account', fields: ['numeroDocumento'] } })
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'account not found' } })
  }))

  return router
}
