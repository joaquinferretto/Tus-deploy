import type {
  AlojamientoPropioDTO,
  AlojamientoPublicoDTO,
  BloqueoUnidadDTO,
  MiReservaAlojamientoDTO,
  DetalleAlojamientoPublicoDTO,
  FiltrosBusquedaAlojamientos,
  ReservaAlojamientoDTO,
  TipoAlojamientoDTO,
  CrearHoldReservaInput,
  CalificarAlojamientoInput,
} from '@factory/contracts'

import { resolveWebApiBaseUrl } from '../../lib/api-url'
import { fetchWithSession } from '../../lib/session-credentials'

// What the API answered when it refused: the status and the code decide what the screen offers
// (sign in, pick other dates); the message is already written for a person.
export class ErrorAlojamientos extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly campo: string | null = null) {
    super(message)
  }
}

// Uploaded photos are served by the API: their stored path becomes a full address here.
const RUTA_FOTOS = '/api/alojamientos/imagenes/'
const conFotos = <T>(data: T, baseUrl: string): T => JSON.parse(JSON.stringify(data), (_clave, valor) => (typeof valor === 'string' && valor.startsWith(RUTA_FOTOS) ? `${baseUrl}${valor}` : valor)) as T

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // `path` is the full API path (/api/alojamientos/...), never a Web route.
  const baseUrl = resolveWebApiBaseUrl({ canonicalUrl: process.env['NEXT_PUBLIC_API_URL'], legacyUrl: process.env['API_BASE_URL'], nodeEnv: process.env['NODE_ENV'] })
  // The HttpOnly session cookie authenticates; the API requires X-Correlation-Id to resolve it.
  const res = await fetchWithSession(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Correlation-Id': crypto.randomUUID(),
      ...options.headers,
    },
  })

  if (!res.ok) {
    let errorData: { error?: { code?: string; message?: string; fields?: string[] } } = {}
    try {
      errorData = await res.json()
    } catch {
      // fallback
    }
    throw new ErrorAlojamientos(errorData.error?.message || 'No pudimos completar la operación. Probá de nuevo.', res.status, errorData.error?.code ?? 'UNKNOWN', errorData.error?.fields?.[0] ?? null)
  }

  return conFotos((await res.json()) as T, baseUrl)
}

export async function listarTiposAlojamiento(): Promise<TipoAlojamientoDTO[]> {
  const data = await apiFetch<{ items: TipoAlojamientoDTO[] }>('/api/alojamientos/tipos')
  return data.items
}

export async function buscarAlojamientos(
  filtros: FiltrosBusquedaAlojamientos = {},
  opciones: { signal?: AbortSignal } = {}
): Promise<AlojamientoPublicoDTO[]> {
  const params = new URLSearchParams()
  if (filtros.q?.trim()) params.set('q', filtros.q.trim())
  if (filtros.zonaId) params.set('zonaId', filtros.zonaId)
  if (filtros.barrioId) params.set('barrioId', filtros.barrioId)
  if (filtros.tipoSlug) params.set('tipoSlug', filtros.tipoSlug)
  if (filtros.checkIn) params.set('checkIn', filtros.checkIn)
  if (filtros.checkOut) params.set('checkOut', filtros.checkOut)
  if (filtros.personas) params.set('personas', String(filtros.personas))
  if (filtros.precioMin) params.set('precioMin', String(filtros.precioMin))
  if (filtros.precioMax) params.set('precioMax', String(filtros.precioMax))

  const qs = params.toString() ? `?${params.toString()}` : ''
  const data = await apiFetch<{ items: AlojamientoPublicoDTO[] }>(`/api/alojamientos/${qs}`, opciones.signal ? { signal: opciones.signal } : {})
  return data.items
}

export async function obtenerDetalleAlojamiento(
  idOrSlug: string,
  opciones: { checkIn?: string; checkOut?: string; personas?: number; horas?: number } = {}
): Promise<DetalleAlojamientoPublicoDTO> {
  const params = new URLSearchParams()
  if (opciones.checkIn) params.set('checkIn', opciones.checkIn)
  if (opciones.checkOut) params.set('checkOut', opciones.checkOut)
  if (opciones.personas) params.set('personas', String(opciones.personas))
  if (opciones.horas) params.set('horas', String(opciones.horas))

  const qs = params.toString() ? `?${params.toString()}` : ''
  return apiFetch<DetalleAlojamientoPublicoDTO>(`/api/alojamientos/${idOrSlug}${qs}`)
}

