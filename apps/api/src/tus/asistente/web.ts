import { randomUUID } from 'node:crypto'
import {
  ASISTENTE_WEB_LIMITES,
  ASISTENTE_WEB_VISITANTE,
  type AccionAsistenteDTO,
  type ActividadAsistenteDTO,
  type AdjuntoAsistente,
  type HistorialAsistente,
  type MensajeAsistenteDTO,
  type RespuestaMensajeAsistente,
} from '@factory/contracts'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import type { ServicioAyudaPublica } from './ayuda.ts'
import type { MensajeSaliente } from './meta.ts'
import {
  ESTADO_CONVERSACIONAL_INICIAL,
  ErrorAsistente,
  MENSAJES,
  canalDe,
  claveContactoWeb,
  type ContactoWhatsapp,
  type ConversacionWhatsapp,
  type MensajeConversacion,
} from './modelo.ts'
import type { CanalTurno, Metrica, OrquestadorConversacion } from './orquestador.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from './puertos.ts'

// ASISTENTE-WEB-01. The Web channel of the TUS assistant. It owns NOTHING of the assistant's
// brain: the turn is decided by the same OrquestadorConversacion as WhatsApp (same model, same
// tools, same knowledge base, same confirmations, same conversation memory and tables). This
// service only does what is specific to the channel: who is talking (the session of THIS request,
// or an anonymous visitor), storing the inbound message, handing the turn to the orchestrator and
// returning the reply instead of sending it through Meta.

// Who is talking. `context` is the authenticated session resolved by the HTTP layer on this very
// request (null = visitor: public tools only). `visitorId` is a random browser id: it gives
// continuity to an anonymous conversation and is never an authority.
export interface IdentidadAsistenteWeb {
  context: TusAuthenticatedTenantContext | null
  visitorId: string | null
}

export interface LimitesAsistenteWeb {
  maxInboundPerMinute: number
  historyMessages: number
}

export const LIMITES_ASISTENTE_WEB_POR_DEFECTO: LimitesAsistenteWeb = { maxInboundPerMinute: 12, historyMessages: 60 }

const ETIQUETA_RESPUESTA = { confirm: 'Confirmar', cancel: 'Cancelar' } as const
const ID_RESPUESTA = /^(confirm|cancel):[A-Za-z0-9_-]{8,80}$/u

// Fixed texts of the channel. Only for states the model cannot own: no account for a write that
// was about to be confirmed, and the model being unavailable.
export const TEXTOS_ASISTENTE_WEB = {
  necesitaCuenta: 'Para continuar con eso necesitás iniciar sesión en TUS.',
  degradadoConAyuda: 'Ahora no puedo conversar, pero esto es lo que dice la ayuda de TUS sobre tu consulta:',
} as const

export interface EntradaMensajeWeb {
  identidad: IdentidadAsistenteWeb
  text?: unknown
  replyId?: unknown
  correlationId: string
  // Live progress for a streaming response. All optional: the same data is in the result.
  onAccepted?: (data: { conversationId: string; userMessage: MensajeAsistenteDTO }) => void
  onActivity?: (activity: ActividadAsistenteDTO) => void
  onMessage?: (message: MensajeAsistenteDTO) => void
}

export class ServicioAsistenteWeb {
  private readonly limits: LimitesAsistenteWeb
  private readonly now: () => number

  constructor(
    private readonly deps: {
      transaction: PuertoTransaccionAsistente
      orquestador: Pick<OrquestadorConversacion, 'responder'>
      ayuda: ServicioAyudaPublica | null
      limits?: Partial<LimitesAsistenteWeb>
      now?: () => number
      metric?: Metrica
    }
  ) {
    this.limits = { ...LIMITES_ASISTENTE_WEB_POR_DEFECTO, ...deps.limits }
    this.now = deps.now ?? Date.now
  }

  // The conversation key is derived here, never taken from the client: the account id comes from
  // the session; without a session the browser's random id is the only (public) continuity.
  private clave(identidad: IdentidadAsistenteWeb): string {
    if (identidad.context) return claveContactoWeb({ accountId: identidad.context.subjectId })
    if (!identidad.visitorId || !ASISTENTE_WEB_VISITANTE.test(identidad.visitorId))
      throw new ErrorAsistente(400, 'VISITOR_REQUIRED', 'visitorId is required without a session')
    return claveContactoWeb({ anonymousId: identidad.visitorId })
  }

