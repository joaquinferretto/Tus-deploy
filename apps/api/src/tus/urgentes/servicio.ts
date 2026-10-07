import { randomUUID } from 'node:crypto'

import { oficio } from '../directorio/oficios.ts'
import { LIMITES_SOLICITUD, nombrePublico, ubicacionAproximada, type OrigenSolicitud, type SolicitudServicio } from '../solicitudes/modelo.ts'
import {
  CANDIDATOS_URGENTE_MAXIMOS,
  REAPERTURAS_URGENTE_MAXIMAS,
  TEXTOS_URGENTE,
  VIGENCIA_URGENTE_MINUTOS,
  estadoUrgente,
  motivoRenuncia,
  tituloUrgente,
  validarNuevaUrgente,
  vistaOferta,
  type CampoUrgente,
  type CanalRespuesta,
  type EstadoUrgente,
  type OfertaUrgente,
  type VistaOfertaUrgente,
  type VistaUrgentePropia,
} from './modelo.ts'
import type { AlmacenUrgentes, AvisoCliente, CandidatosUrgentes, CuentasUrgentes, NotificadorUrgentes } from './puertos.ts'

// SERVICIO-URGENTE-01. The use cases of an urgent request, the same from the Web and from
// WhatsApp: create and broadcast, take (first wins), say no, give the assignment back, expire.
// Who acts is always resolved by the caller from a real identity (a session, or the account linked
// to a WhatsApp number): nothing here trusts a name or the text of a button.

const DIA_MS = 24 * 60 * 60 * 1000

export type CodigoErrorUrgente = 'ACCOUNT_NOT_ALLOWED' | 'RATE_LIMITED' | 'URGENT_ALREADY_OPEN' | 'NOT_FOUND' | 'PROVIDER_REQUIRED'

export type ResultadoCrearUrgente =
  | { ok: true; solicitud: VistaUrgentePropia; mensaje: string }
  | { ok: false; code: 'INVALID_REQUEST'; fields: CampoUrgente[] }
  | { ok: false; code: CodigoErrorUrgente; fields?: undefined }

// What the provider that answered is told. `estado` is the fact; `mensaje` its wording.
export interface RespuestaUrgente {
  estado: 'asignado' | 'ya_tomada' | 'vencida' | 'no_disponible' | 'no_candidato' | 'no_puede' | 'ya_respondida' | 'renuncia' | 'ya_renuncio' | 'con_avances' | 'no_asignado'
  mensaje: string
  trabajoId: string | null
}

export interface DependenciasUrgentes {
  almacen: AlmacenUrgentes
  cuentas: CuentasUrgentes
  candidatos: CandidatosUrgentes
  // Without it nothing is sent: every candidate is recorded as not notified (fail closed).
  notificador?: NotificadorUrgentes | null
  // Requests the account published lately, of any kind (the limits of ServicioSolicitudes).
  publicadasDesde?: (cuentaId: string, desde: number) => Promise<number>
  vigenciaMinutos?: number
  now?: () => number
  newId?: () => string
  log?: (evento: string, campos: Record<string, unknown>) => void
}

export class ServicioUrgentes {
  private readonly now: () => number
  private readonly newId: () => string
  readonly vigenciaMinutos: number

  constructor(private readonly deps: DependenciasUrgentes) {
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? randomUUID
    const minutos = deps.vigenciaMinutos ?? VIGENCIA_URGENTE_MINUTOS
    this.vigenciaMinutos = Number.isFinite(minutos) && minutos >= 1 && minutos <= 24 * 60 ? Math.round(minutos) : VIGENCIA_URGENTE_MINUTOS
  }

  // The notifier is born after this service (the WhatsApp module needs it to answer providers):
  // it is plugged in once both exist, like the notifier of turnos.
  conNotificador(notificador: NotificadorUrgentes | null): this {
    this.deps.notificador = notificador
    return this
  }

  // ---- the client ------------------------------------------------------------------------------

