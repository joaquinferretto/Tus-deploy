import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { TUS_CONTRACT_VERSION } from '@factory/contracts'
import {
  CODIGO_DEMASIADAS_SOLICITUDES,
  CODIGO_PAGO_NO_DISPONIBLE,
  CODIGO_PAGOS_SERVICIO_NO_HABILITADOS,
  CODIGO_PRESTADOR_SIN_COBRO,
  CODIGO_PRESTADOR_SIN_IDENTIDAD,
  CODIGO_SENA_YA_EMITIDA,
  CODIGO_SOLICITUD_NO_PENDIENTE,
  CODIGO_SOLICITUD_SIN_HORARIO,
  CODIGO_SOLICITUD_VENCIDA,
  CODIGO_TRANSICION_INVALIDA,
  DIAS_AGENDA,
  ESTADOS_TURNO_LIBERAN,
  HORAS_VIGENCIA_SOLICITUD_TURNO,
  HORAS_VIGENCIA_PAGO_SENA_TURNO,
  INTERVALO_TURNO_PREDETERMINADO,
  MAXIMO_DIAS_ADELANTE_AGENDA,
  MAXIMO_SOLICITUDES_PENDIENTES_POR_AGENDA,
  TRANSICIONES_TURNO,
  enmascararTelefono,
  esEstadoTurno,
  esIntervaloTurno,
  sumarDias,
  validarHorariosSemanales,
  type EstadoTurno,
  type SolicitanteTurnoDTO,
  type AgendaSemanal,
  type BloqueoAgendaDTO,
  type CheckoutSenaTurnoDTO,
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
import { cuentaDePrestador, type ClientePrismaVinculoPrestador } from '../directorio/cuenta-prestador.ts'
import { ErrorFotoPerfil, prepararFotoPerfil } from '../directorio/foto.ts'
import { agendaDelDia } from './agenda.ts'

// Where a provider answered a request from.
export type CanalRespuestaTurno = 'web' | 'whatsapp'

// Pictures a client may attach to a request of turno.
export const MAXIMO_IMAGENES_TURNO = 2
import { ErrorCalendario } from './bookings.ts'
import { dateWeekday } from './rules.ts'
import { SIN_NOTIFICADOR_TURNOS, type NotificadorTurnos } from './turnos-notificaciones.ts'
import { OutboxNotificacionesTurnos, type EventoNotificacionTurno } from './turnos-notificaciones-outbox.ts'
import { senaDePrecio, type ServicioSenaTurnos } from './turnos-sena.ts'

// A turno a client REQUESTS. The client is the account of the session (never a value of the
// request body) and its name and contact are read from that account, not copied here.
export interface EntradaSolicitudTurno {
  prestadorId: string
  oficioId: string
  tarifaId?: string
  inicio: string
  clienteId: string
  clienteTenantId: string
  notas?: string
}

// A turno stored already confirmed: only the administration books one for a client.
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

const ESTADOS_LIBERAN: string[] = [...ESTADOS_TURNO_LIBERAN]

// Reservations that still hold their time: not released, and not a request whose validity ran
// out (the next write of its agenda marks it `expired`; until then every read already ignores it).
const queOcupan = (ahora: Date) => ({ estado: { notIn: ESTADOS_LIBERAN }, NOT: { estado: { in: ['pending', 'awaiting_payment'] }, solicitudExpiraEn: { lte: ahora } } })

// Filter of a list by the state each row is SHOWN with: a request whose validity ran out reads as
// expired even before a write marks it, so it is listed under "expired" and never under "pending".
function filtroPorEstado(estado: string): Record<string, unknown> {
  const ahora = new Date()
  if (estado === 'pending' || estado === 'awaiting_payment') return { estado, solicitudExpiraEn: { gt: ahora } }
  if (estado === 'expired') return { OR: [{ estado: 'expired' }, { estado: { in: ['pending', 'awaiting_payment'] }, solicitudExpiraEn: { lte: ahora } }] }
  return { estado }
}

// Name and contact of a registered client, read from its account.
interface DatosCliente {
  nombre: string
  telefono: string | null
  email: string
}

const nombreDeUsuario = (user: { displayName: string; firstName?: string | null; lastName?: string | null }): string =>
  user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.displayName

// reservas.fecha_inicio is a timestamp without time zone holding UTC; the agenda is in Argentina
// time (UTC-3, no daylight saving).
const fechaLocal = (instante: Date): string => new Date(instante.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 10)

// Exclusion constraint ex_reservas_sin_solapamiento (23P01) or a lost race on a unique key.
function esSolapamiento(error: unknown): boolean {
  const texto = String(error)
  return texto.includes('ex_reservas_sin_solapamiento') || texto.includes('23P01') || texto.includes('40P01') || texto.includes('P2002')
}

const esFecha = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(new Date(`${value}T12:00:00.000Z`).getTime())

// An amount the agenda stores: whole pesos, never negative, never absurd.
const MONTO_MAXIMO_TURNO = 100_000_000n
const montoValido = (value: unknown): value is bigint => typeof value === 'bigint' && value >= 0n && value <= MONTO_MAXIMO_TURNO

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
type FilaReserva = Prisma.ReservaGetPayload<object>

export class ServicioTurnos {
  private readonly notificadores: NotificadorTurnos[]
  private readonly outboxNotificaciones: OutboxNotificacionesTurnos
  // Deposit of the turnos (TURNOS-SENA-01); without it no turno shows or charges one.
  private senas: ServicioSenaTurnos | null = null

  constructor(
    private readonly prisma: PrismaClient,
    notificador: NotificadorTurnos = SIN_NOTIFICADOR_TURNOS
  ) {
    this.notificadores = [notificador]
    this.outboxNotificaciones = new OutboxNotificacionesTurnos(prisma, (evento) => this.entregarNotificacion(evento))
  }

  // Wired after the services they need exist (payments, the assistant's channels).
  conSenas(senas: ServicioSenaTurnos): this {
    this.senas = senas
    return this
  }

  agregarNotificador(notificador: NotificadorTurnos): this {
    this.notificadores.push(notificador)
    return this
  }

  // Called only after the finance transaction applied a verified deposit approval. The work is
  // the normalized link from payment obligation to reservation; no webhook body supplies a client.
  async avisarTurnoConfirmado(trabajoId: string): Promise<void> {
    const orden = await this.prisma.trabajo.findFirst({ where: { trabajoId, origen: 'turno' } })
    if (!orden?.reservaId) return
    const reserva = await this.prisma.reserva.findFirst({ where: {
      reservaId: orden.reservaId,
      tenantId: orden.prestadorTenantId,
      clienteTenantId: orden.tenantId,
      estado: 'confirmed',
    } })
    if (!reserva) return
    await this.outboxNotificaciones.encolar(this.prisma, {
      tenantId: reserva.tenantId,
      reservaId: reserva.id,
      version: reserva.version,
      evento: { kind: 'turno_confirmado', reservaId: reserva.id },
    })
    this.activarNotificaciones()
  }

  // The deposit of each turno, derived (never stored on the reservation): one batch for the list.
  private async agregarSenas(rows: FilaReserva[], turnos: DetalleTurno[]): Promise<DetalleTurno[]> {
    if (!this.senas || rows.length === 0) return turnos
    const senas = await this.senas.senasDe(rows)
    return turnos.map((turno) => ({ ...turno, sena: senas.get(turno.id) ?? null }))
  }

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
      // Requests nobody answered in time give their time back before anything else is decided.
      const ahora = new Date()
      await tx.reserva.updateMany({
        where: { calendarioId: calendario.id, estado: { in: ['pending', 'awaiting_payment'] }, solicitudExpiraEn: { lte: ahora } },
        data: { estado: 'expired', version: { increment: 1 }, fechaActualizacion: ahora },
      })
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
    const precio = tarifa?.precio ?? (servicio.config.precioBase === null ? null : Number(servicio.config.precioBase))
    const conSena = precio !== null && precio > 0 && this.senas ? await this.senas.requeridaPara(servicio.perfil.tenantId) : false
    return { desde: input.desde, hasta, duracionMinutos: duracion, tarifas: servicio.tarifas, dias, precio: precio !== null && precio > 0 ? precio : null, sena: conSena ? senaDePrecio(precio!) : null }
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
   * Agenda de uno o varios días consecutivos de un calendario: las reglas semanales (cuándo
   * trabaja) y la duración del servicio (cada cuánto empieza un turno: duración + descanso),
   * cruzadas con bloqueos y reservas vigentes. Una lectura
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
    // The step between starts is the duration of the service plus its rest (agendaDelDia). The
    // interval stored in the calendar and in each rule is LEGACY: kept in the database, not read.
    const base = { reglas, duracionMinutos: duracion, bufferMinutos: buffer, ahora }
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
        ...queOcupan(new Date(ahora)),
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
      where: { calendarioId: calendario.id, ...queOcupan(new Date()), fechaInicio: { lt: fin }, fechaFin: { gt: new Date(inicio.getTime() - descanso) } },
    })
    if (ocupado) throw horarioOcupado()
    throw new ErrorCalendario(409, 'SLOT_NOT_AVAILABLE', 'Ese horario no está dentro de la disponibilidad del profesional.')
  }

  /**
   * SOLICITUD de reserva de un cliente con cuenta. No confirma nada: crea la reserva en estado
   * `pending`, que retiene el horario hasta que el prestador responda o venza su vigencia
   * (HORAS_VIGENCIA_SOLICITUD_TURNO, nunca más allá del inicio del turno). La disponibilidad se
   * vuelve a decidir acá, con la agenda bloqueada: lo que el cliente vio en pantalla no garantiza
   * nada. El prestador la convierte en `awaiting_payment`; el webhook verificado de la seña es la
   * única vía normal que luego la convierte en `confirmed`.
   */
  async solicitarTurno(input: EntradaSolicitudTurno): Promise<DetalleTurno> {
    const turno = await this.crearTurno({ ...input }, true)
    this.activarNotificaciones()
    return turno
  }

  /**
   * Turno ya confirmado: solo lo crea la administración para un cliente (turno general). Mismas
   * reglas de disponibilidad y de concurrencia que una solicitud.
   */
  async reservarTurno(input: EntradaReservaTurno): Promise<DetalleTurno> {
    return this.crearTurno(input, false)
  }

  /**
   * Crea la reserva con snapshot de tarifa y protección de concurrencia física. `solicitud`:
   * nace pendiente de la confirmación del prestador; si no, nace confirmada.
   */
  private async crearTurno(input: EntradaReservaTurno, solicitud: boolean): Promise<DetalleTurno> {
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
    // A variant that was named must be one of THIS provider's service: its price is what the
    // client saw. An unknown one is refused instead of silently charging another variant.
    if (input.tarifaId && !tarifa) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'Esa tarifa no pertenece al servicio')
    if (!tarifa && perfil.tarifas.length > 0) {
      tarifa = perfil.tarifas[0]
    }

    const duracion = tarifa?.duracionMinutos ?? servicioConfig?.duracionMinutos ?? 60
    const precio = tarifa?.precio ?? servicioConfig?.precioBase ?? 0n
    // Where a turno is confirmed by paying its deposit (online payments on), a service without a
    // published price cannot be requested: there would be nothing to compute the deposit from and
    // the turno could never be confirmed. With payments off a price-less service works as before.
    if (solicitud && precio <= 0n && this.senas && (await this.senas.exigePrecio(perfil.tenantId)))
      throw new ErrorCalendario(409, 'SERVICE_PRICE_REQUIRED', 'Este servicio necesita un precio publicado para solicitar un turno con seña.')

    const inicio = new Date(input.inicio)
    if (isNaN(inicio.getTime())) {
      throw new ErrorCalendario(400, 'INVALID_DATE', 'Fecha de inicio inválida')
    }
    const fin = new Date(inicio.getTime() + duracion * 60_000)

    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)
    const descanso = servicioConfig?.bufferMinutos ?? calendario.bufferMinutos ?? 0

    const reservaId = `res-${randomUUID()}`
    const now = new Date()
    // A request waits for the provider for a limited time, and never beyond the turno itself.
    const expiraEn = solicitud ? new Date(Math.min(now.getTime() + HORAS_VIGENCIA_SOLICITUD_TURNO * 3_600_000, inicio.getTime())) : null

    try {
      const row = await this.conAgendaBloqueada(calendario, async (tx, agenda) => {
        // Decided with the agenda locked: nobody takes, blocks or reschedules this time meanwhile.
        await this.exigirDisponible(agenda, inicio, duracion, descanso, tx)
        if (solicitud) {
          // One person cannot keep an agenda waiting with many open requests.
          const abiertas = await tx.reserva.count({ where: { calendarioId: calendario.id, clienteId: input.clienteId, esInvitado: false, estado: 'pending' } })
          if (abiertas >= MAXIMO_SOLICITUDES_PENDIENTES_POR_AGENDA) throw new ErrorCalendario(409, CODIGO_DEMASIADAS_SOLICITUDES, 'Ya tenés varias solicitudes pendientes con este profesional.')
        }
        const creada = await tx.reserva.create({
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
            estado: solicitud ? 'pending' : 'confirmed',
            solicitudExpiraEn: expiraEn,
            version: 1,
            fechaCreacion: now,
            fechaActualizacion: now,
            tarifaId: tarifa?.id ?? null,
            tarifaNombre: tarifa?.nombre ?? null,
            duracionMinutos: duracion,
            precioLista: precio,
            precioFinal: precio,
            moneda: 'ARS',
            // A request stores no copy of the person: name and contact are those of the account.
            clienteNombre: solicitud ? null : input.clienteNombre ?? null,
            clienteTelefono: solicitud ? null : input.clienteTelefono ?? null,
            clienteEmail: solicitud ? null : input.clienteEmail ?? null,
            esInvitado: !input.clienteId,
            notas: input.notas?.trim().slice(0, 500) || null,
          },
        })
        if (solicitud)
          await this.outboxNotificaciones.encolar(tx, {
            tenantId: creada.tenantId,
            reservaId: creada.id,
            version: creada.version,
            evento: { kind: 'solicitud_recibida', reservaId: creada.id },
          })
        return creada
      })

      const [clientes, oficios] = await Promise.all([this.clientesDe([row]), this.nombresDeOficio([row])])
      const [turno] = await this.agregarSenas([row], [this.mapearDetalleTurno(row, perfil.nombrePublico, { cliente: clientes.get(row.clienteId) ?? null, contacto: 'siempre', oficioNombre: oficios.get(input.oficioId) })])
      return turno!
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

    if (input.estado) Object.assign(where, filtroPorEstado(input.estado))
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

    return this.detallesPrestador(rows, perfil?.nombrePublico ?? 'Prestador')
  }

  // Reservations as their provider sees them: the client's name always, its contact only once the
  // turno is confirmed.
  private async detallesPrestador(rows: FilaReserva[], prestadorNombre: string): Promise<DetalleTurno[]> {
    const [clientes, oficios] = await Promise.all([this.clientesDe(rows), this.nombresDeOficio(rows)])
    return this.agregarSenas(rows, rows.map((row) => this.mapearDetalleTurno(row, prestadorNombre, { cliente: clientes.get(row.clienteId) ?? null, contacto: 'confirmado', oficioNombre: row.servicioId ? oficios.get(row.servicioId) : undefined })))
  }

  // Name and contact of the registered clients of some reservations, read from their accounts in
  // one query. Guests and manual turnos keep the contact written on the reservation.
  private async clientesDe(rows: FilaReserva[]): Promise<Map<string, DatosCliente>> {
    const ids = [...new Set(rows.filter((row) => !row.esInvitado && !row.clienteNombre).map((row) => row.clienteId))]
    if (ids.length === 0) return new Map()
    const cuentas = await this.prisma.account.findMany({ where: { id: { in: ids } }, include: { user: true } })
    return new Map(cuentas.map((cuenta) => [cuenta.id, { nombre: nombreDeUsuario(cuenta.user), telefono: cuenta.user.phoneNumber ?? null, email: cuenta.user.email }]))
  }

  crearWorkerNotificaciones(): ReturnType<OutboxNotificacionesTurnos['crearWorker']> {
    return this.outboxNotificaciones.crearWorker()
  }

  procesarNotificacionesPendientes(limit?: number): Promise<number> {
    return this.outboxNotificaciones.procesarPendientes(limit)
  }

  private activarNotificaciones(): void {
    // A previous drain may have reached an empty queue just before this transaction committed.
    // Chain one more bounded drain so the freshly committed event is not left waiting for the
    // periodic worker tick.
    void this.procesarNotificacionesPendientes()
      .then(() => this.procesarNotificacionesPendientes())
      .catch(() => undefined)
  }

  private async entregarNotificacion(evento: EventoNotificacionTurno): Promise<void> {
    const row = await this.prisma.reserva.findFirst({ where: { OR: [{ id: evento.reservaId }, { reservaId: evento.reservaId }] } })
    if (!row || row.esInvitado) return
    const [perfil, prestadorCuentaId, oficios, clientes] = await Promise.all([
      this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId: row.tenantId } }),
      this.cuentaPrestadorId(row.tenantId),
      this.nombresDeOficio([row]),
      this.clientesDe([row]),
    ])
    const comun = {
      reservaId: row.id,
      clienteCuentaId: row.clienteId,
      prestadorTenantId: row.tenantId,
      prestadorCuentaId,
      clienteNombre: clientes.get(row.clienteId)?.nombre ?? 'Tu cliente',
      prestadorNombre: perfil?.nombrePublico ?? 'El profesional',
      servicio: row.tarifaNombre ?? (row.servicioId ? oficios.get(row.servicioId) : null) ?? 'el servicio',
      inicio: row.fechaInicio,
    }
    if (evento.kind === 'solicitud_recibida') {
      const precio = row.precioFinal !== null && row.precioFinal !== undefined && row.precioFinal > 0n ? Number(row.precioFinal) : null
      const conSena = precio !== null && this.senas ? await this.senas.requeridaPara(row.tenantId).catch(() => false) : false
      const imagenes = await this.prisma.imagenReserva.findMany({ where: { reservaId: row.id }, orderBy: { orden: 'asc' }, select: { tipoMime: true, contenido: true } })
      const aviso = {
        ...comun,
        duracionMinutos: row.duracionMinutos ?? 60,
        expiraEn: row.solicitudExpiraEn ?? row.fechaInicio,
        precio,
        sena: conSena && precio !== null ? senaDePrecio(precio, row.moneda ?? 'ARS') : null,
        moneda: row.moneda ?? 'ARS',
        notas: row.notas ?? null,
        imagenes: imagenes.map((imagen) => ({ tipoMime: imagen.tipoMime, contenido: Buffer.from(imagen.contenido) })),
      }
      await Promise.all(this.notificadores.map((notificador) => notificador.solicitudRecibida(aviso)))
      return
    }
    if (evento.kind === 'solicitud_respondida') {
      const [turno] = await this.agregarSenas([row], [this.mapearDetalleTurno(row, comun.prestadorNombre, { oficioNombre: row.servicioId ? oficios.get(row.servicioId) : undefined })])
      const pago = evento.resultado === 'awaiting_payment' && this.senas && turno?.sena?.estado === 'pending'
        ? await this.senas.enlaceAlAceptar(row, `turno-aceptado:${row.reservaId}`)
        : null
      const aviso = {
        reservaId: row.id,
        clienteCuentaId: row.clienteId,
        resultado: evento.resultado,
        prestadorNombre: comun.prestadorNombre,
        servicio: comun.servicio,
        inicio: row.fechaInicio,
        sena: evento.resultado === 'awaiting_payment' && turno?.sena
          ? { monto: turno.sena.monto, moneda: turno.sena.moneda, pagable: turno.sena.estado === 'pending', url: pago?.checkoutUrl ?? null }
          : null,
      } as const
      await Promise.all(this.notificadores.map((notificador) => notificador.solicitudRespondida(aviso)))
      return
    }
    if (evento.kind === 'turno_confirmado') {
      await Promise.all(this.notificadores.map((notificador) => notificador.turnoConfirmado(comun)))
      return
    }
    await Promise.all(this.notificadores.map((notificador) => notificador.turnoCancelado({ ...comun, canceladoPor: evento.canceladoPor })))
  }

  // ---- pictures of a request (TURNOS-WHATSAPP-01) --------------------------------------------

  /**
   * El cliente suma una foto a SU solicitud mientras espera respuesta: hasta dos. El archivo no es
   * confiable: tipo por contenido (JPEG, PNG, WebP), sin metadata y con tamaño acotado, la misma
   * preparación que la foto de perfil. Si el prestador ya fue avisado, se le avisa de la foto.
   */
  async adjuntarImagen(input: { clienteId: string; reservaId: string; bytes: unknown }): Promise<{ orden: number; total: number }> {
    let foto: ReturnType<typeof prepararFotoPerfil>
    try {
      foto = prepararFotoPerfil(input.bytes)
    } catch (error) {
      if (!(error instanceof ErrorFotoPerfil)) throw error
      if (error.code === 'PHOTO_TOO_LARGE') throw new ErrorCalendario(413, 'IMAGE_TOO_LARGE', 'Usá una foto de hasta 2 MB.')
      if (error.code === 'PHOTO_TYPE_NOT_ALLOWED') throw new ErrorCalendario(415, 'IMAGE_TYPE_NOT_ALLOWED', 'Usá una foto JPG, PNG o WEBP.')
      throw new ErrorCalendario(422, 'IMAGE_INVALID', 'Usá una foto JPG, PNG o WEBP de entre 96 y 4096 píxeles por lado.')
    }
    const guardada = await this.prisma.$transaction(async (tx) => {
      // The row of the request is taken: two uploads at once never leave three pictures.
      await tx.$queryRaw`SELECT 1 AS ok FROM public."reservas" WHERE "id" = ${input.reservaId} FOR UPDATE`
      const row = await tx.reserva.findFirst({ where: { id: input.reservaId, clienteId: input.clienteId, esInvitado: false } })
      // Someone else's request answers like one that does not exist.
      if (!row) throw new ErrorCalendario(404, 'NOT_FOUND', 'Solicitud no encontrada')
      if (row.estado !== 'pending' || (row.solicitudExpiraEn && row.solicitudExpiraEn.getTime() <= Date.now())) throw new ErrorCalendario(409, CODIGO_SOLICITUD_NO_PENDIENTE, 'Solo se pueden sumar fotos mientras la solicitud espera respuesta.')
      const existentes = await tx.imagenReserva.findMany({ where: { reservaId: row.id }, select: { orden: true, sha256: true } })
      const repetida = existentes.find((imagen) => imagen.sha256 === foto.sha256)
      if (repetida) return { row, orden: repetida.orden, total: existentes.length, nueva: false }
      if (existentes.length >= MAXIMO_IMAGENES_TURNO) throw new ErrorCalendario(409, 'TOO_MANY_IMAGES', `Una solicitud admite hasta ${MAXIMO_IMAGENES_TURNO} fotos.`)
      const orden = existentes.some((imagen) => imagen.orden === 0) ? 1 : 0
      await tx.imagenReserva.create({ data: { id: `img-res-${randomUUID()}`, tenantId: row.tenantId, reservaId: row.id, orden, tipoMime: foto.tipoMime, tamanoBytes: foto.tamanoBytes, ancho: foto.ancho, alto: foto.alto, sha256: foto.sha256, contenido: foto.contenido } })
      return { row, orden, total: existentes.length + 1, nueva: true }
    })
    if (guardada.nueva) void this.avisarImagen(guardada.row, { tipoMime: foto.tipoMime, contenido: foto.contenido }).catch(() => undefined)
    return { orden: guardada.orden, total: guardada.total }
  }

  private async avisarImagen(row: FilaReserva, imagen: { tipoMime: string; contenido: Buffer }): Promise<void> {
    const [prestadorCuentaId, oficios, clientes] = await Promise.all([this.cuentaPrestadorId(row.tenantId), this.nombresDeOficio([row]), this.clientesDe([row])])
    const aviso = { reservaId: row.id, prestadorCuentaId, clienteNombre: clientes.get(row.clienteId)?.nombre ?? 'Tu cliente', servicio: row.tarifaNombre ?? (row.servicioId ? oficios.get(row.servicioId) : null) ?? 'el servicio', inicio: row.fechaInicio, imagen }
    await Promise.all(this.notificadores.map((notificador) => notificador.imagenAgregada?.(aviso)))
  }

  /**
   * Una foto de una solicitud la leen solo su cliente y el prestador de ese turno.
   */
  async imagenDeTurno(input: { reservaId: string; orden: number; cuentaId: string; tenantId: string }): Promise<{ tipoMime: string; contenido: Buffer; sha256: string }> {
    const row = await this.prisma.reserva.findFirst({ where: { id: input.reservaId }, select: { id: true, clienteId: true, tenantId: true } })
    if (!row || (row.clienteId !== input.cuentaId && row.tenantId !== input.tenantId)) throw new ErrorCalendario(404, 'NOT_FOUND', 'Foto no encontrada')
    const imagen = await this.prisma.imagenReserva.findFirst({ where: { reservaId: row.id, orden: input.orden } })
    if (!imagen) throw new ErrorCalendario(404, 'NOT_FOUND', 'Foto no encontrada')
    return { tipoMime: imagen.tipoMime, contenido: Buffer.from(imagen.contenido), sha256: imagen.sha256 }
  }

  /**
   * ADMIN: por qué se puede o no cobrar la seña de cada prestador (una respuesta inequívoca, sin
   * intentar aceptar nada): por plataforma, con su cuenta, o el motivo que lo impide.
   */
  async cobroDeSenas(tenantIds: readonly string[]): Promise<Map<string, { disponible: boolean; motivo: string | null; modo: 'plataforma' | 'split' | null }>> {
    const resultado = new Map<string, { disponible: boolean; motivo: string | null; modo: 'plataforma' | 'split' | null }>()
    if (!this.senas || tenantIds.length === 0) return resultado
    const perfiles = await this.prisma.perfilPublicoPrestador.findMany({ where: { tenantId: { in: [...new Set(tenantIds)] } }, select: { tenantId: true, prestadorId: true } })
    for (const perfil of perfiles) resultado.set(perfil.tenantId, await this.senas.diagnosticoDe({ prestadorTenantId: perfil.tenantId, prestadorId: perfil.prestadorId }).catch(() => ({ disponible: false, motivo: 'UNKNOWN', modo: null })))
    return resultado
  }

  /** Cuántas fotos tiene cada solicitud (para mostrarlas en los paneles). */
  async imagenesDe(reservaIds: string[]): Promise<Map<string, number>> {
    if (reservaIds.length === 0) return new Map()
    const filas = await this.prisma.imagenReserva.groupBy({ by: ['reservaId'], where: { reservaId: { in: reservaIds } }, _count: { _all: true } })
    return new Map(filas.map((fila) => [fila.reservaId, fila._count._all]))
  }

  /**
   * Solicitudes que este prestador todavía tiene que responder (para responder por WhatsApp sin
   * abrir el panel): las suyas, vigentes, de la más próxima a la más lejana.
   */
  async solicitudesPorResponder(prestadorTenantId: string): Promise<Array<{ id: string; inicio: Date }>> {
    const filas = await this.prisma.reserva.findMany({ where: { tenantId: prestadorTenantId, estado: 'pending', solicitudExpiraEn: { gt: new Date() } }, orderBy: { fechaInicio: 'asc' }, select: { id: true, fechaInicio: true }, take: 20 })
    return filas.map((fila) => ({ id: fila.id, inicio: fila.fechaInicio }))
  }

  // Backend-owned recipient resolution. Notification callers only carry the provider tenant;
  // neither HTTP input nor an LLM may choose the account or its phone number.
  // PRESTADOR-CUENTA-01: the account LINKED to that provider (prestadores.cuenta_id), by id. A
  // provider nobody linked resolves to nobody: nothing is inferred from the tenant.
  private async cuentaPrestadorId(tenantId: string): Promise<string | null> {
    return cuentaDePrestador(this.prisma as unknown as ClientePrismaVinculoPrestador, tenantId)
  }

  private async nombresDeOficio(rows: FilaReserva[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((row) => (row.servicioId ? [row.servicioId] : [])))]
    if (ids.length === 0) return new Map()
    const oficios = await this.prisma.oficioServicio.findMany({ where: { id: { in: ids } } })
    return new Map(oficios.map((oficio) => [oficio.id, oficio.nombre]))
  }

  /**
   * Solicitudes de reserva que esperan la respuesta del prestador (las vencidas no cuentan).
   */
  async solicitudesPrestador(prestadorTenantId: string): Promise<DetalleTurno[]> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId: prestadorTenantId } })
    const rows = await this.prisma.reserva.findMany({
      where: { tenantId: prestadorTenantId, estado: 'pending', solicitudExpiraEn: { gt: new Date() } },
      orderBy: { fechaCreacion: 'asc' },
      take: 100,
    })
    return this.detallesPrestador(rows, perfil?.nombrePublico ?? 'Prestador')
  }

  /**
   * El prestador ACEPTA una solicitud: queda esperando el pago de la seña. Se decide con la
   * agenda bloqueada y volviendo a mirar el horario: si mientras tanto quedó bloqueado u ocupado,
   * no se acepta y la solicitud queda rechazada.
   */
  async aceptarSolicitud(input: { prestadorTenantId: string; reservaId: string; actorId?: string; canal?: CanalRespuestaTurno }): Promise<DetalleTurno> {
    return this.responderSolicitud({ ...input, aceptar: true })
  }

  /**
   * El prestador RECHAZA una solicitud: el horario vuelve a ofrecerse.
   */
  async rechazarSolicitud(input: { prestadorTenantId: string; reservaId: string; actorId?: string; canal?: CanalRespuestaTurno }): Promise<DetalleTurno> {
    return this.responderSolicitud({ ...input, aceptar: false })
  }

  // One use case for every channel: the panel and WhatsApp both end here, with the provider
  // taken from the session or from the account linked to the number, never from the message.
  private async responderSolicitud(input: { prestadorTenantId: string; reservaId: string; aceptar: boolean; actorId?: string; canal?: CanalRespuestaTurno }): Promise<DetalleTurno> {
    // Only a request of the session's own agenda (another provider's answers 404).
    // From WhatsApp the answer comes from a number, not from a session of the panel: it counts
    // only when the account linked to that number is THE account of that provider.
    if (input.canal === 'whatsapp' && (!input.actorId || (await this.cuentaPrestadorId(input.prestadorTenantId)) !== input.actorId)) throw new ErrorCalendario(404, 'NOT_FOUND', 'Solicitud no encontrada')
    const reserva = await this.prisma.reserva.findFirst({
      where: { OR: [{ id: input.reservaId }, { reservaId: input.reservaId }], tenantId: input.prestadorTenantId },
    })
    const calendario = reserva ? await this.prisma.calendario.findUnique({ where: { id: reserva.calendarioId } }) : null
    if (!reserva || !calendario) throw new ErrorCalendario(404, 'NOT_FOUND', 'Solicitud no encontrada')
    // Accepting opens the payment of the deposit; the verified payment is what confirms. Only a
    // turno with nothing to pay (no price, or online payments off for the whole platform) is
    // confirmed by the acceptance itself. A provider that cannot charge yet cannot accept, and
    // nobody can while TUS itself is not authorized to charge service payments in production.
    const requisito = input.aceptar && reserva.estado === 'pending' && this.senas ? await this.senas.requisitoDe(reserva) : 'sin_sena'
    if (requisito === 'bloqueada') {
      // Which of the two: the provider's identity, or nobody able to collect (no linked account
      // and no platform account). The provider is never told to link its own Mercado Pago when
      // what is missing is something else.
      const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId: reserva.tenantId }, select: { prestadorId: true } })
      const diagnostico = this.senas && perfil ? await this.senas.diagnosticoDe({ prestadorTenantId: reserva.tenantId, prestadorId: perfil.prestadorId }).catch(() => null) : null
      if (diagnostico?.motivo === 'PROVIDER_IDENTITY_NOT_VERIFIED') throw new ErrorCalendario(409, CODIGO_PRESTADOR_SIN_IDENTIDAD, 'Para aceptar turnos con seña primero tenés que verificar tu identidad en TUS. No hace falta que conectes una cuenta de Mercado Pago: TUS cobra la seña y tu parte queda en tu saldo. La solicitud sigue pendiente.')
      throw new ErrorCalendario(409, CODIGO_PRESTADOR_SIN_COBRO, 'TUS todavía no puede cobrar la seña de tus turnos: falta configurar la cuenta de cobro de la plataforma. No es algo que tengas que resolver vos ni hace falta que conectes tu Mercado Pago: avisale al equipo de TUS. La solicitud sigue pendiente.')
    }
    if (requisito === 'no_habilitada') throw new ErrorCalendario(409, CODIGO_PAGOS_SERVICIO_NO_HABILITADOS, 'Los pagos de servicios todavía no están habilitados en TUS. Por ahora no se pueden aceptar turnos con seña; la solicitud sigue pendiente.')
    const aceptado: EstadoTurno = requisito === 'exigible' ? 'awaiting_payment' : 'confirmed'
    const destino: EstadoTurno = input.aceptar ? aceptado : 'rejected'

    const resultado = await this.conAgendaBloqueada(calendario, async (tx) => {
      const ahora = new Date()
      // Read again with the agenda locked: overdue requests were just expired, and no other
      // answer, booking or block of this agenda can run until this one finishes.
      const actual = await tx.reserva.findUnique({ where: { id: reserva.id } })
      if (!actual) return { tipo: 'respondida' as const }
      // The same answer twice (double click, two tabs) is the same result, not an error.
      if (actual.estado === destino || (input.aceptar && (actual.estado === 'awaiting_payment' || actual.estado === 'confirmed'))) return { tipo: 'repetida' as const, row: actual }
      if (actual.estado === 'expired') return { tipo: 'vencida' as const }
      if (actual.estado !== 'pending') return { tipo: 'respondida' as const }
      const pasar = (estado: EstadoTurno) => tx.reserva.update({ where: { id: actual.id }, data: {
        estado,
        ...(estado === 'awaiting_payment' ? { solicitudExpiraEn: new Date(Math.min(ahora.getTime() + HORAS_VIGENCIA_PAGO_SENA_TURNO * 3_600_000, actual.fechaInicio.getTime())) } : {}),
        version: { increment: 1 }, fechaActualizacion: ahora,
      } })
      const pasarYNotificar = async (estado: 'awaiting_payment' | 'confirmed' | 'rejected') => {
        const row = await pasar(estado)
        await this.outboxNotificaciones.encolar(tx, {
          tenantId: row.tenantId,
          reservaId: row.id,
          version: row.version,
          evento: { kind: 'solicitud_respondida', reservaId: row.id, resultado: estado },
        })
        // Who answered, from where and what it became: in the same transaction as the change.
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            tenantId: row.tenantId,
            actorId: input.actorId ?? input.prestadorTenantId,
            correlationId: randomUUID(),
            eventType: 'turnos.solicitud_respondida',
            outcome: 'success',
            metadata: { reservaId: row.id, de: 'pending', a: estado, pedido: input.aceptar ? 'aceptar' : 'rechazar', canal: input.canal ?? 'web' },
            occurredAt: ahora,
          },
        })
        return row
      }
      if (!input.aceptar) return { tipo: 'hecha' as const, row: await pasarYNotificar('rejected') }
      if (actual.fechaInicio.getTime() <= ahora.getTime()) {
        await pasar('expired')
        return { tipo: 'vencida' as const }
      }
      // Still free? The request held its time against other turnos (PostgreSQL), but the provider
      // may have blocked it since. Both are looked at again here; nothing is accepted on trust.
      const bloqueo = await tx.excepcionCalendario.findFirst({
        where: { calendarioId: actual.calendarioId, estado: 'active', fechaInicio: { lt: actual.fechaFin }, fechaFin: { gt: actual.fechaInicio } },
      })
      const otro = await tx.reserva.findFirst({
        where: { calendarioId: actual.calendarioId, id: { not: actual.id }, ...queOcupan(ahora), fechaInicio: { lt: actual.fechaFin }, fechaFin: { gt: actual.fechaInicio } },
      })
      if (bloqueo || otro) return { tipo: 'ocupada' as const, row: await pasarYNotificar('rejected') }
      return { tipo: 'hecha' as const, row: await pasarYNotificar(aceptado) }
    })

    if (resultado.tipo === 'vencida') throw new ErrorCalendario(409, CODIGO_SOLICITUD_VENCIDA, 'La solicitud venció antes de ser respondida.')
    if (resultado.tipo === 'respondida') throw new ErrorCalendario(409, CODIGO_SOLICITUD_NO_PENDIENTE, 'Esa solicitud ya fue respondida.')
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId: input.prestadorTenantId } })
    const [turno] = await this.detallesPrestador([resultado.row], perfil?.nombrePublico ?? 'Prestador')
    if (resultado.tipo !== 'repetida') this.activarNotificaciones()
    // Stored as rejected (committed above); the provider is told why it could not be accepted.
    if (resultado.tipo === 'ocupada') throw new ErrorCalendario(409, CODIGO_SOLICITUD_SIN_HORARIO, 'Ese horario ya no está libre en tu agenda: la solicitud quedó rechazada.')
    return turno!
  }

  /**
   * Turnos del cliente de la sesión (solicitudes pendientes, esperando pago, confirmados e historial), con el
   * nombre del prestador y del servicio.
   */
  async turnosCliente(clienteId: string): Promise<DetalleTurno[]> {
    const rows = await this.prisma.reserva.findMany({ where: { clienteId, esInvitado: false }, orderBy: { fechaInicio: 'desc' }, take: 100 })
    const tenants = [...new Set(rows.map((row) => row.tenantId))]
    const [perfiles, oficios] = await Promise.all([
      tenants.length ? this.prisma.perfilPublicoPrestador.findMany({ where: { tenantId: { in: tenants } } }) : Promise.resolve([]),
      this.nombresDeOficio(rows),
    ])
    const perfilDe = new Map(perfiles.map((perfil) => [perfil.tenantId, perfil]))
    return this.agregarSenas(rows, rows.map((row) => {
      const perfil = perfilDe.get(row.tenantId)
      return {
        ...this.mapearDetalleTurno(row, perfil?.nombrePublico ?? 'Prestador', { oficioNombre: row.servicioId ? oficios.get(row.servicioId) : undefined }),
        // Public profile id: the link back to the professional.
        ...(perfil ? { prestadorId: perfil.id } : {}),
      }
    }))
  }

  /**
   * El cliente retira su solicitud o cancela su turno confirmado (solo el propio y antes de que
   * empiece). El horario vuelve a ofrecerse.
   */
  async cancelarTurnoCliente(input: { clienteId: string; reservaId: string }): Promise<DetalleTurno> {
    const reserva = await this.prisma.reserva.findFirst({
      where: { OR: [{ id: input.reservaId }, { reservaId: input.reservaId }], clienteId: input.clienteId, esInvitado: false },
    })
    const calendario = reserva ? await this.prisma.calendario.findUnique({ where: { id: reserva.calendarioId } }) : null
    if (!reserva || !calendario) throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')
    const resultado = await this.conAgendaBloqueada(calendario, async (tx) => {
      const ahora = new Date()
      const actual = await tx.reserva.findUnique({ where: { id: reserva.id } })
      if (!actual) throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')
      if (actual.estado === 'cancelled') return { row: actual, cambio: false }
      if ((actual.estado !== 'pending' && actual.estado !== 'awaiting_payment' && actual.estado !== 'confirmed') || actual.fechaInicio.getTime() <= ahora.getTime())
        throw new ErrorCalendario(409, CODIGO_TRANSICION_INVALIDA, 'Ese turno ya no se puede cancelar.')
      const row = await tx.reserva.update({ where: { id: actual.id }, data: { estado: 'cancelled', version: { increment: 1 }, fechaActualizacion: ahora } })
      await this.outboxNotificaciones.encolar(tx, {
        tenantId: row.tenantId,
        reservaId: row.id,
        version: row.version,
        evento: { kind: 'turno_cancelado', reservaId: row.id, canceladoPor: 'cliente' },
      })
      return { row, cambio: true }
    })
    if (resultado.cambio) this.activarNotificaciones()
    const row = resultado.row
    const [perfil, oficios] = await Promise.all([this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId: row.tenantId } }), this.nombresDeOficio([row])])
    return this.mapearDetalleTurno(row, perfil?.nombrePublico ?? 'Prestador', { oficioNombre: row.servicioId ? oficios.get(row.servicioId) : undefined })
  }

  /**
   * El cliente pide pagar la seña de SU turno aceptado: checkout de Mercado Pago de esa seña.
   * Abrirlo no paga nada: la seña figura pagada recién con la notificación verificada.
   */
  async pagarSena(input: { clienteId: string; reservaId: string; correlationId: string }): Promise<CheckoutSenaTurnoDTO> {
    if (!this.senas) throw new ErrorCalendario(503, CODIGO_PAGO_NO_DISPONIBLE, 'El pago online todavía no está disponible.')
    return this.senas.iniciarPago(input)
  }

  /** El estado real del pago de la seña de SU turno (lo informa Mercado Pago; nada que diga el cliente lo cambia). */
  async verificarPagoSena(input: { clienteId: string; reservaId: string; correlationId: string }) {
    if (!this.senas) throw new ErrorCalendario(503, CODIGO_PAGO_NO_DISPONIBLE, 'El pago online todavía no está disponible.')
    const resultado = await this.senas.verificarPago(input)
    // The payment may have been verified here before Mercado Pago's notification arrived: the
    // confirmation is told from whichever path confirmed it (the notice is the same one, once).
    await this.avisarConfirmacionDe(input.reservaId).catch(() => undefined)
    return resultado
  }

  /**
   * Encola el aviso de turno confirmado si esa reserva está confirmada. El aviso lleva la versión
   * de la reserva: pedirlo dos veces (webhook y verificación) es un solo aviso.
   */
  async avisarConfirmacionDe(reservaId: string): Promise<void> {
    const reserva = await this.prisma.reserva.findFirst({ where: { OR: [{ id: reservaId }, { reservaId }], estado: { in: ['confirmed'] }, esInvitado: false } })
    if (!reserva) return
    await this.outboxNotificaciones.encolar(this.prisma, { tenantId: reserva.tenantId, reservaId: reserva.id, version: reserva.version, evento: { kind: 'turno_confirmado', reservaId: reserva.id } })
    this.activarNotificaciones()
  }

  /**
   * Datos con los que la persona de la sesión solicita un turno (los de su cuenta, con el
   * teléfono enmascarado). Es lo que la Web muestra en lugar de pedirlos otra vez.
   */
  async solicitante(clienteId: string): Promise<SolicitanteTurnoDTO> {
    const cuenta = await this.prisma.account.findFirst({ where: { id: clienteId, status: 'active' }, include: { user: true } })
    if (!cuenta) throw new ErrorCalendario(404, 'NOT_FOUND', 'Cuenta no encontrada')
    return { nombre: nombreDeUsuario(cuenta.user), email: cuenta.user.email, telefono: cuenta.user.phoneNumber ? enmascararTelefono(cuenta.user.phoneNumber) : null }
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
    // The service is the authority: whoever calls it, a turno has a real range, a sane duration
    // and a price that is a non-negative amount.
    if (input.tarifaId && !tarifa) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'Esa tarifa no pertenece al servicio')
    if (!Number.isInteger(duracion) || duracion < 5 || duracion > 24 * 60) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'La duración no es válida')
    if (Number.isNaN(inicio.getTime())) throw new ErrorCalendario(400, 'INVALID_DATE', 'Fecha de inicio inválida')
    if (Number.isNaN(fin.getTime()) || fin <= inicio || fin.getTime() - inicio.getTime() > 24 * 60 * 60_000) throw new ErrorCalendario(400, 'INVALID_DATE', 'El fin del turno debe ser posterior al inicio')
    if (!montoValido(precio)) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'El precio no es válido')
    const nombreCliente = String(input.clienteNombre ?? '').trim()
    if (nombreCliente.length < 2 || nombreCliente.length > 120) throw new ErrorCalendario(400, 'CLIENT_REQUIRED', 'Ingresá el nombre del cliente.')
    if ((input.notas ?? '').length > 500) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'Las notas admiten hasta 500 caracteres.')
    const reservaId = `res-${randomUUID()}`
    const now = new Date()

    try {
      const row = await this.conAgendaBloqueada(calendario, async (tx) => {
        // The provider's own block also holds for the turnos it loads by hand: the block is
        // removed first, so a turno and a block never cover the same time.
        const bloqueado = await tx.excepcionCalendario.findFirst({ where: { calendarioId: calendario.id, estado: 'active', fechaInicio: { lt: fin }, fechaFin: { gt: inicio } }, select: { id: true } })
        if (bloqueado) throw new ErrorCalendario(409, 'SLOT_BLOCKED', 'Ese horario está bloqueado en tu agenda. Quitá el bloqueo para cargar el turno.')
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

    // With the agenda taken: a turno that is being booked right now and this block are decided
    // one after the other, never both.
    await this.conAgendaBloqueada(calendario, async (tx) => {
      await this.exigirSinTurnos(tx, calendario.id, inicio, fin)
      await tx.excepcionCalendario.create({
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
    })

    return { ok: true, id }
  }

  /**
   * Un bloqueo nunca tapa un turno ya tomado ni lo cancela: primero se resuelve el turno
   * (reprogramar o cancelar, avisando a la persona) y después se bloquea. Una solicitud todavía
   * sin responder no lo impide: aceptarla vuelve a mirar los bloqueos.
   */
  private async exigirSinTurnos(tx: Prisma.TransactionClient, calendarioId: string, inicio: Date, fin: Date): Promise<void> {
    const afectados = await tx.reserva.count({
      where: { calendarioId, estado: { notIn: [...ESTADOS_LIBERAN, 'pending'] }, NOT: { estado: 'awaiting_payment', solicitudExpiraEn: { lte: new Date() } }, fechaInicio: { lt: fin }, fechaFin: { gt: inicio } },
    })
    if (afectados > 0) {
      throw new ErrorCalendario(409, 'BLOCK_HAS_BOOKINGS', afectados === 1 ? 'Tenés un turno tomado en ese horario. Reprogramalo o cancelalo antes de bloquear.' : `Tenés ${afectados} turnos tomados en ese horario. Reprogramalos o cancelalos antes de bloquear.`)
    }
  }

  /**
   * Cambia un bloqueo propio (rango o motivo) con las mismas reglas que al crearlo.
   */
  async editarBloqueo(input: { prestadorTenantId: string; id: string; inicio: string; fin: string; motivo: string }): Promise<{ ok: true; id: string }> {
    const inicio = new Date(input.inicio)
    const fin = new Date(input.fin)
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || fin <= inicio) {
      throw new ErrorCalendario(400, 'INVALID_DATE', 'El fin del bloqueo debe ser posterior al inicio')
    }
    const actual = await this.prisma.excepcionCalendario.findFirst({ where: { id: input.id, tenantId: input.prestadorTenantId, estado: 'active' } })
    if (!actual) throw new ErrorCalendario(404, 'NOT_FOUND', 'Bloqueo no encontrado')
    const calendario = await this.prisma.calendario.findFirst({ where: { id: actual.calendarioId, tenantId: input.prestadorTenantId } })
    if (!calendario) throw new ErrorCalendario(404, 'NOT_FOUND', 'Bloqueo no encontrado')
    await this.conAgendaBloqueada(calendario, async (tx) => {
      await this.exigirSinTurnos(tx, calendario.id, inicio, fin)
      const { count } = await tx.excepcionCalendario.updateMany({ where: { id: input.id, tenantId: input.prestadorTenantId, estado: 'active' }, data: { fechaInicio: inicio, fechaFin: fin, motivo: input.motivo.trim().slice(0, 200) || 'Bloqueo manual' } })
      if (count === 0) throw new ErrorCalendario(404, 'NOT_FOUND', 'Bloqueo no encontrado')
    })
    return { ok: true, id: input.id }
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
    const nuevo = input.nuevoEstado
    if (!esEstadoTurno(nuevo)) throw new ErrorCalendario(400, 'INVALID_STATUS', 'Estado no reconocido')
    const calendario = await this.prisma.calendario.findUnique({ where: { id: reserva.calendarioId } })
    if (!calendario) throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')

    const resultado = await this.conAgendaBloqueada(calendario, async (tx) => {
      const actual = await tx.reserva.findUnique({ where: { id: reserva.id } })
      if (!actual) throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')
      if (actual.estado === nuevo) return { row: actual, cambio: false }
      // Nothing leaves a final state, and a request is never confirmed from here: only its
      // provider accepts it (aceptarSolicitud re-checks the time). Expiry is the system's.
      const permitidos: readonly string[] = esEstadoTurno(actual.estado) ? TRANSICIONES_TURNO[actual.estado] : []
      if (!permitidos.includes(nuevo) || nuevo === 'expired' || nuevo === 'confirmed' || nuevo === 'awaiting_payment')
        throw new ErrorCalendario(409, CODIGO_TRANSICION_INVALIDA, 'Ese turno ya no admite ese cambio de estado.')
      const row = await tx.reserva.update({
        where: { id: actual.id },
        data: {
          estado: nuevo,
          version: { increment: 1 },
          notas: input.motivo ? `${actual.notas ?? ''} [Estado: ${nuevo} - ${input.motivo}]`.trim() : actual.notas,
          fechaActualizacion: new Date(),
        },
      })
      if ((nuevo === 'cancelled' || nuevo === 'cancelled-late') && !row.esInvitado)
        await this.outboxNotificaciones.encolar(tx, {
          tenantId: row.tenantId,
          reservaId: row.id,
          version: row.version,
          evento: { kind: 'turno_cancelado', reservaId: row.id, canceladoPor: input.isAdmin ? 'administracion' : 'prestador' },
        })
      return { row, cambio: true }
    })

    const updated = resultado.row
    const [turno] = await this.detallesPrestador([updated], 'Prestador')
    if (resultado.cambio && (nuevo === 'cancelled' || nuevo === 'cancelled-late')) this.activarNotificaciones()
    return turno!
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
    if (!montoValido(input.nuevoPrecio)) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'El precio no es válido')

    const reserva = await this.prisma.reserva.findFirst({
      where: {
        OR: [{ id: input.reservaId }, { reservaId: input.reservaId }],
      },
    })

    if (!reserva) {
      throw new ErrorCalendario(404, 'NOT_FOUND', 'Turno no encontrado')
    }
    // The deposit was computed from this price and may already be paid: the price is now fixed.
    if (this.senas && (await this.senas.emitida(reserva))) {
      throw new ErrorCalendario(409, CODIGO_SENA_YA_EMITIDA, 'Ese turno ya tiene su seña emitida: el precio no se puede modificar.')
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
    const senaRequerida = this.senas ? await this.senas.requeridaPara(perfil.tenantId) : false
    return perfil.servicios.map((servicio) => ({
      senaRequerida,
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
   * Disponibilidad semanal del prestador: los horarios de cada día. `intervaloGeneral` y el
   * intervalo propio de un día son LEGACY: se siguen guardando y devolviendo por compatibilidad
   * con clientes viejos, pero ya no deciden nada (el paso entre turnos es la duración del
   * servicio más su descanso).
   */
  async disponibilidadSemanal(tenantId: string): Promise<DisponibilidadSemanalDTO> {
    const perfil = await this.prisma.perfilPublicoPrestador.findFirst({ where: { tenantId } })
    if (!perfil) throw new ErrorCalendario(404, 'NOT_FOUND', 'Perfil de prestador no encontrado')
    const calendario = await this.asegurarCalendarioPrestador(perfil.tenantId, perfil.prestadorId)
    return { intervaloGeneral: calendario.granularidadMinutos || INTERVALO_TURNO_PREDETERMINADO, horarios: await this.horariosPrestador(tenantId) }
  }

  /**
   * Guarda la disponibilidad semanal con el intervalo general (LEGACY, sin efecto en los turnos;
   * la Web actual solo envía los horarios).
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
    if (input.estado) Object.assign(where, filtroPorEstado(input.estado))
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
    const [perfiles, nombresOficio, clientes] = await Promise.all([
      tenants.length ? this.prisma.perfilPublicoPrestador.findMany({ where: { tenantId: { in: tenants } } }) : Promise.resolve([]),
      oficios.length ? this.prisma.oficioServicio.findMany({ where: { id: { in: oficios } } }) : Promise.resolve([]),
      this.clientesDe(rows),
    ])
    const perfilDe = new Map(perfiles.map((perfil) => [perfil.tenantId, perfil]))
    const oficioDe = new Map(nombresOficio.map((oficio) => [oficio.id, oficio.nombre]))

    return {
      items: await this.agregarSenas(rows, rows.map((r) => {
        const perfil = perfilDe.get(r.tenantId)
        return {
          ...this.mapearDetalleTurno(r, perfil?.nombrePublico ?? 'Prestador', { cliente: clientes.get(r.clienteId) ?? null, contacto: 'siempre' }),
          ...(perfil ? { prestadorId: perfil.id } : {}),
          ...(r.servicioId && oficioDe.has(r.servicioId) ? { oficioNombre: oficioDe.get(r.servicioId)! } : {}),
        }
      })),
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
    for (const campo of ['aceptaTurnos', 'aceptaSolicitudes'] as const) if (input[campo] !== undefined && typeof input[campo] !== 'boolean') throw new ErrorCalendario(400, 'INVALID_PARAMS', 'Valor no válido')
    if (!(await this.prisma.perfilPublicoPrestador.findUnique({ where: { id: input.perfilId }, select: { id: true } }))) throw new ErrorCalendario(404, 'NOT_FOUND', 'Prestador no encontrado')
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
    if (input.precioBase !== undefined && !montoValido(input.precioBase)) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'El precio no es válido')
    if (input.duracionMinutos !== undefined && (!Number.isInteger(input.duracionMinutos) || input.duracionMinutos < 5 || input.duracionMinutos > 24 * 60)) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'La duración no es válida')
    if (input.bufferMinutos !== undefined && (!Number.isInteger(input.bufferMinutos) || input.bufferMinutos < 0 || input.bufferMinutos > 240)) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'El descanso entre turnos no es válido')
    if (input.modalidad !== undefined && !['local', 'domicilio', 'mixto'].includes(input.modalidad)) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'La modalidad no es válida')
    for (const campo of ['turnosHabilitados', 'solicitudesHabilitadas'] as const) if (input[campo] !== undefined && typeof input[campo] !== 'boolean') throw new ErrorCalendario(400, 'INVALID_PARAMS', 'Valor no válido')
    const ofrecido = await this.prisma.perfilServicio.findUnique({ where: { perfilId_oficioId: { perfilId: input.perfilId, oficioId: input.oficioId } }, select: { oficioId: true } })
    if (!ofrecido) throw new ErrorCalendario(404, 'NOT_FOUND', 'Ese prestador no ofrece ese servicio')
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
    if (!Array.isArray(input.tarifas) || input.tarifas.length > 20) throw new ErrorCalendario(400, 'INVALID_PARAMS', 'Tarifas inválidas')
    const limpias = input.tarifas.map((tarifa, indice) => {
      const nombre = String(tarifa.nombre ?? '').trim()
      const valida =
        nombre.length >= 1 &&
        nombre.length <= 80 &&
        Number.isInteger(tarifa.duracionMinutos) &&
        tarifa.duracionMinutos >= 5 &&
        tarifa.duracionMinutos <= 24 * 60 &&
        typeof tarifa.precio === 'bigint' &&
        tarifa.precio >= 0n &&
        tarifa.precio <= BigInt(Number.MAX_SAFE_INTEGER)
      if (!valida) throw new ErrorCalendario(400, 'INVALID_PARAMS', `La tarifa ${indice + 1} no es válida`)
      return { id: tarifa.id, nombre, duracionMinutos: tarifa.duracionMinutos, precio: tarifa.precio, orden: Number.isInteger(tarifa.orden) ? tarifa.orden! : indice }
    })

    // Reemplazo atómico: o quedan las tarifas nuevas o quedan las anteriores, nunca ninguna ni una
    // mezcla. La fila del servicio del perfil se toma con FOR UPDATE: dos guardados simultáneos
    // corren de a uno, y un servicio que el perfil no ofrece no tiene tarifas.
    const rows = await this.prisma.$transaction(async (tx) => {
      const ofrecido = await tx.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM public."perfil_servicios" WHERE "perfil_id" = ${input.perfilId} AND "oficio_id" = ${input.oficioId} FOR UPDATE`
      if (ofrecido.length === 0) throw new ErrorCalendario(404, 'NOT_FOUND', 'Ese prestador no ofrece ese servicio')
      // An edited tarifa keeps its id (reservations keep a snapshot of it); any other id is new.
      const previas = await tx.tarifaServicioPrestador.findMany({ where: { perfilId: input.perfilId, oficioId: input.oficioId }, select: { id: true } })
      const propias = new Set(previas.map((previa) => previa.id))
      await tx.tarifaServicioPrestador.deleteMany({ where: { perfilId: input.perfilId, oficioId: input.oficioId } })
      const ahora = new Date()
      const nuevas = limpias.map((tarifa) => {
        const conserva = tarifa.id !== undefined && propias.delete(tarifa.id)
        return {
          id: conserva ? tarifa.id! : `tar-${randomUUID()}`,
          tenantId: input.tenantId,
          perfilId: input.perfilId,
          oficioId: input.oficioId,
          nombre: tarifa.nombre,
          duracionMinutos: tarifa.duracionMinutos,
          precio: tarifa.precio,
          activo: true,
          orden: tarifa.orden,
          fechaCreacion: ahora,
          fechaActualizacion: ahora,
        }
      })
      if (nuevas.length > 0) await tx.tarifaServicioPrestador.createMany({ data: nuevas })
      return nuevas
    })

    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      duracionMinutos: r.duracionMinutos,
      precio: Number(r.precio),
      moneda: 'ARS',
    }))
  }

  private mapearDetalleTurno(
    r: Record<string, unknown>,
    prestadorNombre: string,
    // cliente: the registered client read from its account. contacto: who is looking — the
    // provider gets the phone and email only once the turno is confirmed.
    extra: { cliente?: DatosCliente | null; contacto?: 'siempre' | 'confirmado'; oficioNombre?: string } = {}
  ): DetalleTurno {
    const vence = r['solicitudExpiraEn'] ? new Date(String(r['solicitudExpiraEn'])) : null
    // A request whose validity ran out reads as expired even before a write marks it.
    const estado = (r['estado'] === 'pending' || r['estado'] === 'awaiting_payment') && vence && vence.getTime() <= Date.now() ? 'expired' : String(r['estado'])
    const verContacto = extra.contacto !== 'confirmado' || estado === 'confirmed' || estado === 'completed'
    const cliente = extra.cliente ?? null
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
      duracionMinutos: r['duracionMinutos'] != null ? Number(r['duracionMinutos']) : Math.max(1, Math.round((new Date(String(r['fechaFin'])).getTime() - new Date(String(r['fechaInicio'])).getTime()) / 60_000)),
      precioLista: r['precioLista'] != null ? Number(r['precioLista']) : null,
      precioFinal: r['precioFinal'] != null ? Number(r['precioFinal']) : null,
      moneda: String(r['moneda'] ?? 'ARS'),
      estado,
      expiraEn: (estado === 'pending' || estado === 'awaiting_payment') && vence ? vence.toISOString() : null,
      ...(extra.oficioNombre ? { oficioNombre: extra.oficioNombre } : {}),
      clienteNombre: cliente ? cliente.nombre : r['clienteNombre'] ? String(r['clienteNombre']) : null,
      clienteTelefono: !verContacto ? null : cliente ? cliente.telefono : r['clienteTelefono'] ? String(r['clienteTelefono']) : null,
      clienteEmail: !verContacto ? null : cliente ? cliente.email : r['clienteEmail'] ? String(r['clienteEmail']) : null,
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