export async function crearHoldReserva(input: CrearHoldReservaInput): Promise<ReservaAlojamientoDTO> {
  return apiFetch<ReservaAlojamientoDTO>('/api/alojamientos/reservas/hold', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function obtenerPreferenciaCheckout(reservaId: string): Promise<{
  preferenceId: string
  initPoint: string
  sandboxInitPoint: string
}> {
  return apiFetch(`/api/alojamientos/reservas/${reservaId}/checkout-preference`, {
    method: 'POST',
  })
}

export async function simularPagoReserva(reservaId: string): Promise<{ ok: boolean; reserva: ReservaAlojamientoDTO }> {
  return apiFetch(`/api/alojamientos/reservas/${reservaId}/simular-pago`, {
    method: 'POST',
  })
}

export async function calificarAlojamiento(input: CalificarAlojamientoInput): Promise<{ ok: boolean }> {
  return apiFetch('/api/alojamientos/calificar', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function adminCrearAlojamiento(input: {
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
}): Promise<{ id: string; slug: string }> {
  return apiFetch<{ id: string; slug: string }>('/api/alojamientos/', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function adminCrearUnidad(
  alojamientoId: string,
  input: {
    nombre: string
    descripcion?: string
    capacidadPersonas?: number
    camasDetalle?: string
    banosCantidad?: number
    comodidades?: string[]
  }
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/alojamientos/${alojamientoId}/unidades`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function adminCrearTarifa(
  unidadId: string,
  input: {
    modalidad?: string
    duracionHoras?: number
    precio: number
    moneda?: string
    diasSemana?: number[]
    minimoEstadia?: number
    maximoEstadia?: number
  }
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/alojamientos/unidades/${unidadId}/tarifas`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function adminCrearBloqueo(
  unidadId: string,
  input: {
    fechaInicio: string
    fechaFin: string
    motivo: string
  }
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/alojamientos/unidades/${unidadId}/bloquear`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function adminListarReservas(alojamientoId: string): Promise<ReservaAlojamientoDTO[]> {
  const data = await apiFetch<{ items: ReservaAlojamientoDTO[] }>(`/api/alojamientos/${alojamientoId}/reservas`)
  return data.items
}

// ---- ALOJAMIENTOS-GESTION-01: the guest's reservations and the owner's alojamientos -------------

export interface ReservarAlojamientoInput {
  unidadId: string
  alojamientoId: string
  clienteNombre: string
  clienteEmail?: string
  clienteTelefono?: string
  // Calendar dates (YYYY-MM-DD): the day of arrival and the day of departure.
  fechaInicio: string
  fechaFin: string
  cantidadPersonas: number
  notas?: string
}

// Reserves with the account of the session: confirmed at once, paid at the place.
export async function reservarAlojamiento(input: ReservarAlojamientoInput): Promise<ReservaAlojamientoDTO> {
  return apiFetch<ReservaAlojamientoDTO>('/api/alojamientos/reservas', { method: 'POST', body: JSON.stringify(input) })
}

export async function misReservasAlojamiento(): Promise<MiReservaAlojamientoDTO[]> {
  return (await apiFetch<{ items: MiReservaAlojamientoDTO[] }>('/api/alojamientos/reservas/mias')).items
}

export async function cancelarMiReserva(reservaId: string, motivo?: string): Promise<void> {
  await apiFetch(`/api/alojamientos/reservas/${encodeURIComponent(reservaId)}/cancelar`, { method: 'POST', body: JSON.stringify(motivo?.trim() ? { motivo: motivo.trim() } : {}) })
}

export interface AlojamientoPropioForm {
  tipoId: string
  nombre: string
  descripcion?: string
  direccion: string
  barrioId: string
  checkInHora: string
  checkOutHora: string
  politicas?: string
  comodidades: string[]
  capacidadPersonas: number
  camasDetalle?: string
  banosCantidad: number
  precioNoche: number
}

export async function listarBarriosAlojamiento(): Promise<Array<{ id: string; nombre: string; zona: string | null }>> {
  return (await apiFetch<{ items: Array<{ id: string; nombre: string; zona: string | null }> }>('/api/alojamientos/barrios')).items
}

export async function misAlojamientos(): Promise<AlojamientoPropioDTO[]> {
  return (await apiFetch<{ items: AlojamientoPropioDTO[] }>('/api/alojamientos/mios')).items
}

export async function crearMiAlojamiento(form: AlojamientoPropioForm): Promise<{ id: string; slug: string }> {
  return apiFetch('/api/alojamientos/mios', { method: 'POST', body: JSON.stringify(form) })
}

export async function editarMiAlojamiento(id: string, form: AlojamientoPropioForm): Promise<void> {
  await apiFetch(`/api/alojamientos/mios/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(form) })
}

export async function publicarMiAlojamiento(id: string, publicado: boolean): Promise<{ estado: string; publicado: boolean }> {
  return apiFetch(`/api/alojamientos/${encodeURIComponent(id)}/publicacion`, { method: 'POST', body: JSON.stringify({ publicado }) })
}

// The photo travels as raw bytes: the API decides its type by its content.
export async function subirFotoAlojamiento(id: string, archivo: Blob): Promise<{ id: string; url: string }> {
  return apiFetch(`/api/alojamientos/${encodeURIComponent(id)}/fotos`, { method: 'POST', body: archivo, headers: { 'Content-Type': 'application/octet-stream' } })
}

export async function quitarFotoAlojamiento(imagenId: string): Promise<void> {
  await apiFetch(`/api/alojamientos/imagenes/${encodeURIComponent(imagenId)}`, { method: 'DELETE' })
}

export async function ordenarFotosAlojamiento(id: string, orden: string[]): Promise<void> {
  await apiFetch(`/api/alojamientos/${encodeURIComponent(id)}/imagenes/orden`, { method: 'PUT', body: JSON.stringify({ orden }) })
}

export async function bloquearFechas(unidadId: string, input: { fechaInicio: string; fechaFin: string; motivo: string }): Promise<{ id: string }> {
  return apiFetch(`/api/alojamientos/unidades/${encodeURIComponent(unidadId)}/bloquear`, { method: 'POST', body: JSON.stringify(input) })
}

export async function bloqueosDeUnidad(unidadId: string): Promise<BloqueoUnidadDTO[]> {
  return (await apiFetch<{ items: BloqueoUnidadDTO[] }>(`/api/alojamientos/unidades/${encodeURIComponent(unidadId)}/bloqueos`)).items
}

export async function quitarBloqueoFechas(bloqueoId: string): Promise<void> {
  await apiFetch(`/api/alojamientos/bloqueos/${encodeURIComponent(bloqueoId)}`, { method: 'DELETE' })
}

export async function reservasDeMiAlojamiento(id: string): Promise<ReservaAlojamientoDTO[]> {
  return (await apiFetch<{ items: ReservaAlojamientoDTO[] }>(`/api/alojamientos/${encodeURIComponent(id)}/reservas`)).items
}

export async function cambiarEstadoReserva(reservaId: string, estado: 'checked_in' | 'completed' | 'cancelled'): Promise<void> {
  await apiFetch(`/api/alojamientos/reservas/${encodeURIComponent(reservaId)}/estado`, { method: 'PATCH', body: JSON.stringify({ estado }) })
}

// ---- what every lodging screen says the same way -------------------------------------------------

export const ESTADO_RESERVA: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  checked_in: 'En curso',
  completed: 'Finalizada',
  cancelled: 'Cancelada',
  expired: 'Vencida',
}

export const pesos = (monto: number): string => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(monto)

// A calendar date as people read it ("5 oct 2026"), without moving it between time zones.
export const fechaCorta = (valor: string): string => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${valor.slice(0, 10)}T00:00:00.000Z`))

// Today as a calendar date in Argentina (the first day a stay may start).
export const hoyAlojamientos = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export const sumarDiasFecha = (fecha: string, dias: number): string => new Date(Date.parse(`${fecha}T00:00:00.000Z`) + dias * 86_400_000).toISOString().slice(0, 10)
