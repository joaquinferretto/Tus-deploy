import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { ESTADOS_ALOJAMIENTO, MAXIMO_IMAGENES_ALOJAMIENTO, type AlojamientoAdminDTO, type PaginaAdminAlojamientos, type ReservaAlojamientoAdminDTO, type AlojamientoPropioDTO, type BloqueoUnidadDTO, type EstadoAlojamiento, type EstadoUnidadAlojamiento, type MiReservaAlojamientoDTO, type ModalidadTarifaAlojamiento } from '@factory/contracts'

import { ErrorFotoPerfil, prepararFotoPerfil } from '../directorio/foto.ts'
import { camposDesconocidos, entero, esInvalido, hora, identificador, monto, texto, textoOpcional } from '../validacion/entrada.ts'
import { ErrorAlojamiento, ESTADOS_QUE_OCUPAN } from './alojamientos-service.ts'
import type { Entrada } from './alojamientos-entrada.ts'

// Reservations that still hold their dates (as `misAlojamientos` counts them).
const ESTADOS_QUE_OCUPAN_ADMIN = ['confirmed', 'checked_in'] as const

// ALOJAMIENTOS-GESTION-01: what a guest does with its reservations (see them, cancel them) and
// what an owner does with its alojamientos (create, edit, publish, photos, price, blocked dates).
// The owner is the TUS account of the session: there is no separate "host" identity.

const DIA_MS = 24 * 60 * 60 * 1000
const ZONA_HORARIA = 'America/Argentina/Buenos_Aires'
const falla = (campo: string, mensaje: string) => ({ ok: false as const, campo, mensaje })
const presente = (value: unknown) => value !== undefined && value !== null && value !== ''

// Today as a calendar date where TUS operates. Stays are calendar dates (stored at 00:00 UTC of
// their day): a stay may start today, never before.
export function hoyCalendario(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
}

export const nochesEntre = (inicio: Date, fin: Date): number => Math.max(1, Math.round((fin.getTime() - inicio.getTime()) / DIA_MS))

// A public point is approximate: the real one moved a fixed distance (150 to 400 m) in a
// direction derived from the id, so it neither changes between requests nor can be averaged out.
export function puntoAproximado(id: string, latitud: number, longitud: number): { latitud: number; longitud: number } {
  let semilla = 2166136261
  for (const letra of id) semilla = Math.imul(semilla ^ letra.charCodeAt(0), 16777619) >>> 0
  const angulo = ((semilla % 3600) / 3600) * 2 * Math.PI
  const metros = 150 + ((semilla >>> 12) % 250)
  const lat = latitud + (metros * Math.cos(angulo)) / 111_320
  const lng = longitud + (metros * Math.sin(angulo)) / (111_320 * Math.max(0.2, Math.cos((latitud * Math.PI) / 180)))
  return { latitud: Math.round(lat * 1e4) / 1e4, longitud: Math.round(lng * 1e4) / 1e4 }
}

export interface AlojamientoPropioEscrito {
  tipoId: string
  nombre: string
  descripcion: string | null
  direccion: string
  barrioId: string
  latitud?: number
  longitud?: number
  checkInHora: string
  checkOutHora: string
  politicas: string | null
  comodidades: string[]
  capacidadPersonas: number
  camasDetalle: string | null
  banosCantidad: number
  precioNoche: bigint
}

const CAMPOS_PROPIO = ['tipoId', 'nombre', 'descripcion', 'direccion', 'barrioId', 'latitud', 'longitud', 'checkInHora', 'checkOutHora', 'politicas', 'comodidades', 'capacidadPersonas', 'camasDetalle', 'banosCantidad', 'precioNoche'] as const

