import { randomUUID } from 'node:crypto'

import { vinculosDePrestadores, type ClientePrismaVinculoPrestador } from '../directorio/cuenta-prestador.ts'
import { CON_IMAGENES, desdeFila } from '../solicitudes/almacenes.ts'
import type { SolicitudServicio } from '../solicitudes/modelo.ts'
import type { ClienteDelMatch } from '../solicitudes/puertos.ts'
import { OFERTA_TOMABLE, type CanalRespuesta, type EstadoOferta, type MotivoNoEnviada, type OfertaUrgente } from './modelo.ts'
import type { AlmacenUrgentes, ResultadoRechazar, ResultadoRenuncia, ResultadoTomar, TrabajosUrgentes } from './puertos.ts'

// SERVICIO-URGENTE-01 on PostgreSQL. The request is a row of solicitudes_servicio; this store adds
// its candidates (ofertas_urgentes) and the three transitions that have to be atomic: take, give
// back and close.

type Fila = Record<string, unknown>

interface Delegado {
  create(input: { data: Fila }): Promise<Fila>
  findFirst(input: { where: Fila; include?: Fila; select?: Fila; orderBy?: Fila | Fila[] }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila | Fila[]; skip?: number; take?: number; include?: Fila; select?: Fila }): Promise<Fila[]>
  count(input: { where: Fila }): Promise<number>
  updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }>
}

interface Delegados {
  solicitudServicio: Delegado
  ofertaUrgente: Delegado
  perfilPublicoPrestador: Delegado
  trabajo: Delegado
  mensajeTrabajo: Delegado
  obligacionPagoServicio: Delegado
  calificacionTrabajo: Delegado
  auditEvent: Delegado
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

export interface ClientePrismaUrgentes extends Delegados {
  $transaction<T>(fn: (tx: Delegados) => Promise<T>): Promise<T>
}

// Signals that roll the transaction back with the reason the caller answers with.
class Detenida extends Error {
  constructor(readonly motivo: string) {
    super(motivo)
  }
}

const aFecha = (value: number) => new Date(value)
const desdeFecha = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value))
const opcional = (value: unknown) => (value === null || value === undefined ? null : desdeFecha(value))

function ofertaDesdeFila(fila: Fila): OfertaUrgente {
  return {
    id: String(fila['id']),
    solicitudId: String(fila['solicitudId']),
    prestadorTenantId: String(fila['prestadorTenantId']),
    prestadorId: String(fila['prestadorId']),
    cuentaId: (fila['cuentaId'] as string | null | undefined) ?? null,
    estado: fila['estado'] as EstadoOferta,
    canal: (fila['canal'] as 'whatsapp' | null | undefined) ?? null,
    motivoNoEnviada: (fila['motivoNoEnviada'] as MotivoNoEnviada | null | undefined) ?? null,
    ronda: Number(fila['ronda'] ?? 1),
    notificadaEn: opcional(fila['notificadaEn']),
    respondidaEn: opcional(fila['respondidaEn']),
    canalRespuesta: (fila['canalRespuesta'] as CanalRespuesta | null | undefined) ?? null,
    aceptadaEn: opcional(fila['aceptadaEn']),
    renunciaEn: opcional(fila['renunciaEn']),
    canalRenuncia: (fila['canalRenuncia'] as CanalRespuesta | null | undefined) ?? null,
    motivoRenuncia: (fila['motivoRenuncia'] as string | null | undefined) ?? null,
    creadaEn: desdeFecha(fila['fechaCreacion']),
    actualizadaEn: desdeFecha(fila['fechaActualizacion']),
  }
}

const filaOferta = (oferta: OfertaUrgente): Fila => ({
  id: oferta.id,
  solicitudId: oferta.solicitudId,
  prestadorTenantId: oferta.prestadorTenantId,
  prestadorId: oferta.prestadorId,
  cuentaId: oferta.cuentaId,
  estado: oferta.estado,
  canal: oferta.canal,
  motivoNoEnviada: oferta.motivoNoEnviada,
  ronda: oferta.ronda,
  notificadaEn: oferta.notificadaEn === null ? null : aFecha(oferta.notificadaEn),
  respondidaEn: oferta.respondidaEn === null ? null : aFecha(oferta.respondidaEn),
  canalRespuesta: oferta.canalRespuesta,
  aceptadaEn: oferta.aceptadaEn === null ? null : aFecha(oferta.aceptadaEn),
  renunciaEn: oferta.renunciaEn === null ? null : aFecha(oferta.renunciaEn),
  canalRenuncia: oferta.canalRenuncia,
  motivoRenuncia: oferta.motivoRenuncia,
  fechaCreacion: aFecha(oferta.creadaEn),
  fechaActualizacion: aFecha(oferta.actualizadaEn),
})

