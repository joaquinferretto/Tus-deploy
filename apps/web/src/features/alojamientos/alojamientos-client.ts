import type {
  AlojamientoPublicoDTO,
  DetalleAlojamientoPublicoDTO,
  FiltrosBusquedaAlojamientos,
  ReservaAlojamientoDTO,
  TipoAlojamientoDTO,
  CrearHoldReservaInput,
  CalificarAlojamientoInput,
} from '@factory/contracts'

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] || ''

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // `path` is the full API path (/api/alojamientos/...), never a Web route.
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  })

  if (!res.ok) {
    let errorData = { error: { code: 'UNKNOWN', message: 'Error de servidor' } }
    try {
      errorData = await res.json()
    } catch {
      // fallback
    }
    throw new Error(errorData.error?.message || `HTTP ${res.status}`)
  }

  return res.json()
}

export async function listarTiposAlojamiento(): Promise<TipoAlojamientoDTO[]> {
  const data = await apiFetch<{ items: TipoAlojamientoDTO[] }>('/api/alojamientos/tipos')
  return data.items
}

export async function buscarAlojamientos(
  filtros: FiltrosBusquedaAlojamientos = {}
): Promise<AlojamientoPublicoDTO[]> {
  const params = new URLSearchParams()
  if (filtros.zonaId) params.set('zonaId', filtros.zonaId)
  if (filtros.barrioId) params.set('barrioId', filtros.barrioId)
  if (filtros.tipoSlug) params.set('tipoSlug', filtros.tipoSlug)
  if (filtros.checkIn) params.set('checkIn', filtros.checkIn)
  if (filtros.checkOut) params.set('checkOut', filtros.checkOut)
  if (filtros.personas) params.set('personas', String(filtros.personas))
  if (filtros.precioMin) params.set('precioMin', String(filtros.precioMin))
  if (filtros.precioMax) params.set('precioMax', String(filtros.precioMax))

  const qs = params.toString() ? `?${params.toString()}` : ''
  const data = await apiFetch<{ items: AlojamientoPublicoDTO[] }>(`/api/alojamientos/${qs}`)
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
