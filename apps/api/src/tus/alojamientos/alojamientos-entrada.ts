import { normalizarTelefono } from '@factory/contracts'

import { normalizeEmail, validateEmail } from '../../auth-security/domain/validation.ts'
import { MONEDAS, booleano, camposDesconocidos, entero, enumerado, esInvalido, hora, identificador, monto, texto, textoOpcional, urlHttps } from '../validacion/entrada.ts'

// What the lodging routes accept from a body. One reader per form; a failure names the field.
// The database repeats the essential rules (ranges, enumerations, amounts) with its constraints:
// here they become an answer the form can show instead of an internal error.

export type Entrada<T> = { ok: true; valor: T } | { ok: false; campo: string; mensaje: string }
const falla = (campo: string, mensaje: string) => ({ ok: false as const, campo, mensaje })
const cerrado = (body: Record<string, unknown>, campos: readonly string[]) => {
  const sobran = camposDesconocidos(body, campos)
  return sobran.length > 0 ? falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`) : null
}
const presente = (value: unknown) => value !== undefined && value !== null && value !== ''

export const MODALIDADES_TARIFA = ['por_hora', 'bloque_horas', 'noche', 'dia', 'semana'] as const
const DIA_MS = 24 * 60 * 60 * 1000

// A date ("2026-10-05") or an instant with its offset. Returned as it came: the service reads it.
function fecha(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const limpio = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(limpio)) return null
  return Number.isNaN(new Date(limpio).getTime()) ? null : limpio
}

function rango(body: Record<string, unknown>, now: number, maximoDias: number): Entrada<{ fechaInicio: string; fechaFin: string }> {
  const fechaInicio = fecha(body['fechaInicio'])
  if (!fechaInicio) return falla('fechaInicio', 'La fecha de inicio no es válida.')
  const fechaFin = fecha(body['fechaFin'])
  if (!fechaFin) return falla('fechaFin', 'La fecha de fin no es válida.')
  const inicio = new Date(fechaInicio).getTime()
  const fin = new Date(fechaFin).getTime()
  if (fin <= inicio) return falla('fechaFin', 'La fecha de fin debe ser posterior a la de inicio.')
  if (fin - inicio > maximoDias * DIA_MS) return falla('fechaFin', `El rango puede tener como máximo ${maximoDias} días.`)
  if (Math.abs(inicio - now) > 3 * 366 * DIA_MS) return falla('fechaInicio', 'La fecha de inicio está fuera del período admitido.')
  return { ok: true, valor: { fechaInicio, fechaFin } }
}

function lista(value: unknown, maximo: number, largo: number): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maximo) return null
  const items: string[] = []
  for (const item of value) {
    const leido = texto(item, { min: 1, max: largo })
    if (esInvalido(leido)) return null
    items.push(leido)
  }
  return [...new Set(items)]
}

export interface ReservaEscrita {
  unidadId: string
  alojamientoId: string
  clienteNombre: string
  clienteEmail?: string
  clienteTelefono?: string
  fechaInicio: string
  fechaFin: string
  modalidad?: (typeof MODALIDADES_TARIFA)[number]
  cantidadPersonas: number
  tarifaId?: string
  notas?: string
}

// A reservation request. Who reserves is the session (when there is one), never the body.
export function leerReserva(body: Record<string, unknown>, now: number): Entrada<ReservaEscrita> {
  // `clienteId` is tolerated and never read: older clients send it, and the client is the session.
  const error = cerrado(body, ['unidadId', 'alojamientoId', 'clienteNombre', 'clienteEmail', 'clienteTelefono', 'fechaInicio', 'fechaFin', 'modalidad', 'cantidadPersonas', 'tarifaId', 'notas', 'clienteId'])
  if (error) return error
  const unidadId = identificador(body['unidadId'])
  if (esInvalido(unidadId)) return falla('unidadId', 'Elegí la unidad.')
  const alojamientoId = identificador(body['alojamientoId'])
  if (esInvalido(alojamientoId)) return falla('alojamientoId', 'Elegí el alojamiento.')
  const nombre = texto(body['clienteNombre'], { min: 2, max: 120 })
  if (esInvalido(nombre)) return falla('clienteNombre', 'Ingresá tu nombre y apellido (2 a 120 caracteres).')
  const fechas = rango(body, now, 365)
  if (!fechas.ok) return fechas
  const valor: ReservaEscrita = { unidadId, alojamientoId, clienteNombre: nombre, ...fechas.valor, cantidadPersonas: 1 }
  for (const campo of ['tarifaId'] as const) {
    if (!presente(body[campo])) continue
    const leido = identificador(body[campo])
    if (esInvalido(leido)) return falla(campo, 'El identificador no es válido.')
    valor[campo] = leido
  }
  if (presente(body['clienteEmail'])) {
    const email = typeof body['clienteEmail'] === 'string' ? normalizeEmail(body['clienteEmail']) : ''
    if (!validateEmail(email)) return falla('clienteEmail', 'Ingresá un email válido.')
    valor.clienteEmail = email
  }
  if (presente(body['clienteTelefono'])) {
    const telefono = normalizarTelefono(body['clienteTelefono'])
    if (!telefono.ok) return falla('clienteTelefono', 'Ingresá el teléfono con código de área, por ejemplo 3794 123456.')
    valor.clienteTelefono = telefono.e164
  }
  if (presente(body['modalidad'])) {
    const modalidad = enumerado(body['modalidad'], MODALIDADES_TARIFA)
    if (esInvalido(modalidad)) return falla('modalidad', 'La modalidad no es válida.')
    valor.modalidad = modalidad
  }
  if (presente(body['cantidadPersonas'])) {
    const personas = entero(body['cantidadPersonas'], { min: 1, max: 100 })
    if (esInvalido(personas)) return falla('cantidadPersonas', 'La cantidad de personas debe ser un número entero de 1 a 100.')
    valor.cantidadPersonas = personas
  }
  const notas = textoOpcional(body['notas'], { max: 500, lineas: true })
  if (esInvalido(notas)) return falla('notas', 'Las notas admiten hasta 500 caracteres.')
  if (notas !== null) valor.notas = notas
  return { ok: true, valor }
}

export function leerCalificacion(body: Record<string, unknown>): Entrada<{ reservaId: string; puntuacion: number; comentario?: string }> {
  // `clienteId` is tolerated and never read: who rates is the session.
  const error = cerrado(body, ['reservaId', 'puntuacion', 'comentario', 'clienteId'])
  if (error) return error
  const reservaId = identificador(body['reservaId'])
  if (esInvalido(reservaId)) return falla('reservaId', 'La reserva no es válida.')
  const puntuacion = entero(body['puntuacion'], { min: 1, max: 5 })
  if (esInvalido(puntuacion)) return falla('puntuacion', 'La puntuación debe ser un número entero de 1 a 5.')
  const comentario = textoOpcional(body['comentario'], { max: 1000, lineas: true })
  if (esInvalido(comentario)) return falla('comentario', 'El comentario admite hasta 1000 caracteres.')
  return { ok: true, valor: { reservaId, puntuacion, ...(comentario !== null ? { comentario } : {}) } }
}

export interface AlojamientoEscrito {
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
  comodidades: string[]
  publicado?: boolean
}

export function leerAlojamiento(body: Record<string, unknown>): Entrada<AlojamientoEscrito> {
  const error = cerrado(body, ['propietarioId', 'tipoId', 'nombre', 'slug', 'descripcion', 'direccion', 'latitud', 'longitud', 'barrioId', 'zonaId', 'checkInHora', 'checkOutHora', 'politicas', 'comodidades', 'publicado'])
  if (error) return error
  const tipoId = identificador(body['tipoId'])
  if (esInvalido(tipoId)) return falla('tipoId', 'Elegí el tipo de alojamiento.')
  const nombre = texto(body['nombre'], { min: 2, max: 120 })
  if (esInvalido(nombre)) return falla('nombre', 'El nombre debe tener de 2 a 120 caracteres.')
  const slug = typeof body['slug'] === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(body['slug']) && body['slug'].length >= 3 && body['slug'].length <= 80 ? body['slug'] : null
  if (!slug) return falla('slug', 'La dirección pública (slug) usa minúsculas, números y guiones, de 3 a 80 caracteres.')
  const direccion = texto(body['direccion'], { min: 3, max: 200 })
  if (esInvalido(direccion)) return falla('direccion', 'La dirección debe tener de 3 a 200 caracteres.')
  const latitud = body['latitud']
  const longitud = body['longitud']
  if (typeof latitud !== 'number' || !Number.isFinite(latitud) || Math.abs(latitud) > 90) return falla('latitud', 'La latitud no es válida.')
  if (typeof longitud !== 'number' || !Number.isFinite(longitud) || Math.abs(longitud) > 180) return falla('longitud', 'La longitud no es válida.')
  const comodidades = lista(body['comodidades'], 60, 60)
  if (!comodidades) return falla('comodidades', 'Las comodidades son una lista de hasta 60 textos cortos.')
  const valor: AlojamientoEscrito = { tipoId, nombre, slug, direccion, latitud, longitud, comodidades }
  for (const campo of ['propietarioId', 'barrioId', 'zonaId'] as const) {
    if (!presente(body[campo])) continue
    const leido = identificador(typeof body[campo] === 'string' ? (body[campo] as string).trim() : body[campo])
    if (esInvalido(leido)) return falla(campo, 'El identificador no es válido.')
    valor[campo] = leido
  }
  for (const [campo, max] of [['descripcion', 4000], ['politicas', 4000]] as const) {
    const leido = textoOpcional(body[campo], { max, lineas: true })
    if (esInvalido(leido)) return falla(campo, `Hasta ${max} caracteres.`)
    if (leido !== null) valor[campo] = leido
  }
  for (const campo of ['checkInHora', 'checkOutHora'] as const) {
    if (!presente(body[campo])) continue
    const leido = hora(body[campo])
    if (esInvalido(leido)) return falla(campo, 'La hora debe tener el formato HH:MM.')
    valor[campo] = leido
  }
  if (body['publicado'] !== undefined) {
    const publicado = booleano(body['publicado'])
    if (esInvalido(publicado)) return falla('publicado', 'publicado debe ser verdadero o falso.')
    valor.publicado = publicado
  }
  return { ok: true, valor }
}

export interface UnidadEscrita {
  nombre: string
  descripcion?: string
  capacidadPersonas: number
  camasDetalle?: string
  banosCantidad: number
  comodidades: string[]
}

export function leerUnidad(body: Record<string, unknown>): Entrada<UnidadEscrita> {
  const error = cerrado(body, ['nombre', 'descripcion', 'capacidadPersonas', 'camasDetalle', 'banosCantidad', 'comodidades'])
  if (error) return error
  const nombre = texto(body['nombre'], { min: 2, max: 120 })
  if (esInvalido(nombre)) return falla('nombre', 'El nombre debe tener de 2 a 120 caracteres.')
  const capacidad = presente(body['capacidadPersonas']) ? entero(body['capacidadPersonas'], { min: 1, max: 100 }) : 2
  if (esInvalido(capacidad)) return falla('capacidadPersonas', 'La capacidad debe ser un número entero de 1 a 100.')
  const banos = presente(body['banosCantidad']) ? entero(body['banosCantidad'], { min: 0, max: 50 }) : 1
  if (esInvalido(banos)) return falla('banosCantidad', 'La cantidad de baños debe ser un número entero de 0 a 50.')
  const comodidades = lista(body['comodidades'], 60, 60)
  if (!comodidades) return falla('comodidades', 'Las comodidades son una lista de hasta 60 textos cortos.')
  const valor: UnidadEscrita = { nombre, capacidadPersonas: capacidad, banosCantidad: banos, comodidades }
  for (const [campo, max] of [['descripcion', 2000], ['camasDetalle', 300]] as const) {
    const leido = textoOpcional(body[campo], { max, lineas: true })
    if (esInvalido(leido)) return falla(campo, `Hasta ${max} caracteres.`)
    if (leido !== null) valor[campo] = leido
  }
  return { ok: true, valor }
}

export interface TarifaAlojamientoEscrita {
  modalidad: (typeof MODALIDADES_TARIFA)[number]
  duracionHoras?: number
  precio: bigint
  moneda: (typeof MONEDAS)[number]
  diasSemana: number[]
  minimoEstadia: number
  maximoEstadia?: number
}

export function leerTarifaAlojamiento(body: Record<string, unknown>): Entrada<TarifaAlojamientoEscrita> {
  const error = cerrado(body, ['modalidad', 'duracionHoras', 'precio', 'moneda', 'diasSemana', 'minimoEstadia', 'maximoEstadia'])
  if (error) return error
  const precio = monto(body['precio'])
  if (esInvalido(precio)) return falla('precio', 'El precio debe ser un número entero de pesos, sin decimales ni signo.')
  const modalidad = presente(body['modalidad']) ? enumerado(body['modalidad'], MODALIDADES_TARIFA) : 'noche'
  if (esInvalido(modalidad)) return falla('modalidad', 'La modalidad no es válida.')
  const moneda = presente(body['moneda']) ? enumerado(body['moneda'], MONEDAS) : 'ARS'
  if (esInvalido(moneda)) return falla('moneda', 'La moneda debe ser ARS.')
  let diasSemana = [0, 1, 2, 3, 4, 5, 6]
  if (body['diasSemana'] !== undefined && body['diasSemana'] !== null) {
    const crudos = body['diasSemana']
    if (!Array.isArray(crudos) || crudos.length === 0 || crudos.length > 7 || crudos.some((dia) => typeof dia !== 'number' || !Number.isInteger(dia) || dia < 0 || dia > 6)) return falla('diasSemana', 'Los días de la semana van de 0 (domingo) a 6 (sábado).')
    diasSemana = [...new Set(crudos as number[])].sort((a, b) => a - b)
  }
  const minimo = presente(body['minimoEstadia']) ? entero(body['minimoEstadia'], { min: 1, max: 365 }) : 1
  if (esInvalido(minimo)) return falla('minimoEstadia', 'La estadía mínima debe ser un número entero de 1 a 365.')
  const valor: TarifaAlojamientoEscrita = { modalidad, precio, moneda, diasSemana, minimoEstadia: minimo }
  if (presente(body['maximoEstadia'])) {
    const maximo = entero(body['maximoEstadia'], { min: minimo, max: 365 })
    if (esInvalido(maximo)) return falla('maximoEstadia', 'La estadía máxima debe ser un número entero, no menor a la mínima y de hasta 365.')
    valor.maximoEstadia = maximo
  }
  if (presente(body['duracionHoras'])) {
    const duracion = entero(body['duracionHoras'], { min: 1, max: 24 })
    if (esInvalido(duracion)) return falla('duracionHoras', 'La duración debe ser un número entero de 1 a 24 horas.')
    valor.duracionHoras = duracion
  }
  if (modalidad === 'bloque_horas' && valor.duracionHoras === undefined) return falla('duracionHoras', 'Un bloque de horas necesita su duración.')
  return { ok: true, valor }
}

export interface ImagenEscrita {
  url: string
  alt?: string
  // A short label ("general", "exterior"): lower case letters and underscores.
  categoria?: string
  orden: number
  esPrincipal: boolean
}

// An image is an https address (TUS does not receive the file here): never javascript: or data:.
export function leerImagen(body: Record<string, unknown>, conCategoria: boolean): Entrada<ImagenEscrita> {
  const error = cerrado(body, ['url', 'alt', 'orden', 'esPrincipal', ...(conCategoria ? ['categoria'] : [])])
  if (error) return error
  const url = urlHttps(body['url'])
  if (esInvalido(url)) return falla('url', 'La imagen debe ser una dirección https válida.')
  const alt = textoOpcional(body['alt'], { max: 200 })
  if (esInvalido(alt)) return falla('alt', 'La descripción de la imagen admite hasta 200 caracteres.')
  const orden = presente(body['orden']) ? entero(body['orden'], { min: 0, max: 1000 }) : 0
  if (esInvalido(orden)) return falla('orden', 'El orden debe ser un número entero de 0 a 1000.')
  const esPrincipal = body['esPrincipal'] === undefined || body['esPrincipal'] === null ? false : booleano(body['esPrincipal'])
  if (esInvalido(esPrincipal)) return falla('esPrincipal', 'esPrincipal debe ser verdadero o falso.')
  const valor: ImagenEscrita = { url, orden, esPrincipal, ...(alt !== null ? { alt } : {}) }
  if (conCategoria && presente(body['categoria'])) {
    const categoria = body['categoria']
    if (typeof categoria !== 'string' || !/^[a-z_]{2,30}$/u.test(categoria)) return falla('categoria', 'La categoría de la imagen no es válida.')
    valor.categoria = categoria
  }
  return { ok: true, valor }
}

export function leerBloqueoUnidad(body: Record<string, unknown>, now: number): Entrada<{ fechaInicio: string; fechaFin: string; motivo: string }> {
  const error = cerrado(body, ['fechaInicio', 'fechaFin', 'motivo'])
  if (error) return error
  const fechas = rango(body, now, 366)
  if (!fechas.ok) return fechas
  const motivo = texto(body['motivo'], { min: 2, max: 200 })
  if (esInvalido(motivo)) return falla('motivo', 'El motivo es obligatorio (2 a 200 caracteres).')
  return { ok: true, valor: { ...fechas.valor, motivo } }
}