  // Creates the request and offers it, at once, to every compatible provider. The address travels
  // to them: asking for an urgent service is the authorization to do so.
  async crear(cuentaId: string, body: Record<string, unknown>, opciones: { origen?: OrigenSolicitud } = {}): Promise<ResultadoCrearUrgente> {
    const validacion = validarNuevaUrgente(body)
    if (!validacion.ok) return { ok: false, code: 'INVALID_REQUEST', fields: validacion.campos }
    const cuenta = await this.deps.cuentas.getAccount(cuentaId)
    // The same rule as any request: an active account verified by email or by its phone.
    if (!cuenta || cuenta.status !== 'active' || (!cuenta.emailVerifiedAt && !cuenta.phoneVerifiedAt)) return { ok: false, code: 'ACCOUNT_NOT_ALLOWED' }
    const ahora = this.now()
    if (await this.deps.almacen.abiertaDeCuenta(cuentaId, ahora)) return { ok: false, code: 'URGENT_ALREADY_OPEN' }
    if (this.deps.publicadasDesde && (await this.deps.publicadasDesde(cuentaId, ahora - DIA_MS)) >= LIMITES_SOLICITUD.publicacionesPorDia) return { ok: false, code: 'RATE_LIMITED' }

    const { categoria, motivo, direccion, zona } = validacion.valor
    const id = this.newId()
    const punto = ubicacionAproximada(zona, id)
    const solicitud: SolicitudServicio = {
      id,
      cuentaId,
      categoria,
      titulo: tituloUrgente(categoria),
      descripcion: motivo,
      nombrePublico: nombrePublico(cuenta.displayName),
      zona,
      latitud: punto.lat,
      longitud: punto.lng,
      presupuestoMaximo: null,
      urgencia: 'urgente',
      estado: 'abierta',
      creadaEn: ahora,
      actualizadaEn: ahora,
      expiraEn: ahora + this.vigenciaMinutos * 60_000,
      origen: opciones.origen ?? 'web_publica',
      // Not public (it carries an address) and nobody is assigned yet: `difusionUrgente` keeps it
      // out of the map and of the list of open requests.
      visibilidad: 'publica',
      prestadorTenantId: null,
      prestadorId: null,
      estadoAsignacion: null,
      respondidaEn: null,
      canceladaEn: null,
      canceladaPor: null,
      imagenes: [],
      trabajoId: null,
      direccion,
      difusionUrgente: true,
      cierreUrgente: null,
      reaperturasUrgente: 0,
    }
    const candidatos = await this.candidatos(solicitud, cuenta.tenantId, new Set())
    const ofertas = candidatos.map((candidato): OfertaUrgente => this.ofertaNueva(solicitud.id, candidato, 1, ahora))
    await this.deps.almacen.crear(solicitud, ofertas)
    const notificados = await this.ofrecer(solicitud, ofertas, 1)
    const servicio = oficio(categoria).label
    if (notificados === 0) {
      // Nobody to write to: closed at once, and said so (never left waiting for nobody).
      await this.deps.almacen.cerrar({ solicitudId: solicitud.id, motivo: 'sin_candidatos', ahora: this.now() })
      const cerrada = (await this.deps.almacen.obtener(solicitud.id)) ?? solicitud
      return { ok: true, solicitud: await this.vistaPropia(cerrada), mensaje: TEXTOS_URGENTE.clienteSinCandidatos({ servicio, zona }) }
    }
    return { ok: true, solicitud: await this.vistaPropia(solicitud), mensaje: TEXTOS_URGENTE.clienteDifundida({ servicio, cantidad: notificados, minutos: this.vigenciaMinutos }) }
  }

  async mias(cuentaId: string): Promise<VistaUrgentePropia[]> {
    return Promise.all((await this.deps.almacen.deCuenta(cuentaId, 20)).map((solicitud) => this.vistaPropia(solicitud)))
  }

  // ---- the provider ----------------------------------------------------------------------------

