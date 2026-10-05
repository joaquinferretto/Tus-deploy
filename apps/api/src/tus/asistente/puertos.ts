import type {
  CanalConversacion,
  ConfirmacionAsistente,
  ContactoWhatsapp,
  ConversacionWhatsapp,
  EventoAuditoriaAsistente,
  MensajeConversacion,
  ResumenConversacion,
  ModoConversacion,
  TokenVinculacion,
  TrabajoConversacion,
} from './modelo.ts'
import type { ConsentimientoWhatsApp } from '../whatsapp/consent.ts'

// Phone identity verification by user-initiated WhatsApp message ("VERIFICAR TUS <code>"),
// implemented by the identity module (auth-security/phone). Messages it recognizes never reach the
// assistant (no Groq, no tools, no search): they are verified here and answered with fixed text.
export interface VerificadorTelefonoWhatsapp {
  esMensajeVerificacion(texto: unknown): boolean
  verificarDesdeWhatsapp(entrada: { waId: string; texto: string; wamid: string }): Promise<{ resultado: string; desafioId: string | null; respuesta: string | null }>
  // Read-only state for wording: does a verified identity phone match this sender? (never authority)
  numeroVerificado?(waId: string): Promise<boolean>
  // Read-only state of the sender's OWN number (the wa_id Meta delivered): whether it is the
  // verified phone of an account, linked, waiting for a challenge or in conflict. A state only:
  // no account, name or other number. Never authority.
  estadoNumero?(waId: string): Promise<'sin_cuenta' | 'verificado_sin_vinculo' | 'desafio_pendiente' | 'vinculado' | 'conflicto'>
  // What happened to the last verification / link code of the sender's own number. A state only.
  estadoDesafio?(waId: string): Promise<'ninguno' | 'pendiente' | 'vencido' | 'usado' | 'invalidado'>
  registrarConfirmacion(desafioId: string, resultado: { ok: true } | { ok: false; error: string }): Promise<void>
}

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
    // Every conversation of a contact, closed ones included (the history of an account).
    deContacto(contactId: string): Promise<ConversacionWhatsapp[]>
    // `channel` keeps the WhatsApp support inbox free of Web conversations (there is no operator
    // nor Meta window on the Web).
    listar(filter: { mode?: ModoConversacion; channel?: CanalConversacion; limit?: number; offset?: number }): Promise<ConversacionWhatsapp[]>
    contar(filter: { mode?: ModoConversacion; channel?: CanalConversacion }): Promise<number>
    // Active conversations that identified that account by name + document.
    identificadasPor(accountId: string): Promise<ConversacionWhatsapp[]>
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
    // The `limit` messages right before sequence `before` (the newest ones when it is null),
    // oldest first: stable order, by the sequence the store assigned.
    pagina(conversationId: string, input: { before: number | null; limit: number }): Promise<MensajeConversacion[]>
    // The messages right AFTER sequence `after`, oldest first (what a summary has not covered yet).
    posteriores(conversationId: string, input: { after: number; limit: number }): Promise<MensajeConversacion[]>
    // The same message `ultimos(id, 1)` returns, for many conversations in one query.
    ultimoDeConversaciones(conversationIds: readonly string[]): Promise<MensajeConversacion[]>
    contar(conversationId: string): Promise<number>
    // `types`: only inbound messages of those types (media limits); absent: every type.
    contarEntrantesDesde(contactId: string, since: string, types?: readonly string[]): Promise<number>
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
  resumenes: {
    // The newest version, or null.
    vigente(conversationId: string): Promise<ResumenConversacion | null>
    listar(conversationId: string): Promise<ResumenConversacion[]>
    // Throws a unique violation (code P2002) when that version already exists.
    crear(value: ResumenConversacion): Promise<void>
  }
  auditoria: {
    registrar(event: EventoAuditoriaAsistente): Promise<void>
    // Events of one action in a conversation since a moment (rate limits decided by the backend).
    contarDesde(input: { action: string; conversationId: string; since: string }): Promise<number>
  }
  consentimientosWhatsapp: {
    buscar(tenantId: string, recipientType: ConsentimientoWhatsApp['recipientType'], recipientId: string): Promise<ConsentimientoWhatsApp | null>
    guardar(value: ConsentimientoWhatsApp): Promise<void>
  }
}

export interface PuertoTransaccionAsistente {
  ejecutar<T>(operation: (repositories: RepositoriosAsistente) => Promise<T>): Promise<T>
}
