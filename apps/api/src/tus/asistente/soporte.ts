import { randomUUID } from 'node:crypto'
import type { WhatsappProvider } from './meta.ts'
import {
  ErrorAsistente,
  canalDe,
  enmascararWaId,
  ventanaServicioAbierta,
  type ConversacionWhatsapp,
} from './modelo.ts'
import type { SolicitudTurnoParaAdmin } from '../calendar/turnos-service.ts'
import { ACCION_AVISO_NO_ENVIADO, correlacionAvisoSolicitud, type MotivoAvisoNoEnviado } from './avisos-turnos.ts'
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
    private readonly now: () => number = Date.now,
    // The requests of turno a conversation made, read from the agenda (never kept here).
    private readonly solicitudesDeTurno: (reservaIds: readonly string[]) => Promise<SolicitudTurnoParaAdmin[]> = async () => []
  ) {}

  // One page of the inbox (LIMIT/OFFSET in the store) + the filtered total.
  async pagina(filter: { mode?: unknown; pagina: number; tamano: number }) {
    const mode = filter.mode === 'bot' || filter.mode === 'human' ? filter.mode : undefined
    const [items, total] = await Promise.all([
      this.listar({ ...(mode ? { mode } : {}), limit: filter.tamano, offset: (filter.pagina - 1) * filter.tamano }),
      this.transaction.ejecutar((repositories) => repositories.conversaciones.contar({ channel: 'whatsapp', ...(mode ? { mode } : {}) })),
    ])
    return { items, total }
  }

  async listar(filter: { mode?: unknown; limit?: unknown; offset?: number }) {
    const mode = filter.mode === 'bot' || filter.mode === 'human' ? filter.mode : undefined
    return this.transaction.ejecutar(async (repositories) => {
      const conversations = await repositories.conversaciones.listar({
        // The inbox is the WhatsApp line: Web conversations have no operator and no Meta window.
        channel: 'whatsapp',
        ...(mode ? { mode } : {}),
        limit: Math.min(Math.max(Number(filter.limit) || 50, 1), 200),
        ...(filter.offset ? { offset: filter.offset } : {}),
      })
      // Contacts and last messages of the whole page in two batch reads (no query per conversation).
      const contacts = await repositories.contactos.buscarVarios([...new Set(conversations.map((c) => c.contactId))])
      const lastMessages = await repositories.mensajes.ultimoDeConversaciones(conversations.map((c) => c.conversationId))
      const contactById = new Map(contacts.map((contact) => [contact.contactId, contact]))
      const lastByConversation = new Map(lastMessages.map((message) => [message.conversationId, message]))
      const out = []
      for (const conversation of conversations) {
        const contact = contactById.get(conversation.contactId)
        const last = lastByConversation.get(conversation.conversationId)
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
    const detalle = await this.leerDetalle(conversationId, context)
    return { ...detalle, providerNotices: await this.avisosAPrestadores(conversationId).catch(() => []) }
  }

  // ADMIN-WHATSAPP-AVISOS-01. "¿TUS le avisó al prestador?" for every request of turno this
  // conversation made, from what the system really has:
  // - the message(s) of the notice in the provider's own conversation, with the status Meta
  //   reported (sent, delivered, read, failed);
  // - the record of a notice that was not sent at all, with its reason;
  // - the answer of the provider, from the state of the turno and its audit.
  // Nothing is inferred from the request having been created.
  async avisosAPrestadores(conversationId: string): Promise<AvisoAPrestador[]> {
    const pedidos = await this.transaction.ejecutar(async (repositories) =>
      (await repositories.confirmaciones.ejecutadasDe(conversationId, 'book_appointment')).flatMap((confirmacion) => {
        const id = (confirmacion.result?.['appointment'] as { id?: unknown } | undefined)?.id
        return typeof id === 'string' && id ? [id] : []
      })
    )
    if (pedidos.length === 0) return []
    const solicitudes = await this.solicitudesDeTurno(pedidos)
    if (solicitudes.length === 0) return []
    const correlaciones = solicitudes.map((solicitud) => correlacionAvisoSolicitud(solicitud.reservaId))
    return this.transaction.ejecutar(async (repositories) => {
      const [mensajes, noEnviados] = await Promise.all([
        repositories.mensajes.porCorrelaciones(correlaciones),
        repositories.auditoria.porCorrelaciones({ action: ACCION_AVISO_NO_ENVIADO, correlationIds: correlaciones }),
      ])
      const contactos = new Map((await repositories.contactos.buscarVarios([...new Set(mensajes.map((mensaje) => mensaje.contactId))])).map((contacto) => [contacto.contactId, contacto]))
      return solicitudes
        .sort((a, b) => a.creadaEn.localeCompare(b.creadaEn))
        .map((solicitud) => {
          const correlacion = correlacionAvisoSolicitud(solicitud.reservaId)
          // The notice itself (buttons inside the window, the template outside it); its pictures
          // are other messages of the same correlation and say nothing about the notice.
          const deliveries = mensajes
            .filter((mensaje) => mensaje.correlationId === correlacion && mensaje.direction === 'outbound' && mensaje.type !== 'image')
            .map((mensaje) => ({
              conversationId: mensaje.conversationId,
              waIdMasked: contactos.has(mensaje.contactId) ? enmascararWaId(contactos.get(mensaje.contactId)!.waId) : null,
              kind: mensaje.type === 'template' ? ('template' as const) : ('message' as const),
              status: mensaje.status,
              at: mensaje.statusAt ?? mensaje.createdAt,
              // Why the send failed, as the provider of WhatsApp classified it (never its body).
              error: mensaje.status === 'failed' && typeof mensaje.metadata['errorCode'] === 'string' ? mensaje.metadata['errorCode'] : null,
            }))
          const fallo = noEnviados.filter((evento) => evento.correlationId === correlacion).at(-1)
          const notSent = deliveries.length === 0 && fallo ? { reason: String(fallo.metadata['reason']) as MotivoAvisoNoEnviado, at: fallo.createdAt } : null
          return {
            reservaId: solicitud.reservaId,
            service: solicitud.servicio,
            startsAt: solicitud.inicio,
            requestedAt: solicitud.creadaEn,
            appointmentStatus: solicitud.estado,
            provider: { name: solicitud.prestadorNombre, hasAccount: Boolean(solicitud.prestadorCuentaId) },
            deliveries,
            notSent,
            answer: solicitud.respuesta ? { result: solicitud.respuesta.resultado === 'aceptada' ? ('accepted' as const) : ('rejected' as const), at: solicitud.respuesta.en, channel: solicitud.respuesta.canal } : null,
            state: estadoDelAviso(deliveries.map((entrega) => entrega.status), notSent?.reason ?? null, solicitud.respuesta?.resultado ?? null),
          }
        })
    })
  }

  private async leerDetalle(conversationId: string, context: ContextoOperador) {
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
          // When Meta reported that status (null: nothing was reported yet).
          statusAt: message.statusAt,
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
    if (!conversation || canalDe(conversation) !== 'whatsapp') throw new ErrorAsistente(404, 'NOT_FOUND', 'conversation was not found')
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

// ADMIN-WHATSAPP-AVISOS-01. One state for the notice of a request, in the order Admin asks it:
// did the provider answer; if not, how far did the notice get; if nothing was sent, why.
export type EstadoAvisoPrestador = 'accepted' | 'rejected' | 'read' | 'delivered' | 'sent' | 'sending' | 'failed' | 'template_required' | 'not_sent' | 'pending'

export interface AvisoAPrestador {
  reservaId: string
  service: string
  startsAt: string
  requestedAt: string
  appointmentStatus: string
  provider: { name: string; hasAccount: boolean }
  deliveries: { conversationId: string; waIdMasked: string | null; kind: 'template' | 'message'; status: string; at: string; error: string | null }[]
  notSent: { reason: MotivoAvisoNoEnviado; at: string } | null
  answer: { result: 'accepted' | 'rejected'; at: string; channel: string } | null
  state: EstadoAvisoPrestador
}

// The furthest any of its numbers got wins ("read" on one phone is read); a failure counts only
// when no number got the notice. No message and no record: the notice is still to be processed.
export function estadoDelAviso(entregas: readonly string[], motivo: MotivoAvisoNoEnviado | null, respuesta: 'aceptada' | 'rechazada' | null): EstadoAvisoPrestador {
  if (respuesta) return respuesta === 'aceptada' ? 'accepted' : 'rejected'
  for (const estado of ['read', 'delivered', 'sent'] as const) if (entregas.includes(estado)) return estado
  if (entregas.includes('pending_send') || entregas.includes('unknown')) return 'sending'
  if (entregas.includes('failed')) return 'failed'
  if (motivo) return motivo === 'template_required' ? 'template_required' : 'not_sent'
  return 'pending'
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
