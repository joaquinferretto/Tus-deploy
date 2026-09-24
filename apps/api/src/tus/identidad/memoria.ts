import { BovedaCredencialesAesGcm } from '../finance/servicios/cuentas-cobro.ts'
import type {
  BrowserSessionStore,
  DocumentoIdentidadCifrado,
  EstadoProveedorIdentidad,
  EventoAuditoriaIdentidad,
  PuertoTransaccionIdentidad,
  RepositoriosIdentidad,
  TrabajoIdentidad,
  VerificacionIdentidad,
} from './puertos.ts'

// In-memory adapters with the same semantics as PostgreSQL: a serialized critical section per
// transaction (rollback on error), FIFO lease, sliding window and optimistic versions.
export interface EstadoIdentidadEnMemoria {
  verificaciones: Map<string, VerificacionIdentidad>
  documentos: Map<string, DocumentoIdentidadCifrado>
  cola: Map<string, TrabajoIdentidad>
  consultas: { providerId: string; verificationId: string; consumedAt: string }[]
  proveedores: Map<string, EstadoProveedorIdentidad>
  auditoria: EventoAuditoriaIdentidad[]
}

export class AlmacenIdentidadEnMemoria {
  state: EstadoIdentidadEnMemoria = {
    verificaciones: new Map(),
    documentos: new Map(),
    cola: new Map(),
    consultas: [],
    proveedores: new Map(),
    auditoria: [],
  }

  repositorios(): RepositoriosIdentidad {
    const state = () => this.state
    const clone = <T>(value: T): T =>
      value === null || value === undefined ? value : structuredClone(value)
    return {
      verificaciones: {
        crear: async (value) => {
          if (state().verificaciones.has(value.verificationId))
            throw Object.assign(new Error('unique'), { code: 'P2002' })
          state().verificaciones.set(value.verificationId, clone(value))
        },
        buscar: async (id) => clone(state().verificaciones.get(id) ?? null),
        ultimaDeTenant: async (tenantId) =>
          clone(
            [...state().verificaciones.values()]
              .filter((item) => item.tenantId === tenantId)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
          ),
        actualizar: async (value, expectedVersion) => {
          const current = state().verificaciones.get(value.verificationId)
          if (!current || current.version !== expectedVersion) return false
          if (value.status === 'verified') {
            // Mirrors the partial unique indexes on verified DNI/CUIL.
            const clash = [...state().verificaciones.values()].some(
              (item) =>
                item.verificationId !== value.verificationId &&
                item.status === 'verified' &&
                ((value.documentNumber && item.documentNumber === value.documentNumber) ||
                  (value.verifiedCuil && item.verifiedCuil === value.verifiedCuil))
            )
            if (clash) throw Object.assign(new Error('unique verified identity'), { code: 'P2002' })
          }
          state().verificaciones.set(value.verificationId, clone(value))
          return true
        },
        listar: async (filter) =>
          [...state().verificaciones.values()]
            .filter((item) => !filter.status || item.status === filter.status)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, filter.limit ?? 100)
            .map(clone),
        existeVerificadaDeOtro: async (input) =>
          [...state().verificaciones.values()].some(
            (item) =>
              item.tenantId !== input.tenantId &&
              item.status === 'verified' &&
              ((input.documentNumber && item.documentNumber === input.documentNumber) ||
                (input.cuil && item.verifiedCuil === input.cuil))
          ),
        tenantVerificado: async (tenantId) =>
          [...state().verificaciones.values()].some(
            (item) => item.tenantId === tenantId && item.status === 'verified'
          ),
      },
      documentos: {
        guardar: async (value) => {
          state().documentos.set(`${value.verificationId}:${value.side}`, clone(value))
        },
        leer: async (id, side) => clone(state().documentos.get(`${id}:${side}`) ?? null),
      },
      cola: {
        encolar: async (job) => {
          const active = [...state().cola.values()].some(
            (item) =>
              item.verificationId === job.verificationId &&
              (item.status === 'queued' || item.status === 'leased')
          )
          if (active || state().cola.has(job.jobId))
            throw Object.assign(new Error('unique active job'), { code: 'P2002' })
          state().cola.set(job.jobId, clone(job))
        },
        tomarSiguiente: async (input) => {
          const now = Date.parse(input.now)
          const candidate = [...state().cola.values()]
            .filter(
              (job) =>
                input.stages.includes(job.stage) &&
                Date.parse(job.availableAt) <= now &&
                (job.status === 'queued' ||
                  (job.status === 'leased' &&
                    job.leaseUntil !== null &&
                    Date.parse(job.leaseUntil) < now))
            )
            .sort(
              (a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.jobId.localeCompare(b.jobId)
            )[0]
          if (!candidate) return null
          const leased: TrabajoIdentidad = {
            ...candidate,
            status: 'leased',
            leaseOwner: input.owner,
            leaseUntil: input.leaseUntil,
            updatedAt: input.now,
          }
          state().cola.set(leased.jobId, leased)
          return clone(leased)
        },
        actualizar: async (job, owner) => {
          const current = state().cola.get(job.jobId)
          if (!current || current.leaseOwner !== owner) return false
          state().cola.set(job.jobId, clone(job))
          return true
        },
        buscarActivo: async (id) =>
          clone(
            [...state().cola.values()].find(
              (job) =>
                job.verificationId === id && (job.status === 'queued' || job.status === 'leased')
            ) ?? null
          ),
        contarPendientes: async () =>
          [...state().cola.values()].filter(
            (job) => job.status === 'queued' || job.status === 'leased'
          ).length,
      },
      limite: {
        reservar: async (input) => {
          const usage = uso(state().consultas, input)
          if (usage.used >= input.max) return { granted: false, ...usage }
          state().consultas.push({
            providerId: input.providerId,
            verificationId: input.verificationId,
            consumedAt: input.now,
          })
          return { granted: true, ...uso(state().consultas, input) }
        },
        uso: async (input) => uso(state().consultas, input),
      },
      estadoProveedor: {
        leer: async (providerId) =>
          clone(
            state().proveedores.get(providerId) ?? {
              providerId,
              status: 'running',
              consecutiveErrors: 0,
              reason: null,
              version: 0,
              updatedAt: new Date(0).toISOString(),
            }
          ),
        guardar: async (value, expectedVersion) => {
          const current = state().proveedores.get(value.providerId)
          if ((current?.version ?? 0) !== expectedVersion) return false
          state().proveedores.set(value.providerId, clone(value))
          return true
        },
      },
      auditoria: {
        registrar: async (event) => {
          state().auditoria.push(clone(event))
        },
      },
    }
  }
}

