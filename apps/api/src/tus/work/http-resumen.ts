import express, { type Router } from 'express'
import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusSessionResolverPort } from '../ports/index.ts'
import { TrabajoError } from './index.ts'
import type { ServicioResumenTrabajo } from './resumen.ts'

export function crearRouterResumenTrabajo({
  servicio,
  sessions,
}: {
  servicio: ServicioResumenTrabajo
  sessions: TusSessionResolverPort
}): Router {
  const router = express.Router()
  for (const path of ['/tus/v1/mis-trabajos', '/tus/v1/trabajos/:id/resumen']) {
    router.get(
      path,
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
        if (
          !context.permissions.some((p) =>
            ['tus:work:read', 'tus:marketplace:read', 'tus:checkout'].includes(p)
          )
        ) {
          res.status(403).json({ code: 'FORBIDDEN' })
          return
        }
        try {
          res.json(
            req.params['id']
              ? await servicio.obtener(context.tenantId, req.params['id'], context.permissions)
              : await servicio.listar(context.tenantId, context.permissions)
          )
        } catch (error) {
          if (!(error instanceof TrabajoError)) throw error
          res.status(error.status).json({ code: error.code, error: error.message })
        }
      })
    )
  }
  return router
}
