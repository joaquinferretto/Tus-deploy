import { randomUUID } from 'node:crypto'

import type { PuertoHechos } from './hechos.ts'
import { contactosDeCuenta, cuentaDeContacto } from './historial.ts'
import type { PuertoIndiceMemoria } from './memoria-semantica.ts'
import { ErrorAsistente, type ConversacionWhatsapp } from './modelo.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from './puertos.ts'

// MEMORIA-01 (phase 8). The life cycle of the memory. Everything the memory holds is derived from
// messages, in this chain:
//
//   message -> summary -> fragment -> embedding -> fact
//
// Deleting a link of the chain deletes what was derived from it, so nothing is left pointing at
// content that no longer exists. Every operation starts from an account the BACKEND resolved and
// only ever touches what belongs to it; a conversation or a message of somebody else is "not
// found". All of them are idempotent: an operation that failed halfway is simply run again.
//
// The row of a deleted message stays (its sequence, direction and date keep the order of the
// conversation and the references of the business intact) but its CONTENT is gone.

export interface ResultadoBorradoMemoria {
  messages: number
  summaries: number
  fragments: number
  facts: number
}

export interface ResultadoDepuracion {
  // Fragments past their expiry.
  expired: number
  // Fragments of a conversation that no longer belongs to the account they were stored for.
  orphaned: number
  // Facts invalidated or expired long ago.
  facts: number
}

// An invalidated or expired fact is kept this long (history, provenance) and then deleted.
export const RETENCION_HECHOS_INACTIVOS_MS = 30 * 24 * 60 * 60 * 1000
const PAGINA_BORRADO = 200
const MAXIMO_PAGINAS_BORRADO = 500
const MAXIMO_ORIGENES_DEPURACION = 1000

const NADA: ResultadoBorradoMemoria = { messages: 0, summaries: 0, fragments: 0, facts: 0 }
const sumar = (a: ResultadoBorradoMemoria, b: ResultadoBorradoMemoria): ResultadoBorradoMemoria => ({ messages: a.messages + b.messages, summaries: a.summaries + b.summaries, fragments: a.fragments + b.fragments, facts: a.facts + b.facts })

export class ServicioCicloDeVidaMemoria {
  constructor(
    private readonly deps: {
      transaction: PuertoTransaccionAsistente
      indice: PuertoIndiceMemoria | null
      hechos: PuertoHechos | null
      now?: () => number
      metric?: (name: string, fields: Record<string, string | number | boolean>) => void
      retencionHechosInactivosMs?: number
    }
  ) {}

  private get now() {
    return this.deps.now ?? Date.now
  }

  private iso() {
    return new Date(this.now()).toISOString()
  }

  // The conversation, only when it belongs to that account NOW.
  private async propia(repositories: RepositoriosAsistente, accountId: string, conversationId: string): Promise<ConversacionWhatsapp> {
    const conversation = accountId ? await repositories.conversaciones.buscar(conversationId) : null
    const contact = conversation ? await repositories.contactos.buscar(conversation.contactId) : null
    if (!conversation || !contact || cuentaDeContacto(contact) !== accountId) throw new ErrorAsistente(404, 'NOT_FOUND', 'conversation was not found')
    return conversation
  }

  // The summaries that reach `desde` (all of them when null) are deleted; the copy the
  // conversation keeps follows the newest version that is left.
  private async quitarResumenes(repositories: RepositoriosAsistente, conversationId: string, desde: number | null): Promise<{ eliminados: number; cubierto: number }> {
    const eliminados = await repositories.resumenes.eliminar(conversationId, desde)
    const vigente = await repositories.resumenes.vigente(conversationId)
    const conversation = await repositories.conversaciones.buscar(conversationId)
    if (conversation && (eliminados > 0 || (!vigente && conversation.summary)))
      await repositories.conversaciones.actualizar({ ...conversation, summary: vigente?.text ?? null, summaryMessageCount: vigente ? conversation.summaryMessageCount : 0, version: conversation.version + 1 }, conversation.version)
    return { eliminados, cubierto: vigente?.throughSequence ?? 0 }
  }