// "Nobody is assigned": never assigned, or the assigned provider gave it back. Written as an OR
// because a NOT over a nullable column would leave out the rows where it is NULL.
const SIN_ASIGNAR = [{ estadoAsignacion: null }, { estadoAsignacion: 'cancelada' }]
const ABIERTA = { difusionUrgente: true, estado: 'abierta' }

export class AlmacenUrgentesPrisma implements AlmacenUrgentes {
  constructor(
    private readonly client: ClientePrismaUrgentes,
    private readonly trabajos: TrabajosUrgentes | null = null
  ) {}

  async crear(solicitud: SolicitudServicio, ofertas: readonly OfertaUrgente[]) {
    const datos: Partial<SolicitudServicio> = { ...solicitud }
    delete datos.imagenes
    delete datos.trabajoId
    await this.client.$transaction(async (tx) => {
      await tx.solicitudServicio.create({
        data: {
          ...datos,
          creadaEn: aFecha(solicitud.creadaEn),
          actualizadaEn: aFecha(solicitud.actualizadaEn),
          expiraEn: aFecha(solicitud.expiraEn),
          respondidaEn: null,
          canceladaEn: null,
        },
      })
      for (const oferta of ofertas) await tx.ofertaUrgente.create({ data: filaOferta(oferta) })
    })
  }

  async obtener(id: string) {
    const fila = await this.client.solicitudServicio.findFirst({ where: { id, difusionUrgente: true }, include: CON_IMAGENES })
    return fila ? desdeFila(fila) : null
  }

  async ofertasDe(solicitudId: string) {
    return (await this.client.ofertaUrgente.findMany({ where: { solicitudId }, orderBy: [{ fechaCreacion: 'asc' }, { id: 'asc' }] })).map(ofertaDesdeFila)
  }

  async ofertaDe(solicitudId: string, prestadorTenantId: string) {
    const fila = await this.client.ofertaUrgente.findFirst({ where: { solicitudId, prestadorTenantId } })
    return fila ? ofertaDesdeFila(fila) : null
  }

  async agregarOferta(oferta: OfertaUrgente) {
    await this.client.ofertaUrgente.create({ data: filaOferta(oferta) })
  }

  // Only an offer that is still waiting changes: an answer that arrived meanwhile is never undone.
  async marcarAviso(input: { ofertaId: string; enviada: boolean; motivo: MotivoNoEnviada | null; ronda: number; ahora: number }) {
    const ahora = aFecha(input.ahora)
    await this.client.ofertaUrgente.updateMany({
      where: { id: input.ofertaId, estado: { in: ['notificada', 'no_enviada', 'cerrada_por_otro', 'vencida'] } },
      data: input.enviada
        ? { estado: 'notificada', canal: 'whatsapp', motivoNoEnviada: null, notificadaEn: ahora, ronda: input.ronda, fechaActualizacion: ahora }
        : { estado: 'no_enviada', motivoNoEnviada: input.motivo ?? 'fallo_envio', ronda: input.ronda, fechaActualizacion: ahora },
    })
  }

