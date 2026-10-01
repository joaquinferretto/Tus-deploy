// Turnos (appointments) of TUS: ONE contract shared by the API and the Web. A turno is a row of
// the existing calendar/reservations domain (calendarios, reglas_calendario, reservas): there is
// no parallel "turnos" store. Availability always comes from the backend; PostgreSQL forbids two
// overlapping reservations in the same calendar.

import type { DetalleTurno, SlotDisponible, TarifaServicioPublica } from './tus-directorio.ts'

// The slot was free when shown and was taken by someone else before this request was stored.
export const CODIGO_HORARIO_OCUPADO = 'SLOT_OCCUPIED'
// The requested time is not part of the provider's real availability.
export const CODIGO_HORARIO_NO_DISPONIBLE = 'SLOT_NOT_AVAILABLE'

export const MENSAJE_HORARIO_OCUPADO = 'Este horario acaba de ser ocupado. Elegí otro.'
export const MENSAJE_HORARIO_NO_DISPONIBLE = 'Ese horario ya no está disponible. Elegí otro.'

export function mensajeErrorTurno(code: string | undefined, fallback = 'No pudimos guardar el turno. Probá de nuevo en unos minutos.'): string {
  if (code === CODIGO_HORARIO_OCUPADO) return MENSAJE_HORARIO_OCUPADO
  if (code === CODIGO_HORARIO_NO_DISPONIBLE) return MENSAJE_HORARIO_NO_DISPONIBLE
  if (code === 'MOTIVO_REQUIRED') return 'Escribí el motivo (al menos 5 caracteres): queda registrado en la auditoría.'
  if (code === 'TURNOS_DISABLED' || code === 'SERVICE_TURNOS_DISABLED') return 'Ese profesional no ofrece turnos para ese servicio.'
  if (code === 'CLIENT_REQUIRED' || code === 'CLIENTE_REQUERIDO') return 'Elegí un cliente registrado o cargá el nombre del invitado.'
  if (code === 'INVALID_DATE' || code === 'PAST_DATE') return 'Elegí una fecha y hora futuras.'
  if (code === 'NOT_FOUND') return 'No encontramos ese prestador, servicio o turno.'
  if (code === 'FORBIDDEN') return 'Tu cuenta no tiene permiso para hacer eso.'
  if (code === 'INVALID_PARAMS' || code === 'INVALID_REQUEST') return 'Revisá los datos del turno.'
  return fallback
}

export interface DisponibilidadTurnos {
  slots: SlotDisponible[]
  duracionMinutos: number
  tarifas: TarifaServicioPublica[]
  mensaje?: string
}

// ---- weekly hours of a provider ----------------------------------------------------------------

export interface HorarioSemanalDTO {
  // 0 = domingo ... 6 = sábado
  diaSemana: number
  horaInicio: string
  horaFin: string
  // Own interval of that day; absent or null = the general interval of the agenda.
  intervaloMinutos?: number | null
}

// How often a turno may START. It is not the duration of the service: a start is offered only
// when start + duration of the service still fits inside the working hours.
export const INTERVALOS_TURNO = [15, 30, 60, 90, 120] as const
export type IntervaloTurno = (typeof INTERVALOS_TURNO)[number]
export const INTERVALO_TURNO_PREDETERMINADO: IntervaloTurno = 15

export const esIntervaloTurno = (value: unknown): value is IntervaloTurno => (INTERVALOS_TURNO as readonly unknown[]).includes(value)

export function etiquetaIntervalo(minutos: number): string {
  if (minutos < 60) return `${minutos} minutos`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return `${horas} ${horas === 1 ? 'hora' : 'horas'}${resto ? ` ${resto} minutos` : ''}`
}

// The weekly availability a provider configures: ONE general interval and, per day, its hours and
// (optionally) its own interval. A day without hours is a day off.
export interface DisponibilidadSemanalDTO {
  intervaloGeneral: number
  horarios: HorarioSemanalDTO[]
}

