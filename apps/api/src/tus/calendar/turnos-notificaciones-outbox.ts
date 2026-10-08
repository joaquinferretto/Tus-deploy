import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'

export const AGREGADO_NOTIFICACION_TURNO = 'turno-notification'

export type EventoNotificacionTurno =
  | { kind: 'solicitud_recibida'; reservaId: string }
  | { kind: 'solicitud_respondida'; reservaId: string; resultado: 'awaiting_payment' | 'confirmed' | 'rejected' }
  | { kind: 'turno_confirmado'; reservaId: string }
  | { kind: 'turno_cancelado'; reservaId: string; canceladoPor: 'cliente' | 'prestador' | 'administracion' }
  // CIERRE-TRABAJO-01 / PAGOS-MODALIDAD-01: the provider finished the turno (the client has to
  // confirm it), and its balance can be paid now.
  | { kind: 'turno_finalizado'; reservaId: string }
  | { kind: 'saldo_habilitado'; reservaId: string }

type ClienteOutbox = PrismaClient | Prisma.TransactionClient

const esP2002 = (error: unknown): boolean => String((error as { code?: unknown })?.code ?? '') === 'P2002'

function esEvento(value: unknown): value is EventoNotificacionTurno {
  if (!value || typeof value !== 'object') return false
  const evento = value as Record<string, unknown>
  if (typeof evento['reservaId'] !== 'string') return false
  if (evento['kind'] === 'solicitud_recibida' || evento['kind'] === 'turno_confirmado' || evento['kind'] === 'turno_finalizado' || evento['kind'] === 'saldo_habilitado') return true
  if (evento['kind'] === 'solicitud_respondida') return ['awaiting_payment', 'confirmed', 'rejected'].includes(String(evento['resultado']))
  return evento['kind'] === 'turno_cancelado' && ['cliente', 'prestador', 'administracion'].includes(String(evento['canceladoPor']))
}

/** Durable outbox for appointment notices. The event contains IDs and state only: recipient
 * addresses are always resolved by the backend while delivering it. */
export class OutboxNotificacionesTurnos {
  private procesamiento: Promise<number> | null = null

  constructor(
    private readonly prisma: PrismaClient,
    private readonly entregar: (evento: EventoNotificacionTurno) => Promise<void>,
    private readonly now: () => number = Date.now
  ) {}

  async encolar(db: ClienteOutbox, input: { tenantId: string; reservaId: string; version: number; evento: EventoNotificacionTurno }): Promise<void> {
    const eventType = `turno.${input.evento.kind}`
    try {
      await db.outboxEvent.create({
        data: {
          id: `turno-notification:${input.evento.kind}:${input.reservaId}:${input.version}`,
          tenantId: input.tenantId,
          aggregateType: AGREGADO_NOTIFICACION_TURNO,
          aggregateId: input.reservaId,
          eventType,
          payload: input.evento,
          status: 'pending',
          attempts: 0,
          availableAt: new Date(this.now()),
          createdAt: new Date(this.now()),
        },
      })
    } catch (error) {
      // Same transition/callback twice is the same notification, not a second delivery.
      if (!esP2002(error)) throw error
    }
  }

  async procesarPendientes(limit = 20): Promise<number> {
    if (this.procesamiento) return this.procesamiento
    const actual = this.drenar(limit).finally(() => {
      if (this.procesamiento === actual) this.procesamiento = null
    })
    this.procesamiento = actual
    return actual
  }

  private async drenar(limit: number): Promise<number> {
    const ahora = this.now()
    await this.prisma.outboxEvent.updateMany({
      where: { aggregateType: AGREGADO_NOTIFICACION_TURNO, status: 'processing', claimUntil: { lte: new Date(ahora) } },
      data: { status: 'pending', claimId: null, claimUntil: null, availableAt: new Date(ahora) },
    })
    let procesados = 0
    while (procesados < limit) {
      const candidato = await this.prisma.outboxEvent.findFirst({
        where: { aggregateType: AGREGADO_NOTIFICACION_TURNO, status: 'pending', availableAt: { lte: new Date(this.now()) } },
        orderBy: { createdAt: 'asc' },
      })
      if (!candidato) break
      const claimId = `turno-notifications-${randomUUID()}`
      const reclamado = await this.prisma.outboxEvent.updateMany({
        where: { id: candidato.id, status: 'pending' },
        data: { status: 'processing', attempts: { increment: 1 }, claimId, claimUntil: new Date(this.now() + 30_000) },
      })
      if (reclamado.count === 0) continue
      const attempts = candidato.attempts + 1
      try {
        if (!esEvento(candidato.payload)) throw new Error('invalid appointment notification event')
        await this.entregar(candidato.payload)
        await this.prisma.outboxEvent.updateMany({
          where: { id: candidato.id, status: 'processing', claimId },
          data: { status: 'published', publishedAt: new Date(this.now()), claimId: null, claimUntil: null, lastError: null },
        })
      } catch (error) {
        const agotado = attempts >= 8
        const demora = Math.min(60_000, 1_000 * 2 ** Math.min(attempts - 1, 6))
        await this.prisma.outboxEvent.updateMany({
          where: { id: candidato.id, status: 'processing', claimId },
          data: {
            status: agotado ? 'dead-letter' : 'pending',
            availableAt: new Date(this.now() + demora),
            lastError: error instanceof Error ? error.name : 'notification_delivery_failed',
            claimId: null,
            claimUntil: null,
          },
        })
      }
      procesados += 1
    }
    return procesados
  }

  crearWorker(options: { pollMs?: number } = {}) {
    const pollMs = options.pollMs ?? 2_000
    return {
      ejecutar: async ({ signal }: { signal: AbortSignal }): Promise<void> => {
        while (!signal.aborted) {
          // A transient database failure must not terminate the long-running worker. The event
          // remains pending/leased and is recovered on a later cycle.
          const procesados = await this.procesarPendientes().catch(() => 0)
          if (procesados > 0) continue
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, pollMs)
            signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          })
        }
      },
    }
  }
}
