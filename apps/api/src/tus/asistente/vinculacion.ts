import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ErrorAsistente, enmascararWaId, type ContactoWhatsapp } from './modelo.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from './puertos.ts'

export const TTL_TOKEN_VINCULACION_MS = 10 * 60 * 1000

export function hashTokenVinculacion(token: string): string {
  return createHash('sha256').update(`tus-whatsapp-link:${token}`).digest('hex')
}

export interface ContextoCuentaWeb {
  // From the authenticated Web session (never from the request body).
  tenantId: string
  accountId: string
  correlationId: string
}

// WhatsApp ↔ TUS account link. The phone number is never trusted to find an account: the person
// asks from WhatsApp, receives a single-use short-lived link, signs in on the Web and confirms.
// Confirmation also requires the last 4 digits of the WhatsApp number (anti-phishing: a victim
// tricked into opening someone else's link would not know the attacker's number).
export class ServicioVinculacionWhatsapp {
  constructor(
    private readonly transaction: PuertoTransaccionAsistente,
    private readonly webBaseUrl: string | null,
    private readonly now: () => number = Date.now
  ) {}

  async crearEnlace(
    contactId: string,
    correlationId: string
  ): Promise<{ url: string; expiresAt: string }> {
    if (!this.webBaseUrl)
      throw new ErrorAsistente(
        503,
        'LINK_NOT_CONFIGURED',
        'TUS_WEB_BASE_URL is required to link accounts'
      )
    const token = randomBytes(32).toString('base64url')
    const nowMs = this.now()
    const expiresAt = new Date(nowMs + TTL_TOKEN_VINCULACION_MS).toISOString()
    await this.transaction.ejecutar(async (repositories) => {
      const contact = await repositories.contactos.buscar(contactId)
      if (!contact) throw new ErrorAsistente(404, 'NOT_FOUND', 'contact was not found')
      await repositories.tokens.crear({
        tokenId: `token-vinculacion-${randomUUID()}`,
        contactId,
        tokenHash: hashTokenVinculacion(token),
        expiresAt,
        usedAt: null,
        usedByAccountId: null,
        createdAt: new Date(nowMs).toISOString(),
      })
      await this.auditar(
        repositories,
        'whatsapp.link_requested',
        contact,
        'whatsapp-contact',
        correlationId,
        { expiresAt }
      )
    })
    return {
      url: `${this.webBaseUrl.replace(/\/+$/u, '')}/tus/whatsapp/vincular#token=${token}`,
      expiresAt,
    }
  }

  // Read-only preview for the confirmation page (masked number only).
  async describir(context: ContextoCuentaWeb, token: unknown) {
    return this.transaction.ejecutar(async (repositories) => {
      const { contact, record } = await this.cargar(repositories, token)
      return {
        whatsappMasked: enmascararWaId(contact.waId),
        expiresAt: record.expiresAt,
        alreadyLinkedToYou: contact.linkedAccountId === context.accountId,
      }
    })
  }

  async confirmar(context: ContextoCuentaWeb, input: { token: unknown; lastDigits: unknown }) {
    const mismatch = await this.transaction.ejecutar(async (repositories) => {
      const { contact } = await this.cargar(repositories, input.token)
      if (typeof input.lastDigits === 'string' && input.lastDigits === contact.waId.slice(-4))
        return false
      // Recorded in its own transaction so the failed attempt survives the rejection.
      await this.auditar(
        repositories,
        'whatsapp.link_digits_mismatch',
        contact,
        context.accountId,
        context.correlationId,
        {}
      )
      return true
    })
    if (mismatch)
      throw new ErrorAsistente(
        422,
        'DIGITS_MISMATCH',
        'the last digits do not match the WhatsApp number'
      )
    return this.transaction.ejecutar(async (repositories) => {
      const { contact, record } = await this.cargar(repositories, input.token)
      if (contact.linkedAccountId && contact.linkedAccountId !== context.accountId)
        throw new ErrorAsistente(
          409,
          'CONTACT_ALREADY_LINKED',
          'this WhatsApp is linked to another account; unlink it first'
        )
      if (
        !(await repositories.tokens.consumir({
          tokenId: record.tokenId,
          accountId: context.accountId,
          now: new Date(this.now()).toISOString(),
        }))
      )
        throw new ErrorAsistente(409, 'TOKEN_USED', 'the link was already used')
      const nowIso = new Date(this.now()).toISOString()
      const next: ContactoWhatsapp = {
        ...contact,
        linkedAccountId: context.accountId,
        linkedTenantId: context.tenantId,
        linkedAt: nowIso,
        version: contact.version + 1,
      }
      if (!(await repositories.contactos.actualizar(next, contact.version)))
        throw new ErrorAsistente(409, 'CONCURRENT_MODIFICATION', 'contact changed; retry')
      await this.auditar(
        repositories,
        'whatsapp.linked',
        next,
        context.accountId,
        context.correlationId,
        { tenantId: context.tenantId }
      )
      return { linked: true, whatsappMasked: enmascararWaId(contact.waId) }
    })
  }

