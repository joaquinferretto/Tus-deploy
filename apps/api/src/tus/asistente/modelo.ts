import { waIdEquivalentes } from '@factory/contracts'

// WHATSAPP-AI-01 domain: contacts, conversations, messages, queue, account links and
// confirmations. WhatsApp is another interface over the same TUS backend: nothing here holds
// business authority (works, budgets, payments come from the TUS services through tools).

export class ErrorAsistente extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ErrorAsistente'
  }
}

// Channel of a conversation. WhatsApp and the Web are two interfaces over the SAME assistant
// (orchestrator, tools, knowledge, confirmations and memory); only delivery differs.
export const CANALES_CONVERSACION = ['whatsapp', 'web'] as const
export type CanalConversacion = (typeof CANALES_CONVERSACION)[number]

// Rows created before the Web channel existed have no channel: they are WhatsApp.
export const canalDe = (value: { channel?: CanalConversacion }): CanalConversacion => value.channel ?? 'whatsapp'

// External key of a Web conversation (stored where WhatsApp stores the wa_id). The account id
// comes from the authenticated session; the anonymous id is a random browser id that only gives
// continuity to a public conversation and never any authority.
export const claveContactoWeb = (input: { accountId: string } | { anonymousId: string }): string =>
  'accountId' in input ? `web:acct:${input.accountId}` : `web:anon:${input.anonymousId}`

export interface ContactoWhatsapp {
  contactId: string
  channel?: CanalConversacion
  // WhatsApp: `wa_id` exactly as delivered by Meta, the only external identity (the profile name
  // is informative and never used to link an account). Web: claveContactoWeb().
  waId: string
  displayName: string | null
  linkedAccountId: string | null
  linkedTenantId: string | null
  linkedAt: string | null
  blockedUntil: string | null
  blockedReason: string | null
  createdAt: string
  lastInboundAt: string | null
  version: number
}

export type ModoConversacion = 'bot' | 'human'

