import { randomUUID } from 'node:crypto'
import type { EventoWebhookMeta, MensajeEntranteMeta } from './meta.ts'
import {
  ESTADO_CONVERSACIONAL_INICIAL,
  aplicarEstadoEntrega,
  buscarContactoPorWaId,
  enmascararWaId,
  type ContactoWhatsapp,
  type ConversacionWhatsapp,
  type MensajeConversacion,
} from './modelo.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente, VerificadorTelefonoWhatsapp } from './puertos.ts'
import { WHATSAPP_CONSENT_ORIGINS, crearConsentimientoWhatsApp } from '../whatsapp/consent.ts'

export interface LimitesIngreso {
  maxInboundPerMinute: number
  // Beyond this many messages in a minute the contact is blocked for `blockMs`.
  blockThresholdPerMinute: number
  blockMs: number
  debounceMs: number
  // Voice notes, images and documents a contact may send per hour: each one costs a download, a
  // speech-to-text call or a payment query, so it is bounded apart from plain text.
  maxMediaPerHour: number
}

export const LIMITES_INGRESO_POR_DEFECTO: LimitesIngreso = {
  maxInboundPerMinute: 12,
  blockThresholdPerMinute: 60,
  blockMs: 60 * 60 * 1000,
  debounceMs: 1500,
  maxMediaPerHour: 20,
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
    private readonly log: (event: string, fields: Record<string, unknown>) => void = () => undefined,
    private readonly verificador: VerificadorTelefonoWhatsapp | null = null,
    // WHATSAPP-LEIDO-01. Called the moment a message is left for the assistant: the person sees
    // the blue ticks and "escribiendo…" at once, without waiting for the queue. Best effort.
    private readonly alRecibir: ((wamid: string) => void) | null = null
  ) {}

  private esVerificacion(event: MensajeEntranteMeta): boolean {
    return Boolean(this.verificador && event.type === 'text' && this.verificador.esMensajeVerificacion(event.text))
  }

  // Deterministic phone verification of an already persisted inbound message. Idempotent: the
  // identity module ignores a wamid it already used, and the outcome is written once, so a
  // redelivered webhook neither verifies twice nor queues a second confirmation.
  private async verificarTelefono(event: MensajeEntranteMeta, correlationId: string): Promise<void> {
    const pendiente = await this.transaction.ejecutar(async (repositories) => {
      const message = await repositories.mensajes.buscarPorWamid(event.wamid)
      return message && message.status !== 'rate_limited' && !(message.metadata['verificacionTelefono'] as { resultado?: string } | undefined)?.resultado ? message : null
    })
    if (!pendiente || !this.verificador) return
    const verificacion = await this.verificador.verificarDesdeWhatsapp({ waId: event.waId, texto: event.text ?? '', wamid: event.wamid })
    const nowIso = new Date(this.now()).toISOString()
    await this.transaction.ejecutar(async (repositories) => {
      const current = await repositories.mensajes.buscar(pendiente.messageId)
      if (!current || (current.metadata['verificacionTelefono'] as { resultado?: string } | undefined)?.resultado) return
      await repositories.mensajes.actualizar({
        ...current,
        // Nothing for the assistant to do: marked processed unless a confirmation must be sent.
        status: verificacion.respuesta ? 'received' : 'processed',
        metadata: { ...current.metadata, verificacionTelefono: { resultado: verificacion.resultado, desafioId: verificacion.desafioId, respuesta: verificacion.respuesta } },
      })
      if (verificacion.respuesta)
        await repositories.cola.encolar({
          jobId: `trabajo-conversacion-${randomUUID()}`,
          conversationId: current.conversationId,
          availableAt: nowIso,
          correlationId,
          now: nowIso,
        })
    })
    this.log('whatsapp.phone_verification', { outcome: verificacion.resultado, correlationId })
  }

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
          // Only by Meta's own id of the message: never by conversation, phone, order or time.
          const message = await repositories.mensajes.buscarPorWamid(event.wamid)
          if (!message || message.direction !== 'outbound') return { applied: false, message: null, next: null }
          const next = aplicarEstadoEntrega(message, {
            status: event.status,
            at: new Date(event.timestamp).toISOString(),
          })
          if (!next) return { applied: false, message, next: null }
          await repositories.mensajes.actualizar({
            ...message,
            ...next,
            metadata: {
              ...message.metadata,
              ...(event.errorCode !== null ? { metaErrorCode: event.errorCode } : {}),
              // WHATSAPP-DESTINO-01. Who Meta says this status is about (`recipient_id`).
              ...(event.recipientWaId ? { statusRecipient: event.recipientWaId } : {}),
            },
          })
          return { applied: true, message, next }
        })
        // Safe trace of the route of a message: ids, states and Meta's error number only.
        this.log(applied.message ? 'whatsapp.status' : 'whatsapp.status_unmatched', {
          messageId: applied.message?.messageId ?? null,
          wamid: event.wamid,
          actor: applied.message ? (applied.message.actor.startsWith('operator:') ? 'operator' : applied.message.actor) : null,
          previous: applied.message?.status ?? null,
          incoming: event.status,
          status: applied.next?.status ?? applied.message?.status ?? null,
          applied: applied.applied,
          at: new Date(event.timestamp).toISOString(),
          recipient: event.recipientWaId ? enmascararWaId(event.recipientWaId) : null,
          ...(event.errorCode !== null ? { metaErrorCode: event.errorCode } : {}),
          correlationId,
        })
        if (applied.applied) result.statusesApplied += 1
        else result.statusesIgnored += 1
        continue
      }
      const verificacion = this.esVerificacion(event)
      try {
        const outcome = await this.transaction.ejecutar((repositories) =>
          this.registrarEntrante(repositories, event, correlationId, verificacion)
        )
        if (outcome === 'duplicate') result.duplicates += 1
        else if (outcome === 'rate_limited') result.rateLimited += 1
        else result.accepted += 1
      } catch (error) {
        // A concurrent delivery of the same wamid lost the unique race: it is a replay.
        if ((error as { code?: string })?.code === 'P2002') result.duplicates += 1
        else throw error
      }
      // Also on a duplicate: a delivery that crashed before recording the outcome is completed now.
      if (verificacion) await this.verificarTelefono(event, correlationId)
    }
    this.log('whatsapp.webhook_processed', { ...result, correlationId })
    return result
  }

  private async registrarEntrante(
    repositories: RepositoriosAsistente,
    event: MensajeEntranteMeta,
    correlationId: string,
    verificacion = false
  ): Promise<'accepted' | 'duplicate' | 'rate_limited'> {
    if (await repositories.mensajes.buscarPorWamid(event.wamid)) return 'duplicate'
    const nowMs = this.now()
    const nowIso = new Date(nowMs).toISOString()
    let contact = await buscarContactoPorWaId(repositories.contactos, event.waId)
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
      await this.auditar(
        repositories,
        'whatsapp.consent.recorded',
        contact,
        conversation,
        correlationId,
        { origin: WHATSAPP_CONSENT_ORIGINS.WHATSAPP_INBOUND, purpose: 'conversation' }
      )
      if (contact.linkedTenantId && contact.linkedAccountId) {
        const existingConsent = await repositories.consentimientosWhatsapp.buscar(
          contact.linkedTenantId,
          'customer',
          contact.waId,
        )
        // Do not downgrade an explicit web/operator consent or reactivate an opt-out.
        if (!existingConsent) {
          await repositories.consentimientosWhatsapp.guardar(
            crearConsentimientoWhatsApp({
              tenantId: contact.linkedTenantId,
              recipientType: 'customer',
              recipientId: contact.waId,
              source: WHATSAPP_CONSENT_ORIGINS.WHATSAPP_INBOUND,
              now: nowMs,
            })
          )
        }
      }
    }
    const recent = await repositories.mensajes.contarEntrantesDesde(
      contact.contactId,
      new Date(nowMs - 60_000).toISOString()
    )
    const blocked = Boolean(contact.blockedUntil && Date.parse(contact.blockedUntil) > nowMs)
    const esMedia = event.type === 'audio' || event.type === 'image' || event.type === 'document'
    const mediaRecientes = esMedia
      ? await repositories.mensajes.contarEntrantesDesde(contact.contactId, new Date(nowMs - 60 * 60_000).toISOString(), ['audio', 'image', 'document'])
      : 0
    const rateLimited = blocked || recent >= this.limits.maxInboundPerMinute || (esMedia && mediaRecientes >= this.limits.maxMediaPerHour)
    const message: MensajeConversacion = {
      messageId: `mensaje-whatsapp-${randomUUID()}`,
      conversationId: conversation.conversationId,
      contactId: contact.contactId,
      wamid: event.wamid,
      direction: 'inbound',
      type: event.type,
      // A verification code is never stored (single-use or not): only the fact that one arrived.
      text: verificacion ? 'VERIFICAR TUS ********' : event.text ? event.text.slice(0, 4096) : null,
      status: rateLimited ? 'rate_limited' : 'received',
      statusAt: null,
      externalTimestamp: new Date(event.timestamp).toISOString(),
      replyToWamid: event.replyToWamid,
      actor: 'contact',
      metadata: {
        ...(event.replyId ? { replyId: event.replyId.slice(0, 256) } : {}),
        // Only identifiers and a hash: the content of a media message is never stored here.
        ...(event.media ? { media: { id: event.media.id, mimeType: event.media.mimeType, ...(event.media.sha256 ? { sha256: event.media.sha256 } : {}) } } : {}),
        ...(event.location ? { location: event.location } : {}),
        ...(verificacion ? { verificacionTelefono: {} } : {}),
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
      // Recover chats stranded by the former automatic handoff. Explicit operator takeovers
      // retain their owner and are never silently overridden.
      ...(conversation.mode === 'human' && !conversation.operatorId ? {
        mode: 'bot' as const, handoffReason: null, handoffAt: null,
      } : {}),
      lastMessageAt: nowIso,
      lastInboundAt: nowIso,
      unreadCount: conversation.unreadCount + 1,
      version: conversation.version + 1,
    }
    await repositories.conversaciones.actualizar(updatedConversation, conversation.version)
    if (rateLimited) return 'rate_limited'
    // Human mode: the operator answers; the assistant is not scheduled. A verification message
    // is never handed to the assistant (its confirmation is queued after the verification).
    if (updatedConversation.mode === 'bot' && !verificacion)
      await repositories.cola.encolar({
        jobId: `trabajo-conversacion-${randomUUID()}`,
        conversationId: conversation.conversationId,
        availableAt: new Date(nowMs + this.limits.debounceMs).toISOString(),
        correlationId,
        now: nowIso,
      })
    // Only what the assistant will answer: a conversation an operator owns is read by a person.
    if (updatedConversation.mode === 'bot' && !verificacion && event.wamid) {
      try {
        this.alRecibir?.(event.wamid)
      } catch {
        // Never part of the ingest.
      }
    }
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