  async historial(identidad: IdentidadAsistenteWeb): Promise<HistorialAsistente> {
    const key = this.clave(identidad)
    const authenticated = Boolean(identidad.context)
    return this.deps.transaction.ejecutar(async (repositories) => {
      let contact = await repositories.contactos.buscarPorWaId(key)
      // Just signed in: the visitor's conversation of this browser is shown (it becomes the
      // account's on the next message).
      if (!contact && identidad.context && identidad.visitorId && ASISTENTE_WEB_VISITANTE.test(identidad.visitorId))
        contact = await repositories.contactos.buscarPorWaId(claveContactoWeb({ anonymousId: identidad.visitorId }))
      const conversation = contact && canalDe(contact) === 'web' ? await repositories.conversaciones.activaDeContacto(contact.contactId) : null
      if (!conversation) return { conversationId: null, authenticated, messages: [] }
      const messages = await repositories.mensajes.ultimos(conversation.conversationId, this.limits.historyMessages)
      return { conversationId: conversation.conversationId, authenticated, messages: messages.filter((message) => message.text).map(aDTO) }
    })
  }

  // Closes the active conversation: the next message starts a new one (memory included).
  async reiniciar(identidad: IdentidadAsistenteWeb): Promise<void> {
    const key = this.clave(identidad)
    await this.deps.transaction.ejecutar(async (repositories) => {
      const contact = await repositories.contactos.buscarPorWaId(key)
      const conversation = contact && canalDe(contact) === 'web' ? await repositories.conversaciones.activaDeContacto(contact.contactId) : null
      if (conversation)
        await repositories.conversaciones.actualizar({ ...conversation, status: 'closed', version: conversation.version + 1 }, conversation.version)
    })
  }

  async enviar(input: EntradaMensajeWeb): Promise<RespuestaMensajeAsistente> {
    const entrada = validarEntrada(input.text, input.replyId)
    const key = this.clave(input.identidad)
    const authenticated = Boolean(input.identidad.context)

    let accepted: { conversation: ConversacionWhatsapp; contact: ContactoWhatsapp; inbound: MensajeConversacion }
    try {
      accepted = await this.deps.transaction.ejecutar((repositories) => this.registrarEntrante(repositories, key, input.identidad, entrada, input.correlationId))
    } catch (error) {
      // Two first messages of the same person raced to create the contact: the loser retries once.
      if ((error as { code?: string })?.code !== 'P2002') throw error
      accepted = await this.deps.transaction.ejecutar((repositories) => this.registrarEntrante(repositories, key, input.identidad, entrada, input.correlationId))
    }
    const conversationId = accepted.conversation.conversationId
    const userMessage = aDTO(accepted.inbound)
    input.onAccepted?.({ conversationId, userMessage })

    const activity: ActividadAsistenteDTO[] = []
    const canal: CanalTurno = {
      id: 'web',
      conversacional: true,
      // On the Web the model always reads the message and decides (patterns are only its fallback).
      enrutado: 'modelo',
      // Sign in or register, and come back to what was being done (an internal path of the Web).
      pedirCuenta: async (_motivo, opciones) => [{ type: 'text', text: TEXTOS_ASISTENTE_WEB.necesitaCuenta, attachment: { kind: 'sign_in', ...(opciones?.returnTo ? { returnTo: opciones.returnTo } : {}) } }],
      evento: (evento) => {
        activity.push(evento)
        input.onActivity?.(evento)
      },
    }

    let reply: MensajeSaliente[]
    let degraded = false
    let intent: string | null = null
    try {
      const result = await this.deps.orquestador.responder({ conversationId, correlationId: input.correlationId, context: input.identidad.context, canal })
      // Another request of the same conversation took this message into its own turn.
      if (!result) throw new ErrorAsistente(409, 'TURN_IN_PROGRESS', 'another message of this conversation is being answered')
      reply = result.messages
      degraded = result.degraded
      intent = result.intent
    } catch (error) {
      if (error instanceof ErrorAsistente) throw error
      // A failed turn never leaves the message pending (it would be merged into the next one).
      await this.deps.transaction.ejecutar(async (repositories) => {
        const current = await repositories.mensajes.buscar(accepted.inbound.messageId)
        if (current && current.status === 'received') await repositories.mensajes.actualizar({ ...current, status: 'processed' })
      })
      this.deps.metric?.('assistant.web_turn_error', { code: String((error as { code?: unknown })?.code ?? 'UNKNOWN') })
      reply = [{ type: 'text', text: MENSAJES.aiUnavailable }]
      degraded = true
    }
    // Safe fallback while the model is unavailable: the extractive public help (no LLM, cannot
    // invent). It is NOT the assistant's way of answering, only what is left when the model fails.
    // Only for a question about TUS: a search or an account matter is never answered with a
    // help article (the fixed, honest text stays).
    if (degraded && (intent === 'conocimiento' || intent === 'otro')) reply = await this.respaldo(entrada.text, reply)

    const messages: MensajeAsistenteDTO[] = []
    for (const message of reply) {
      const stored = await this.registrarSaliente(accepted, message, degraded, input.correlationId)
      if (!stored) continue
      const dto = aDTO(stored)
      messages.push(dto)
      input.onMessage?.(dto)
    }
    this.deps.metric?.('assistant.web_turn', { authenticated, degraded, messages: messages.length, tools: activity.filter((item) => item.type === 'tool' && item.phase === 'end').length })
    return { conversationId, authenticated, userMessage, messages, activity, degraded }
  }