export interface EstadoConversacional {
  currentIntent: string | null
  pendingConfirmationId: string | null
  activeWorkId: string | null
  activeListingId: string | null
  // Request draft being collected (never authoritative: the tool revalidates everything).
  draft: {
    profession?: string | null
    candidates?: { providerId: string; name: string }[]
    listingId: string | null
    problem: string | null
    zone: string | null
    urgency: string | null
  } | null
  // Last availability shown (provider, trade, date): lets "a las 10" on the next turn refer to
  // it. Never authoritative: booking re-reads the real availability.
  slots?: { providerId: string; profession: string; date: string; starts: string[] } | null
  // What the person needs, accumulated across messages (trade, day, time, zone or "any zone").
  // Every fact a message carries is kept here, so it is never asked again.
  need?: import('./necesidad.ts').NecesidadTurno | null
  // When the need was last said (ms). An old need is not carried into a new conversation.
  needAt?: number | null
  // Providers and real starts of the last availability search, in the order they were shown
  // ("el segundo", a name or a time on the next message refer to them). Never authoritative:
  // booking re-reads the real availability.
  // esperaHora: "¿a qué hora?" was asked about the one professional in `items` (busqueda.ts).
  offers?: { profession: string; items: { providerId: string; name: string; area?: string; starts: string[] }[]; esperaHora?: boolean } | null
  // The full list of that search as it was shown, kept when `offers` narrows to one professional:
  // "la otra" and "la segunda" keep referring to it. chosenProviderId: the one chosen from it.
  shown?: { profession: string; items: { providerId: string; name: string; area?: string; starts: string[] }[] } | null
  chosenProviderId?: string | null
  // A day that may be two real dates ("el viernes que viene"): the two the person was asked to
  // choose between. The answer is read against them; nothing is chosen for the person.
  dayChoice?: { options: string[]; at: number } | null
  // One concrete thing the assistant proposed and the person may accept with "sí": a free turno
  // (offer), the first free turno of anyone (first_any), or the days after the one with nothing
  // (next_days). Never authoritative: accepting re-reads the real availability.
  suggestion?:
    | { kind: 'offer'; profession: string; providerId: string; name: string; start: string; at: number }
    | { kind: 'first_any' | 'next_days' | 'search'; at: number }
    | null
  // TURNOS-SENA-01: the turno being requested (professional and time already chosen), while the
  // conversation asks for what is still missing before the confirmation: which service (when the
  // professional offers several) and who the client is (WhatsApp: full name + document). Never
  // authoritative: the provider, the service, its price and the time are read again from the
  // backend at every step, and it holds no account and no price.
  booking?: SolicitudEnCurso | null
  // SERVICIO-URGENTE-01: an urgent request being put together (what is still missing is asked).
  // Never authoritative: the backend validates everything again when it creates the request.
  // `awaiting: 'account'`: everything is known but who asks; nothing was sent to any provider.
  urgent?: { profession: string | null; address: string | null; zone: string | null; problem: string | null; at: number; awaiting?: 'account' | null } | null
  // The conversation asked for name + document for something that is not a booking (the payment
  // link of a deposit) and is waiting for them.
  identityFor?: { purpose: 'deposit' | 'payment_check'; at: number } | null
  // CIERRE-TRABAJO-01: the client said a finished turno had a problem and the next message is
  // what happened. Only which turno and since when; the text goes to the backend, never kept here.
  closingReport?: { ref: string; at: number } | null
  // TURNOS-REPROGRAMACION-01: the client is choosing a new time for one of its turnos. Only
  // which turno and the times that were offered (as the backend returned them); nothing is decided here.
  reschedule?: { ref: string; options: string[]; selected?: string; at: number } | null
  // TUS-WHATSAPP-MULTIMODAL-01: bookkeeping of "ya pagué" / receipts. Never authoritative: it only
  // paces the questions to Mercado Pago (the backend asks it again every time) and remembers which
  // deposits were offered to choose from. It holds no amount, no status and no account.
  paymentCheck?: {
    since: number
    count: number
    lastAt: number
    contextAt?: number | null
    choosing?: { refs: string[]; at: number } | null
    // TUS-WHATSAPP-MULTIMODAL-02: receipt analyses of the last hour and the receipts already read
    // (by Meta's hash), so the same picture is never downloaded or read twice. Only amount, currency
    // and date, never a name, an account or an operation number. Not authoritative.
    analisis?: { since: number; count: number } | null
    receipts?: { sha256: string; at: number; amountMinor: string | null; currency: 'ARS' | 'USD' | null; occurredAt: string | null }[] | null
  } | null
  // The last reply was a price (ms): "¿y con Melina?" right after is about the price too.
  priceAt?: number | null
  lowConfidenceCount: number
}

export interface SolicitudEnCurso {
  providerId: string
  providerName: string
  profession: string
  startsAt: string
  // Variant chosen among the ones the backend offered; null = the service has no variants.
  tariffId: string | null
  // 'service': waiting for the variant. 'identity': waiting for name + document (or the sign-in).
  step: 'service' | 'identity'
  at: number
}

export const ESTADO_CONVERSACIONAL_INICIAL: EstadoConversacional = {
  currentIntent: null,
  pendingConfirmationId: null,
  activeWorkId: null,
  activeListingId: null,
  draft: null,
  lowConfidenceCount: 0,
}

export interface ConversacionWhatsapp {
  conversationId: string
  contactId: string
  channel?: CanalConversacion
  status: 'active' | 'closed'
  mode: ModoConversacion
  handoffReason: string | null
  handoffAt: string | null
  operatorId: string | null
  openedAt: string
  lastMessageAt: string
  // Start of the Meta customer service window (last inbound message).
  lastInboundAt: string | null
  unreadCount: number
  // Structured summary of older turns (never authoritative).
  summary: string | null
  summaryMessageCount: number
  state: EstadoConversacional
  version: number
  // Account this conversation identified by full name + document (WhatsApp has no TUS session),
  // and when. A reference kept in its own column (FK to the account), never shown to anybody.
  identifiedAccountId?: string | null
  identifiedAt?: string | null
}

