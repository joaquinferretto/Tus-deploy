import { randomUUID } from 'node:crypto'
import type { EventoWebhookMeta, MensajeEntranteMeta } from './meta.ts'
import {
  ESTADO_CONVERSACIONAL_INICIAL,
  aplicarEstadoEntrega,
  enmascararWaId,
  type ContactoWhatsapp,
  type ConversacionWhatsapp,
  type MensajeConversacion,
} from './modelo.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from './puertos.ts'

export interface LimitesIngreso {
  maxInboundPerMinute: number
  // Beyond this many messages in a minute the contact is blocked for `blockMs`.
  blockThresholdPerMinute: number
  blockMs: number
  debounceMs: number
}

export const LIMITES_INGRESO_POR_DEFECTO: LimitesIngreso = {
  maxInboundPerMinute: 12,
  blockThresholdPerMinute: 60,
  blockMs: 60 * 60 * 1000,
  debounceMs: 1500,
}

export interface ResultadoIngreso {
  accepted: number
  duplicates: number
  statusesApplied: number
  statusesIgnored: number
  rateLimited: number
}

// Webhook side: runs after the signature was verified. Only persists and enqueues; never calls
// Groq, RAG, tools or Meta, so the webhook answers 200 quickly.
export class ServicioIngresoWhatsapp {
  constructor(
    private readonly transaction: PuertoTransaccionAsistente,
    private readonly limits: LimitesIngreso = LIMITES_INGRESO_POR_DEFECTO,
    private readonly now: () => number = Date.now,
    private readonly log: (event: string, fields: Record<string, unknown>) => void = () => undefined
  ) {}

  async procesar(events: EventoWebhookMeta[], correlationId: string): Promise<ResultadoIngreso> {
    const result: ResultadoIngreso = {
      accepted: 0,
      duplicates: 0,
      statusesApplied: 0,
      statusesIgnored: 0,
      rateLimited: 0,
    }
    for (const event of events) {
      if (event.kind === 'status') {
        const applied = await this.transaction.ejecutar(async (repositories) => {
          const message = await repositories.mensajes.buscarPorWamid(event.wamid)
          if (!message || message.direction !== 'outbound') return false
          const next = aplicarEstadoEntrega(message, {
            status: event.status,
            at: new Date(event.timestamp).toISOString(),
          })
          if (!next) return false
          await repositories.mensajes.actualizar({
            ...message,
            ...next,
            metadata: {
              ...message.metadata,
              ...(event.errorCode !== null ? { metaErrorCode: event.errorCode } : {}),
            },
          })
          return true
        })
        if (applied) result.statusesApplied += 1
        else result.statusesIgnored += 1
        continue
      }
      try {
        const outcome = await this.transaction.ejecutar((repositories) =>
          this.registrarEntrante(repositories, event, correlationId)
        )
        if (outcome === 'duplicate') result.duplicates += 1
        else if (outcome === 'rate_limited') result.rateLimited += 1
        else result.accepted += 1
      } catch (error) {
        // A concurrent delivery of the same wamid lost the unique race: it is a replay.
        if ((error as { code?: string })?.code === 'P2002') result.duplicates += 1
        else throw error
      }
    }
    this.log('whatsapp.webhook_processed', { ...result, correlationId })
    return result
  }

