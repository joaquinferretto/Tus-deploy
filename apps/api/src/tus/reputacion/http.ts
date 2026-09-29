import express, { type Router } from 'express'
import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusSessionResolverPort } from '../ports/index.ts'
import { ErrorCalificacion, type ServicioCalificaciones } from './calificaciones.ts'

// POST /tus/v1/trabajos/:id/calificacion  { score: 1..5, comment?: string }
// The client of a completed work rates its provider once. The tenant, the author and the provider
// come from the session and the persisted work; anything else in the body is ignored.
export function crearRouterCalificaciones({
  servicio,
  sessions,
}: {
  servicio: ServicioCalificaciones
  sessions: TusSessionResolverPort
}): Router {
  const router = express.Router()
  router.post(
    ['/tus/v1/trabajos/:id/calificacion', '/tus/v1/work/:id/rating'],
    asyncHandler(async (req, res) => {
      res.setHeader('cache-control', 'no-store')
      const auth = req.header('authorization') ?? ''
      const correlationId = req.header('x-correlation-id')?.trim() ?? ''
      const context =
        auth.startsWith('Bearer ') && correlationId
          ? await sessions.resolve(auth.slice(7).trim(), correlationId)
          : null
      if (!context) {
        res.status(401).json({ code: 'UNAUTHORIZED' })
        return
      }
      if (!context.permissions.some((p) => ['tus:checkout', 'tus:work:accept'].includes(p))) {
        res.status(403).json({ code: 'FORBIDDEN' })
        return
      }
      const body = (req.body ?? {}) as Record<string, unknown>
      try {
        const rating = await servicio.calificar({
          tenantId: context.tenantId,
          cuentaId: context.subjectId,
          trabajoId: String(req.params['id'] ?? ''),
          score: body['score'],
          comment: body['comment'],
        })
        res.status(201).json(rating)
      } catch (error) {
        if (!(error instanceof ErrorCalificacion)) throw error
        res.status(error.status).json({ code: error.code, error: error.message })
      }
    })
  )
  return router
}
