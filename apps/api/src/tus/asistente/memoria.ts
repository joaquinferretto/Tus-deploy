import type {
  ConfirmacionAsistente,
  ContactoWhatsapp,
  ConversacionWhatsapp,
  EventoAuditoriaAsistente,
  MensajeConversacion,
  TokenVinculacion,
  TrabajoConversacion,
} from './modelo.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from './puertos.ts'

// In-memory adapters with PostgreSQL semantics (unique wamid, one queued job per conversation,
// conditional single-use tokens, serialized transactions with rollback).
export interface EstadoAsistenteEnMemoria {
  contactos: Map<string, ContactoWhatsapp>
  conversaciones: Map<string, ConversacionWhatsapp>
  mensajes: Map<string, MensajeConversacion>
  cola: Map<string, TrabajoConversacion>
  tokens: Map<string, TokenVinculacion>
  confirmaciones: Map<string, ConfirmacionAsistente>
  auditoria: EventoAuditoriaAsistente[]
}

const unique = () => Object.assign(new Error('unique violation'), { code: 'P2002' })

export class AlmacenAsistenteEnMemoria {
  state: EstadoAsistenteEnMemoria = {
    contactos: new Map(),
    conversaciones: new Map(),
    mensajes: new Map(),
    cola: new Map(),
    tokens: new Map(),
    confirmaciones: new Map(),
    auditoria: [],
  }

