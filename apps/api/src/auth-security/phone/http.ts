import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../tus/ports/index.ts'
import { normalizarTelefono } from '@factory/contracts'

import type { AuthService } from '../application/auth-service.js'
import { vistaDesafio, type ErrorTelefono, type ServicioVerificacionTelefono } from './servicio.ts'

// Phone identity (user-initiated WhatsApp verification).
// - GET  /auth/phone/config                     official TUS WhatsApp number (public, no secrets)
// - GET  /auth/phone                            own phone identity (masked)             [session]
// - POST /auth/phone/challenges                 verify / change the own phone           [session]
// - GET  /auth/phone/challenges/:id             state of an own challenge               [session]
// - POST /auth/phone/challenges/:id/status      state by poll secret (sign-up, recovery) [public]
// - POST /auth/phone/challenges/:id/renew       new code for the same flow (poll secret) [public]
// - POST /auth/phone/pending                    restart the phone verification of an account that
//                                               never verified, proving it with the password [public]
// - POST /auth/recovery/whatsapp                password recovery through WhatsApp      [public]
// The account always comes from the session; the phone that verifies always comes from the signed
// Meta webhook (wa_id), never from these endpoints.
export function crearRouterTelefono({ servicio, sessions, auth }: { servicio: ServicioVerificacionTelefono; sessions: TusSessionResolverPort; auth?: Pick<AuthService, 'accountPendingVerification'> }): Router {
  const router = express.Router()

  const sesion = async (request: Request, response: Response): Promise<TusAuthenticatedTenantContext | null> => {
    response.setHeader('cache-control', 'no-store')
    const authorization = request.header('authorization') ?? ''
    const correlationId = request.header('x-correlation-id')?.trim() ?? ''
    const context = authorization.startsWith('Bearer ') && correlationId ? await sessions.resolve(authorization.slice(7).trim(), correlationId) : null
    if (!context) response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'authentication required' } })
    return context
  }
  const cuerpo = (request: Request) => (typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {})
  const fallar = (response: Response, error: ErrorTelefono) => {
    const status = error.code === 'INVALID_PHONE' ? 422 : error.code === 'RATE_LIMITED' ? 429 : error.code === 'ALREADY_VERIFIED' ? 409 : error.code === 'NOT_FOUND' ? 404 : error.code === 'UNAVAILABLE' ? 503 : 403
    response.status(status).json({ error: { code: error.code, ...('motivo' in error ? { reason: error.motivo } : {}), message: 'phone verification rejected' } })
  }

  router.get('/auth/phone/config', (_request: Request, response: Response) => {
    response.setHeader('cache-control', 'public, max-age=300')
    response.status(200).json({ whatsappNumber: servicio.numeroOficial })
  })

  router.get('/auth/phone', asyncHandler(async (request: Request, response: Response) => {
    const context = await sesion(request, response)
    if (!context) return
    response.status(200).json({ phone: await servicio.estadoCuenta(context.subjectId) })
  }))

  router.post('/auth/phone/challenges', asyncHandler(async (request: Request, response: Response) => {
    const context = await sesion(request, response)
    if (!context) return
    const resultado = await servicio.iniciar(context.subjectId, { telefono: cuerpo(request)['phone'], ...(request.ip ? { ip: request.ip } : {}) })
    if (!resultado.ok) return fallar(response, resultado)
    response.status(201).json({ challenge: vistaDesafio(resultado) })
  }))

  router.get('/auth/phone/challenges/:id', asyncHandler(async (request: Request, response: Response) => {
    const context = await sesion(request, response)
    if (!context) return
    const estado = await servicio.estado(String(request.params['id'] ?? ''), { accountId: context.subjectId })
    if (!estado) return void response.status(404).json({ error: { code: 'NOT_FOUND', message: 'challenge not found' } })
    response.status(200).json(estado)
  }))

  router.post('/auth/phone/challenges/:id/status', asyncHandler(async (request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    const estado = await servicio.estado(String(request.params['id'] ?? ''), { pollSecret: cuerpo(request)['pollSecret'] })
    response.status(200).json(estado)
  }))

  router.post('/auth/phone/challenges/:id/renew', asyncHandler(async (request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    const resultado = await servicio.renovar(String(request.params['id'] ?? ''), cuerpo(request)['pollSecret'], request.ip)
    if (!resultado.ok) return fallar(response, resultado)
    response.status(201).json({ challenge: vistaDesafio(resultado) })
  }))

  router.post('/auth/phone/pending', asyncHandler(async (request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    const body = cuerpo(request)
    const telefono = normalizarTelefono(body['phone'])
    if (!telefono.ok) return fallar(response, { ok: false, code: 'INVALID_PHONE', motivo: telefono.motivo })
    const cuenta = auth ? await auth.accountPendingVerification(String(body['identifier'] ?? ''), String(body['password'] ?? '')) : null
    if (!cuenta) return void response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'The account could not be verified with those details' } })
    if (!(await servicio.permitirRegistro(telefono.e164, request.ip))) return fallar(response, { ok: false, code: 'RATE_LIMITED' })
    const resultado = await servicio.iniciarRegistro(cuenta.id, telefono.e164)
    if (!resultado.ok) return fallar(response, resultado)
    response.status(201).json({ challenge: vistaDesafio(resultado) })
  }))

  router.post('/auth/recovery/whatsapp', asyncHandler(async (request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    const resultado = await servicio.iniciarRecuperacion({ telefono: cuerpo(request)['phone'], ...(request.ip ? { ip: request.ip } : {}) })
    if (!resultado.ok) return fallar(response, resultado)
    response.status(201).json({ challenge: vistaDesafio(resultado) })
  }))

  return router
}
