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
  if (code === CODIGO_SESION_REQUERIDA) return 'Iniciá sesión para solicitar el turno.'
  if (code === CODIGO_SOLICITUD_NO_PENDIENTE) return 'Esa solicitud ya fue respondida.'
  if (code === CODIGO_SOLICITUD_VENCIDA) return 'Esa solicitud venció antes de ser respondida.'
  if (code === CODIGO_DEMASIADAS_SOLICITUDES) return 'Ya tenés varias solicitudes pendientes con este profesional. Esperá su respuesta o cancelá alguna.'
  if (code === CODIGO_TRANSICION_INVALIDA) return 'Ese turno ya no admite ese cambio.'
  if (code === CODIGO_SOLICITUD_SIN_HORARIO) return 'Ese horario ya no está libre en tu agenda: la solicitud quedó rechazada.'
  if (code === CODIGO_PRESTADOR_SIN_COBRO) return 'TUS todavía no puede cobrar la seña de tus turnos: falta configurar la cuenta de cobro de la plataforma. No es algo que tengas que resolver vos ni hace falta que conectes tu Mercado Pago: avisale al equipo de TUS. La solicitud sigue pendiente.'
  if (code === CODIGO_PRESTADOR_SIN_IDENTIDAD) return 'Para aceptar turnos con seña primero tenés que verificar tu identidad en TUS. No hace falta que conectes una cuenta de Mercado Pago: TUS cobra la seña y tu parte queda en tu saldo. La solicitud sigue pendiente.'
  if (code === CODIGO_PAGOS_SERVICIO_NO_HABILITADOS) return 'Los pagos de servicios todavía no están habilitados en TUS. Por ahora no se pueden aceptar turnos con seña; la solicitud sigue pendiente.'
  if (code === CODIGO_SENA_NO_PAGABLE) return 'La seña de ese turno no se puede pagar ahora.'
  if (code === CODIGO_SENA_YA_PAGADA) return 'La seña de ese turno ya está pagada.'
  if (code === CODIGO_PAGO_NO_DISPONIBLE) return 'El pago online todavía no está disponible para ese profesional. Coordiná la seña directamente con él.'
  if (code === CODIGO_SENA_YA_EMITIDA) return 'Ese turno ya tiene su seña emitida: el precio no se puede modificar.'
  // PAGOS-MODALIDAD-01 / CIERRE-TRABAJO-01.
  if (code === 'PAYMENT_MODALITY_FIXED') return 'Ya hay un pago aprobado para este turno: la forma de pago no se puede cambiar.'
  if (code === 'ALREADY_PAID') return 'Ese turno ya está pagado por completo.'
  if (code === 'BALANCE_NOT_AVAILABLE') return 'El saldo se puede pagar cuando el turno se haya prestado y esté confirmado.'
  if (code === 'FINALIZATION_REQUIRED') return 'Este turno se pagó por TUS: finalizalo contando qué se hizo, y el cliente lo confirma.'
  if (code === 'EVIDENCE_REQUIRED') return 'Contá qué se hizo en al menos 10 caracteres.'
  if (code === 'REASON_REQUIRED') return 'Contanos el problema en al menos 10 caracteres.'
  if (code === 'OBSERVATION_OPEN') return 'Hay un problema reportado que TUS está revisando.'
  if (code === 'ALREADY_CONFIRMED') return 'Ya estaba confirmado.'
  if (code === 'APPOINTMENT_NOT_STARTED') return 'El turno todavía no empezó.'
  if (code === 'APPOINTMENT_NOT_CONFIRMED') return 'Solo se puede finalizar un turno confirmado.'
  if (code === 'WORK_NOT_FINISHED') return 'El prestador todavía no lo marcó como finalizado.'
  return fallback
}

// ---- states of a turno --------------------------------------------------------------------------
// A client never confirms a turno: it REQUESTS it. The row is born `pending` (it holds its time
// until the request is answered or its validity runs out). Provider acceptance opens payment and
// only the verified deposit event turns it into `confirmed`. reservas.estado is the source of truth.
// The one case where the acceptance itself confirms is a turno with NO deposit to pay (no price,
// or online payments switched off for the whole platform): there is nothing to wait for. With
// payments on, a provider that cannot charge (no Mercado Pago account, identity not verified)
// cannot accept: the turno is never confirmed for free (same rule as W09-05).

export const ESTADOS_TURNO = ['pending', 'awaiting_payment', 'confirmed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed'] as const
export type EstadoTurno = (typeof ESTADOS_TURNO)[number]

// States that give the time back. The same list as the predicate of ex_reservas_sin_solapamiento.
export const ESTADOS_TURNO_LIBERAN = ['cancelled', 'cancelled-late', 'no-show', 'rejected', 'expired'] as const satisfies readonly EstadoTurno[]

