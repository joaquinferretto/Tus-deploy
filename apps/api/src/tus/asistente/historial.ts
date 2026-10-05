import { ErrorAsistente, canalDe, claveContactoWeb, type CanalConversacion, type ContactoWhatsapp, type ConversacionWhatsapp, type MensajeConversacion } from './modelo.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from './puertos.ts'

// MEMORIA-01. The canonical history of the assistant: the real messages of the conversations of
// ONE account, on both channels, in a stable order (the sequence the database assigns) and by
// pages. It is the only way the memory reads messages: every read starts from an account the
// BACKEND resolved (session on the Web, verified link on WhatsApp) and never leaves it.
//
// An anonymous Web visitor and a WhatsApp that is not linked have no account: they only have
// their current conversation, read by the orchestrator through its own contact. The temporary
// identification by name + document authorises one action and is not an account for the memory.

export const PREFIJO_CUENTA_WEB = claveContactoWeb({ accountId: '' })
export const TAMANO_PAGINA_HISTORIAL = 50
export const MAXIMO_PAGINA_HISTORIAL = 200

// The account a contact belongs to, or null. Web: the account of the session is in its key.
// WhatsApp: only the verified link counts.
export function cuentaDeContacto(contact: Pick<ContactoWhatsapp, 'waId' | 'linkedAccountId' | 'channel'>): string | null {
  if (canalDe(contact) === 'web') return contact.waId.startsWith(PREFIJO_CUENTA_WEB) && contact.waId.length > PREFIJO_CUENTA_WEB.length ? contact.waId.slice(PREFIJO_CUENTA_WEB.length) : null
  return contact.linkedAccountId ?? null
}

export interface ConversacionDeCuenta {
  conversationId: string
  channel: CanalConversacion
  status: ConversacionWhatsapp['status']
  openedAt: string
  lastMessageAt: string
}

export interface PaginaHistorial {
  // Oldest first.
  messages: MensajeConversacion[]
  // Pass it as `before` to read the page before this one; null when there is nothing older.
  nextBefore: number | null
}

// The contacts of an account: its Web contact and the WhatsApp contacts linked to it.
export async function contactosDeCuenta(repositories: RepositoriosAsistente, accountId: string): Promise<ContactoWhatsapp[]> {
  if (!accountId) return []
  const [web, vinculados] = await Promise.all([repositories.contactos.buscarPorWaId(claveContactoWeb({ accountId })), repositories.contactos.vinculadosA(accountId)])
  const contactos = new Map<string, ContactoWhatsapp>()
  for (const contact of [...(web ? [web] : []), ...vinculados]) if (cuentaDeContacto(contact) === accountId) contactos.set(contact.contactId, contact)
  return [...contactos.values()]
}

export class HistorialConversacional {
  constructor(private readonly transaction: PuertoTransaccionAsistente) {}

  // Every conversation of the account, newest first.
  async conversaciones(accountId: string): Promise<ConversacionDeCuenta[]> {
    return this.transaction.ejecutar(async (repositories) => {
      const contactos = await contactosDeCuenta(repositories, accountId)
      const listas = await Promise.all(contactos.map((contact) => repositories.conversaciones.deContacto(contact.contactId)))
      return listas
        .flat()
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.conversationId.localeCompare(a.conversationId))
        .map((conversation) => ({ conversationId: conversation.conversationId, channel: canalDe(conversation), status: conversation.status, openedAt: conversation.openedAt, lastMessageAt: conversation.lastMessageAt }))
    })
  }

  // One page of one conversation OF THAT ACCOUNT. A conversation of somebody else (or one that
  // does not exist) is the same answer: not found.
  async mensajes(input: { accountId: string; conversationId: string; before?: number | null; limit?: number }): Promise<PaginaHistorial> {
    const limit = Math.min(Math.max(1, Math.trunc(input.limit ?? TAMANO_PAGINA_HISTORIAL)), MAXIMO_PAGINA_HISTORIAL)
    return this.transaction.ejecutar(async (repositories) => {
      const conversation = await repositories.conversaciones.buscar(input.conversationId)
      const contact = conversation ? await repositories.contactos.buscar(conversation.contactId) : null
      if (!conversation || !contact || !input.accountId || cuentaDeContacto(contact) !== input.accountId) throw new ErrorAsistente(404, 'NOT_FOUND', 'conversation was not found')
      // One more than asked: whether there is an older page.
      const filas = await repositories.mensajes.pagina(conversation.conversationId, { before: input.before ?? null, limit: limit + 1 })
      const messages = filas.length > limit ? filas.slice(filas.length - limit) : filas
      return { messages, nextBefore: filas.length > limit ? (messages[0]?.sequence ?? null) : null }
    })
  }
}
