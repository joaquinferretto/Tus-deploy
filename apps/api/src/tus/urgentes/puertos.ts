import type { SolicitudServicio } from '../solicitudes/modelo.ts'
import type { ClienteDelMatch } from '../solicitudes/puertos.ts'
import type { CanalRespuesta, EstadoOferta, MotivoNoEnviada, OfertaUrgente } from './modelo.ts'

// SERVICIO-URGENTE-01: what the urgent service needs from the rest of TUS. Every port is an
// existing capability (requests, directory, works, WhatsApp); none is a parallel system.

export type ResultadoTomar =
  // `primera`: this call is the one that won (false: it had already won; nothing was repeated).
  | { resultado: 'ganada'; trabajoId: string | null; primera: boolean }
  | { resultado: 'ya_tomada' | 'vencida' | 'cerrada' | 'no_candidato' | 'renuncio' }

export type ResultadoRechazar = { resultado: 'registrada'; pendientes: number } | { resultado: 'ya_respondida' | 'no_candidato' | 'cerrada' | 'asignada' | 'renuncio' }

export type ResultadoRenuncia =
  // `primera`: this call is the one that gave it back. `reaperturas`: how many times so far.
  | { resultado: 'reabierta'; primera: boolean; reaperturas: number }
  | { resultado: 'con_avances' | 'no_asignado' | 'no_candidato' }

export interface AlmacenUrgentes {
  // The request and its candidates, together or not at all.
  crear(solicitud: SolicitudServicio, ofertas: readonly OfertaUrgente[]): Promise<void>
  obtener(id: string): Promise<SolicitudServicio | null>
  ofertasDe(solicitudId: string): Promise<OfertaUrgente[]>
  ofertaDe(solicitudId: string, prestadorTenantId: string): Promise<OfertaUrgente | null>
  // A candidate that appears when the request is offered again.
  agregarOferta(oferta: OfertaUrgente): Promise<void>
  // What happened with the notice of one candidate, in the round it was sent in.
  marcarAviso(input: { ofertaId: string; enviada: boolean; motivo: MotivoNoEnviada | null; ronda: number; ahora: number }): Promise<void>
  // FIRST ACCEPTANCE WINS. One conditional UPDATE of the request (still open, not past its time,
  // nobody assigned) decides; exactly one transaction can change that row. In the SAME transaction:
  // the offer becomes 'acepto', the others 'cerrada_por_otro', the ONE work of the request is
  // created (or moved to this provider, if the previous one gave it back) and the audit is written.
  tomar(input: { solicitudId: string; prestadorTenantId: string; canal: CanalRespuesta; ahora: number; cliente: ClienteDelMatch; actorId: string; correlationId: string }): Promise<ResultadoTomar>
  // "No puedo": only that candidate; the request stays open for the others.
  rechazar(input: { solicitudId: string; prestadorTenantId: string; canal: CanalRespuesta; ahora: number; actorId: string }): Promise<ResultadoRechazar>
  // The ASSIGNED provider gives the request back. Only while its work has not moved on: then, in
  // one transaction, the work is released, the request is open again with a new time and the offer
  // records the resignation. That provider is never offered this request again.
  renunciar(input: { solicitudId: string; prestadorTenantId: string; canal: CanalRespuesta; motivo: string | null; ahora: number; expiraEn: number; cliente: ClienteDelMatch; actorId: string; correlationId: string }): Promise<ResultadoRenuncia>
  // Closes a broadcast nobody is assigned to (conditional: false when somebody took it meanwhile).
  cerrar(input: { solicitudId: string; motivo: 'sin_candidatos' | 'todos_rechazaron' | 'vencida'; ahora: number }): Promise<boolean>
  // Open broadcasts past their time, oldest first.
  vencidas(input: { ahora: number; limite: number }): Promise<string[]>
  abiertaDeCuenta(cuentaId: string, ahora: number): Promise<SolicitudServicio | null>
  // The state of the work of a request ('requested', 'cancelled'…), or null without one.
  estadoDeTrabajo(solicitudId: string): Promise<string | null>
  deCuenta(cuentaId: string, limite: number): Promise<SolicitudServicio[]>
  // The offers of a provider with their request, newest first.
  ofertasDePrestador(prestadorTenantId: string, limite: number): Promise<{ oferta: OfertaUrgente; solicitud: SolicitudServicio }[]>
  listarAdmin(input: { pagina: number; tamano: number }): Promise<{ items: { solicitud: SolicitudServicio; ofertas: OfertaUrgente[] }[]; total: number }>
  // What a provider declared (null: that tenant has no public profile): whether it takes urgent
  // requests, whether it goes anywhere in the city, and the coverage it has on file.
  preferencia(prestadorTenantId: string): Promise<PreferenciaUrgencias | null>
  guardarPreferencia(prestadorTenantId: string, cambio: { acepta?: boolean; todaLaCiudad?: boolean }, ahora: number): Promise<boolean>
  // Of those tenants: who opted in (and whether each one declared the whole city), and the account
  // linked to each provider (null: none to be sure of).
  aceptanUrgencias(tenantIds: readonly string[]): Promise<Map<string, { todaLaCiudad: boolean }>>
  cuentasDePrestadores(tenantIds: readonly string[]): Promise<Map<string, string | null>>
}

