import { Router } from 'express'
import type { Request, Response } from 'express'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../ports/index.ts'
import { AlojamientosService, ErrorAlojamiento } from './alojamientos-service.ts'
import { CheckoutAlojamientosService } from './checkout-service.ts'
import type { PrismaClient } from '@prisma/client'
import { GestionAlojamientos, hoyCalendario, leerAlojamientoPropio, leerCancelacion, leerOrdenImagenes, puntoAproximado } from './alojamientos-gestion.ts'
import { leerAlojamiento, leerBloqueoUnidad, leerCalificacion, leerImagen, leerReserva, leerTarifaAlojamiento, leerUnidad, type Entrada } from './alojamientos-entrada.ts'

// The body as an object, whatever was sent (nothing, a list, a text): reading a field never throws.
const cuerpo = (req: Request): Record<string, unknown> => (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {})
// A refused body: 400 with the field that failed, in the envelope these routes always used.
const rechazar = (res: Response, entrada: Extract<Entrada<unknown>, { ok: false }>) => res.status(400).json({ error: { code: 'BAD_REQUEST', message: entrada.mensaje, fields: [entrada.campo] } })

// Administración de plataforma: el mismo permiso del panel admin. Solo existe en una sesión de
// admin con MFA elevado (MfaAdminSessionResolver).
const ADMIN = 'tus:providers:admin'

import type { AvisosAlojamientos } from './alojamientos-avisos.ts'

export interface OpcionesRutasAlojamientos {
  // Misma sesión que el resto de TUS (Bearer o cookie HttpOnly + X-Correlation-Id).
  sessions: TusSessionResolverPort
  // Confirma una reserva sin pago real: solo desarrollo local y tests. Apagado si no se indica.
  pagoSimuladoHabilitado?: boolean
  // ALOJAMIENTOS-AVISOS-01: tells the owner of a reservation and of its cancellation. Absent:
  // nobody is told (the reservation works the same).
  avisos?: AvisosAlojamientos | null
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
  const gestion = new GestionAlojamientos(prisma)
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

