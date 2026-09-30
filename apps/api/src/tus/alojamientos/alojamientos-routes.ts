import { Router } from 'express'
import type { Request, Response } from 'express'
import { AlojamientosService, ErrorAlojamiento } from './alojamientos-service.ts'
import { CheckoutAlojamientosService } from './checkout-service.ts'
import type { PrismaClient } from '@prisma/client'

export function crearRutasAlojamientos(prisma: PrismaClient): Router {
  const router = Router()
  const alojamientosService = new AlojamientosService(prisma)
  const checkoutService = new CheckoutAlojamientosService(alojamientosService)

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

  // 4. Crear hold de reserva
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

      const reserva = await alojamientosService.crearHoldReserva({
        unidadId,
        alojamientoId,
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

  // 5. Crear preferencia de checkout
  router.post('/reservas/:id/checkout-preference', async (req: Request, res: Response) => {
    try {
      const result = await checkoutService.crearPreferenciaCheckout(req.params['id']!)
      return res.json(result)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 6. Simular pago (local/dev/testing)
  router.post('/reservas/:id/simular-pago', async (req: Request, res: Response) => {
    try {
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

  // 7. Calificar alojamiento (solo completed)
  router.post('/calificar', async (req: Request, res: Response) => {
    try {
      const { reservaId, puntuacion, comentario, clienteId } = req.body
      if (!reservaId || !puntuacion) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'reservaId y puntuacion son obligatorios' },
        })
      }

      await alojamientosService.calificarAlojamiento({
        reservaId,
        puntuacion: Number(puntuacion),
        comentario,
        clienteId,
      })

      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 8. Crear alojamiento (Admin / Propietario)
  router.post('/', async (req: Request, res: Response) => {
    try {
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
        propietarioId,
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

  // 9. Crear unidad en alojamiento
  router.post('/:id/unidades', async (req: Request, res: Response) => {
    try {
      const { nombre, descripcion, capacidadPersonas, camasDetalle, banosCantidad, comodidades } = req.body
      if (!nombre) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'nombre es obligatorio' },
        })
      }

      const unidad = await alojamientosService.crearUnidad({
        alojamientoId: req.params['id']!,
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

  // 10. Crear tarifa para unidad
  router.post('/unidades/:unidadId/tarifas', async (req: Request, res: Response) => {
    try {
      const { modalidad, duracionHoras, precio, moneda, diasSemana, minimoEstadia, maximoEstadia } = req.body
      if (precio == null) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'precio es obligatorio' },
        })
      }

      const tarifa = await alojamientosService.crearTarifa({
        unidadId: req.params['unidadId']!,
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

  // 11. Agregar imagen a alojamiento o unidad
  router.post('/:id/imagenes', async (req: Request, res: Response) => {
    try {
      const { url, alt, categoria, orden, esPrincipal } = req.body
      if (!url) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'url es obligatoria' },
        })
      }

      const img = await alojamientosService.agregarImagen({
        alojamientoId: req.params['id']!,
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
      const { url, alt, orden, esPrincipal } = req.body
      if (!url) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'url es obligatoria' },
        })
      }

      const img = await alojamientosService.agregarImagen({
        unidadId: req.params['unidadId']!,
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

  // 12. Bloqueo manual de unidad
  router.post('/unidades/:unidadId/bloquear', async (req: Request, res: Response) => {
    try {
      const { fechaInicio, fechaFin, motivo } = req.body
      if (!fechaInicio || !fechaFin || !motivo) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'fechaInicio, fechaFin y motivo son obligatorios' },
        })
      }

      const bloqueo = await alojamientosService.crearBloqueoUnidad({
        unidadId: req.params['unidadId']!,
        fechaInicio,
        fechaFin,
        motivo,
      })

      return res.status(201).json(bloqueo)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 13. Listar reservas de un alojamiento
  router.get('/:id/reservas', async (req: Request, res: Response) => {
    try {
      const reservas = await alojamientosService.listarReservasAlojamiento(req.params['id']!)
      return res.json({ items: reservas })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 14. Actualizar estado de reserva
  router.patch('/reservas/:id/estado', async (req: Request, res: Response) => {
    try {
      const { estado } = req.body
      if (!['checked_in', 'completed', 'cancelled'].includes(estado)) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'estado inválido' },
        })
      }

      await alojamientosService.actualizarEstadoReserva(req.params['id']!, estado)
      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  return router
}