const minutosDe = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5))
export const horaDeMinutos = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`

// Starts (HH:mm) of one range of hours: every `intervalo` minutes from the opening time while the
// whole service still ends inside the range. The single rule the API generates turnos with.
export function iniciosDeFranja(horaInicio: string, horaFin: string, intervaloMinutos: number, duracionMinutos: number): string[] {
  if (!Number.isInteger(intervaloMinutos) || intervaloMinutos < 1 || !Number.isInteger(duracionMinutos) || duracionMinutos < 1) return []
  const fin = minutosDe(horaFin)
  const inicios: string[] = []
  for (let minuto = minutosDe(horaInicio); minuto + duracionMinutos <= fin; minuto += intervaloMinutos) inicios.push(horaDeMinutos(minuto))
  return inicios
}

export const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const

export type ResultadoHorarios = { ok: true; valor: HorarioSemanalDTO[] } | { ok: false; motivo: 'formato' | 'rango' | 'solapados' | 'demasiados' | 'intervalo' }

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/u

// One validation for the API and the Web: HH:mm, start before end, no overlap within a day, and
// one interval per day (general, or one of INTERVALOS_TURNO).
export function validarHorariosSemanales(input: unknown): ResultadoHorarios {
  if (!Array.isArray(input)) return { ok: false, motivo: 'formato' }
  if (input.length > 28) return { ok: false, motivo: 'demasiados' }
  const valor: HorarioSemanalDTO[] = []
  for (const item of input as Record<string, unknown>[]) {
    const diaSemana = Number(item?.['diaSemana'])
    const horaInicio = String(item?.['horaInicio'] ?? '')
    const horaFin = String(item?.['horaFin'] ?? '')
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6 || !HORA.test(horaInicio) || !HORA.test(horaFin)) return { ok: false, motivo: 'formato' }
    if (horaInicio >= horaFin) return { ok: false, motivo: 'rango' }
    const intervalo = item?.['intervaloMinutos'] ?? null
    if (intervalo !== null && !esIntervaloTurno(intervalo)) return { ok: false, motivo: 'intervalo' }
    valor.push({ diaSemana, horaInicio, horaFin, intervaloMinutos: intervalo })
  }
  valor.sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio))
  for (let index = 1; index < valor.length; index += 1) {
    const anterior = valor[index - 1]!
    const actual = valor[index]!
    if (anterior.diaSemana === actual.diaSemana && actual.horaInicio < anterior.horaFin) return { ok: false, motivo: 'solapados' }
    // The interval belongs to the day, not to each range of hours.
    if (anterior.diaSemana === actual.diaSemana && anterior.intervaloMinutos !== actual.intervaloMinutos) return { ok: false, motivo: 'intervalo' }
  }
  return { ok: true, valor }
}

// ---- weekly agenda ----------------------------------------------------------------------------

// disponible: can be booked. ocupado: taken by a reservation (its whole duration). bloqueado: an
// exception of the calendar (holiday, vacation, manual block). pasado: already gone.
export type EstadoFranjaAgenda = 'disponible' | 'ocupado' | 'bloqueado' | 'pasado'

export interface FranjaAgenda {
  inicio: string
  fin: string
  // Local time of the agenda (HH:mm), the row of the weekly grid.
  hora: string
  estado: EstadoFranjaAgenda
}

// laboral: the provider works that day. no_laboral: day off in the weekly configuration.
// bloqueado: a working day entirely closed by an exception. pasado: before today.
export type EstadoDiaAgenda = 'laboral' | 'no_laboral' | 'bloqueado' | 'pasado'

export interface DiaAgenda {
  fecha: string
  diaSemana: number
  estado: EstadoDiaAgenda
  // Only starts where the whole service fits inside the working hours (never an impossible one).
  franjas: FranjaAgenda[]
}

export interface AgendaSemanal {
  desde: string
  hasta: string
  duracionMinutos: number
  tarifas: TarifaServicioPublica[]
  dias: DiaAgenda[]
  mensaje?: string
}

export const DIAS_AGENDA = 7
// How far ahead a week of the agenda may be asked for.
export const MAXIMO_DIAS_ADELANTE_AGENDA = 180

// Monday of the week of a YYYY-MM-DD date.
export function lunesDe(fecha: string): string {
  const dia = new Date(`${fecha}T12:00:00.000Z`)
  dia.setUTCDate(dia.getUTCDate() - ((dia.getUTCDay() + 6) % 7))
  return dia.toISOString().slice(0, 10)
}

export function sumarDias(fecha: string, dias: number): string {
  const dia = new Date(`${fecha}T12:00:00.000Z`)
  dia.setUTCDate(dia.getUTCDate() + dias)
  return dia.toISOString().slice(0, 10)
}

// A block of the agenda as its owner sees it.
export interface BloqueoAgendaDTO {
  id: string
  inicio: string
  fin: string
  motivo: string
}

// ---- services of a provider that can take turnos -----------------------------------------------

export interface ServicioTurnosDTO {
  oficioId: string
  nombre: string
  turnosHabilitados: boolean
  duracionMinutos: number
  precioBase: number | null
  tarifas: TarifaServicioPublica[]
}

// ---- administration ----------------------------------------------------------------------------

export interface PrestadorTurnosDTO {
  // Public profile id (the same id the directory and the booking endpoints use).
  id: string
  nombre: string
  oficioPrincipal: string
  zona: string | null
  aceptaTurnos: boolean
  visible: boolean
}

// A registered client as the admin search shows it (contact masked).
export interface ClienteTurnosDTO {
  cuentaId: string
  nombre: string
  email: string
  telefono: string | null
}

export type TipoTurnoAdmin = 'general' | 'forzado'

// The client of a turno created by an administrator: a registered account (resolved by the API
// from its id) or, explicitly, a guest with a name.
export type ClienteTurnoAdmin = { tipo: 'registrado'; cuentaId: string } | { tipo: 'invitado'; nombre: string; telefono?: string; email?: string }

export interface CrearTurnoAdmin {
  // general: only a slot of the provider's real availability. forzado: any future time, with a
  // mandatory audited reason. Neither may overlap another reservation.
  tipo: TipoTurnoAdmin
  prestadorId: string
  oficioId: string
  tarifaId?: string
  inicio: string
  cliente: ClienteTurnoAdmin
  motivo?: string
  notas?: string
}

export interface PaginaTurnosAdmin {
  items: DetalleTurno[]
  total: number
  pagina: number
  totalPaginas: number
}