  // "Puedo asistir". `actor` is the real identity (tenant of the session or of the account linked
  // to the WhatsApp number). The first acceptance wins; every other one is told so.
  async asistir(actor: { tenantId: string; cuentaId: string }, solicitudId: unknown, canal: CanalRespuesta, correlationId: string = randomUUID()): Promise<RespuestaUrgente> {
    const solicitud = typeof solicitudId === 'string' && solicitudId ? await this.deps.almacen.obtener(solicitudId) : null
    if (!solicitud) return { estado: 'no_candidato', mensaje: TEXTOS_URGENTE.noEsCandidato, trabajoId: null }
    const duena = await this.deps.cuentas.getAccount(solicitud.cuentaId)
    if (!duena?.tenantId || duena.tenantId === actor.tenantId) return { estado: 'no_candidato', mensaje: TEXTOS_URGENTE.noEsCandidato, trabajoId: null }
    const resultado = await this.deps.almacen.tomar({ solicitudId: solicitud.id, prestadorTenantId: actor.tenantId, canal, ahora: this.now(), cliente: { tenantId: duena.tenantId, actorId: solicitud.cuentaId }, actorId: actor.cuentaId, correlationId })
    if (resultado.resultado === 'ganada') {
      // The notices leave once: only for the call that won.
      if (resultado.primera) await this.avisarToma(solicitud, actor.tenantId)
      return { estado: 'asignado', mensaje: TEXTOS_URGENTE.asignado({ cliente: solicitud.nombrePublico, servicio: oficio(solicitud.categoria).label, direccion: solicitud.direccion ?? '', zona: solicitud.zona }), trabajoId: resultado.trabajoId }
    }
    if (resultado.resultado === 'ya_tomada') return { estado: 'ya_tomada', mensaje: TEXTOS_URGENTE.yaTomada, trabajoId: null }
    if (resultado.resultado === 'vencida') return { estado: 'vencida', mensaje: TEXTOS_URGENTE.vencida, trabajoId: null }
    if (resultado.resultado === 'renuncio') return { estado: 'ya_renuncio', mensaje: TEXTOS_URGENTE.yaRenunciaste, trabajoId: null }
    if (resultado.resultado === 'no_candidato') return { estado: 'no_candidato', mensaje: TEXTOS_URGENTE.noEsCandidato, trabajoId: null }
    return { estado: 'no_disponible', mensaje: TEXTOS_URGENTE.noDisponible, trabajoId: null }
  }

  // "No puedo". From a candidate: only its offer. From the ASSIGNED provider it is not a rejection
  // but giving the assignment back (renunciar): the request is offered again to the others.
  async noPuede(actor: { tenantId: string; cuentaId: string }, solicitudId: unknown, canal: CanalRespuesta, opciones: { motivo?: unknown; correlationId?: string } = {}): Promise<RespuestaUrgente> {
    const solicitud = typeof solicitudId === 'string' && solicitudId ? await this.deps.almacen.obtener(solicitudId) : null
    if (!solicitud) return { estado: 'no_candidato', mensaje: TEXTOS_URGENTE.noEsCandidato, trabajoId: null }
    const resultado = await this.deps.almacen.rechazar({ solicitudId: solicitud.id, prestadorTenantId: actor.tenantId, canal, ahora: this.now(), actorId: actor.cuentaId })
    if (resultado.resultado === 'asignada') return this.renunciar(actor, solicitud.id, canal, opciones)
    if (resultado.resultado === 'renuncio') return { estado: 'ya_renuncio', mensaje: TEXTOS_URGENTE.yaRenunciaste, trabajoId: null }
    if (resultado.resultado === 'no_candidato') return { estado: 'no_candidato', mensaje: TEXTOS_URGENTE.noEsCandidato, trabajoId: null }
    if (resultado.resultado === 'cerrada') {
      const estado = estadoUrgente(solicitud, this.now())
      return { estado: estado === 'tomada' ? 'ya_tomada' : 'no_disponible', mensaje: estado === 'tomada' ? TEXTOS_URGENTE.yaTomada : TEXTOS_URGENTE.noDisponible, trabajoId: null }
    }
    if (resultado.resultado === 'registrada' && resultado.pendientes === 0) {
      // Nobody is left to answer: closed and the client told (only by the call that closes it).
      if (await this.deps.almacen.cerrar({ solicitudId: solicitud.id, motivo: 'todos_rechazaron', ahora: this.now() })) await this.avisarCliente(solicitud, { tipo: 'todos_rechazaron' }, 'cierre')
    }
    return { estado: resultado.resultado === 'registrada' ? 'no_puede' : 'ya_respondida', mensaje: TEXTOS_URGENTE.noPuedeRegistrado, trabajoId: null }
  }