export function uso(
  consultas: { providerId: string; consumedAt: string }[],
  input: { providerId: string; max: number; windowMs: number; now: string }
): { used: number; nextEligibleAt: string | null } {
  const now = Date.parse(input.now)
  const inWindow = consultas
    .filter((item) => item.providerId === input.providerId)
    .map((item) => Date.parse(item.consumedAt))
    .filter((time) => time > now - input.windowMs && time <= now)
    .sort((a, b) => a - b)
  const used = inWindow.length
  if (used < input.max) return { used, nextEligibleAt: null }
  // Capacity returns when the oldest search that keeps the window full leaves it.
  const oldestBlocking = inWindow[used - input.max]!
  return { used, nextEligibleAt: new Date(oldestBlocking + input.windowMs + 1).toISOString() }
}

export class TransaccionIdentidadEnMemoria implements PuertoTransaccionIdentidad {
  private tail: Promise<void> = Promise.resolve()

  constructor(readonly store: AlmacenIdentidadEnMemoria) {}

  async ejecutar<T>(operation: (repositories: RepositoriosIdentidad) => Promise<T>): Promise<T> {
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

// Encrypted session state (AES-256-GCM with TUS_NOSIS_SESSION_KEY, AAD bound to the provider).
export class SesionNavegadorCifrada implements BrowserSessionStore {
  constructor(
    private readonly boveda: BovedaCredencialesAesGcm,
    private readonly backend: {
      leer(providerId: string): Promise<{ ciphertext: string; keyVersion: string } | null>
      guardar(providerId: string, value: { ciphertext: string; keyVersion: string }): Promise<void>
      borrar(providerId: string): Promise<void>
    }
  ) {}

  async leer(providerId: string): Promise<string | null> {
    const stored = await this.backend.leer(providerId)
    return stored ? this.boveda.descifrar(stored.ciphertext, `browser-session:${providerId}`) : null
  }

  async guardar(providerId: string, plaintextState: string): Promise<void> {
    await this.backend.guardar(providerId, {
      ciphertext: this.boveda.cifrar(plaintextState, `browser-session:${providerId}`),
      keyVersion: this.boveda.keyVersion,
    })
  }

  async borrar(providerId: string): Promise<void> {
    await this.backend.borrar(providerId)
  }
}

export class BackendSesionEnMemoria {
  readonly rows = new Map<string, { ciphertext: string; keyVersion: string }>()
  async leer(providerId: string) {
    return this.rows.get(providerId) ?? null
  }
  async guardar(providerId: string, value: { ciphertext: string; keyVersion: string }) {
    this.rows.set(providerId, value)
  }
  async borrar(providerId: string) {
    this.rows.delete(providerId)
  }
}
