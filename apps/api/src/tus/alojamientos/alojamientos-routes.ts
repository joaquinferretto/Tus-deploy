import { Router } from 'express'
import type { Request, Response } from 'express'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { AlojamientosService, ErrorAlojamiento } from './alojamientos-service.ts'
import { CheckoutAlojamientosService } from './checkout-service.ts'
import type { PrismaClient } from '@prisma/client'

// Administración de plataforma: el mismo permiso del panel admin. Solo existe en una sesión de
// admin con MFA elevado (MfaAdminSessionResolver).
const ADMIN = 'tus:providers:admin'

export interface OpcionesRutasAlojamientos {
  // Misma sesión que el resto de TUS (Bearer o cookie HttpOnly + X-Correlation-Id).
  sessions: TusSessionResolverPort
  // Confirma una reserva sin pago real: solo desarrollo local y tests. Apagado si no se indica.
  pagoSimuladoHabilitado?: boolean
}

// Autorización (docs/security/ENDPOINT_SECURITY_MATRIX.md §11):
// - Público: tipos, búsqueda, detalle y hold de reserva (invitado, o cliente si hay sesión).
// - Titular de la reserva: preferencia de checkout y calificación.
// - Admin de plataforma o propietario registrado del alojamiento: unidades, tarifas, imágenes,
//   bloqueos, reservas y cambio de estado.
// - Solo admin: alta de alojamiento (y a qué cuenta pertenece).
// Cliente, propietario y cuenta se derivan de la sesión; nunca de un id del body.
export function crearRutasAlojamientos(prisma: PrismaClient, opciones: OpcionesRutasAlojamientos): Router {
  const router = Router()
  const alojamientosService = new AlojamientosService(prisma)
  const checkoutService = new CheckoutAlojamientosService(alojamientosService, {
    simulado: opciones.pagoSimuladoHabilitado === true,
    ...(process.env['TUS_WEB_BASE_URL']?.trim() ? { webBaseUrl: process.env['TUS_WEB_BASE_URL'].trim() } : {}),
  })

  // Helper para manejar errores
  const manejarError = (err: unknown, res: Response) => {
    if (err instanceof ErrorAlojamiento) {
      return res.status(err.statusCode).json({
        error: { code: err.codigo, message: err.message },
      })
    }
    const mensaje = err instanceof Error ? err.message : 'Error interno'
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: mensaje },
    })
  }

  const enviarError = (res: Response, status: number, code: string, message: string) =>
    res.status(status).json({ error: { code, message } })

  // Sesión si la petición la trae (reserva como cliente registrado); null para un invitado.
  const sesionOpcional = async (req: Request): Promise<TusAuthenticatedTenantContext | null> => {
    const authorization = req.header('authorization') ?? ''
    const correlationId = req.header('x-correlation-id')?.trim() ?? ''
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
    return accessToken && correlationId ? await opciones.sessions.resolve(accessToken, correlationId) : null
  }

  const autenticar = async (req: Request, res: Response): Promise<TusAuthenticatedTenantContext | null> => {
    const context = await sesionOpcional(req)
    if (!context) {
      enviarError(res, 401, 'UNAUTHORIZED', 'Iniciá sesión para continuar')
      return null
    }
    res.setHeader('cache-control', 'no-store')
    return context
  }

  const esAdmin = (context: TusAuthenticatedTenantContext) => context.permissions.includes(ADMIN)

  const soloAdmin = async (req: Request, res: Response): Promise<TusAuthenticatedTenantContext | null> => {
    const context = await autenticar(req, res)
    if (!context) return null
    if (!esAdmin(context)) {
      enviarError(res, 403, 'FORBIDDEN', 'Esta operación requiere una sesión de administración')
      return null
    }
    return context
  }

  // Admin de plataforma o propietario registrado del recurso. Quien no es admin recibe la misma
  // respuesta si el recurso no existe o es de otra cuenta (no revela qué ids existen).
  const autorizarGestion = async (
    req: Request,
    res: Response,
    buscar: () => Promise<{ propietarioId: string | null } | null>
  ): Promise<TusAuthenticatedTenantContext | null> => {
    const context = await autenticar(req, res)
    if (!context) return null
    const recurso = await buscar()
    if (esAdmin(context)) {
      if (recurso) return context
      enviarError(res, 404, 'NOT_FOUND', 'Recurso no encontrado')
      return null
    }
    if (!recurso || recurso.propietarioId !== context.subjectId) {
      enviarError(res, 403, 'FORBIDDEN', 'No tenés permiso sobre este alojamiento')
      return null
    }
    return context
  }

  // Titular de la reserva. Una reserva de invitado no tiene cuenta: la referencia es su id.
  const autorizarTitular = async (req: Request, res: Response, reservaId: string): Promise<boolean> => {
    const reserva = await alojamientosService.titularidadDeReserva(reservaId)
    if (!reserva) {
      enviarError(res, 404, 'NOT_FOUND', 'Reserva no encontrada')
      return false
    }
    if (reserva.clienteId === null) return true
    const context = await sesionOpcional(req)
    if (!context) {
      enviarError(res, 401, 'UNAUTHORIZED', 'Iniciá sesión para continuar')
      return false
    }
    if (context.subjectId !== reserva.clienteId && !esAdmin(context)) {
      enviarError(res, 403, 'FORBIDDEN', 'Esta reserva pertenece a otra cuenta')
      return false
    }
    res.setHeader('cache-control', 'no-store')
    return true
  }

  // 1. Catálogo de tipos
  router.get('/tipos', async (_req: Request, res: Response) => {
    try {
      const tipos = await alojamientosService.listarTipos()
      return res.json({ items: tipos })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 2. Búsqueda pública de alojamientos
  router.get('/', async (req: Request, res: Response) => {
    try {
      const filtros = {
        zonaId: typeof req.query['zonaId'] === 'string' ? req.query['zonaId'] : undefined,
        barrioId: typeof req.query['barrioId'] === 'string' ? req.query['barrioId'] : undefined,
        tipoSlug: typeof req.query['tipoSlug'] === 'string' ? req.query['tipoSlug'] : undefined,
        checkIn: typeof req.query['checkIn'] === 'string' ? req.query['checkIn'] : undefined,
        checkOut: typeof req.query['checkOut'] === 'string' ? req.query['checkOut'] : undefined,
        personas: req.query['personas'] ? Number(req.query['personas']) : undefined,
        precioMin: req.query['precioMin'] ? Number(req.query['precioMin']) : undefined,
        precioMax: req.query['precioMax'] ? Number(req.query['precioMax']) : undefined,
      }

      const items = await alojamientosService.buscarAlojamientosPublico(filtros)
      return res.json({ items, total: items.length })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 3. Detalle público de un alojamiento
  router.get('/:idOrSlug', async (req: Request, res: Response) => {
    try {
      const opciones = {
        checkIn: typeof req.query['checkIn'] === 'string' ? req.query['checkIn'] : undefined,
        checkOut: typeof req.query['checkOut'] === 'string' ? req.query['checkOut'] : undefined,
        personas: req.query['personas'] ? Number(req.query['personas']) : undefined,
        horas: req.query['horas'] ? Number(req.query['horas']) : undefined,
      }

      const detalle = await alojamientosService.obtenerDetallePublico(req.params['idOrSlug']!, opciones)
      return res.json(detalle)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 4. Crear hold de reserva (invitado o cliente). El cliente es la cuenta de la sesión, si hay:
  // un clienteId enviado en el body se ignora.
  router.post('/reservas/hold', async (req: Request, res: Response) => {
    try {
      const {
        unidadId,
        alojamientoId,
        clienteNombre,
        clienteEmail,
        clienteTelefono,
        fechaInicio,
        fechaFin,
        modalidad,
        cantidadPersonas,
        tarifaId,
        notas,
      } = req.body

      if (!unidadId || !fechaInicio || !fechaFin || !clienteNombre) {
        return res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'unidadId, fechaInicio, fechaFin y clienteNombre son obligatorios',
          },
        })
      }

      const context = await sesionOpcional(req)
      const reserva = await alojamientosService.crearHoldReserva({
        unidadId,
        alojamientoId,
        clienteId: context?.subjectId,
        clienteNombre,
        clienteEmail,
        clienteTelefono,
        fechaInicio,
        fechaFin,
        modalidad,
        cantidadPersonas: cantidadPersonas ? Number(cantidadPersonas) : 1,
        tarifaId,
        notas,
      })

      return res.status(201).json(reserva)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 5. Crear preferencia de checkout (titular de la reserva)
  router.post('/reservas/:id/checkout-preference', async (req: Request, res: Response) => {
    try {
      if (!(await autorizarTitular(req, res, req.params['id']!))) return
      const result = await checkoutService.crearPreferenciaCheckout(req.params['id']!)
      return res.json(result)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 6. Simular pago: confirma la reserva sin pago real. Solo local/dev/testing; en producción
  // no existe como operación (una reserva se confirma únicamente con un pago verificado).
  router.post('/reservas/:id/simular-pago', async (req: Request, res: Response) => {
    try {
      if (opciones.pagoSimuladoHabilitado !== true) {
        return enviarError(res, 403, 'PAYMENT_SIMULATION_DISABLED', 'El pago online de alojamientos todavía no está disponible')
      }
      if (!(await autorizarTitular(req, res, req.params['id']!))) return
      const confirmada = await checkoutService.procesarConfirmacionPago({
        reservaId: req.params['id']!,
        paymentId: `sim-pay-${Date.now()}`,
        metodoPago: 'sandbox_mercadopago',
      })
      return res.json({ ok: true, reserva: confirmada })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 6b. Pagos en revisión (solo admin): pagos que llegaron para reservas que ya no tenían sus
  // fechas. No se confirman solos; se concilian a mano.
  router.get('/reservas/pagos-en-revision', async (req: Request, res: Response) => {
    try {
      if (!(await soloAdmin(req, res))) return
      return res.json({ items: await alojamientosService.pagosEnRevision() })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 7. Calificar alojamiento (solo completed). Califica la cuenta titular de la reserva: el
  // cliente sale de la sesión y un clienteId del body no se lee.
  router.post('/calificar', async (req: Request, res: Response) => {
    try {
      const context = await autenticar(req, res)
      if (!context) return
      const { reservaId, puntuacion, comentario } = req.body
      if (!reservaId || !puntuacion) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'reservaId y puntuacion son obligatorios' },
        })
      }

      const reserva = await alojamientosService.titularidadDeReserva(String(reservaId))
      if (!reserva || reserva.clienteId !== context.subjectId) {
        return enviarError(res, 403, 'FORBIDDEN', 'Solo la cuenta que hizo la reserva puede calificarla')
      }

      await alojamientosService.calificarAlojamiento({
        reservaId,
        puntuacion: Number(puntuacion),
        comentario,
        clienteId: context.subjectId,
      })

      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 8. Crear alojamiento (solo admin). El admin indica a qué cuenta pertenece (propietarioId);
  // sin propietario queda administrado solo por la plataforma.
  router.post('/', async (req: Request, res: Response) => {
    try {
      if (!(await soloAdmin(req, res))) return
      const {
        propietarioId,
        tipoId,
        nombre,
        slug,
        descripcion,
        direccion,
        latitud,
        longitud,
        barrioId,
        zonaId,
        checkInHora,
        checkOutHora,
        politicas,
        comodidades,
        publicado,
      } = req.body

      if (!tipoId || !nombre || !slug || !direccion || latitud == null || longitud == null) {
        return res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'tipoId, nombre, slug, direccion, latitud y longitud son obligatorios',
          },
        })
      }

      const creado = await alojamientosService.crearAlojamiento({
        propietarioId: typeof propietarioId === 'string' && propietarioId.trim() ? propietarioId.trim() : undefined,
        tipoId,
        nombre,
        slug,
        descripcion,
        direccion,
        latitud: Number(latitud),
        longitud: Number(longitud),
        barrioId,
        zonaId,
        checkInHora,
        checkOutHora,
        politicas,
        comodidades,
        publicado,
      })

      return res.status(201).json(creado)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 9. Crear unidad en alojamiento (admin o propietario)
  router.post('/:id/unidades', async (req: Request, res: Response) => {
    try {
      const alojamientoId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeAlojamiento(alojamientoId)))) return
      const { nombre, descripcion, capacidadPersonas, camasDetalle, banosCantidad, comodidades } = req.body
      if (!nombre) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'nombre es obligatorio' },
        })
      }

      const unidad = await alojamientosService.crearUnidad({
        alojamientoId,
        nombre,
        descripcion,
        capacidadPersonas: capacidadPersonas ? Number(capacidadPersonas) : 2,
        camasDetalle,
        banosCantidad: banosCantidad ? Number(banosCantidad) : 1,
        comodidades,
      })

      return res.status(201).json(unidad)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 10. Crear tarifa para unidad (admin o propietario)
  router.post('/unidades/:unidadId/tarifas', async (req: Request, res: Response) => {
    try {
      const unidadId = req.params['unidadId']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeUnidad(unidadId)))) return
      const { modalidad, duracionHoras, precio, moneda, diasSemana, minimoEstadia, maximoEstadia } = req.body
      if (precio == null) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'precio es obligatorio' },
        })
      }

      const tarifa = await alojamientosService.crearTarifa({
        unidadId,
        modalidad,
        duracionHoras: duracionHoras ? Number(duracionHoras) : undefined,
        precio: Number(precio),
        moneda,
        diasSemana,
        minimoEstadia: minimoEstadia ? Number(minimoEstadia) : 1,
        maximoEstadia: maximoEstadia ? Number(maximoEstadia) : undefined,
      })

      return res.status(201).json(tarifa)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 11. Agregar imagen a alojamiento o unidad (admin o propietario)
  router.post('/:id/imagenes', async (req: Request, res: Response) => {
    try {
      const alojamientoId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeAlojamiento(alojamientoId)))) return
      const { url, alt, categoria, orden, esPrincipal } = req.body
      if (!url) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'url es obligatoria' },
        })
      }

      const img = await alojamientosService.agregarImagen({
        alojamientoId,
        url,
        alt,
        categoria,
        orden: orden ? Number(orden) : 0,
        esPrincipal: Boolean(esPrincipal),
      })

      return res.status(201).json(img)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  router.post('/unidades/:unidadId/imagenes', async (req: Request, res: Response) => {
    try {
      const unidadId = req.params['unidadId']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeUnidad(unidadId)))) return
      const { url, alt, orden, esPrincipal } = req.body
      if (!url) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'url es obligatoria' },
        })
      }

      const img = await alojamientosService.agregarImagen({
        unidadId,
        url,
        alt,
        orden: orden ? Number(orden) : 0,
        esPrincipal: Boolean(esPrincipal),
      })

      return res.status(201).json(img)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 12. Bloqueo manual de unidad (admin o propietario); queda registrado quién lo creó.
  router.post('/unidades/:unidadId/bloquear', async (req: Request, res: Response) => {
    try {
      const unidadId = req.params['unidadId']!
      const context = await autorizarGestion(req, res, () => alojamientosService.propietarioDeUnidad(unidadId))
      if (!context) return
      const { fechaInicio, fechaFin, motivo } = req.body
      if (!fechaInicio || !fechaFin || !motivo) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'fechaInicio, fechaFin y motivo son obligatorios' },
        })
      }

      const bloqueo = await alojamientosService.crearBloqueoUnidad({
        unidadId,
        fechaInicio,
        fechaFin,
        motivo,
        creadoPorUsuarioId: context.subjectId,
      })

      return res.status(201).json(bloqueo)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 13. Listar reservas de un alojamiento (admin o propietario): incluyen datos de contacto
  // de los huéspedes.
  router.get('/:id/reservas', async (req: Request, res: Response) => {
    try {
      const alojamientoId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeAlojamiento(alojamientoId)))) return
      const reservas = await alojamientosService.listarReservasAlojamiento(alojamientoId)
      return res.json({ items: reservas })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 14. Actualizar estado de reserva (admin o propietario del alojamiento de la reserva)
  router.patch('/reservas/:id/estado', async (req: Request, res: Response) => {
    try {
      const reservaId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.titularidadDeReserva(reservaId)))) return
      const { estado } = req.body
      if (!['checked_in', 'completed', 'cancelled'].includes(estado)) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'estado inválido' },
        })
      }

      await alojamientosService.actualizarEstadoReserva(reservaId, estado)
      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  return router
}
