export const TIPOS_ALOJAMIENTO_CANONICOS = [
  { slug: 'hotel', nombre: 'Hotel', descripcion: 'Establecimiento con habitaciones privadas y servicios completos' },
  { slug: 'apart_hotel', nombre: 'Apart Hotel', descripcion: 'Departamentos con servicios hoteleros' },
  { slug: 'departamento', nombre: 'Departamento', descripcion: 'Vivienda independiente completa para estadías' },
  { slug: 'motel', nombre: 'Motel', descripcion: 'Alojamiento con reserva por horas, turnos o noche' },
  { slug: 'hostel', nombre: 'Hostel', descripcion: 'Alojamiento compartido o privado de ambiente social' },
  { slug: 'cabana', nombre: 'Cabaña', descripcion: 'Unidades independientes en entornos naturales o turísticos' },
  { slug: 'casa', nombre: 'Casa', descripcion: 'Inmueble unifamiliar completo' },
  { slug: 'habitacion', nombre: 'Habitación', descripcion: 'Habitación individual o privada dentro de una propiedad' },
] as const

export type SlugTipoAlojamiento = (typeof TIPOS_ALOJAMIENTO_CANONICOS)[number]['slug'] | string

export interface TipoAlojamientoDTO {
  id: string
  slug: string
  nombre: string
  descripcion: string | null
  icono: string | null
  orden: number
  activo: boolean
}

export const MODALIDADES_TARIFA_ALOJAMIENTO = [
  'por_hora',
  'bloque_horas',
  'noche',
  'dia',
  'semana',
] as const
export type ModalidadTarifaAlojamiento = (typeof MODALIDADES_TARIFA_ALOJAMIENTO)[number]

export const ESTADOS_ALOJAMIENTO = ['borrador', 'publicado', 'pausado', 'suspendido'] as const
export type EstadoAlojamiento = (typeof ESTADOS_ALOJAMIENTO)[number]

export const ESTADOS_UNIDAD_ALOJAMIENTO = ['activa', 'mantenimiento', 'inactiva'] as const
export type EstadoUnidadAlojamiento = (typeof ESTADOS_UNIDAD_ALOJAMIENTO)[number]

export const ESTADOS_RESERVA_ALOJAMIENTO = [
  'pending_payment',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'expired',
] as const
export type EstadoReservaAlojamiento = (typeof ESTADOS_RESERVA_ALOJAMIENTO)[number]

export interface ImagenAlojamientoDTO {
  id: string
  alojamientoId: string
  url: string
  alt: string | null
  categoria: string
  orden: number
  esPrincipal: boolean
}

export interface ImagenUnidadAlojamientoDTO {
  id: string
  unidadId: string
  url: string
  alt: string | null
  orden: number
  esPrincipal: boolean
}

export interface TarifaAlojamientoDTO {
  id: string
  unidadId: string
  modalidad: ModalidadTarifaAlojamiento
  duracionHoras: number | null
  precio: number
  moneda: string
  diasSemana: number[]
  temporada: string | null
  minimoEstadia: number
  maximoEstadia: number | null
  activa: boolean
}

export interface UnidadAlojamientoDTO {
  id: string
  alojamientoId: string
  nombre: string
  descripcion: string | null
  capacidadPersonas: number
  camasDetalle: string | null
  banosCantidad: number
  comodidades: string[]
  estado: EstadoUnidadAlojamiento
  orden: number
  imagenes: ImagenUnidadAlojamientoDTO[]
  tarifas: TarifaAlojamientoDTO[]
}

export interface FotoUnidadConFallback {
  url: string
  alt: string | null
  esPrincipal: boolean
  esFotoGeneralFallback: boolean
}

export interface UnidadDisponibleDTO {
  id: string
  nombre: string
  descripcion: string | null
  capacidadPersonas: number
  camasDetalle: string | null
  banosCantidad: number
  comodidades: string[]
  imagenes: FotoUnidadConFallback[]
  precioCalculado: {
    total: number
    precioPorUnidad: number
    modalidad: ModalidadTarifaAlojamiento
    moneda: string
    duracionHoras?: number
    cantidadPeriodos: number
  } | null
  disponible: boolean
}

export interface AlojamientoPublicoDTO {
  id: string
  propietarioId: string | null
  nombre: string
  slug: string
  tipo: {
    id: string
    slug: string
    nombre: string
  }
  descripcion: string | null
  // Public answers never carry the exact address (null) and the point is approximate: the exact
  // location belongs to whoever holds a confirmed reservation and to the owner.
  direccion: string | null
  latitud: number
  longitud: number
  barrioNombre: string | null
  zonaNombre: string | null
  rating: {
    average: number
    count: number
  } | null
  precioDesde: {
    amount: number
    modalidad: ModalidadTarifaAlojamiento
    currency: string
  } | null
  imagenes: ImagenAlojamientoDTO[]
  unidadesContador: number
  comodidades: string[]
}