// How long an identification by name + document is honoured.
export const VIGENCIA_IDENTIFICACION_MS = 24 * 60 * 60 * 1000

export type DireccionMensaje = 'inbound' | 'outbound'

export type EstadoMensaje =
  | 'received'
  | 'processed'
  | 'ignored'
  | 'rate_limited'
  | 'pending_send'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown'

export interface MensajeConversacion {
  messageId: string
  conversationId: string
  contactId: string
  wamid: string | null
  direction: DireccionMensaje
  type:
    | 'text'
    | 'image'
    | 'audio'
    | 'document'
    | 'location'
    | 'interactive'
    | 'button'
    | 'unsupported'
    | 'template'
    | 'buttons'
    | 'cta_url'
  text: string | null
  status: EstadoMensaje
  // External (Meta) timestamp of the last applied status: older callbacks never regress it.
  statusAt: string | null
  externalTimestamp: string | null
  replyToWamid: string | null
  actor: string
  // Minimal metadata only (media id/mime, location, reply id, sources/tools used).
  metadata: Record<string, unknown>
  correlationId: string
  createdAt: string
  // Stable position in the history, assigned by the store when the message is created (never
  // written by the code). Absent only on a message that was not stored yet.
  sequence?: number
}

// MEMORIA-01: one version of the incremental summary of a conversation. It represents every
// message up to `throughSequence`; the messages themselves are never replaced by it.
export interface ResumenConversacion {
  summaryId: string
  conversationId: string
  version: number
  fromSequence: number
  throughSequence: number
  messageCount: number
  text: string
  model: string | null
  createdAt: string
}

export interface TrabajoConversacion {
  jobId: string
  conversationId: string
  status: 'queued' | 'leased' | 'done'
  availableAt: string
  leaseOwner: string | null
  leaseUntil: string | null
  attempts: number
  lastError: string | null
  correlationId: string
  createdAt: string
  updatedAt: string
}

export interface TokenVinculacion {
  tokenId: string
  contactId: string
  tokenHash: string
  expiresAt: string
  usedAt: string | null
  usedByAccountId: string | null
  createdAt: string
}

export interface ConfirmacionAsistente {
  confirmationId: string
  conversationId: string
  contactId: string
  accountId: string
  tenantId: string
  tool: string
  arguments: Record<string, unknown>
  argumentsHash: string
  summary: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'executed' | 'failed'
  result: Record<string, unknown> | null
  expiresAt: string
  createdAt: string
  decidedAt: string | null
}

export interface EventoAuditoriaAsistente {
  eventId: string
  action: string
  contactId: string | null
  conversationId: string | null
  actorId: string
  correlationId: string
  // Never phone numbers, tokens, DNI/CUIL or message bodies.
  metadata: Record<string, unknown>
  createdAt: string
}

// ---- outbound / inbound status ordering -----------------------------------------------------

const RANGO_ESTADO: Record<string, number> = {
  pending_send: 0,
  unknown: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
}

// Applies an asynchronous Meta status: a callback never moves a message backwards (delivered
// cannot return to sent) and an older callback never overrides a newer one. `failed` wins only
// if it is not older than the last applied status.
export function aplicarEstadoEntrega(
  current: { status: EstadoMensaje; statusAt: string | null },
  incoming: { status: 'sent' | 'delivered' | 'read' | 'failed'; at: string }
): { status: EstadoMensaje; statusAt: string } | null {
  const currentRank = RANGO_ESTADO[current.status] ?? 0
  const incomingRank = RANGO_ESTADO[incoming.status]!
  if (current.statusAt && Date.parse(incoming.at) < Date.parse(current.statusAt)) return null
  if (incoming.status !== 'failed' && incomingRank <= currentRank) return null
  if (current.status === 'failed') return null
  return { status: incoming.status, statusAt: incoming.at }
}

