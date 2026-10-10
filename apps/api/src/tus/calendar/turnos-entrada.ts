import { INTERVALOS_INICIO_TURNO, normalizarTelefono } from '@factory/contracts'

import { normalizeEmail, validateEmail } from '../../auth-security/domain/validation.ts'
import { INVALIDO, booleano, camposDesconocidos, entero, enumerado, esInvalido, identificador, instante, monto, textoOpcional, texto } from '../validacion/entrada.ts'

// What the agenda routes accept from a body. One reader per form: every field is checked here
// (type, range, length) before anything reaches the service, and a body with a field that is not
// in the form is refused instead of being read "more or less". A failure names the field.

export type Entrada<T> = { ok: true; valor: T } | { ok: false; campo: string; mensaje: string }
const falla = (campo: string, mensaje: string) => ({ ok: false as const, campo, mensaje })

export const MODALIDADES_SERVICIO = ['local', 'domicilio', 'mixto'] as const
export const DURACION_TURNO = { min: 5, max: 24 * 60 }
export const BUFFER_TURNO = { min: 0, max: 240 }
// A turno or a block is written at most this far from today.
const ANIOS_MAXIMOS = 2
const DIA_MS = 24 * 60 * 60 * 1000

function instanteCercano(value: unknown, now: number): Date | typeof INVALIDO {
  const fecha = instante(value)
  if (esInvalido(fecha)) return INVALIDO
  return Math.abs(fecha.getTime() - now) > ANIOS_MAXIMOS * 366 * DIA_MS ? INVALIDO : fecha
}

export interface ContactoInvitado {
  clienteNombre: string
  clienteTelefono?: string
  clienteEmail?: string
}

// The person a turno is for when it is not an account: a name, and a phone / email only when they
// are real ones (the phone in the canonical format of TUS).
export function leerContactoInvitado(body: Record<string, unknown>): Entrada<ContactoInvitado> {
  const nombre = texto(body['clienteNombre'], { min: 2, max: 120 })
  if (esInvalido(nombre)) return falla('clienteNombre', 'Ingresá el nombre del cliente (2 a 120 caracteres).')
  const valor: ContactoInvitado = { clienteNombre: nombre }
  const telefono = textoOpcional(body['clienteTelefono'], { max: 40 })
  if (esInvalido(telefono)) return falla('clienteTelefono', 'El teléfono del cliente no es válido.')
  if (telefono !== null) {
    const normalizado = normalizarTelefono(telefono)
    if (!normalizado.ok) return falla('clienteTelefono', 'El teléfono del cliente no es válido. Ingresalo con código de área, por ejemplo 3794 123456.')
    valor.clienteTelefono = normalizado.e164
  }
  const email = textoOpcional(body['clienteEmail'], { max: 320 })
  if (esInvalido(email)) return falla('clienteEmail', 'El email del cliente no es válido.')
  if (email !== null) {
    const normalizado = normalizeEmail(email)
    if (!validateEmail(normalizado)) return falla('clienteEmail', 'El email del cliente no es válido.')
    valor.clienteEmail = normalizado
  }
  return { ok: true, valor }
}

export interface TurnoEscrito extends ContactoInvitado {
  oficioId: string
  tarifaId?: string
  inicio: string
  fin?: string
  duracionMinutos?: number
  precioFinal?: bigint
  notas?: string
}

const CAMPOS_TURNO = ['oficioId', 'tarifaId', 'inicio', 'fin', 'duracionMinutos', 'precioFinal', 'clienteNombre', 'clienteTelefono', 'clienteEmail', 'notas'] as const
// AGENDA-MATRIZ-01: the account of an existing client the provider chose to link its manual turno to.
export const CAMPO_CLIENTE_VINCULADO = 'clienteCuentaId'

