import type { Trabajo } from '@factory/contracts'

// CIERRE-TRABAJO-01. How a work (or the order of a turno) is closed.
//
//   provider marks it finished (with a minimum of evidence)
//     -> the client confirms it, or observes / claims
//     -> with no answer, TUS confirms it by itself when the window runs out (72 hours), unless
//        something blocks it
//
// Everything is a persisted fact of one row per work: when it was finished, the evidence, the
// moment its window runs out, who confirmed it and how, the observation of the client. The window
// is a stored instant processed by `procesarVencidos`, safe to run any number of times and from
// any process: no timer keeps anything in memory.
//
// Confirming a work does NOT release money by itself. It only records that the service was
// delivered; the finance service then decides, with what was really paid, whether the payments of
// the work are released or its balance is what comes next.

export const VENTANA_CONFIRMACION_MS = 72 * 60 * 60 * 1000
const EVIDENCIA_MINIMA = 10
const TEXTO_MAXIMO = 1000

export type OrigenConfirmacion = 'cliente' | 'automatica' | 'pago_final'

export interface CierreTrabajo {
  // The client's tenant (the owner of the work) and the work.
  tenantId: string
  trabajoId: string
  prestadorTenantId: string
  finishedAt: string
  finishedBy: string
  // What the provider says it did (a note, a reference to a picture or a document).
  evidence: string
  // The moment TUS confirms by itself if the client said nothing.
  confirmationDueAt: string
  confirmedAt: string | null
  confirmationOrigin: OrigenConfirmacion | null
  observedAt: string | null
  observationReason: string | null
  observationResolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export const observacionAbierta = (cierre: Pick<CierreTrabajo, 'observedAt' | 'observationResolvedAt'>): boolean => Boolean(cierre.observedAt && !cierre.observationResolvedAt)

export class ErrorCierreTrabajo extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ErrorCierreTrabajo'
  }
}

// Every write is conditional on the state it expects, in one statement: two requests at once (the
// client and the automatic confirmation, a double click) cannot both win.
export interface PuertoCierres {
  buscar(input: { tenantId: string; trabajoId: string }): Promise<CierreTrabajo | null>
  // false: that work already has its closing row (the stored one is the truth).
  crear(cierre: CierreTrabajo): Promise<boolean>
  // Only when it is not confirmed and has no open observation.
  confirmar(input: { tenantId: string; trabajoId: string; origin: OrigenConfirmacion; at: string }): Promise<boolean>
  // Only when it is not confirmed and has no open observation.
  observar(input: { tenantId: string; trabajoId: string; reason: string; at: string }): Promise<boolean>
  // Only when its observation is open.
  resolverObservacion(input: { tenantId: string; trabajoId: string; at: string }): Promise<boolean>
  // Finished, not confirmed, without an open observation, whose window ran out; oldest first.
  vencidos(input: { now: string; limit: number }): Promise<CierreTrabajo[]>
}

export class AlmacenCierresEnMemoria implements PuertoCierres {
  readonly filas = new Map<string, CierreTrabajo>()
  private clave(tenantId: string, trabajoId: string): string {
    return `${tenantId}\u0000${trabajoId}`
  }
  async buscar(input: { tenantId: string; trabajoId: string }): Promise<CierreTrabajo | null> {
    const fila = this.filas.get(this.clave(input.tenantId, input.trabajoId))
    return fila ? { ...fila } : null
  }
  async crear(cierre: CierreTrabajo): Promise<boolean> {
    const clave = this.clave(cierre.tenantId, cierre.trabajoId)
    if (this.filas.has(clave)) return false
    this.filas.set(clave, { ...cierre })
    return true
  }
  private cambiar(tenantId: string, trabajoId: string, puede: (fila: CierreTrabajo) => boolean, cambio: (fila: CierreTrabajo) => CierreTrabajo): boolean {
    const clave = this.clave(tenantId, trabajoId)
    const fila = this.filas.get(clave)
    if (!fila || !puede(fila)) return false
    this.filas.set(clave, cambio(fila))
    return true
  }
  async confirmar(input: { tenantId: string; trabajoId: string; origin: OrigenConfirmacion; at: string }): Promise<boolean> {
    return this.cambiar(input.tenantId, input.trabajoId, (fila) => !fila.confirmedAt && !observacionAbierta(fila), (fila) => ({ ...fila, confirmedAt: input.at, confirmationOrigin: input.origin, updatedAt: input.at }))
  }
  async observar(input: { tenantId: string; trabajoId: string; reason: string; at: string }): Promise<boolean> {
    return this.cambiar(input.tenantId, input.trabajoId, (fila) => !fila.confirmedAt && !observacionAbierta(fila), (fila) => ({ ...fila, observedAt: input.at, observationReason: input.reason, observationResolvedAt: null, updatedAt: input.at }))
  }
  async resolverObservacion(input: { tenantId: string; trabajoId: string; at: string }): Promise<boolean> {
    return this.cambiar(input.tenantId, input.trabajoId, observacionAbierta, (fila) => ({ ...fila, observationResolvedAt: input.at, updatedAt: input.at }))
  }
  async vencidos(input: { now: string; limit: number }): Promise<CierreTrabajo[]> {
    return [...this.filas.values()]
      .filter((fila) => !fila.confirmedAt && !observacionAbierta(fila) && fila.confirmationDueAt <= input.now)
      .sort((a, b) => a.confirmationDueAt.localeCompare(b.confirmationDueAt))
      .slice(0, input.limit)
      .map((fila) => ({ ...fila }))
  }
}