  async tomar(input: { solicitudId: string; prestadorTenantId: string; canal: CanalRespuesta; ahora: number; cliente: ClienteDelMatch; actorId: string; correlationId: string }): Promise<ResultadoTomar> {
    const ahora = aFecha(input.ahora)
    try {
      return await this.client.$transaction(async (tx) => {
        const oferta = await tx.ofertaUrgente.findFirst({ where: { solicitudId: input.solicitudId, prestadorTenantId: input.prestadorTenantId } })
        // Only a provider the request was offered to can take it.
        if (!oferta) throw new Detenida('no_candidato')
        if (oferta['estado'] === 'renuncio') throw new Detenida('renuncio')
        // The same answer again (a second tap, a webhook Meta repeats): it already won.
        if (oferta['estado'] === 'acepto') return { resultado: 'ganada' as const, trabajoId: await this.trabajoDe(tx, input.solicitudId), primera: false }
        // The request and its work move to this provider together when the previous one gave the
        // assignment back: the FK between them is checked when the transaction commits.
        await tx.$executeRawUnsafe('SET CONSTRAINTS "fk_trabajos_solicitud_asignada" DEFERRED')
        // THE decision. The conditional UPDATE takes the lock of the row: a second acceptance at
        // the same time waits, evaluates the WHERE again, finds the request assigned and changes
        // nothing.
        const tomada = await tx.solicitudServicio.updateMany({
          where: { id: input.solicitudId, ...ABIERTA, expiraEn: { gt: ahora }, OR: SIN_ASIGNAR },
          data: { visibilidad: 'dirigida', prestadorTenantId: input.prestadorTenantId, prestadorId: oferta['prestadorId'], estadoAsignacion: 'aceptada', respondidaEn: ahora, actualizadaEn: ahora },
        })
        if (tomada.count !== 1) throw new Detenida('perdio')
        const aceptada = await tx.ofertaUrgente.updateMany({
          where: { id: oferta['id'], estado: { in: [...OFERTA_TOMABLE] } },
          data: { estado: 'acepto', respondidaEn: ahora, canalRespuesta: input.canal, aceptadaEn: ahora, fechaActualizacion: ahora },
        })
        if (aceptada.count !== 1) throw new Detenida('perdio')
        // Nobody else sees it as available any more.
        await tx.ofertaUrgente.updateMany({ where: { solicitudId: input.solicitudId, id: { not: oferta['id'] }, estado: { in: ['notificada', 'no_enviada'] } }, data: { estado: 'cerrada_por_otro', fechaActualizacion: ahora } })
        let trabajoId: string | null = null
        if (this.trabajos) {
          const datos = { solicitudId: input.solicitudId, cliente: input.cliente, actorId: input.actorId, prestadorTenantId: input.prestadorTenantId, prestadorId: String(oferta['prestadorId']), correlationId: input.correlationId, ahora: input.ahora }
          // ONE work per request, always: the first provider creates it, the next ones receive it.
          const existente = await this.trabajoDe(tx, input.solicitudId)
          trabajoId = (existente ? await this.trabajos.reasignar(tx, datos) : await this.trabajos.crear(tx, datos)).trabajoId
        }
        await this.auditar(tx, { tenantId: input.prestadorTenantId, actorId: input.actorId, correlationId: input.correlationId, evento: 'urgentes.solicitud_tomada', metadata: { solicitudId: input.solicitudId, canal: input.canal, trabajoId }, ahora })
        return { resultado: 'ganada' as const, trabajoId, primera: true }
      })
    } catch (error) {
      // The unique indexes (one 'acepto' per request, one work per request) cover any race the
      // WHERE does not see: the losing transaction is rolled back whole.
      const perdio = (error instanceof Detenida && error.motivo === 'perdio') || (error as { code?: unknown })?.code === 'P2002'
      if (error instanceof Detenida && !perdio) return { resultado: error.motivo as 'no_candidato' | 'renuncio' }
      if (!perdio) throw error
      return this.porQuePerdio(input.solicitudId, input.prestadorTenantId, input.ahora)
    }
  }

  // Read AFTER losing, only to say why: it never decides who wins.
  private async porQuePerdio(solicitudId: string, prestadorTenantId: string, ahora: number): Promise<ResultadoTomar> {
    const fila = await this.client.solicitudServicio.findFirst({ where: { id: solicitudId, difusionUrgente: true }, include: CON_IMAGENES })
    if (!fila) return { resultado: 'no_candidato' }
    const solicitud = desdeFila(fila)
    if (solicitud.estadoAsignacion === 'aceptada')
      // Its own acceptance, delivered twice at once: the same answer as the first.
      return solicitud.prestadorTenantId === prestadorTenantId ? { resultado: 'ganada', trabajoId: solicitud.trabajoId, primera: false } : { resultado: 'ya_tomada' }
    if (solicitud.cierreUrgente === 'vencida' || (solicitud.estado === 'abierta' && solicitud.expiraEn <= ahora)) return { resultado: 'vencida' }
    return { resultado: 'cerrada' }
  }

