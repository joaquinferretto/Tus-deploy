import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import { paginaJson, paginacion } from '../admin/paginacion.ts'
import { oficio } from '../directorio/oficios.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import type { ServicioUrgentes } from './servicio.ts'

// SERVICIO-URGENTE-01 over HTTP. The same use cases the WhatsApp assistant calls.
// - POST /tus/v1/urgentes                              the client asks for an urgent service: it
//                                                      is offered at once to every compatible provider.
// - GET  /tus/v1/urgentes/mias                         its urgent requests, with their real state.
// - GET  /tus/v1/prestador/urgentes                    the offers of the provider of the session
//                                                      (address and zone included).
// - GET|PUT /tus/v1/prestador/urgentes/preferencia     "Aceptar servicios urgentes" (opt-in) and
//                                                      "Atiendo en toda la ciudad" (explicit).
// - POST /tus/v1/prestador/urgentes/:id/asistir        "Puedo asistir": the first one wins.
// - POST /tus/v1/prestador/urgentes/:id/no-puedo       "No puedo" (from the assigned provider:
//                                                      gives the assignment back; `reason` optional).
// - GET  /tus/v1/admin/urgentes?page=&pageSize=        administration: every urgent request with
//                                                      its candidates, answers and deliveries.
// Who acts is the session: no body field names an account, a tenant or a provider.

// What the administration needs besides the service: the public name of each candidate and what
// WhatsApp reported for each notice (both optional: absent, the columns are simply empty).
export interface FuentesAdminUrgentes {
  nombres?: (tenantIds: readonly string[]) => Promise<Map<string, { id: string; nombrePublico: string }>>
  entregas?: (correlaciones: readonly string[]) => Promise<{ correlationId: string; cuentaId: string | null; waIdMasked: string | null; status: string; at: string; error: string | null }[]>
}

const ADMIN = 'tus:providers:admin'