  private async auditar(repositories: RepositoriosAsistente, action: string, input: { accountId: string; conversation: ConversacionWhatsapp | null; correlationId?: string | undefined; actorId?: string | undefined }, resultado: ResultadoBorradoMemoria) {
    await repositories.auditoria.registrar({
      eventId: `auditoria-asistente-${randomUUID()}`,
      action,
      contactId: input.conversation?.contactId ?? null,
      conversationId: input.conversation?.conversationId ?? null,
      actorId: input.actorId ?? input.accountId,
      correlationId: input.correlationId ?? `memoria-${randomUUID()}`,
      // Quantities only: never content.
      metadata: { ...resultado },
      createdAt: this.iso(),
    })
  }

  // ONE message of the account: its content is removed and so is everything derived from it —
  // the summaries that covered it (the next step rebuilds them from the messages that are left),
  // the fragments of that stretch with their vectors, and the facts it stated.
  async borrarMensaje(input: { accountId: string; messageId: string; correlationId?: string; actorId?: string }): Promise<ResultadoBorradoMemoria> {
    const paso = await this.deps.transaction.ejecutar(async (repositories) => {
      const message = input.accountId ? await repositories.mensajes.buscar(input.messageId) : null
      if (!message) throw new ErrorAsistente(404, 'NOT_FOUND', 'message was not found')
      const conversation = await this.propia(repositories, input.accountId, message.conversationId).catch(() => null)
      if (!conversation) throw new ErrorAsistente(404, 'NOT_FOUND', 'message was not found')
      const yaBorrado = message.text === null && message.metadata['deleted'] === true
      if (!yaBorrado) await repositories.mensajes.actualizar({ ...message, text: null, metadata: { deleted: true } })
      const resumenes = message.sequence === undefined ? { eliminados: 0, cubierto: 0 } : await this.quitarResumenes(repositories, conversation.conversationId, message.sequence)
      return { conversation, mensajes: yaBorrado ? 0 : 1, resumenes }
    })
    // Every fragment after what the remaining summary covers: that stretch is summarized (and
    // remembered) again from the messages that are left.
    const fragments = (await this.deps.indice?.eliminar({ accountId: input.accountId, conversationId: paso.conversation.conversationId, afterSequence: paso.resumenes.cubierto })) ?? 0
    const facts = (await this.deps.hechos?.eliminarDeOrigen({ accountId: input.accountId, messageId: input.messageId })) ?? 0
    const resultado = { messages: paso.mensajes, summaries: paso.resumenes.eliminados, fragments, facts }
    await this.deps.transaction.ejecutar((repositories) => this.auditar(repositories, 'memory.message_deleted', { ...input, conversation: paso.conversation }, resultado))
    this.deps.metric?.('assistant.memory_deleted', { scope: 'message', ...resultado })
    return resultado
  }

  // ONE conversation of the account: the content of all its messages, its summaries, its
  // fragments with their vectors and the facts that came from it.
  async borrarConversacion(input: { accountId: string; conversationId: string; correlationId?: string; actorId?: string }): Promise<ResultadoBorradoMemoria> {
    const conversation = await this.deps.transaction.ejecutar((repositories) => this.propia(repositories, input.accountId, input.conversationId))
    const resultado = await this.vaciar(input.accountId, conversation)
    await this.deps.transaction.ejecutar((repositories) => this.auditar(repositories, 'memory.conversation_deleted', { ...input, conversation }, resultado))
    this.deps.metric?.('assistant.memory_deleted', { scope: 'conversation', ...resultado })
    return resultado
  }

  private async vaciar(accountId: string, conversation: ConversacionWhatsapp): Promise<ResultadoBorradoMemoria> {
    const conversationId = conversation.conversationId
    let messages = 0
    let after = 0
    // By pages, each in its own transaction: a long conversation never becomes one huge write.
    for (let pagina = 0; pagina < MAXIMO_PAGINAS_BORRADO; pagina += 1) {
      const lote = await this.deps.transaction.ejecutar(async (repositories) => {
        const filas = await repositories.mensajes.posteriores(conversationId, { after, limit: PAGINA_BORRADO })
        let borrados = 0
        for (const message of filas) {
          if (message.text === null && message.metadata['deleted'] === true) continue
          await repositories.mensajes.actualizar({ ...message, text: null, metadata: { deleted: true } })
          borrados += 1
        }
        return { borrados, ultimo: filas.at(-1)?.sequence ?? null, cantidad: filas.length }
      })
      messages += lote.borrados
      if (lote.cantidad < PAGINA_BORRADO || lote.ultimo === null) break
      after = lote.ultimo
    }
    const summaries = (await this.deps.transaction.ejecutar((repositories) => this.quitarResumenes(repositories, conversationId, null))).eliminados
    const fragments = (await this.deps.indice?.eliminar({ accountId, conversationId })) ?? 0
    const facts = (await this.deps.hechos?.eliminarDeOrigen({ accountId, conversationId })) ?? 0
    return { messages, summaries, fragments, facts }
  }

