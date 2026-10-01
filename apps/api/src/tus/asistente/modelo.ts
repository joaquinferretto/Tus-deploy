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
  offers?: { profession: string; items: { providerId: string; name: string; starts: string[] }[] } | null
  lowConfidenceCount: number
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
}

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

export function enmascararWaId(waId: string): string {
  return waId.length <= 4 ? '****' : `****${waId.slice(-4)}`
}

// ---- intents that never go through the model ----------------------------------------------

const PATRON_HANDOFF =
  /\b(hablar con (una |un )?(persona|humano|alguien|operador|asesor)|operador|soporte|soporte humano|atenci[oó]n humana|quiero un humano|agente humano)\b/iu
const PATRON_RECLAMO =
  /\b(reclamo|denuncia|estafa|fraude|me robaron|disputa|abogado|defensa del consumidor|contracargo)\b/iu
const PATRON_VINCULAR = /\b(vincular|vincul[aá] mi cuenta|conectar mi cuenta|asociar mi cuenta)\b/iu
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
  imageReceived:
    'Recibí la foto. Por ahora la guardo para el equipo; contame con palabras qué pasa así te ayudo.',
  locationReceived:
    'Gracias, tomé la zona aproximada. No la comparto con prestadores hasta que corresponda.',
  linkRequired:
    'Para ver o hacer cosas de tu cuenta primero tengo que vincular este WhatsApp con tu cuenta TUS.',
  aiUnavailable:
    'Tuve un problema procesando tu solicitud. Probá nuevamente en unos minutos.',
  noInfo: 'No tengo información suficiente para asegurarte eso.',
  confirmationExpired: 'Esa confirmación ya venció. Si querés, lo preparo de nuevo.',
  confirmationCancelled: 'Listo, no hice ningún cambio.',
  unlinked: 'Listo, desvinculé este WhatsApp de tu cuenta TUS.',
} as const