export function ventanaServicioAbierta(lastInboundAt: string | null, now: number): boolean {
  return Boolean(lastInboundAt) && now - Date.parse(lastInboundAt!) < 24 * 60 * 60 * 1000
}

// ---- privacy -------------------------------------------------------------------------------

// Removes identifiers that must never reach the LLM or the logs.
export function redactarPii(text: string): string {
  return text
    .replace(/\b(?:20|23|24|27|30|33|34)[-\s.]?\d{8}[-\s.]?\d\b/gu, '[cuil]')
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}\b/gu, '[documento]')
    .replace(/\b(?:APP_USR|TEST|TG|EAA)[-A-Za-z0-9_]{12,}\b/gu, '[token]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu, '[email]')
    .replace(/(?<![+\d])\b(?:\d[ -]?){12,18}\d\b/gu, '[tarjeta]')
    .replace(/(?:\+?54\s?9?\s?)?(?:\(?\d{2,4}\)?[\s-]?)\d{3,4}[\s-]?\d{4}\b/gu, '[telefono]')
    // Característica + número de 6 a 8 dígitos ("3794 123456", "(379) 4123456") y 10 dígitos
    // seguidos ("3794123456"). El separador es obligatorio en el primero para no tocar montos.
    .replace(/(?:\+?54\s?9?\s?)?\(?\b\d{2,4}\)?[\s-]\d{6,8}\b/gu, '[telefono]')
    .replace(/(?<![\d[])\b\d{10}\b/gu, '[telefono]')
}

// What must never become memory (a summary, a fragment, an embedding, a fact): passwords,
// verification codes, tokens, cookies, card data and links that authenticate. Applied on top of
// redactarPii before anything derived from a message is stored. It errs on the side of removing.
export function sinSecretos(text: string): string {
  return text
    // Links that carry a credential (reset, verification, sign-in, tokens in the query).
    .replace(/https?:\/\/\S*(?:token|codigo|code|reset|restablecer|recover|verif|magic|auth|session|sig|signature|key|password|otp)\S*/giu, '[enlace]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gu, '[credencial]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/gu, '[token]')
    .replace(/\b(?:sk|pk|gsk|rk|whsec)_[A-Za-z0-9_-]{12,}\b/gu, '[token]')
    // "VERIFICAR TUS ABCD1234", "mi código es 123456", "contraseña: hunter2", "clave 1234".
    .replace(/\bVERIFICAR TUS\s+[A-Z0-9]{4,12}\b/giu, '[codigo]')
    .replace(/\b(c[oó]digo|pin|otp|clave|contrase[nñ]a|password|pass|cvv|cvc|token|cookie|secreto)\b(\s*(?:de\s+\w+\s+)?(?:es|era|son|:|=)?\s*)\S{3,}/giu, '$1 [oculto]')
    .replace(/\b\d{6}\b(?=\s*(?:es|como)?\s*(?:mi|el|tu)?\s*c[oó]digo)/giu, '[codigo]')
}

// The text of a message as memory may keep it: no personal identifiers, no secrets.
export const limpiarParaMemoria = (text: string): string => sinSecretos(redactarPii(text))

export function enmascararWaId(waId: string): string {
  return waId.length <= 4 ? '****' : `****${waId.slice(-4)}`
}

// ---- intents that never go through the model ----------------------------------------------

const PATRON_HANDOFF =
  /\b(hablar con (una |un )?(persona|humano|alguien|operador|asesor)|operador|soporte|soporte humano|atenci[oó]n humana|quiero un humano|agente humano)\b/iu
const PATRON_RECLAMO =
  /\b(reclamo|denuncia|estafa|fraude|me robaron|disputa|abogado|defensa del consumidor|contracargo)\b/iu
const PATRON_VINCULAR =
  /\b(vincular|vincul[aá] mi cuenta|conectar mi cuenta|asociar mi cuenta|ya tengo cuenta|ya (lo )?verifiqu[eé]|por qu[eé] tengo que vincular)(?![\p{L}\p{N}])/iu
const PATRON_DESVINCULAR =
  /\b(desvincular|desvincul[aá]|borrar mi n[uú]mero|olvidar mi n[uú]mero)\b/iu
const PATRON_SI =
  /^\s*(s[ií]|si,? confirmo|confirmo|dale|ok|okay|de acuerdo|acepto|s[ií] por favor)\s*[.!]*\s*$/iu
const PATRON_NO = /^\s*(no|cancelar|cancel[aá]|no gracias|mejor no)\s*[.!]*\s*$/iu

export function pideHumano(text: string): boolean {
  return PATRON_HANDOFF.test(text)
}

export function esReclamoSensible(text: string): boolean {
  return PATRON_RECLAMO.test(text)
}

export function pideVincular(text: string): boolean {
  return PATRON_VINCULAR.test(text) && !PATRON_DESVINCULAR.test(text)
}

export function pideDesvincular(text: string): boolean {
  return PATRON_DESVINCULAR.test(text)
}

// "ya estoy registrado y logueado", "¿podés ver mi número?", "¿está vinculado mi WhatsApp?": the
// person says or asks something about the account behind this number. What is SAID changes
// nothing: the answer is the state the backend reads for the sender's own number.
const PATRON_CUENTA = new RegExp(
  [
    String.raw`\b(?:estoy|toy|estaba|figuro) (?:ya )?(?:registrad[oa]|loguead[oa]|logead[oa]|vinculad[oa]|verificad[oa]|conectad[oa])\b`,
    String.raw`\bya (?:me )?(?:registre|logue|loguee|inicie sesion|vincule|conecte)\b`,
    String.raw`\b(?:podes|puedes|podrias|pueden) ver(?:me)? (?:mi|el|este) (?:numero|cuenta|celular|telefono|perfil|whatsapp)\b`,
    String.raw`\b(?:ves|tenes|reconoces|te figura|figura|aparece) (?:mi|este) (?:numero|cuenta|celular|telefono)\b`,
    String.raw`\b(?:mi|este) (?:numero|cuenta|whatsapp|celular|telefono) (?:ya )?(?:esta|figura|aparece) (?:vinculad|verificad|registrad|conectad)[oa]\b`,
    String.raw`\besta (?:vinculad|verificad|registrad)[oa] (?:mi|este) (?:numero|whatsapp|celular|cuenta)\b`,
    String.raw`\b(?:ya )?tengo (?:la )?sesion (?:iniciada|abierta)\b`,
  ].join('|'),
  'u'
)
const PATRON_SESION_WEB = /\b(?:loguead[oa]|logead[oa]|sesion|conectad[oa])\b/u
const plano = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function preguntaPorCuenta(text: string): boolean {
  return PATRON_CUENTA.test(plano(text))
}

// The person claims a Web session: something WhatsApp can never see.
export function mencionaSesionWeb(text: string): boolean {
  return PATRON_SESION_WEB.test(plano(text))
}

// Explicit yes/no only; a loose "yes" is honored only when a pending confirmation exists and it
// belongs to this conversation, actor and action (checked by the orchestrator).
export function respuestaConfirmacion(
  text: string | null,
  replyId: string | null
): { decision: 'yes' | 'no'; confirmationId: string | null } | null {
  if (replyId) {
    const match = /^(confirm|cancel):([A-Za-z0-9_-]{8,80})$/u.exec(replyId)
    if (match) return { decision: match[1] === 'confirm' ? 'yes' : 'no', confirmationId: match[2]! }
  }
  if (!text) return null
  if (PATRON_SI.test(text)) return { decision: 'yes', confirmationId: null }
  if (PATRON_NO.test(text)) return { decision: 'no', confirmationId: null }
  return null
}

export const MENSAJES = {
  handoff:
    'Este número tiene un asistente automático; no hay un operador humano conectado.',
  handoffActive: null,
  rateLimited: 'Estás enviando muchos mensajes seguidos. Esperá un momento y volvé a escribirme.',
  unsupported: 'Por ahora solo puedo leer mensajes de texto. ¿Me lo escribís?',
  audioUnsupported: 'Por ahora no puedo escuchar audios. ¿Me contás por escrito qué necesitás?',
  audioNotUnderstood: 'No pude entender bien ese audio. ¿Podés mandármelo otra vez o escribirme el mensaje?',
  imageReceived:
    'Recibí la foto. Por ahora la guardo para el equipo; contame con palabras qué pasa así te ayudo.',
  locationReceived:
    'Gracias, tomé la zona aproximada. No la comparto con prestadores hasta que corresponda.',
  linkSteps:
    'Para continuar por WhatsApp necesitás vincular este número con una cuenta TUS.\n\n1. Registrate o iniciá sesión en TUS.\n2. Entrá a Mi perfil.\n3. Verificá tu número de celular.\n4. Tocá "Vincular este WhatsApp".\n\nDespués volvés acá y podés seguir normalmente.',
  linkVerifiedPending:
    'Tu número ya está verificado. Solo falta vincular este WhatsApp. Entrá a Mi perfil y tocá "Vincular este WhatsApp".',
  alreadyLinked: 'Este WhatsApp ya está vinculado a tu cuenta TUS.',
  // Answers to "¿ves mi cuenta / mi número?", one per REAL state of the sender's number.
  accountLinked: 'Sí, este WhatsApp ya está vinculado a tu cuenta TUS.',
  accountVerifiedUnlinked: 'Sí, este número coincide con una cuenta TUS que ya tiene el celular verificado. Solo falta vincular este WhatsApp con tu cuenta.',
  accountChallengePending: 'Hay una verificación en curso para este número. Para terminarla, enviá desde este WhatsApp el mensaje "VERIFICAR TUS" con el código que te muestra Mi perfil.',
  accountUnknown: 'No encuentro este número como verificado en una cuenta TUS. Entrá a Mi perfil para verificarlo.',
  accountConflict: 'No puedo vincular este WhatsApp desde acá: el número figura asociado a otra vinculación. Revisalo desde Mi perfil.',
  webSessionUnknown: 'No puedo ver si iniciaste sesión en la Web: WhatsApp es un canal aparte. Lo que sí puedo comprobar es este número.',
  linkRequired:
    'Para ver o hacer cosas de tu cuenta primero tengo que vincular este WhatsApp con tu cuenta TUS.',
  aiUnavailable:
    'Tuve un problema procesando tu solicitud. Probá nuevamente en unos minutos.',
  noInfo: 'No tengo información suficiente para asegurarte eso.',
  confirmationExpired: 'Esa confirmación ya venció. Si querés, lo preparo de nuevo.',
  confirmationCancelled: 'Listo, no hice ningún cambio.',
  identityNeeded: 'Para registrar la solicitud necesito tu nombre completo y DNI.',
  // The same answer for an unknown document and for one of another person (no enumeration), with
  // what to check and what to do next.
  identityNotFound: 'No pude validar esos datos con una cuenta TUS. Revisá que sean el mismo nombre y DNI con los que te registraste.',
  identityFound: 'Encontré tu cuenta.',
  identityBlocked: 'Por seguridad no puedo seguir verificando datos por acá. Iniciá sesión en la Web de TUS para solicitar el turno.',
  unlinked: 'Listo, desvinculé este WhatsApp de tu cuenta TUS.',
} as const

// The contact of a WhatsApp sender. The wa_id is matched as Meta delivered it first; an Argentine
// mobile also matches its other form (with / without the 9), so one person never becomes two
// contacts with the link on only one of them.
export async function buscarContactoPorWaId(
  contactos: { buscarPorWaId(waId: string): Promise<ContactoWhatsapp | null> },
  waId: string
): Promise<ContactoWhatsapp | null> {
  for (const candidato of waIdEquivalentes(waId)) {
    const contacto = await contactos.buscarPorWaId(candidato)
    if (contacto) return contacto
  }
  return null
}