  private async registrarEntrante(
    repositories: RepositoriosAsistente,
    event: MensajeEntranteMeta,
    correlationId: string
  ): Promise<'accepted' | 'duplicate' | 'rate_limited'> {
    if (await repositories.mensajes.buscarPorWamid(event.wamid)) return 'duplicate'
    const nowMs = this.now()
    const nowIso = new Date(nowMs).toISOString()
    let contact = await repositories.contactos.buscarPorWaId(event.waId)
    if (!contact) {
      contact = {
        contactId: `contacto-whatsapp-${randomUUID()}`,
        waId: event.waId,
        displayName: event.displayName,
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
      await this.auditar(repositories, 'whatsapp.contact_created', contact, null, correlationId, {})
    }
    let conversation = await repositories.conversaciones.activaDeContacto(contact.contactId)
    if (!conversation) {
      conversation = {
        conversationId: `conversacion-whatsapp-${randomUUID()}`,
        contactId: contact.contactId,
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
    const recent = await repositories.mensajes.contarEntrantesDesde(
      contact.contactId,
      new Date(nowMs - 60_000).toISOString()
    )
    const blocked = Boolean(contact.blockedUntil && Date.parse(contact.blockedUntil) > nowMs)
    const rateLimited = blocked || recent >= this.limits.maxInboundPerMinute
    const message: MensajeConversacion = {
      messageId: `mensaje-whatsapp-${randomUUID()}`,
      conversationId: conversation.conversationId,
      contactId: contact.contactId,
      wamid: event.wamid,
      direction: 'inbound',
      type: event.type,
      text: event.text ? event.text.slice(0, 4096) : null,
      status: rateLimited ? 'rate_limited' : 'received',
      statusAt: null,
      externalTimestamp: new Date(event.timestamp).toISOString(),
      replyToWamid: event.replyToWamid,
      actor: 'contact',
      metadata: {
        ...(event.replyId ? { replyId: event.replyId.slice(0, 256) } : {}),
        ...(event.media ? { media: { id: event.media.id, mimeType: event.media.mimeType } } : {}),
        ...(event.location ? { location: event.location } : {}),
      },
      correlationId,
      createdAt: nowIso,
    }
    await repositories.mensajes.crear(message)
    const updatedContact: ContactoWhatsapp = {
      ...contact,
      displayName: event.displayName ?? contact.displayName,
      lastInboundAt: nowIso,
      ...(recent + 1 >= this.limits.blockThresholdPerMinute && !blocked
        ? {
            blockedUntil: new Date(nowMs + this.limits.blockMs).toISOString(),
            blockedReason: 'inbound_flood',
          }
        : {}),
      version: contact.version + 1,
    }
    await repositories.contactos.actualizar(updatedContact, contact.version)
    if (
      updatedContact.blockedReason === 'inbound_flood' &&
      !blocked &&
      updatedContact.blockedUntil !== contact.blockedUntil
    )
      await this.auditar(
        repositories,
        'whatsapp.contact_blocked',
        updatedContact,
        conversation,
        correlationId,
        { reason: 'inbound_flood' }
      )
    const updatedConversation: ConversacionWhatsapp = {
      ...conversation,
      lastMessageAt: nowIso,
      lastInboundAt: nowIso,
      unreadCount: conversation.unreadCount + 1,
      version: conversation.version + 1,
    }
    await repositories.conversaciones.actualizar(updatedConversation, conversation.version)
    if (rateLimited) return 'rate_limited'
    // Human mode: the operator answers; the assistant is not scheduled.
    if (conversation.mode === 'bot')
      await repositories.cola.encolar({
        jobId: `trabajo-conversacion-${randomUUID()}`,
        conversationId: conversation.conversationId,
        availableAt: new Date(nowMs + this.limits.debounceMs).toISOString(),
        correlationId,
        now: nowIso,
      })
    return 'accepted'
  }

  private async auditar(
    repositories: RepositoriosAsistente,
    action: string,
    contact: ContactoWhatsapp,
    conversation: ConversacionWhatsapp | null,
    correlationId: string,
    metadata: Record<string, unknown>
  ) {
    await repositories.auditoria.registrar({
      eventId: `auditoria-asistente-${randomUUID()}`,
      action,
      contactId: contact.contactId,
      conversationId: conversation?.conversationId ?? null,
      actorId: 'whatsapp-webhook',
      correlationId,
      metadata: { waId: enmascararWaId(contact.waId), ...metadata },
      createdAt: new Date(this.now()).toISOString(),
    })
  }
}
