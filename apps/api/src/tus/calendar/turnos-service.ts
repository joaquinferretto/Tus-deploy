import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import {
  DIAS_AGENDA,
  INTERVALO_TURNO_PREDETERMINADO,
  MAXIMO_DIAS_ADELANTE_AGENDA,
  enmascararTelefono,
  esIntervaloTurno,
  sumarDias,
  validarHorariosSemanales,
  type AgendaSemanal,
  type BloqueoAgendaDTO,
  type ClienteTurnoAdmin,
  type ClienteTurnosDTO,
  type DetalleTurno,
  type DiaAgenda,
  type DisponibilidadSemanalDTO,
  type HorarioSemanalDTO,
  type PrestadorTurnosDTO,
  type ServicioTurnosDTO,
  type SlotDisponible,
  type TarifaServicioPublica,
} from '@factory/contracts'
import { agendaDelDia } from './agenda.ts'
import { ErrorCalendario } from './bookings.ts'
import { dateWeekday } from './rules.ts'

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
  // Set only by the administration when it books a general turno for a client.
  creadoPorAdminId?: string
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
  clienteNombre?: string
  clienteTelefono?: string
  clienteEmail?: string
  // Registered client or explicit guest (takes precedence over the loose clienteNombre fields).
  cliente?: ClienteTurnoAdmin
  motivoForzado: string
  adminId: string
  correlationId?: string
  notas?: string
}

// "Turno general" created by the administration for a client: only inside the provider's real
// availability, exactly like a client booking it.
export interface EntradaAdminTurnoGeneral {
  prestadorId: string
  oficioId: string
  tarifaId?: string
  inicio: string
  cliente: ClienteTurnoAdmin
  adminId: string
  notas?: string
}

const ESTADOS_LIBERAN = ['cancelled', 'cancelled-late', 'no-show']

// reservas.fecha_inicio is a timestamp without time zone holding UTC; the agenda is in Argentina
// time (UTC-3, no daylight saving).
const fechaLocal = (instante: Date): string => new Date(instante.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 10)

// Exclusion constraint ex_reservas_sin_solapamiento (23P01) or a lost race on a unique key.
function esSolapamiento(error: unknown): boolean {
  const texto = String(error)
  return texto.includes('ex_reservas_sin_solapamiento') || texto.includes('23P01') || texto.includes('40P01') || texto.includes('P2002')
}

const esFecha = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(new Date(`${value}T12:00:00.000Z`).getTime())

const horarioOcupado = (mensaje = 'El horario seleccionado ya fue reservado. Por favor elegí otro horario.') => new ErrorCalendario(409, 'SLOT_OCCUPIED', mensaje)

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

// Reads of the agenda run on the client or, inside a write, on its transaction.
type ClienteAgenda = PrismaClient | Prisma.TransactionClient
type CalendarioAgenda = { id: string; granularidadMinutos: number; bufferMinutos: number }

