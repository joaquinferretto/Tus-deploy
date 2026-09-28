import type {
  ConfirmacionAsistente,
  ContactoWhatsapp,
  ConversacionWhatsapp,
  EventoAuditoriaAsistente,
  MensajeConversacion,
  ModoConversacion,
  TokenVinculacion,
  TrabajoConversacion,
} from './modelo.ts'
import type { ConsentimientoWhatsApp } from '../whatsapp/consent.ts'

export interface RepositoriosAsistente {
  contactos: {
    buscarPorWaId(waId: string): Promise<ContactoWhatsapp | null>
    buscar(contactId: string): Promise<ContactoWhatsapp | null>
    // Batch read for the support inbox (one query per page, never one per conversation).
    buscarVarios(contactIds: readonly string[]): Promise<ContactoWhatsapp[]>
    crear(value: ContactoWhatsapp): Promise<void>
    actualizar(value: ContactoWhatsapp, expectedVersion: number): Promise<boolean>
    vinculadosA(accountId: string): Promise<ContactoWhatsapp[]>
  }
  conversaciones: {
    activaDeContacto(contactId: string): Promise<ConversacionWhatsapp | null>
    buscar(conversationId: string): Promise<ConversacionWhatsapp | null>
    crear(value: ConversacionWhatsapp): Promise<void>
    actualizar(value: ConversacionWhatsapp, expectedVersion: number): Promise<boolean>
    listar(filter: { mode?: ModoConversacion; limit?: number; offset?: number }): Promise<ConversacionWhatsapp[]>
    contar(filter: { mode?: ModoConversacion }): Promise<number>
  }
  mensajes: {
    buscarPorWamid(wamid: string): Promise<MensajeConversacion | null>
    buscar(messageId: string): Promise<MensajeConversacion | null>
    // Throws a unique violation (code P2002) for a repeated wamid.
    crear(value: MensajeConversacion): Promise<void>
    actualizar(value: MensajeConversacion): Promise<void>
    // Inbound messages not yet handled, oldest first.
    pendientes(conversationId: string): Promise<MensajeConversacion[]>
    ultimos(conversationId: string, limit: number): Promise<MensajeConversacion[]>
    // The same message `ultimos(id, 1)` returns, for many conversations in one query.
    ultimoDeConversaciones(conversationIds: readonly string[]): Promise<MensajeConversacion[]>
    contar(conversationId: string): Promise<number>
    contarEntrantesDesde(contactId: string, since: string): Promise<number>
  }
  cola: {
    // One queued job per conversation: a new inbound message only pushes `availableAt`
    // (debounce) instead of creating a parallel job.
    encolar(input: { jobId: string; conversationId: string; availableAt: string; correlationId: string; now: string }): Promise<void>
    // FIFO by availableAt; a conversation with a live lease is skipped (serialization).
    tomarSiguiente(input: { owner: string; now: string; leaseUntil: string }): Promise<TrabajoConversacion | null>
    actualizar(job: TrabajoConversacion, owner: string): Promise<boolean>
    contarPendientes(): Promise<number>
  }
  tokens: {
    crear(value: TokenVinculacion): Promise<void>
    buscarPorHash(tokenHash: string): Promise<TokenVinculacion | null>
    // Atomic single use: only if unused and not expired.
    consumir(input: { tokenId: string; accountId: string; now: string }): Promise<boolean>
  }
  confirmaciones: {
    crear(value: ConfirmacionAsistente): Promise<void>
    buscar(confirmationId: string): Promise<ConfirmacionAsistente | null>
    // Conditional transition (idempotency of the decision).
    actualizar(value: ConfirmacionAsistente, expectedStatus: ConfirmacionAsistente['status']): Promise<boolean>
  }
  auditoria: { registrar(event: EventoAuditoriaAsistente): Promise<void> }
  consentimientosWhatsapp: {
    buscar(tenantId: string, recipientType: ConsentimientoWhatsApp['recipientType'], recipientId: string): Promise<ConsentimientoWhatsApp | null>
    guardar(value: ConsentimientoWhatsApp): Promise<void>
  }
}

export interface PuertoTransaccionAsistente {
  ejecutar<T>(operation: (repositories: RepositoriosAsistente) => Promise<T>): Promise<T>
}
