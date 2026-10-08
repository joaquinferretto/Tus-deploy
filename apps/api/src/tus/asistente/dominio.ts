import { sinAcentos } from '../texto.ts'
import { createHash } from 'node:crypto'
import type { TusApplicationService } from '../application/tus-application-service.ts'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { CandidatoPrestador } from '../directorio/modelo.ts'
import type { ServicioDirectorio } from '../directorio/servicio.ts'
import type { ServicioSolicitudes } from '../solicitudes/servicio.ts'
import type { ServicioTurnos, SolicitudTurnoParaAdmin } from '../calendar/turnos-service.ts'
import type { ServicioUrgentes } from '../urgentes/servicio.ts'
import { etiquetaEstadoTurno, type DetalleTurno } from '@factory/contracts'
import { senaDePrecio } from '../calendar/turnos-sena.ts'

// The assistant reaches TUS only through this port. The adapter below delegates to the SAME
// application services used by the Web/API routes (marketplace, work, finance, identity), so
// tenancy, ownership, roles and state machines are enforced exactly once, in the domain.

export interface ServicioPublico {
  listingId: string
  name: string
  description: string
  category: string
  priceMode: string
  price: { amountMinor: string; currency: string } | null
  bookingMode: string | null
  providerRef: string
  zone: string
}

export interface TrabajoResumen {
  workId: string
  status: string
  role: 'client' | 'provider'
  serviceName: string | null
  budgetRequired: boolean
  hasReservation: boolean
  updatedAt: string
}

// A provider of the trade with what it can really offer for the asked day and time. Starts come
// from the agenda of the provider (the same generator the Web books with); nothing is invented.
export interface OfertaTurnos {
  providerId: string
  name: string
  profession: string
  area: string
  verified: boolean
  completedJobs: number
  // false: this provider does not take turnos online for the trade (it works by request).
  takesAppointments: boolean
  // Duration the starts were computed for (the service or its first tarifa).
  durationMinutes: number | null
  tariffs: { id: string; name: string; durationMinutes: number; price: number }[]
  // Starts (ISO) inside the asked window.
  matches: string[]
  // Closest free starts of the asked day(s) when nothing fits the window.
  nearby: string[]
}

// matches: at least one provider fits. nearby: nobody fits the time, but there are other starts
// those days. no_availability: providers take turnos but have nothing free those days.
// no_appointments: there are providers, none takes turnos online. no_providers: nobody offers
// the trade (in that zone, when zoneRelaxed is false).
export type ResultadoDisponibilidad = 'matches' | 'nearby' | 'no_availability' | 'no_appointments' | 'no_providers'

export interface DisponibilidadNecesidad {
  profession: string
  outcome: ResultadoDisponibilidad
  // The asked zone had nobody: the providers listed are from other zones.
  zoneRelaxed: boolean
  providers: OfertaTurnos[]
}

export interface ConsultaDisponibilidad {
  profession: string
  day: string
  dayTo: string | null
  time: { kind: 'exact' | 'from' | 'until' | 'between'; from: string | null; to: string | null } | null
  zone: string | null
}

// What a professional offers for a trade, as the client chooses it: the variants (or the service
// itself when it has none) with their REAL price and the deposit the backend computes from it
// (pesos). The model never supplies or alters any of these values.
export interface ServicioTurnoAsistente {
  serviceName: string
  options: { tariffId: string | null; name: string; durationMinutes: number; price: number | null; deposit: number | null }[]
}

// A deposit the client can pay now, as the conversation names it (no internal id is ever shown;
// `ref` stays in the backend).
export interface SenaPendienteAsistente {
  ref: string
  providerName: string
  service: string | null
  startsAt: string
  amount: number
}

// TUS-WHATSAPP-MULTIMODAL-01: a deposit whose payment the client may ask about ("ya pagué").
export interface SenaVerificableAsistente {
  ref: string
  providerName: string
  service: string | null
  startsAt: string
  amount: number
  // 'pending': not paid as far as TUS knows. 'paid': Mercado Pago's payment is already applied.
  estado: 'pending' | 'paid'
}

// TUS-WHATSAPP-MULTIMODAL-02: any payment of the client that a receipt may be about: a deposit of
// a turno or the deposit/balance of a work. Listed by the backend from the client's OWN turnos and
// works (never from a receipt); `ref` is the turno reference or `work:<workId>`.
// A turno of the client with everything the backend knows about its money and its closing.
export interface PagoDeTurnoAsistente {
  ref: string
  providerName: string
  service: string | null
  startsAt: string
  pago: NonNullable<DetalleTurno['pago']>
}

export interface PagoVerificableAsistente {
  ref: string
  kind: 'turno' | 'trabajo'
  // Which part of a work (null for a turno's deposit).
  part: 'sena' | 'saldo' | 'total' | null
  providerName: string
  service: string | null
  startsAt: string | null
  amountMinor: string
  currency: string
  estado: 'pending' | 'paid'
  // Mercado Pago's payment id when TUS already knows it for this very payment.
  operationRef: string | null
}

// What the BACKEND found out about a deposit's payment, read from Mercado Pago. The assistant only
// words it: nothing in the conversation (text, audio, image, receipt) can produce `confirmed`.
export type VerificacionSenaAsistente =
  | { estado: 'confirmed'; appliedNow: boolean; turnoConfirmado: boolean; amount: number }
  | { estado: 'pending' | 'not_approved' | 'not_found' | 'quarantined' | 'unavailable' }

// What became of a request after the provider answered it.
export interface RespuestaSolicitudTurno {
  estado: string
  clienteNombre: string
  servicio: string
  inicio: string
  sena: number | null
}