  // WhatsApp numbers linked to the signed-in account (masked).
  async vinculosPropios(context: ContextoCuentaWeb) {
    return this.transaction.ejecutar(async (repositories) =>
      (await repositories.contactos.vinculadosA(context.accountId))
        .filter((contact) => contact.linkedTenantId === context.tenantId)
        .map((contact) => ({
          contactId: contact.contactId,
          whatsappMasked: enmascararWaId(contact.waId),
          linkedAt: contact.linkedAt,
        }))
    )
  }

  async desvincular(input: {
    contactId: string
    actorId: string
    correlationId: string
    accountId?: string
  }) {
    return this.transaction.ejecutar(async (repositories) => {
      const contact = await repositories.contactos.buscar(input.contactId)
      if (!contact) throw new ErrorAsistente(404, 'NOT_FOUND', 'contact was not found')
      // A Web user may only unlink contacts linked to their own account.
      if (input.accountId && contact.linkedAccountId !== input.accountId)
        throw new ErrorAsistente(404, 'NOT_FOUND', 'contact was not found')
      if (!contact.linkedAccountId) return { linked: false }
      const next: ContactoWhatsapp = {
        ...contact,
        linkedAccountId: null,
        linkedTenantId: null,
        linkedAt: null,
        version: contact.version + 1,
      }
      if (!(await repositories.contactos.actualizar(next, contact.version)))
        throw new ErrorAsistente(409, 'CONCURRENT_MODIFICATION', 'contact changed; retry')
      await this.auditar(
        repositories,
        'whatsapp.unlinked',
        next,
        input.actorId,
        input.correlationId,
        {}
      )
      return { linked: false }
    })
  }

  private async cargar(repositories: RepositoriosAsistente, token: unknown) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(token))
      throw new ErrorAsistente(400, 'INVALID_TOKEN', 'the link is not valid')
    const record = await repositories.tokens.buscarPorHash(hashTokenVinculacion(token))
    if (!record) throw new ErrorAsistente(404, 'INVALID_TOKEN', 'the link is not valid')
    if (record.usedAt) throw new ErrorAsistente(409, 'TOKEN_USED', 'the link was already used')
    if (Date.parse(record.expiresAt) <= this.now())
      throw new ErrorAsistente(410, 'TOKEN_EXPIRED', 'the link expired')
    const contact = await repositories.contactos.buscar(record.contactId)
    if (!contact) throw new ErrorAsistente(404, 'INVALID_TOKEN', 'the link is not valid')
    return { contact, record }
  }

  private async auditar(
    repositories: RepositoriosAsistente,
    action: string,
    contact: ContactoWhatsapp,
    actorId: string,
    correlationId: string,
    metadata: Record<string, unknown>
  ) {
    await repositories.auditoria.registrar({
      eventId: `auditoria-asistente-${randomUUID()}`,
      action,
      contactId: contact.contactId,
      conversationId: null,
      actorId,
      correlationId,
      metadata: { waId: enmascararWaId(contact.waId), ...metadata },
      createdAt: new Date(this.now()).toISOString(),
    })
  }
}