  // The whole account: every conversation it has (Web and linked WhatsApp) and ALL its memory,
  // also the fragments of a WhatsApp that was linked to it before.
  async borrarCuenta(input: { accountId: string; correlationId?: string; actorId?: string }): Promise<ResultadoBorradoMemoria> {
    if (!input.accountId) return NADA
    const conversaciones = await this.deps.transaction.ejecutar(async (repositories) => (await Promise.all((await contactosDeCuenta(repositories, input.accountId)).map((contact) => repositories.conversaciones.deContacto(contact.contactId)))).flat())
    let resultado = NADA
    for (const conversation of conversaciones) resultado = sumar(resultado, await this.vaciar(input.accountId, conversation))
    const resto = await this.olvidarDerivados(input.accountId)
    resultado = sumar(resultado, resto)
    await this.deps.transaction.ejecutar((repositories) => this.auditar(repositories, 'memory.account_deleted', { ...input, conversation: null }, resultado))
    this.deps.metric?.('assistant.memory_deleted', { scope: 'account', ...resultado })
    return resultado
  }

  // What the assistant REMEMBERS of the account beyond its conversations — the fragments with
  // their vectors and the facts — and nothing else: the conversations stay as they are. It is
  // what "olvidá lo que sabés de mí" asks for.
  async olvidarMemoria(input: { accountId: string; correlationId?: string; actorId?: string }): Promise<ResultadoBorradoMemoria> {
    if (!input.accountId) return NADA
    const resultado = await this.olvidarDerivados(input.accountId)
    await this.deps.transaction.ejecutar((repositories) => this.auditar(repositories, 'memory.forgotten', { ...input, conversation: null }, resultado))
    this.deps.metric?.('assistant.memory_deleted', { scope: 'memory', ...resultado })
    return resultado
  }

  private async olvidarDerivados(accountId: string): Promise<ResultadoBorradoMemoria> {
    const fragments = (await this.deps.indice?.eliminar({ accountId })) ?? 0
    const facts = (await this.deps.hechos?.eliminarDeOrigen({ accountId })) ?? 0
    return { messages: 0, summaries: 0, fragments, facts }
  }

  // RETENTION. What expired, what was invalidated long ago and what was stored for an account
  // that no longer owns the conversation (a WhatsApp that was unlinked) is deleted. Bounded and
  // safe to run at any time, by several processes at once.
  async depurar(): Promise<ResultadoDepuracion> {
    const ahora = this.iso()
    const resultado: ResultadoDepuracion = { expired: 0, orphaned: 0, facts: 0 }
    try {
      resultado.expired = (await this.deps.indice?.eliminarVencidos(ahora)) ?? 0
      for (const origen of (await this.deps.indice?.origenes(MAXIMO_ORIGENES_DEPURACION)) ?? []) {
        const vigente = await this.deps.transaction.ejecutar(async (repositories) => {
          const conversation = await repositories.conversaciones.buscar(origen.conversationId)
          const contact = conversation ? await repositories.contactos.buscar(conversation.contactId) : null
          return Boolean(contact && cuentaDeContacto(contact) === origen.accountId)
        })
        if (!vigente) resultado.orphaned += (await this.deps.indice?.eliminar({ accountId: origen.accountId, conversationId: origen.conversationId })) ?? 0
      }
      resultado.facts = (await this.deps.hechos?.depurar(new Date(this.now() - (this.deps.retencionHechosInactivosMs ?? RETENCION_HECHOS_INACTIVOS_MS)).toISOString())) ?? 0
      this.deps.metric?.('assistant.memory_purged', { ...resultado })
    } catch {
      this.deps.metric?.('assistant.memory_error', { stage: 'purge' })
    }
    return resultado
  }
}
