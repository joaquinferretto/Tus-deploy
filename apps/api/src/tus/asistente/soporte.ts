import { randomUUID } from 'node:crypto'
import type { WhatsappProvider } from './meta.ts'
import {
  ErrorAsistente,
  enmascararWaId,
  ventanaServicioAbierta,
  type ConversacionWhatsapp,
} from './modelo.ts'
import { enviarMensajeSaliente } from './orquestador.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from './puertos.ts'
import type { ServicioVinculacionWhatsapp } from './vinculacion.ts'

export interface ContextoOperador {
  actorId: string
  correlationId: string
}

// Human support panel (platform admins only; the HTTP layer checks the authority). Operators
// answer from TUS's official number through the backend; their identity is audited.
export class ServicioSoporteWhatsapp {
  constructor(
    private readonly transaction: PuertoTransaccionAsistente,
    private readonly whatsapp: WhatsappProvider,
    private readonly linking: ServicioVinculacionWhatsapp,
    private readonly now: () => number = Date.now
  ) {}

  async listar(filter: { mode?: unknown; limit?: unknown }) {
    const mode = filter.mode === 'bot' || filter.mode === 'human' ? filter.mode : undefined
    return this.transaction.ejecutar(async (repositories) => {
      const conversations = await repositories.conversaciones.listar({
        ...(mode ? { mode } : {}),
        limit: Math.min(Math.max(Number(filter.limit) || 50, 1), 200),
      })
      const out = []
      for (const conversation of conversations) {
        const contact = await repositories.contactos.buscar(conversation.contactId)
        const last = (await repositories.mensajes.ultimos(conversation.conversationId, 1))[0]
        out.push({
          conversationId: conversation.conversationId,
          contact: {
            contactId: conversation.contactId,
            waIdMasked: contact ? enmascararWaId(contact.waId) : null,
            displayName: contact?.displayName ?? null,
            linked: Boolean(contact?.linkedAccountId),
            linkedTenantId: contact?.linkedTenantId ?? null,
            blocked: Boolean(
              contact?.blockedUntil && Date.parse(contact.blockedUntil) > this.now()
            ),
          },
          mode: conversation.mode,
          status: conversation.status,
          handoffReason: conversation.handoffReason,
          unread: conversation.unreadCount,
          lastMessage: last
            ? {
                direction: last.direction,
                preview: (last.text ?? `[${last.type}]`).slice(0, 80),
                status: last.status,
              }
            : null,
          lastActivity: conversation.lastMessageAt,
          serviceWindowOpen: ventanaServicioAbierta(conversation.lastInboundAt, this.now()),
        })
      }
      return out
    })
  }

  async detalle(conversationId: string, context: ContextoOperador) {
    return this.transaction.ejecutar(async (repositories) => {
      const conversation = await this.requerir(repositories, conversationId)
      const contact = await repositories.contactos.buscar(conversation.contactId)
      const messages = await repositories.mensajes.ultimos(conversationId, 100)
      if (conversation.unreadCount > 0)
        await repositories.conversaciones.actualizar(
          { ...conversation, unreadCount: 0, version: conversation.version + 1 },
          conversation.version
        )
      await this.auditar(repositories, 'support.conversation_viewed', conversation, context, {})
      return {
        conversationId,
        mode: conversation.mode,
        status: conversation.status,
        handoffReason: conversation.handoffReason,
        operatorId: conversation.operatorId,
        serviceWindowOpen: ventanaServicioAbierta(conversation.lastInboundAt, this.now()),
        summary: conversation.summary,
        contact: {
          contactId: conversation.contactId,
          waIdMasked: contact ? enmascararWaId(contact.waId) : null,
          displayName: contact?.displayName ?? null,
          linked: Boolean(contact?.linkedAccountId),
          linkedTenantId: contact?.linkedTenantId ?? null,
          blocked: Boolean(contact?.blockedUntil && Date.parse(contact.blockedUntil) > this.now()),
        },
        messages: messages.map((message) => ({
          messageId: message.messageId,
          direction: message.direction,
          actor: message.actor,
          type: message.type,
          text: message.text,
          status: message.status,
          createdAt: message.createdAt,
          // Location coordinates are shown rounded (approximate area only).
          ...(message.metadata['location']
            ? { location: redondearUbicacion(message.metadata['location']) }
            : {}),
          ...(message.metadata['media'] ? { hasMedia: true } : {}),
        })),
      }
    })
  }

  async tomar(conversationId: string, context: ContextoOperador) {
    return this.cambiarModo(conversationId, context, 'human', 'operator_takeover')
  }

  async devolver(conversationId: string, context: ContextoOperador) {
    return this.cambiarModo(conversationId, context, 'bot', null)
  }