export class ServicioTurnos {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Toda escritura de una agenda (reserva, turno manual o forzado, bloqueo, cambio de
   * disponibilidad) toma la fila de su calendario: las de un mismo prestador corren de a una y
   * cada una decide con el estado que dejó la anterior. PostgreSQL sigue impidiendo el
   * solapamiento (ex_reservas_sin_solapamiento); esto protege además el descanso entre turnos, los
   * bloqueos y los horarios, que una exclusión no puede expresar.
   */
  private async conAgendaBloqueada<T>(calendario: CalendarioAgenda, operacion: (tx: Prisma.TransactionClient, agenda: CalendarioAgenda) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM public."calendarios" WHERE "id" = ${calendario.id} FOR UPDATE`
      // The interval may have changed while waiting for the lock.
      const agenda = (await tx.calendario.findUnique({ where: { id: calendario.id } })) ?? calendario
      return operacion(tx, agenda)
    })
  }

  /**
   * Obtiene o crea el calendario principal del prestador.
   */
  async asegurarCalendarioPrestador(tenantId: string, prestadorId: string) {
    let calendario = await this.prisma.calendario.findUnique({
      where: { tenantId_prestadorId: { tenantId, prestadorId } },
    })

    if (!calendario) {
      const now = new Date()
      const id = `cal-${randomUUID()}`
      try {
        // The agenda and its default hours are created together: a calendar never exists
        // without its rules.
        calendario = await this.prisma.$transaction(async (tx) => {
          const creado = await tx.calendario.create({
            data: {
              id,
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
          await tx.reglaCalendario.createMany({
            data: [1, 2, 3, 4, 5].map((dia) => ({
              id: `reg-${id}-${dia}-09-18`,
              tenantId,
              calendarioId: id,
              diaSemana: dia,
              horaInicio: '09:00',
              horaFin: '18:00',
              capacidad: 1,
              fechaCreacion: now,
              fechaActualizacion: now,
            })),
          })
          return creado
        })
      } catch (error) {
        // Two first requests at once: the other one created it (uq_calendarios_tenant_prestador).
        calendario = await this.prisma.calendario.findUnique({ where: { tenantId_prestadorId: { tenantId, prestadorId } } })
        if (!calendario) throw error
      }
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
    // Own agenda of the provider and administration: also when the profile is hidden.
    incluirNoVisible?: boolean
  }): Promise<{
    slots: SlotDisponible[]
    duracionMinutos: number
    tarifas: TarifaServicioPublica[]
    mensaje?: string
  }> {
    const servicio = await this.servicioConTurnos(input)
    if ('mensaje' in servicio) return { slots: [], duracionMinutos: 0, tarifas: [], mensaje: servicio.mensaje }
    const duracion = input.duracionMinutos ?? servicio.tarifas[0]?.duracionMinutos ?? servicio.config.duracionMinutos ?? 60

    if (!esFecha(input.fecha)) {
      throw new ErrorCalendario(400, 'INVALID_DATE', 'La fecha debe tener el formato YYYY-MM-DD')
    }
    if (!Number.isInteger(duracion) || duracion < 5 || duracion > 24 * 60) {
      throw new ErrorCalendario(400, 'INVALID_PARAMS', 'La duración no es válida')
    }

    const calendario = await this.asegurarCalendarioPrestador(servicio.perfil.tenantId, servicio.perfil.prestadorId)
    const slots = await this.slotsLibres(calendario, input.fecha, duracion, servicio.config.bufferMinutos ?? calendario.bufferMinutos ?? 0)

    return {
      slots,
      duracionMinutos: duracion,
      tarifas: servicio.tarifas,
    }
  }

  /**
   * Prestador + servicio que realmente toma turnos, con sus tarifas. Cuando el prestador o el
   * servicio no atienden por turnos devuelve el mensaje para mostrar (sin horarios).
   */
  private async servicioConTurnos(input: { prestadorId: string; oficioId: string; incluirNoVisible?: boolean }) {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: {
        OR: [{ id: input.prestadorId }, { prestadorId: input.prestadorId }],
      },
      include: {
        servicios: { where: { oficioId: input.oficioId } },
        tarifas: { where: { oficioId: input.oficioId, activo: true }, orderBy: { orden: 'asc' } },
      },
    })

    if (!perfil || (!perfil.visible && !input.incluirNoVisible)) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado o no disponible')
    }
    if (!perfil.aceptaTurnos) return { mensaje: 'Este profesional no tiene habilitada la reserva de turnos online.' }

    const config = perfil.servicios[0]
    // Only services the provider really offers have turnos.
    if (!config) return { mensaje: 'Este profesional no ofrece ese servicio.' }
    if (!config.turnosHabilitados) return { mensaje: 'Este servicio en particular solo se atiende por solicitud.' }

    const tarifas: TarifaServicioPublica[] = perfil.tarifas.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      duracionMinutos: t.duracionMinutos,
      precio: Number(t.precio),
      moneda: 'ARS',
    }))
    return { perfil, config, tarifas }
  }

  /**
   * Agenda de una semana (7 días desde `desde`) para un prestador y un servicio: cada inicio
   * posible con su estado real. Misma generación que la disponibilidad de un día y que la
   * validación de una reserva; la duración es la del servicio (o la de la tarifa elegida).
   */
  async agendaSemanal(input: { prestadorId: string; oficioId: string; desde: string; tarifaId?: string; incluirNoVisible?: boolean }): Promise<AgendaSemanal> {
    if (!esFecha(input.desde)) throw new ErrorCalendario(400, 'INVALID_DATE', 'La fecha debe tener el formato YYYY-MM-DD')
    const hoy = fechaLocal(new Date())
    if (input.desde < sumarDias(hoy, -DIAS_AGENDA) || input.desde > sumarDias(hoy, MAXIMO_DIAS_ADELANTE_AGENDA)) {
      throw new ErrorCalendario(400, 'INVALID_DATE', 'Esa semana está fuera del período que se puede consultar')
    }
    const hasta = sumarDias(input.desde, DIAS_AGENDA - 1)
    const servicio = await this.servicioConTurnos(input)
    if ('mensaje' in servicio) return { desde: input.desde, hasta, duracionMinutos: 0, tarifas: [], dias: [], mensaje: servicio.mensaje }

    const tarifa = input.tarifaId ? servicio.tarifas.find((item) => item.id === input.tarifaId) : servicio.tarifas[0]
    if (input.tarifaId && !tarifa) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'Esa tarifa no pertenece al servicio')
    const duracion = tarifa?.duracionMinutos ?? servicio.config.duracionMinutos ?? 60
    if (!Number.isInteger(duracion) || duracion < 5 || duracion > 24 * 60) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'La duración no es válida')

    const calendario = await this.asegurarCalendarioPrestador(servicio.perfil.tenantId, servicio.perfil.prestadorId)
    const fechas = Array.from({ length: DIAS_AGENDA }, (_, index) => sumarDias(input.desde, index))
    const dias = await this.agendaDias(calendario, fechas, duracion, servicio.config.bufferMinutos ?? calendario.bufferMinutos ?? 0)
    return { desde: input.desde, hasta, duracionMinutos: duracion, tarifas: servicio.tarifas, dias }
  }

  /**
   * Franjas libres de un calendario en una fecha: reglas semanales menos bloqueos y reservas
   * vigentes. Es la ÚNICA fuente de horarios ofrecidos (Web, asistente y administración).
   */
  private async slotsLibres(
    calendario: CalendarioAgenda,
    fecha: string,
    duracion: number,
    buffer: number,
    db: ClienteAgenda = this.prisma
  ): Promise<SlotDisponible[]> {
    const [dia] = await this.agendaDias(calendario, [fecha], duracion, buffer, db)
    return dia!.franjas
      .filter((franja) => franja.estado === 'disponible')
      .map((franja) => ({ inicio: franja.inicio, fin: franja.fin, duracionMinutos: duracion, disponible: true }))
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
  }

  /**
   * Agenda de uno o varios días consecutivos de un calendario: las reglas semanales (con el
   * intervalo general o el propio del día) cruzadas con bloqueos y reservas vigentes. Una lectura
   * por tabla para todo el rango, nunca una por día.
   */
  private async agendaDias(
    calendario: CalendarioAgenda,
    fechas: string[],
    duracion: number,
    buffer: number,
    db: ClienteAgenda = this.prisma
  ): Promise<DiaAgenda[]> {
    const ahora = Date.now()
    const diasSemana = [...new Set(fechas.map(dateWeekday))]
    const reglas = await db.reglaCalendario.findMany({
      where: { calendarioId: calendario.id, diaSemana: diasSemana.length === 1 ? diasSemana[0]! : { in: diasSemana } },
    })
    const intervaloGeneral = calendario.granularidadMinutos || INTERVALO_TURNO_PREDETERMINADO
    const base = { reglas, intervaloGeneral, duracionMinutos: duracion, bufferMinutos: buffer, ahora }
    // Without working hours in the range there is nothing to cross.
    if (reglas.length === 0) return fechas.map((fecha) => agendaDelDia({ ...base, fecha, reservas: [], bloqueos: [] }))

    const inicioRango = new Date(`${fechas[0]!}T00:00:00.000-03:00`)
    const finRango = new Date(`${fechas.at(-1)!}T23:59:59.999-03:00`)
    // Excepciones / bloqueos que solapen el rango
    const excepciones = await db.excepcionCalendario.findMany({
      where: {
        calendarioId: calendario.id,
        estado: 'active',
        fechaInicio: { lte: finRango },
        fechaFin: { gte: inicioRango },
      },
    })
    // Reservas existentes (también las vecinas del rango: su descanso puede alcanzarlo)
    const descanso = buffer * 60_000
    const reservasExistentes = await db.reserva.findMany({
      where: {
        calendarioId: calendario.id,
        estado: { notIn: ESTADOS_LIBERAN },
        fechaInicio: { lte: new Date(finRango.getTime() + descanso) },
        fechaFin: { gte: new Date(inicioRango.getTime() - descanso) },
      },
    })
    const bloqueos = excepciones.map((excepcion) => ({ inicio: new Date(excepcion.fechaInicio), fin: new Date(excepcion.fechaFin) }))
    const reservas = reservasExistentes.map((reserva) => ({ inicio: new Date(reserva.fechaInicio), fin: new Date(reserva.fechaFin) }))
    return fechas.map((fecha) => agendaDelDia({ ...base, fecha, reservas, bloqueos }))
  }

  /**
   * Un turno general solo existe dentro de la disponibilidad real: el inicio pedido debe ser una
   * de las franjas libres que el backend ofrece para ese día. Nunca se acepta un horario armado
   * por el cliente, el asistente o el panel.
   */
  private async exigirDisponible(
    calendario: CalendarioAgenda,
    inicio: Date,
    duracion: number,
    buffer: number,
    db: ClienteAgenda = this.prisma
  ): Promise<void> {
    if (inicio.getTime() <= Date.now()) {
      throw new ErrorCalendario(400, 'PAST_DATE', 'El horario elegido ya pasó.')
    }
    const libres = await this.slotsLibres(calendario, fechaLocal(inicio), duracion, buffer, db)
    if (libres.some((slot) => slot.inicio === inicio.toISOString())) return
    // Taken by another turno or by the rest time around it: "occupied", not "outside the hours".
    const descanso = buffer * 60_000
    const fin = new Date(inicio.getTime() + duracion * 60_000 + descanso)
    const ocupado = await db.reserva.findFirst({
      where: { calendarioId: calendario.id, estado: { notIn: ESTADOS_LIBERAN }, fechaInicio: { lt: fin }, fechaFin: { gt: new Date(inicio.getTime() - descanso) } },
    })
    if (ocupado) throw horarioOcupado()
    throw new ErrorCalendario(409, 'SLOT_NOT_AVAILABLE', 'Ese horario no está dentro de la disponibilidad del profesional.')
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

    // A hidden profile takes no public bookings; the administration may still book for a client.
    if (!perfil || (!perfil.visible && !input.creadoPorAdminId)) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado o no visible')
    }
    if (perfil.servicios.length === 0) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Ese prestador no ofrece ese servicio')
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
    const descanso = servicioConfig?.bufferMinutos ?? calendario.bufferMinutos ?? 0

    const reservaId = `res-${randomUUID()}`
    const now = new Date()

    try {
      const row = await this.conAgendaBloqueada(calendario, async (tx, agenda) => {
        // Decided with the agenda locked: nobody takes, blocks or reschedules this time meanwhile.
        await this.exigirDisponible(agenda, inicio, duracion, descanso, tx)
        return tx.reserva.create({
          data: {
            id: reservaId,
            tenantId: perfil.tenantId,
            creadoPorAdminId: input.creadoPorAdminId ?? null,
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
      })

      return this.mapearDetalleTurno(row, perfil.nombrePublico)
    } catch (error: unknown) {
      if (esSolapamiento(error)) throw horarioOcupado('El horario seleccionado ya fue reservado. Por favor elegí otro horario.')
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
      const row = await this.conAgendaBloqueada(calendario, async (tx) => {
        return tx.reserva.create({
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
      })

      return this.mapearDetalleTurno(row, perfil.nombrePublico)
    } catch (error: unknown) {
      if (esSolapamiento(error)) throw horarioOcupado('El horario seleccionado se solapa con otro turno ya existente.')
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
    const inicio = new Date(input.inicio)
    const fin = new Date(input.fin)
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || fin <= inicio) {
      throw new ErrorCalendario(400, 'INVALID_DATE', 'El fin del bloqueo debe ser posterior al inicio')
    }
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: { tenantId: input.prestadorTenantId },
    })
    if (!perfil) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado')
    }

    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)
    const id = `exc-${randomUUID()}`

    await this.conAgendaBloqueada(calendario, (tx) =>
      tx.excepcionCalendario.create({
        data: {
          id,
          tenantId: perfil.tenantId,
          calendarioId: calendario.id,
          fechaInicio: inicio,
          fechaFin: fin,
          motivo: input.motivo.trim().slice(0, 200) || 'Bloqueo manual',
          estado: 'active',
          fechaCreacion: new Date(),
        },
      })
    )

    return { ok: true, id }
  }

  /**
   * Bloqueos vigentes de la propia agenda (feriados, vacaciones, bloqueos manuales).
   */
  async bloqueosPrestador(tenantId: string): Promise<BloqueoAgendaDTO[]> {
    const filas = await this.prisma.excepcionCalendario.findMany({
      where: { tenantId, estado: 'active', fechaFin: { gte: new Date() } },
      orderBy: { fechaInicio: 'asc' },
      take: 100,
    })
    return filas.map((fila) => ({ id: fila.id, inicio: fila.fechaInicio.toISOString(), fin: fila.fechaFin.toISOString(), motivo: fila.motivo }))
  }

  /**
   * Quita un bloqueo propio: los horarios habituales vuelven a ofrecerse. La fila queda como
   * historial (estado cancelled); la configuración semanal no se toca.
   */
  async quitarBloqueo(tenantId: string, id: string): Promise<{ ok: true }> {
    const { count } = await this.prisma.excepcionCalendario.updateMany({ where: { id, tenantId, estado: 'active' }, data: { estado: 'cancelled' } })
    if (count === 0) throw new ErrorCalendario(404, 'NOT_FOUND', 'Bloqueo no encontrado')
    return { ok: true }
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
   * Resuelve el cliente de un turno creado por la administración. Registrado: la cuenta se lee de
   * la base (nombre y contacto salen de ahí, nunca del formulario). Invitado: explícito, con nombre.
   */
  private async clienteDeAdmin(cliente: ClienteTurnoAdmin | undefined, suelto: { nombre?: string; telefono?: string; email?: string }) {
    if (cliente?.tipo === 'registrado') {
      const cuenta = await this.prisma.account.findFirst({ where: { id: cliente.cuentaId, status: 'active' }, include: { user: true } })
      if (!cuenta) throw new ErrorCalendario(404, 'NOT_FOUND', 'Cliente no encontrado')
      return {
        clienteId: cuenta.id,
        clienteTenantId: cuenta.tenantId,
        clienteNombre: cuenta.user.displayName,
        clienteTelefono: cuenta.user.phoneNumber ?? null,
        clienteEmail: cuenta.user.email,
        esInvitado: false,
      }
    }
    const nombre = (cliente?.tipo === 'invitado' ? cliente.nombre : suelto.nombre ?? '').trim()
    if (nombre.length < 2 || nombre.length > 120) throw new ErrorCalendario(400, 'CLIENT_REQUIRED', 'Elegí un cliente registrado o cargá el nombre del invitado.')
    const telefono = (cliente?.tipo === 'invitado' ? cliente.telefono : suelto.telefono)?.trim()
    const email = (cliente?.tipo === 'invitado' ? cliente.email : suelto.email)?.trim()
    return { clienteId: null, clienteTenantId: null, clienteNombre: nombre, clienteTelefono: telefono || null, clienteEmail: email || null, esInvitado: true }
  }

  /**
   * ADMIN: turno general para un cliente. Mismas reglas que una reserva del cliente: solo una
   * franja de la disponibilidad real del prestador, sin solapamientos.
   */
  async adminReservarTurno(input: EntradaAdminTurnoGeneral): Promise<DetalleTurno> {
    const cliente = await this.clienteDeAdmin(input.cliente, {})
    return this.reservarTurno({
      prestadorId: input.prestadorId,
      oficioId: input.oficioId,
      tarifaId: input.tarifaId,
      inicio: input.inicio,
      ...(cliente.clienteId ? { clienteId: cliente.clienteId, clienteTenantId: cliente.clienteTenantId ?? undefined } : {}),
      clienteNombre: cliente.clienteNombre,
      clienteTelefono: cliente.clienteTelefono ?? undefined,
      clienteEmail: cliente.clienteEmail ?? undefined,
      notas: input.notas,
      creadoPorAdminId: input.adminId,
    })
  }

  /**
   * ADMIN: Forzar turno fuera de horario normal con motivo obligatorio. Ignora la disponibilidad
   * publicada, pero NO puede solaparse con otra reserva (lo impide PostgreSQL). El motivo y el
   * administrador quedan en la reserva y en la auditoría.
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
    // The service must be one the provider really offers (never an arbitrary id).
    if (perfil.servicios.length === 0) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Ese prestador no ofrece ese servicio')
    }

    const duracion = input.duracionMinutos ?? perfil.servicios[0]?.duracionMinutos ?? 60
    const inicio = new Date(input.inicio)
    if (Number.isNaN(inicio.getTime())) throw new ErrorCalendario(400, 'INVALID_DATE', 'Fecha de inicio inválida')
    if (inicio.getTime() <= Date.now()) throw new ErrorCalendario(400, 'PAST_DATE', 'El horario elegido ya pasó.')
    const fin = input.fin ? new Date(input.fin) : new Date(inicio.getTime() + duracion * 60_000)
    if (Number.isNaN(fin.getTime()) || fin <= inicio) throw new ErrorCalendario(400, 'INVALID_DATE', 'El fin del turno debe ser posterior al inicio')
    const cliente = await this.clienteDeAdmin(input.cliente, { nombre: input.clienteNombre, telefono: input.clienteTelefono, email: input.clienteEmail })

    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)
    const precio = input.precioFinal ?? perfil.servicios[0]?.precioBase ?? 0n
    const reservaId = `res-${randomUUID()}`
    const now = new Date()
    const motivo = input.motivoForzado.trim()

    try {
      const row = await this.conAgendaBloqueada(calendario, async (tx) => {
        const creada = await tx.reserva.create({
          data: {
            id: reservaId,
            tenantId: perfil.tenantId,
            clienteTenantId: cliente.clienteTenantId,
            reservaId,
            servicioId: input.oficioId,
            calendarioId: calendario.id,
            clienteId: cliente.clienteId ?? 'admin-forzado',
            fechaInicio: inicio,
            fechaFin: fin,
            estado: 'confirmed',
            version: 1,
            fechaCreacion: now,
            fechaActualizacion: now,
            duracionMinutos: Math.round((fin.getTime() - inicio.getTime()) / 60_000),
            precioLista: precio,
            precioFinal: precio,
            moneda: 'ARS',
            clienteNombre: cliente.clienteNombre,
            clienteTelefono: cliente.clienteTelefono,
            clienteEmail: cliente.clienteEmail,
            esInvitado: cliente.esInvitado,
            forzadoFueraHorario: true,
            motivoForzado: motivo,
            creadoPorAdminId: input.adminId,
            notas: input.notas ?? null,
          },
        })
        // Audit trail of the exception, in the same transaction as the reservation: who forced
        // it, for which provider and why (no personal data of the client).
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            tenantId: perfil.tenantId,
            actorId: input.adminId,
            correlationId: input.correlationId || randomUUID(),
            eventType: 'turnos.turno_forzado',
            outcome: 'success',
            metadata: { reservaId, perfilId: perfil.id, oficioId: input.oficioId, inicio: inicio.toISOString(), fin: fin.toISOString(), motivo, clienteRegistrado: !cliente.esInvitado },
            occurredAt: now,
          },
        })
        return creada
      })

      return this.mapearDetalleTurno(row, perfil.nombrePublico)
    } catch (error: unknown) {
      if (esSolapamiento(error)) throw horarioOcupado('Ese horario se superpone con otro turno del profesional. Elegí otro.')
      throw error
    }
  }

  /**
   * ADMIN: prestadores por nombre (combobox del formulario de turnos). Sin IDs en la UI.
   */
  async adminBuscarPrestadores(q: string): Promise<PrestadorTurnosDTO[]> {
    const termino = q.trim().slice(0, 80)
    const perfiles = await this.prisma.perfilPublicoPrestador.findMany({
      where: termino ? { nombrePublico: { contains: termino, mode: 'insensitive' } } : {},
      orderBy: [{ nombrePublico: 'asc' }, { id: 'asc' }],
      take: 10,
    })
    return perfiles.map((perfil) => ({
      id: perfil.id,
      nombre: perfil.nombrePublico,
      oficioPrincipal: perfil.oficio,
      zona: perfil.zona,
      aceptaTurnos: perfil.aceptaTurnos,
      visible: perfil.visible,
    }))
  }

  /**
   * Servicios que el prestador realmente ofrece (con su configuración de turnos y tarifas).
   */
  async serviciosDePrestador(filtro: { perfilId: string } | { tenantId: string }): Promise<ServicioTurnosDTO[]> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({
      where: 'perfilId' in filtro ? { OR: [{ id: filtro.perfilId }, { prestadorId: filtro.perfilId }] } : { tenantId: filtro.tenantId },
      include: {
        servicios: { include: { oficio: true }, orderBy: { orden: 'asc' } },
        tarifas: { where: { activo: true }, orderBy: { orden: 'asc' } },
      },
    })
    if (!perfil) throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado')
    return perfil.servicios.map((servicio) => ({
      oficioId: servicio.oficioId,
      nombre: servicio.oficio.nombre,
      turnosHabilitados: perfil.aceptaTurnos && servicio.turnosHabilitados,
      duracionMinutos: servicio.duracionMinutos,
      precioBase: servicio.precioBase === null ? null : Number(servicio.precioBase),
      tarifas: perfil.tarifas
        .filter((tarifa) => tarifa.oficioId === servicio.oficioId)
        .map((tarifa) => ({ id: tarifa.id, nombre: tarifa.nombre, duracionMinutos: tarifa.duracionMinutos, precio: Number(tarifa.precio), moneda: 'ARS' })),
    }))
  }

  /**
   * ADMIN: clientes registrados por nombre, email, documento o teléfono (combobox). Solo cuentas
   * activas; el contacto se devuelve enmascarado.
   */
  async adminBuscarClientes(q: string): Promise<ClienteTurnosDTO[]> {
    const termino = q.trim().slice(0, 80)
    if (termino.length < 2) return []
    const digitos = termino.replace(/\D/gu, '')
    const cuentas = await this.prisma.account.findMany({
      where: {
        status: 'active',
        user: {
          OR: [
            { displayName: { contains: termino, mode: 'insensitive' } },
            { email: { contains: termino, mode: 'insensitive' } },
            ...(digitos.length >= 4 ? [{ phoneNumber: { contains: digitos } }, { documentNumber: { startsWith: digitos } }] : []),
          ],
        },
      },
      include: { user: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
    })
    return cuentas.map((cuenta) => ({
      cuentaId: cuenta.id,
      nombre: cuenta.user.displayName,
      email: cuenta.user.email,
      telefono: cuenta.user.phoneNumber ? enmascararTelefono(cuenta.user.phoneNumber) : null,
    }))
  }

  /**
   * Horarios semanales de atención del prestador (reglas de su calendario).
   */
  async horariosPrestador(tenantId: string): Promise<HorarioSemanalDTO[]> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId } })
    if (!perfil) throw new ErrorCalendario(404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)
    const reglas = await this.prisma.reglaCalendario.findMany({ where: { calendarioId: calendario.id }, orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }] })
    return reglas.map((regla) => ({ diaSemana: regla.diaSemana, horaInicio: regla.horaInicio, horaFin: regla.horaFin, intervaloMinutos: regla.intervaloMinutos ?? null }))
  }

  /**
   * Disponibilidad semanal del prestador: el intervalo general de su agenda y los horarios de
   * cada día (con su intervalo propio cuando lo personalizó).
   */
  async disponibilidadSemanal(tenantId: string): Promise<DisponibilidadSemanalDTO> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId } })
    if (!perfil) throw new ErrorCalendario(404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)
    return { intervaloGeneral: calendario.granularidadMinutos || INTERVALO_TURNO_PREDETERMINADO, horarios: await this.horariosPrestador(tenantId) }
  }

  /**
   * Guarda la disponibilidad semanal completa (intervalo general + horarios por día).
   */
  async guardarDisponibilidadSemanal(tenantId: string, input: { intervaloGeneral: unknown; horarios: unknown }): Promise<DisponibilidadSemanalDTO> {
    if (!esIntervaloTurno(input.intervaloGeneral)) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'Intervalo general inválido')
    const horarios = await this.guardarHorariosPrestador(tenantId, input.horarios, input.intervaloGeneral)
    return { intervaloGeneral: input.intervaloGeneral, horarios }
  }

  /**
   * Reemplaza los horarios semanales del prestador. No toca las reservas ya tomadas: solo cambia
   * qué franjas se ofrecen de ahora en más.
   */
  async guardarHorariosPrestador(tenantId: string, horarios: unknown, intervaloGeneral?: number): Promise<HorarioSemanalDTO[]> {
    const validado = validarHorariosSemanales(horarios)
    if (!validado.ok) throw new ErrorCalendario(400, 'INVALID_PARAMS', `Horarios inválidos (${validado.motivo})`)
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId } })
    if (!perfil) throw new ErrorCalendario(404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)
    const now = new Date()
    await this.conAgendaBloqueada(calendario, async (tx) => {
      if (intervaloGeneral !== undefined) await tx.calendario.update({ where: { id: calendario.id }, data: { granularidadMinutos: intervaloGeneral, fechaActualizacion: now } })
      await tx.reglaCalendario.deleteMany({ where: { calendarioId: calendario.id } })
      if (validado.valor.length > 0)
        await tx.reglaCalendario.createMany({
          data: validado.valor.map((regla) => ({
            id: `reg-${randomUUID()}`,
            tenantId: perfil.tenantId,
            calendarioId: calendario.id,
            diaSemana: regla.diaSemana,
            horaInicio: regla.horaInicio,
            horaFin: regla.horaFin,
            intervaloMinutos: regla.intervaloMinutos ?? null,
            capacidad: 1,
            fechaCreacion: now,
            fechaActualizacion: now,
          })),
        })
    })
    return validado.valor
  }

  /**
   * Perfil del prestador dueño de la sesión (los endpoints del prestador nunca aceptan un perfil
   * enviado por el cliente).
   */
  async perfilDeTenant(tenantId: string): Promise<{ id: string } | null> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId } })
    return perfil ? { id: perfil.id } : null
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
      // An unknown provider matches nothing (never "all the turnos").
      where['tenantId'] = perfil ? perfil.tenantId : '__sin_prestador__'
    }
    if (input.estado) {
      where['estado'] = input.estado
    }
    if (input.desde || input.hasta) {
      const f: Record<string, unknown> = {}
      if (input.desde) f['gte'] = new Date(`${input.desde.slice(0, 10)}T00:00:00.000-03:00`)
      if (input.hasta) f['lte'] = new Date(`${input.hasta.slice(0, 10)}T23:59:59.999-03:00`)
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

    // Names of the page in two batch reads (provider and service), never one query per row.
    const tenants = [...new Set(rows.map((row) => row.tenantId))]
    const oficios = [...new Set(rows.flatMap((row) => (row.servicioId ? [row.servicioId] : [])))]
    const [perfiles, nombresOficio] = await Promise.all([
      tenants.length ? this.prisma.perfilPublicoPrestador.findMany({ where: { tenantId: { in: tenants } } }) : Promise.resolve([]),
      oficios.length ? this.prisma.oficioServicio.findMany({ where: { id: { in: oficios } } }) : Promise.resolve([]),
    ])
    const perfilDe = new Map(perfiles.map((perfil) => [perfil.tenantId, perfil]))
    const oficioDe = new Map(nombresOficio.map((oficio) => [oficio.id, oficio.nombre]))

    return {
      items: rows.map((r) => {
        const perfil = perfilDe.get(r.tenantId)
        return {
          ...this.mapearDetalleTurno(r, perfil?.nombrePublico ?? 'Prestador'),
          ...(perfil ? { prestadorId: perfil.id } : {}),
          ...(r.servicioId && oficioDe.has(r.servicioId) ? { oficioNombre: oficioDe.get(r.servicioId)! } : {}),
        }
      }),
      total,
      pagina,
      totalPaginas: Math.max(1, Math.ceil(total / tamano)),
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
      creadoPorAdminId: r['creadoPorAdminId'] ? String(r['creadoPorAdminId']) : null,
      clienteCuentaId: r['esInvitado'] ? null : String(r['clienteId'] ?? '') || null,
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
