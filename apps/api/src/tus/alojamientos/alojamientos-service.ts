import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type {
  AlojamientoPublicoDTO,
  BloqueoUnidadInput,
  CalificarAlojamientoInput,
  ConfirmarReservaInput,
  CrearHoldReservaInput,
  DetalleAlojamientoPublicoDTO,
  FiltrosBusquedaAlojamientos,
  FotoUnidadConFallback,
  ModalidadTarifaAlojamiento,
  ReservaAlojamientoDTO,
  TipoAlojamientoDTO,
  UnidadDisponibleDTO,
} from '@factory/contracts'

export class ErrorAlojamiento extends Error {
  readonly statusCode: number
  readonly codigo: string

  constructor(statusCode: number, codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorAlojamiento'
    this.statusCode = statusCode
    this.codigo = codigo
  }
}

export class AlojamientosService {
  private readonly prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  /**
   * Lista el catálogo de tipos de alojamiento activos.
   */
  async listarTipos(): Promise<TipoAlojamientoDTO[]> {
    const tipos = await this.prisma.tipoAlojamiento.findMany({
      where: { activo: true },
      orderBy: { orden: 'asc' },
    })

    return tipos.map((t) => ({
      id: t.id,
      slug: t.slug,
      nombre: t.nombre,
      descripcion: t.descripcion,
      icono: t.icono,
      orden: t.orden,
      activo: t.activo,
    }))
  }