export function crearRouterUrgentes({ servicio, sessions, admin = {} }: { servicio: ServicioUrgentes; sessions: TusSessionResolverPort; admin?: FuentesAdminUrgentes }): Router {
  const router = express.Router()

  router.post(
    '/tus/v1/urgentes',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const body = comoRegistro(request.body)
      if (autoridadFalsificada(body)) {
        enviarError(response, 403, 'FORBIDDEN', 'Client authority fields are not accepted')
        return
      }
      const resultado = await servicio.crear(context.subjectId, body, { origen: 'web_publica' })
      if (resultado.ok) {
        response.status(201).json({ ...resultado.solicitud, message: resultado.mensaje })
        return
      }
      if (resultado.code === 'INVALID_REQUEST') {
        response.status(422).json({ code: resultado.code, error: 'The request has invalid fields', fields: resultado.fields })
        return
      }
      if (resultado.code === 'RATE_LIMITED') return void enviarError(response, 429, resultado.code, 'Too many service requests; try again later')
      if (resultado.code === 'URGENT_ALREADY_OPEN') return void enviarError(response, 409, resultado.code, 'This account already has an urgent request waiting')
      enviarError(response, 403, resultado.code, 'This account cannot ask for urgent services')
    })
  )

  router.get(
    '/tus/v1/urgentes/mias',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      response.status(200).json({ items: await servicio.mias(context.subjectId) })
    })
  )

  router.get(
    '/tus/v1/prestador/urgentes/preferencia',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const resultado = await servicio.preferencia(context.tenantId)
      if (!resultado.ok) return void enviarError(response, 409, resultado.code, 'A provider profile is required')
      const { ok: _ok, ...preferencia } = resultado
      response.status(200).json(preferencia)
    })
  )

  router.put(
    '/tus/v1/prestador/urgentes/preferencia',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const body = comoRegistro(request.body)
      const resultado = await servicio.guardarPreferencia(context.tenantId, { acceptsUrgent: body['acceptsUrgent'], wholeCity: body['wholeCity'] })
      if (!resultado.ok) return void enviarError(response, resultado.code === 'INVALID_REQUEST' ? 422 : 409, resultado.code, resultado.code === 'INVALID_REQUEST' ? 'acceptsUrgent and wholeCity must be true or false' : 'A provider profile is required')
      const { ok: _ok, ...preferencia } = resultado
      response.status(200).json(preferencia)
    })
  )

  router.get(
    '/tus/v1/prestador/urgentes',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      response.status(200).json({ items: await servicio.ofertas(context.tenantId) })
    })
  )

  for (const [ruta, asistir] of [['asistir', true], ['no-puedo', false]] as const) {
    router.post(
      `/tus/v1/prestador/urgentes/:id/${ruta}`,
      asyncHandler(async (request: Request, response: Response) => {
        const context = await autenticar(request, response, sessions)
        if (!context) return
        const actor = { tenantId: context.tenantId, cuentaId: context.subjectId }
        const respuesta = asistir
          ? await servicio.asistir(actor, request.params['id'], 'web', context.correlationId)
          : await servicio.noPuede(actor, request.params['id'], 'web', { motivo: comoRegistro(request.body)['reason'], correlationId: context.correlationId })
        const status = respuesta.estado === 'no_candidato' ? 404 : ['asignado', 'no_puede', 'ya_respondida', 'renuncia', 'ya_renuncio'].includes(respuesta.estado) ? 200 : 409
        response.status(status).json({ status: respuesta.estado, message: respuesta.mensaje, workId: respuesta.trabajoId })
      })
    )
  }

  router.get(
    '/tus/v1/admin/urgentes',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      if (!context.permissions.includes(ADMIN)) return void response.status(403).json({ error: { code: 'FORBIDDEN', message: 'platform administration requires an MFA-elevated admin session' } })
      const { pagina, tamano } = paginacion(request.query)
      const { items, total } = await servicio.paginaParaAdmin({ pagina, tamano })
      const tenants = [...new Set(items.flatMap((item) => item.ofertas.map((oferta) => oferta.prestadorTenantId)))]
      const correlaciones = items.flatMap((item) => [...new Set(item.ofertas.map((oferta) => oferta.ronda))].map((ronda) => `urgente-oferta:${item.solicitud.id}:${ronda}`))
      const [nombres, entregas] = await Promise.all([
        admin.nombres ? admin.nombres(tenants).catch(() => new Map<string, { id: string; nombrePublico: string }>()) : new Map<string, { id: string; nombrePublico: string }>(),
        admin.entregas ? admin.entregas(correlaciones).catch(() => []) : [],
      ])
      const iso = (value: number | null) => (value === null ? null : new Date(value).toISOString())
      response.status(200).json(
        paginaJson(
          items.map(({ solicitud, ofertas, estado }) => {
            const candidatos = ofertas.map((oferta) => {
              const entrega = entregas.filter((item) => item.correlationId === `urgente-oferta:${solicitud.id}:${oferta.ronda}` && item.cuentaId !== null && item.cuentaId === oferta.cuentaId).at(-1) ?? null
              return {
                provider: { id: nombres.get(oferta.prestadorTenantId)?.id ?? null, name: nombres.get(oferta.prestadorTenantId)?.nombrePublico ?? 'Prestador' },
                status: oferta.estado,
                round: oferta.ronda,
                channel: oferta.canal,
                notSentReason: oferta.estado === 'no_enviada' || oferta.notificadaEn === null ? oferta.motivoNoEnviada : null,
                notifiedAt: iso(oferta.notificadaEn),
                answeredAt: iso(oferta.respondidaEn),
                answerChannel: oferta.canalRespuesta,
                acceptedAt: iso(oferta.aceptadaEn),
                resignedAt: iso(oferta.renunciaEn),
                resignationChannel: oferta.canalRenuncia,
                resignationReason: oferta.motivoRenuncia,
                // What WhatsApp reported for its notice (sent, delivered, read, failed), masked number.
                delivery: entrega ? { status: entrega.status, at: entrega.at, error: entrega.error, waIdMasked: entrega.waIdMasked } : null,
              }
            })
            const ganador = ofertas.find((oferta) => oferta.estado === 'acepto')
            return {
              id: solicitud.id,
              status: estado,
              client: solicitud.nombrePublico,
              service: oficio(solicitud.categoria).label,
              description: solicitud.descripcion,
              address: solicitud.direccion ?? '',
              zone: solicitud.zona,
              origin: solicitud.origen,
              createdAt: new Date(solicitud.creadaEn).toISOString(),
              expiresAt: new Date(solicitud.expiraEn).toISOString(),
              reopenings: solicitud.reaperturasUrgente ?? 0,
              workId: solicitud.trabajoId,
              winner: ganador ? { name: nombres.get(ganador.prestadorTenantId)?.nombrePublico ?? 'Prestador', acceptedAt: iso(ganador.aceptadaEn) } : null,
              counts: {
                candidates: ofertas.length,
                notified: ofertas.filter((oferta) => oferta.notificadaEn !== null).length,
                rejected: ofertas.filter((oferta) => oferta.estado === 'no_puede').length,
                resigned: ofertas.filter((oferta) => oferta.estado === 'renuncio').length,
                unanswered: ofertas.filter((oferta) => oferta.estado === 'notificada' || oferta.estado === 'vencida' || oferta.estado === 'cerrada_por_otro').length,
                deliveryFailed: candidatos.filter((candidato) => candidato.delivery?.status === 'failed' || candidato.notSentReason === 'fallo_envio').length,
              },
              candidates: candidatos,
            }
          }),
          pagina,
          tamano,
          total
        )
      )
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

// Nothing in the body can say who asks, who is assigned or in which state the request is.
function autoridadFalsificada(body: Record<string, unknown>): boolean {
  return ['cuentaId', 'accountId', 'tenantId', 'actorId', 'estado', 'status', 'prestadorTenantId', 'prestadorId', 'providerId', 'winner', 'expiresAt', 'latitud', 'longitud'].some((key) => key in body)
}

function comoRegistro(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value) ? (value as Record<string, unknown>) : {}
}

function enviarError(response: Response, status: number, code: string, error: string): void {
  response.status(status).json({ code, error })
}