// Allowed changes of state. Nothing leaves a final state.
export const TRANSICIONES_TURNO: Record<EstadoTurno, readonly EstadoTurno[]> = {
  pending: ['awaiting_payment', 'confirmed', 'rejected', 'cancelled', 'expired'],
  awaiting_payment: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['completed', 'cancelled', 'cancelled-late', 'no-show'],
  rejected: [],
  expired: [],
  cancelled: [],
  'cancelled-late': [],
  'no-show': [],
  completed: [],
}

export const esEstadoTurno = (value: unknown): value is EstadoTurno => (ESTADOS_TURNO as readonly unknown[]).includes(value)

const ETIQUETAS_ESTADO_TURNO: Record<EstadoTurno, string> = {
  pending: 'Pendiente de respuesta',
  awaiting_payment: 'Esperando pago de seña',
  confirmed: 'Turno confirmado',
  rejected: 'Rechazada',
  expired: 'Vencida',
  cancelled: 'Cancelada',
  'cancelled-late': 'Cancelada fuera de término',
  'no-show': 'Ausente',
  completed: 'Completada',
}

export const etiquetaEstadoTurno = (estado: string): string => (esEstadoTurno(estado) ? ETIQUETAS_ESTADO_TURNO[estado] : estado)

// How long a request holds its time waiting for the provider (never beyond the start of the turno).
export const HORAS_VIGENCIA_SOLICITUD_TURNO = 24
// The same hold window starts again when the provider accepts and the deposit becomes due.
export const HORAS_VIGENCIA_PAGO_SENA_TURNO = HORAS_VIGENCIA_SOLICITUD_TURNO
// Requests one client may have waiting in the same agenda at once.
export const MAXIMO_SOLICITUDES_PENDIENTES_POR_AGENDA = 3

export const CODIGO_SESION_REQUERIDA = 'LOGIN_REQUIRED'
export const CODIGO_SOLICITUD_NO_PENDIENTE = 'REQUEST_NOT_PENDING'
export const CODIGO_SOLICITUD_VENCIDA = 'REQUEST_EXPIRED'
export const CODIGO_DEMASIADAS_SOLICITUDES = 'TOO_MANY_PENDING_REQUESTS'
export const CODIGO_TRANSICION_INVALIDA = 'INVALID_TRANSITION'
// The provider accepted a request whose time is no longer free in its agenda: stored as rejected.
export const CODIGO_SOLICITUD_SIN_HORARIO = 'REQUEST_SLOT_UNAVAILABLE'
// The turno has a deposit and its provider cannot charge it yet: the request stays pending.
// The deposit cannot be charged for this provider because NOBODY can collect it: the provider has
// no Mercado Pago account linked AND TUS has no platform account configured. A provider never
// needs its own account when the platform collects (its share becomes its balance).
export const CODIGO_PRESTADOR_SIN_COBRO = 'PROVIDER_PAYMENT_ACCOUNT_REQUIRED'
// The provider's identity is not verified yet: money is only collected for a verified person.
export const CODIGO_PRESTADOR_SIN_IDENTIDAD = 'PROVIDER_IDENTITY_REQUIRED'
// The turno has a deposit and TUS itself may not charge service payments yet (production without
// the `service-payments` readiness authorization): the request stays pending, never confirmed.
export const CODIGO_PAGOS_SERVICIO_NO_HABILITADOS = 'SERVICE_PAYMENTS_NOT_AUTHORIZED'

// ---- deposit of a turno (TURNOS-SENA-01) -------------------------------------------------------
// The deposit ("seña") of a turno is half of its price. Nothing of it is stored on the
// reservation: the amount derives from reservas.precio_final (one rule, in the backend) and the
// status from the payment obligation of the turno, which only Mercado Pago's verified
// notification moves to `paid`.
//   not_due         still a request: the deposit is asked once the provider accepts
//   unavailable     accepted, but online payment is not available for that provider yet
//   pending         accepted: the deposit can be paid now
//   paid | refunded | charged_back   as Mercado Pago reported
// A turno without a deposit (no price, a guest or manual turno, or one that ended without paying
// it) simply has none: `sena` is null.
export const ESTADOS_SENA_TURNO = ['not_due', 'unavailable', 'pending', 'paid', 'refunded', 'charged_back'] as const
export type EstadoSenaTurno = (typeof ESTADOS_SENA_TURNO)[number]

export interface SenaTurnoDTO {
  // In pesos (it may carry cents when the price is odd).
  monto: number
  moneda: string
  estado: EstadoSenaTurno
}