  repositorios(): RepositoriosAsistente {
    const s = () => this.state
    const clone = <T>(value: T): T => (value === null || value === undefined ? value : structuredClone(value))
    const byTime = (a: MensajeConversacion, b: MensajeConversacion) =>
      (a.externalTimestamp ?? a.createdAt).localeCompare(b.externalTimestamp ?? b.createdAt) || a.createdAt.localeCompare(b.createdAt)
    return {
      contactos: {
        buscarPorWaId: async (waId) => clone([...s().contactos.values()].find((c) => c.waId === waId) ?? null),
        buscar: async (id) => clone(s().contactos.get(id) ?? null),
        crear: async (value) => {
          if ([...s().contactos.values()].some((c) => c.waId === value.waId)) throw unique()
          s().contactos.set(value.contactId, clone(value))
        },
        actualizar: async (value, expected) => {
          const current = s().contactos.get(value.contactId)
          if (!current || current.version !== expected) return false
          s().contactos.set(value.contactId, clone(value))
          return true
        },
        vinculadosA: async (accountId) => [...s().contactos.values()].filter((c) => c.linkedAccountId === accountId).map(clone),
      },
      conversaciones: {
        activaDeContacto: async (contactId) =>
          clone([...s().conversaciones.values()].find((c) => c.contactId === contactId && c.status === 'active') ?? null),
        buscar: async (id) => clone(s().conversaciones.get(id) ?? null),
        crear: async (value) => {
          if (value.status === 'active' && [...s().conversaciones.values()].some((c) => c.contactId === value.contactId && c.status === 'active')) throw unique()
          s().conversaciones.set(value.conversationId, clone(value))
        },
        actualizar: async (value, expected) => {
          const current = s().conversaciones.get(value.conversationId)
          if (!current || current.version !== expected) return false
          s().conversaciones.set(value.conversationId, clone(value))
          return true
        },
        listar: async (filter) =>
          [...s().conversaciones.values()]
            .filter((c) => !filter.mode || c.mode === filter.mode)
            .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
            .slice(0, filter.limit ?? 100)
            .map(clone),
      },
      mensajes: {
        buscarPorWamid: async (wamid) => clone([...s().mensajes.values()].find((m) => m.wamid === wamid) ?? null),
        buscar: async (id) => clone(s().mensajes.get(id) ?? null),
        crear: async (value) => {
          if (s().mensajes.has(value.messageId)) throw unique()
          if (value.wamid && [...s().mensajes.values()].some((m) => m.wamid === value.wamid)) throw unique()
          s().mensajes.set(value.messageId, clone(value))
        },
        actualizar: async (value) => {
          if (value.wamid && [...s().mensajes.values()].some((m) => m.wamid === value.wamid && m.messageId !== value.messageId)) throw unique()
          s().mensajes.set(value.messageId, clone(value))
        },
        pendientes: async (conversationId) =>
          [...s().mensajes.values()]
            .filter((m) => m.conversationId === conversationId && m.direction === 'inbound' && m.status === 'received')
            .sort(byTime)
            .map(clone),
        ultimos: async (conversationId, limit) =>
          [...s().mensajes.values()]
            .filter((m) => m.conversationId === conversationId && m.status !== 'rate_limited')
            .sort(byTime)
            .slice(-limit)
            .map(clone),
        contar: async (conversationId) => [...s().mensajes.values()].filter((m) => m.conversationId === conversationId).length,
        contarEntrantesDesde: async (contactId, since) =>
          [...s().mensajes.values()].filter((m) => m.contactId === contactId && m.direction === 'inbound' && m.createdAt >= since).length,
      },
      cola: {
        encolar: async (input) => {
          const queued = [...s().cola.values()].find((j) => j.conversationId === input.conversationId && j.status === 'queued')
          if (queued) {
            if (input.availableAt > queued.availableAt) s().cola.set(queued.jobId, { ...queued, availableAt: input.availableAt, updatedAt: input.now })
            return
          }
          s().cola.set(input.jobId, {
            jobId: input.jobId,
            conversationId: input.conversationId,
            status: 'queued',
            availableAt: input.availableAt,
            leaseOwner: null,
            leaseUntil: null,
            attempts: 0,
            lastError: null,
            correlationId: input.correlationId,
            createdAt: input.now,
            updatedAt: input.now,
          })
        },
        tomarSiguiente: async (input) => {
          const liveLease = (job: TrabajoConversacion) => job.status === 'leased' && job.leaseUntil !== null && job.leaseUntil >= input.now
          const busy = new Set([...s().cola.values()].filter(liveLease).map((j) => j.conversationId))
          const candidate = [...s().cola.values()]
            .filter(
              (j) =>
                !busy.has(j.conversationId) &&
                ((j.status === 'queued' && j.availableAt <= input.now) || (j.status === 'leased' && !liveLease(j)))
            )
            .sort((a, b) => a.availableAt.localeCompare(b.availableAt) || a.jobId.localeCompare(b.jobId))[0]
          if (!candidate) return null
          const leased: TrabajoConversacion = { ...candidate, status: 'leased', leaseOwner: input.owner, leaseUntil: input.leaseUntil, attempts: candidate.attempts + 1, updatedAt: input.now }
          s().cola.set(leased.jobId, leased)
          return clone(leased)
        },
        actualizar: async (job, owner) => {
          const current = s().cola.get(job.jobId)
          if (!current || current.leaseOwner !== owner) return false
          s().cola.set(job.jobId, clone(job))
          return true
        },
        contarPendientes: async () => [...s().cola.values()].filter((j) => j.status !== 'done').length,
      },
      tokens: {
        crear: async (value) => {
          if ([...s().tokens.values()].some((t) => t.tokenHash === value.tokenHash)) throw unique()
          s().tokens.set(value.tokenId, clone(value))
        },
        buscarPorHash: async (hash) => clone([...s().tokens.values()].find((t) => t.tokenHash === hash) ?? null),
        consumir: async (input) => {
          const token = s().tokens.get(input.tokenId)
          if (!token || token.usedAt || token.expiresAt <= input.now) return false
          s().tokens.set(input.tokenId, { ...token, usedAt: input.now, usedByAccountId: input.accountId })
          return true
        },
      },
      confirmaciones: {
        crear: async (value) => {
          s().confirmaciones.set(value.confirmationId, clone(value))
        },
        buscar: async (id) => clone(s().confirmaciones.get(id) ?? null),
        actualizar: async (value, expected) => {
          const current = s().confirmaciones.get(value.confirmationId)
          if (!current || current.status !== expected) return false
          s().confirmaciones.set(value.confirmationId, clone(value))
          return true
        },
      },
      auditoria: {
        registrar: async (event) => {
          s().auditoria.push(clone(event))
        },
      },
    }
  }
}

export class TransaccionAsistenteEnMemoria implements PuertoTransaccionAsistente {
  private tail: Promise<void> = Promise.resolve()

  constructor(readonly store: AlmacenAsistenteEnMemoria) {}

  async ejecutar<T>(operation: (repositories: RepositoriosAsistente) => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    const before = structuredClone(this.store.state)
    try {
      return await operation(this.store.repositorios())
    } catch (error) {
      this.store.state = before
      throw error
    } finally {
      release()
    }
  }
}