  async responder(conversationId: string, context: ContextoOperador, text: unknown) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000)
      throw new ErrorAsistente(400, 'INVALID', 'text must have 1..4000 characters')
    const { conversation, contact } = await this.transaction.ejecutar(async (repositories) => {
      const conversation = await this.requerir(repositories, conversationId)
      if (conversation.mode !== 'human')
        throw new ErrorAsistente(
          409,
          'TAKE_OVER_FIRST',
          'take over the conversation before answering'
        )
      // Free text is only allowed inside Meta's 24h customer service window.
      if (!ventanaServicioAbierta(conversation.lastInboundAt, this.now()))
        throw new ErrorAsistente(
          409,
          'SERVICE_WINDOW_CLOSED',
          'the 24h window is closed; an approved template is required'
        )
      const contact = await repositories.contactos.buscar(conversation.contactId)
      if (!contact) throw new ErrorAsistente(404, 'NOT_FOUND', 'contact was not found')
      return { conversation, contact }
    })
    const sent = await enviarMensajeSaliente({
      transaction: this.transaction,
      whatsapp: this.whatsapp,
      conversationId: conversation.conversationId,
      contact,
      message: { type: 'text', text: text.trim() },
      actor: `operator:${context.actorId}`,
      correlationId: context.correlationId,
      inReplyTo: [],
      replyToWamid: undefined,
      now: this.now,
    })
    await this.transaction.ejecutar((repositories) =>
      this.auditar(repositories, 'support.operator_reply', conversation, context, {
        status: sent.status,
      })
    )
    return { messageId: sent.messageId, status: sent.status }
  }

  async desvincular(conversationId: string, context: ContextoOperador) {
    const conversation = await this.transaction.ejecutar((repositories) =>
      this.requerir(repositories, conversationId)
    )
    return this.linking.desvincular({
      contactId: conversation.contactId,
      actorId: `operator:${context.actorId}`,
      correlationId: context.correlationId,
    })
  }

  async bloquear(conversationId: string, context: ContextoOperador, blocked: unknown) {
    return this.transaction.ejecutar(async (repositories) => {
      const conversation = await this.requerir(repositories, conversationId)
      const contact = await repositories.contactos.buscar(conversation.contactId)
      if (!contact) throw new ErrorAsistente(404, 'NOT_FOUND', 'contact was not found')
      const block = blocked === true
      await repositories.contactos.actualizar(
        {
          ...contact,
          blockedUntil: block
            ? new Date(this.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          blockedReason: block ? 'operator' : null,
          version: contact.version + 1,
        },
        contact.version
      )
      await this.auditar(
        repositories,
        block ? 'support.contact_blocked' : 'support.contact_unblocked',
        conversation,
        context,
        {}
      )
      return { blocked: block }
    })
  }

  private async cambiarModo(
    conversationId: string,
    context: ContextoOperador,
    mode: 'bot' | 'human',
    reason: string | null
  ) {
    return this.transaction.ejecutar(async (repositories) => {
      const conversation = await this.requerir(repositories, conversationId)
      const next: ConversacionWhatsapp = {
        ...conversation,
        mode,
        handoffReason: mode === 'human' ? (conversation.handoffReason ?? reason) : null,
        handoffAt:
          mode === 'human' ? (conversation.handoffAt ?? new Date(this.now()).toISOString()) : null,
        operatorId: mode === 'human' ? context.actorId : null,
        state:
          mode === 'bot'
            ? { ...conversation.state, lowConfidenceCount: 0, pendingConfirmationId: null }
            : conversation.state,
        version: conversation.version + 1,
      }
      if (!(await repositories.conversaciones.actualizar(next, conversation.version)))
        throw new ErrorAsistente(409, 'CONCURRENT_MODIFICATION', 'conversation changed; reload it')
      await this.auditar(
        repositories,
        mode === 'human' ? 'support.takeover' : 'support.returned_to_bot',
        next,
        context,
        {}
      )
      return { conversationId, mode }
    })
  }

  private async requerir(repositories: RepositoriosAsistente, conversationId: string) {
    const conversation = await repositories.conversaciones.buscar(conversationId)
    if (!conversation) throw new ErrorAsistente(404, 'NOT_FOUND', 'conversation was not found')
    return conversation
  }

  private async auditar(
    repositories: RepositoriosAsistente,
    action: string,
    conversation: ConversacionWhatsapp,
    context: ContextoOperador,
    metadata: Record<string, unknown>
  ) {
    await repositories.auditoria.registrar({
      eventId: `auditoria-asistente-${randomUUID()}`,
      action,
      contactId: conversation.contactId,
      conversationId: conversation.conversationId,
      actorId: context.actorId,
      correlationId: context.correlationId,
      metadata,
      createdAt: new Date(this.now()).toISOString(),
    })
  }
}

function redondearUbicacion(value: unknown) {
  const location = value as { latitude?: number; longitude?: number }
  return typeof location.latitude === 'number' && typeof location.longitude === 'number'
    ? {
        latitude: Math.round(location.latitude * 100) / 100,
        longitude: Math.round(location.longitude * 100) / 100,
      }
    : null
}