export interface PuertoDominioAsistente {
  // Variants and real prices of a professional's service (null: it does not offer that service).
  servicioDeTurno(providerId: string, oficioId: string): Promise<ServicioTurnoAsistente | null>
  // Public name of a visible professional (null: unknown or not available).
  nombrePrestador(providerId: string): Promise<string | null>
  // Deposits of accepted turnos awaiting payment that the client can pay now, and the checkout of one.
  senasPendientes(context: TusAuthenticatedTenantContext): Promise<SenaPendienteAsistente[]>
  pagarSena(context: TusAuthenticatedTenantContext, ref: string): Promise<{ url: string; amount: number }>
  // PAGOS-MODALIDAD-01 / CIERRE-TRABAJO-01, the same backend the Web uses: the financial state of
  // the client's own turnos, the checkout of one part (deposit, total or balance), and the
  // closing of a finished turno (confirm it, or report a problem).
  pagosDeTurnos?(context: TusAuthenticatedTenantContext): Promise<PagoDeTurnoAsistente[]>
  pagarTurno?(context: TusAuthenticatedTenantContext, ref: string, tramo: 'sena' | 'total' | 'saldo'): Promise<{ url: string; amount: number }>
  confirmarTurno?(context: TusAuthenticatedTenantContext, ref: string): Promise<{ pendiente: string | null }>
  observarTurno?(context: TusAuthenticatedTenantContext, ref: string, reason: string): Promise<void>
  // Deposits of the client's own upcoming turnos that are pending or already paid, and the real
  // state of one deposit's payment (a turno of another account does not exist for it).
  senasVerificables?(context: TusAuthenticatedTenantContext): Promise<SenaVerificableAsistente[]>
  // Deposits of turnos plus the open deposit/balance of the client's works.
  pagosVerificables?(context: TusAuthenticatedTenantContext): Promise<PagoVerificableAsistente[]>
  verificarSena?(context: TusAuthenticatedTenantContext, ref: string): Promise<VerificacionSenaAsistente>
  // The same query for the payment (deposit or balance) of a WORK of the client: finance reads Mercado
  // Pago and applies it like the webhook does. Only the customer of the work can ask.
  verificarPagoTrabajo?(context: TusAuthenticatedTenantContext, workId: string): Promise<{ estado: 'confirmed' | 'pending' | 'not_approved' | 'not_found' | 'quarantined' | 'unavailable'; appliedNow: boolean; amountMinor: string | null; currency: string | null }>
  // Providers of a trade with their REAL free turnos for a day (or two) and a time window.
  buscarDisponibilidad(consulta: ConsultaDisponibilidad): Promise<DisponibilidadNecesidad>
  buscarServicios(filter: { query: string | null; category: string | null }): Promise<ServicioPublico[]>
  servicio(listingId: string): Promise<ServicioPublico | null>
  esPrestador(context: TusAuthenticatedTenantContext): Promise<boolean>
  solicitudes(context: TusAuthenticatedTenantContext): Promise<{ requestId: string; status: string; serviceName: string | null; slotStart: string | null; createdAt: string }[]>
  trabajos(context: TusAuthenticatedTenantContext, role: 'client' | 'provider'): Promise<TrabajoResumen[]>
  trabajo(context: TusAuthenticatedTenantContext, workId: string): Promise<{
    workId: string
    status: string
    viewer: string
    version: number
    serviceName: string | null
    budgets: { budgetId: string; version: number; status: string; totalMinor: string; currency: string; scope: string }[]
  }>
  estadoPago(context: TusAuthenticatedTenantContext, workId: string): Promise<{ payable: boolean; paymentStatus: string; amountMinor: string | null; currency: string | null; paymentAvailable: boolean; reason: string | null }>
  linkPago(context: TusAuthenticatedTenantContext, workId: string, idempotencyKey: string): Promise<{ url: string | null; status: string }>
  estadoIdentidad(context: TusAuthenticatedTenantContext): Promise<{ status: string; message: string }>
  estadoMercadoPago(context: TusAuthenticatedTenantContext): Promise<{ status: string; connectAvailable: boolean }>
  crearSolicitud(context: TusAuthenticatedTenantContext, input: { listingId: string; idempotencyKey: string }): Promise<{ requestId: string; status: string }>
  decidirPresupuesto(context: TusAuthenticatedTenantContext, input: { workId: string; budgetId: string; decision: 'accepted' | 'rejected'; reason?: string; idempotencyKey: string }): Promise<{ workId: string; status: string }>
  transicionTrabajo(context: TusAuthenticatedTenantContext, input: { workId: string; action: 'cancel' | 'complete'; idempotencyKey: string }): Promise<{ workId: string; status: string }>
  // Directorio y solicitud TUS: los mismos casos de uso que el asistente Web y "Buscar trabajador".
  buscarPrestadores(filter: { query: string | null; profession: string | null; zone: string | null }): Promise<{ profession: string | null; providers: CandidatoPrestador[] }>
  solicitarPrestador(
    context: TusAuthenticatedTenantContext,
    input: { providerId: string; title: string; description: string | null; zone: string; urgency: string; budgetMax: number | null }
  ): Promise<{ requestId: string; assignment: string; providerName: string | null }>
  // Postulaciones a solicitudes públicas: mismas reglas que /prestador/solicitudes y Mis solicitudes.
  solicitudesAbiertas(filter: { profession: string | null; zone: string | null }): Promise<SolicitudAbiertaResumen[]>
  postularse(context: TusAuthenticatedTenantContext, input: { requestId: string; message: string | null }): Promise<{ applicationId: string; status: string; requestTitle: string }>
  misSolicitudesTus(context: TusAuthenticatedTenantContext): Promise<SolicitudPropiaResumen[]>
  postulantes(context: TusAuthenticatedTenantContext, requestId: string): Promise<PostulanteResumen[]>
  elegirPostulante(context: TusAuthenticatedTenantContext, input: { requestId: string; applicationId: string }): Promise<{ requestId: string; assignment: string; providerName: string | null }>
  // TURNOS-WHATSAPP-01. The provider answers a request from WhatsApp: the same use case as the
  // panel, with the provider taken from the account linked to the number.
  responderSolicitudTurno?(context: TusAuthenticatedTenantContext, input: { reservaId: string; aceptar: boolean }): Promise<RespuestaSolicitudTurno>
  // SERVICIO-URGENTE-01. The same use cases as the Web: create and broadcast an urgent request,
  // the answer of a provider it was offered to, and the assigned provider giving it back. Who
  // acts is the account of the context (linked to the number), never a name or a button's text.
  crearUrgente?(context: TusAuthenticatedTenantContext, input: { profession: string; description: string; address: string; zone: string; origin: 'whatsapp' | 'web_assistant' }): Promise<{ ok: true; mensaje: string; solicitudId: string; estado: string } | { ok: false; code: string; fields?: string[] }>
  responderUrgente?(context: TusAuthenticatedTenantContext, input: { solicitudId: string; asistir: boolean; motivo?: string | null; correlationId?: string }): Promise<{ estado: string; mensaje: string }>
  urgenteAsignada?(context: TusAuthenticatedTenantContext): Promise<{ solicitudId: string; servicio: string; aceptadaEn: number } | null>
  renunciarUrgente?(context: TusAuthenticatedTenantContext, input: { solicitudId: string; motivo: string | null; correlationId?: string }): Promise<{ estado: string; mensaje: string }>
  // ADMIN-WHATSAPP-AVISOS-01. The requests Admin looks at (provider, account, state, answer).
  solicitudesTurnoParaAdmin?(reservaIds: readonly string[]): Promise<SolicitudTurnoParaAdmin[]>
  // Requests this provider still has to answer (nearest first).
  solicitudesTurnoPorResponder?(context: TusAuthenticatedTenantContext): Promise<Array<{ id: string; inicio: string }>>
  // The client's own request that still waits for an answer, if it has exactly one way to tell.
  solicitudTurnoEnEspera?(context: TusAuthenticatedTenantContext): Promise<{ id: string; servicio: string; inicio: string } | null>
  adjuntarImagenTurno?(context: TusAuthenticatedTenantContext, input: { reservaId: string; bytes: Buffer }): Promise<{ orden: number; total: number }>
  // Turnos y agenda: mismos contratos y servicios que la Web (/prestador/turnos y perfil del prestador)
  turnosDisponibles(providerId: string, oficioId: string, fecha: string): Promise<{
    slots: { inicio: string; fin: string; duracionMinutos: number; disponible: boolean }[]
    tarifas: { id: string; nombre: string; duracionMinutos: number; precio: number }[]
    mensaje?: string | null
  }>
  // SOLICITUD de turno (TURNOS-SOLICITUD-01): queda pendiente hasta que el prestador la acepte.
  // El cliente es la cuenta de la sesión; el asistente no puede reservar a nombre de otro ni
  // confirmar nada.
  reservarTurno(context: TusAuthenticatedTenantContext | null, input: {
    providerId: string
    oficioId: string
    inicio: string
    tarifaId?: string
    notas?: string
  }): Promise<{ id: string; prestadorNombre: string; inicio: string; fin: string; precioFinal: number | null; estado: string; sena?: { monto: number; estado: string } | null }>
  // Turnos del cliente de la sesión con su estado real (pendiente, confirmada, rechazada...).
  misTurnos(context: TusAuthenticatedTenantContext): Promise<{ id: string; providerName: string; service: string | null; startsAt: string; status: string; statusLabel: string }[]>
}

// Lo que el asistente puede ver de una solicitud pública: sin cuenta, contacto ni coordenadas.
export interface SolicitudAbiertaResumen {
  requestId: string
  profession: string
  title: string
  description: string | null
  requesterName: string
  approximateArea: string
  budgetMax: number | null
  urgency: string
  createdAt: string
}

export interface SolicitudPropiaResumen {
  requestId: string
  title: string
  profession: string
  approximateArea: string
  status: string
  assignment: string | null
  providerName: string | null
  createdAt: string
}

export interface PostulanteResumen {
  applicationId: string
  providerName: string
  profession: string
  approximateArea: string
  message: string | null
  status: string
}

// Servicios compartidos con la Web. Sin ellos las herramientas de directorio fallan cerradas.
export interface ServiciosCompartidosAsistente {
  directorio: ServicioDirectorio
  solicitudes: ServicioSolicitudes
  turnos?: ServicioTurnos
  urgentes?: ServicioUrgentes
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class DominioAsistenteTus implements PuertoDominioAsistente {
  constructor(
    private readonly application: TusApplicationService,
    private readonly now: () => number = Date.now,
    private readonly compartidos?: ServiciosCompartidosAsistente
  ) {}

  private get servicios() {
    if (!this.compartidos) throw Object.assign(new Error('directory unavailable'), { status: 503, code: 'UNAVAILABLE' })
    return this.compartidos
  }

  async buscarPrestadores(filter: { query: string | null; profession: string | null; zone: string | null }) {
    // El oficio explícito manda; si no, se interpreta el texto con las mismas reglas que la Web.
    const interpretado = filter.query ? this.servicios.directorio.interpretar(filter.query) : null
    const profession = filter.profession ?? interpretado?.category ?? null
    if (!profession) return { profession: null, providers: [] }
    const zone = filter.zone ?? interpretado?.zone ?? null
    const result = await this.servicios.directorio.buscarCandidatos({ oficio: profession, zona: zone, exigirCobertura: true })
    return { profession, providers: result.items }
  }

  async buscarDisponibilidad(consulta: ConsultaDisponibilidad): Promise<DisponibilidadNecesidad> {
    const enZona = consulta.zone ? await this.servicios.directorio.buscarCandidatos({ oficio: consulta.profession, zona: consulta.zone, exigirCobertura: true }) : null
    // Nobody covers the asked zone: the search is not a dead end, it shows who offers the trade.
    const zoneRelaxed = Boolean(enZona && enZona.items.length === 0)
    const candidatos = enZona && !zoneRelaxed ? enZona.items : (await this.servicios.directorio.buscarCandidatos({ oficio: consulta.profession })).items
    const dias = [consulta.day, ...(consulta.dayTo && consulta.dayTo !== consulta.day ? [consulta.dayTo] : [])]
    const horaLocal = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(11, 16)
    const minutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5))
    const cabe = (hora: string) => {
      const ventana = consulta.time
      if (!ventana) return true
      if (ventana.kind === 'exact') return hora === ventana.from
      if (ventana.kind === 'from') return hora >= ventana.from!
      if (ventana.kind === 'until') return hora < ventana.to!
      return hora >= ventana.from! && hora < ventana.to!
    }
    const objetivo = consulta.time ? minutos(consulta.time.from ?? consulta.time.to ?? '12:00') : null