// The ONE work of the request, written with the transactional client of the store (`tx`).
export interface TrabajosUrgentes {
  crear(tx: unknown, datos: DatosTrabajoUrgente): Promise<{ trabajoId: string }>
  // The work the previous provider released moves to this one.
  reasignar(tx: unknown, datos: DatosTrabajoUrgente): Promise<{ trabajoId: string }>
  // 'con_avances': the work already moved on (budget, diagnosis, evidence): nothing is released.
  liberar(tx: unknown, datos: DatosTrabajoUrgente & { motivo: string | null }): Promise<'liberado' | 'ya_liberado' | 'sin_trabajo' | 'con_avances'>
}

export interface DatosTrabajoUrgente {
  solicitudId: string
  cliente: ClienteDelMatch
  actorId: string
  prestadorTenantId: string
  prestadorId: string
  correlationId: string
  ahora: number
}

// Every provider that can take an urgent request of a service in a zone (ServicioDirectorio).
export interface CandidatosUrgentes {
  // `cobertura`: what that provider declared about the zone (never inferred).
  aptosParaUrgencia(input: { oficio: unknown; zona: string }): Promise<{ tenantId: string; prestadorId: string; perfilId: string; nombrePublico: string; cobertura: 'zonas' | 'radio' | 'no_cubre' | 'sin_configurar' }[]>
}

export interface PreferenciaUrgencias {
  acepta: boolean
  todaLaCiudad: boolean
  // What is on file: its own neighbourhood and the ones it lists, and its radius.
  zonas: string[]
  radioKm: number | null
}

export interface AvisoOfertaUrgente {
  solicitudId: string
  // Notices of a later round are new messages, never a repetition of the first.
  ronda: number
  cuentaId: string
  cliente: string
  servicio: string
  direccion: string
  zona: string
  motivo: string
}

export type AvisoCliente =
  | { tipo: 'tomada'; prestador: string }
  | { tipo: 'renuncia'; prestador: string }
  | { tipo: 'sin_candidatos' | 'todos_rechazaron' | 'vencida' }

// How TUS writes to the parties (WhatsApp today). Best effort for everything but `ofrecer`, whose
// outcome is recorded on the offer.
export interface NotificadorUrgentes {
  ofrecer(aviso: AvisoOfertaUrgente): Promise<{ enviada: true } | { enviada: false; motivo: MotivoNoEnviada }>
  // To a candidate that was told about it: somebody else took it (only where free text is allowed).
  cerradaPorOtro(aviso: { solicitudId: string; ronda: number; cuentaId: string; servicio: string; direccion: string; zona: string }): Promise<void>
  alCliente(aviso: { solicitudId: string; cuentaId: string; servicio: string; zona: string; evento: AvisoCliente; marca: string }): Promise<void>
}

export interface CuentasUrgentes {
  getAccount(accountId: string): Promise<{ displayName: string; status: string; emailVerifiedAt: number | null; phoneVerifiedAt?: number | null; tenantId: string } | undefined>
}

export type { EstadoOferta }