// A turno written by hand (by the provider in its own agenda, or forced by the administration).
export function leerTurnoEscrito(body: Record<string, unknown>, now: number, extra: readonly string[] = []): Entrada<TurnoEscrito> {
  const sobran = camposDesconocidos(body, [...CAMPOS_TURNO, ...extra])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const oficioId = identificador(body['oficioId'])
  if (esInvalido(oficioId)) return falla('oficioId', 'Elegí el servicio.')
  const inicio = instanteCercano(body['inicio'], now)
  if (esInvalido(inicio)) return falla('inicio', 'La fecha y hora de inicio no son válidas.')
  const contacto = leerContactoInvitado(body)
  if (!contacto.ok) return contacto
  const valor: TurnoEscrito = { oficioId, inicio: inicio.toISOString(), ...contacto.valor }
  if (body['tarifaId'] !== undefined && body['tarifaId'] !== null && body['tarifaId'] !== '') {
    const tarifaId = identificador(body['tarifaId'])
    if (esInvalido(tarifaId)) return falla('tarifaId', 'La tarifa elegida no es válida.')
    valor.tarifaId = tarifaId
  }
  if (body['fin'] !== undefined && body['fin'] !== null && body['fin'] !== '') {
    const fin = instante(body['fin'])
    if (esInvalido(fin) || fin.getTime() <= inicio.getTime() || fin.getTime() - inicio.getTime() > DURACION_TURNO.max * 60_000) return falla('fin', 'El fin del turno debe ser posterior al inicio y dentro del mismo día.')
    valor.fin = fin.toISOString()
  }
  if (body['duracionMinutos'] !== undefined && body['duracionMinutos'] !== null && body['duracionMinutos'] !== '') {
    const duracion = entero(body['duracionMinutos'], DURACION_TURNO)
    if (esInvalido(duracion)) return falla('duracionMinutos', `La duración debe ser un número entero de ${DURACION_TURNO.min} a ${DURACION_TURNO.max} minutos.`)
    valor.duracionMinutos = duracion
  }
  if (body['precioFinal'] !== undefined && body['precioFinal'] !== null && body['precioFinal'] !== '') {
    const precio = monto(body['precioFinal'])
    if (esInvalido(precio)) return falla('precioFinal', 'El precio debe ser un número entero de pesos, sin decimales ni signo.')
    valor.precioFinal = precio
  }
  const notas = textoOpcional(body['notas'], { max: 500, lineas: true })
  if (esInvalido(notas)) return falla('notas', 'Las notas admiten hasta 500 caracteres.')
  if (notas !== null) valor.notas = notas
  return { ok: true, valor }
}

// A block of the agenda: a real range, of at most a year, with an optional short reason.
export function leerBloqueo(body: Record<string, unknown>, now: number): Entrada<{ inicio: string; fin: string; motivo: string }> {
  const sobran = camposDesconocidos(body, ['inicio', 'fin', 'motivo'])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const inicio = instanteCercano(body['inicio'], now)
  if (esInvalido(inicio)) return falla('inicio', 'La fecha y hora de inicio no son válidas.')
  const fin = instanteCercano(body['fin'], now)
  if (esInvalido(fin)) return falla('fin', 'La fecha y hora de fin no son válidas.')
  if (fin.getTime() <= inicio.getTime()) return falla('fin', 'El fin del bloqueo debe ser posterior al inicio.')
  if (fin.getTime() - inicio.getTime() > 366 * DIA_MS) return falla('fin', 'Un bloqueo puede durar como máximo un año.')
  const motivo = textoOpcional(body['motivo'], { max: 200 })
  if (esInvalido(motivo)) return falla('motivo', 'El motivo admite hasta 200 caracteres.')
  return { ok: true, valor: { inicio: inicio.toISOString(), fin: fin.toISOString(), motivo: motivo ?? 'Bloqueo manual' } }
}

export interface ConfiguracionServicio {
  turnosHabilitados?: boolean
  solicitudesHabilitadas?: boolean
  precioBase?: bigint
  duracionMinutos?: number
  bufferMinutos?: number
  // TURNOS-INTERVALO-01: null puts the service back to "when the previous turno ends".
  intervaloInicioMinutos?: number | null
  modalidad?: (typeof MODALIDADES_SERVICIO)[number]
}

