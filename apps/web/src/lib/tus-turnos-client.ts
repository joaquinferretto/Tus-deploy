import {
  mensajeErrorTurno,
  type AgendaSemanal,
  type BloqueoAgendaDTO,
  type ClienteTurnosDTO,
  type CheckoutSenaTurnoDTO,
  type CrearTurnoAdmin,
  type DetalleTurno,
  type DisponibilidadTurnos,
  type HorarioSemanalDTO,
  type PaginaTurnosAdmin,
  type PrestadorTurnosDTO,
  type ServicioTurnosDTO,
  type SolicitanteTurnoDTO,
} from '@factory/contracts'

import { resolveWebApiBaseUrl } from './api-url'
import { fetchWithSession } from './session-credentials'

// Client of the turnos endpoints of the API (public booking, provider agenda, administration).
// Every call goes to the API origin (never a Web route) with the session cookie and the
// correlation id the API needs to resolve it.

export class TurnosError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'TurnosError'
  }
}

function apiBase(): string {
  return resolveWebApiBaseUrl({ canonicalUrl: process.env['NEXT_PUBLIC_API_URL'], legacyUrl: process.env['API_BASE_URL'], nodeEnv: process.env['NODE_ENV'] })
}

// Drop-in fetch for a turnos path of the API.
export function turnosFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithSession(`${apiBase()}${path}`, {
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', 'X-Correlation-Id': crypto.randomUUID(), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
}

// Message for a failed turnos response: the friendly text of its code (409 SLOT_OCCUPIED is
// "Este horario acaba de ser ocupado. Elegí otro."), never a raw server string.
export async function turnosErrorDe(response: Response, fallback?: string): Promise<TurnosError> {
  const body = (await response.json().catch(() => null)) as { code?: string; error?: unknown; fields?: unknown } | null
  const nested = typeof body?.error === 'object' && body.error !== null ? (body.error as { code?: string }).code : undefined
  const code = body?.code ?? nested ?? (response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'ERROR')
  // A refused field: the API says which one and why, in the words of the form. That beats the
  // generic text of the code ("revisá los datos") every time.
  const deCampo = response.status === 400 && Array.isArray(body?.fields) && body.fields.length > 0 && typeof body.error === 'string' && body.error.trim() ? body.error.trim() : null
  const message = code === 'UNAUTHORIZED' ? 'Tu sesión venció. Volvé a iniciar sesión.' : (deCampo ?? mensajeErrorTurno(code, fallback))
  return new TurnosError(response.status, code, message)
}

async function json<T>(path: string, init?: RequestInit, fallback?: string): Promise<T> {
  const response = await turnosFetch(path, init)
  if (!response.ok) throw await turnosErrorDe(response, fallback)
  return (await response.json()) as T
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return search.toString()
}

export const turnosApi = {
  // ---- provider (own agenda) ----
  misServicios: () => json<{ items: ServicioTurnosDTO[] }>('/tus/v1/prestador/turnos/servicios').then((result) => result.items),
  // Days and hours only: how often a turno starts is the duration of the service (decided by the API).
  miDisponibilidadSemanal: () => json<{ items: HorarioSemanalDTO[] }>('/tus/v1/prestador/turnos/horarios').then((result) => result.items),
  guardarMiDisponibilidadSemanal: (horarios: HorarioSemanalDTO[]) =>
    json<{ items: HorarioSemanalDTO[] }>('/tus/v1/prestador/turnos/horarios', { method: 'PUT', body: JSON.stringify({ horarios }) }, 'No pudimos guardar tu disponibilidad.').then(
      (result) => result.items
    ),
  miAgenda: (oficioId: string, desde: string) => json<AgendaSemanal>(`/tus/v1/prestador/turnos/agenda?${query({ oficioId, desde })}`, undefined, 'No pudimos consultar la agenda.'),
  misBloqueos: () => json<{ items: BloqueoAgendaDTO[] }>('/tus/v1/prestador/turnos/bloqueos').then((result) => result.items),
  // An absence: a whole day, some hours or several days. The API refuses one over a taken turno.
  bloquear: (cuerpo: { inicio: string; fin: string; motivo?: string }) => json<{ ok: true; id: string }>('/tus/v1/prestador/turnos/bloquear', { method: 'POST', body: JSON.stringify(cuerpo) }, 'No pudimos guardar la ausencia.'),
  editarBloqueo: (id: string, cuerpo: { inicio: string; fin: string; motivo?: string }) =>
    json<{ ok: true; id: string }>(`/tus/v1/prestador/turnos/bloqueos/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(cuerpo) }, 'No pudimos guardar la ausencia.'),
  quitarBloqueo: (id: string) => json<{ ok: true }>(`/tus/v1/prestador/turnos/bloqueos/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'No pudimos quitar el bloqueo.'),
  // Requests waiting for this provider's answer. Acceptance opens the deposit payment step.
  misSolicitudes: () => json<{ items: DetalleTurno[]; pendientes: number }>('/tus/v1/prestador/turnos/solicitudes', undefined, 'No pudimos cargar las solicitudes de reserva.'),
  aceptarSolicitud: (id: string) => json<DetalleTurno>(`/tus/v1/prestador/turnos/${encodeURIComponent(id)}/aceptar`, { method: 'POST' }, 'No pudimos aceptar la solicitud.'),
  rechazarSolicitud: (id: string) => json<DetalleTurno>(`/tus/v1/prestador/turnos/${encodeURIComponent(id)}/rechazar`, { method: 'POST' }, 'No pudimos rechazar la solicitud.'),
  // ---- client (own turnos) ----
  // Who the request is made as: the data of the session's account (never typed in a form).
  solicitante: () => json<SolicitanteTurnoDTO>('/tus/v1/cliente/turnos/solicitante'),
  // A REQUEST: it stays pending until the provider accepts it. The client is the session.
  solicitarTurno: (prestadorId: string, input: { oficioId: string; inicio: string; tarifaId?: string; notas?: string }) =>
    json<DetalleTurno>(`/tus/v1/prestadores/${encodeURIComponent(prestadorId)}/turnos/solicitudes`, { method: 'POST', body: JSON.stringify(input) }, 'No pudimos enviar la solicitud. Probá con otro horario.'),
  misTurnos: () => json<{ items: DetalleTurno[] }>('/tus/v1/cliente/turnos', undefined, 'No pudimos cargar tus turnos.').then((result) => result.items),
  cancelarMiTurno: (id: string) => json<DetalleTurno>(`/tus/v1/cliente/turnos/${encodeURIComponent(id)}/cancelar`, { method: 'POST' }, 'No pudimos cancelar el turno.'),
  pagarSena: (id: string) => json<CheckoutSenaTurnoDTO>(`/tus/v1/cliente/turnos/${encodeURIComponent(id)}/sena/checkout`, { method: 'POST' }, 'No pudimos preparar el pago de la seña.'),
  // ---- public (booking) ----
  agendaPublica: (prestadorId: string, oficioId: string, desde: string, tarifaId?: string) =>
    json<AgendaSemanal>(`/tus/v1/public/prestadores/${encodeURIComponent(prestadorId)}/turnos/agenda?${query({ oficioId, desde, tarifaId })}`, undefined, 'No pudimos consultar la agenda.'),
  // ---- administration ----
  adminListar: (input: { estado?: string; desde?: string; hasta?: string; prestadorId?: string; pagina: number; tamano: number }) =>
    json<PaginaTurnosAdmin>(`/tus/v1/admin/turnos?${query(input)}`, undefined, 'No pudimos cargar los turnos.'),
  adminPrestadores: (q: string) => json<{ items: PrestadorTurnosDTO[] }>(`/tus/v1/admin/turnos/prestadores?${query({ q })}`).then((result) => result.items),
  adminServicios: (prestadorId: string) => json<{ items: ServicioTurnosDTO[] }>(`/tus/v1/admin/turnos/prestadores/${encodeURIComponent(prestadorId)}/servicios`).then((result) => result.items),
  adminClientes: (q: string) => json<{ items: ClienteTurnosDTO[] }>(`/tus/v1/admin/turnos/clientes?${query({ q })}`).then((result) => result.items),
  adminDisponibilidad: (prestadorId: string, oficioId: string, fecha: string) =>
    json<DisponibilidadTurnos>(`/tus/v1/admin/turnos/disponibilidad?${query({ prestadorId, oficioId, fecha })}`, undefined, 'No pudimos consultar la disponibilidad.'),
  adminCrear: (input: CrearTurnoAdmin) => json<DetalleTurno>('/tus/v1/admin/turnos', { method: 'POST', body: JSON.stringify(input) }),
  adminPrecio: (id: string, precioFinal: number, motivo: string) =>
    json<DetalleTurno>(`/tus/v1/admin/turnos/${encodeURIComponent(id)}/precio`, { method: 'PATCH', body: JSON.stringify({ precioFinal, motivo }) }, 'No pudimos modificar el precio.'),
}

// Today's date in Argentina (YYYY-MM-DD), for date inputs.
export function hoyArgentina(): string {
  return new Date(Date.now() - 3 * 60 * 60_000).toISOString().slice(0, 10)
}

// A local Argentina date and time (HH:mm) as the instant the API stores.
export function instanteArgentina(fecha: string, hora: string): string {
  return new Date(`${fecha}T${hora}:00.000-03:00`).toISOString()
}

const ZONA = 'America/Argentina/Buenos_Aires'
export const horaTurno = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA })
// "viernes 2 de octubre"
export const diaTurno = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA })
export const fechaTurno = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZONA })
