import express, { type Request, type Response, type Router } from 'express'
import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { ErrorCierreTrabajo, observacionAbierta, type CierreTrabajo, type ResultadoCierre, type ServicioCierreTrabajo } from './cierre.ts'

// CIERRE-TRABAJO-01 over HTTP. The work is the one of the path and the actor is the session: the
// body only carries the evidence of the provider or the reason of the client. A turno is closed
// through its order (the work TUS keeps behind every accepted turno), found by the server.

const CAMPOS = { finalizacion: ['evidence'], observacion: ['reason'] } as const

function vista(cierre: CierreTrabajo) {
  return {
    workId: cierre.trabajoId,
    finishedAt: cierre.finishedAt,
    evidence: cierre.evidence,
    confirmationDueAt: cierre.confirmationDueAt,
    confirmedAt: cierre.confirmedAt,
    confirmationOrigin: cierre.confirmationOrigin,
    observation: cierre.observedAt ? { at: cierre.observedAt, reason: cierre.observationReason, open: observacionAbierta(cierre), resolvedAt: cierre.observationResolvedAt } : null,
  }
}

const respuesta = (resultado: ResultadoCierre) => ({ status: resultado.status, closing: vista(resultado.cierre), payments: resultado.pagos })

export function crearRouterCierres(opciones: {
  cierre: ServicioCierreTrabajo
  sessions: TusSessionResolverPort
  // The order of a turno, for the tenant that asks (its client or its provider); null otherwise.
  ordenDeTurno?: (input: { reservaId: string; tenantId: string }) => Promise<string | null>
}): Router {
  const router = express.Router()
  const { cierre, sessions } = opciones

  const sesion = async (request: Request, response: Response): Promise<TusAuthenticatedTenantContext | null> => {
    const authorization = request.header('authorization') ?? ''
    const correlationId = request.header('x-correlation-id')?.trim() ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
    const context = token && correlationId ? await sessions.resolve(token, correlationId) : null
    if (!context) response.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' })
    else response.setHeader('cache-control', 'private, no-store')
    return context
  }
  const cuerpo = (request: Request, response: Response, campos: readonly string[]): Record<string, unknown> | null => {
    const body = typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) && !Buffer.isBuffer(request.body) ? (request.body as Record<string, unknown>) : {}
    const ajenos = Object.keys(body).filter((campo) => !campos.includes(campo))
    if (ajenos.length === 0) return body
    response.status(400).json({ code: 'UNTRUSTED_FIELDS', error: 'El trabajo, quién lo confirma y los importes los determina TUS.', fields: ajenos })
    return null
  }
  const fallar = (response: Response, error: unknown): void => {
    if (error instanceof ErrorCierreTrabajo) return void response.status(error.status).json({ code: error.code, error: error.message })
    response.status(500).json({ code: 'INTERNAL_ERROR', error: 'No se pudo completar la operación.' })
  }
  const actor = (context: TusAuthenticatedTenantContext) => ({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId })
  // The work of the path: its own id, or the order of the turno of the path.
  const trabajoDe = async (request: Request, context: TusAuthenticatedTenantContext, turno: boolean): Promise<string> => {
    const id = String(request.params['id'] ?? '')
    if (!turno) return id
    const orden = opciones.ordenDeTurno ? await opciones.ordenDeTurno({ reservaId: id, tenantId: context.tenantId }) : null
    if (!orden) throw new ErrorCierreTrabajo(404, 'NOT_FOUND', 'turno was not found')
    return orden
  }

  for (const [ruta, turno] of [['/tus/v1/trabajos/:id/finalizacion', false], ['/tus/v1/prestador/turnos/:id/finalizar', true]] as const)
    router.post(ruta, asyncHandler(async (request: Request, response: Response) => {
      const context = await sesion(request, response)
      if (!context) return
      const body = cuerpo(request, response, CAMPOS.finalizacion)
      if (!body) return
      try {
        const resultado = await cierre.finalizar(actor(context), await trabajoDe(request, context, turno), { evidence: body['evidence'] })
        response.status(resultado.status === 'created' ? 201 : 200).json(respuesta(resultado))
      } catch (error) {
        fallar(response, error)
      }
    }))

  for (const [ruta, turno] of [['/tus/v1/trabajos/:id/confirmacion', false], ['/tus/v1/cliente/turnos/:id/confirmar', true]] as const)
    router.post(ruta, asyncHandler(async (request: Request, response: Response) => {
      const context = await sesion(request, response)
      if (!context) return
      if (!cuerpo(request, response, [])) return
      try {
        response.status(200).json(respuesta(await cierre.confirmar(actor(context), await trabajoDe(request, context, turno))))
      } catch (error) {
        fallar(response, error)
      }
    }))

  for (const [ruta, turno] of [['/tus/v1/trabajos/:id/observacion', false], ['/tus/v1/cliente/turnos/:id/observar', true]] as const)
    router.post(ruta, asyncHandler(async (request: Request, response: Response) => {
      const context = await sesion(request, response)
      if (!context) return
      const body = cuerpo(request, response, CAMPOS.observacion)
      if (!body) return
      try {
        response.status(200).json(respuesta(await cierre.observar(actor(context), await trabajoDe(request, context, turno), { reason: body['reason'] })))
      } catch (error) {
        fallar(response, error)
      }
    }))

  for (const [ruta, turno] of [['/tus/v1/trabajos/:id/cierre', false], ['/tus/v1/turnos/:id/cierre', true]] as const)
    router.get(ruta, asyncHandler(async (request: Request, response: Response) => {
      const context = await sesion(request, response)
      if (!context) return
      try {
        const actual = await cierre.ver(actor(context), await trabajoDe(request, context, turno))
        response.status(200).json({ closing: actual ? vista(actual) : null })
      } catch (error) {
        fallar(response, error)
      }
    }))

  return router
}