  private async respaldo(text: string, reply: MensajeSaliente[]): Promise<MensajeSaliente[]> {
    if (!this.deps.ayuda) return reply
    const help = await this.deps.ayuda.responder(text).catch(() => null)
    if (!help || help.status !== 'answered') return reply
    return [
      {
        type: 'text',
        text: [TEXTOS_ASISTENTE_WEB.degradadoConAyuda, ...help.answers.map((answer) => `${answer.documentTitle} — ${answer.section}\n${answer.excerpt}`)].join('\n\n').slice(0, 4000),
        attachment: { kind: 'sources', sources: help.answers.map((answer) => ({ documentId: answer.documentId, title: answer.documentTitle })) },
      },
    ]
  }

  private async registrarEntrante(
    repositories: RepositoriosAsistente,
    key: string,
    identidad: IdentidadAsistenteWeb,
    entrada: { text: string; replyId: string | null },
    correlationId: string
  ) {
    const nowMs = this.now()
    const nowIso = new Date(nowMs).toISOString()
    let contact = await repositories.contactos.buscarPorWaId(key)
    // Signing in keeps the public conversation the visitor already had on this browser: its
    // contact becomes the account's (only when the account has none yet).
    if (!contact && identidad.context && identidad.visitorId && ASISTENTE_WEB_VISITANTE.test(identidad.visitorId)) {
      const anonymous = await repositories.contactos.buscarPorWaId(claveContactoWeb({ anonymousId: identidad.visitorId }))
      if (anonymous && canalDe(anonymous) === 'web') {
        const adopted = { ...anonymous, waId: key, version: anonymous.version + 1 }
        if (await repositories.contactos.actualizar(adopted, anonymous.version)) contact = adopted
      }
    }
    if (!contact) {
      contact = {
        contactId: `contacto-web-${randomUUID()}`,
        channel: 'web',
        waId: key,
        displayName: null,
        // Never linked: the authority of a Web turn is the session of its own request.
        linkedAccountId: null,
        linkedTenantId: null,
        linkedAt: null,
        blockedUntil: null,
        blockedReason: null,
        createdAt: nowIso,
        lastInboundAt: null,
        version: 1,
      }
      await repositories.contactos.crear(contact)
    }
    if (canalDe(contact) !== 'web') throw new ErrorAsistente(409, 'CONFLICT', 'contact does not belong to the Web channel')
    const recent = await repositories.mensajes.contarEntrantesDesde(contact.contactId, new Date(nowMs - 60_000).toISOString())
    if ((contact.blockedUntil && Date.parse(contact.blockedUntil) > nowMs) || recent >= this.limits.maxInboundPerMinute)
      throw new ErrorAsistente(429, 'RATE_LIMITED', 'too many messages; wait a moment')
    let conversation = await repositories.conversaciones.activaDeContacto(contact.contactId)
    if (!conversation) {
      conversation = {
        conversationId: `conversacion-web-${randomUUID()}`,
        contactId: contact.contactId,
        channel: 'web',
        status: 'active',
        mode: 'bot',
        handoffReason: null,
        handoffAt: null,
        operatorId: null,
        openedAt: nowIso,
        lastMessageAt: nowIso,
        lastInboundAt: null,
        unreadCount: 0,
        summary: null,
        summaryMessageCount: 0,
        state: { ...ESTADO_CONVERSACIONAL_INICIAL },
        version: 1,
      }
      await repositories.conversaciones.crear(conversation)
    }
    const inbound: MensajeConversacion = {
      messageId: `mensaje-web-${randomUUID()}`,
      conversationId: conversation.conversationId,
      contactId: contact.contactId,
      wamid: null,
      direction: 'inbound',
      type: entrada.replyId ? 'interactive' : 'text',
      text: entrada.text,
      status: 'received',
      statusAt: null,
      externalTimestamp: nowIso,
      replyToWamid: null,
      actor: 'contact',
      metadata: entrada.replyId ? { replyId: entrada.replyId } : {},
      correlationId,
      createdAt: nowIso,
    }
    await repositories.mensajes.crear(inbound)
    const updatedContact = { ...contact, lastInboundAt: nowIso, version: contact.version + 1 }
    await repositories.contactos.actualizar(updatedContact, contact.version)
    const updatedConversation = { ...conversation, lastMessageAt: nowIso, lastInboundAt: nowIso, version: conversation.version + 1 }
    await repositories.conversaciones.actualizar(updatedConversation, conversation.version)
    return { conversation: updatedConversation, contact: updatedContact, inbound }
  }

