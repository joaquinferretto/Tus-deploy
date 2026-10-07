import { esOficio, oficio, type OficioId } from '../directorio/oficios.ts'
import { contieneContacto, zonasCorrientes, type OrigenSolicitud, type SolicitudServicio } from '../solicitudes/modelo.ts'

// SERVICIO-URGENTE-01. "Servicio urgente": the client asks for immediate attention and authorizes
// TUS to offer the request, at once, to every compatible provider; the FIRST that accepts is
// assigned. A deliberate exception to the normal flow, where the client compares and chooses.
//
// Nothing parallel: the request is a `solicitudes_servicio` row (urgencia 'urgente',
// difusion_urgente), its assigned provider is the provider of that row and its work is the ONE
// work of the request. What is new is `ofertas_urgentes`: one row per candidate, which is also the
// history of who took the request and who gave it back.
//
// The address IS shown to the providers the request is offered to (they need it to decide); it is
// never public and never part of the public views of a request.

// How long a broadcast waits for somebody to take it, from its creation and again from every
// reopening (TUS_URGENTE_VIGENCIA_MINUTOS).
export const VIGENCIA_URGENTE_MINUTOS = 15
// Enough for a city; a bound so one request never writes to an unbounded list.
export const CANDIDATOS_URGENTE_MAXIMOS = 40
// The assigned provider may give the request back; it is offered again this many times at most.
export const REAPERTURAS_URGENTE_MAXIMAS = 3

export const LIMITES_URGENTE = { direccionMin: 5, direccionMax: 160, motivoMin: 5, motivoMax: 300, motivoRenunciaMax: 300 } as const

// notificada: the notice left. no_enviada: a candidate TUS could not write to (it can still take
// the request from its panel). acepto: the assigned provider. no_puede: said no. cerrada_por_otro:
// somebody else took it. renuncio: it took the request and gave it back (never offered again).
// vencida: nobody took it in time.
export type EstadoOferta = 'notificada' | 'no_enviada' | 'acepto' | 'no_puede' | 'cerrada_por_otro' | 'renuncio' | 'vencida'
export type MotivoNoEnviada = 'sin_cuenta' | 'sin_whatsapp' | 'requiere_plantilla' | 'con_operador' | 'fallo_envio'
export type CanalRespuesta = 'whatsapp' | 'web'

// From these states a provider can still take the request (while it is open).
export const OFERTA_TOMABLE: readonly EstadoOferta[] = ['notificada', 'no_enviada', 'no_puede', 'cerrada_por_otro']

export interface OfertaUrgente {
  id: string
  solicitudId: string
  prestadorTenantId: string
  prestadorId: string
  // The account the offer went to (prestadores.cuenta_id when it was created); null: none linked.
  cuentaId: string | null
  estado: EstadoOferta
  canal: 'whatsapp' | null
  motivoNoEnviada: MotivoNoEnviada | null
  // The round of notices it was last told in (1: the first broadcast; +1 per reopening).
  ronda: number
  notificadaEn: number | null
  respondidaEn: number | null
  canalRespuesta: CanalRespuesta | null
  // History of the assignment: took it at `aceptadaEn`; gave it back at `renunciaEn`.
  aceptadaEn: number | null
  renunciaEn: number | null
  canalRenuncia: CanalRespuesta | null
  motivoRenuncia: string | null
  creadaEn: number
  actualizadaEn: number
}

// The state of a broadcast as a person reads it, derived from the row (never stored twice).
export type EstadoUrgente = 'pendiente' | 'tomada' | 'sin_candidatos' | 'todos_rechazaron' | 'vencida' | 'cancelada'

export function estadoUrgente(solicitud: SolicitudServicio, ahora: number): EstadoUrgente {
  if (solicitud.estadoAsignacion === 'aceptada') return 'tomada'
  if (solicitud.cierreUrgente) return solicitud.cierreUrgente
  if (solicitud.estado === 'cerrada') return 'cancelada'
  // Past its time and not swept yet: nobody can take it any more.
  return solicitud.expiraEn <= ahora ? 'vencida' : 'pendiente'
}

export interface NuevaUrgente {
  categoria: OficioId
  motivo: string
  direccion: string
  zona: string
}

export type CampoUrgente = 'category' | 'description' | 'address' | 'zone'

const limpio = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '')

// An address is a street and a number: it may carry digits (unlike the public text of a request),
// never an email or a link.
export const direccionValida = (value: string): boolean =>
  value.length >= LIMITES_URGENTE.direccionMin && value.length <= LIMITES_URGENTE.direccionMax && !/[^\s@]+@[^\s@]+\.[a-z]{2,}/iu.test(value) && !/(?:https?:\/\/|www\.)/iu.test(value)

export function validarNuevaUrgente(body: Record<string, unknown>): { ok: true; valor: NuevaUrgente } | { ok: false; campos: CampoUrgente[] } {
  const campos: CampoUrgente[] = []
  const categoria = body['category']
  const motivo = limpio(body['description'])
  const direccion = limpio(body['address'])
  const zona = zonasCorrientes().find((item) => item.nombre === body['zone'])
  if (typeof categoria !== 'string' || !esOficio(categoria)) campos.push('category')
  // The reason travels to several providers: no contact data in it (the contact happens in TUS).
  if (motivo.length < LIMITES_URGENTE.motivoMin || motivo.length > LIMITES_URGENTE.motivoMax || contieneContacto(motivo)) campos.push('description')
  if (!direccionValida(direccion)) campos.push('address')
  if (!zona) campos.push('zone')
  if (campos.length > 0 || !zona) return { ok: false, campos }
  return { ok: true, valor: { categoria: categoria as OficioId, motivo, direccion, zona: zona.nombre } }
}