// The form of an owner: one place, its capacity and its price per night. Who owns it, its state
// and whether it is published are never read from here.
export function leerAlojamientoPropio(body: Record<string, unknown>): Entrada<AlojamientoPropioEscrito> {
  const sobran = camposDesconocidos(body, CAMPOS_PROPIO)
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const tipoId = identificador(body['tipoId'])
  if (esInvalido(tipoId)) return falla('tipoId', 'Elegí el tipo de alojamiento.')
  const nombre = texto(body['nombre'], { min: 3, max: 120 })
  if (esInvalido(nombre)) return falla('nombre', 'El título debe tener de 3 a 120 caracteres.')
  const descripcion = textoOpcional(body['descripcion'], { max: 4000, lineas: true })
  if (esInvalido(descripcion)) return falla('descripcion', 'La descripción admite hasta 4000 caracteres.')
  const direccion = texto(body['direccion'], { min: 3, max: 200 })
  if (esInvalido(direccion)) return falla('direccion', 'La dirección debe tener de 3 a 200 caracteres.')
  const barrioId = identificador(body['barrioId'])
  if (esInvalido(barrioId)) return falla('barrioId', 'Elegí el barrio.')
  const punto: { latitud?: number; longitud?: number } = {}
  if (presente(body['latitud']) || presente(body['longitud'])) {
    const latitud = body['latitud']
    const longitud = body['longitud']
    if (typeof latitud !== 'number' || !Number.isFinite(latitud) || Math.abs(latitud) > 90) return falla('latitud', 'La latitud no es válida.')
    if (typeof longitud !== 'number' || !Number.isFinite(longitud) || Math.abs(longitud) > 180) return falla('longitud', 'La longitud no es válida.')
    punto.latitud = latitud
    punto.longitud = longitud
  }
  const checkInHora = presente(body['checkInHora']) ? hora(body['checkInHora']) : '14:00'
  if (esInvalido(checkInHora)) return falla('checkInHora', 'La hora de entrada debe tener el formato HH:MM.')
  const checkOutHora = presente(body['checkOutHora']) ? hora(body['checkOutHora']) : '10:00'
  if (esInvalido(checkOutHora)) return falla('checkOutHora', 'La hora de salida debe tener el formato HH:MM.')
  const politicas = textoOpcional(body['politicas'], { max: 4000, lineas: true })
  if (esInvalido(politicas)) return falla('politicas', 'Las reglas admiten hasta 4000 caracteres.')
  const comodidades: string[] = []
  if (presente(body['comodidades'])) {
    if (!Array.isArray(body['comodidades']) || body['comodidades'].length > 60) return falla('comodidades', 'Los servicios son una lista de hasta 60 textos cortos.')
    for (const item of body['comodidades']) {
      const leido = texto(item, { min: 1, max: 60 })
      if (esInvalido(leido)) return falla('comodidades', 'Los servicios son una lista de hasta 60 textos cortos.')
      if (!comodidades.includes(leido)) comodidades.push(leido)
    }
  }
  const capacidadPersonas = entero(body['capacidadPersonas'], { min: 1, max: 100 })
  if (esInvalido(capacidadPersonas)) return falla('capacidadPersonas', 'La capacidad debe ser un número entero de 1 a 100.')
  const camasDetalle = textoOpcional(body['camasDetalle'], { max: 300 })
  if (esInvalido(camasDetalle)) return falla('camasDetalle', 'El detalle de camas admite hasta 300 caracteres.')
  const banosCantidad = presente(body['banosCantidad']) ? entero(body['banosCantidad'], { min: 0, max: 50 }) : 1
  if (esInvalido(banosCantidad)) return falla('banosCantidad', 'La cantidad de baños debe ser un número entero de 0 a 50.')
  const precioNoche = monto(body['precioNoche'], { min: 1n })
  if (esInvalido(precioNoche)) return falla('precioNoche', 'El precio por noche debe ser un monto entero mayor que cero.')
  return { ok: true, valor: { tipoId, nombre, descripcion, direccion, barrioId, ...punto, checkInHora, checkOutHora, politicas, comodidades, capacidadPersonas, camasDetalle, banosCantidad, precioNoche } }
}

// The cancellation of a guest: an optional reason, nothing else.
export function leerCancelacion(body: Record<string, unknown>): Entrada<{ motivo: string | null }> {
  const sobran = camposDesconocidos(body, ['motivo'])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const motivo = textoOpcional(body['motivo'], { max: 300 })
  if (esInvalido(motivo)) return falla('motivo', 'El motivo admite hasta 300 caracteres.')
  return { ok: true, valor: { motivo } }
}

export function leerOrdenImagenes(body: Record<string, unknown>): Entrada<{ orden: string[] }> {
  const sobran = camposDesconocidos(body, ['orden'])
  if (sobran.length > 0) return falla(sobran[0]!, `Campo no reconocido: ${sobran[0]}.`)
  const orden = body['orden']
  if (!Array.isArray(orden) || orden.length === 0 || orden.length > MAXIMO_IMAGENES_ALOJAMIENTO || orden.some((id) => esInvalido(identificador(id))) || new Set(orden).size !== orden.length) return falla('orden', 'El orden es la lista de las fotos del alojamiento, sin repetir.')
  return { ok: true, valor: { orden: orden as string[] } }
}

const slugDe = (nombre: string): string => {
  const base = nombre.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'alojamiento'
  return `${base}-${randomUUID().slice(0, 6)}`
}

export type RolActor = 'cliente' | 'propietario' | 'admin' | 'sistema'

export class GestionAlojamientos {
  constructor(private readonly prisma: PrismaClient) {}

  // ---- guest ----------------------------------------------------------------------------------

