import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { telefonoDesdeWaId } from '@factory/contracts'
import { ErrorAsistente, enmascararWaId, type ContactoWhatsapp } from './modelo.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from './puertos.ts'
import { WHATSAPP_CONSENT_ORIGINS, crearConsentimientoWhatsApp } from '../whatsapp/consent.ts'

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

  // Where the person links this WhatsApp from: Mi perfil (the Web sends signed-out people to sign in
  // first and brings them back here). A fixed path: nothing user-controlled goes into it.
  urlVincularDesdePerfil(): string | null {
    return this.webBaseUrl ? `${this.webBaseUrl.replace(/\/+$/u, '')}/mi-perfil?accion=vincular-whatsapp` : null
  }

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
      const consent = crearConsentimientoWhatsApp({
        tenantId: context.tenantId,
        recipientType: 'customer',
        recipientId: contact.waId,
        source: WHATSAPP_CONSENT_ORIGINS.WEB_LINKING,
        now: this.now(),
      })
      await repositories.consentimientosWhatsapp.guardar(consent)
      await this.auditar(
        repositories,
        'whatsapp.consent.recorded',
        next,
        context.accountId,
        context.correlationId,
        { origin: WHATSAPP_CONSENT_ORIGINS.WEB_LINKING, purpose: 'conversation' }
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

export interface EntradaVinculoPorVerificacion {
  // The sender exactly as Meta delivered it (the key of the contact), never a Web value.
  waId: string
  accountId: string
  tenantId: string
  // The identity phone the account had before this verification (a number change).
  telefonoAnterior: string | null
  correlationId: string
  now: number
}

export type ResultadoVinculoPorVerificacion = 'vinculado' | 'ya_vinculado' | 'conflicto'

// "VERIFICAR TUS <code>" proves the person controls this WhatsApp, so it also links the contact to
// the account. It writes the SAME field the token flow writes (contact.linkedAccountId) and is meant
// to run inside the transaction that consumes the challenge: it never creates a second source of
// truth. A contact linked to ANOTHER account is never reassigned.
export async function vincularContactoPorVerificacion(
  repositories: RepositoriosAsistente,
  input: EntradaVinculoPorVerificacion
): Promise<ResultadoVinculoPorVerificacion> {
  const nowIso = new Date(input.now).toISOString()
  const auditar = (action: string, contact: ContactoWhatsapp, metadata: Record<string, unknown>) =>
    repositories.auditoria.registrar({
      eventId: `auditoria-asistente-${randomUUID()}`,
      action,
      contactId: contact.contactId,
      conversationId: null,
      actorId: input.accountId,
      correlationId: input.correlationId,
      metadata: { waId: enmascararWaId(contact.waId), ...metadata },
      createdAt: nowIso,
    })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let contact = await repositories.contactos.buscarPorWaId(input.waId)
    if (!contact) {
      contact = {
        contactId: `contacto-whatsapp-${randomUUID()}`,
        waId: input.waId,
        displayName: null,
        linkedAccountId: null,
        linkedTenantId: null,
        linkedAt: null,
        blockedUntil: null,
        blockedReason: null,
        createdAt: nowIso,
        lastInboundAt: null,
        version: 1,
      }
      try {
        await repositories.contactos.crear(contact)
      } catch (error) {
        if ((error as { code?: string })?.code === 'P2002') continue
        throw error
      }
    }
    if (contact.linkedAccountId && contact.linkedAccountId !== input.accountId) return 'conflicto'
    if (contact.linkedAccountId === input.accountId && contact.linkedTenantId === input.tenantId) return 'ya_vinculado'
    const next: ContactoWhatsapp = {
      ...contact,
      linkedAccountId: input.accountId,
      linkedTenantId: input.tenantId,
      linkedAt: nowIso,
      version: contact.version + 1,
    }
    // Optimistic version check: of two accounts racing for one wa_id, only one update lands.
    if (!(await repositories.contactos.actualizar(next, contact.version))) continue
    await auditar('whatsapp.linked', next, { tenantId: input.tenantId, origin: 'phone_verification' })
    if (!(await repositories.consentimientosWhatsapp.buscar(input.tenantId, 'customer', next.waId)))
      await repositories.consentimientosWhatsapp.guardar(
        crearConsentimientoWhatsApp({
          tenantId: input.tenantId,
          recipientType: 'customer',
          recipientId: next.waId,
          source: WHATSAPP_CONSENT_ORIGINS.WHATSAPP_INBOUND,
          now: input.now,
        })
      )
    // A number change must not leave the account linked to the number it just gave up.
    if (input.telefonoAnterior)
      for (const other of await repositories.contactos.vinculadosA(input.accountId)) {
        if (other.contactId === next.contactId || telefonoDesdeWaId(other.waId) !== input.telefonoAnterior) continue
        if (!(await repositories.contactos.actualizar({ ...other, linkedAccountId: null, linkedTenantId: null, linkedAt: null, version: other.version + 1 }, other.version))) continue
        await auditar('whatsapp.unlinked', other, { reason: 'phone_changed' })
      }
    return 'vinculado'
  }
  return 'conflicto'
}

// What the identity module sees of the assistant's contacts, over the repositories of ONE
// transaction (or the plain client for reads).
export function crearPuenteAsistente(repositories: RepositoriosAsistente) {
  return {
    vincular: (entrada: EntradaVinculoPorVerificacion) => vincularContactoPorVerificacion(repositories, entrada),
    waIdVinculado: async (accountId: string): Promise<string | null> =>
      (await repositories.contactos.vinculadosA(accountId)).find((contact) => (contact.channel ?? 'whatsapp') === 'whatsapp')?.waId ?? null,
  }
}
