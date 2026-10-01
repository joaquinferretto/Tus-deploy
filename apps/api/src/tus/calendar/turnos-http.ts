import express, { type Request, type Response, type Router } from 'express'
import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { ServicioTurnos } from './turnos-service.ts'
import { ErrorCalendario } from './bookings.ts'
import type { ClienteTurnoAdmin } from '@factory/contracts'

export function crearRouterTurnos({
  servicio,
  sessions,
}: {
  servicio: ServicioTurnos
  sessions: TusSessionResolverPort
}): Router {
  const router = express.Router()

  // -----------------------------------------------------------------------------------------------
  // 1. PUBLIC ENDPOINTS (Buscar trabajador -> Reservar turno)
  // -----------------------------------------------------------------------------------------------

  router.get(
    '/tus/v1/public/prestadores/:id/turnos/disponibilidad',
    asyncHandler(async (request: Request, response: Response) => {
      const prestadorId = String(request.params['id'] ?? '')
      const oficioId = String(request.query['oficioId'] ?? '')
      const fecha = String(request.query['fecha'] ?? '')
      const duracion = request.query['duracion'] ? Number(request.query['duracion']) : undefined

      if (!oficioId || !fecha) {
        enviarError(response, 400, 'INVALID_PARAMS', 'oficioId y fecha (YYYY-MM-DD) son requeridos')
        return
      }

      try {
        const resultado = await servicio.disponibilidadPublica({
          prestadorId,
          oficioId,
          fecha,
          duracionMinutos: duracion,
        })
        // Availability changes with every booking and the response carries per-request headers
        // (CORS, X-Correlation-Id, rate limit): never storable by a shared cache.
        response.setHeader('cache-control', 'private, no-store')
        response.status(200).json(resultado)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.post(
    '/tus/v1/public/prestadores/:id/turnos/reservar',
    asyncHandler(async (request: Request, response: Response) => {
      const prestadorId = String(request.params['id'] ?? '')
      const body = comoRegistro(request.body)
      const oficioId = String(body['oficioId'] ?? '')
      const inicio = String(body['inicio'] ?? '')

      if (!oficioId || !inicio) {
        enviarError(response, 400, 'INVALID_PARAMS', 'oficioId e inicio son requeridos')
        return
      }

      // Soporta tanto cliente con sesión como invitado
      const context = await intentarAutenticar(request, sessions)
      const clienteNombre = String(body['clienteNombre'] ?? body['nombre'] ?? '').trim()
      const clienteTelefono = String(body['clienteTelefono'] ?? body['telefono'] ?? '').trim()
      const clienteEmail = String(body['clienteEmail'] ?? body['email'] ?? '').trim()

      if (!context && !clienteNombre) {
        enviarError(
          response,
          400,
          'CLIENTE_REQUERIDO',
          'Para reservar como invitado se requiere nombre de contacto'
        )
        return
      }

      try {
        const turno = await servicio.reservarTurno({
          prestadorId,
          oficioId,
          tarifaId: body['tarifaId'] ? String(body['tarifaId']) : undefined,
          inicio,
          clienteId: context?.subjectId,
          clienteTenantId: context?.tenantId,
          clienteNombre: clienteNombre || undefined,
          clienteTelefono: clienteTelefono || undefined,
          clienteEmail: clienteEmail || undefined,
          notas: body['notas'] ? String(body['notas']) : undefined,
        })

        response.setHeader('cache-control', 'private, no-store')
        response.status(201).json(turno)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // -----------------------------------------------------------------------------------------------
  // 2. PRESTADOR ENDPOINTS (Gestión de sus turnos y agenda)
  // -----------------------------------------------------------------------------------------------

  router.get(
    '/tus/v1/prestador/turnos',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return

      try {
        const turnos = await servicio.turnosPrestador({
          prestadorTenantId: context.tenantId,
          desde: request.query['desde'] ? String(request.query['desde']) : undefined,
          hasta: request.query['hasta'] ? String(request.query['hasta']) : undefined,
          estado: request.query['estado'] ? String(request.query['estado']) : undefined,
        })
        response.status(200).json({ items: turnos })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.post(
    '/tus/v1/prestador/turnos/manual',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return

      const body = comoRegistro(request.body)
      const oficioId = String(body['oficioId'] ?? '')
      const inicio = String(body['inicio'] ?? '')
      const clienteNombre = String(body['clienteNombre'] ?? '').trim()

      if (!oficioId || !inicio || !clienteNombre) {
        enviarError(
          response,
          400,
          'INVALID_PARAMS',
          'oficioId, inicio y clienteNombre son obligatorios'
        )
        return
      }

      try {
        const turno = await servicio.crearTurnoManual({
          prestadorTenantId: context.tenantId,
          oficioId,
          tarifaId: body['tarifaId'] ? String(body['tarifaId']) : undefined,
          inicio,
          fin: body['fin'] ? String(body['fin']) : undefined,
          duracionMinutos: body['duracionMinutos'] ? Number(body['duracionMinutos']) : undefined,
          precioFinal: body['precioFinal'] != null ? BigInt(body['precioFinal'] as number | string) : undefined,
          clienteNombre,
          clienteTelefono: body['clienteTelefono'] ? String(body['clienteTelefono']) : undefined,
          clienteEmail: body['clienteEmail'] ? String(body['clienteEmail']) : undefined,
          notas: body['notas'] ? String(body['notas']) : undefined,
        })
        response.status(201).json(turno)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.post(
    '/tus/v1/prestador/turnos/bloquear',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return

      const body = comoRegistro(request.body)
      const inicio = String(body['inicio'] ?? '')
      const fin = String(body['fin'] ?? '')
      const motivo = String(body['motivo'] ?? 'Bloqueo manual')

      if (!inicio || !fin) {
        enviarError(response, 400, 'INVALID_PARAMS', 'inicio y fin son obligatorios')
        return
      }

      try {
        const res = await servicio.bloquearHorario({
          prestadorTenantId: context.tenantId,
          inicio,
          fin,
          motivo,
        })
        response.status(201).json(res)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.patch(
    '/tus/v1/prestador/turnos/:id/estado',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return

      const reservaId = String(request.params['id'] ?? '')
      const body = comoRegistro(request.body)
      const nuevoEstado = String(body['estado'] ?? '')
      const motivo = body['motivo'] ? String(body['motivo']) : undefined

      if (!['confirmed', 'cancelled', 'completed', 'no-show'].includes(nuevoEstado)) {
        enviarError(response, 400, 'INVALID_STATUS', 'Estado no reconocido')
        return
      }

      try {
        const turno = await servicio.cambiarEstadoTurno({
          reservaId,
          tenantId: context.tenantId,
          nuevoEstado,
          motivo,
        })
        response.status(200).json(turno)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Own services that can take turnos (for the selects of the provider screens).
  router.get(
    '/tus/v1/prestador/turnos/servicios',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        response.status(200).json({ items: await servicio.serviciosDePrestador({ tenantId: context.tenantId }) })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Weekly hours of the own agenda: what the availability is computed from.
  router.get(
    '/tus/v1/prestador/turnos/horarios',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        response.status(200).json({ items: await servicio.horariosPrestador(context.tenantId) })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.put(
    '/tus/v1/prestador/turnos/horarios',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        response.status(200).json({ items: await servicio.guardarHorariosPrestador(context.tenantId, comoRegistro(request.body)['horarios']) })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Real availability of the own agenda for a service and a day (the same the clients see).
  router.get(
    '/tus/v1/prestador/turnos/disponibilidad',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const perfil = await servicio.perfilDeTenant(context.tenantId)
      if (!perfil) return void enviarError(response, 404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
      const oficioId = String(request.query['oficioId'] ?? '')
      const fecha = String(request.query['fecha'] ?? '')
      if (!oficioId || !fecha) return void enviarError(response, 400, 'INVALID_PARAMS', 'oficioId y fecha (YYYY-MM-DD) son requeridos')
      try {
        response.status(200).json(await servicio.disponibilidadPublica({ prestadorId: perfil.id, oficioId, fecha, incluirNoVisible: true }))
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.put(
    '/tus/v1/prestador/servicios/:oficioId/turnos-config',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return

      const oficioId = String(request.params['oficioId'] ?? '')
      const body = comoRegistro(request.body)
      // The profile is the one of the session's tenant (a profile id in the body is ignored).
      const perfil = await servicio.perfilDeTenant(context.tenantId)
      if (!perfil) return void enviarError(response, 404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
      const perfilId = perfil.id

      try {
        const updated = await servicio.actualizarServicioPrestador({
          perfilId,
          oficioId,
          turnosHabilitados: body['turnosHabilitados'] !== undefined ? Boolean(body['turnosHabilitados']) : undefined,
          solicitudesHabilitadas: body['solicitudesHabilitadas'] !== undefined ? Boolean(body['solicitudesHabilitadas']) : undefined,
          precioBase: body['precioBase'] != null ? BigInt(body['precioBase'] as number | string) : undefined,
          duracionMinutos: body['duracionMinutos'] != null ? Number(body['duracionMinutos']) : undefined,
          bufferMinutos: body['bufferMinutos'] != null ? Number(body['bufferMinutos']) : undefined,
          modalidad: body['modalidad'] ? String(body['modalidad']) : undefined,
        })
        // precio_base is a bigint: JSON cannot carry it as such.
        response.status(200).json({ ok: true, config: { ...updated, precioBase: updated.precioBase === null ? null : Number(updated.precioBase) } })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.put(
    '/tus/v1/prestador/servicios/:oficioId/tarifas',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return

      const oficioId = String(request.params['oficioId'] ?? '')
      const body = comoRegistro(request.body)
      const perfil = await servicio.perfilDeTenant(context.tenantId)
      if (!perfil) return void enviarError(response, 404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
      const perfilId = perfil.id
      const tarifasRaw = Array.isArray(body['tarifas']) ? body['tarifas'] : []

      const tarifas = tarifasRaw.map((t: Record<string, unknown>, idx: number) => ({
        id: t['id'] ? String(t['id']) : undefined,
        nombre: String(t['nombre'] ?? 'Tarifa'),
        duracionMinutos: Number(t['duracionMinutos'] ?? 60),
        precio: BigInt(t['precio'] as number | string),
        orden: t['orden'] != null ? Number(t['orden']) : idx,
      }))

      try {
        const guardadas = await servicio.guardarTarifasPrestador({
          tenantId: context.tenantId,
          perfilId,
          oficioId,
          tarifas,
        })
        response.status(200).json({ ok: true, tarifas: guardadas })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // -----------------------------------------------------------------------------------------------
  // 3. ADMIN ENDPOINTS (Supervisión, auditoría y control de turnos)
  // -----------------------------------------------------------------------------------------------

  const adminAuth = async (request: Request, response: Response) => {
    const context = await autenticar(request, response, sessions)
    if (!context) return null
    // Platform administration only (MFA-elevated allowlisted session). No tenant role grants it.
    if (!context.permissions.includes('tus:providers:admin')) {
      enviarError(response, 403, 'FORBIDDEN', 'Requiere permisos de administración de TUS')
      return null
    }
    return context
  }

  router.get(
    '/tus/v1/admin/turnos',
    asyncHandler(async (request: Request, response: Response) => {
      if (!(await adminAuth(request, response))) return

      try {
        const resultado = await servicio.adminListarTurnos({
          prestadorId: request.query['prestadorId'] ? String(request.query['prestadorId']) : undefined,
          desde: request.query['desde'] ? String(request.query['desde']) : undefined,
          hasta: request.query['hasta'] ? String(request.query['hasta']) : undefined,
          estado: request.query['estado'] ? String(request.query['estado']) : undefined,
          pagina: request.query['pagina'] ? Number(request.query['pagina']) : 1,
          tamano: request.query['tamano'] ? Number(request.query['tamano']) : 20,
        })
        response.status(200).json(resultado)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Combobox searches of the turno form: people are found by name, never typed as ids.
  router.get(
    '/tus/v1/admin/turnos/prestadores',
    asyncHandler(async (request: Request, response: Response) => {
      if (!(await adminAuth(request, response))) return
      try {
        response.status(200).json({ items: await servicio.adminBuscarPrestadores(String(request.query['q'] ?? '')) })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Only the services that provider really offers.
  router.get(
    '/tus/v1/admin/turnos/prestadores/:id/servicios',
    asyncHandler(async (request: Request, response: Response) => {
      if (!(await adminAuth(request, response))) return
      try {
        response.status(200).json({ items: await servicio.serviciosDePrestador({ perfilId: String(request.params['id'] ?? '') }) })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.get(
    '/tus/v1/admin/turnos/clientes',
    asyncHandler(async (request: Request, response: Response) => {
      if (!(await adminAuth(request, response))) return
      try {
        response.status(200).json({ items: await servicio.adminBuscarClientes(String(request.query['q'] ?? '')) })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Real availability of a provider (also when its profile is hidden from the directory).
  router.get(
    '/tus/v1/admin/turnos/disponibilidad',
    asyncHandler(async (request: Request, response: Response) => {
      if (!(await adminAuth(request, response))) return
      const prestadorId = String(request.query['prestadorId'] ?? '')
      const oficioId = String(request.query['oficioId'] ?? '')
      const fecha = String(request.query['fecha'] ?? '')
      if (!prestadorId || !oficioId || !fecha) return void enviarError(response, 400, 'INVALID_PARAMS', 'prestadorId, oficioId y fecha (YYYY-MM-DD) son requeridos')
      try {
        response.status(200).json(await servicio.disponibilidadPublica({ prestadorId, oficioId, fecha, incluirNoVisible: true }))
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // One form, two kinds of turno. general: a slot of the real availability. forzado: any future
  // time with a mandatory audited reason. Neither may overlap another reservation (409).
  router.post(
    '/tus/v1/admin/turnos',
    asyncHandler(async (request: Request, response: Response) => {
      const adminCtx = await adminAuth(request, response)
      if (!adminCtx) return
      const body = comoRegistro(request.body)
      const permitidos = ['tipo', 'prestadorId', 'oficioId', 'tarifaId', 'inicio', 'cliente', 'motivo', 'notas']
      const desconocidos = Object.keys(body).filter((key) => !permitidos.includes(key))
      if (desconocidos.length > 0) return void enviarError(response, 422, 'INVALID_PARAMS', `Campos desconocidos: ${desconocidos.join(', ')}`)
      const tipo = body['tipo']
      const prestadorId = String(body['prestadorId'] ?? '').trim()
      const oficioId = String(body['oficioId'] ?? '').trim()
      const inicio = String(body['inicio'] ?? '').trim()
      const cliente = clienteAdmin(body['cliente'])
      if ((tipo !== 'general' && tipo !== 'forzado') || !prestadorId || !oficioId || !inicio) return void enviarError(response, 400, 'INVALID_PARAMS', 'tipo, prestadorId, oficioId e inicio son obligatorios')
      if (!cliente) return void enviarError(response, 400, 'CLIENT_REQUIRED', 'Elegí un cliente registrado o cargá el nombre del invitado.')
      const notas = body['notas'] ? String(body['notas']).slice(0, 500) : undefined
      try {
        const turno =
          tipo === 'general'
            ? await servicio.adminReservarTurno({ prestadorId, oficioId, tarifaId: body['tarifaId'] ? String(body['tarifaId']) : undefined, inicio, cliente, adminId: adminCtx.subjectId, notas })
            : await servicio.adminForzarTurno({ prestadorId, oficioId, inicio, cliente, motivoForzado: String(body['motivo'] ?? ''), adminId: adminCtx.subjectId, correlationId: adminCtx.correlationId, notas })
        response.status(201).json(turno)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.patch(
    '/tus/v1/admin/turnos/:id/precio',
    asyncHandler(async (request: Request, response: Response) => {
      const adminCtx = await adminAuth(request, response)
      if (!adminCtx) return

      const reservaId = String(request.params['id'] ?? '')
      const body = comoRegistro(request.body)
      const nuevoPrecio = body['precioFinal'] != null ? BigInt(body['precioFinal'] as number | string) : undefined
      const motivo = String(body['motivo'] ?? '')

      if (nuevoPrecio === undefined) {
        enviarError(response, 400, 'INVALID_PARAMS', 'precioFinal es obligatorio')
        return
      }

      try {
        const turno = await servicio.adminModificarPrecio({
          reservaId,
          nuevoPrecio,
          motivo,
          adminId: adminCtx.subjectId,
        })
        response.status(200).json(turno)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.post(
    '/tus/v1/admin/turnos/forzar',
    asyncHandler(async (request: Request, response: Response) => {
      const adminCtx = await adminAuth(request, response)
      if (!adminCtx) return

      const body = comoRegistro(request.body)
      const prestadorId = String(body['prestadorId'] ?? '')
      const oficioId = String(body['oficioId'] ?? '')
      const inicio = String(body['inicio'] ?? '')
      const clienteNombre = String(body['clienteNombre'] ?? '').trim()
      const motivoForzado = String(body['motivoForzado'] ?? '').trim()

      if (!prestadorId || !oficioId || !inicio || !clienteNombre || !motivoForzado) {
        enviarError(
          response,
          400,
          'INVALID_PARAMS',
          'prestadorId, oficioId, inicio, clienteNombre y motivoForzado son obligatorios'
        )
        return
      }

      try {
        const turno = await servicio.adminForzarTurno({
          prestadorId,
          oficioId,
          inicio,
          fin: body['fin'] ? String(body['fin']) : undefined,
          duracionMinutos: body['duracionMinutos'] ? Number(body['duracionMinutos']) : undefined,
          precioFinal: body['precioFinal'] != null ? BigInt(body['precioFinal'] as number | string) : undefined,
          clienteNombre,
          clienteTelefono: body['clienteTelefono'] ? String(body['clienteTelefono']) : undefined,
          clienteEmail: body['clienteEmail'] ? String(body['clienteEmail']) : undefined,
          motivoForzado,
          adminId: adminCtx.subjectId,
          correlationId: adminCtx.correlationId,
          notas: body['notas'] ? String(body['notas']) : undefined,
        })
        response.status(201).json(turno)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.patch(
    '/tus/v1/admin/turnos/:id/estado',
    asyncHandler(async (request: Request, response: Response) => {
      if (!(await adminAuth(request, response))) return

      const reservaId = String(request.params['id'] ?? '')
      const body = comoRegistro(request.body)
      const nuevoEstado = String(body['estado'] ?? '')
      const motivo = body['motivo'] ? String(body['motivo']) : undefined

      try {
        const turno = await servicio.cambiarEstadoTurno({
          reservaId,
          isAdmin: true,
          nuevoEstado,
          motivo,
        })
        response.status(200).json(turno)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.put(
    '/tus/v1/admin/prestadores/:id/turnos-switches',
    asyncHandler(async (request: Request, response: Response) => {
      if (!(await adminAuth(request, response))) return

      const perfilId = String(request.params['id'] ?? '')
      const body = comoRegistro(request.body)

      try {
        const updated = await servicio.actualizarSwitchesPrestador({
          perfilId,
          aceptaTurnos: body['aceptaTurnos'] !== undefined ? Boolean(body['aceptaTurnos']) : undefined,
          aceptaSolicitudes: body['aceptaSolicitudes'] !== undefined ? Boolean(body['aceptaSolicitudes']) : undefined,
        })
        response.status(200).json({ ok: true, perfil: updated })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  return router
}

async function autenticar(
  request: Request,
  response: Response,
  sessions: TusSessionResolverPort
): Promise<TusAuthenticatedTenantContext | null> {
  const context = await intentarAutenticar(request, sessions)
  if (!context) {
    enviarError(response, 401, 'UNAUTHORIZED', 'Authentication required')
    return null
  }
  response.setHeader('cache-control', 'no-store')
  return context
}

async function intentarAutenticar(
  request: Request,
  sessions: TusSessionResolverPort
): Promise<TusAuthenticatedTenantContext | null> {
  const authorization = request.header('authorization') ?? ''
  const correlationId = request.header('x-correlation-id')?.trim() ?? ''
  const accessToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!accessToken || !correlationId) return null
  return await sessions.resolve(accessToken, correlationId)
}

function comoRegistro(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
    ? (value as Record<string, unknown>)
    : {}
}

function enviarError(response: Response, status: number, code: string, error: string): void {
  response.status(status).json({ code, error })
}

function manejarError(response: Response, error: unknown): void {
  if (error instanceof ErrorCalendario) {
    enviarError(response, error.status, error.code, error.message)
    return
  }
  // Unexpected failures never expose internal messages (queries, constraint names).
  enviarError(response, 500, 'INTERNAL_ERROR', 'Error inesperado en el servicio de turnos')
}

// Client of a turno created by the administration: a registered account or an explicit guest.
function clienteAdmin(value: unknown): ClienteTurnoAdmin | null {
  const cliente = comoRegistro(value)
  if (cliente['tipo'] === 'registrado' && typeof cliente['cuentaId'] === 'string' && /^[A-Za-z0-9._:-]{3,120}$/u.test(cliente['cuentaId'])) return { tipo: 'registrado', cuentaId: cliente['cuentaId'] }
  if (cliente['tipo'] === 'invitado' && typeof cliente['nombre'] === 'string' && cliente['nombre'].trim().length >= 2)
    return {
      tipo: 'invitado',
      nombre: cliente['nombre'].trim().slice(0, 120),
      ...(typeof cliente['telefono'] === 'string' && cliente['telefono'].trim() ? { telefono: cliente['telefono'].trim().slice(0, 32) } : {}),
      ...(typeof cliente['email'] === 'string' && cliente['email'].trim() ? { email: cliente['email'].trim().slice(0, 254) } : {}),
    }
  return null
}