  // The assigned provider says it cannot go after all. Only before anything happened on its work:
  // the work is released, the request opens again for a new stretch and is offered to everybody
  // else that is still valid. With progress on the work nothing is swapped: it is a cancellation.
  async renunciar(actor: { tenantId: string; cuentaId: string }, solicitudId: unknown, canal: CanalRespuesta, opciones: { motivo?: unknown; correlationId?: string } = {}): Promise<RespuestaUrgente> {
    const solicitud = typeof solicitudId === 'string' && solicitudId ? await this.deps.almacen.obtener(solicitudId) : null
    if (!solicitud) return { estado: 'no_candidato', mensaje: TEXTOS_URGENTE.noEsCandidato, trabajoId: null }
    const duena = await this.deps.cuentas.getAccount(solicitud.cuentaId)
    if (!duena?.tenantId) return { estado: 'no_candidato', mensaje: TEXTOS_URGENTE.noEsCandidato, trabajoId: null }
    const ahora = this.now()
    const resultado = await this.deps.almacen.renunciar({
      solicitudId: solicitud.id,
      prestadorTenantId: actor.tenantId,
      canal,
      motivo: motivoRenuncia(opciones.motivo),
      ahora,
      expiraEn: ahora + this.vigenciaMinutos * 60_000,
      cliente: { tenantId: duena.tenantId, actorId: solicitud.cuentaId },
      actorId: actor.cuentaId,
      correlationId: opciones.correlationId ?? randomUUID(),
    })
    if (resultado.resultado === 'con_avances') return { estado: 'con_avances', mensaje: TEXTOS_URGENTE.renunciaConAvances, trabajoId: solicitud.trabajoId }
    if (resultado.resultado !== 'reabierta') return { estado: resultado.resultado === 'no_candidato' ? 'no_candidato' : 'no_asignado', mensaje: resultado.resultado === 'no_candidato' ? TEXTOS_URGENTE.noEsCandidato : TEXTOS_URGENTE.noDisponible, trabajoId: null }
    if (!resultado.primera) return { estado: 'ya_renuncio', mensaje: TEXTOS_URGENTE.yaRenunciaste, trabajoId: null }
    await this.reofrecer(solicitud.id, actor.tenantId, duena.tenantId, resultado.reaperturas)
    return { estado: 'renuncia', mensaje: TEXTOS_URGENTE.renunciaRegistrada, trabajoId: null }
  }

  // The offers of a provider (its panel): what it can still take and what it took.
  async ofertas(prestadorTenantId: string): Promise<VistaOfertaUrgente[]> {
    const ahora = this.now()
    return (await this.deps.almacen.ofertasDePrestador(prestadorTenantId, 30)).map(({ oferta, solicitud }) => vistaOferta(solicitud, oferta, ahora))
  }

  // The request this provider is assigned to right now, if any (the newest): what "no puedo
  // asistir" written in a chat refers to.
  async asignadaA(prestadorTenantId: string): Promise<{ solicitudId: string; servicio: string; aceptadaEn: number } | null> {
    const asignada = (await this.deps.almacen.ofertasDePrestador(prestadorTenantId, 30)).find(({ oferta, solicitud }) => oferta.estado === 'acepto' && solicitud.estado === 'abierta' && solicitud.estadoAsignacion === 'aceptada')
    return asignada ? { solicitudId: asignada.solicitud.id, servicio: oficio(asignada.solicitud.categoria).label, aceptadaEn: asignada.oferta.aceptadaEn ?? asignada.oferta.actualizadaEn } : null
  }