  // Barrios of the catalogue (id and name): where an owner says its alojamiento is.
  router.get('/barrios', async (_req: Request, res: Response) => {
    try {
      const filas = await prisma.barrio.findMany({ where: { activo: true }, select: { id: true, nombre: true, zona: { select: { nombre: true } } }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], take: 1000 })
      return res.json({ items: filas.map((fila) => ({ id: fila.id, nombre: fila.nombre, zona: fila.zona?.nombre ?? null })) })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // What anyone may see of an alojamiento: never who owns it nor the exact address, and the
  // point is approximate. The exact location reaches the guest with a confirmed reservation.
  const publico = <T extends { id: string; propietarioId: string | null; direccion: string | null; latitud: number; longitud: number }>(item: T): T => ({ ...item, propietarioId: null, direccion: null, ...puntoAproximado(item.id, item.latitud, item.longitud) })

  // Dates of a stay as calendar dates: both or none, in order, not in the past, up to a year.
  const estadia = (query: Request['query']): { ok: true; checkIn?: string; checkOut?: string } | { ok: false; campo: string; mensaje: string } => {
    const checkIn = typeof query['checkIn'] === 'string' && query['checkIn'] ? query['checkIn'] : undefined
    const checkOut = typeof query['checkOut'] === 'string' && query['checkOut'] ? query['checkOut'] : undefined
    if (checkIn === undefined && checkOut === undefined) return { ok: true }
    const fecha = (valor: string | undefined) => valor !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(valor) && !Number.isNaN(Date.parse(`${valor}T00:00:00.000Z`)) && new Date(`${valor}T00:00:00.000Z`).toISOString().slice(0, 10) === valor
    if (!fecha(checkIn)) return { ok: false, campo: 'checkIn', mensaje: 'La fecha de entrada no es válida.' }
    if (!fecha(checkOut)) return { ok: false, campo: 'checkOut', mensaje: 'La fecha de salida no es válida.' }
    if (checkOut! <= checkIn!) return { ok: false, campo: 'checkOut', mensaje: 'La salida debe ser posterior a la entrada.' }
    if (checkIn! < hoyCalendario(new Date())) return { ok: false, campo: 'checkIn', mensaje: 'La fecha de entrada ya pasó.' }
    if (Date.parse(checkOut!) - Date.parse(checkIn!) > 366 * 24 * 60 * 60 * 1000) return { ok: false, campo: 'checkOut', mensaje: 'La estadía puede tener como máximo un año.' }
    return { ok: true, checkIn: checkIn!, checkOut: checkOut! }
  }
  const numero = (valor: unknown, min: number, max: number): number | undefined | null => {
    if (valor === undefined || valor === '') return undefined
    const leido = typeof valor === 'string' && /^\d{1,9}$/u.test(valor) ? Number(valor) : NaN
    return Number.isInteger(leido) && leido >= min && leido <= max ? leido : null
  }

  // ---- ALOJAMIENTOS-GESTION-01: the guest's reservations and the owner's alojamientos ----------
  // (before the routes with a free first segment)

  // Mis alojamientos: the ones of the account of the session, published or not.
  router.get('/mios', async (req: Request, res: Response) => {
    try {
      const context = await autenticar(req, res)
      if (!context) return
      return res.json({ items: await gestion.misAlojamientos(context.subjectId) })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // ALOJAMIENTOS-ADMIN-01. Platform administration only: every lodging (drafts, paused and
  // suspended too) with its owner, and the reservations of every lodging. Paginated in the store.
  const pagina = (req: Request) => ({ pagina: Math.min(Math.max(Number.parseInt(String(req.query['pagina'] ?? '1'), 10) || 1, 1), 10_000), tamano: Math.min(Math.max(Number.parseInt(String(req.query['tamano'] ?? '25'), 10) || 25, 1), 100) })
  router.get('/admin/listado', async (req: Request, res: Response) => {
    try {
      if (!(await soloAdmin(req, res))) return
      return res.json(await gestion.listarParaAdmin({ ...pagina(req), estado: String(req.query['estado'] ?? ''), q: String(req.query['q'] ?? '') }))
    } catch (err) {
      return manejarError(err, res)
    }
  })
  router.get('/admin/reservas', async (req: Request, res: Response) => {
    try {
      if (!(await soloAdmin(req, res))) return
      return res.json(await gestion.reservasParaAdmin({ ...pagina(req), estado: String(req.query['estado'] ?? '') }))
    } catch (err) {
      return manejarError(err, res)
    }
  })
  // Suspend a lodging or lift its suspension. The body carries only the switch and the mandatory
  // note; the actor is the session.
  router.post('/:id/suspension', async (req: Request, res: Response) => {
    try {
      const context = await soloAdmin(req, res)
      if (!context) return
      const body = cuerpo(req)
      if (Object.keys(body).some((key) => key !== 'suspendido' && key !== 'motivo') || typeof body['suspendido'] !== 'boolean') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'suspendido debe ser true o false, con su motivo' } })
      return res.json(await gestion.suspender(req.params['id']!, body['suspendido'], { id: context.subjectId, correlationId: context.correlationId, motivo: body['motivo'] }))
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // A new alojamiento of the account of the session, as a draft. The owner is never in the body.
  router.post('/mios', async (req: Request, res: Response) => {
    try {
      const context = await autenticar(req, res)
      if (!context) return
      const entrada = leerAlojamientoPropio(cuerpo(req))
      if (!entrada.ok) return rechazar(res, entrada)
      return res.status(201).json(await gestion.crearPropio(context.subjectId, entrada.valor))
    } catch (err) {
      return manejarError(err, res)
    }
  })

  router.put('/mios/:id', async (req: Request, res: Response) => {
    try {
      const alojamientoId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeAlojamiento(alojamientoId)))) return
      const entrada = leerAlojamientoPropio(cuerpo(req))
      if (!entrada.ok) return rechazar(res, entrada)
      await gestion.editarPropio(alojamientoId, entrada.valor)
      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // Publish / unpublish (owner or admin).
  router.post('/:id/publicacion', async (req: Request, res: Response) => {
    try {
      const alojamientoId = req.params['id']!
      const context = await autorizarGestion(req, res, () => alojamientosService.propietarioDeAlojamiento(alojamientoId))
      if (!context) return
      const body = cuerpo(req)
      if (Object.keys(body).some((key) => key !== 'publicado') || typeof body['publicado'] !== 'boolean') return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'publicado debe ser verdadero o falso', fields: ['publicado'] } })
      return res.json(await gestion.publicar(alojamientoId, body['publicado'], esAdmin(context)))
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // Mis reservas: the ones of the account of the session.
  router.get('/reservas/mias', async (req: Request, res: Response) => {
    try {
      const context = await autenticar(req, res)
      if (!context) return
      return res.json({ items: await gestion.misReservas(context.subjectId) })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // Reserve: a signed-in account reserves and the reservation is confirmed at once (it is paid
  // at the place; there is no online payment). The total is computed here, never read.
  router.post('/reservas', async (req: Request, res: Response) => {
    try {
      const context = await autenticar(req, res)
      if (!context) return
      const entrada = leerReserva(cuerpo(req), Date.now())
      if (!entrada.ok) return rechazar(res, entrada)
      // A stay is made of calendar dates (the day of arrival and the day of departure), the same
      // the search uses: an instant with a time would not line up with the other reservations.
      for (const campo of ['fechaInicio', 'fechaFin'] as const) {
        if (entrada.valor[campo].length !== 10) return rechazar(res, { ok: false, campo, mensaje: 'Indicá la fecha como AAAA-MM-DD.' })
      }
      if (new Date(entrada.valor.fechaInicio).toISOString().slice(0, 10) < hoyCalendario(new Date())) return rechazar(res, { ok: false, campo: 'fechaInicio', mensaje: 'La fecha de entrada ya pasó.' })
      const reserva = await alojamientosService.crearHoldReserva({ ...entrada.valor, clienteId: context.subjectId, inmediata: true })
      // After the reservation exists; a notice that fails never undoes it.
      void opciones.avisos?.reservaRecibida(reserva.id).catch(() => undefined)
      return res.status(201).json(reserva)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // The guest cancels its own reservation (until the day before the stay starts).
  router.post('/reservas/:id/cancelar', async (req: Request, res: Response) => {
    try {
      const context = await autenticar(req, res)
      if (!context) return
      const entrada = leerCancelacion(cuerpo(req))
      if (!entrada.ok) return rechazar(res, entrada)
      await gestion.cancelarComoCliente(req.params['id']!, context.subjectId, entrada.valor.motivo)
      void opciones.avisos?.reservaCancelada(req.params['id']!).catch(() => undefined)
      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // History of a reservation (admin or owner of its alojamiento).
  router.get('/reservas/:id/historial', async (req: Request, res: Response) => {
    try {
      const reservaId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.titularidadDeReserva(reservaId)))) return
      return res.json({ items: await gestion.historial(reservaId) })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // Blocked dates of a unit: list and remove (admin or owner).
  router.get('/unidades/:unidadId/bloqueos', async (req: Request, res: Response) => {
    try {
      const unidadId = req.params['unidadId']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeUnidad(unidadId)))) return
      return res.json({ items: await gestion.bloqueosDeUnidad(unidadId) })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  router.delete('/bloqueos/:id', async (req: Request, res: Response) => {
    try {
      const bloqueoId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => gestion.propietarioDeBloqueo(bloqueoId)))) return
      await gestion.quitarBloqueo(bloqueoId)
      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // Photos: upload the raw image (application/octet-stream), serve it, remove it, order them.
  router.post('/:id/fotos', async (req: Request, res: Response) => {
    try {
      const alojamientoId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeAlojamiento(alojamientoId)))) return
      if (!Buffer.isBuffer(req.body)) return enviarError(res, 415, 'PHOTO_TYPE_NOT_ALLOWED', 'Enviá la foto como application/octet-stream')
      return res.status(201).json(await gestion.subirImagen(alojamientoId, req.body))
    } catch (err) {
      return manejarError(err, res)
    }
  })

  router.get('/imagenes/:id/archivo', async (req: Request, res: Response) => {
    try {
      const archivo = await gestion.archivoImagen(req.params['id']!)
      if (!archivo) return enviarError(res, 404, 'NOT_FOUND', 'Foto no encontrada')
      res.setHeader('content-type', archivo.tipoMime)
      res.setHeader('content-length', String(archivo.contenido.length))
      res.setHeader('x-content-type-options', 'nosniff')
      res.setHeader('content-security-policy', "default-src 'none'; sandbox")
      res.setHeader('cross-origin-resource-policy', 'cross-origin')
      // Only the browser caches it: a shared cache would keep serving a photo that was removed.
      res.setHeader('cache-control', 'private, max-age=3600')
      res.setHeader('content-disposition', 'inline')
      res.setHeader('etag', `"${archivo.sha256}"`)
      return res.status(200).end(archivo.contenido)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  router.delete('/imagenes/:id', async (req: Request, res: Response) => {
    try {
      const imagenId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => gestion.propietarioDeImagen(imagenId)))) return
      await gestion.quitarImagen(imagenId)
      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  router.put('/:id/imagenes/orden', async (req: Request, res: Response) => {
    try {
      const alojamientoId = req.params['id']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeAlojamiento(alojamientoId)))) return
      const entrada = leerOrdenImagenes(cuerpo(req))
      if (!entrada.ok) return rechazar(res, entrada)
      await gestion.ordenarImagenes(alojamientoId, entrada.valor.orden)
      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 2. Búsqueda pública de alojamientos
  router.get('/', async (req: Request, res: Response) => {
    try {
      const fechas = estadia(req.query)
      if (!fechas.ok) return rechazar(res, fechas)
      const personasLeidas = numero(req.query['personas'], 1, 100)
      if (personasLeidas === null) return rechazar(res, { ok: false, campo: 'personas', mensaje: 'La cantidad de huéspedes debe ser un número de 1 a 100.' })
      const filtros = {
        q: typeof req.query['q'] === 'string' ? req.query['q'].trim().slice(0, 80) : undefined,
        zonaId: typeof req.query['zonaId'] === 'string' ? req.query['zonaId'] : undefined,
        barrioId: typeof req.query['barrioId'] === 'string' ? req.query['barrioId'] : undefined,
        tipoSlug: typeof req.query['tipoSlug'] === 'string' ? req.query['tipoSlug'] : undefined,
        checkIn: fechas.checkIn,
        checkOut: fechas.checkOut,
        personas: personasLeidas,
        precioMin: req.query['precioMin'] ? Number(req.query['precioMin']) : undefined,
        precioMax: req.query['precioMax'] ? Number(req.query['precioMax']) : undefined,
      }

      const items = (await alojamientosService.buscarAlojamientosPublico(filtros)).map(publico)
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
      return res.json(publico(detalle))
    } catch (err) {
      return manejarError(err, res)
    }
  })

  // 4. Crear hold de reserva (invitado o cliente). El cliente es la cuenta de la sesión, si hay:
  // un clienteId enviado en el body se ignora.
  router.post('/reservas/hold', async (req: Request, res: Response) => {
    try {
      const entrada = leerReserva(cuerpo(req), Date.now())
      if (!entrada.ok) return rechazar(res, entrada)

      const context = await sesionOpcional(req)
      // Who reserves is the session, when there is one: a client id in the body does not exist.
      const reserva = await alojamientosService.crearHoldReserva({ ...entrada.valor, clienteId: context?.subjectId })

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
      const entrada = leerCalificacion(cuerpo(req))
      if (!entrada.ok) return rechazar(res, entrada)
      const { reservaId, puntuacion, comentario } = entrada.valor

      const reserva = await alojamientosService.titularidadDeReserva(String(reservaId))
      if (!reserva || reserva.clienteId !== context.subjectId) {
        return enviarError(res, 403, 'FORBIDDEN', 'Solo la cuenta que hizo la reserva puede calificarla')
      }

      await alojamientosService.calificarAlojamiento({
        reservaId,
        puntuacion,
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
      const entrada = leerAlojamiento(cuerpo(req))
      if (!entrada.ok) return rechazar(res, entrada)
      const creado = await alojamientosService.crearAlojamiento(entrada.valor)

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
      const entrada = leerUnidad(cuerpo(req))
      if (!entrada.ok) return rechazar(res, entrada)
      const unidad = await alojamientosService.crearUnidad({ alojamientoId, ...entrada.valor })

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
      const entrada = leerTarifaAlojamiento(cuerpo(req))
      if (!entrada.ok) return rechazar(res, entrada)
      const tarifa = await alojamientosService.crearTarifa({ unidadId, ...entrada.valor, precio: Number(entrada.valor.precio) })

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
      const entrada = leerImagen(cuerpo(req), true)
      if (!entrada.ok) return rechazar(res, entrada)
      const img = await alojamientosService.agregarImagen({ alojamientoId, ...entrada.valor })

      return res.status(201).json(img)
    } catch (err) {
      return manejarError(err, res)
    }
  })

  router.post('/unidades/:unidadId/imagenes', async (req: Request, res: Response) => {
    try {
      const unidadId = req.params['unidadId']!
      if (!(await autorizarGestion(req, res, () => alojamientosService.propietarioDeUnidad(unidadId)))) return
      const entrada = leerImagen(cuerpo(req), false)
      if (!entrada.ok) return rechazar(res, entrada)
      const img = await alojamientosService.agregarImagen({ unidadId, ...entrada.valor })

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
      const entrada = leerBloqueoUnidad(cuerpo(req), Date.now())
      if (!entrada.ok) return rechazar(res, entrada)
      const bloqueo = await alojamientosService.crearBloqueoUnidad({ unidadId, ...entrada.valor, creadoPorUsuarioId: context.subjectId })

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
      const context = await autorizarGestion(req, res, () => alojamientosService.titularidadDeReserva(reservaId))
      if (!context) return
      const cuerpoEstado = cuerpo(req)
      const estado = cuerpoEstado['estado']
      if (Object.keys(cuerpoEstado).some((key) => key !== 'estado') || typeof estado !== 'string' || !['checked_in', 'completed', 'cancelled'].includes(estado)) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'estado inválido' },
        })
      }

      // The change and who made it are kept in the history of the reservation.
      const nuevo = estado as 'checked_in' | 'completed' | 'cancelled'
      const origenes = nuevo === 'checked_in' ? ['pending_payment', 'confirmed'] : ['pending_payment', 'confirmed', 'checked_in']
      await gestion.cambiarEstado(reservaId, nuevo, { id: context.subjectId, rol: esAdmin(context) ? 'admin' : 'propietario' }, origenes)
      return res.json({ ok: true })
    } catch (err) {
      return manejarError(err, res)
    }
  })

  return router
}
