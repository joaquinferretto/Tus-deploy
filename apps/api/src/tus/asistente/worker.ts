import { randomUUID } from 'node:crypto'
import type { OrquestadorConversacion } from './orquestador.ts'
import type { PuertoTransaccionAsistente } from './puertos.ts'

// Persistent conversation queue consumer. One job per conversation at a time (the lease query
// skips conversations with a live lease), so two quick messages never produce two parallel,
// out-of-order answers. A crashed worker leaves the job leased until `leaseUntil`; then any
// worker retakes it and the inbound messages (still `received`) are processed again.
export class WorkerConversacionesWhatsapp {
  readonly owner: string

  constructor(
    private readonly transaction: PuertoTransaccionAsistente,
    private readonly orchestrator: OrquestadorConversacion,
    private readonly options: {
      leaseMs?: number
      maxAttempts?: number
      now?: () => number
      owner?: string
      log?: (event: string, fields: Record<string, unknown>) => void
    } = {}
  ) {
    this.owner = options.owner ?? `whatsapp-worker-${randomUUID()}`
  }

  private get now() {
    return this.options.now ?? Date.now
  }

  async procesarSiguiente(): Promise<
    { outcome: 'idle' } | { outcome: string; conversationId: string }
  > {
    const nowIso = new Date(this.now()).toISOString()
    const job = await this.transaction.ejecutar((repositories) =>
      repositories.cola.tomarSiguiente({
        owner: this.owner,
        now: nowIso,
        leaseUntil: new Date(this.now() + (this.options.leaseMs ?? 120_000)).toISOString(),
      })
    )
    if (!job) return { outcome: 'idle' }
    try {
      const outcome = await this.orchestrator.procesar(job.conversationId, job.correlationId)
      await this.transaction.ejecutar((repositories) =>
        repositories.cola.actualizar(
          {
            ...job,
            status: 'done',
            leaseUntil: null,
            lastError: null,
            updatedAt: new Date(this.now()).toISOString(),
          },
          this.owner
        )
      )
      this.options.log?.('whatsapp.turn', { outcome, correlationId: job.correlationId })
      return { outcome, conversationId: job.conversationId }
    } catch (error) {
      const exhausted = job.attempts >= (this.options.maxAttempts ?? 3)
      await this.transaction.ejecutar((repositories) =>
        repositories.cola.actualizar(
          {
            ...job,
            status: exhausted ? 'done' : 'queued',
            leaseOwner: exhausted ? job.leaseOwner : null,
            leaseUntil: null,
            availableAt: new Date(this.now() + 30_000 * job.attempts).toISOString(),
            lastError: error instanceof Error ? error.name : 'Error',
            updatedAt: new Date(this.now()).toISOString(),
          },
          this.owner
        )
      )
      this.options.log?.('whatsapp.turn_failed', { exhausted, correlationId: job.correlationId })
      if (exhausted)
        await this.orchestrator.derivar(job.conversationId, 'processing_failed', job.correlationId)
      return {
        outcome: exhausted ? 'handoff_after_failure' : 'retry_scheduled',
        conversationId: job.conversationId,
      }
    }
  }

  async ejecutar(options: { signal: AbortSignal; idleMs?: number }) {
    while (!options.signal.aborted) {
      let result: Awaited<ReturnType<WorkerConversacionesWhatsapp['procesarSiguiente']>>
      try {
        result = await this.procesarSiguiente()
      } catch {
        result = { outcome: 'idle' }
      }
      if (result.outcome === 'idle')
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, options.idleMs ?? 1_000)
          options.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true }
          )
        })
    }
  }
}