export interface ContextoCierre {
  tenantId: string
  actorId: string
  correlationId: string
}

// What the closing needs from the rest of TUS. Each one is the existing service of its domain.
export interface DependenciasCierre {
  // The work, whoever asks (the caller is checked here against its tenants).
  trabajo(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null>
  // The turno of an order: its state and when it starts. Absent: no turnos in that composition.
  reserva?(input: { prestadorTenantId: string; reservaId: string }): Promise<{ status: string; startsAt: string } | null>
  // Marks the turno as done (confirmed -> completed). false: it was not confirmed any more.
  completarReserva?(input: { prestadorTenantId: string; reservaId: string; at: string }): Promise<boolean>
  // The economic evaluation of the finance service: releases the payments of the work when it is
  // fully paid, and says what is left to pay otherwise. It never releases anything twice.
  evaluarPagos?(input: { tenantId: string; trabajoId: string; correlationId: string }): Promise<ResultadoEconomicoCierre>
  // PAGOS-MODALIDAD-01. A work (not a turno) whose total was paid in advance has no final payment
  // left to complete it: its confirmed closing does. true when it completed the work now.
  completarSiPagado?(input: { trabajo: Trabajo; correlationId: string; at: string }): Promise<boolean>
  // Whatever of other domains forbids an AUTOMATIC confirmation: a refund in progress, a payment
  // that does not reconcile, a pending cancellation request, a related support case.
  bloqueos?(trabajo: Trabajo): Promise<string[]>
}

export interface ResultadoEconomicoCierre {
  // Settlements released by this evaluation.
  released: number
  // Why nothing more was released (null: everything of the work is released or nothing is held).
  pending: string | null
}

export interface ResultadoCierre {
  cierre: CierreTrabajo
  // 'created' | 'existing' for a finalization; 'confirmed' | 'already_confirmed' for a confirmation.
  status: 'created' | 'existing' | 'confirmed' | 'already_confirmed' | 'observed' | 'resolved'
  pagos: ResultadoEconomicoCierre | null
}

export interface ResultadoVencidos {
  confirmados: string[]
  // trabajoId -> what blocked its automatic confirmation.
  bloqueados: Record<string, string[]>
}

const texto = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '')

export class ServicioCierreTrabajo {
  constructor(
    private readonly store: PuertoCierres,
    private readonly dependencias: DependenciasCierre,
    private readonly now: () => number = Date.now
  ) {}

  private iso(): string {
    return new Date(this.now()).toISOString()
  }

  private async trabajoDe(tenantId: string, trabajoId: string): Promise<Trabajo> {
    const trabajo = typeof trabajoId === 'string' && trabajoId ? await this.dependencias.trabajo({ tenantId, trabajoId }) : null
    // Somebody else's work is "not found": its existence is never confirmed.
    if (!trabajo || (trabajo.tenantId !== tenantId && trabajo.prestadorTenantId !== tenantId)) throw new ErrorCierreTrabajo(404, 'NOT_FOUND', 'work was not found')
    return trabajo
  }