  /**
   * Búsqueda pública de alojamientos con cálculo de disponibilidad y precio.
   */
  async buscarAlojamientosPublico(
    filtros: FiltrosBusquedaAlojamientos = {}
  ): Promise<AlojamientoPublicoDTO[]> {
    const where: Record<string, unknown> = {
      publicado: true,
      estado: 'publicado',
    }

    if (filtros.zonaId) {
      where['zonaId'] = filtros.zonaId
    }
    if (filtros.barrioId) {
      where['barrioId'] = filtros.barrioId
    }
    if (filtros.tipoSlug) {
      where['tipo'] = { slug: filtros.tipoSlug }
    }

    const ahora = new Date()
    const checkInDate = filtros.checkIn ? new Date(filtros.checkIn) : null
    const checkOutDate = filtros.checkOut ? new Date(filtros.checkOut) : null

    const alojamientos = await this.prisma.alojamiento.findMany({
      where,
      include: {
        tipo: true,
        barrio: true,
        zona: true,
        imagenes: {
          orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }],
        },
        unidades: {
          where: {
            estado: 'activa',
            ...(filtros.personas ? { capacidadPersonas: { gte: filtros.personas } } : {}),
          },
          include: {
            tarifas: {
              where: { activa: true },
              orderBy: { precio: 'asc' },
            },
            reservas: checkInDate && checkOutDate
              ? {
                  where: {
                    estado: { in: ['pending_payment', 'confirmed', 'checked_in'] },
                    fechaInicio: { lt: checkOutDate },
                    fechaFin: { gt: checkInDate },
                  },
                }
              : false,
            bloqueos: checkInDate && checkOutDate
              ? {
                  where: {
                    fechaInicio: { lt: checkOutDate },
                    fechaFin: { gt: checkInDate },
                  },
                }
              : false,
          },
        },
      },
      orderBy: [{ ratingPromedio: 'desc' }, { nombre: 'asc' }],
    })

    const resultados: AlojamientoPublicoDTO[] = []

    for (const a of alojamientos) {
      // Filtrar unidades disponibles
      let unidadesDisponibles = a.unidades
      if (checkInDate && checkOutDate) {
        unidadesDisponibles = a.unidades.filter((u) => {
          // Filtrar reservas que sigan activas (o hold no expirado)
          const reservasActivas = u.reservas.filter((r) => {
            if (r.estado === 'pending_payment') {
              return r.holdExpiracion && r.holdExpiracion > ahora
            }
            return true
          })
          if (reservasActivas.length > 0) return false
          if (u.bloqueos && u.bloqueos.length > 0) return false
          return true
        })
      }

      // Si se buscaron fechas específicas y no quedan unidades disponibles, omitir
      if (checkInDate && checkOutDate && unidadesDisponibles.length === 0) {
        continue
      }

      // Calcular precio referencial
      let precioDesde: { amount: number; modalidad: ModalidadTarifaAlojamiento; currency: string } | null = null

      if (checkInDate && checkOutDate) {
        // Calcular precio exacto para el rango de fechas
        const diffMs = checkOutDate.getTime() - checkInDate.getTime()
        const diffHoras = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)))
        const diffNoches = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))

        let menorPrecioTotal: number | null = null
        let menorModalidad: ModalidadTarifaAlojamiento = 'noche'

        for (const u of unidadesDisponibles) {
          for (const t of u.tarifas) {
            let total = 0
            if (t.modalidad === 'por_hora' || t.modalidad === 'bloque_horas') {
              const cantHoras = t.duracionHoras ?? 1
              const bloques = Math.ceil(diffHoras / cantHoras)
              total = Number(t.precio) * bloques
            } else if (t.modalidad === 'dia' || t.modalidad === 'noche') {
              if (diffNoches < t.minimoEstadia) continue
              if (t.maximoEstadia && diffNoches > t.maximoEstadia) continue
              total = Number(t.precio) * diffNoches
            } else if (t.modalidad === 'semana') {
              const semanas = Math.ceil(diffNoches / 7)
              total = Number(t.precio) * semanas
            }

            if (menorPrecioTotal === null || total < menorPrecioTotal) {
              menorPrecioTotal = total
              menorModalidad = t.modalidad as ModalidadTarifaAlojamiento
            }
          }
        }

        if (menorPrecioTotal !== null) {
          precioDesde = {
            amount: menorPrecioTotal,
            modalidad: menorModalidad,
            currency: 'ARS',
          }
        }
      } else {
        // Sin fechas: mostrar tarifa mínima base activa
        let minTarifa: { amount: number; modalidad: ModalidadTarifaAlojamiento } | null = null
        for (const u of a.unidades) {
          for (const t of u.tarifas) {
            const precio = Number(t.precio)
            if (!minTarifa || precio < minTarifa.amount) {
              minTarifa = { amount: precio, modalidad: t.modalidad as ModalidadTarifaAlojamiento }
            }
          }
        }
        if (minTarifa) {
          precioDesde = {
            amount: minTarifa.amount,
            modalidad: minTarifa.modalidad,
            currency: 'ARS',
          }
        }
      }

      // Filtro de precio si fue especificado
      if (filtros.precioMin && precioDesde && precioDesde.amount < filtros.precioMin) continue
      if (filtros.precioMax && precioDesde && precioDesde.amount > filtros.precioMax) continue

      resultados.push({
        id: a.id,
        propietarioId: a.propietarioId,
        nombre: a.nombre,
        slug: a.slug,
        tipo: {
          id: a.tipo.id,
          slug: a.tipo.slug,
          nombre: a.tipo.nombre,
        },
        descripcion: a.descripcion,
        direccion: a.direccion,
        latitud: a.latitud,
        longitud: a.longitud,
        barrioNombre: a.barrio?.nombre ?? null,
        zonaNombre: a.zona?.nombre ?? null,
        rating: a.ratingPromedio
          ? { average: Math.round(a.ratingPromedio * 10) / 10, count: a.ratingCantidad }
          : null,
        precioDesde,
        imagenes: a.imagenes.map((img) => ({
          id: img.id,
          alojamientoId: img.alojamientoId,
          url: img.url,
          alt: img.alt,
          categoria: img.categoria,
          orden: img.orden,
          esPrincipal: img.esPrincipal,
        })),
        unidadesContador: unidadesDisponibles.length,
        comodidades: a.comodidades,
      })
    }

    return resultados
  }

  /**
   * Obtiene el detalle público de un alojamiento por ID o slug.
   * Incluye unidades y aplica la jerarquía de fotos con fallback a fotos generales.
   */
  async obtenerDetallePublico(
    idOrSlug: string,
    opciones: {
      checkIn?: string
      checkOut?: string
      personas?: number
      horas?: number
    } = {}
  ): Promise<DetalleAlojamientoPublicoDTO> {
    const ahora = new Date()
    const checkInDate = opciones.checkIn ? new Date(opciones.checkIn) : null
    const checkOutDate = opciones.checkOut ? new Date(opciones.checkOut) : null

    const a = await this.prisma.alojamiento.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        publicado: true,
      },
      include: {
        tipo: true,
        barrio: true,
        zona: true,
        imagenes: {
          orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }],
        },
        unidades: {
          where: {
            estado: { not: 'inactiva' },
            ...(opciones.personas ? { capacidadPersonas: { gte: opciones.personas } } : {}),
          },
          include: {
            imagenes: {
              orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }],
            },
            tarifas: {
              where: { activa: true },
              orderBy: { precio: 'asc' },
            },
            reservas: checkInDate && checkOutDate
              ? {
                  where: {
                    estado: { in: ['pending_payment', 'confirmed', 'checked_in'] },
                    fechaInicio: { lt: checkOutDate },
                    fechaFin: { gt: checkInDate },
                  },
                }
              : false,
            bloqueos: checkInDate && checkOutDate
              ? {
                  where: {
                    fechaInicio: { lt: checkOutDate },
                    fechaFin: { gt: checkInDate },
                  },
                }
              : false,
          },
          orderBy: { orden: 'asc' },
        },
      },
    })

    if (!a) {
      throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Alojamiento no encontrado')
    }

    // Calcular fotos generales de fallback
    const fotosGeneralesFallback: FotoUnidadConFallback[] = a.imagenes.map((img) => ({
      url: img.url,
      alt: img.alt ?? 'Foto general del alojamiento',
      esPrincipal: img.esPrincipal,
      esFotoGeneralFallback: true,
    }))

    const unidadesDTO: UnidadDisponibleDTO[] = []

    for (const u of a.unidades) {
      // Verificar disponibilidad física
      let disponible = u.estado === 'activa'
      if (disponible && checkInDate && checkOutDate) {
        const reservasActivas = u.reservas.filter((r) => {
          if (r.estado === 'pending_payment') {
            return r.holdExpiracion && r.holdExpiracion > ahora
          }
          return true
        })
        if (reservasActivas.length > 0 || (u.bloqueos && u.bloqueos.length > 0)) {
          disponible = false
        }
      }

      // Fotos: fotos propias si tiene, sino fotos generales del alojamiento
      let imagenesFinales: FotoUnidadConFallback[] = []
      if (u.imagenes && u.imagenes.length > 0) {
        imagenesFinales = u.imagenes.map((img) => ({
          url: img.url,
          alt: img.alt,
          esPrincipal: img.esPrincipal,
          esFotoGeneralFallback: false,
        }))
      } else {
        // Fallback a fotos generales
        imagenesFinales = fotosGeneralesFallback
      }

      // Cálculo de precio
      let precioCalculado: UnidadDisponibleDTO['precioCalculado'] = null
      if (checkInDate && checkOutDate) {
        const diffMs = checkOutDate.getTime() - checkInDate.getTime()
        const diffHoras = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)))
        const diffNoches = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))

        let mejorTarifa: {
          total: number
          precioPorUnidad: number
          modalidad: ModalidadTarifaAlojamiento
          duracionHoras?: number
          cantidadPeriodos: number
        } | null = null

        for (const t of u.tarifas) {
          if (t.modalidad === 'por_hora' || t.modalidad === 'bloque_horas') {
            const horasTarifa = t.duracionHoras ?? 1
            const periodos = Math.ceil(diffHoras / horasTarifa)
            const total = Number(t.precio) * periodos
            if (!mejorTarifa || total < mejorTarifa.total) {
              mejorTarifa = {
                total,
                precioPorUnidad: Number(t.precio),
                modalidad: t.modalidad as ModalidadTarifaAlojamiento,
                duracionHoras: horasTarifa,
                cantidadPeriodos: periodos,
              }
            }
          } else if (t.modalidad === 'noche' || t.modalidad === 'dia') {
            if (diffNoches < t.minimoEstadia) continue
            if (t.maximoEstadia && diffNoches > t.maximoEstadia) continue
            const total = Number(t.precio) * diffNoches
            if (!mejorTarifa || total < mejorTarifa.total) {
              mejorTarifa = {
                total,
                precioPorUnidad: Number(t.precio),
                modalidad: t.modalidad as ModalidadTarifaAlojamiento,
                cantidadPeriodos: diffNoches,
              }
            }
          } else if (t.modalidad === 'semana') {
            const semanas = Math.ceil(diffNoches / 7)
            const total = Number(t.precio) * semanas
            if (!mejorTarifa || total < mejorTarifa.total) {
              mejorTarifa = {
                total,
                precioPorUnidad: Number(t.precio),
                modalidad: 'semana',
                cantidadPeriodos: semanas,
              }
            }
          }
        }

        if (mejorTarifa) {
          precioCalculado = {
            ...mejorTarifa,
            moneda: 'ARS',
          }
        }
      }

      unidadesDTO.push({
        id: u.id,
        nombre: u.nombre,
        descripcion: u.descripcion,
        capacidadPersonas: u.capacidadPersonas,
        camasDetalle: u.camasDetalle,
        banosCantidad: u.banosCantidad,
        comodidades: u.comodidades,
        imagenes: imagenesFinales,
        precioCalculado,
        disponible,
      })
    }

    return {
      id: a.id,
      propietarioId: a.propietarioId,
      nombre: a.nombre,
      slug: a.slug,
      tipo: {
        id: a.tipo.id,
        slug: a.tipo.slug,
        nombre: a.tipo.nombre,
      },
      descripcion: a.descripcion,
      direccion: a.direccion,
      latitud: a.latitud,
      longitud: a.longitud,
      barrioNombre: a.barrio?.nombre ?? null,
      zonaNombre: a.zona?.nombre ?? null,
      checkInHora: a.checkInHora,
      checkOutHora: a.checkOutHora,
      politicas: a.politicas,
      rating: a.ratingPromedio
        ? { average: Math.round(a.ratingPromedio * 10) / 10, count: a.ratingCantidad }
        : null,
      precioDesde: null,
      imagenes: a.imagenes.map((img) => ({
        id: img.id,
        alojamientoId: img.alojamientoId,
        url: img.url,
        alt: img.alt,
        categoria: img.categoria,
        orden: img.orden,
        esPrincipal: img.esPrincipal,
      })),
      unidadesContador: unidadesDTO.filter((u) => u.disponible).length,
      comodidades: a.comodidades,
      unidades: unidadesDTO,
    }
  }

  /**
   * Crea un hold de reserva garantizado físicamente por PostgreSQL 16 con btree_gist.
   * Si dos clientes intentan reservar la misma unidad en un período solapado,
   * exactamente uno tiene éxito y el segundo recibe 409 CONFLICT.
   */
  async crearHoldReserva(input: CrearHoldReservaInput): Promise<ReservaAlojamientoDTO> {
    const inicio = new Date(input.fechaInicio)
    const fin = new Date(input.fechaFin)

    if (isNaN(inicio.getTime()) || isNaN(fin.getTime()) || inicio >= fin) {
      throw new ErrorAlojamiento(400, 'BAD_REQUEST', 'Rango de fechas o fechas inválidas')
    }

    const ahora = new Date()

    const unidad = await this.prisma.unidadAlojamiento.findUnique({
      where: { id: input.unidadId },
      include: {
        alojamiento: true,
        tarifas: { where: { activa: true } },
      },
    })

    if (!unidad || unidad.estado !== 'activa') {
      throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Unidad no encontrada o inactiva')
    }

    // Verificar si hay bloqueo manual
    const bloqueosSolapados = await this.prisma.bloqueoUnidadAlojamiento.findMany({
      where: {
        unidadId: input.unidadId,
        fechaInicio: { lt: fin },
        fechaFin: { gt: inicio },
      },
    })

    if (bloqueosSolapados.length > 0) {
      throw new ErrorAlojamiento(409, 'UNIT_BLOCKED', 'La unidad se encuentra bloqueada por mantenimiento o administración')
    }

    // Calcular precio y tarifa aplicable
    const diffMs = fin.getTime() - inicio.getTime()
    const diffHoras = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)))
    const diffNoches = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)))

    let tarifaSeleccionada = unidad.tarifas.find((t) => t.id === input.tarifaId)
    if (!tarifaSeleccionada) {
      // Buscar la tarifa más adecuada por modalidad
      if (input.modalidad) {
        tarifaSeleccionada = unidad.tarifas.find((t) => t.modalidad === input.modalidad)
      } else {
        tarifaSeleccionada = unidad.tarifas[0]
      }
    }

    if (!tarifaSeleccionada) {
      throw new ErrorAlojamiento(400, 'NO_TARIFF', 'No hay tarifas disponibles para esta unidad')
    }

    let precioCalculado = 0
    const mod = tarifaSeleccionada.modalidad as ModalidadTarifaAlojamiento

    if (mod === 'por_hora' || mod === 'bloque_horas') {
      const cantHoras = tarifaSeleccionada.duracionHoras ?? 1
      const bloques = Math.ceil(diffHoras / cantHoras)
      precioCalculado = Number(tarifaSeleccionada.precio) * bloques
    } else if (mod === 'dia' || mod === 'noche') {
      if (diffNoches < tarifaSeleccionada.minimoEstadia) {
        throw new ErrorAlojamiento(
          400,
          'MIN_STAY_NOT_MET',
          `La estadía mínima para esta tarifa es de ${tarifaSeleccionada.minimoEstadia} noche(s)`
        )
      }
      if (tarifaSeleccionada.maximoEstadia && diffNoches > tarifaSeleccionada.maximoEstadia) {
        throw new ErrorAlojamiento(
          400,
          'MAX_STAY_EXCEEDED',
          `La estadía máxima para esta tarifa es de ${tarifaSeleccionada.maximoEstadia} noche(s)`
        )
      }
      precioCalculado = Number(tarifaSeleccionada.precio) * diffNoches
    } else if (mod === 'semana') {
      const semanas = Math.ceil(diffNoches / 7)
      precioCalculado = Number(tarifaSeleccionada.precio) * semanas
    }

    const reservaId = `res-aloj-${randomUUID()}`
    const holdExpiracion = new Date(ahora.getTime() + 15 * 60 * 1000) // 15 minutos de hold

    try {
      const reserva = await this.prisma.reservaAlojamiento.create({
        data: {
          id: reservaId,
          unidadId: input.unidadId,
          alojamientoId: unidad.alojamientoId,
          clienteId: input.clienteId ?? null,
          clienteNombre: input.clienteNombre,
          clienteEmail: input.clienteEmail ?? null,
          clienteTelefono: input.clienteTelefono ?? null,
          esInvitado: !input.clienteId,
          fechaInicio: inicio,
          fechaFin: fin,
          modalidad: mod,
          cantidadPersonas: input.cantidadPersonas ?? 1,
          tarifaId: tarifaSeleccionada.id,
          precioListaSnapshot: BigInt(precioCalculado),
          precioFinalSnapshot: BigInt(precioCalculado),
          moneda: 'ARS',
          estado: 'pending_payment',
          holdExpiracion,
          notas: input.notas ?? null,
          creadoEn: ahora,
          actualizadoEn: ahora,
        },
      })

      return {
        id: reserva.id,
        unidadId: reserva.unidadId,
        unidadNombre: unidad.nombre,
        alojamientoId: reserva.alojamientoId,
        alojamientoNombre: unidad.alojamiento.nombre,
        clienteId: reserva.clienteId,
        clienteNombre: reserva.clienteNombre,
        clienteEmail: reserva.clienteEmail,
        clienteTelefono: reserva.clienteTelefono,
        esInvitado: reserva.esInvitado,
        fechaInicio: reserva.fechaInicio.toISOString(),
        fechaFin: reserva.fechaFin.toISOString(),
        modalidad: reserva.modalidad as ModalidadTarifaAlojamiento,
        cantidadPersonas: reserva.cantidadPersonas,
        tarifaId: reserva.tarifaId,
        precioListaSnapshot: Number(reserva.precioListaSnapshot),
        precioFinalSnapshot: Number(reserva.precioFinalSnapshot),
        moneda: reserva.moneda,
        estado: reserva.estado as any,
        holdExpiracion: reserva.holdExpiracion ? reserva.holdExpiracion.toISOString() : null,
        paymentId: reserva.paymentId,
        preferenceId: reserva.preferenceId,
        metodoPago: reserva.metodoPago,
        notas: reserva.notas,
        createdAt: (reserva.creadoEn ?? ahora).toISOString(),
      }
    } catch (error: unknown) {
      const errStr = String(error)
      // Captura física de violación de exclusión GiST o deadlock
      if (
        errStr.includes('ex_reservas_alojamiento_sin_solapamiento') ||
        errStr.includes('23P01') ||
        errStr.includes('40P01') ||
        errStr.includes('P2002')
      ) {
        throw new ErrorAlojamiento(
          409,
          'SLOT_OCCUPIED',
          'La unidad seleccionada ya fue reservada o retenida por otro usuario en las mismas fechas.'
        )
      }
      throw error
    }
  }

  /**
   * Confirma una reserva de alojamiento tras procesar pago.
   */
  async confirmarReserva(input: ConfirmarReservaInput): Promise<ReservaAlojamientoDTO> {
    const reserva = await this.prisma.reservaAlojamiento.findUnique({
      where: { id: input.reservaId },
      include: { unidad: { include: { alojamiento: true } } },
    })

    if (!reserva) {
      throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Reserva no encontrada')
    }

    if (reserva.estado === 'confirmed') {
      // Idempotencia: ya confirmada
      return {
        id: reserva.id,
        unidadId: reserva.unidadId,
        unidadNombre: reserva.unidad.nombre,
        alojamientoId: reserva.alojamientoId,
        alojamientoNombre: reserva.unidad.alojamiento.nombre,
        clienteId: reserva.clienteId,
        clienteNombre: reserva.clienteNombre,
        clienteEmail: reserva.clienteEmail,
        clienteTelefono: reserva.clienteTelefono,
        esInvitado: reserva.esInvitado,
        fechaInicio: reserva.fechaInicio.toISOString(),
        fechaFin: reserva.fechaFin.toISOString(),
        modalidad: reserva.modalidad as ModalidadTarifaAlojamiento,
        cantidadPersonas: reserva.cantidadPersonas,
        tarifaId: reserva.tarifaId,
        precioListaSnapshot: Number(reserva.precioListaSnapshot),
        precioFinalSnapshot: Number(reserva.precioFinalSnapshot),
        moneda: reserva.moneda,
        estado: 'confirmed',
        holdExpiracion: null,
        paymentId: reserva.paymentId,
        preferenceId: reserva.preferenceId,
        metodoPago: reserva.metodoPago,
        notas: reserva.notas,
        createdAt: reserva.creadoEn.toISOString(),
      }
    }

    if (reserva.estado !== 'pending_payment') {
      throw new ErrorAlojamiento(400, 'INVALID_STATE', `No se puede confirmar una reserva en estado ${reserva.estado}`)
    }

    const updated = await this.prisma.reservaAlojamiento.update({
      where: { id: input.reservaId },
      data: {
        estado: 'confirmed',
        holdExpiracion: null,
        paymentId: input.paymentId,
        preferenceId: input.preferenceId ?? reserva.preferenceId,
        metodoPago: input.metodoPago ?? 'mercadopago',
      },
      include: { unidad: { include: { alojamiento: true } } },
    })

    return {
      id: updated.id,
      unidadId: updated.unidadId,
      unidadNombre: updated.unidad.nombre,
      alojamientoId: updated.alojamientoId,
      alojamientoNombre: updated.unidad.alojamiento.nombre,
      clienteId: updated.clienteId,
      clienteNombre: updated.clienteNombre,
      clienteEmail: updated.clienteEmail,
      clienteTelefono: updated.clienteTelefono,
      esInvitado: updated.esInvitado,
      fechaInicio: updated.fechaInicio.toISOString(),
      fechaFin: updated.fechaFin.toISOString(),
      modalidad: updated.modalidad as ModalidadTarifaAlojamiento,
      cantidadPersonas: updated.cantidadPersonas,
      tarifaId: updated.tarifaId,
      precioListaSnapshot: Number(updated.precioListaSnapshot),
      precioFinalSnapshot: Number(updated.precioFinalSnapshot),
      moneda: updated.moneda,
      estado: 'confirmed',
      holdExpiracion: null,
      paymentId: updated.paymentId,
      preferenceId: updated.preferenceId,
      metodoPago: updated.metodoPago,
      notas: updated.notas,
      createdAt: (updated.creadoEn ?? new Date()).toISOString(),
    }
  }

  /**
   * Libera holds de reservas expirados para devolver inventario disponible.
   */
  async liberarHoldsExpirados(): Promise<number> {
    const ahora = new Date()
    const result = await this.prisma.reservaAlojamiento.updateMany({
      where: {
        estado: 'pending_payment',
        holdExpiracion: { lt: ahora },
      },
      data: {
        estado: 'expired',
      },
    })
    return result.count
  }

  /**
   * Califica un alojamiento (solo con reserva completed).
   */
  async calificarAlojamiento(input: CalificarAlojamientoInput & { clienteId?: string }): Promise<void> {
    if (input.puntuacion < 1 || input.puntuacion > 5) {
      throw new ErrorAlojamiento(400, 'INVALID_RATING', 'La puntuación debe ser entre 1 y 5')
    }

    const reserva = await this.prisma.reservaAlojamiento.findUnique({
      where: { id: input.reservaId },
      include: { calificacion: true },
    })

    if (!reserva) {
      throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Reserva no encontrada')
    }

    if (reserva.estado !== 'completed') {
      throw new ErrorAlojamiento(
        400,
        'NOT_COMPLETED',
        'Solo se puede calificar un alojamiento tras haber completado la estadía'
      )
    }

    if (reserva.calificacion) {
      throw new ErrorAlojamiento(400, 'ALREADY_RATED', 'Esta reserva ya fue calificada previamente')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.calificacionAlojamiento.create({
        data: {
          id: `calif-${randomUUID()}`,
          reservaId: input.reservaId,
          alojamientoId: reserva.alojamientoId,
          clienteId: input.clienteId ?? reserva.clienteId,
          puntuacion: input.puntuacion,
          comentario: input.comentario ?? null,
        },
      })

      // Recalcular promedio y cantidad
      const calificaciones = await tx.calificacionAlojamiento.findMany({
        where: { alojamientoId: reserva.alojamientoId },
        select: { puntuacion: true },
      })

      const cantidad = calificaciones.length
      const suma = calificaciones.reduce((acc, c) => acc + c.puntuacion, 0)
      const promedio = cantidad > 0 ? suma / cantidad : null

      await tx.alojamiento.update({
        where: { id: reserva.alojamientoId },
        data: {
          ratingPromedio: promedio,
          ratingCantidad: cantidad,
        },
      })
    })
  }

  /**
   * Autoridad sobre un alojamiento, una unidad o una reserva: quién es el propietario registrado
   * y, en la reserva, quién es el cliente titular. La capa HTTP autoriza con estos datos; nunca
   * con un id de propietario o de cliente enviado por el navegador. null = el recurso no existe.
   */
  async propietarioDeAlojamiento(alojamientoId: string): Promise<{ propietarioId: string | null } | null> {
    const fila = await this.prisma.alojamiento.findUnique({
      where: { id: alojamientoId },
      select: { propietarioId: true },
    })
    return fila ? { propietarioId: fila.propietarioId } : null
  }

  async propietarioDeUnidad(unidadId: string): Promise<{ propietarioId: string | null } | null> {
    const fila = await this.prisma.unidadAlojamiento.findUnique({
      where: { id: unidadId },
      select: { alojamiento: { select: { propietarioId: true } } },
    })
    return fila ? { propietarioId: fila.alojamiento.propietarioId } : null
  }

  async titularidadDeReserva(
    reservaId: string
  ): Promise<{ clienteId: string | null; propietarioId: string | null } | null> {
    const fila = await this.prisma.reservaAlojamiento.findUnique({
      where: { id: reservaId },
      select: { clienteId: true, alojamiento: { select: { propietarioId: true } } },
    })
    return fila ? { clienteId: fila.clienteId, propietarioId: fila.alojamiento.propietarioId } : null
  }

  /**
   * Bloqueo manual de unidad (Admin o Propietario).
   */
  async crearBloqueoUnidad(input: BloqueoUnidadInput): Promise<{ id: string }> {
    const inicio = new Date(input.fechaInicio)
    const fin = new Date(input.fechaFin)

    const bloqueo = await this.prisma.bloqueoUnidadAlojamiento.create({
      data: {
        id: `blk-${randomUUID()}`,
        unidadId: input.unidadId,
        fechaInicio: inicio,
        fechaFin: fin,
        motivo: input.motivo,
        creadoPorUsuarioId: input.creadoPorUsuarioId ?? null,
      },
    })

    return { id: bloqueo.id }
  }

  /**
   * Admin / Propietario: Obtener reservas de un alojamiento.
   */
  async listarReservasAlojamiento(alojamientoId: string): Promise<ReservaAlojamientoDTO[]> {
    const rows = await this.prisma.reservaAlojamiento.findMany({
      where: { alojamientoId },
      include: { unidad: { include: { alojamiento: true } } },
      orderBy: { fechaInicio: 'desc' },
    })

    return rows.map((r) => ({
      id: r.id,
      unidadId: r.unidadId,
      unidadNombre: r.unidad.nombre,
      alojamientoId: r.alojamientoId,
      alojamientoNombre: r.unidad.alojamiento.nombre,
      clienteId: r.clienteId,
      clienteNombre: r.clienteNombre,
      clienteEmail: r.clienteEmail,
      clienteTelefono: r.clienteTelefono,
      esInvitado: r.esInvitado,
      fechaInicio: r.fechaInicio.toISOString(),
      fechaFin: r.fechaFin.toISOString(),
      modalidad: r.modalidad as ModalidadTarifaAlojamiento,
      cantidadPersonas: r.cantidadPersonas,
      tarifaId: r.tarifaId,
      precioListaSnapshot: Number(r.precioListaSnapshot),
      precioFinalSnapshot: Number(r.precioFinalSnapshot),
      moneda: r.moneda,
      estado: r.estado as any,
      holdExpiracion: r.holdExpiracion ? r.holdExpiracion.toISOString() : null,
      paymentId: r.paymentId,
      preferenceId: r.preferenceId,
      metodoPago: r.metodoPago,
      notas: r.notas,
      createdAt: (r.creadoEn ?? new Date()).toISOString(),
    }))
  }

  /**
   * Admin / Propietario: Actualiza el estado de una reserva (ej. check-in, complete, cancel).
   */
  async actualizarEstadoReserva(
    reservaId: string,
    nuevoEstado: 'checked_in' | 'completed' | 'cancelled'
  ): Promise<void> {
    await this.prisma.reservaAlojamiento.update({
      where: { id: reservaId },
      data: { estado: nuevoEstado },
    })
  }

  /**
   * Admin / Propietario: Crear un alojamiento completo o ficticio de pruebas.
   */
  async crearAlojamiento(input: {
    propietarioId?: string
    tipoId: string
    nombre: string
    slug: string
    descripcion?: string
    direccion: string
    latitud: number
    longitud: number
    barrioId?: string
    zonaId?: string
    checkInHora?: string
    checkOutHora?: string
    politicas?: string
    comodidades?: string[]
    publicado?: boolean
  }): Promise<{ id: string; slug: string }> {
    const id = `aloj-${randomUUID()}`
    const nuevo = await this.prisma.alojamiento.create({
      data: {
        id,
        propietarioId: input.propietarioId ?? null,
        tipoId: input.tipoId,
        nombre: input.nombre,
        slug: input.slug,
        descripcion: input.descripcion ?? null,
        direccion: input.direccion,
        latitud: input.latitud,
        longitud: input.longitud,
        barrioId: input.barrioId ?? null,
        zonaId: input.zonaId ?? null,
        checkInHora: input.checkInHora ?? '14:00',
        checkOutHora: input.checkOutHora ?? '10:00',
        politicas: input.politicas ?? null,
        comodidades: input.comodidades ?? [],
        publicado: input.publicado ?? true,
        estado: 'publicado',
      },
    })

    return { id: nuevo.id, slug: nuevo.slug }
  }

  /**
   * Admin / Propietario: Agregar unidad a un alojamiento.
   */
  async crearUnidad(input: {
    alojamientoId: string
    nombre: string
    descripcion?: string
    capacidadPersonas?: number
    camasDetalle?: string
    banosCantidad?: number
    comodidades?: string[]
  }): Promise<{ id: string }> {
    const id = `uni-${randomUUID()}`
    const unidad = await this.prisma.unidadAlojamiento.create({
      data: {
        id,
        alojamientoId: input.alojamientoId,
        nombre: input.nombre,
        descripcion: input.descripcion ?? null,
        capacidadPersonas: input.capacidadPersonas ?? 2,
        camasDetalle: input.camasDetalle ?? null,
        banosCantidad: input.banosCantidad ?? 1,
        comodidades: input.comodidades ?? [],
        estado: 'activa',
      },
    })
    return { id: unidad.id }
  }

  /**
   * Admin / Propietario: Agregar tarifa a una unidad.
   */
  async crearTarifa(input: {
    unidadId: string
    modalidad?: ModalidadTarifaAlojamiento
    duracionHoras?: number
    precio: number
    moneda?: string
    diasSemana?: number[]
    minimoEstadia?: number
    maximoEstadia?: number
  }): Promise<{ id: string }> {
    const id = `tar-${randomUUID()}`
    const tarifa = await this.prisma.tarifaAlojamiento.create({
      data: {
        id,
        unidadId: input.unidadId,
        modalidad: input.modalidad ?? 'noche',
        duracionHoras: input.duracionHoras ?? null,
        precio: BigInt(input.precio),
        moneda: input.moneda ?? 'ARS',
        diasSemana: input.diasSemana ?? [0, 1, 2, 3, 4, 5, 6],
        minimoEstadia: input.minimoEstadia ?? 1,
        maximoEstadia: input.maximoEstadia ?? null,
        activa: true,
      },
    })
    return { id: tarifa.id }
  }

  /**
   * Admin / Propietario: Agregar imagen (alojamiento o unidad).
   */
  async agregarImagen(input: {
    alojamientoId?: string
    unidadId?: string
    url: string
    alt?: string
    categoria?: string
    orden?: number
    esPrincipal?: boolean
  }): Promise<{ id: string }> {
    const id = `img-${randomUUID()}`
    if (input.unidadId) {
      const img = await this.prisma.imagenUnidadAlojamiento.create({
        data: {
          id,
          unidadId: input.unidadId,
          url: input.url,
          alt: input.alt ?? null,
          orden: input.orden ?? 0,
          esPrincipal: input.esPrincipal ?? false,
        },
      })
      return { id: img.id }
    }

    if (input.alojamientoId) {
      const img = await this.prisma.imagenAlojamiento.create({
        data: {
          id,
          alojamientoId: input.alojamientoId,
          url: input.url,
          alt: input.alt ?? null,
          categoria: input.categoria ?? 'general',
          orden: input.orden ?? 0,
          esPrincipal: input.esPrincipal ?? false,
        },
      })
      return { id: img.id }
    }

    throw new ErrorAlojamiento(400, 'BAD_REQUEST', 'Debe especificar alojamientoId o unidadId')
  }
}