export interface DetalleAlojamientoPublicoDTO extends AlojamientoPublicoDTO {
  checkInHora: string
  checkOutHora: string
  politicas: string | null
  unidades: UnidadDisponibleDTO[]
}

export interface ReservaAlojamientoDTO {
  id: string
  unidadId: string
  unidadNombre: string
  alojamientoId: string
  alojamientoNombre: string
  clienteId: string | null
  clienteNombre: string
  clienteEmail: string | null
  clienteTelefono: string | null
  esInvitado: boolean
  fechaInicio: string
  fechaFin: string
  modalidad: ModalidadTarifaAlojamiento
  cantidadPersonas: number
  tarifaId: string | null
  precioListaSnapshot: number
  precioFinalSnapshot: number
  moneda: string
  estado: EstadoReservaAlojamiento
  holdExpiracion: string | null
  paymentId: string | null
  preferenceId: string | null
  metodoPago: string | null
  notas: string | null
  createdAt: string
}

export interface FiltrosBusquedaAlojamientos {
  // Destination as the person writes it: name, neighbourhood or zone.
  q?: string
  zonaId?: string
  barrioId?: string
  tipoSlug?: string
  checkIn?: string
  checkOut?: string
  horas?: number
  personas?: number
  precioMin?: number
  precioMax?: number
  comodidades?: string[]
}

export interface CrearHoldReservaInput {
  unidadId: string
  alojamientoId: string
  clienteId?: string
  clienteNombre: string
  clienteEmail?: string
  clienteTelefono?: string
  fechaInicio: string
  fechaFin: string
  modalidad?: ModalidadTarifaAlojamiento
  cantidadPersonas?: number
  tarifaId?: string
  notas?: string
}

export interface ConfirmarReservaInput {
  reservaId: string
  paymentId: string
  preferenceId?: string
  metodoPago?: string
}

export interface BloqueoUnidadInput {
  unidadId: string
  fechaInicio: string
  fechaFin: string
  motivo: string
  creadoPorUsuarioId?: string
}

export interface CalificarAlojamientoInput {
  reservaId: string
  puntuacion: number
  comentario?: string
}

// ---- ALOJAMIENTOS-GESTION-01 ---------------------------------------------------------------------

// A reservation as its guest sees it ("Mis reservas"). The exact address is only there while the
// reservation is confirmed, in course or completed.
export interface MiReservaAlojamientoDTO extends ReservaAlojamientoDTO {
  noches: number
  direccion: string | null
  zona: string | null
  checkInHora: string
  checkOutHora: string
  imagenUrl: string | null
  puedeCancelar: boolean
}

export interface BloqueoUnidadDTO {
  id: string
  unidadId: string
  fechaInicio: string
  fechaFin: string
  motivo: string
}

export interface UnidadPropiaDTO {
  id: string
  nombre: string
  descripcion: string | null
  capacidadPersonas: number
  camasDetalle: string | null
  banosCantidad: number
  estado: EstadoUnidadAlojamiento
  precioNoche: number | null
  moneda: string
  bloqueos: BloqueoUnidadDTO[]
}

// An alojamiento as its owner manages it ("Mis alojamientos"), published or not.
export interface AlojamientoPropioDTO {
  id: string
  nombre: string
  slug: string
  tipoId: string
  tipoNombre: string
  descripcion: string | null
  direccion: string
  latitud: number
  longitud: number
  barrioId: string | null
  zonaId: string | null
  checkInHora: string
  checkOutHora: string
  politicas: string | null
  comodidades: string[]
  estado: EstadoAlojamiento
  publicado: boolean
  // Publishing needs an active unit with a price per night.
  puedePublicarse: boolean
  imagenes: ImagenAlojamientoDTO[]
  unidades: UnidadPropiaDTO[]
  reservasVigentes: number
}

export const MAXIMO_IMAGENES_ALOJAMIENTO = 12

// ---- platform administration (ALOJAMIENTOS-ADMIN-01) ----------------------------------------------

// One row of Admin -> Alojamientos: every lodging whatever its state, with who owns it.
export interface AlojamientoAdminDTO {
  id: string
  nombre: string
  slug: string
  tipoNombre: string
  estado: EstadoAlojamiento
  publicado: boolean
  barrio: string | null
  // The owning account (null: managed by the platform).
  propietario: { cuentaId: string; nombre: string; email: string } | null
  unidades: number
  // Reservations that still hold dates (confirmed or checked in, not finished).
  reservasVigentes: number
  creadoEn: string
  actualizadoEn: string
}

// One row of Admin -> Alojamientos -> Reservas: a reservation of any lodging.
export interface ReservaAlojamientoAdminDTO {
  id: string
  alojamientoId: string
  alojamientoNombre: string
  unidadNombre: string
  clienteId: string | null
  clienteNombre: string
  fechaInicio: string
  fechaFin: string
  cantidadPersonas: number
  estado: string
  total: number
  moneda: string
  creadoEn: string
}

export interface PaginaAdminAlojamientos<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