  // The provider says the service is done. Stores when, the evidence and the moment the window
  // of the client runs out. Asking again returns what is stored: the window never restarts.
  async finalizar(context: ContextoCierre, trabajoId: string, input: { evidence?: unknown }): Promise<ResultadoCierre> {
    const trabajo = await this.trabajoDe(context.tenantId, trabajoId)
    if (trabajo.prestadorTenantId !== context.tenantId) throw new ErrorCierreTrabajo(403, 'FORBIDDEN', 'only the provider of the work finishes it')
    const existente = await this.store.buscar({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId })
    if (existente) return { cierre: existente, status: 'existing', pagos: null }
    const evidence = texto(input.evidence)
    if (evidence.length < EVIDENCIA_MINIMA || evidence.length > TEXTO_MAXIMO)
      throw new ErrorCierreTrabajo(400, 'EVIDENCE_REQUIRED', `describe what was done in ${EVIDENCIA_MINIMA} to ${TEXTO_MAXIMO} characters`)
    if (trabajo.status === 'cancelled') throw new ErrorCierreTrabajo(409, 'WORK_CANCELLED', 'a cancelled work cannot be finished')
    if (trabajo.origin === 'turno') {
      const reserva = trabajo.reservaId && this.dependencias.reserva ? await this.dependencias.reserva({ prestadorTenantId: trabajo.prestadorTenantId, reservaId: trabajo.reservaId }) : null
      if (!reserva) throw new ErrorCierreTrabajo(409, 'APPOINTMENT_NOT_FOUND', 'the turno of this order was not found')
      // Only a turno that was confirmed (its deposit paid) and has already started was delivered.
      if (reserva.status !== 'confirmed') throw new ErrorCierreTrabajo(409, 'APPOINTMENT_NOT_CONFIRMED', 'only a confirmed turno can be finished')
      if (Date.parse(reserva.startsAt) > this.now()) throw new ErrorCierreTrabajo(409, 'APPOINTMENT_NOT_STARTED', 'the turno has not started yet')
    } else if (!trabajo.finishedAt && trabajo.status !== 'completed') {
      // A work is finished through its own command first (it records the end of the work itself).
      throw new ErrorCierreTrabajo(409, 'WORK_NOT_FINISHED', 'mark the work as finished first')
    }
    // One instant for both: the window is exactly 72 hours after the finalization.
    const instante = this.now()
    const ahora = new Date(instante).toISOString()
    const cierre: CierreTrabajo = {
      tenantId: trabajo.tenantId,
      trabajoId: trabajo.trabajoId,
      prestadorTenantId: trabajo.prestadorTenantId,
      finishedAt: ahora,
      finishedBy: context.actorId,
      evidence,
      confirmationDueAt: new Date(instante + VENTANA_CONFIRMACION_MS).toISOString(),
      confirmedAt: null,
      confirmationOrigin: null,
      observedAt: null,
      observationReason: null,
      observationResolvedAt: null,
      createdAt: ahora,
      updatedAt: ahora,
    }
    const creada = await this.store.crear(cierre)
    const guardada = (await this.store.buscar({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId })) ?? cierre
    return { cierre: guardada, status: creada ? 'created' : 'existing', pagos: null }
  }

  // The client confirms that the service was delivered.
  async confirmar(context: ContextoCierre, trabajoId: string): Promise<ResultadoCierre> {
    const trabajo = await this.trabajoDe(context.tenantId, trabajoId)
    if (trabajo.tenantId !== context.tenantId) throw new ErrorCierreTrabajo(403, 'FORBIDDEN', 'only the client of the work confirms it')
    return this.aplicarConfirmacion(trabajo, 'cliente', context.correlationId)
  }

  private async aplicarConfirmacion(trabajo: Trabajo, origin: OrigenConfirmacion, correlationId: string): Promise<ResultadoCierre> {
    const scope = { tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId }
    const cierre = await this.store.buscar(scope)
    if (!cierre) throw new ErrorCierreTrabajo(409, 'WORK_NOT_FINISHED', 'the provider has not finished the work yet')
    if (observacionAbierta(cierre)) throw new ErrorCierreTrabajo(409, 'OBSERVATION_OPEN', 'the work has an open observation')
    const confirmada = cierre.confirmedAt ? false : await this.store.confirmar({ ...scope, origin, at: this.iso() })
    const actual = (await this.store.buscar(scope)) ?? cierre
    // Lost to an observation written at the same moment: it stays unconfirmed.
    if (!actual.confirmedAt) throw new ErrorCierreTrabajo(409, 'OBSERVATION_OPEN', 'the work has an open observation')
    // The effects are safe to repeat: a confirmation whose effects were interrupted is completed
    // by asking again (or by the next run of the automatic confirmation).
    if (trabajo.origin === 'turno' && trabajo.reservaId) await this.dependencias.completarReserva?.({ prestadorTenantId: trabajo.prestadorTenantId, reservaId: trabajo.reservaId, at: actual.confirmedAt })
    if (trabajo.origin !== 'turno') await this.dependencias.completarSiPagado?.({ trabajo, correlationId, at: actual.confirmedAt })
    const pagos = this.dependencias.evaluarPagos ? await this.dependencias.evaluarPagos({ ...scope, correlationId }) : null
    return { cierre: actual, status: confirmada ? 'confirmed' : 'already_confirmed', pagos }
  }

