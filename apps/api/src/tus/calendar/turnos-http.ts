import express, { type Request, type Response, type Router } from 'express'
import { asyncHandler } from '../../presentation/middleware/error.ts'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { ServicioTurnos } from './turnos-service.ts'
import { ErrorCalendario } from './bookings.ts'
import { CODIGO_SESION_REQUERIDA, type ClienteTurnoAdmin } from '@factory/contracts'
import { leerContactoInvitado, leerBloqueo, leerCambioDeEstado, leerCambioDePrecio, leerConfiguracionServicio, leerSwitches, leerTarifas, leerTurnoEscrito, type Entrada } from './turnos-entrada.ts'
import { esInvalido, identificador, texto } from '../validacion/entrada.ts'

const CAMPOS_SOLICITUD_CLIENTE = new Set(['oficioId', 'inicio', 'tarifaId', 'notas'])

export function crearRouterTurnos({
  servicio,
  sessions,
}: {
  servicio: ServicioTurnos
  sessions: TusSessionResolverPort
}): Router {
  const router = express.Router()

  // -----------------------------------------------------------------------------------------------
  // 1. PUBLIC ENDPOINTS (Buscar trabajador -> agenda) y la solicitud de turno del cliente
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

  // Weekly agenda of a provider for a service: every possible start with its real state
  // (available, taken, blocked). Same generator the booking is validated with.
  router.get(
    '/tus/v1/public/prestadores/:id/turnos/agenda',
    asyncHandler(async (request: Request, response: Response) => {
      const prestadorId = String(request.params['id'] ?? '')
      const oficioId = String(request.query['oficioId'] ?? '')
      const desde = String(request.query['desde'] ?? '')
      if (!oficioId || !desde) return void enviarError(response, 400, 'INVALID_PARAMS', 'oficioId y desde (YYYY-MM-DD) son requeridos')
      try {
        const agenda = await servicio.agendaSemanal({ prestadorId, oficioId, desde, tarifaId: request.query['tarifaId'] ? String(request.query['tarifaId']) : undefined })
        response.setHeader('cache-control', 'private, no-store')
        response.status(200).json(agenda)
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // A client REQUESTS a turno; nothing is confirmed here. The client is the account of the
  // session. Reject authority fields instead of silently ignoring them so a caller cannot mistake
  // an attempted identity, provider, amount or state override for an accepted instruction.
  // Without a session there is nobody to request for: 401 LOGIN_REQUIRED and the Web sends the
  // person to sign in and back to this turno. The old path stays as an alias of the same rule.
  const solicitar = asyncHandler(async (request: Request, response: Response) => {
    const prestadorId = String(request.params['id'] ?? '')
    response.setHeader('cache-control', 'private, no-store')
    const context = await intentarAutenticar(request, sessions)
    if (!context) return void enviarError(response, 401, CODIGO_SESION_REQUERIDA, 'Iniciá sesión para solicitar el turno.')
    const body = comoRegistro(request.body)
    const invalidFields = Object.keys(body).filter((field) => !CAMPOS_SOLICITUD_CLIENTE.has(field))
    if (invalidFields.length > 0) {
      return void enviarError(response, 400, 'UNTRUSTED_BOOKING_FIELDS', 'La solicitud contiene campos que determina TUS.')
    }
    const oficioId = String(body['oficioId'] ?? '')
    const inicio = String(body['inicio'] ?? '')
    if (!oficioId || !inicio) return void enviarError(response, 400, 'INVALID_PARAMS', 'oficioId e inicio son requeridos')
    try {
      const turno = await servicio.solicitarTurno({
        prestadorId,
        oficioId,
        tarifaId: body['tarifaId'] ? String(body['tarifaId']) : undefined,
        inicio,
        clienteId: context.subjectId,
        clienteTenantId: context.tenantId,
        notas: body['notas'] ? String(body['notas']) : undefined,
      })
      response.status(201).json(turno)
    } catch (error) {
      manejarError(response, error)
    }
  })
  router.post('/tus/v1/prestadores/:id/turnos/solicitudes', solicitar)
  router.post('/tus/v1/public/prestadores/:id/turnos/reservar', solicitar)

  // -----------------------------------------------------------------------------------------------
  // 1b. CLIENTE (sus propios turnos: solicitudes pendientes, confirmados e historial)
  // -----------------------------------------------------------------------------------------------

  // Who the request is made as: the data of the session's account (phone masked), shown by the
  // Web instead of asking for it again.
  router.get(
    '/tus/v1/cliente/turnos/solicitante',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        response.status(200).json(await servicio.solicitante(context.subjectId))
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.get(
    '/tus/v1/cliente/turnos',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        response.status(200).json({ items: await servicio.turnosCliente(context.subjectId) })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Only a turno of the session's own account (another person's answers 404).
  router.post(
    '/tus/v1/cliente/turnos/:id/cancelar',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        response.status(200).json(await servicio.cancelarTurnoCliente({ clienteId: context.subjectId, reservaId: String(request.params['id'] ?? '') }))
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Deposit of an accepted turno of the session's own account: the hosted Mercado Pago checkout of
  // that deposit. The body is never read: the turno is the one of the path, the client is the
  // session and the amount is derived from the price stored on the reservation. It pays nothing
  // by itself; only Mercado Pago's verified notification marks the deposit as paid.
  router.post(
    '/tus/v1/cliente/turnos/:id/sena/checkout',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      response.setHeader('cache-control', 'private, no-store')
      if (Object.keys(comoRegistro(request.body)).length > 0) {
        return void enviarError(response, 400, 'UNTRUSTED_PAYMENT_FIELDS', 'El importe y los datos del pago los determina TUS.')
      }
      try {
        response.status(200).json(await servicio.pagarSena({ clienteId: context.subjectId, reservaId: String(request.params['id'] ?? ''), correlationId: context.correlationId }))
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

  // Requests waiting for this provider's answer. Their count is the notice of the panel.
  router.get(
    '/tus/v1/prestador/turnos/solicitudes',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        const items = await servicio.solicitudesPrestador(context.tenantId)
        response.status(200).json({ items, pendientes: items.length })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // The provider answers a request of its own agenda. Accepting reserves the time while the deposit
  // is pending (the time is checked again inside the transaction); rejecting gives the time back.
  for (const [accion, aceptar] of [['aceptar', true], ['rechazar', false]] as const) {
    router.post(
      `/tus/v1/prestador/turnos/:id/${accion}`,
      asyncHandler(async (request: Request, response: Response) => {
        const context = await autenticar(request, response, sessions)
        if (!context) return
        const entrada = { prestadorTenantId: context.tenantId, reservaId: String(request.params['id'] ?? '') }
        try {
          response.status(200).json(aceptar ? await servicio.aceptarSolicitud(entrada) : await servicio.rechazarSolicitud(entrada))
        } catch (error) {
          manejarError(response, error)
        }
      })
    )
  }

  router.post(
    '/tus/v1/prestador/turnos/manual',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const entrada = leerTurnoEscrito(comoRegistro(request.body), Date.now())
      if (!entrada.ok) return void rechazar(response, entrada)
      try {
        // The agenda is the one of the session's tenant: a provider id in the body does not exist.
        response.status(201).json(await servicio.crearTurnoManual({ prestadorTenantId: context.tenantId, ...entrada.valor }))
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
      const entrada = leerBloqueo(comoRegistro(request.body), Date.now())
      if (!entrada.ok) return void rechazar(response, entrada)
      try {
        response.status(201).json(await servicio.bloquearHorario({ prestadorTenantId: context.tenantId, ...entrada.valor }))
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  router.get(
    '/tus/v1/prestador/turnos/bloqueos',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        response.status(200).json({ items: await servicio.bloqueosPrestador(context.tenantId) })
      } catch (error) {
        manejarError(response, error)
      }
    })
  )

  // Only a block of the session's own tenant can be removed.
  router.delete(
    '/tus/v1/prestador/turnos/bloqueos/:id',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      try {
        response.status(200).json(await servicio.quitarBloqueo(context.tenantId, String(request.params['id'] ?? '')))
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
      const entrada = leerCambioDeEstado(comoRegistro(request.body))
      if (!entrada.ok) return void rechazar(response, entrada, entrada.campo === 'estado' ? 'INVALID_STATUS' : 'INVALID_PARAMS')
      if (!['cancelled', 'completed', 'no-show'].includes(entrada.valor.estado)) {
        enviarError(response, 400, 'INVALID_STATUS', 'Estado no reconocido')
        return
      }

      try {
        const turno = await servicio.cambiarEstadoTurno({
          reservaId,
          tenantId: context.tenantId,
          nuevoEstado: entrada.valor.estado,
          motivo: entrada.valor.motivo,
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
        const disponibilidad = await servicio.disponibilidadSemanal(context.tenantId)
        response.status(200).json({ items: disponibilidad.horarios, intervaloGeneral: disponibilidad.intervaloGeneral })
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
      const body = comoRegistro(request.body)
      const desconocidos = Object.keys(body).filter((key) => key !== 'horarios' && key !== 'intervaloGeneral')
      if (desconocidos.length > 0) return void enviarError(response, 422, 'INVALID_PARAMS', `Campos desconocidos: ${desconocidos.join(', ')}`)
      try {
        // Without a general interval only the hours change (the agenda keeps the one it has).
        if (body['intervaloGeneral'] === undefined) return void response.status(200).json({ items: await servicio.guardarHorariosPrestador(context.tenantId, body['horarios']) })
        const guardada = await servicio.guardarDisponibilidadSemanal(context.tenantId, { intervaloGeneral: body['intervaloGeneral'], horarios: body['horarios'] })
        response.status(200).json({ items: guardada.horarios, intervaloGeneral: guardada.intervaloGeneral })
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

  // Weekly agenda of the own calendar for a service (also when the profile is hidden).
  router.get(
    '/tus/v1/prestador/turnos/agenda',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await autenticar(request, response, sessions)
      if (!context) return
      const perfil = await servicio.perfilDeTenant(context.tenantId)
      if (!perfil) return void enviarError(response, 404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
      const oficioId = String(request.query['oficioId'] ?? '')
      const desde = String(request.query['desde'] ?? '')
      if (!oficioId || !desde) return void enviarError(response, 400, 'INVALID_PARAMS', 'oficioId y desde (YYYY-MM-DD) son requeridos')
      try {
        response.status(200).json(await servicio.agendaSemanal({ prestadorId: perfil.id, oficioId, desde, incluirNoVisible: true }))
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

      const oficioId = identificador(request.params['oficioId'])
      if (esInvalido(oficioId)) return void enviarError(response, 400, 'INVALID_PARAMS', 'Servicio no válido')
      const entrada = leerConfiguracionServicio(comoRegistro(request.body))
      if (!entrada.ok) return void rechazar(response, entrada)
      // The profile is the one of the session's tenant (a profile id in the body is refused).
      const perfil = await servicio.perfilDeTenant(context.tenantId)
      if (!perfil) return void enviarError(response, 404, 'NOT_FOUND', 'Perfil de prestador no encontrado')

      try {
        const updated = await servicio.actualizarServicioPrestador({ perfilId: perfil.id, oficioId, ...entrada.valor })
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

      const oficioId = identificador(request.params['oficioId'])
      if (esInvalido(oficioId)) return void enviarError(response, 400, 'INVALID_PARAMS', 'Servicio no válido')
      const entrada = leerTarifas(comoRegistro(request.body))
      if (!entrada.ok) return void rechazar(response, entrada)
      const perfil = await servicio.perfilDeTenant(context.tenantId)
      if (!perfil) return void enviarError(response, 404, 'NOT_FOUND', 'Perfil de prestador no encontrado')

      try {
        const guardadas = await servicio.guardarTarifasPrestador({ tenantId: context.tenantId, perfilId: perfil.id, oficioId, tarifas: entrada.valor })
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
      const entrada = leerCambioDePrecio(comoRegistro(request.body))
      if (!entrada.ok) return void rechazar(response, entrada, entrada.campo === 'motivo' ? 'MOTIVO_REQUIRED' : 'INVALID_PARAMS')

      try {
        const turno = await servicio.adminModificarPrecio({
          reservaId,
          nuevoPrecio: entrada.valor.precioFinal,
          motivo: entrada.valor.motivo,
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
      const entrada = leerTurnoEscrito(body, Date.now(), ['prestadorId', 'motivoForzado'])
      if (!entrada.ok) return void rechazar(response, entrada)
      const prestadorId = identificador(body['prestadorId'])
      if (esInvalido(prestadorId)) return void enviarError(response, 400, 'INVALID_PARAMS', 'Elegí el prestador.')
      const motivoForzado = texto(body['motivoForzado'], { min: 5, max: 300 })
      if (esInvalido(motivoForzado)) return void enviarError(response, 400, 'MOTIVO_REQUIRED', 'El motivo de forzado es obligatorio (5 a 300 caracteres).')

      try {
        const turno = await servicio.adminForzarTurno({
          prestadorId,
          ...entrada.valor,
          motivoForzado,
          // The administrator is the one of the session, never a field of the body.
          adminId: adminCtx.subjectId,
          correlationId: adminCtx.correlationId,
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
      const entrada = leerCambioDeEstado(comoRegistro(request.body))
      if (!entrada.ok) return void rechazar(response, entrada, entrada.campo === 'estado' ? 'INVALID_STATUS' : 'INVALID_PARAMS')

      try {
        const turno = await servicio.cambiarEstadoTurno({
          reservaId,
          isAdmin: true,
          nuevoEstado: entrada.valor.estado,
          motivo: entrada.valor.motivo,
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

      const perfilId = identificador(request.params['id'])
      if (esInvalido(perfilId)) return void enviarError(response, 400, 'INVALID_PARAMS', 'Prestador no válido')
      const entrada = leerSwitches(comoRegistro(request.body))
      if (!entrada.ok) return void rechazar(response, entrada)

      try {
        const updated = await servicio.actualizarSwitchesPrestador({ perfilId, ...entrada.valor })
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

// A body that was refused: the field that failed travels with the message, so the form can point at it.
function rechazar(response: Response, entrada: Extract<Entrada<unknown>, { ok: false }>, code = 'INVALID_PARAMS'): void {
  // A date that is not one keeps the code the agenda always answered with.
  response.status(400).json({ code: code === 'INVALID_PARAMS' && ['inicio', 'fin'].includes(entrada.campo) ? 'INVALID_DATE' : code, error: entrada.mensaje, fields: [entrada.campo] })
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
  if (cliente['tipo'] === 'invitado') {
    // Same rules as a turno written by the provider: a real name, and a phone / email only when
    // they are valid (the phone in the canonical format).
    const invitado = leerContactoInvitado({ clienteNombre: cliente['nombre'], clienteTelefono: cliente['telefono'], clienteEmail: cliente['email'] })
    if (!invitado.ok) return null
    return {
      tipo: 'invitado',
      nombre: invitado.valor.clienteNombre,
      ...(invitado.valor.clienteTelefono ? { telefono: invitado.valor.clienteTelefono } : {}),
      ...(invitado.valor.clienteEmail ? { email: invitado.valor.clienteEmail } : {}),
    }
  }
  return null
}
