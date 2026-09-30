import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import type {
  DetalleTurno,
  SlotDisponible,
  TarifaServicioPublica,
} from '@factory/contracts'
import { ErrorCalendario } from './bookings.ts'
import { toMinutes } from './rules.ts'

export interface EntradaReservaTurno {
  prestadorId: string
  oficioId: string
  tarifaId?: string
  inicio: string
  clienteId?: string
  clienteTenantId?: string
  clienteNombre?: string
  clienteTelefono?: string
  clienteEmail?: string
  notas?: string
}

export interface EntradaTurnoManual {
  prestadorTenantId: string
  oficioId: string
  tarifaId?: string
  inicio: string
  fin?: string
  duracionMinutos?: number
  precioFinal?: bigint
  clienteNombre: string
  clienteTelefono?: string
  clienteEmail?: string
  notas?: string
}

export interface EntradaAdminForzarTurno {
  prestadorId: string
  oficioId: string
  inicio: string
  fin?: string
  duracionMinutos?: number
  precioFinal?: bigint
  clienteNombre: string
  clienteTelefono?: string
  clienteEmail?: string
  motivoForzado: string
  adminId: string
  notas?: string
}

export interface ReglaHorarioInput {
  diaSemana: number
  horaInicio: string
  horaFin: string
  capacidad?: number
}

export interface ExcepcionHorarioInput {
  fechaInicio: string
  fechaFin: string
  motivo: string
}

export class ServicioTurnos {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Obtiene o crea el calendario principal del prestador.
   */
  async asegurarCalendarioPrestador(tenantId: string, prestadorId: string) {
    let calendario = await this.prisma.calendario.findUnique({
      where: { tenantId_prestadorId: { tenantId, prestadorId } },
    })

    if (!calendario) {
      const now = new Date()
      calendario = await this.prisma.calendario.create({
        data: {
          id: `cal-${randomUUID()}`,
          tenantId,
          prestadorId,
          nombre: `Agenda de Turnos`,
          zonaHoraria: 'America/Argentina/Buenos_Aires',
          estado: 'active',
          granularidadMinutos: 15,
          bufferMinutos: 0,
          fechaCreacion: now,
          fechaActualizacion: now,
        },
      })

      // Reglas por defecto: Lunes (1) a Viernes (5), 09:00 a 18:00
      const reglas = [1, 2, 3, 4, 5].map((dia) => ({
        id: `reg-${calendario!.id}-${dia}-09-18`,
        tenantId,
        calendarioId: calendario!.id,
        diaSemana: dia,
        horaInicio: '09:00',
        horaFin: '18:00',
        capacidad: 1,
        fechaCreacion: now,
        fechaActualizacion: now,
      }))

      await this.prisma.reglaCalendario.createMany({ data: reglas })
    }

    return calendario
  }