  // The client says something is wrong. While it is open nothing confirms the work, neither the
  // client nor the window, and nothing of it is released.
  async observar(context: ContextoCierre, trabajoId: string, input: { reason?: unknown }): Promise<ResultadoCierre> {
    const trabajo = await this.trabajoDe(context.tenantId, trabajoId)
    if (trabajo.tenantId !== context.tenantId) throw new ErrorCierreTrabajo(403, 'FORBIDDEN', 'only the client of the work observes it')
    const reason = texto(input.reason)
    if (reason.length < EVIDENCIA_MINIMA || reason.length > TEXTO_MAXIMO) throw new ErrorCierreTrabajo(400, 'REASON_REQUIRED', `describe the problem in ${EVIDENCIA_MINIMA} to ${TEXTO_MAXIMO} characters`)
    const scope = { tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId }
    const cierre = await this.store.buscar(scope)
    if (!cierre) throw new ErrorCierreTrabajo(409, 'WORK_NOT_FINISHED', 'the provider has not finished the work yet')
    if (cierre.confirmedAt) throw new ErrorCierreTrabajo(409, 'ALREADY_CONFIRMED', 'the work was already confirmed')
    if (observacionAbierta(cierre)) return { cierre, status: 'observed', pagos: null }
    if (!(await this.store.observar({ ...scope, reason, at: this.iso() }))) throw new ErrorCierreTrabajo(409, 'ALREADY_CONFIRMED', 'the work was already confirmed')
    return { cierre: (await this.store.buscar(scope))!, status: 'observed', pagos: null }
  }

  // The platform closes the observation (the caller already holds that authority). The window
  // starts counting again from now: the client keeps its 72 hours after the case is settled.
  async resolverObservacion(context: ContextoCierre, input: { tenantId: string; trabajoId: string }): Promise<ResultadoCierre> {
    const cierre = await this.store.buscar(input)
    if (!cierre) throw new ErrorCierreTrabajo(404, 'NOT_FOUND', 'work was not found')
    if (!observacionAbierta(cierre)) throw new ErrorCierreTrabajo(409, 'NO_OPEN_OBSERVATION', 'the work has no open observation')
    await this.store.resolverObservacion({ ...input, at: this.iso() })
    void context
    return { cierre: (await this.store.buscar(input))!, status: 'resolved', pagos: null }
  }

  // The windows that ran out. Each work is confirmed at most once (the conditional write of the
  // store), so this can run from several processes and be repeated at will. A work with anything
  // blocking it is left exactly as it is and looked at again on the next run.
  async procesarVencidos(limit = 50): Promise<ResultadoVencidos> {
    const resultado: ResultadoVencidos = { confirmados: [], bloqueados: {} }
    for (const cierre of await this.store.vencidos({ now: this.iso(), limit })) {
      const trabajo = await this.dependencias.trabajo({ tenantId: cierre.tenantId, trabajoId: cierre.trabajoId })
      if (!trabajo) continue
      const bloqueos = [
        ...(trabajo.status === 'cancelled' ? ['work_cancelled'] : []),
        ...(trabajo.cancellationRequestedAt ? ['cancellation_requested'] : []),
        ...((await this.dependencias.bloqueos?.(trabajo).catch(() => ['blockers_unavailable'])) ?? []),
      ]
      if (bloqueos.length > 0) {
        resultado.bloqueados[cierre.trabajoId] = bloqueos
        continue
      }
      try {
        const aplicada = await this.aplicarConfirmacion(trabajo, 'automatica', `auto-confirmacion:${cierre.trabajoId}`)
        if (aplicada.status === 'confirmed') resultado.confirmados.push(cierre.trabajoId)
      } catch (error) {
        resultado.bloqueados[cierre.trabajoId] = [error instanceof ErrorCierreTrabajo ? error.code : 'confirmation_failed']
      }
    }
    return resultado
  }

  // For the finance service: what the closing of that work says.
  async estado(input: { tenantId: string; trabajoId: string }): Promise<{ confirmed: boolean; blocked: string | null } | null> {
    const cierre = await this.store.buscar(input)
    return cierre ? { confirmed: Boolean(cierre.confirmedAt), blocked: observacionAbierta(cierre) ? 'observation_open' : null } : null
  }

  // What the client and the provider of the work read.
  async ver(context: ContextoCierre, trabajoId: string): Promise<CierreTrabajo | null> {
    const trabajo = await this.trabajoDe(context.tenantId, trabajoId)
    return this.store.buscar({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId })
  }
}