// How a provider offers ONE of its services. Only these fields; each one of its own type.
export function leerConfiguracionServicio(body: Record<string, unknown>): Entrada<ConfiguracionServicio> {
  const sobran = camposDesconocidos(body, ['turnosHabilitados', 'solicitudesHabilitadas', 'precioBase', 'duracionMinutos', 'bufferMinutos', 'intervaloInicioMinutos', 'modalidad'])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const valor: ConfiguracionServicio = {}
  for (const campo of ['turnosHabilitados', 'solicitudesHabilitadas'] as const) {
    if (body[campo] === undefined) continue
    const leido = booleano(body[campo])
    if (esInvalido(leido)) return falla(campo, `${campo} debe ser verdadero o falso.`)
    valor[campo] = leido
  }
  if (body['precioBase'] !== undefined && body['precioBase'] !== null) {
    const precio = monto(body['precioBase'])
    if (esInvalido(precio)) return falla('precioBase', 'El precio debe ser un número entero de pesos, sin decimales ni signo.')
    valor.precioBase = precio
  }
  if (body['duracionMinutos'] !== undefined && body['duracionMinutos'] !== null) {
    const duracion = entero(body['duracionMinutos'], DURACION_TURNO)
    if (esInvalido(duracion)) return falla('duracionMinutos', `La duración debe ser un número entero de ${DURACION_TURNO.min} a ${DURACION_TURNO.max} minutos.`)
    valor.duracionMinutos = duracion
  }
  if (body['bufferMinutos'] !== undefined && body['bufferMinutos'] !== null) {
    const buffer = entero(body['bufferMinutos'], BUFFER_TURNO)
    if (esInvalido(buffer)) return falla('bufferMinutos', `El descanso entre turnos debe ser un número entero de ${BUFFER_TURNO.min} a ${BUFFER_TURNO.max} minutos.`)
    valor.bufferMinutos = buffer
  }
  if (body['intervaloInicioMinutos'] === null) valor.intervaloInicioMinutos = null
  else if (body['intervaloInicioMinutos'] !== undefined) {
    if (!(INTERVALOS_INICIO_TURNO as readonly unknown[]).includes(body['intervaloInicioMinutos'])) return falla('intervaloInicioMinutos', `Un turno puede comenzar cada ${INTERVALOS_INICIO_TURNO.join(', ')} minutos.`)
    valor.intervaloInicioMinutos = body['intervaloInicioMinutos'] as number
  }
  if (body['modalidad'] !== undefined && body['modalidad'] !== null && body['modalidad'] !== '') {
    const modalidad = enumerado(body['modalidad'], MODALIDADES_SERVICIO)
    if (esInvalido(modalidad)) return falla('modalidad', 'La modalidad debe ser local, domicilio o mixto.')
    valor.modalidad = modalidad
  }
  return { ok: true, valor }
}

// The two switches of a provider. At least one, and each a real boolean.
export function leerSwitches(body: Record<string, unknown>): Entrada<{ aceptaTurnos?: boolean; aceptaSolicitudes?: boolean }> {
  const sobran = camposDesconocidos(body, ['aceptaTurnos', 'aceptaSolicitudes'])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const valor: { aceptaTurnos?: boolean; aceptaSolicitudes?: boolean } = {}
  for (const campo of ['aceptaTurnos', 'aceptaSolicitudes'] as const) {
    if (body[campo] === undefined) continue
    const leido = booleano(body[campo])
    if (esInvalido(leido)) return falla(campo, `${campo} debe ser verdadero o falso.`)
    valor[campo] = leido
  }
  if (Object.keys(valor).length === 0) return falla('aceptaTurnos', 'Indicá al menos un cambio.')
  return { ok: true, valor }
}