  async rechazar(input: { solicitudId: string; prestadorTenantId: string; canal: CanalRespuesta; ahora: number; actorId: string }): Promise<ResultadoRechazar> {
    const ahora = aFecha(input.ahora)
    return this.client.$transaction(async (tx) => {
      const oferta = await tx.ofertaUrgente.findFirst({ where: { solicitudId: input.solicitudId, prestadorTenantId: input.prestadorTenantId } })
      if (!oferta) return { resultado: 'no_candidato' as const }
      if (oferta['estado'] === 'acepto') return { resultado: 'asignada' as const }
      if (oferta['estado'] === 'renuncio') return { resultado: 'renuncio' as const }
      if (oferta['estado'] === 'no_puede') return { resultado: 'ya_respondida' as const }
      const abierta = await tx.solicitudServicio.count({ where: { id: input.solicitudId, ...ABIERTA, expiraEn: { gt: ahora }, OR: SIN_ASIGNAR } })
      if (abierta !== 1) return { resultado: 'cerrada' as const }
      const registrada = await tx.ofertaUrgente.updateMany({
        where: { id: oferta['id'], estado: { in: ['notificada', 'no_enviada', 'cerrada_por_otro'] } },
        data: { estado: 'no_puede', respondidaEn: ahora, canalRespuesta: input.canal, fechaActualizacion: ahora },
      })
      if (registrada.count !== 1) return { resultado: 'ya_respondida' as const }
      await this.auditar(tx, { tenantId: input.prestadorTenantId, actorId: input.actorId, correlationId: randomUUID(), evento: 'urgentes.oferta_rechazada', metadata: { solicitudId: input.solicitudId, canal: input.canal }, ahora })
      // Who was told and has not answered yet.
      const pendientes = await tx.ofertaUrgente.count({ where: { solicitudId: input.solicitudId, estado: 'notificada' } })
      return { resultado: 'registrada' as const, pendientes }
    })
  }

  async renunciar(input: { solicitudId: string; prestadorTenantId: string; canal: CanalRespuesta; motivo: string | null; ahora: number; expiraEn: number; cliente: ClienteDelMatch; actorId: string; correlationId: string }): Promise<ResultadoRenuncia> {
    const ahora = aFecha(input.ahora)
    try {
      return await this.client.$transaction(async (tx) => {
        const oferta = await tx.ofertaUrgente.findFirst({ where: { solicitudId: input.solicitudId, prestadorTenantId: input.prestadorTenantId } })
        if (!oferta) throw new Detenida('no_candidato')
        // The same notice again: it already gave the request back.
        if (oferta['estado'] === 'renuncio') {
          const fila = await tx.solicitudServicio.findFirst({ where: { id: input.solicitudId }, select: { reaperturasUrgente: true } })
          return { resultado: 'reabierta' as const, primera: false, reaperturas: Number(fila?.['reaperturasUrgente'] ?? 0) }
        }
        if (oferta['estado'] !== 'acepto') throw new Detenida('no_asignado')
        // Anything that happened on the work makes this a cancellation, never a silent swap.
        const trabajoId = await this.trabajoDe(tx, input.solicitudId)
        if (trabajoId) {
          const [mensajes, obligaciones, calificaciones] = await Promise.all([
            tx.mensajeTrabajo.count({ where: { trabajoId } }),
            tx.obligacionPagoServicio.count({ where: { trabajoId } }),
            tx.calificacionTrabajo.count({ where: { trabajoId } }),
          ])
          if (mensajes + obligaciones + calificaciones > 0) throw new Detenida('con_avances')
        }
        if (this.trabajos) {
          const liberado = await this.trabajos.liberar(tx, { solicitudId: input.solicitudId, cliente: input.cliente, actorId: input.actorId, prestadorTenantId: input.prestadorTenantId, prestadorId: String(oferta['prestadorId']), correlationId: input.correlationId, ahora: input.ahora, motivo: input.motivo })
          if (liberado === 'con_avances') throw new Detenida('con_avances')
        }
        // Open again, with a new time to be taken. The row keeps naming the provider that gave it
        // back (its work, cancelled, still belongs to it) until somebody else takes it: what says
        // "nobody is assigned" is the cancelled assignment.
        const reabierta = await tx.solicitudServicio.updateMany({
          where: { id: input.solicitudId, ...ABIERTA, prestadorTenantId: input.prestadorTenantId, estadoAsignacion: 'aceptada' },
          data: { estadoAsignacion: 'cancelada', expiraEn: aFecha(input.expiraEn), reaperturasUrgente: { increment: 1 }, actualizadaEn: ahora },
        })
        if (reabierta.count !== 1) throw new Detenida('no_asignado')
        const renuncia = await tx.ofertaUrgente.updateMany({
          where: { id: oferta['id'], estado: 'acepto' },
          data: { estado: 'renuncio', renunciaEn: ahora, canalRenuncia: input.canal, motivoRenuncia: input.motivo, fechaActualizacion: ahora },
        })
        if (renuncia.count !== 1) throw new Detenida('no_asignado')
        const fila = await tx.solicitudServicio.findFirst({ where: { id: input.solicitudId }, select: { reaperturasUrgente: true } })
        const reaperturas = Number(fila?.['reaperturasUrgente'] ?? 1)
        await this.auditar(tx, { tenantId: input.prestadorTenantId, actorId: input.actorId, correlationId: input.correlationId, evento: 'urgentes.asignacion_renunciada', metadata: { solicitudId: input.solicitudId, canal: input.canal, motivo: input.motivo, reaperturas, trabajoId }, ahora })
        return { resultado: 'reabierta' as const, primera: true, reaperturas }
      })
    } catch (error) {
      if (error instanceof Detenida) return { resultado: error.motivo as 'con_avances' | 'no_asignado' | 'no_candidato' }
      throw error
    }
  }