    const providers: OfertaTurnos[] = []
    for (const candidato of candidatos) {
      const oferta: OfertaTurnos = {
        providerId: candidato.id,
        name: candidato.displayName,
        profession: candidato.profession.title,
        area: candidato.approximateArea,
        verified: candidato.verified,
        completedJobs: candidato.completedJobs,
        takesAppointments: false,
        durationMinutes: null,
        tariffs: [],
        matches: [],
        nearby: [],
      }
      const libres: string[] = []
      for (const fecha of dias) {
        // A provider that cannot be read (hidden meanwhile, turnos off) simply offers no turno.
        const turnos = await this.turnosDisponibles(candidato.id, consulta.profession, fecha).catch(() => null)
        if (!turnos || turnos.mensaje) continue
        oferta.takesAppointments = true
        oferta.tariffs = turnos.tarifas.map((tarifa) => ({ id: tarifa.id, name: tarifa.nombre, durationMinutes: tarifa.duracionMinutos, price: tarifa.precio }))
        for (const slot of turnos.slots) {
          if (!slot.disponible) continue
          oferta.durationMinutes = slot.duracionMinutos
          libres.push(slot.inicio)
        }
      }
      oferta.matches = libres.filter((inicio) => cabe(horaLocal(inicio))).slice(0, 8)
      if (oferta.matches.length === 0 && objetivo !== null)
        oferta.nearby = [...libres].sort((a, b) => Math.abs(minutos(horaLocal(a)) - objetivo) - Math.abs(minutos(horaLocal(b)) - objetivo) || a.localeCompare(b)).slice(0, 3).sort()
      providers.push(oferta)
    }