// A price change made by the administration: the amount and why.
export function leerCambioDePrecio(body: Record<string, unknown>): Entrada<{ precioFinal: bigint; motivo: string }> {
  const sobran = camposDesconocidos(body, ['precioFinal', 'motivo'])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const precio = monto(body['precioFinal'])
  if (esInvalido(precio)) return falla('precioFinal', 'El precio debe ser un número entero de pesos, sin decimales ni signo.')
  const motivo = texto(body['motivo'], { min: 5, max: 300 })
  if (esInvalido(motivo)) return falla('motivo', 'El motivo es obligatorio (5 a 300 caracteres).')
  return { ok: true, valor: { precioFinal: precio, motivo } }
}

// A change of state: the state is checked against the closed list by the service; here only its
// shape and the optional reason.
export function leerCambioDeEstado(body: Record<string, unknown>): Entrada<{ estado: string; motivo?: string }> {
  const sobran = camposDesconocidos(body, ['estado', 'motivo'])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const estado = typeof body['estado'] === 'string' && /^[a-z_-]{2,40}$/u.test(body['estado']) ? body['estado'] : INVALIDO
  if (esInvalido(estado)) return falla('estado', 'Estado no reconocido.')
  const motivo = textoOpcional(body['motivo'], { max: 300 })
  if (esInvalido(motivo)) return falla('motivo', 'El motivo admite hasta 300 caracteres.')
  return { ok: true, valor: { estado, ...(motivo !== null ? { motivo } : {}) } }
}

export interface TarifaEscrita {
  id?: string
  nombre: string
  duracionMinutos: number
  precio: bigint
  orden: number
}

// The tarifas of one service, replaced as a set (at most 20).
export function leerTarifas(body: Record<string, unknown>): Entrada<TarifaEscrita[]> {
  const sobran = camposDesconocidos(body, ['tarifas'])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  if (!Array.isArray(body['tarifas']) || body['tarifas'].length > 20) return falla('tarifas', 'Enviá la lista de tarifas (hasta 20).')
  const tarifas: TarifaEscrita[] = []
  for (const [indice, cruda] of body['tarifas'].entries()) {
    const campo = `tarifas[${indice}]`
    if (typeof cruda !== 'object' || cruda === null || Array.isArray(cruda)) return falla(campo, `La tarifa ${indice + 1} no es válida.`)
    const fila = cruda as Record<string, unknown>
    if (camposDesconocidos(fila, ['id', 'nombre', 'duracionMinutos', 'precio', 'orden']).length > 0) return falla(campo, `La tarifa ${indice + 1} tiene campos no reconocidos.`)
    const nombre = texto(fila['nombre'], { min: 1, max: 80 })
    if (esInvalido(nombre)) return falla(`${campo}.nombre`, `La tarifa ${indice + 1} necesita un nombre de hasta 80 caracteres.`)
    const duracion = entero(fila['duracionMinutos'], DURACION_TURNO)
    if (esInvalido(duracion)) return falla(`${campo}.duracionMinutos`, `La duración de la tarifa ${indice + 1} debe ser un número entero de ${DURACION_TURNO.min} a ${DURACION_TURNO.max} minutos.`)
    const precio = monto(fila['precio'])
    if (esInvalido(precio)) return falla(`${campo}.precio`, 'El precio de cada tarifa debe ser un número entero de pesos, sin decimales ni signo.')
    const orden = fila['orden'] === undefined || fila['orden'] === null ? indice : entero(fila['orden'], { min: 0, max: 1000 })
    if (esInvalido(orden)) return falla(`${campo}.orden`, `El orden de la tarifa ${indice + 1} no es válido.`)
    let id: string | undefined
    if (fila['id'] !== undefined && fila['id'] !== null && fila['id'] !== '') {
      const leido = identificador(fila['id'])
      if (esInvalido(leido)) return falla(`${campo}.id`, `La tarifa ${indice + 1} no es válida.`)
      id = leido
    }
    tarifas.push({ ...(id ? { id } : {}), nombre, duracionMinutos: duracion, precio, orden })
  }
  return { ok: true, valor: tarifas }
}