  async preferencia(prestadorTenantId: string): Promise<{ ok: true; acceptsUrgent: boolean } | { ok: false; code: 'PROVIDER_REQUIRED' }> {
    const valor = await this.deps.almacen.preferencia(prestadorTenantId)
    return valor === null ? { ok: false, code: 'PROVIDER_REQUIRED' } : { ok: true, acceptsUrgent: valor }
  }

  async guardarPreferencia(prestadorTenantId: string, valor: unknown): Promise<{ ok: true; acceptsUrgent: boolean } | { ok: false; code: 'PROVIDER_REQUIRED' | 'INVALID_REQUEST' }> {
    if (typeof valor !== 'boolean') return { ok: false, code: 'INVALID_REQUEST' }
    return (await this.deps.almacen.guardarPreferencia(prestadorTenantId, valor, this.now())) ? { ok: true, acceptsUrgent: valor } : { ok: false, code: 'PROVIDER_REQUIRED' }
  }

  // ---- expiry ----------------------------------------------------------------------------------

  // Closes every broadcast past its time. State lives in PostgreSQL (expira_en): a restart loses
  // nothing, the next run finds them. Returns how many it closed.
  async procesarVencidas(limite = 25): Promise<number> {
    let cerradas = 0
    for (const id of await this.deps.almacen.vencidas({ ahora: this.now(), limite })) {
      const solicitud = await this.deps.almacen.obtener(id)
      // Conditional: a provider that took it this very moment keeps it.
      if (!solicitud || !(await this.deps.almacen.cerrar({ solicitudId: id, motivo: 'vencida', ahora: this.now() }))) continue
      cerradas += 1
      await this.avisarCliente(solicitud, { tipo: 'vencida' }, `vencida-${solicitud.reaperturasUrgente ?? 0}`)
    }
    return cerradas
  }

  // ---- administration --------------------------------------------------------------------------

  async paginaParaAdmin(input: { pagina: number; tamano: number }) {
    const ahora = this.now()
    const { items, total } = await this.deps.almacen.listarAdmin(input)
    return { items: items.map(({ solicitud, ofertas }) => ({ solicitud, ofertas, estado: estadoUrgente(solicitud, ahora) as EstadoUrgente })), total }
  }

  // ---- internals -------------------------------------------------------------------------------

  // Every provider that can be offered this request NOW, checked again each time it is offered:
  // of that service, visible and approved, covering the zone, that opted in, not the client's own
  // tenant, and not one already left out of this request.
  private async candidatos(solicitud: SolicitudServicio, clienteTenantId: string, excluidos: ReadonlySet<string>) {
    const aptos = (await this.deps.candidatos.aptosParaUrgencia({ oficio: solicitud.categoria, zona: solicitud.zona })).filter((item) => item.tenantId !== clienteTenantId && !excluidos.has(item.tenantId))
    const aceptan = await this.deps.almacen.aceptanUrgencias(aptos.map((item) => item.tenantId))
    const elegidos = aptos.filter((item) => aceptan.has(item.tenantId)).slice(0, CANDIDATOS_URGENTE_MAXIMOS)
    const cuentas = await this.deps.almacen.cuentasDePrestadores(elegidos.map((item) => item.tenantId))
    return elegidos.map((item) => ({ ...item, cuentaId: cuentas.get(item.tenantId) ?? null }))
  }

  private ofertaNueva(solicitudId: string, candidato: { tenantId: string; prestadorId: string; cuentaId: string | null }, ronda: number, ahora: number): OfertaUrgente {
    return {
      id: this.newId(),
      solicitudId,
      prestadorTenantId: candidato.tenantId,
      prestadorId: candidato.prestadorId,
      cuentaId: candidato.cuentaId,
      // Recorded as not notified until its notice really leaves.
      estado: 'no_enviada',
      canal: null,
      motivoNoEnviada: candidato.cuentaId ? 'fallo_envio' : 'sin_cuenta',
      ronda,
      notificadaEn: null,
      respondidaEn: null,
      canalRespuesta: null,
      aceptadaEn: null,
      renunciaEn: null,
      canalRenuncia: null,
      motivoRenuncia: null,
      creadaEn: ahora,
      actualizadaEn: ahora,
    }
  }