export const tituloUrgente = (categoria: OficioId): string => `Servicio urgente de ${oficio(categoria).label}`.slice(0, 90)

// The words a provider gave when it said it cannot go, kept short and without contact data.
export function motivoRenuncia(value: unknown): string | null {
  const texto = limpio(value).slice(0, LIMITES_URGENTE.motivoRenunciaMax)
  return texto && !contieneContacto(texto) ? texto : null
}

// ---- what each party is told (one wording for WhatsApp, the Web and the tests) ----------------

export const TEXTOS_URGENTE = {
  yaTomada: 'Esta solicitud ya fue tomada por otro prestador.',
  vencida: 'Esta solicitud urgente ya venció.',
  noDisponible: 'Esta solicitud urgente ya no está disponible.',
  noEsCandidato: 'No encontré esa solicitud urgente entre las que te ofrecimos.',
  yaRenunciaste: 'Ya nos avisaste que no podías asistir a esta solicitud; se la ofrecimos a otros prestadores.',
  noPuedeRegistrado: 'Listo, registré que no podés asistir. Gracias por responder.',
  renunciaRegistrada: 'Listo, registré que finalmente no podés asistir. Le avisamos al cliente y se la ofrecemos a otros prestadores.',
  renunciaConAvances: 'Este trabajo ya tiene avances (presupuesto, mensajes o pagos), así que no puedo liberarlo desde acá. Cancelalo desde Mis trabajos indicando el motivo.',
  asignado: (aviso: { cliente: string; servicio: string; direccion: string; zona: string }) =>
    `¡Listo! La solicitud urgente de ${aviso.servicio} es tuya. Cliente: ${aviso.cliente}. Dirección: ${aviso.direccion} (${aviso.zona}). Coordiná la llegada y el presupuesto desde Mis trabajos en TUS. Si finalmente no podés ir, avisame con "no puedo asistir".`,
  cerradaPorOtro: (aviso: { servicio: string; direccion: string; zona: string }) =>
    `La solicitud urgente de ${aviso.servicio} en ${aviso.direccion}, ${aviso.zona} ya fue tomada por otro prestador. Gracias por responder.`,
  clienteDifundida: (aviso: { servicio: string; cantidad: number; minutos: number }) =>
    `Listo. Envié tu pedido urgente de ${aviso.servicio} a ${aviso.cantidad === 1 ? '1 prestador' : `${aviso.cantidad} prestadores`}. El primero que acepte queda asignado y te aviso enseguida. Si nadie responde en ${aviso.minutos} minutos, te lo digo.`,
  clienteTomada: (aviso: { prestador: string; servicio: string }) =>
    `${aviso.prestador} aceptó tu solicitud urgente de ${aviso.servicio} y se pone en contacto para coordinar la llegada. Seguí el trabajo, el presupuesto y el pago desde Mis trabajos en TUS.`,
  clienteRenuncia: (aviso: { prestador: string }) => `${aviso.prestador} finalmente no puede asistir. Estamos buscando otro prestador disponible.`,
  clienteSinCandidatos: (aviso: { servicio: string; zona: string }) =>
    `En este momento no hay prestadores de ${aviso.servicio} que tomen servicios urgentes en ${aviso.zona}, así que no envié tu dirección a nadie. Si querés, te muestro los prestadores de ${aviso.servicio} para que elijas uno.`,
  clienteTodosRechazaron: (aviso: { servicio: string }) =>
    `Ningún prestador pudo tomar tu solicitud urgente de ${aviso.servicio}. Podés pedirme los prestadores de ${aviso.servicio} y elegir uno.`,
  clienteVencida: (aviso: { servicio: string }) =>
    `Nadie llegó a tomar tu solicitud urgente de ${aviso.servicio} a tiempo y la cerré. Podés pedirla de nuevo o elegir un prestador de ${aviso.servicio}.`,
} as const

// ---- views -----------------------------------------------------------------------------------

export interface VistaUrgentePropia {
  id: string
  category: OficioId
  service: string
  description: string | null
  address: string
  zone: string
  status: EstadoUrgente
  createdAt: string
  expiresAt: string
  origin: OrigenSolicitud
  candidates: number
  notified: number
  reopenings: number
  provider: { name: string } | null
  workId: string | null
  workCancelled: boolean
}

// What a candidate sees of an offer: the address and the zone from the first notice.
export interface VistaOfertaUrgente {
  id: string
  category: OficioId
  service: string
  client: string
  description: string | null
  address: string
  zone: string
  createdAt: string
  expiresAt: string
  offer: EstadoOferta
  // It can still be taken by this provider.
  open: boolean
  // This provider is the assigned one (and may still say it cannot go).
  assigned: boolean
  workId: string | null
}

export function vistaOferta(solicitud: SolicitudServicio, oferta: OfertaUrgente, ahora: number): VistaOfertaUrgente {
  return {
    id: solicitud.id,
    category: solicitud.categoria,
    service: oficio(solicitud.categoria).label,
    client: solicitud.nombrePublico,
    description: solicitud.descripcion,
    address: solicitud.direccion ?? '',
    zone: solicitud.zona,
    createdAt: new Date(solicitud.creadaEn).toISOString(),
    expiresAt: new Date(solicitud.expiraEn).toISOString(),
    offer: oferta.estado,
    open: estadoUrgente(solicitud, ahora) === 'pendiente' && OFERTA_TOMABLE.includes(oferta.estado),
    assigned: oferta.estado === 'acepto',
    workId: oferta.estado === 'acepto' ? solicitud.trabajoId : null,
  }
}
