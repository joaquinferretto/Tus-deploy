import { createHash, randomUUID } from 'node:crypto'

import type { EmbeddingProvider } from './conocimiento.ts'
import { limpiarParaMemoria, type CanalConversacion, type MensajeConversacion } from './modelo.ts'

// MEMORIA-01 (phase 4). Semantic memory: old conversations of ONE account that are related to
// what the person is asking now. Not every message is a vector: a FRAGMENT is a coherent stretch
// of a conversation (several messages), cleaned of personal identifiers and secrets before it is
// stored or embedded, and it keeps its origin (account, conversation, channel, message range).
//
// Every search starts from the account the BACKEND resolved and is restricted to it in the query
// itself, before the similarity ordering: there is no global search that is filtered afterwards.
// A memory is context for understanding a reference; it is never an authority over the real state.

export interface FragmentoMemoria {
  fragmentId: string
  accountId: string
  conversationId: string
  channel: CanalConversacion
  fromSequence: number
  throughSequence: number
  text: string
  checksum: string
  createdAt: string
  expiresAt: string | null
}

export interface ResultadoMemoria {
  fragment: FragmentoMemoria
  // Cosine similarity, 0..1.
  score: number
}

export interface PuertoIndiceMemoria {
  // 'existente': that stretch of that conversation was already stored (nothing is written).
  guardar(fragment: FragmentoMemoria, vector: number[], embedding: { model: string; version: string }): Promise<'guardado' | 'existente'>
  // The fragments of THAT account closest to the vector, best first. Never another account's.
  buscar(input: { accountId: string; vector: number[]; embeddingVersion: string; limit: number; now: string }): Promise<ResultadoMemoria[]>
  deCuenta(accountId: string): Promise<FragmentoMemoria[]>
  // Deletes fragments of THAT account WITH their vectors: all of them, those of one conversation,
  // or those of one conversation that end after a sequence. Returns how many.
  eliminar(input: { accountId: string; conversationId?: string; afterSequence?: number }): Promise<number>
  // Deletes what expired, with its vectors.
  eliminarVencidos(now: string): Promise<number>
  // The (account, conversation) pairs that have fragments: what the retention checks.
  origenes(limit: number): Promise<{ accountId: string; conversationId: string }[]>
}

export interface LimitesMemoriaSemantica {
  // Few, relevant memories.
  topK: number
  // Below this similarity a fragment is not a memory of what is being asked.
  minScore: number
  // Characters of one fragment (several messages).
  maxFragmento: number
  // Characters of one message inside a fragment.
  maxMensaje: number
  // Characters of one memory inside the context.
  maxRecuerdo: number
  // How long a fragment lives. After that it is not returned and the retention deletes it.
  retencionMs: number
}

export const LIMITES_MEMORIA_POR_DEFECTO: LimitesMemoriaSemantica = { topK: 3, minScore: 0.35, maxFragmento: 900, maxMensaje: 320, maxRecuerdo: 420, retencionMs: 365 * 24 * 60 * 60 * 1000 }

export const VERSION_INDICE_MEMORIA = 'memoria-tus-v1'

const checksum = (text: string): string => createHash('sha256').update(text).digest('hex')

// Consecutive messages become fragments of at most `maxFragmento` characters, cut at message
// boundaries. Every line is cleaned first: what is not allowed in memory never reaches a vector.
export function fragmentarConversacion(mensajes: readonly MensajeConversacion[], limits: Pick<LimitesMemoriaSemantica, 'maxFragmento' | 'maxMensaje'> = LIMITES_MEMORIA_POR_DEFECTO): { fromSequence: number; throughSequence: number; text: string }[] {
  const fragmentos: { fromSequence: number; throughSequence: number; text: string }[] = []
  let actual: { fromSequence: number; throughSequence: number; lineas: string[]; largo: number } | null = null
  for (const mensaje of mensajes) {
    if (!mensaje.text || mensaje.sequence === undefined) continue
    const limpio = limpiarParaMemoria(mensaje.text).replace(/\s+/gu, ' ').trim().slice(0, limits.maxMensaje)
    if (!limpio) continue
    const linea = `${mensaje.direction === 'inbound' ? 'Usuario' : 'TUS'}: ${limpio}`
    if (actual && actual.largo + linea.length + 1 > limits.maxFragmento) {
      fragmentos.push({ fromSequence: actual.fromSequence, throughSequence: actual.throughSequence, text: actual.lineas.join('\n') })
      actual = null
    }
    actual ??= { fromSequence: mensaje.sequence, throughSequence: mensaje.sequence, lineas: [], largo: 0 }
    actual.lineas.push(linea)
    actual.largo += linea.length + 1
    actual.throughSequence = mensaje.sequence
  }
  if (actual) fragmentos.push({ fromSequence: actual.fromSequence, throughSequence: actual.throughSequence, text: actual.lineas.join('\n') })
  return fragmentos
}