  // The notice to each candidate, all at once. What happened with each one is recorded on its
  // offer. Returns how many notices really left.
  private async ofrecer(solicitud: SolicitudServicio, ofertas: readonly OfertaUrgente[], ronda: number): Promise<number> {
    const servicio = oficio(solicitud.categoria).label
    const resultados = await Promise.all(
      ofertas.map(async (oferta) => {
        let resultado: Awaited<ReturnType<NotificadorUrgentes['ofrecer']>>
        if (!oferta.cuentaId) resultado = { enviada: false, motivo: 'sin_cuenta' }
        else if (!this.deps.notificador) resultado = { enviada: false, motivo: 'sin_whatsapp' }
        else {
          try {
            resultado = await this.deps.notificador.ofrecer({ solicitudId: solicitud.id, ronda, cuentaId: oferta.cuentaId, cliente: solicitud.nombrePublico, servicio, direccion: solicitud.direccion ?? '', zona: solicitud.zona, motivo: solicitud.descripcion ?? '' })
          } catch (error) {
            this.deps.log?.('urgentes.aviso_fallido', { solicitudId: solicitud.id, error: error instanceof Error ? error.name : 'unknown' })
            resultado = { enviada: false, motivo: 'fallo_envio' }
          }
        }
        await this.deps.almacen.marcarAviso({ ofertaId: oferta.id, enviada: resultado.enviada, motivo: resultado.enviada ? null : resultado.motivo, ronda, ahora: this.now() })
        return resultado.enviada
      })
    )
    return resultados.filter(Boolean).length
  }

  // Somebody took it: the client is told who, and everybody else that had been told about it
  // stops seeing it as available.
  private async avisarToma(solicitud: SolicitudServicio, ganadorTenantId: string) {
    const ofertas = await this.deps.almacen.ofertasDe(solicitud.id)
    const ganadora = ofertas.find((oferta) => oferta.prestadorTenantId === ganadorTenantId)
    const nombres = await this.nombres(solicitud, [ganadorTenantId])
    await this.avisarCliente(solicitud, { tipo: 'tomada', prestador: nombres.get(ganadorTenantId) ?? 'Un prestador' }, `tomada-${ganadora?.ronda ?? 1}-${ganadorTenantId}`)
    const servicio = oficio(solicitud.categoria).label
    await Promise.all(
      ofertas
        .filter((oferta) => oferta.estado === 'cerrada_por_otro' && oferta.cuentaId && oferta.notificadaEn !== null)
        .map((oferta) => this.deps.notificador?.cerradaPorOtro({ solicitudId: solicitud.id, ronda: oferta.ronda, cuentaId: oferta.cuentaId!, servicio, direccion: solicitud.direccion ?? '', zona: solicitud.zona }).catch(() => undefined))
    )
  }

  // The assigned provider gave the request back: the client is told, and the SAME request is
  // offered again to who is still valid — never to who gave it back, never to who said no.
  private async reofrecer(solicitudId: string, renuncioTenantId: string, clienteTenantId: string, reaperturas: number) {
    const solicitud = await this.deps.almacen.obtener(solicitudId)
    if (!solicitud) return
    const nombres = await this.nombres(solicitud, [renuncioTenantId])
    await this.avisarCliente(solicitud, { tipo: 'renuncia', prestador: nombres.get(renuncioTenantId) ?? 'El prestador' }, `renuncia-${reaperturas}`)
    const previas = await this.deps.almacen.ofertasDe(solicitudId)
    // Too many reopenings: it is not offered again (no loop); it closes and the client is told.
    if (reaperturas > REAPERTURAS_URGENTE_MAXIMAS) {
      if (await this.deps.almacen.cerrar({ solicitudId, motivo: 'todos_rechazaron', ahora: this.now() })) await this.avisarCliente(solicitud, { tipo: 'todos_rechazaron' }, 'cierre')
      return
    }
    const fuera = new Set(previas.filter((oferta) => oferta.estado === 'renuncio' || oferta.estado === 'no_puede').map((oferta) => oferta.prestadorTenantId))
    const validos = await this.candidatos(solicitud, clienteTenantId, fuera)
    const ronda = reaperturas + 1
    const ahora = this.now()
    const porTenant = new Map(previas.map((oferta) => [oferta.prestadorTenantId, oferta]))
    const aOfrecer: OfertaUrgente[] = []
    for (const candidato of validos) {
      const previa = porTenant.get(candidato.tenantId)
      if (previa) aOfrecer.push({ ...previa, cuentaId: candidato.cuentaId ?? previa.cuentaId })
      else {
        // A provider that became valid since the first broadcast joins this round.
        const nueva = this.ofertaNueva(solicitudId, candidato, ronda, ahora)
        await this.deps.almacen.agregarOferta(nueva)
        aOfrecer.push(nueva)
      }
    }
    const notificados = await this.ofrecer(solicitud, aOfrecer, ronda)
    if (notificados === 0 && (await this.deps.almacen.cerrar({ solicitudId, motivo: 'todos_rechazaron', ahora: this.now() }))) await this.avisarCliente(solicitud, { tipo: 'todos_rechazaron' }, 'cierre')
  }