  // The reply is stored in the same message table as WhatsApp (it is the conversation memory the
  // orchestrator reads on the next turn), already `sent`: the HTTP response is the delivery.
  private async registrarSaliente(
    accepted: { conversation: ConversacionWhatsapp; contact: ContactoWhatsapp; inbound: MensajeConversacion },
    message: MensajeSaliente,
    fallback: boolean,
    correlationId: string
  ): Promise<MensajeConversacion | null> {
    if (message.type === 'template') return null
    const nowIso = new Date(this.now()).toISOString()
    const actions: AccionAsistenteDTO[] =
      message.type === 'buttons'
        ? message.buttons.map((button) => ({ kind: 'reply' as const, id: button.id, label: button.title }))
        : message.type === 'cta_url'
          ? [{ kind: 'link' as const, url: message.url, label: message.label }]
          : []
    const attachment: AdjuntoAsistente | undefined = message.type === 'text' ? message.attachment : undefined
    const record: MensajeConversacion = {
      messageId: `mensaje-web-${randomUUID()}`,
      conversationId: accepted.conversation.conversationId,
      contactId: accepted.contact.contactId,
      wamid: null,
      direction: 'outbound',
      type: message.type,
      text: message.text.slice(0, 4096),
      status: 'sent',
      statusAt: nowIso,
      externalTimestamp: null,
      replyToWamid: null,
      actor: 'assistant',
      metadata: {
        inReplyTo: [accepted.inbound.messageId],
        ...(attachment ? { attachment } : {}),
        ...(actions.length > 0 ? { actions } : {}),
        ...(fallback ? { fallback: true } : {}),
      },
      correlationId,
      createdAt: nowIso,
    }
    await this.deps.transaction.ejecutar(async (repositories) => {
      await repositories.mensajes.crear(record)
      const conversation = await repositories.conversaciones.buscar(record.conversationId)
      if (conversation) await repositories.conversaciones.actualizar({ ...conversation, lastMessageAt: nowIso, version: conversation.version + 1 }, conversation.version)
    })
    return record
  }
}

function validarEntrada(text: unknown, replyId: unknown): { text: string; replyId: string | null } {
  if (replyId !== undefined && replyId !== null) {
    const match = typeof replyId === 'string' ? ID_RESPUESTA.exec(replyId) : null
    if (!match) throw new ErrorAsistente(422, 'INVALID_REQUEST', 'replyId is not a valid action')
    return { text: ETIQUETA_RESPUESTA[match[1] as 'confirm' | 'cancel'], replyId: replyId as string }
  }
  const clean = typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '').trim() : ''
  if (clean.length < ASISTENTE_WEB_LIMITES.textoMin || clean.length > ASISTENTE_WEB_LIMITES.textoMax)
    throw new ErrorAsistente(422, 'INVALID_REQUEST', `text must have ${ASISTENTE_WEB_LIMITES.textoMin}..${ASISTENTE_WEB_LIMITES.textoMax} characters`)
  return { text: clean, replyId: null }
}

function aDTO(message: MensajeConversacion): MensajeAsistenteDTO {
  const attachment = message.metadata['attachment'] as AdjuntoAsistente | undefined
  const actions = message.metadata['actions'] as AccionAsistenteDTO[] | undefined
  return {
    id: message.messageId,
    role: message.direction === 'inbound' ? 'user' : 'assistant',
    text: message.text ?? '',
    createdAt: message.createdAt,
    ...(attachment ? { attachment } : {}),
    ...(actions && actions.length > 0 ? { actions } : {}),
    ...(message.metadata['fallback'] === true ? { fallback: true } : {}),
  }
}