  async cerrar(input: { solicitudId: string; motivo: 'sin_candidatos' | 'todos_rechazaron' | 'vencida'; ahora: number }) {
    const ahora = aFecha(input.ahora)
    return this.client.$transaction(async (tx) => {
      const cerrada = await tx.solicitudServicio.updateMany({
        where: { id: input.solicitudId, ...ABIERTA, OR: SIN_ASIGNAR },
        data: { estado: 'cerrada', cierreUrgente: input.motivo, actualizadaEn: ahora },
      })
      if (cerrada.count !== 1) return false
      // Whoever had not answered cannot take it any more.
      await tx.ofertaUrgente.updateMany({ where: { solicitudId: input.solicitudId, estado: { in: ['notificada', 'no_enviada', 'cerrada_por_otro'] } }, data: { estado: 'vencida', fechaActualizacion: ahora } })
      return true
    })
  }

  async vencidas(input: { ahora: number; limite: number }) {
    const filas = await this.client.solicitudServicio.findMany({ where: { ...ABIERTA, expiraEn: { lte: aFecha(input.ahora) }, OR: SIN_ASIGNAR }, orderBy: { expiraEn: 'asc' }, take: input.limite, select: { id: true } })
    return filas.map((fila) => String(fila['id']))
  }

  async abiertaDeCuenta(cuentaId: string, ahora: number) {
    const fila = await this.client.solicitudServicio.findFirst({ where: { cuentaId, ...ABIERTA, expiraEn: { gt: aFecha(ahora) }, OR: SIN_ASIGNAR }, include: CON_IMAGENES, orderBy: { creadaEn: 'desc' } })
    return fila ? desdeFila(fila) : null
  }

  async estadoDeTrabajo(solicitudId: string) {
    const fila = await this.client.trabajo.findFirst({ where: { solicitudId }, select: { estado: true } })
    return fila ? String(fila['estado']) : null
  }

  async deCuenta(cuentaId: string, limite: number) {
    return (await this.client.solicitudServicio.findMany({ where: { cuentaId, difusionUrgente: true }, orderBy: { creadaEn: 'desc' }, take: limite, include: CON_IMAGENES })).map(desdeFila)
  }

  async ofertasDePrestador(prestadorTenantId: string, limite: number) {
    const ofertas = (await this.client.ofertaUrgente.findMany({ where: { prestadorTenantId }, orderBy: { fechaCreacion: 'desc' }, take: limite })).map(ofertaDesdeFila)
    if (ofertas.length === 0) return []
    const filas = await this.client.solicitudServicio.findMany({ where: { id: { in: ofertas.map((oferta) => oferta.solicitudId) }, difusionUrgente: true }, include: CON_IMAGENES })
    const solicitudes = new Map(filas.map((fila) => [String(fila['id']), desdeFila(fila)]))
    return ofertas.flatMap((oferta) => (solicitudes.has(oferta.solicitudId) ? [{ oferta, solicitud: solicitudes.get(oferta.solicitudId)! }] : []))
  }

