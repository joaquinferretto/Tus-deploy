import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { ServicioAyudaPublica } from './ayuda.ts'

// - POST /tus/v1/asistente/ayuda   ayuda pública del asistente Web (conocimiento `public`, extractivo).
// Sin sesión: nunca devuelve datos de cuentas, trabajos ni pagos (eso lo resuelven las tools).
export function crearRouterAyuda({ ayuda }: { ayuda: ServicioAyudaPublica | null }): Router {
  const router = express.Router()

  router.post(
    '/tus/v1/asistente/ayuda',
    asyncHandler(async (request: Request, response: Response) => {
      const body = typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {}
      if (!ayuda) {
        response.status(503).json({ code: 'UNAVAILABLE', error: 'Help is not available right now' })
        return
      }
      const result = await ayuda.responder(body['question'])
      if (result.status === 'invalid') {
        response.status(422).json({ code: 'INVALID_REQUEST', error: 'Write a question of 3 to 300 characters', fields: ['question'] })
        return
      }
      if (result.status === 'unavailable') {
        response.status(503).json({ code: 'UNAVAILABLE', error: 'Help is not available right now' })
        return
      }
      response.setHeader('cache-control', 'no-store')
      response.status(200).json(result)
    })
  )

  return router
}