  /**
   * Consulta slots disponibles y tarifas para un prestador y servicio en una fecha.
   */
  async disponibilidadPublica(input: {
    prestadorId: string
    oficioId: string
    fecha: string // YYYY-MM-DD
    duracionMinutos?: number
  }): Promise<{
    slots: SlotDisponible[]
    duracionMinutos: number
    tarifas: TarifaServicioPublica[]
    mensaje?: string
  }> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: {
        OR: [{ id: input.prestadorId }, { prestadorId: input.prestadorId }],
      },
      include: {
        servicios: { where: { oficioId: input.oficioId } },
        tarifas: { where: { oficioId: input.oficioId, activo: true }, orderBy: { orden: 'asc' } },
      },
    })

    if (!perfil || !perfil.visible) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado o no disponible')
    }

    if (!perfil.aceptaTurnos) {
      return {
        slots: [],
        duracionMinutos: 0,
        tarifas: [],
        mensaje: 'Este profesional no tiene habilitada la reserva de turnos online.',
      }
    }

    const servicioConfig = perfil.servicios[0]
    if (servicioConfig && !servicioConfig.turnosHabilitados) {
      return {
        slots: [],
        duracionMinutos: 0,
        tarifas: [],
        mensaje: 'Este servicio en particular solo se atiende por solicitud.',
      }
    }

    const tarifasPublicas: TarifaServicioPublica[] = perfil.tarifas.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      duracionMinutos: t.duracionMinutos,
      precio: Number(t.precio),
      moneda: 'ARS',
    }))

    const duracion =
      input.duracionMinutos ??
      tarifasPublicas[0]?.duracionMinutos ??
      servicioConfig?.duracionMinutos ??
      60

    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)

    // Día de la semana en zona horaria local de Argentina (0=Domingo..6=Sábado)
    const [y, m, d] = input.fecha.split('-').map(Number)
    const fechaObj = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0))
    const diaSemana = fechaObj.getUTCDay()

    const reglas = await this.prisma.reglaCalendario.findMany({
      where: { calendarioId: calendario.id, diaSemana },
    })

    if (reglas.length === 0) {
      return { slots: [], duracionMinutos: duracion, tarifas: tarifasPublicas }
    }

    const inicioDia = new Date(`${input.fecha}T00:00:00.000-03:00`)
    const finDia = new Date(`${input.fecha}T23:59:59.999-03:00`)

    // Excepciones / bloqueos que solapen este día
    const excepciones = await this.prisma.excepcionCalendario.findMany({
      where: {
        calendarioId: calendario.id,
        estado: 'active',
        fechaInicio: { lte: finDia },
        fechaFin: { gte: inicioDia },
      },
    })

    // Reservas existentes
    const reservasExistentes = await this.prisma.reserva.findMany({
      where: {
        calendarioId: calendario.id,
        estado: { notIn: ['cancelled', 'cancelled-late', 'no-show'] },
        fechaInicio: { lte: finDia },
        fechaFin: { gte: inicioDia },
      },
    })

    const now = Date.now()
    const slots: SlotDisponible[] = []
    const step = calendario.granularidadMinutos || 15
    const buffer = servicioConfig?.bufferMinutos ?? calendario.bufferMinutos ?? 0

    for (const regla of reglas) {
      const minInicio = toMinutes(regla.horaInicio)
      const minFin = toMinutes(regla.horaFin)

      for (let min = minInicio; min + duracion <= minFin; min += step) {
        const slotInicio = new Date(`${input.fecha}T00:00:00.000-03:00`)
        slotInicio.setMinutes(min)
        const slotFin = new Date(slotInicio.getTime() + duracion * 60_000)

        // No ofrecer turnos en el pasado
        if (slotInicio.getTime() <= now) continue

        // Verificar colisión con excepciones
        const hayExcepcion = excepciones.some(
          (ex) => slotInicio < ex.fechaFin && slotFin > ex.fechaInicio
        )
        if (hayExcepcion) continue

        // Verificar colisión con reservas existentes
        const hayReserva = reservasExistentes.some((res) => {
          const resInicio = new Date(res.fechaInicio)
          const resFinConBuffer = new Date(res.fechaFin.getTime() + buffer * 60_000)
          return slotInicio < resFinConBuffer && slotFin > resInicio
        })
        if (hayReserva) continue

        slots.push({
          inicio: slotInicio.toISOString(),
          fin: slotFin.toISOString(),
          duracionMinutos: duracion,
          disponible: true,
        })
      }
    }

    return {
      slots,
      duracionMinutos: duracion,
      tarifas: tarifasPublicas,
    }
  }

  /**
   * Reserva un turno con snapshot de tarifa y protección de concurrencia física.
   */
  async reservarTurno(input: EntradaReservaTurno): Promise<DetalleTurno> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: {
        OR: [{ id: input.prestadorId }, { prestadorId: input.prestadorId }],
      },
      include: {
        servicios: { where: { oficioId: input.oficioId } },
        tarifas: { where: { oficioId: input.oficioId, activo: true } },
      },
    })

    if (!perfil || !perfil.visible) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado o no visible')
    }

    if (!perfil.aceptaTurnos) {
      throw new ErrorCalendario(400, 'TURNOS_DISABLED', 'El prestador no acepta reservas online')
    }

    const servicioConfig = perfil.servicios[0]
    if (servicioConfig && !servicioConfig.turnosHabilitados) {
      throw new ErrorCalendario(400, 'SERVICE_TURNOS_DISABLED', 'Este servicio no admite turnos')
    }

    let tarifa = input.tarifaId ? perfil.tarifas.find((t) => t.id === input.tarifaId) : null
    if (!tarifa && perfil.tarifas.length > 0) {
      tarifa = perfil.tarifas[0]
    }

    const duracion = tarifa?.duracionMinutos ?? servicioConfig?.duracionMinutos ?? 60
    const precio = tarifa?.precio ?? servicioConfig?.precioBase ?? 0n

    const inicio = new Date(input.inicio)
    if (isNaN(inicio.getTime())) {
      throw new ErrorCalendario(400, 'INVALID_DATE', 'Fecha de inicio inválida')
    }
    const fin = new Date(inicio.getTime() + duracion * 60_000)

    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)

    const reservaId = `res-${randomUUID()}`
    const now = new Date()

    try {
      const row = await this.prisma.reserva.create({
        data: {
          id: reservaId,
          tenantId: perfil.tenantId,
          clienteTenantId: input.clienteTenantId ?? null,
          reservaId,
          servicioId: input.oficioId,
          calendarioId: calendario.id,
          clienteId: input.clienteId ?? 'invitado',
          fechaInicio: inicio,
          fechaFin: fin,
          estado: 'confirmed',
          version: 1,
          fechaCreacion: now,
          fechaActualizacion: now,
          tarifaId: tarifa?.id ?? null,
          tarifaNombre: tarifa?.nombre ?? null,
          duracionMinutos: duracion,
          precioLista: precio,
          precioFinal: precio,
          moneda: 'ARS',
          clienteNombre: input.clienteNombre ?? null,
          clienteTelefono: input.clienteTelefono ?? null,
          clienteEmail: input.clienteEmail ?? null,
          esInvitado: !input.clienteId,
          notas: input.notas ?? null,
        },
      })

      return this.mapearDetalleTurno(row, perfil.nombrePublico)
    } catch (error: unknown) {
      const errStr = String(error)
      // Captura de violación de exclusión física PostgreSQL o unique key
      if (
        errStr.includes('ex_reservas_sin_solapamiento') ||
        errStr.includes('23P01') ||
        errStr.includes('40P01') ||
        errStr.includes('P2002')
      ) {
        throw new ErrorCalendario(
          409,
          'SLOT_OCCUPIED',
          'El horario seleccionado ya fue reservado. Por favor elegí otro horario.'
        )
      }
      throw error
    }
  }

  /**
   * Lista turnos del prestador autenticado.
   */
  async turnosPrestador(input: {
    prestadorTenantId: string
    desde?: string
    hasta?: string
    estado?: string
  }): Promise<DetalleTurno[]> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: { tenantId: input.prestadorTenantId },
    })

    const where: Record<string, unknown> = {
      tenantId: input.prestadorTenantId,
    }

    if (input.estado) {
      where['estado'] = input.estado
    }
    if (input.desde || input.hasta) {
      const fechaFilter: Record<string, unknown> = {}
      if (input.desde) fechaFilter['gte'] = new Date(input.desde)
      if (input.hasta) fechaFilter['lte'] = new Date(input.hasta)
      where['fechaInicio'] = fechaFilter
    }

    const rows = await this.prisma.reserva.findMany({
      where,
      orderBy: { fechaInicio: 'asc' },
    })

    return rows.map((r) => this.mapearDetalleTurno(r, perfil?.nombrePublico ?? 'Prestador'))
  }

  /**
   * Crea un turno manual ingresado directamente por el prestador (ej. cliente presencial).
   */
  async crearTurnoManual(input: EntradaTurnoManual): Promise<DetalleTurno> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: { tenantId: input.prestadorTenantId },
      include: {
        servicios: { where: { oficioId: input.oficioId } },
        tarifas: { where: { oficioId: input.oficioId, activo: true } },
      },
    })

    if (!perfil) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
    }

    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)

    let tarifa = input.tarifaId ? perfil.tarifas.find((t) => t.id === input.tarifaId) : null
    const duracion =
      input.duracionMinutos ??
      tarifa?.duracionMinutos ??
      perfil.servicios[0]?.duracionMinutos ??
      60
    const precio = input.precioFinal ?? tarifa?.precio ?? perfil.servicios[0]?.precioBase ?? 0n

    const inicio = new Date(input.inicio)
    const fin = input.fin ? new Date(input.fin) : new Date(inicio.getTime() + duracion * 60_000)
    const reservaId = `res-${randomUUID()}`
    const now = new Date()

    try {
      const row = await this.prisma.reserva.create({
        data: {
          id: reservaId,
          tenantId: perfil.tenantId,
          reservaId,
          servicioId: input.oficioId,
          calendarioId: calendario.id,
          clienteId: 'manual',
          fechaInicio: inicio,
          fechaFin: fin,
          estado: 'confirmed',
          version: 1,
          fechaCreacion: now,
          fechaActualizacion: now,
          tarifaId: tarifa?.id ?? null,
          tarifaNombre: tarifa?.nombre ?? null,
          duracionMinutos: duracion,
          precioLista: precio,
          precioFinal: precio,
          moneda: 'ARS',
          clienteNombre: input.clienteNombre,
          clienteTelefono: input.clienteTelefono ?? null,
          clienteEmail: input.clienteEmail ?? null,
          esInvitado: true,
          notas: input.notas ?? null,
        },
      })

      return this.mapearDetalleTurno(row, perfil.nombrePublico)
    } catch (error: unknown) {
      const errStr = String(error)
      if (
        errStr.includes('ex_reservas_sin_solapamiento') ||
        errStr.includes('23P01') ||
        errStr.includes('40P01') ||
        errStr.includes('P2002')
      ) {
        throw new ErrorCalendario(
          409,
          'SLOT_OCCUPIED',
          'El horario seleccionado se solapa con otro turno ya existente.'
        )
      }
      throw error
    }
  }

  /**
   * Bloquea un rango horario en la agenda (crea una excepción).
   */
  async bloquearHorario(input: {
    prestadorTenantId: string
    inicio: string
    fin: string
    motivo: string
  }): Promise<{ ok: true; id: string }> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: { tenantId: input.prestadorTenantId },
    })
    if (!perfil) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado')
    }

    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)
    const id = `exc-${randomUUID()}`

    await this.prisma.excepcionCalendario.create({
      data: {
        id,
        tenantId: perfil.tenantId,
        calendarioId: calendario.id,
        fechaInicio: new Date(input.inicio),
        fechaFin: new Date(input.fin),
        motivo: input.motivo,
        estado: 'active',
        fechaCreacion: new Date(),
      },
    })

    return { ok: true, id }
  }

  /**
   * Cambia el estado de un turno (confirmado, cancelado, no-show, completado).
   */
  async cambiarEstadoTurno(input: {
    reservaId: string
    tenantId?: string
    isAdmin?: boolean
    nuevoEstado: string
    motivo?: string
  }): Promise<DetalleTurno> {
    const reserva = await this.prisma.reserva.findFirst({
      where: {
        OR: [{ id: input.reservaId }, { reservaId: input.reservaId }],
        ...(input.isAdmin ? {} : input.tenantId ? { tenantId: input.tenantId } : {}),
      },
    })

    if (!reserva) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')
    }

    const updated = await this.prisma.reserva.update({
      where: { id: reserva.id },
      data: {
        estado: input.nuevoEstado,
        notas: input.motivo ? `${reserva.notas ?? ''} [Estado: ${input.nuevoEstado} - ${input.motivo}]`.trim() : reserva.notas,
        fechaActualizacion: new Date(),
      },
    })

    return this.mapearDetalleTurno(updated, 'Prestador')
  }

  /**
   * ADMIN: Modifica el precio de un turno concreto con motivo obligatorio y registro de auditoría.
   */
  async adminModificarPrecio(input: {
    reservaId: string
    nuevoPrecio: bigint
    motivo: string
    adminId: string
  }): Promise<DetalleTurno> {
    if (!input.motivo || input.motivo.trim().length < 5) {
      throw new ErrorCalendario(
        400,
        'MOTIVO_REQUIRED',
        'El motivo de modificación de precio es obligatorio (mínimo 5 caracteres).'
      )
    }

    const reserva = await this.prisma.reserva.findFirst({
      where: {
        OR: [{ id: input.reservaId }, { reservaId: input.reservaId }],
      },
    })

    if (!reserva) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')
    }

    const updated = await this.prisma.reserva.update({
      where: { id: reserva.id },
      data: {
        precioFinal: input.nuevoPrecio,
        modificadoPorAdminId: input.adminId,
        motivoModificacionPrecio: input.motivo.trim(),
        fechaActualizacion: new Date(),
      },
    })

    return this.mapearDetalleTurno(updated, 'Prestador')
  }

  /**
   * ADMIN: Forzar turno fuera de horario normal con motivo obligatorio.
   */
  async adminForzarTurno(input: EntradaAdminForzarTurno): Promise<DetalleTurno> {
    if (!input.motivoForzado || input.motivoForzado.trim().length < 5) {
      throw new ErrorCalendario(
        400,
        'MOTIVO_REQUIRED',
        'El motivo de forzado es obligatorio (mínimo 5 caracteres).'
      )
    }

    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: {
        OR: [{ id: input.prestadorId }, { prestadorId: input.prestadorId }],
      },
      include: {
        servicios: { where: { oficioId: input.oficioId } },
      },
    })

    if (!perfil) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado')
    }

    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)

    const duracion = input.duracionMinutos ?? perfil.servicios[0]?.duracionMinutos ?? 60
    const inicio = new Date(input.inicio)
    const fin = input.fin ? new Date(input.fin) : new Date(inicio.getTime() + duracion * 60_000)
    const precio = input.precioFinal ?? perfil.servicios[0]?.precioBase ?? 0n
    const reservaId = `res-${randomUUID()}`
    const now = new Date()

    const row = await this.prisma.reserva.create({
      data: {
        id: reservaId,
        tenantId: perfil.tenantId,
        reservaId,
        servicioId: input.oficioId,
        calendarioId: calendario.id,
        clienteId: 'admin-forzado',
        fechaInicio: inicio,
        fechaFin: fin,
        estado: 'confirmed',
        version: 1,
        fechaCreacion: now,
        fechaActualizacion: now,
        duracionMinutos: duracion,
        precioLista: precio,
        precioFinal: precio,
        moneda: 'ARS',
        clienteNombre: input.clienteNombre,
        clienteTelefono: input.clienteTelefono ?? null,
        clienteEmail: input.clienteEmail ?? null,
        esInvitado: true,
        forzadoFueraHorario: true,
        motivoForzado: input.motivoForzado.trim(),
        modificadoPorAdminId: input.adminId,
        notas: input.notas ?? null,
      },
    })

    return this.mapearDetalleTurno(row, perfil.nombrePublico)
  }

  /**
   * ADMIN: Listado global paginado de turnos con filtros.
   */
  async adminListarTurnos(input: {
    prestadorId?: string
    desde?: string
    hasta?: string
    estado?: string
    pagina?: number
    tamano?: number
  }): Promise<{ items: DetalleTurno[]; total: number; pagina: number; totalPaginas: number }> {
    const pagina = Math.max(1, input.pagina ?? 1)
    const tamano = Math.min(100, Math.max(1, input.tamano ?? 20))

    const where: Record<string, unknown> = {}
    if (input.prestadorId) {
      const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
        where: { OR: [{ id: input.prestadorId }, { prestadorId: input.prestadorId }] },
      })
      if (perfil) {
        where['tenantId'] = perfil.tenantId
      }
    }
    if (input.estado) {
      where['estado'] = input.estado
    }
    if (input.desde || input.hasta) {
      const f: Record<string, unknown> = {}
      if (input.desde) f['gte'] = new Date(input.desde)
      if (input.hasta) f['lte'] = new Date(input.hasta)
      where['fechaInicio'] = f
    }

    const [total, rows] = await Promise.all([
      this.prisma.reserva.count({ where }),
      this.prisma.reserva.findMany({
        where,
        orderBy: { fechaInicio: 'desc' },
        skip: (pagina - 1) * tamano,
        take: tamano,
      }),
    ])

    return {
      items: rows.map((r) => this.mapearDetalleTurno(r, 'Prestador')),
      total,
      pagina,
      totalPaginas: Math.ceil(total / tamano),
    }
  }

  /**
   * Configuración de switches de atención de un prestador.
   */
  async actualizarSwitchesPrestador(input: {
    perfilId: string
    aceptaTurnos?: boolean
    aceptaSolicitudes?: boolean
  }) {
    return await this.prisma.perfilPublicoPrestador.update({
      where: { id: input.perfilId },
      data: {
        ...(input.aceptaTurnos !== undefined ? { aceptaTurnos: input.aceptaTurnos } : {}),
        ...(input.aceptaSolicitudes !== undefined ? { aceptaSolicitudes: input.aceptaSolicitudes } : {}),
        fechaActualizacion: new Date(),
      },
    })
  }

  /**
   * Configuración de switches y tarifas por servicio de un prestador.
   */
  async actualizarServicioPrestador(input: {
    perfilId: string
    oficioId: string
    turnosHabilitados?: boolean
    solicitudesHabilitadas?: boolean
    precioBase?: bigint
    duracionMinutos?: number
    bufferMinutos?: number
    modalidad?: string
  }) {
    return await this.prisma.perfilServicio.update({
      where: { perfilId_oficioId: { perfilId: input.perfilId, oficioId: input.oficioId } },
      data: {
        ...(input.turnosHabilitados !== undefined ? { turnosHabilitados: input.turnosHabilitados } : {}),
        ...(input.solicitudesHabilitadas !== undefined ? { solicitudesHabilitadas: input.solicitudesHabilitadas } : {}),
        ...(input.precioBase !== undefined ? { precioBase: input.precioBase } : {}),
        ...(input.duracionMinutos !== undefined ? { duracionMinutos: input.duracionMinutos } : {}),
        ...(input.bufferMinutos !== undefined ? { bufferMinutos: input.bufferMinutos } : {}),
        ...(input.modalidad !== undefined ? { modalidad: input.modalidad } : {}),
      },
    })
  }

  /**
   * Guarda las tarifas del prestador para un servicio.
   */
  async guardarTarifasPrestador(input: {
    tenantId: string
    perfilId: string
    oficioId: string
    tarifas: Array<{
      id?: string
      nombre: string
      duracionMinutos: number
      precio: bigint
      orden?: number
    }>
  }): Promise<TarifaServicioPublica[]> {
    // Reemplaza o upsert de tarifas
    await this.prisma.tarifaServicioPrestador.deleteMany({
      where: { perfilId: input.perfilId, oficioId: input.oficioId },
    })

    const rows = input.tarifas.map((t, idx) => ({
      id: t.id ?? `tar-${randomUUID()}`,
      tenantId: input.tenantId,
      perfilId: input.perfilId,
      oficioId: input.oficioId,
      nombre: t.nombre,
      duracionMinutos: t.duracionMinutos,
      precio: t.precio,
      activo: true,
      orden: t.orden ?? idx,
      fechaCreacion: new Date(),
      fechaActualizacion: new Date(),
    }))

    if (rows.length > 0) {
      await this.prisma.tarifaServicioPrestador.createMany({ data: rows })
    }

    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      duracionMinutos: r.duracionMinutos,
      precio: Number(r.precio),
      moneda: 'ARS',
    }))
  }

  private mapearDetalleTurno(r: Record<string, unknown>, prestadorNombre: string): DetalleTurno {
    return {
      id: String(r['id']),
      reservaId: String(r['reservaId']),
      tenantId: String(r['tenantId']),
      prestadorId: String(r['tenantId']),
      prestadorNombre,
      oficioId: String(r['servicioId'] ?? 'general'),
      tarifaId: r['tarifaId'] ? String(r['tarifaId']) : null,
      tarifaNombre: r['tarifaNombre'] ? String(r['tarifaNombre']) : null,
      inicio: new Date(String(r['fechaInicio'])).toISOString(),
      fin: new Date(String(r['fechaFin'])).toISOString(),
      duracionMinutos: Number(r['duracionMinutos'] ?? 60),
      precioLista: r['precioLista'] != null ? Number(r['precioLista']) : null,
      precioFinal: r['precioFinal'] != null ? Number(r['precioFinal']) : null,
      moneda: String(r['moneda'] ?? 'ARS'),
      estado: String(r['estado']),
      clienteNombre: r['clienteNombre'] ? String(r['clienteNombre']) : null,
      clienteTelefono: r['clienteTelefono'] ? String(r['clienteTelefono']) : null,
      clienteEmail: r['clienteEmail'] ? String(r['clienteEmail']) : null,
      esInvitado: Boolean(r['esInvitado']),
      modificadoPorAdminId: r['modificadoPorAdminId'] ? String(r['modificadoPorAdminId']) : null,
      motivoModificacionPrecio: r['motivoModificacionPrecio']
        ? String(r['motivoModificacionPrecio'])
        : null,
      forzadoFueraHorario: Boolean(r['forzadoFueraHorario']),
      motivoForzado: r['motivoForzado'] ? String(r['motivoForzado']) : null,
      notas: r['notas'] ? String(r['notas']) : null,
      fechaCreacion: new Date(String(r['fechaCreacion'])).toISOString(),
    }
  }
}