  async listarAdmin(input: { pagina: number; tamano: number }) {
    const where = { difusionUrgente: true }
    const [filas, total] = await Promise.all([
      this.client.solicitudServicio.findMany({ where, orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }], skip: (input.pagina - 1) * input.tamano, take: input.tamano, include: CON_IMAGENES }),
      this.client.solicitudServicio.count({ where }),
    ])
    const ofertas = filas.length === 0 ? [] : (await this.client.ofertaUrgente.findMany({ where: { solicitudId: { in: filas.map((fila) => String(fila['id'])) } }, orderBy: [{ fechaCreacion: 'asc' }, { id: 'asc' }] })).map(ofertaDesdeFila)
    return { items: filas.map((fila) => ({ solicitud: desdeFila(fila), ofertas: ofertas.filter((oferta) => oferta.solicitudId === String(fila['id'])) })), total }
  }

  async preferencia(prestadorTenantId: string) {
    const fila = await this.client.perfilPublicoPrestador.findFirst({ where: { tenantId: prestadorTenantId }, select: { aceptaUrgencias: true, coberturaTodaLaCiudad: true, zona: true, zonasCobertura: true, radioCoberturaKm: true } })
    if (!fila) return null
    const zonas = [fila['zona'], ...(Array.isArray(fila['zonasCobertura']) ? fila['zonasCobertura'] : [])].filter((value): value is string => typeof value === 'string' && value.length > 0)
    return { acepta: fila['aceptaUrgencias'] === true, todaLaCiudad: fila['coberturaTodaLaCiudad'] === true, zonas: [...new Set(zonas)], radioKm: fila['radioCoberturaKm'] === null || fila['radioCoberturaKm'] === undefined ? null : Number(fila['radioCoberturaKm']) }
  }

  async guardarPreferencia(prestadorTenantId: string, cambio: { acepta?: boolean; todaLaCiudad?: boolean }, ahora: number) {
    const data = { ...(cambio.acepta !== undefined ? { aceptaUrgencias: cambio.acepta } : {}), ...(cambio.todaLaCiudad !== undefined ? { coberturaTodaLaCiudad: cambio.todaLaCiudad } : {}), fechaActualizacion: aFecha(ahora) }
    return (await this.client.perfilPublicoPrestador.updateMany({ where: { tenantId: prestadorTenantId }, data })).count === 1
  }

  async aceptanUrgencias(tenantIds: readonly string[]) {
    if (tenantIds.length === 0) return new Map<string, { todaLaCiudad: boolean }>()
    const filas = await this.client.perfilPublicoPrestador.findMany({ where: { tenantId: { in: [...tenantIds] }, aceptaUrgencias: true }, select: { tenantId: true, coberturaTodaLaCiudad: true } })
    return new Map(filas.map((fila) => [String(fila['tenantId']), { todaLaCiudad: fila['coberturaTodaLaCiudad'] === true }]))
  }

  // The same resolver every notice to a provider uses (prestadores.cuenta_id): never a guess.
  async cuentasDePrestadores(tenantIds: readonly string[]) {
    const vinculos = await vinculosDePrestadores(this.client as unknown as ClientePrismaVinculoPrestador, tenantIds)
    return new Map(tenantIds.map((tenantId) => { const vinculo = vinculos.get(tenantId); return [tenantId, vinculo?.estado === 'vinculada' ? vinculo.cuentaId : null] as const }))
  }

  private async trabajoDe(tx: Delegados, solicitudId: string): Promise<string | null> {
    const fila = await tx.trabajo.findFirst({ where: { solicitudId }, select: { trabajoId: true } })
    return fila ? String(fila['trabajoId']) : null
  }

  // Who did what, from where and when: in the same transaction as the change.
  private async auditar(tx: Delegados, input: { tenantId: string; actorId: string; correlationId: string; evento: string; metadata: Fila; ahora: Date }) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId, eventType: input.evento, outcome: 'success', metadata: input.metadata, occurredAt: input.ahora } })
  }
}
