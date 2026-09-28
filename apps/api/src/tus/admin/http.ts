import express, { type Request, type Response, type Router } from 'express'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import type { ServicioDirectorio } from '../directorio/servicio.ts'
import type { ServicioSolicitudes } from '../solicitudes/servicio.ts'
import { OFICIOS } from '../directorio/oficios.ts'
import { ZONAS_CORRIENTES } from '../solicitudes/modelo.ts'

// Read-mostly views of the platform administration panel. Every route resolves the session
// through the MFA gate (MfaAdminSessionResolver): the platform permissions only exist for an
// allowlisted, verified, email + password session that passed the second factor.
//
// - GET  /tus/v1/admin/resumen                       real counts for the dashboard
// - GET  /tus/v1/admin/usuarios?q=&rol=              registered accounts (no secrets)
// - GET  /tus/v1/admin/prestadores                   every profile + why it is (not) on the map
// - POST /tus/v1/admin/prestadores/:id/visibilidad   publish / hide a profile
// - GET  /tus/v1/admin/solicitudes                   recent service requests
// - GET  /tus/v1/admin/catalogo                      trades and zones the search recognises
// - GET  /tus/v1/admin/actividad                     recent security/audit events

export interface CuentaAdmin {
  id: string
  tenantId: string
  nombre: string
  email: string
  estado: string
  verificado: boolean
  conContrasena: boolean
  creadaEn: string
}

export interface FuenteCuentasAdmin {
  listar(input: { q: string; limite: number }): Promise<CuentaAdmin[]>
  contar(): Promise<number>
}

export interface EventoActividad {
  tipo: string
  resultado: string
  fecha: string
}

export interface FuenteActividadAdmin {
  recientes(limite: number): Promise<EventoActividad[]>
}

export interface DependenciasAdmin {
  sessions: TusSessionResolverPort
  directorio: ServicioDirectorio
  solicitudes: ServicioSolicitudes
  cuentas: FuenteCuentasAdmin
  actividad?: FuenteActividadAdmin
  // Allowlist read live (same as the MFA gate): who is a platform admin right now.
  adminEmails: () => readonly string[]
  // Conversations waiting for a person in the WhatsApp module (null when it is not enabled).
  whatsappPendientes?: () => Promise<number | null>
  now?: () => number
}

const ADMIN = 'tus:providers:admin'
const IDENTITY_ADMIN = 'tus:identity:admin'

export function crearRouterAdmin(deps: DependenciasAdmin): Router {
  const router = express.Router()

  const guard = async (request: Request, response: Response, permission = ADMIN): Promise<TusAuthenticatedTenantContext | null> => {
    response.setHeader('cache-control', 'no-store')
    const authorization = request.header('authorization') ?? ''
    const correlationId = request.header('x-correlation-id') ?? ''
    const context = authorization.startsWith('Bearer ') && correlationId ? await deps.sessions.resolve(authorization.slice(7).trim(), correlationId) : null
    if (!context) {
      response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'authentication required' } })
      return null
    }
    if (!context.permissions.includes(permission)) {
      response.status(403).json({ error: { code: 'FORBIDDEN', message: 'platform administration requires an MFA-elevated admin session' } })
      return null
    }
    return context
  }

  const prestadoresPorTenant = async () => {
    const perfiles = await deps.directorio.listarParaAdmin()
    return perfiles
  }

  router.get('/tus/v1/admin/resumen', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    const [usuarios, prestadores, solicitudes, whatsapp] = await Promise.all([
      deps.cuentas.contar(),
      prestadoresPorTenant(),
      deps.solicitudes.listarParaAdmin(200),
      deps.whatsappPendientes ? deps.whatsappPendientes().catch(() => null) : Promise.resolve(null),
    ])
    response.status(200).json({
      usuarios,
      prestadores: { total: prestadores.length, enMapa: prestadores.filter((item) => item.enMapa).length },
      solicitudes: {
        publicadas: solicitudes.filter((item) => item.estado === 'publicada').length,
        sinPostulantes: solicitudes.filter((item) => item.estado === 'publicada' && item.postulantes === 0).length,
      },
      whatsappPendientes: whatsapp,
    })
  }))

  router.get('/tus/v1/admin/usuarios', asyncHandler(async (request, response) => {
    if (!(await guard(request, response, IDENTITY_ADMIN))) return
    const q = String(request.query['q'] ?? '').trim().slice(0, 120)
    const rol = String(request.query['rol'] ?? '')
    const [cuentas, perfiles] = await Promise.all([deps.cuentas.listar({ q, limite: 200 }), prestadoresPorTenant()])
    const admins = deps.adminEmails()
    const prestadores = new Set(perfiles.map((item) => item.tenantId))
    const items = cuentas.map((cuenta) => {
      const roles = [
        ...(admins.includes(cuenta.email.toLowerCase()) ? ['admin'] : []),
        ...(prestadores.has(cuenta.tenantId) ? ['prestador'] : []),
        'cliente',
      ]
      return {
        id: cuenta.id, nombre: cuenta.nombre, email: cuenta.email, estado: cuenta.estado, verificado: cuenta.verificado,
        // A managed provider (loaded by an admin) has no password: nobody signs in with it.
        administrada: !cuenta.conContrasena && !cuenta.verificado, roles, creadaEn: cuenta.creadaEn,
      }
    })
    const filtrados = rol === 'admin' || rol === 'prestador' ? items.filter((item) => item.roles.includes(rol))
      : rol === 'cliente' ? items.filter((item) => item.roles.length === 1) : items
    response.status(200).json({ items: filtrados })
  }))

  router.get('/tus/v1/admin/prestadores', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    response.status(200).json({ items: await prestadoresPorTenant() })
  }))

  router.post('/tus/v1/admin/prestadores/:id/visibilidad', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    const body = typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {}
    if (typeof body['visible'] !== 'boolean') {
      response.status(422).json({ error: { code: 'INVALID_VISIBILITY', message: 'visible must be a boolean' } })
      return
    }
    const result = await deps.directorio.cambiarVisibilidadAdmin(request.params['id'] ?? '', body['visible'])
    if (!result) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'profile not found' } })
      return
    }
    response.status(200).json({ id: result.id, visible: result.visible })
  }))

  router.get('/tus/v1/admin/solicitudes', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    response.status(200).json({ items: await deps.solicitudes.listarParaAdmin(100) })
  }))

  router.get('/tus/v1/admin/catalogo', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    const perfiles = await prestadoresPorTenant()
    response.status(200).json({
      oficios: OFICIOS.map((item) => ({
        id: item.id, label: item.label, profesion: item.profesion, palabrasClave: item.palabrasClave.split(' ').filter(Boolean),
        prestadores: perfiles.filter((perfil) => perfil.oficio === item.id).length,
        enMapa: perfiles.filter((perfil) => perfil.oficio === item.id && perfil.enMapa).length,
      })),
      zonas: ZONAS_CORRIENTES.map((zona) => ({
        nombre: zona.nombre,
        prestadores: perfiles.filter((perfil) => perfil.zona === zona.nombre || perfil.zonasCobertura.includes(zona.nombre)).length,
      })),
    })
  }))

  router.get('/tus/v1/admin/actividad', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    response.status(200).json({ items: deps.actividad ? await deps.actividad.recientes(30).catch(() => []) : [] })
  }))

  return router
}