// PAGOS-MODALIDAD-01. The whole financial state of a turno, derived by the backend from its
// obligations, its closing and its settlements. Amounts in pesos (they may carry cents).
//   modalidad       how it is being paid: fixed once a payment is approved; before that, the one
//                   whose checkout is prepared (null: nothing chosen yet, the deposit is the default)
//   saldoPendiente  total - pagado, never negative
//   proximo         what can be paid NOW (the active obligation), null when nothing can
//   opciones        the ways of paying the client may still choose (empty once a payment is approved)
//   cierre          finished by the provider / confirmed / observed (null: not finished yet)
//   fondos          'retenidos' while TUS holds what was paid, 'liberados' once the provider can
//                   withdraw it (null: nothing was paid through TUS)
export type TramoPagoTurno = 'sena' | 'total' | 'saldo'
export interface CierreTurnoDTO {
  finalizadoEn: string
  confirmacionVenceEn: string
  confirmadoEn: string | null
  confirmacionOrigen: 'cliente' | 'automatica' | 'pago_final' | null
  observacionAbierta: boolean
  observacionMotivo: string | null
}
export interface PagoTurnoDTO {
  moneda: string
  modalidad: 'sena' | 'total' | null
  total: number
  pagado: number
  saldoPendiente: number
  proximo: { tramo: TramoPagoTurno; monto: number } | null
  opciones: ('sena' | 'total')[]
  cierre: CierreTurnoDTO | null
  fondos: 'retenidos' | 'liberados' | null
}

// Answer of "pay the deposit": the hosted Mercado Pago checkout of THAT deposit. Opening it pays
// nothing by itself: the turno shows `paid` only after the verified notification.
export interface CheckoutSenaTurnoDTO {
  checkoutUrl: string
  monto: number
  moneda: string
}

export const CODIGO_SENA_NO_PAGABLE = 'DEPOSIT_NOT_PAYABLE'
export const CODIGO_SENA_YA_PAGADA = 'DEPOSIT_ALREADY_PAID'
export const CODIGO_PAGO_NO_DISPONIBLE = 'PAYMENT_NOT_AVAILABLE'
// The price of a turno cannot change once its deposit was issued.
export const CODIGO_SENA_YA_EMITIDA = 'DEPOSIT_ALREADY_ISSUED'

const ETIQUETAS_SENA_TURNO: Record<EstadoSenaTurno, string> = {
  not_due: 'Se abona cuando el prestador acepte',
  unavailable: 'Se coordina con el prestador',
  pending: 'Pendiente de pago',
  paid: 'Pagada',
  refunded: 'Reintegrada',
  charged_back: 'Desconocida por el medio de pago',
}

export const etiquetaSenaTurno = (estado: string): string => ((ESTADOS_SENA_TURNO as readonly string[]).includes(estado) ? ETIQUETAS_SENA_TURNO[estado as EstadoSenaTurno] : estado)

// "$25.000", "$12.500,50": how a price in pesos is shown to a person, everywhere.
export function formatearPesos(monto: number): string {
  const [entero, decimales] = (Math.round(monto * 100) / 100).toFixed(2).split('.')
  const miles = entero!.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')
  return `$${miles}${decimales === '00' ? '' : `,${decimales}`}`
}

// What a signed-in person sees before requesting ("Solicitás el turno como"): data of the
// account of the session, with the phone masked. Never typed again, never sent by the browser.
export interface SolicitanteTurnoDTO {
  nombre: string
  email: string
  telefono: string | null
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
  // LEGACY compatibility field. The API keeps accepting/persisting it, but slot generation does
  // not read it: starts are separated by service duration + rest.
  intervaloMinutos?: number | null
}

// LEGACY interval values kept for older clients and stored calendars. New UIs do not expose them.
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

// Compatibility DTO: the provider configures weekly hours; interval fields remain in the public
// shape for older clients but no longer control slot generation.
export interface DisponibilidadSemanalDTO {
  intervaloGeneral: number
  horarios: HorarioSemanalDTO[]
}

const minutosDe = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5))
export const horaDeMinutos = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`

// Starts (HH:mm) of one range of hours: every `intervalo` minutes from the opening time while the
// whole service still ends inside the range. Slot generation passes duration + rest as intervalo.
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

// One validation for the API and the Web: HH:mm, start before end and no overlap within a day.
// A legacy interval, when an older client sends it, must still be valid and consistent per day.
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
  // Price (pesos) of what the agenda was asked for (the chosen variant, or the service itself)
  // and the deposit the backend computes from it. sena: null when no deposit will be asked
  // (no price, or online payments off). Never computed by the Web.
  precio?: number | null
  sena?: number | null
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
  // A turno of this provider is confirmed by paying its deposit (online payments are on).
  senaRequerida?: boolean
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
