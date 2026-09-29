import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { TrabajoError, type ServicioTrabajo } from '../work/index.ts'

// Platform support over works (MFA-elevated admin session, same gate as the rest of the panel).
//
// - POST /tus/v1/admin/trabajos/:id/cancelar   cancel any non-terminal work with a reason, also
//   after a payment. It never moves money: a refund is a separate admin operation
//   (POST /tus/v1/admin/payments/refunds) with its own idempotency and provider rules.

const SUPPORT = 'tus:payments:admin'

export interface DependenciasAdminTrabajos {
  sessions: TusSessionResolverPort
  trabajos: ServicioTrabajo
  now?: () => number
}

export function crearRouterAdminTrabajos(deps: DependenciasAdminTrabajos): Router {
  const router = express.Router()
  const now = deps.now ?? Date.now

  const guard = async (request: Request, response: Response): Promise<TusAuthenticatedTenantContext | null> => {
    response.setHeader('cache-control', 'no-store')
    const authorization = request.header('authorization') ?? ''
    const correlationId = request.header('x-correlation-id') ?? ''
    const context =
      authorization.startsWith('Bearer ') && correlationId
        ? await deps.sessions.resolve(authorization.slice(7).trim(), correlationId)
        : null
    if (!context) {
      response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'authentication required' } })
      return null
    }
    if (!context.permissions.includes(SUPPORT)) {
      response.status(403).json({ error: { code: 'FORBIDDEN', message: 'platform administration requires an MFA-elevated admin session' } })
      return null
    }
    return context
  }

  router.post(
    '/tus/v1/admin/trabajos/:id/cancelar',
    asyncHandler(async (request, response) => {
      const context = await guard(request, response)
      if (!context) return
      const body = (request.body ?? {}) as Record<string, unknown>
      const idempotencyKey = request.header('idempotency-key')?.trim() ?? ''
      if (!idempotencyKey) {
        response.status(400).json({ error: { code: 'INVALID', message: 'idempotency-key is required' } })
        return
      }
      try {
        const result = await deps.trabajos.cancelarComoSoporte({
          actorId: context.subjectId,
          correlationId: context.correlationId,
          trabajoId: String(request.params['id'] ?? ''),
          expectedVersion: Number(body['expectedVersion']),
          reason: typeof body['reason'] === 'string' ? body['reason'] : '',
          idempotencyKey,
          requestHash: `admin-cancel:${idempotencyKey}`,
          createdAt: new Date(now()).toISOString(),
        })
        response.status(200).json({ status: result.status, work: { id: result.work.trabajoId, status: result.work.status, version: result.work.version } })
      } catch (error) {
        if (!(error instanceof TrabajoError)) throw error
        response.status(error.status).json({ error: { code: error.code, message: error.message } })
      }
    })
  )

  return router
}
