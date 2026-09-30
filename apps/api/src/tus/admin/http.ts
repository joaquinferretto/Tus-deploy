import express, { type Request, type Response, type Router } from 'express'

import { enmascararTelefono } from '@factory/contracts'

import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import type { ServicioDirectorio } from '../directorio/servicio.ts'
import type { ServicioSolicitudes } from '../solicitudes/servicio.ts'
import type { ServicioCatalogo } from '../catalogo/servicio.ts'
import type { EntidadListable } from '../catalogo/almacen.ts'
import { ConteosCatalogoEnMemoria, type ConteosCatalogo } from './conteos.ts'
import { paginaJson, paginacion } from './paginacion.ts'

// Read-mostly views of the platform administration panel. Every route resolves the session
// through the MFA gate (MfaAdminSessionResolver): the platform permissions only exist for an
// allowlisted, verified, email + password session that passed the second factor.
//
// - GET  /tus/v1/admin/resumen                       real counts for the dashboard
// - GET  /tus/v1/admin/usuarios?q=&rol=&estado=      registered accounts (no secrets)
// - GET  /tus/v1/admin/prestadores?q=&oficio=&zona=&visibilidad=&verificacion=
//                                                    profiles + why each is (not) on the map
// - GET  /tus/v1/admin/usuarios/:id                  one account (business fields, roles, provider link)
// - PATCH /tus/v1/admin/usuarios/:id                 name, email (resets verification), status, email verification
// - POST /tus/v1/admin/usuarios/:id/acciones         revoke_sessions | password_reset (safe actions)
// - GET  /tus/v1/admin/prestadores/:id               every editable field of a provider + account + location
// - PUT  /tus/v1/admin/prestadores/:id               profile, services, coverage, approval
// - POST /tus/v1/admin/prestadores/:id/visibilidad   publish / hide a profile
// - GET  /tus/v1/admin/solicitudes?q=&estado=&categoria=   service requests
// - GET  /tus/v1/admin/catalogo                      whole catalog (selectors, map context) + usage
// - GET  /tus/v1/admin/catalogo/:entidad?q=&estado=&categoria=&localidad=&zona=
//                                                    one page of an entity + usage counts
// - POST /tus/v1/admin/catalogo/:entidad             create (categorias|oficios|localidades|zonas|barrios)
// - PUT  /tus/v1/admin/catalogo/:entidad/:id         modify / activate / deactivate (never delete)
// - GET  /tus/v1/admin/actividad?tipo=               security/audit events
//
// Every list is paginated in the store (LIMIT/OFFSET): page from 1, pageSize 10, 25 (default) or
// 50; anything larger is capped at 50, anything else falls back to 25.

export interface CuentaAdmin {
  id: string
  tenantId: string
  nombre: string
  email: string
  estado: string
  verificado: boolean
  conContrasena: boolean
  creadaEn: string
  // Identity phone (masked). Optional for older test doubles.
  telefono?: { verificado: boolean; numero: string | null; verificadoEn: string | null; pendiente: string | null }
}

export interface FuenteCuentasAdmin {
  // Owner account of a tenant (provider detail -> account). Optional for older doubles.
  porTenant?(tenantId: string): Promise<CuentaAdmin | null>
  listar(input: { q: string; pagina: number; tamano: number; estado: string; rol: string; adminEmails: readonly string[]; prestadorTenants: readonly string[]; telefono?: string }): Promise<{ items: CuentaAdmin[]; total: number }>
  contar(): Promise<number>
}

export interface EventoActividad {
  tipo: string
  resultado: string
  fecha: string
}