  async misReservas(clienteId: string, ahora = new Date()): Promise<MiReservaAlojamientoDTO[]> {
    const filas = await this.prisma.reservaAlojamiento.findMany({
      where: { clienteId },
      include: { unidad: true, alojamiento: { include: { barrio: true, zona: true, imagenes: { orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }], take: 1 } } } },
      orderBy: { fechaInicio: 'desc' },
      take: 200,
    })
    return filas.map((r) => {
      // A hold nobody paid in time no longer keeps its dates, whatever the row still says.
      const estado = r.estado === 'pending_payment' && r.holdExpiracion !== null && r.holdExpiracion <= ahora ? 'expired' : r.estado
      const conLugar = ['confirmed', 'checked_in', 'completed'].includes(estado)
      return {
        id: r.id,
        unidadId: r.unidadId,
        unidadNombre: r.unidad.nombre,
        alojamientoId: r.alojamientoId,
        alojamientoNombre: r.alojamiento.nombre,
        clienteId: r.clienteId,
        clienteNombre: r.clienteNombre,
        clienteEmail: r.clienteEmail,
        clienteTelefono: r.clienteTelefono,
        esInvitado: r.esInvitado,
        fechaInicio: r.fechaInicio.toISOString(),
        fechaFin: r.fechaFin.toISOString(),
        modalidad: r.modalidad as ModalidadTarifaAlojamiento,
        cantidadPersonas: r.cantidadPersonas,
        tarifaId: r.tarifaId,
        precioListaSnapshot: Number(r.precioListaSnapshot),
        precioFinalSnapshot: Number(r.precioFinalSnapshot),
        moneda: r.moneda,
        estado: estado as MiReservaAlojamientoDTO['estado'],
        holdExpiracion: r.holdExpiracion ? r.holdExpiracion.toISOString() : null,
        paymentId: null,
        preferenceId: null,
        metodoPago: r.metodoPago,
        notas: r.notas,
        createdAt: r.creadoEn.toISOString(),
        noches: nochesEntre(r.fechaInicio, r.fechaFin),
        direccion: conLugar ? r.alojamiento.direccion : null,
        zona: [r.alojamiento.barrio?.nombre, r.alojamiento.zona?.nombre].filter(Boolean).join(', ') || null,
        checkInHora: r.alojamiento.checkInHora,
        checkOutHora: r.alojamiento.checkOutHora,
        imagenUrl: r.alojamiento.imagenes[0]?.url ?? null,
        puedeCancelar: this.cancelablePorCliente(estado, r.fechaInicio, ahora),
      }
    })
  }

  // A guest cancels until the day the stay starts (not once it started).
  private cancelablePorCliente(estado: string, fechaInicio: Date, ahora: Date): boolean {
    return (estado === 'pending_payment' || estado === 'confirmed') && fechaInicio.toISOString().slice(0, 10) > hoyCalendario(ahora)
  }

  // A change of state and its line of history, together. The previous state is the condition of
  // the update: two simultaneous changes do not step on each other.
  async cambiarEstado(reservaId: string, nuevo: 'checked_in' | 'completed' | 'cancelled', actor: { id: string | null; rol: RolActor; motivo?: string | null }, origenes: string[], ahora = new Date()): Promise<{ anterior: string }> {
    return this.prisma.$transaction(async (tx) => {
      const actual = await tx.reservaAlojamiento.findUnique({ where: { id: reservaId }, select: { estado: true } })
      if (!actual) throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Reserva no encontrada')
      const { count } = origenes.includes(actual.estado)
        ? await tx.reservaAlojamiento.updateMany({ where: { id: reservaId, estado: actual.estado }, data: { estado: nuevo } })
        : { count: 0 }
      if (count === 0) throw new ErrorAlojamiento(409, 'INVALID_STATE', `Una reserva en estado ${actual.estado} no puede pasar a ${nuevo}`)
      await tx.historialReservaAlojamiento.create({
        data: { id: `hra-${randomUUID()}`, reservaId, estadoAnterior: actual.estado, estadoNuevo: nuevo, actorId: actor.id, actorRol: actor.rol, motivo: actor.motivo ?? null, creadoEn: ahora },
      })
      return { anterior: actual.estado }
    })
  }

  async cancelarComoCliente(reservaId: string, clienteId: string, motivo: string | null, ahora = new Date()): Promise<void> {
    const reserva = await this.prisma.reservaAlojamiento.findUnique({ where: { id: reservaId }, select: { clienteId: true, estado: true, fechaInicio: true } })
    // Someone else's reservation answers like one that does not exist.
    if (!reserva || reserva.clienteId !== clienteId) throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Reserva no encontrada')
    if (!this.cancelablePorCliente(reserva.estado, reserva.fechaInicio, ahora)) {
      throw new ErrorAlojamiento(409, 'CANCELLATION_NOT_ALLOWED', 'Esta reserva ya no se puede cancelar desde acá. Escribile al alojamiento.')
    }
    await this.cambiarEstado(reservaId, 'cancelled', { id: clienteId, rol: 'cliente', motivo }, ['pending_payment', 'confirmed'], ahora)
  }

  async historial(reservaId: string): Promise<Array<{ estadoAnterior: string | null; estadoNuevo: string; actorRol: string; motivo: string | null; fecha: string }>> {
    const filas = await this.prisma.historialReservaAlojamiento.findMany({ where: { reservaId }, orderBy: { creadoEn: 'asc' } })
    return filas.map((fila) => ({ estadoAnterior: fila.estadoAnterior, estadoNuevo: fila.estadoNuevo, actorRol: fila.actorRol, motivo: fila.motivo, fecha: fila.creadoEn.toISOString() }))
  }

  // ---- owner ----------------------------------------------------------------------------------

  async misAlojamientos(propietarioId: string, ahora = new Date()): Promise<AlojamientoPropioDTO[]> {
    const filas = await this.prisma.alojamiento.findMany({
      where: { propietarioId },
      include: {
        tipo: true,
        imagenes: { orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }] },
        unidades: { orderBy: { orden: 'asc' }, include: { tarifas: { where: { activa: true, modalidad: 'noche' }, orderBy: { creadoEn: 'desc' } }, bloqueos: { where: { fechaFin: { gt: ahora } }, orderBy: { fechaInicio: 'asc' } } } },
        _count: { select: { reservas: { where: { estado: { in: ['confirmed', 'checked_in'] }, fechaFin: { gt: ahora } } } } },
      },
      orderBy: { creadoEn: 'desc' },
    })
    return filas.map((a) => ({
      id: a.id,
      nombre: a.nombre,
      slug: a.slug,
      tipoId: a.tipoId,
      tipoNombre: a.tipo.nombre,
      descripcion: a.descripcion,
      direccion: a.direccion,
      latitud: a.latitud,
      longitud: a.longitud,
      barrioId: a.barrioId,
      zonaId: a.zonaId,
      checkInHora: a.checkInHora,
      checkOutHora: a.checkOutHora,
      politicas: a.politicas,
      comodidades: a.comodidades,
      estado: a.estado as EstadoAlojamiento,
      publicado: a.publicado && a.estado === 'publicado',
      puedePublicarse: a.estado !== 'suspendido' && a.unidades.some((u) => u.estado === 'activa' && u.tarifas.length > 0),
      imagenes: a.imagenes.map((img) => ({ id: img.id, alojamientoId: img.alojamientoId, url: img.url, alt: img.alt, categoria: img.categoria, orden: img.orden, esPrincipal: img.esPrincipal })),
      unidades: a.unidades.map((u) => ({
        id: u.id,
        nombre: u.nombre,
        descripcion: u.descripcion,
        capacidadPersonas: u.capacidadPersonas,
        camasDetalle: u.camasDetalle,
        banosCantidad: u.banosCantidad,
        estado: u.estado as EstadoUnidadAlojamiento,
        precioNoche: u.tarifas[0] ? Number(u.tarifas[0].precio) : null,
        moneda: u.tarifas[0]?.moneda ?? 'ARS',
        bloqueos: u.bloqueos.map((b) => ({ id: b.id, unidadId: b.unidadId, fechaInicio: b.fechaInicio.toISOString(), fechaFin: b.fechaFin.toISOString(), motivo: b.motivo })),
      })),
      reservasVigentes: a._count.reservas,
    }))
  }

  // Barrio of the catalogue: it gives the zone and, when the owner marked no point, its centre.
  private async ubicar(tx: Prisma.TransactionClient, entrada: AlojamientoPropioEscrito): Promise<{ zonaId: string | null; latitud: number; longitud: number }> {
    const barrio = await tx.barrio.findUnique({ where: { id: entrada.barrioId }, select: { zonaId: true, latitud: true, longitud: true, activo: true } })
    if (!barrio || !barrio.activo) throw new ErrorAlojamiento(400, 'BAD_REQUEST', 'El barrio elegido no existe.')
    const latitud = entrada.latitud ?? barrio.latitud
    const longitud = entrada.longitud ?? barrio.longitud
    if (latitud === null || longitud === null || latitud === undefined || longitud === undefined) throw new ErrorAlojamiento(400, 'BAD_REQUEST', 'Marcá la ubicación del alojamiento.')
    return { zonaId: barrio.zonaId, latitud, longitud }
  }

  private async tipoValido(tx: Prisma.TransactionClient, tipoId: string): Promise<void> {
    const tipo = await tx.tipoAlojamiento.findUnique({ where: { id: tipoId }, select: { activo: true } })
    if (!tipo || !tipo.activo) throw new ErrorAlojamiento(400, 'BAD_REQUEST', 'El tipo de alojamiento no existe.')
  }

  // The price per night of a unit: the previous rate is retired (reservations keep pointing at
  // it) and a new one takes its place.
  private async fijarPrecioNoche(tx: Prisma.TransactionClient, unidadId: string, precio: bigint): Promise<void> {
    const vigentes = await tx.tarifaAlojamiento.findMany({ where: { unidadId, activa: true, modalidad: 'noche' }, select: { id: true, precio: true } })
    if (vigentes.length === 1 && vigentes[0]!.precio === precio) return
    await tx.tarifaAlojamiento.updateMany({ where: { unidadId, activa: true, modalidad: 'noche' }, data: { activa: false } })
    await tx.tarifaAlojamiento.create({ data: { id: `tar-${randomUUID()}`, unidadId, modalidad: 'noche', precio, moneda: 'ARS', diasSemana: [0, 1, 2, 3, 4, 5, 6], minimoEstadia: 1, activa: true } })
  }

  // A new alojamiento of the account: a draft (not published) with its place and its price.
  async crearPropio(propietarioId: string, entrada: AlojamientoPropioEscrito): Promise<{ id: string; slug: string }> {
    return this.prisma.$transaction(async (tx) => {
      await this.tipoValido(tx, entrada.tipoId)
      const lugar = await this.ubicar(tx, entrada)
      const id = `aloj-${randomUUID()}`
      const slug = slugDe(entrada.nombre)
      await tx.alojamiento.create({
        data: {
          id, propietarioId, tipoId: entrada.tipoId, nombre: entrada.nombre, slug, descripcion: entrada.descripcion, direccion: entrada.direccion,
          latitud: lugar.latitud, longitud: lugar.longitud, barrioId: entrada.barrioId, zonaId: lugar.zonaId, checkInHora: entrada.checkInHora, checkOutHora: entrada.checkOutHora,
          politicas: entrada.politicas, comodidades: entrada.comodidades, publicado: false, estado: 'borrador',
        },
      })
      const unidadId = `uni-${randomUUID()}`
      await tx.unidadAlojamiento.create({
        data: { id: unidadId, alojamientoId: id, nombre: 'Alojamiento completo', capacidadPersonas: entrada.capacidadPersonas, camasDetalle: entrada.camasDetalle, banosCantidad: entrada.banosCantidad, comodidades: [], estado: 'activa' },
      })
      await this.fijarPrecioNoche(tx, unidadId, entrada.precioNoche)
      return { id, slug }
    })
  }

  async editarPropio(alojamientoId: string, entrada: AlojamientoPropioEscrito): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.tipoValido(tx, entrada.tipoId)
      const lugar = await this.ubicar(tx, entrada)
      await tx.alojamiento.update({
        where: { id: alojamientoId },
        data: {
          tipoId: entrada.tipoId, nombre: entrada.nombre, descripcion: entrada.descripcion, direccion: entrada.direccion, latitud: lugar.latitud, longitud: lugar.longitud,
          barrioId: entrada.barrioId, zonaId: lugar.zonaId, checkInHora: entrada.checkInHora, checkOutHora: entrada.checkOutHora, politicas: entrada.politicas, comodidades: entrada.comodidades,
        },
      })
      // Capacity, beds, bathrooms and price belong to the place that is reserved: its first unit.
      const unidad = await tx.unidadAlojamiento.findFirst({ where: { alojamientoId }, orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }], select: { id: true } })
      if (!unidad) {
        const unidadId = `uni-${randomUUID()}`
        await tx.unidadAlojamiento.create({ data: { id: unidadId, alojamientoId, nombre: 'Alojamiento completo', capacidadPersonas: entrada.capacidadPersonas, camasDetalle: entrada.camasDetalle, banosCantidad: entrada.banosCantidad, comodidades: [], estado: 'activa' } })
        await this.fijarPrecioNoche(tx, unidadId, entrada.precioNoche)
        return
      }
      await tx.unidadAlojamiento.update({ where: { id: unidad.id }, data: { capacidadPersonas: entrada.capacidadPersonas, camasDetalle: entrada.camasDetalle, banosCantidad: entrada.banosCantidad } })
      await this.fijarPrecioNoche(tx, unidad.id, entrada.precioNoche)
    })
  }

  // Published: it appears in the search and can be reserved. Not published: neither; the
  // reservations it already has stay as they are. A suspension is lifted by the administration.
  async publicar(alojamientoId: string, publicado: boolean, esAdmin: boolean): Promise<{ estado: EstadoAlojamiento; publicado: boolean }> {
    const fila = await this.prisma.alojamiento.findUnique({ where: { id: alojamientoId }, select: { estado: true, unidades: { where: { estado: 'activa' }, select: { tarifas: { where: { activa: true }, select: { id: true }, take: 1 } } } } })
    if (!fila) throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Alojamiento no encontrado')
    if (fila.estado === 'suspendido' && !esAdmin) throw new ErrorAlojamiento(409, 'LISTING_SUSPENDED', 'Este alojamiento fue suspendido por la administración.')
    if (publicado && !fila.unidades.some((unidad) => unidad.tarifas.length > 0)) throw new ErrorAlojamiento(409, 'LISTING_INCOMPLETE', 'Para publicar hace falta un precio por noche.')
    const estado: EstadoAlojamiento = publicado ? 'publicado' : fila.estado === 'borrador' ? 'borrador' : 'pausado'
    await this.prisma.alojamiento.update({ where: { id: alojamientoId }, data: { publicado, estado } })
    return { estado, publicado }
  }

  // ---- platform administration (ALOJAMIENTOS-ADMIN-01) ------------------------------------------
  // Callers verified the platform-admin authority already (the router's `soloAdmin`).

  // Every lodging whatever its state (drafts, paused and suspended too), with its owner.
  async listarParaAdmin(filtro: { estado?: string; q?: string; pagina: number; tamano: number }, ahora = new Date()): Promise<PaginaAdminAlojamientos<AlojamientoAdminDTO>> {
    const q = (filtro.q ?? '').trim().slice(0, 80)
    const where: Prisma.AlojamientoWhereInput = {
      ...(filtro.estado && (ESTADOS_ALOJAMIENTO as readonly string[]).includes(filtro.estado) ? { estado: filtro.estado } : {}),
      ...(q ? { OR: [{ nombre: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {}),
    }
    const [filas, total] = await Promise.all([
      this.prisma.alojamiento.findMany({
        where,
        include: { tipo: true, barrio: true, _count: { select: { unidades: true, reservas: { where: { estado: { in: [...ESTADOS_QUE_OCUPAN_ADMIN] }, fechaFin: { gt: ahora } } } } } },
        orderBy: [{ creadoEn: 'desc' }, { id: 'asc' }],
        skip: (filtro.pagina - 1) * filtro.tamano,
        take: filtro.tamano,
      }),
      this.prisma.alojamiento.count({ where }),
    ])
    const cuentas = await this.prisma.account.findMany({ where: { id: { in: [...new Set(filas.map((fila) => fila.propietarioId).filter((id): id is string => Boolean(id)))] } }, include: { user: true } })
    const cuentaDe = new Map(cuentas.map((cuenta) => [cuenta.id, cuenta]))
    return {
      items: filas.map((a) => {
        const cuenta = a.propietarioId ? cuentaDe.get(a.propietarioId) : undefined
        return {
          id: a.id,
          nombre: a.nombre,
          slug: a.slug,
          tipoNombre: a.tipo.nombre,
          estado: a.estado as EstadoAlojamiento,
          publicado: a.publicado,
          barrio: a.barrio?.nombre ?? null,
          propietario: cuenta ? { cuentaId: cuenta.id, nombre: cuenta.user.displayName, email: cuenta.user.email } : null,
          unidades: a._count.unidades,
          reservasVigentes: a._count.reservas,
          creadoEn: a.creadoEn.toISOString(),
          actualizadoEn: a.actualizadoEn.toISOString(),
        }
      }),
      page: filtro.pagina,
      pageSize: filtro.tamano,
      total,
      totalPages: Math.max(1, Math.ceil(total / filtro.tamano)),
    }
  }

  // Reservations of every lodging, newest stay first.
  async reservasParaAdmin(filtro: { estado?: string; pagina: number; tamano: number }): Promise<PaginaAdminAlojamientos<ReservaAlojamientoAdminDTO>> {
    const where: Prisma.ReservaAlojamientoWhereInput = filtro.estado && /^[a-z_]{3,30}$/u.test(filtro.estado) ? { estado: filtro.estado } : {}
    const [filas, total] = await Promise.all([
      this.prisma.reservaAlojamiento.findMany({ where, include: { alojamiento: { select: { nombre: true } }, unidad: { select: { nombre: true } } }, orderBy: [{ fechaInicio: 'desc' }, { id: 'asc' }], skip: (filtro.pagina - 1) * filtro.tamano, take: filtro.tamano }),
      this.prisma.reservaAlojamiento.count({ where }),
    ])
    return {
      items: filas.map((r) => ({
        id: r.id,
        alojamientoId: r.alojamientoId,
        alojamientoNombre: r.alojamiento.nombre,
        unidadNombre: r.unidad.nombre,
        clienteId: r.clienteId,
        clienteNombre: r.clienteNombre,
        fechaInicio: r.fechaInicio.toISOString(),
        fechaFin: r.fechaFin.toISOString(),
        cantidadPersonas: r.cantidadPersonas,
        estado: r.estado,
        total: Number(r.precioFinalSnapshot),
        moneda: r.moneda,
        creadoEn: r.creadoEn.toISOString(),
      })),
      page: filtro.pagina,
      pageSize: filtro.tamano,
      total,
      totalPages: Math.max(1, Math.ceil(total / filtro.tamano)),
    }
  }

  // The administration SUSPENDS a lodging (it leaves the search and takes no new reservation; its
  // owner cannot publish it again) or lifts that suspension (it comes back PAUSED: publishing it
  // again is its owner's or the administration's own step). A mandatory note, audited. A
  // suspension changes NO reservation: the ones already made stay as they are (cancelling them is
  // its own explicit action, and there is no penalty or refund policy to apply here).
  async suspender(alojamientoId: string, suspendido: boolean, actor: { id: string; correlationId: string; motivo: unknown }): Promise<{ estado: EstadoAlojamiento; publicado: boolean }> {
    const motivo = typeof actor.motivo === 'string' ? actor.motivo.trim() : ''
    if (motivo.length < 5 || motivo.length > 300) throw new ErrorAlojamiento(422, 'REASON_REQUIRED', 'Escribí el motivo administrativo (5 a 300 caracteres).')
    return this.prisma.$transaction(async (tx) => {
      const fila = await tx.alojamiento.findUnique({ where: { id: alojamientoId }, select: { estado: true, propietarioId: true } })
      if (!fila) throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Alojamiento no encontrado')
      if (suspendido === (fila.estado === 'suspendido')) throw new ErrorAlojamiento(409, 'INVALID_STATE', suspendido ? 'Ese alojamiento ya está suspendido.' : 'Ese alojamiento no está suspendido.')
      const estado: EstadoAlojamiento = suspendido ? 'suspendido' : 'pausado'
      await tx.alojamiento.update({ where: { id: alojamientoId }, data: { estado, publicado: false } })
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: 'tus-platform', actorId: actor.id, correlationId: actor.correlationId, eventType: suspendido ? 'lodging.admin_suspended' : 'lodging.admin_suspension_lifted', outcome: 'success', metadata: { alojamientoId, previousState: fila.estado, newState: estado, reason: motivo, ownerAccountId: fila.propietarioId }, occurredAt: new Date() } })
      return { estado, publicado: false }
    })
  }

  // ---- blocked dates --------------------------------------------------------------------------

  async bloqueosDeUnidad(unidadId: string, ahora = new Date()): Promise<BloqueoUnidadDTO[]> {
    const filas = await this.prisma.bloqueoUnidadAlojamiento.findMany({ where: { unidadId, fechaFin: { gt: ahora } }, orderBy: { fechaInicio: 'asc' }, take: 200 })
    return filas.map((b) => ({ id: b.id, unidadId: b.unidadId, fechaInicio: b.fechaInicio.toISOString(), fechaFin: b.fechaFin.toISOString(), motivo: b.motivo }))
  }

  async propietarioDeBloqueo(bloqueoId: string): Promise<{ propietarioId: string | null } | null> {
    const fila = await this.prisma.bloqueoUnidadAlojamiento.findUnique({ where: { id: bloqueoId }, select: { unidad: { select: { alojamiento: { select: { propietarioId: true } } } } } })
    return fila ? { propietarioId: fila.unidad.alojamiento.propietarioId } : null
  }

  // Removing a block gives the dates back: nothing else was touched while it was there.
  async quitarBloqueo(bloqueoId: string): Promise<void> {
    const { count } = await this.prisma.bloqueoUnidadAlojamiento.deleteMany({ where: { id: bloqueoId } })
    if (count === 0) throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Bloqueo no encontrado')
  }

  // ---- photos ---------------------------------------------------------------------------------

  // The file is untrusted: type by magic bytes (JPEG, PNG, WebP), metadata removed, size and
  // dimensions bounded: the same preparation as the photo of a provider profile. The bytes live
  // in PostgreSQL; the image row points at the route that serves them.
  async subirImagen(alojamientoId: string, bytes: unknown): Promise<{ id: string; url: string }> {
    let foto: ReturnType<typeof prepararFotoPerfil>
    try {
      foto = prepararFotoPerfil(bytes)
    } catch (error) {
      if (!(error instanceof ErrorFotoPerfil)) throw error
      if (error.code === 'PHOTO_TOO_LARGE') throw new ErrorAlojamiento(413, error.code, 'Usá una foto de hasta 2 MB.')
      if (error.code === 'PHOTO_TYPE_NOT_ALLOWED') throw new ErrorAlojamiento(415, error.code, 'Usá una foto JPG, PNG o WEBP.')
      throw new ErrorAlojamiento(422, error.code, 'Usá una foto JPG, PNG o WEBP de entre 96 y 4096 píxeles por lado.')
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM public."alojamientos" WHERE "id" = ${alojamientoId} FOR UPDATE`
      const existentes = await tx.imagenAlojamiento.findMany({ where: { alojamientoId }, select: { orden: true } })
      if (existentes.length >= MAXIMO_IMAGENES_ALOJAMIENTO) throw new ErrorAlojamiento(409, 'TOO_MANY_PHOTOS', `Un alojamiento admite hasta ${MAXIMO_IMAGENES_ALOJAMIENTO} fotos.`)
      const id = `img-${randomUUID()}`
      const url = `/api/alojamientos/imagenes/${id}/archivo?v=${foto.sha256.slice(0, 12)}`
      await tx.imagenAlojamiento.create({ data: { id, alojamientoId, url, categoria: 'general', orden: existentes.reduce((max, img) => Math.max(max, img.orden), -1) + 1, esPrincipal: existentes.length === 0 } })
      await tx.archivoImagenAlojamiento.create({ data: { imagenId: id, tipoMime: foto.tipoMime, tamanoBytes: foto.tamanoBytes, ancho: foto.ancho, alto: foto.alto, sha256: foto.sha256, contenido: foto.contenido } })
      return { id, url }
    })
  }

  // Only the photo of an alojamiento that is visible (or the stored bytes do not leave).
  async archivoImagen(imagenId: string): Promise<{ tipoMime: string; contenido: Buffer; sha256: string } | null> {
    const fila = await this.prisma.archivoImagenAlojamiento.findUnique({ where: { imagenId }, select: { tipoMime: true, contenido: true, sha256: true } })
    return fila ? { tipoMime: fila.tipoMime, contenido: Buffer.from(fila.contenido), sha256: fila.sha256 } : null
  }

  async propietarioDeImagen(imagenId: string): Promise<{ propietarioId: string | null } | null> {
    const fila = await this.prisma.imagenAlojamiento.findUnique({ where: { id: imagenId }, select: { alojamiento: { select: { propietarioId: true } } } })
    return fila ? { propietarioId: fila.alojamiento.propietarioId } : null
  }

  async quitarImagen(imagenId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const imagen = await tx.imagenAlojamiento.findUnique({ where: { id: imagenId }, select: { alojamientoId: true, esPrincipal: true } })
      if (!imagen) throw new ErrorAlojamiento(404, 'NOT_FOUND', 'Foto no encontrada')
      await tx.imagenAlojamiento.delete({ where: { id: imagenId } })
      if (!imagen.esPrincipal) return
      // The main photo left: the next one in order takes its place.
      const siguiente = await tx.imagenAlojamiento.findFirst({ where: { alojamientoId: imagen.alojamientoId }, orderBy: { orden: 'asc' }, select: { id: true } })
      if (siguiente) await tx.imagenAlojamiento.update({ where: { id: siguiente.id }, data: { esPrincipal: true } })
    })
  }

  // A stable order: the list sent IS the gallery, and its first photo is the main one.
  async ordenarImagenes(alojamientoId: string, orden: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const actuales = await tx.imagenAlojamiento.findMany({ where: { alojamientoId }, select: { id: true } })
      if (actuales.length !== orden.length || actuales.some((img) => !orden.includes(img.id))) throw new ErrorAlojamiento(400, 'BAD_REQUEST', 'El orden debe incluir todas las fotos del alojamiento, una vez cada una.')
      for (const [posicion, id] of orden.entries()) await tx.imagenAlojamiento.update({ where: { id }, data: { orden: posicion, esPrincipal: posicion === 0 } })
    })
  }

  // Reservations that keep dates of a unit in a range (used by the owner's calendar).
  async ocupacionDeUnidad(unidadId: string, desde: Date, hasta: Date): Promise<Array<{ fechaInicio: string; fechaFin: string }>> {
    const filas = await this.prisma.reservaAlojamiento.findMany({ where: { unidadId, estado: { in: ESTADOS_QUE_OCUPAN }, fechaInicio: { lt: hasta }, fechaFin: { gt: desde } }, select: { fechaInicio: true, fechaFin: true }, orderBy: { fechaInicio: 'asc' } })
    return filas.map((fila) => ({ fechaInicio: fila.fechaInicio.toISOString(), fechaFin: fila.fechaFin.toISOString() }))
  }
}