const coseno = (a: readonly number[], b: readonly number[]): number => {
  let punto = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    punto += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na === 0 || nb === 0 ? 0 : punto / (Math.sqrt(na) * Math.sqrt(nb))
}

// In memory (tests / local composition): the same contract as PostgreSQL, the account first.
export class IndiceMemoriaEnMemoria implements PuertoIndiceMemoria {
  readonly filas: { fragment: FragmentoMemoria; vector: number[]; embeddingVersion: string }[] = []

  async guardar(fragment: FragmentoMemoria, vector: number[], embedding: { model: string; version: string }) {
    if (this.filas.some((fila) => fila.fragment.conversationId === fragment.conversationId && fila.fragment.fromSequence === fragment.fromSequence && fila.fragment.throughSequence === fragment.throughSequence)) return 'existente' as const
    this.filas.push({ fragment: { ...fragment }, vector: [...vector], embeddingVersion: embedding.version })
    return 'guardado' as const
  }

  async buscar(input: { accountId: string; vector: number[]; embeddingVersion: string; limit: number; now: string }) {
    if (!input.accountId) return []
    return this.filas
      .filter((fila) => fila.fragment.accountId === input.accountId && fila.embeddingVersion === input.embeddingVersion && (!fila.fragment.expiresAt || fila.fragment.expiresAt > input.now))
      .map((fila) => ({ fragment: { ...fila.fragment }, score: coseno(fila.vector, input.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit)
  }

  async deCuenta(accountId: string) {
    return this.filas.filter((fila) => fila.fragment.accountId === accountId).map((fila) => ({ ...fila.fragment }))
  }

  private quitar(sobra: (fragment: FragmentoMemoria) => boolean) {
    const antes = this.filas.length
    for (let i = this.filas.length - 1; i >= 0; i -= 1) if (sobra(this.filas[i]!.fragment)) this.filas.splice(i, 1)
    return antes - this.filas.length
  }

  async eliminar(input: { accountId: string; conversationId?: string; afterSequence?: number }) {
    if (!input.accountId) return 0
    return this.quitar((f) => f.accountId === input.accountId && (input.conversationId === undefined || f.conversationId === input.conversationId) && (input.afterSequence === undefined || f.throughSequence > input.afterSequence))
  }

  async eliminarVencidos(now: string) {
    return this.quitar((f) => f.expiresAt !== null && f.expiresAt <= now)
  }

  async origenes(limit: number) {
    const pares = new Map<string, { accountId: string; conversationId: string }>()
    for (const fila of this.filas) pares.set(`${fila.fragment.accountId}|${fila.fragment.conversationId}`, { accountId: fila.fragment.accountId, conversationId: fila.fragment.conversationId })
    return [...pares.values()].slice(0, limit)
  }
}

export interface RecuperacionMemoria {
  // Ready for the context, best first.
  recuerdos: string[]
  candidatos: number
  descartados: number
  ms: number
}

const SIN_RECUERDOS: RecuperacionMemoria = { recuerdos: [], candidatos: 0, descartados: 0, ms: 0 }

export class ServicioMemoriaSemantica {
  private readonly limits: LimitesMemoriaSemantica

  constructor(
    private readonly indice: PuertoIndiceMemoria,
    private readonly embeddings: EmbeddingProvider,
    limits: Partial<LimitesMemoriaSemantica> = {},
    private readonly now: () => number = Date.now,
    private readonly metric: (name: string, fields: Record<string, string | number | boolean>) => void = () => {}
  ) {
    this.limits = { ...LIMITES_MEMORIA_POR_DEFECTO, ...limits }
  }

  // Messages that left the recent window become memories of the account. Idempotent: the same
  // stretch of the same conversation is stored once. Returns how many fragments were stored.
  async recordar(input: { accountId: string; conversationId: string; channel: CanalConversacion; mensajes: readonly MensajeConversacion[] }): Promise<number> {
    if (!input.accountId) return 0
    const fragmentos = fragmentarConversacion(input.mensajes, this.limits)
    if (fragmentos.length === 0) return 0
    try {
      const vectores = await this.embeddings.embed(fragmentos.map((fragmento) => fragmento.text))
      let guardados = 0
      for (const [indice, fragmento] of fragmentos.entries()) {
        const vector = vectores[indice]
        if (!vector) continue
        const resultado = await this.indice.guardar(
          { fragmentId: `fragmento-memoria-${randomUUID()}`, accountId: input.accountId, conversationId: input.conversationId, channel: input.channel, fromSequence: fragmento.fromSequence, throughSequence: fragmento.throughSequence, text: fragmento.text, checksum: checksum(fragmento.text), createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + this.limits.retencionMs).toISOString() },
          vector,
          { model: this.embeddings.model, version: this.embeddings.version }
        )
        if (resultado === 'guardado') guardados += 1
      }
      this.metric('assistant.memory_stored', { channel: input.channel, fragments: guardados, skipped: fragmentos.length - guardados })
      return guardados
    } catch {
      // Best effort: a memory that could not be stored now is rebuilt from the messages later.
      this.metric('assistant.memory_error', { stage: 'store' })
      return 0
    }
  }

  // 1. the account (resolved by the backend)  2. only its fragments  3. similarity
  // 4. threshold  5. a few results. No account: no memory.
  // `conversaciones`: the conversations that belong to the account NOW. A fragment of any other
  // (a WhatsApp that was unlinked since) is not a memory of this account any more.
  async recuperar(input: { accountId: string | null; consulta: string; conversaciones?: ReadonlySet<string> }): Promise<RecuperacionMemoria> {
    if (!input.accountId) return SIN_RECUERDOS
    const consulta = limpiarParaMemoria(input.consulta).trim()
    if (consulta.length < 3) return SIN_RECUERDOS
    const inicio = this.now()
    try {
      const [vector] = await this.embeddings.embed([consulta])
      if (!vector) return SIN_RECUERDOS
      const candidatos = await this.indice.buscar({ accountId: input.accountId, vector, embeddingVersion: this.embeddings.version, limit: this.limits.topK, now: new Date(this.now()).toISOString() })
      // Defence in depth: whatever the store returned, nothing of another account goes on.
      const propios = candidatos.filter((resultado) => resultado.fragment.accountId === input.accountId && (!input.conversaciones || input.conversaciones.has(resultado.fragment.conversationId)))
      const relevantes = propios.filter((resultado) => resultado.score >= this.limits.minScore)
      const recuperacion: RecuperacionMemoria = {
        recuerdos: relevantes.map((resultado) => `[${resultado.fragment.createdAt.slice(0, 10)}, ${resultado.fragment.channel === 'web' ? 'Web' : 'WhatsApp'}] ${resultado.fragment.text.replace(/\n/gu, ' / ').slice(0, this.limits.maxRecuerdo)}`),
        candidatos: propios.length,
        descartados: propios.length - relevantes.length,
        ms: this.now() - inicio,
      }
      this.metric('assistant.memory_retrieved', { retrieved: relevantes.length, discarded: recuperacion.descartados, ms: recuperacion.ms })
      return recuperacion
    } catch {
      // The memory failing never breaks the turn: the recent window and the tools remain.
      this.metric('assistant.memory_error', { stage: 'retrieve' })
      return SIN_RECUERDOS
    }
  }
}