export interface FuenteActividadAdmin {
  recientes(limite: number): Promise<EventoActividad[]>
  // tipo: 'seguridad' (auth/MFA/sessions), 'catalogo' (catalog ABM), 'usuarios' (admin account changes) or '' (all).
  pagina(input: { pagina: number; tamano: number; tipo: string }): Promise<{ items: EventoActividad[]; total: number }>
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
  catalogo?: ServicioCatalogo
  // Aggregated usage counts (GROUP BY); in-memory compositions compute them from the services.
  conteos?: ConteosCatalogo
  // Admin creation (AuthService.createAccountAsAdmin): an existing email is an explicit CONFLICT,
  // unlike public sign-up, which never reveals it.
  crearUsuario?: (input: { actorId: string; email: string; password: string; displayName: string }) => Promise<{ ok: boolean; code?: string }>
  actualizarUsuario?: (input: { actorId: string; accountId: string; displayName?: unknown; status?: unknown; reason?: unknown; email?: unknown; emailVerified?: unknown }) => Promise<{ ok: boolean; code?: string }>
  // AuthService.getAccountAsAdmin: business fields only (never hashes, tokens or MFA secrets).
  leerUsuario?: (accountId: string) => Promise<{ id: string; email: string; displayName: string; tenantId: string; status: string; emailVerifiedAt: number | null; hasPassword: boolean; createdAt: number; updatedAt: number; platformAdmin: boolean; phoneNumber?: string | null; phoneVerifiedAt?: number | null; phonePending?: string | null } | null>
  // Phone identity administration (auth-security/phone): sets a PENDING number or frees a verified
  // one. There is no way to mark a phone as verified from the panel.
  telefonoAdmin?: {
    fijarPendientePorAdmin(adminId: string, accountId: string, telefono: unknown): Promise<{ ok: boolean; code?: string; motivo?: string }>
    quitarVerificadoPorAdmin(adminId: string, accountId: string): Promise<{ ok: boolean; code?: string }>
  }
  accionUsuario?: (input: { actorId: string; accountId: string; action: unknown }) => Promise<{ ok: boolean; code?: string }>
  // Provider edition (directorio/admin.ts crearEdicionPrestadorAdmin).
  prestadorAdmin?: {
    leer(id: string): Promise<{ perfil: Record<string, unknown>; tenantId: string; prestador: { estado: string; aprobado: boolean } | null } | null>
    guardar(admin: TusAuthenticatedTenantContext, id: string, body: Record<string, unknown>): Promise<{ status: number; code?: string; fields?: string[] } & Record<string, unknown>>
  }
  now?: () => number
}

const ADMIN = 'tus:providers:admin'
const IDENTITY_ADMIN = 'tus:identity:admin'