    const outcome: ResultadoDisponibilidad =
      providers.length === 0
        ? 'no_providers'
        : providers.some((item) => item.matches.length > 0)
          ? 'matches'
          : providers.some((item) => item.nearby.length > 0)
            ? 'nearby'
            : providers.some((item) => item.takesAppointments)
              ? 'no_availability'
              : 'no_appointments'
    // Who can be booked comes first; inside each group the order of the directory is kept.
    const peso = (item: OfertaTurnos) => (item.matches.length > 0 ? 0 : item.nearby.length > 0 ? 1 : item.takesAppointments ? 2 : 3)
    return { profession: consulta.profession, outcome, zoneRelaxed, providers: providers.map((item, indice) => ({ item, indice })).sort((a, b) => peso(a.item) - peso(b.item) || a.indice - b.indice).map(({ item }) => item) }
  }

  async solicitarPrestador(
    context: TusAuthenticatedTenantContext,
    input: { providerId: string; title: string; description: string | null; zone: string; urgency: string; budgetMax: number | null }
  ) {
    const destino = await this.servicios.directorio.perfil(input.providerId)
    if (!destino) throw Object.assign(new Error('provider unavailable'), { status: 409, code: 'PROVIDER_NOT_AVAILABLE' })
    const result = await this.servicios.solicitudes.publicar(
      context.subjectId,
      {
        category: destino.profession.id,
        title: input.title,
        description: input.description ?? '',
        zone: input.zone,
        urgency: input.urgency,
        budgetMax: input.budgetMax,
        providerId: input.providerId,
      },
      { origen: 'whatsapp' }
    )
    if (!result.ok) throw Object.assign(new Error('request rejected'), { status: 409, code: result.code })
    return { requestId: result.solicitud.id, assignment: result.solicitud.assignment ?? 'pendiente', providerName: result.solicitud.provider?.displayName ?? null }
  }

  async solicitudesAbiertas(filter: { profession: string | null; zone: string | null }): Promise<SolicitudAbiertaResumen[]> {
    const publicas = await this.servicios.solicitudes.listarPublicas({ categoria: filter.profession ?? undefined })
    return publicas
      .filter((item) => !filter.zone || item.approximateLocation.label === filter.zone)
      .slice(0, 8)
      .map((item) => ({
        requestId: item.id,
        profession: item.category,
        title: item.title,
        description: item.description,
        requesterName: item.requesterName,
        approximateArea: item.approximateLocation.label,
        budgetMax: item.budgetMax,
        urgency: item.urgency,
        createdAt: item.createdAt,
      }))
  }

  async postularse(context: TusAuthenticatedTenantContext, input: { requestId: string; message: string | null }) {
    const result = await this.servicios.solicitudes.postular({ tenantId: context.tenantId, cuentaId: context.subjectId }, input.requestId, { message: input.message })
    if (!result.ok) throw Object.assign(new Error('application rejected'), { status: 409, code: result.code })
    return { applicationId: result.postulacion.id, status: result.postulacion.status, requestTitle: result.postulacion.request.title }
  }

  async misSolicitudesTus(context: TusAuthenticatedTenantContext): Promise<SolicitudPropiaResumen[]> {
    return (await this.servicios.solicitudes.mias(context.subjectId)).slice(0, 10).map((item) => ({
      requestId: item.id,
      title: item.title,
      profession: item.category,
      approximateArea: item.approximateLocation.label,
      status: item.status,
      assignment: item.assignment,
      providerName: item.provider?.displayName ?? null,
      createdAt: item.createdAt,
    }))
  }

  async postulantes(context: TusAuthenticatedTenantContext, requestId: string): Promise<PostulanteResumen[]> {
    // Solo la dueña de la solicitud: el servicio devuelve NOT_FOUND para cualquier otra cuenta.
    const result = await this.servicios.solicitudes.postulantes(context.subjectId, requestId)
    if (!result.ok) throw Object.assign(new Error('request not found'), { status: 404, code: result.code })
    return result.items.map((item) => ({
      applicationId: item.id,
      providerName: item.provider.displayName,
      profession: item.provider.profession,
      approximateArea: item.provider.approximateArea,
      message: item.message,
      status: item.status,
    }))
  }

  async elegirPostulante(context: TusAuthenticatedTenantContext, input: { requestId: string; applicationId: string }) {
    const result = await this.servicios.solicitudes.elegirPostulante(context.subjectId, input.requestId, input.applicationId)
    if (!result.ok) throw Object.assign(new Error('application not available'), { status: 409, code: result.code === 'NOT_FOUND' ? 'NOT_AVAILABLE' : result.code })
    return { requestId: result.solicitud.id, assignment: result.solicitud.assignment ?? 'aceptada', providerName: result.solicitud.provider?.displayName ?? null }
  }

  async turnosDisponibles(providerId: string, oficioId: string, fecha: string) {
    if (!this.compartidos?.turnos) return { slots: [], tarifas: [] }
    const resultado = await this.compartidos.turnos.disponibilidadPublica({ prestadorId: providerId, oficioId, fecha })
    return {
      slots: resultado.slots.map((s) => ({
        inicio: s.inicio,
        fin: s.fin,
        duracionMinutos: s.duracionMinutos,
        disponible: s.disponible,
      })),
      tarifas: resultado.tarifas.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        duracionMinutos: t.duracionMinutos,
        precio: t.precio,
      })),
      mensaje: resultado.mensaje ?? null,
    }
  }

  async nombrePrestador(providerId: string): Promise<string | null> {
    const perfil = await this.servicios.directorio.perfil(providerId).catch(() => null)
    return perfil?.displayName ?? null
  }

  async servicioDeTurno(providerId: string, oficioId: string): Promise<ServicioTurnoAsistente | null> {
    if (!this.compartidos?.turnos) return null
    const servicios = await this.compartidos.turnos.serviciosDePrestador({ perfilId: providerId }).catch(() => [])
    const servicio = servicios.find((item) => item.oficioId === oficioId)
    if (!servicio || !servicio.turnosHabilitados) return null
    // The deposit is announced only where one will really be asked (online payments on).
    const conSena = (precio: number | null) => (servicio.senaRequerida && precio !== null && precio > 0 ? senaDePrecio(precio) : null)
    return {
      serviceName: servicio.nombre,
      options:
        servicio.tarifas.length > 0
          ? servicio.tarifas.map((tarifa) => ({ tariffId: tarifa.id, name: tarifa.nombre, durationMinutes: tarifa.duracionMinutos, price: tarifa.precio, deposit: conSena(tarifa.precio) }))
          : [{ tariffId: null, name: servicio.nombre, durationMinutes: servicio.duracionMinutos, price: servicio.precioBase, deposit: conSena(servicio.precioBase) }],
    }
  }

  async senasPendientes(context: TusAuthenticatedTenantContext): Promise<SenaPendienteAsistente[]> {
    if (!this.compartidos?.turnos) return []
    const turnos = await this.compartidos.turnos.turnosCliente(context.subjectId)
    return turnos
      .filter((turno) => turno.sena?.estado === 'pending')
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((turno) => ({ ref: turno.id, providerName: turno.prestadorNombre, service: turno.tarifaNombre ?? turno.oficioNombre ?? null, startsAt: turno.inicio, amount: turno.sena!.monto }))
  }

  async senasVerificables(context: TusAuthenticatedTenantContext): Promise<SenaVerificableAsistente[]> {
    if (!this.compartidos?.turnos) return []
    const turnos = await this.compartidos.turnos.turnosCliente(context.subjectId)
    const ahora = this.now()
    return turnos
      .filter((turno) => Date.parse(turno.inicio) > ahora && (turno.sena?.estado === 'pending' || turno.sena?.estado === 'paid'))
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .slice(0, 5)
      .map((turno) => ({ ref: turno.id, providerName: turno.prestadorNombre, service: turno.tarifaNombre ?? turno.oficioNombre ?? null, startsAt: turno.inicio, amount: turno.sena!.monto, estado: turno.sena!.estado as 'pending' | 'paid' }))
  }

  async pagosVerificables(context: TusAuthenticatedTenantContext): Promise<PagoVerificableAsistente[]> {
    const turnos: PagoVerificableAsistente[] = (await this.senasVerificables(context)).map((sena) => ({
      ref: sena.ref,
      kind: 'turno',
      part: null,
      providerName: sena.providerName,
      service: sena.service,
      startsAt: sena.startsAt,
      amountMinor: String(Math.round(sena.amount * 100)),
      currency: 'ARS',
      estado: sena.estado,
      operationRef: null,
    }))
    const finanzas = this.application.serviceFinance
    if (!finanzas) return turnos
    // Works of the client (the order of a turno is not one: its deposit is already listed above).
    const trabajos: PagoVerificableAsistente[] = []
    const lista = await this.trabajos(context, 'client').catch(() => [])
    for (const trabajo of lista.filter((item) => !item.hasReservation).slice(0, 10)) {
      const resumen = await finanzas.consultarFinanzasTrabajo({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, trabajoId: trabajo.workId }).catch(() => null)
      const partes = resumen?.parts ?? (resumen?.obligation ? [{ obligation: resumen.obligation, payments: resumen.payments }] : [])
      for (const parte of partes) {
        // Open and with a checkout started: a payment that may already have been made.
        if (parte.obligation.status !== 'pending_payment' || parte.payments.length === 0) continue
        const ultima = [...parte.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        trabajos.push({ ref: `work:${trabajo.workId}`, kind: 'trabajo', part: parte.obligation.part ?? 'total', providerName: '', service: trabajo.serviceName, startsAt: null, amountMinor: parte.obligation.amountMinor, currency: parte.obligation.currency, estado: 'pending', operationRef: ultima?.providerReference ?? null })
      }
    }
    return [...turnos, ...trabajos]
  }

  async verificarPagoTrabajo(context: TusAuthenticatedTenantContext, workId: string) {
    const finanzas = this.application.serviceFinance
    if (!finanzas?.verificarPagoDelTrabajo) return { estado: 'unavailable' as const, appliedNow: false, amountMinor: null, currency: null }
    const resultado = await finanzas.verificarPagoDelTrabajo({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, trabajoId: workId })
    return { estado: resultado.status === 'approved' ? ('confirmed' as const) : resultado.status, appliedNow: resultado.appliedNow, amountMinor: resultado.amountMinor, currency: resultado.currency }
  }

  async verificarSena(context: TusAuthenticatedTenantContext, ref: string): Promise<VerificacionSenaAsistente> {
    if (!this.compartidos?.turnos) return { estado: 'unavailable' }
    // The backend finance domain reads Mercado Pago and applies it like the webhook does.
    const verificacion = await this.compartidos.turnos.verificarPagoSena({ clienteId: context.subjectId, reservaId: ref, correlationId: context.correlationId })
    if (verificacion.status !== 'approved') return { estado: verificacion.status === 'pending' || verificacion.status === 'not_approved' || verificacion.status === 'quarantined' || verificacion.status === 'unavailable' ? verificacion.status : 'not_found' }
    const turnos = await this.compartidos.turnos.turnosCliente(context.subjectId)
    const turno = turnos.find((item) => item.id === ref || item.reservaId === ref)
    return { estado: 'confirmed', appliedNow: verificacion.appliedNow, turnoConfirmado: turno?.estado === 'confirmed', amount: turno?.sena?.monto ?? Number(verificacion.amountMinor ?? 0) / 100 }
  }

  async pagosDeTurnos(context: TusAuthenticatedTenantContext): Promise<PagoDeTurnoAsistente[]> {
    if (!this.compartidos?.turnos) return []
    const turnos = await this.compartidos.turnos.turnosCliente(context.subjectId)
    return turnos
      .filter((turno) => Boolean(turno.pago))
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((turno) => ({ ref: turno.id, providerName: turno.prestadorNombre, service: turno.tarifaNombre ?? turno.oficioNombre ?? null, startsAt: turno.inicio, pago: turno.pago! }))
  }

  async pagarTurno(context: TusAuthenticatedTenantContext, ref: string, tramo: 'sena' | 'total' | 'saldo') {
    if (!this.compartidos?.turnos) throw Object.assign(new Error('turnos unavailable'), { status: 503, code: 'UNAVAILABLE' })
    const entrada = { clienteId: context.subjectId, reservaId: ref, correlationId: context.correlationId }
    const pago = tramo === 'sena' ? await this.compartidos.turnos.pagarSena(entrada) : await this.compartidos.turnos.pagarTurno({ ...entrada, tramo })
    return { url: pago.checkoutUrl, amount: pago.monto }
  }

  // The closing is recorded on the order of the turno, through the same service as the Web.
  private async ordenDe(context: TusAuthenticatedTenantContext, ref: string): Promise<string> {
    const orden = this.compartidos?.turnos ? await this.compartidos.turnos.ordenDeTurno({ clienteId: context.subjectId, reservaId: ref }) : null
    if (!orden || !this.application.workClosing) throw Object.assign(new Error('turno not found'), { status: 404, code: 'NOT_FOUND' })
    return orden.trabajoId
  }

  async confirmarTurno(context: TusAuthenticatedTenantContext, ref: string) {
    const trabajoId = await this.ordenDe(context, ref)
    const resultado = await this.application.workClosing!.confirmar({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }, trabajoId)
    return { pendiente: resultado.pagos?.pending ?? null }
  }

  async observarTurno(context: TusAuthenticatedTenantContext, ref: string, reason: string) {
    const trabajoId = await this.ordenDe(context, ref)
    await this.application.workClosing!.observar({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }, trabajoId, { reason })
  }

  async pagarSena(context: TusAuthenticatedTenantContext, ref: string) {
    if (!this.compartidos?.turnos) throw Object.assign(new Error('turnos unavailable'), { status: 503, code: 'UNAVAILABLE' })
    // Only a turno of that very account: another person's does not exist for it.
    const pago = await this.compartidos.turnos.pagarSena({ clienteId: context.subjectId, reservaId: ref, correlationId: context.correlationId })
    return { url: pago.checkoutUrl, amount: pago.monto }
  }

  async reservarTurno(
    context: TusAuthenticatedTenantContext | null,
    input: {
      providerId: string
      oficioId: string
      inicio: string
      tarifaId?: string
      notas?: string
    }
  ) {
    if (!this.compartidos?.turnos) throw Object.assign(new Error('turnos unavailable'), { status: 503, code: 'UNAVAILABLE' })
    // A request belongs to an account: without a session there is nobody to request for.
    if (!context) throw Object.assign(new Error('sign-in required'), { status: 401, code: 'LOGIN_REQUIRED' })
    const turno = await this.compartidos.turnos.solicitarTurno({
      prestadorId: input.providerId,
      oficioId: input.oficioId,
      tarifaId: input.tarifaId,
      inicio: input.inicio,
      clienteId: context.subjectId,
      clienteTenantId: context.tenantId,
      notas: input.notas,
    })
    return {
      id: turno.id,
      prestadorNombre: turno.prestadorNombre,
      inicio: turno.inicio,
      fin: turno.fin,
      precioFinal: turno.precioFinal,
      estado: turno.estado,
      sena: turno.sena ? { monto: turno.sena.monto, estado: turno.sena.estado } : null,
    }
  }

  async responderSolicitudTurno(context: TusAuthenticatedTenantContext, input: { reservaId: string; aceptar: boolean }): Promise<RespuestaSolicitudTurno> {
    if (!this.compartidos?.turnos) throw Object.assign(new Error('turnos unavailable'), { status: 503, code: 'UNAVAILABLE' })
    // The provider is the tenant of the linked account: a request of another agenda answers 404.
    const pedido = { prestadorTenantId: context.tenantId, reservaId: input.reservaId, actorId: context.subjectId, canal: 'whatsapp' as const }
    const turno = input.aceptar ? await this.compartidos.turnos.aceptarSolicitud(pedido) : await this.compartidos.turnos.rechazarSolicitud(pedido)
    return { estado: turno.estado, clienteNombre: turno.clienteNombre ?? 'el cliente', servicio: turno.tarifaNombre ?? turno.oficioNombre ?? 'el servicio', inicio: turno.inicio, sena: turno.sena?.monto ?? null }
  }

  async crearUrgente(context: TusAuthenticatedTenantContext, input: { profession: string; description: string; address: string; zone: string; origin: 'whatsapp' | 'web_assistant' }) {
    if (!this.compartidos?.urgentes) return { ok: false as const, code: 'UNAVAILABLE' }
    const resultado = await this.compartidos.urgentes.crear(context.subjectId, { category: input.profession, description: input.description, address: input.address, zone: input.zone }, { origen: input.origin })
    if (!resultado.ok) return { ok: false as const, code: resultado.code, ...(resultado.fields ? { fields: resultado.fields as string[] } : {}) }
    return { ok: true as const, mensaje: resultado.mensaje, solicitudId: resultado.solicitud.id, estado: resultado.solicitud.status }
  }

  async responderUrgente(context: TusAuthenticatedTenantContext, input: { solicitudId: string; asistir: boolean; motivo?: string | null; correlationId?: string }) {
    if (!this.compartidos?.urgentes) throw Object.assign(new Error('urgent requests unavailable'), { status: 503, code: 'UNAVAILABLE' })
    const actor = { tenantId: context.tenantId, cuentaId: context.subjectId }
    const respuesta = input.asistir
      ? await this.compartidos.urgentes.asistir(actor, input.solicitudId, 'whatsapp', input.correlationId)
      : await this.compartidos.urgentes.noPuede(actor, input.solicitudId, 'whatsapp', { motivo: input.motivo ?? null, ...(input.correlationId ? { correlationId: input.correlationId } : {}) })
    return { estado: respuesta.estado, mensaje: respuesta.mensaje }
  }

  async urgenteAsignada(context: TusAuthenticatedTenantContext) {
    return this.compartidos?.urgentes ? this.compartidos.urgentes.asignadaA(context.tenantId) : null
  }

  async renunciarUrgente(context: TusAuthenticatedTenantContext, input: { solicitudId: string; motivo: string | null; correlationId?: string }) {
    if (!this.compartidos?.urgentes) throw Object.assign(new Error('urgent requests unavailable'), { status: 503, code: 'UNAVAILABLE' })
    const respuesta = await this.compartidos.urgentes.renunciar({ tenantId: context.tenantId, cuentaId: context.subjectId }, input.solicitudId, 'whatsapp', { motivo: input.motivo, ...(input.correlationId ? { correlationId: input.correlationId } : {}) })
    return { estado: respuesta.estado, mensaje: respuesta.mensaje }
  }

  async solicitudesTurnoParaAdmin(reservaIds: readonly string[]): Promise<SolicitudTurnoParaAdmin[]> {
    return this.compartidos?.turnos ? this.compartidos.turnos.solicitudesParaAdmin(reservaIds) : []
  }

  async solicitudesTurnoPorResponder(context: TusAuthenticatedTenantContext): Promise<Array<{ id: string; inicio: string }>> {
    if (!this.compartidos?.turnos) return []
    return (await this.compartidos.turnos.solicitudesPorResponder(context.tenantId)).map((fila) => ({ id: fila.id, inicio: fila.inicio.toISOString() }))
  }

  async solicitudTurnoEnEspera(context: TusAuthenticatedTenantContext): Promise<{ id: string; servicio: string; inicio: string } | null> {
    if (!this.compartidos?.turnos) return null
    const turnos = await this.compartidos.turnos.turnosCliente(context.subjectId)
    // A picture is a receipt while a deposit is due: only with nothing to pay is it a picture of
    // the request, and only when there is one request it can belong to.
    if (turnos.some((turno) => turno.estado === 'awaiting_payment')) return null
    const enEspera = turnos.filter((turno) => turno.estado === 'pending')
    if (enEspera.length !== 1) return null
    const turno = enEspera[0]!
    return { id: turno.id, servicio: turno.tarifaNombre ?? turno.oficioNombre ?? 'el servicio', inicio: turno.inicio }
  }

  async adjuntarImagenTurno(context: TusAuthenticatedTenantContext, input: { reservaId: string; bytes: Buffer }): Promise<{ orden: number; total: number }> {
    if (!this.compartidos?.turnos) throw Object.assign(new Error('turnos unavailable'), { status: 503, code: 'UNAVAILABLE' })
    return this.compartidos.turnos.adjuntarImagen({ clienteId: context.subjectId, reservaId: input.reservaId, bytes: input.bytes })
  }

  async misTurnos(context: TusAuthenticatedTenantContext) {
    if (!this.compartidos?.turnos) throw Object.assign(new Error('turnos unavailable'), { status: 503, code: 'UNAVAILABLE' })
    const turnos = await this.compartidos.turnos.turnosCliente(context.subjectId)
    return turnos.slice(0, 20).map((turno) => ({
      id: turno.id,
      providerName: turno.prestadorNombre,
      service: turno.oficioNombre ?? turno.tarifaNombre ?? null,
      startsAt: turno.inicio,
      status: turno.estado,
      statusLabel: etiquetaEstadoTurno(turno.estado),
    }))
  }

  private get marketplace() {
    if (!this.application.marketplace) throw Object.assign(new Error('marketplace unavailable'), { status: 503, code: 'UNAVAILABLE' })
    return this.application.marketplace
  }

  private get work() {
    if (!this.application.work) throw Object.assign(new Error('work unavailable'), { status: 503, code: 'UNAVAILABLE' })
    return this.application.work
  }

  async buscarServicios(filter: { query: string | null; category: string | null }): Promise<ServicioPublico[]> {
    const discovered = await this.marketplace.discover(filter.category ? { cohort: filter.category as never } : {})
    const terms = sinAcentos((filter.query ?? '').toLowerCase())
      .split(/\s+/u)
      .filter((term) => term.length > 2)
    return discovered.items
      .filter((item) => item.kind === 'service')
      .filter((item) => {
        if (terms.length === 0) return true
        const haystack = sinAcentos(`${item.name} ${item.description}`.toLowerCase())
        return terms.some((term) => haystack.includes(term.slice(0, Math.max(4, term.length - 2))))
      })
      .slice(0, 5)
      .map((item) => ({
        listingId: item.listingId,
        name: item.name,
        description: item.description.slice(0, 200),
        category: item.cohort,
        priceMode: String((item as { priceMode?: string }).priceMode ?? 'fixed'),
        price: (item as { priceMode?: string }).priceMode === 'requires_budget' ? null : { amountMinor: String(item.priceMinor), currency: item.currency },
        bookingMode: (item as { bookingMode?: string }).bookingMode ?? null,
        providerRef: item.merchantId,
        zone: item.locationId,
      }))
  }

  async servicio(listingId: string): Promise<ServicioPublico | null> {
    const listing = await this.marketplace.findPublishedService(listingId)
    if (!listing) return null
    return {
      listingId: listing.listingId,
      name: listing.name,
      description: listing.description.slice(0, 400),
      category: listing.cohort,
      priceMode: listing.priceMode ?? 'fixed',
      price: listing.priceMode === 'requires_budget' ? null : { amountMinor: String(listing.priceMinor), currency: listing.currency },
      bookingMode: listing.bookingMode ?? null,
      providerRef: listing.merchantId,
      zone: listing.locationId,
    }
  }

  async esPrestador(context: TusAuthenticatedTenantContext): Promise<boolean> {
    const merchant = await this.marketplace.store.merchant.find(context.tenantId)
    return Boolean(merchant && merchant.status === 'approved')
  }

  async solicitudes(context: TusAuthenticatedTenantContext) {
    const { commitments } = await this.marketplace.customerCommitments(context)
    const out = []
    for (const commitment of commitments.slice(-10).reverse()) {
      const listing = await this.marketplace.store.listings.find(commitment.listingId)
      out.push({
        requestId: commitment.commitmentId,
        status: commitment.status,
        serviceName: listing?.name ?? null,
        slotStart: commitment.slotStart ?? null,
        createdAt: commitment.createdAt,
      })
    }
    return out
  }

  async trabajos(context: TusAuthenticatedTenantContext, role: 'client' | 'provider'): Promise<TrabajoResumen[]> {
    const works = await this.work.listWorks({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId })
    const mine = works.filter((work) => (role === 'client' ? work.tenantId === context.tenantId : work.prestadorTenantId === context.tenantId))
    const out: TrabajoResumen[] = []
    for (const work of mine.slice(-10).reverse()) {
      const listing = work.publicacionId ? await this.marketplace.store.listings.find(work.publicacionId) : null
      out.push({
        workId: work.trabajoId,
        status: work.status,
        role,
        serviceName: listing?.name ?? null,
        budgetRequired: work.budgetRequired,
        hasReservation: Boolean(work.reservaId),
        updatedAt: work.updatedAt,
      })
    }
    return out
  }

  async trabajo(context: TusAuthenticatedTenantContext, workId: string) {
    const detail = await this.work.getWork({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }, workId)
    const listing = detail.work.publicacionId ? await this.marketplace.store.listings.find(detail.work.publicacionId) : null
    return {
      workId: detail.work.trabajoId,
      status: detail.work.status,
      viewer: detail.viewer,
      version: detail.work.version,
      serviceName: listing?.name ?? null,
      budgets: detail.budgets.map((budget) => ({
        budgetId: budget.presupuestoId,
        version: budget.version,
        status: budget.status,
        totalMinor: budget.totalMinor,
        currency: budget.currency,
        scope: budget.scope.slice(0, 300),
      })),
    }
  }

  async estadoPago(context: TusAuthenticatedTenantContext, workId: string) {
    if (!this.application.serviceFinance) throw Object.assign(new Error('finance unavailable'), { status: 503, code: 'UNAVAILABLE' })
    const preview = await this.application.serviceFinance.consultarVistaPreviaPago({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, trabajoId: workId })
    return {
      payable: preview.payable,
      paymentStatus: preview.paymentStatus,
      amountMinor: preview.amountMinor,
      currency: preview.currency,
      paymentAvailable: preview.paymentAvailable,
      reason: preview.notPayableReason ?? (preview as { unavailableReason?: string | null }).unavailableReason ?? null,
    }
  }

  async linkPago(context: TusAuthenticatedTenantContext, workId: string, idempotencyKey: string) {
    if (!this.application.serviceFinance) throw Object.assign(new Error('finance unavailable'), { status: 503, code: 'UNAVAILABLE' })
    const result = await this.application.serviceFinance.iniciarCheckout({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, trabajoId: workId, idempotencyKey })
    // Only a hosted Mercado Pago HTTPS URL is ever forwarded (never preference internals).
    const url = typeof result.checkoutUrl === 'string' && /^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//u.test(result.checkoutUrl) ? result.checkoutUrl : null
    return { url, status: String(result.status) }
  }

  async estadoIdentidad(context: TusAuthenticatedTenantContext) {
    if (!this.application.identity) return { status: 'unavailable', message: 'La verificación de identidad no está disponible.' }
    const view = await this.application.identity.estado({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId })
    return { status: view.status, message: view.message }
  }

  async estadoMercadoPago(context: TusAuthenticatedTenantContext) {
    if (!this.application.servicePayments) return { status: 'unavailable', connectAvailable: false }
    const account = await this.application.servicePayments.cuentas.estadoCuenta({ tenantId: context.tenantId })
    return { status: account.status, connectAvailable: account.connectAvailable }
  }

  async crearSolicitud(context: TusAuthenticatedTenantContext, input: { listingId: string; idempotencyKey: string }) {
    const listing = await this.marketplace.findPublishedService(input.listingId)
    if (!listing) throw Object.assign(new Error('service not found'), { status: 404, code: 'NOT_FOUND' })
    const bookingMode = listing.bookingMode ?? (listing.durationMinutes === null ? 'variable_duration' : 'fixed_shift')
    // Slot-based services need a concrete slot: they are booked on the Web for now.
    if (!['requiere_presupuesto', 'visita_diagnostico', 'variable_duration', 'duracion_estimada'].includes(bookingMode))
      throw Object.assign(new Error('slot required'), { status: 409, code: 'SLOT_REQUIRED' })
    const lines = [{ lineId: `whatsapp-${input.idempotencyKey}`.slice(0, 80), listingId: listing.listingId, context: 'service' as const, quantity: 1, availabilityVersion: listing.availabilityVersion }]
    const result = await this.marketplace.checkout({
      tenantId: context.tenantId,
      actorId: context.subjectId,
      correlationId: context.correlationId,
      idempotencyKey: input.idempotencyKey,
      cartId: `whatsapp-cart-${hash(input.idempotencyKey).slice(0, 24)}`,
      requestHash: hash({ listingId: listing.listingId, availabilityVersion: listing.availabilityVersion }),
      createdAt: new Date(this.now()).toISOString(),
      lines,
    })
    const commitment = (result as { commitments?: { commitmentId: string; status: string }[] }).commitments?.[0]
    return { requestId: commitment?.commitmentId ?? 'unknown', status: commitment?.status ?? String(result.status) }
  }

  async decidirPresupuesto(context: TusAuthenticatedTenantContext, input: { workId: string; budgetId: string; decision: 'accepted' | 'rejected'; reason?: string; idempotencyKey: string }) {
    const detail = await this.work.getWork({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }, input.workId)
    const budget = detail.budgets.find((item) => item.presupuestoId === input.budgetId)
    if (!budget) throw Object.assign(new Error('budget not found'), { status: 404, code: 'NOT_FOUND' })
    const result = await this.work.decideBudget({
      tenantId: context.tenantId,
      actorId: context.subjectId,
      correlationId: context.correlationId,
      trabajoId: input.workId,
      presupuestoId: input.budgetId,
      presupuestoVersion: budget.version,
      decision: input.decision,
      ...(input.reason ? { reason: input.reason } : {}),
      idempotencyKey: input.idempotencyKey,
      requestHash: hash({ op: 'decide', ...input, version: budget.version }),
      createdAt: new Date(this.now()).toISOString(),
    })
    return { workId: result.work.trabajoId, status: result.work.status }
  }

  async transicionTrabajo(context: TusAuthenticatedTenantContext, input: { workId: string; action: 'cancel' | 'complete'; idempotencyKey: string }) {
    const detail = await this.work.getWork({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }, input.workId)
    const command = {
      tenantId: context.tenantId,
      actorId: context.subjectId,
      correlationId: context.correlationId,
      trabajoId: input.workId,
      expectedVersion: detail.work.version,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash({ op: input.action, workId: input.workId, version: detail.work.version }),
      createdAt: new Date(this.now()).toISOString(),
    }
    const result = input.action === 'cancel' ? await this.work.cancelWork(command) : await this.work.completeWork(command)
    return { workId: result.work.trabajoId, status: result.work.status }
  }
}