  private async avisarCliente(solicitud: SolicitudServicio, evento: AvisoCliente, marca: string) {
    try {
      await this.deps.notificador?.alCliente({ solicitudId: solicitud.id, cuentaId: solicitud.cuentaId, servicio: oficio(solicitud.categoria).label, zona: solicitud.zona, evento, marca })
    } catch (error) {
      this.deps.log?.('urgentes.aviso_cliente_fallido', { solicitudId: solicitud.id, error: error instanceof Error ? error.name : 'unknown' })
    }
  }

  private async nombres(solicitud: SolicitudServicio, tenantIds: readonly string[]): Promise<Map<string, string>> {
    const aptos = await this.deps.candidatos.aptosParaUrgencia({ oficio: solicitud.categoria, zona: solicitud.zona }).catch(() => [])
    return new Map(aptos.filter((item) => tenantIds.includes(item.tenantId)).map((item) => [item.tenantId, item.nombrePublico]))
  }

  private async vistaPropia(solicitud: SolicitudServicio): Promise<VistaUrgentePropia> {
    const ofertas = await this.deps.almacen.ofertasDe(solicitud.id)
    const asignada = solicitud.estadoAsignacion === 'aceptada' && solicitud.prestadorTenantId ? solicitud.prestadorTenantId : null
    const nombre = asignada ? (await this.nombres(solicitud, [asignada])).get(asignada) ?? 'Prestador asignado' : null
    return {
      id: solicitud.id,
      category: solicitud.categoria,
      service: oficio(solicitud.categoria).label,
      description: solicitud.descripcion,
      address: solicitud.direccion ?? '',
      zone: solicitud.zona,
      status: estadoUrgente(solicitud, this.now()),
      createdAt: new Date(solicitud.creadaEn).toISOString(),
      expiresAt: new Date(solicitud.expiraEn).toISOString(),
      origin: solicitud.origen,
      candidates: ofertas.length,
      notified: ofertas.filter((oferta) => oferta.notificadaEn !== null).length,
      reopenings: solicitud.reaperturasUrgente ?? 0,
      provider: nombre ? { name: nombre } : null,
      workId: asignada ? solicitud.trabajoId : null,
    }
  }
}

// What the client is told for each event (one wording for every channel).
export function textoParaCliente(evento: AvisoCliente, datos: { servicio: string; zona: string }): string {
  if (evento.tipo === 'tomada') return TEXTOS_URGENTE.clienteTomada({ prestador: evento.prestador, servicio: datos.servicio })
  if (evento.tipo === 'renuncia') return TEXTOS_URGENTE.clienteRenuncia({ prestador: evento.prestador })
  if (evento.tipo === 'sin_candidatos') return TEXTOS_URGENTE.clienteSinCandidatos(datos)
  if (evento.tipo === 'todos_rechazaron') return TEXTOS_URGENTE.clienteTodosRechazaron(datos)
  return TEXTOS_URGENTE.clienteVencida(datos)
}