const filtroTexto = (value: unknown, max = 80) => String(value ?? '').trim().slice(0, max)


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

  const prestadoresPorTenant = async () => deps.directorio.listarParaAdmin()
  const conteos = (): ConteosCatalogo => deps.conteos ?? new ConteosCatalogoEnMemoria({ directorio: deps.directorio, solicitudes: deps.solicitudes, ...(deps.catalogo ? { catalogo: deps.catalogo } : {}) })

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
    const estado = ['active', 'suspended'].includes(String(request.query['estado'] ?? '')) ? String(request.query['estado']) : ''
    const telefono = ['verificado', 'pendiente', 'sin'].includes(String(request.query['telefono'] ?? '')) ? String(request.query['telefono']) : ''
    const { pagina, tamano } = paginacion(request.query)
    const admins = deps.adminEmails()
    const prestadorTenants = await deps.directorio.tenantsConPerfil()
    const resultado = await deps.cuentas.listar({ q, pagina, tamano, estado, rol, adminEmails: admins, prestadorTenants, telefono })
    const prestadores = new Set(prestadorTenants)
    const items = resultado.items.map((cuenta) => {
      const roles = [
        ...(admins.includes(cuenta.email.toLowerCase()) ? ['admin'] : []),
        ...(prestadores.has(cuenta.tenantId) ? ['prestador'] : []),
        'cliente',
      ]
      return {
        id: cuenta.id, nombre: cuenta.nombre, email: cuenta.email, estado: cuenta.estado, verificado: cuenta.verificado,
        // A managed provider (loaded by an admin) has no password: nobody signs in with it.
        administrada: !cuenta.conContrasena && !cuenta.verificado, roles, creadaEn: cuenta.creadaEn,
        telefono: cuenta.telefono ?? { verificado: false, numero: null, verificadoEn: null, pendiente: null },
      }
    })
    response.status(200).json(paginaJson(items, pagina, tamano, resultado.total))
  }))

  router.post('/tus/v1/admin/usuarios', asyncHandler(async (request, response) => {
    const context = await guard(request, response, IDENTITY_ADMIN)
    if (!context) return
    if (!deps.crearUsuario) return void response.status(503).json({ error: { code: 'UNAVAILABLE', message: 'user creation unavailable' } })
    const body = typeof request.body === 'object' && request.body !== null ? request.body as Record<string, unknown> : {}
    if (body['role'] !== undefined && body['role'] !== 'cliente') return void response.status(422).json({ error: { code: 'INVALID_ROLE', message: 'provider and admin authority cannot be created from this form' } })
    const result = await deps.crearUsuario({ actorId: context.subjectId, email: String(body['email'] ?? ''), password: String(body['password'] ?? ''), displayName: String(body['displayName'] ?? '') })
    if (result.ok) return void response.status(201).json({ created: true })
    if (result.code === 'CONFLICT') return void response.status(409).json({ error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'an account with this email already exists' } })
    response.status(422).json({ error: { code: result.code === 'PASSWORD_BREACHED' ? 'PASSWORD_BREACHED' : 'INVALID_USER', message: 'user creation rejected' } })
  }))

  const cuerpo = (request: Request) => (typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {})

  router.get('/tus/v1/admin/usuarios/:id', asyncHandler(async (request, response) => {
    if (!(await guard(request, response, IDENTITY_ADMIN))) return
    if (!deps.leerUsuario) return void response.status(503).json({ error: { code: 'UNAVAILABLE', message: 'user detail unavailable' } })
    const cuenta = await deps.leerUsuario(String(request.params['id'] ?? ''))
    if (!cuenta) return void response.status(404).json({ error: { code: 'NOT_FOUND', message: 'account not found' } })
    const prestador = await deps.directorio.perfilDeTenantAdmin(cuenta.tenantId)
    response.status(200).json({
      id: cuenta.id,
      nombre: cuenta.displayName,
      email: cuenta.email,
      estado: cuenta.status,
      verificado: cuenta.emailVerifiedAt !== null,
      verificadoEn: cuenta.emailVerifiedAt === null ? null : new Date(cuenta.emailVerifiedAt).toISOString(),
      conContrasena: cuenta.hasPassword,
      creadaEn: new Date(cuenta.createdAt).toISOString(),
      actualizadaEn: new Date(cuenta.updatedAt).toISOString(),
      // Admin authority is the environment allowlist (not editable here); cliente is everyone.
      roles: [...(cuenta.platformAdmin ? ['admin'] : []), ...(prestador ? ['prestador'] : []), 'cliente'],
      administradorPlataforma: cuenta.platformAdmin,
      prestador,
      telefono: {
        verificado: Boolean(cuenta.phoneNumber),
        numero: cuenta.phoneNumber ? enmascararTelefono(cuenta.phoneNumber) : null,
        verificadoEn: cuenta.phoneVerifiedAt ? new Date(cuenta.phoneVerifiedAt).toISOString() : null,
        pendiente: cuenta.phonePending ? enmascararTelefono(cuenta.phonePending) : null,
      },
    })
  }))

  // Phone identity: { accion: 'pendiente', telefono } leaves the number PENDING (the person
  // verifies it from WhatsApp); { accion: 'quitar' } frees the verified number. Audited.
  router.post('/tus/v1/admin/usuarios/:id/telefono', asyncHandler(async (request, response) => {
    const context = await guard(request, response, IDENTITY_ADMIN)
    if (!context) return
    if (!deps.telefonoAdmin) return void response.status(503).json({ error: { code: 'UNAVAILABLE', message: 'phone administration unavailable' } })
    const body = cuerpo(request)
    const accountId = String(request.params['id'] ?? '')
    const resultado = body['accion'] === 'pendiente'
      ? await deps.telefonoAdmin.fijarPendientePorAdmin(context.subjectId, accountId, body['telefono'])
      : body['accion'] === 'quitar'
        ? await deps.telefonoAdmin.quitarVerificadoPorAdmin(context.subjectId, accountId)
        : { ok: false, code: 'INVALID_ACTION' }
    if (!resultado.ok) return void response.status(resultado.code === 'NOT_FOUND' ? 404 : 422).json({ error: { code: resultado.code ?? 'INVALID_ACTION', ...('motivo' in resultado && resultado.motivo ? { reason: resultado.motivo } : {}), message: 'phone change rejected' } })
    response.status(200).json({ done: true })
  }))

  router.patch('/tus/v1/admin/usuarios/:id', asyncHandler(async (request, response) => {
    const context = await guard(request, response, IDENTITY_ADMIN)
    if (!context) return
    if (!deps.actualizarUsuario) return void response.status(503).json({ error: { code: 'UNAVAILABLE', message: 'user update unavailable' } })
    const body = cuerpo(request)
    // Authority, secrets and internal ids are never written from here.
    const permitidos = new Set(['displayName', 'status', 'reason', 'email', 'emailVerified'])
    if (Object.keys(body).some((key) => !permitidos.has(key))) return void response.status(422).json({ error: { code: 'INVALID_CHANGE', message: 'authority, secrets and internal fields require dedicated operations' } })
    const result = await deps.actualizarUsuario({ actorId: context.subjectId, accountId: String(request.params['id'] ?? ''), displayName: body['displayName'], status: body['status'], reason: body['reason'], email: body['email'], emailVerified: body['emailVerified'] })
    if (!result.ok) {
      const status = result.code === 'FORBIDDEN' ? 403 : result.code === 'CONFLICT' ? 409 : 422
      return void response.status(status).json({ error: { code: result.code === 'CONFLICT' ? 'EMAIL_ALREADY_REGISTERED' : result.code ?? 'INVALID_USER', message: 'user update rejected' } })
    }
    response.status(200).json({ updated: true })
  }))

  router.post('/tus/v1/admin/usuarios/:id/acciones', asyncHandler(async (request, response) => {
    const context = await guard(request, response, IDENTITY_ADMIN)
    if (!context) return
    if (!deps.accionUsuario) return void response.status(503).json({ error: { code: 'UNAVAILABLE', message: 'account actions unavailable' } })
    const result = await deps.accionUsuario({ actorId: context.subjectId, accountId: String(request.params['id'] ?? ''), action: cuerpo(request)['action'] })
    if (!result.ok) return void response.status(result.code === 'FORBIDDEN' ? 403 : 422).json({ error: { code: result.code ?? 'INVALID_ACTION', message: 'account action rejected' } })
    response.status(200).json({ done: true })
  }))

  const detallePrestador = async (id: string) => {
    const leido = await deps.prestadorAdmin?.leer(id)
    if (!leido) return null
    const [cuenta, ubicacion] = await Promise.all([
      deps.cuentas.porTenant ? deps.cuentas.porTenant(leido.tenantId) : Promise.resolve(null),
      deps.directorio.ubicacionDePerfil(id),
    ])
    return {
      perfil: leido.perfil,
      prestador: leido.prestador,
      cuenta: cuenta ? { id: cuenta.id, nombre: cuenta.nombre, email: cuenta.email, estado: cuenta.estado, verificado: cuenta.verificado, telefonoVerificado: cuenta.telefono?.verificado ?? false, telefono: cuenta.telefono?.numero ?? null } : null,
      ubicacion,
    }
  }

  router.get('/tus/v1/admin/prestadores/:id', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    if (!deps.prestadorAdmin) return void response.status(503).json({ error: { code: 'UNAVAILABLE', message: 'provider edition unavailable' } })
    const detalle = await detallePrestador(String(request.params['id'] ?? ''))
    if (!detalle) return void response.status(404).json({ error: { code: 'NOT_FOUND', message: 'profile not found' } })
    response.status(200).json(detalle)
  }))

  router.put('/tus/v1/admin/prestadores/:id', asyncHandler(async (request, response) => {
    const context = await guard(request, response)
    if (!context) return
    if (!deps.prestadorAdmin) return void response.status(503).json({ error: { code: 'UNAVAILABLE', message: 'provider edition unavailable' } })
    const id = String(request.params['id'] ?? '')
    const result = await deps.prestadorAdmin.guardar(context, id, cuerpo(request))
    if (result.status !== 200) return void response.status(result.status).json({ error: { code: result.code ?? 'INVALID_PROFILE', message: 'provider update rejected', ...(result.fields ? { fields: result.fields } : {}) } })
    response.status(200).json(await detallePrestador(id))
  }))

  router.get('/tus/v1/admin/prestadores', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    const { pagina, tamano } = paginacion(request.query)
    const visibilidad = String(request.query['visibilidad'] ?? '')
    const verificacion = String(request.query['verificacion'] ?? '')
    const resultado = await deps.directorio.paginaParaAdmin({
      pagina,
      tamano,
      q: String(request.query['q'] ?? '').trim().slice(0, 120),
      oficio: String(request.query['oficio'] ?? '').trim().slice(0, 80),
      zona: String(request.query['zona'] ?? '').trim().slice(0, 80),
      visible: visibilidad === 'visible' ? true : visibilidad === 'oculto' ? false : null,
      verificado: verificacion === 'verificado' ? true : verificacion === 'pendiente' ? false : null,
    })
    response.status(200).json(paginaJson(resultado.items, pagina, tamano, resultado.total))
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
    const { pagina, tamano } = paginacion(request.query)
    const resultado = await deps.solicitudes.paginaParaAdmin({
      pagina,
      tamano,
      q: String(request.query['q'] ?? '').trim().slice(0, 120),
      estado: ['publicada', 'asignada', 'vencida', 'cerrada'].includes(String(request.query['estado'] ?? '')) ? String(request.query['estado']) : '',
      categoria: String(request.query['categoria'] ?? '').trim().slice(0, 80),
    })
    response.status(200).json(paginaJson(resultado.items, pagina, tamano, resultado.total))
  }))

  router.get('/tus/v1/admin/catalogo', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    if (!deps.catalogo) {
      response.status(503).json({ error: { code: 'UNAVAILABLE', message: 'catalog unavailable' } })
      return
    }
    const catalogo = await deps.catalogo.leer()
    response.status(200).json({
      categorias: await conUso('categorias', catalogo.categorias),
      oficios: await conUso('oficios', catalogo.oficios),
      localidades: catalogo.localidades,
      zonas: await conUso('zonas', catalogo.zonas),
      barrios: await conUso('barrios', catalogo.barrios),
    })
  }))

  // Usage counts for a set of rows: a fixed number of aggregate queries for the whole set.
  async function conUso<T extends { id: string; nombre: string }>(entidad: EntidadListable, items: T[]) {
    const fuente = conteos()
    if (entidad === 'categorias') {
      const porCategoria = await fuente.oficiosPorCategoria(items.map((item) => item.id))
      return items.map((item) => ({ ...item, oficios: porCategoria.get(item.id) ?? 0 }))
    }
    if (entidad === 'oficios') {
      const porOficio = await fuente.porOficio(items.map((item) => item.id))
      return items.map((item) => ({ ...item, ...(porOficio.get(item.id) ?? { prestadores: 0, enMapa: 0 }) }))
    }
    if (entidad === 'zonas') {
      const porZona = await fuente.porZona(items.map((item) => item.id))
      return items.map((item) => ({ ...item, ...(porZona.get(item.id) ?? { prestadores: 0, barrios: 0 }) }))
    }
    if (entidad === 'barrios') {
      const porBarrio = await fuente.porBarrio([...new Set(items.map((item) => item.nombre))])
      return items.map((item) => ({ ...item, ...(porBarrio.get(item.nombre) ?? { prestadores: 0, solicitudes: 0 }) }))
    }
    return items
  }

  router.get('/tus/v1/admin/catalogo/:entidad', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    const entidad = String(request.params['entidad'])
    if (!deps.catalogo || !esEntidad(entidad)) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'unknown catalog entity' } })
      return
    }
    const { pagina, tamano } = paginacion(request.query)
    const estado = String(request.query['estado'] ?? '')
    const resultado = await deps.catalogo.pagina(entidad, {
      pagina,
      tamano,
      q: filtroTexto(request.query['q'], 120),
      activo: estado === 'activo' ? true : estado === 'inactivo' ? false : null,
      categoriaId: filtroTexto(request.query['categoria']),
      localidadId: filtroTexto(request.query['localidad']),
      zonaId: filtroTexto(request.query['zona']),
    })
    response.status(200).json(paginaJson(await conUso(entidad, resultado.items), pagina, tamano, resultado.total))
  }))

  const esEntidad = (value: string): value is EntidadListable => value in ENTIDADES
  const ENTIDADES = {
    categorias: 'guardarCategoria',
    oficios: 'guardarOficio',
    localidades: 'guardarLocalidad',
    zonas: 'guardarZona',
    barrios: 'guardarBarrio',
  } as const

  const guardarEntidad = async (request: Request, response: Response, id: string | null) => {
    const context = await guard(request, response)
    if (!context) return
    const metodo = ENTIDADES[String(request.params['entidad']) as keyof typeof ENTIDADES]
    if (!metodo || !deps.catalogo) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'unknown catalog entity' } })
      return
    }
    const body = typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {}
    const result = await deps.catalogo[metodo](context.subjectId, id, body)
    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'DUPLICATE' || result.code === 'IN_USE_RENAME' ? 409 : 422
      response.status(status).json({ error: { code: result.code, message: 'catalog change rejected', campos: result.campos ?? [] } })
      return
    }
    response.status(id ? 200 : 201).json({ item: result.valor })
  }

  router.post('/tus/v1/admin/catalogo/:entidad', asyncHandler(async (request, response) => guardarEntidad(request, response, null)))
  router.put('/tus/v1/admin/catalogo/:entidad/:id', asyncHandler(async (request, response) => guardarEntidad(request, response, String(request.params['id'] ?? ''))))

  router.get('/tus/v1/admin/actividad', asyncHandler(async (request, response) => {
    if (!(await guard(request, response))) return
    const { pagina, tamano } = paginacion(request.query)
    const tipo = ['seguridad', 'catalogo', 'usuarios'].includes(String(request.query['tipo'] ?? '')) ? String(request.query['tipo']) : ''
    const resultado = deps.actividad ? await deps.actividad.pagina({ pagina, tamano, tipo }) : { items: [], total: 0 }
    response.status(200).json(paginaJson(resultado.items, pagina, tamano, resultado.total))
  }))

  return router
}
