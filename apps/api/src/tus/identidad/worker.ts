import { randomUUID } from 'node:crypto'
import type { BovedaCredencialesAesGcm } from '../finance/servicios/cuentas-cobro.ts'
import type { ImagenParaLectura, IdentityDocumentReader } from './lectores.ts'
import {
  ErrorIdentidad,
  compararConFuente,
  enmascararCuil,
  enmascararDni,
  proximoReintento,
  reconciliarLecturas,
  type MotivoRevisionIdentidad,
} from './modelo.ts'
import { ErrorProveedorIdentidad, type IdentityVerificationProvider } from './proveedor.ts'
import type {
  EstadoProveedorIdentidad,
  EstadoWorkerIdentidad,
  EtapaTrabajoIdentidad,
  PuertoTransaccionIdentidad,
  RepositoriosIdentidad,
  TrabajoIdentidad,
  VerificacionIdentidad,
} from './puertos.ts'
import { aadDocumento } from './servicio.ts'

export const VENTANA_LIMITE_MS = 3_600_000
export const UMBRAL_CIRCUIT_BREAKER = 5

export interface ConfiguracionWorkerIdentidad {
  providerId: string
  maxChecksPerHour: number
  leaseMs?: number
  circuitThreshold?: number
}

// Only masked, non-sensitive fields ever reach this logger (no DNI/CUIL, cookies or HTML).
export type LoggerWorkerIdentidad = (event: string, fields: Record<string, unknown>) => void

export type ResultadoCicloIdentidad =
  | {
      outcome: 'idle'
      workerStatus: EstadoWorkerIdentidad | 'rate_limited'
      nextEligibleAt: string | null
    }
  | { outcome: 'paused'; workerStatus: EstadoWorkerIdentidad }
  | { outcome: 'read'; verificationId: string; status: string }
  | { outcome: 'checked'; verificationId: string; status: string }
  | { outcome: 'rate_limited'; verificationId: string; nextEligibleAt: string | null }
  | { outcome: 'session_required'; verificationId: string }
  | { outcome: 'retry_scheduled'; verificationId: string; availableAt: string }
  | { outcome: 'cancelled'; verificationId: string }
  | { outcome: 'lease_lost'; verificationId: string }

const ESTADOS_EN_CURSO = new Set(['queued', 'processing', 'retry_pending', 'session_required'])
const ERRORES_SESION = new Set(['NOSIS_SESSION_REQUIRED', 'NOSIS_CHALLENGE_REQUIRED'])

class LeasePerdido extends Error {}

// Separate process (see scripts/tus-identity-worker). Concurrency 1 per process; several
// processes are safe because the lease, the rate-limit reservation and the provider state are
// atomic in the database. HTTP requests never wait for this worker.
export class WorkerVerificacionIdentidad {
  private readonly owner: string
  private readonly leaseMs: number
  private readonly circuitThreshold: number

  constructor(
    private readonly transaction: PuertoTransaccionIdentidad,
    private readonly deps: {
      provider: IdentityVerificationProvider
      ocr: IdentityDocumentReader
      vision: IdentityDocumentReader
      boveda: BovedaCredencialesAesGcm
      config: ConfiguracionWorkerIdentidad
      owner?: string
      now?: () => number
      log?: LoggerWorkerIdentidad
    }
  ) {
    this.owner = deps.owner ?? `identity-worker-${randomUUID()}`
    this.leaseMs = deps.config.leaseMs ?? 5 * 60_000
    this.circuitThreshold = deps.config.circuitThreshold ?? UMBRAL_CIRCUIT_BREAKER
  }

  get workerId(): string {
    return this.owner
  }

  async procesarSiguiente(): Promise<ResultadoCicloIdentidad> {
    const nowIso = this.isoNow()
    let leased
    try {
      leased = await this.tomar(nowIso)
    } catch (error) {
      // Another worker won the queue head; nothing was leased by this one.
      if (error instanceof ErrorIdentidad && error.code === 'CONCURRENT_MODIFICATION')
        return { outcome: 'idle', workerStatus: 'running', nextEligibleAt: null }
      throw error
    }

    if (leased.kind === 'paused') return { outcome: 'paused', workerStatus: leased.state.status }
    if (leased.kind === 'idle') {
      const rateLimited = leased.state.status === 'running' && !leased.searchAllowed
      return {
        outcome: 'idle',
        workerStatus: rateLimited ? 'rate_limited' : leased.state.status,
        nextEligibleAt: leased.usage.nextEligibleAt,
      }
    }
    if (leased.kind === 'cancelled')
      return { outcome: 'cancelled', verificationId: leased.job.verificationId }
    try {
      return leased.job.stage === 'lectura'
        ? await this.leer(leased.job, leased.verification)
        : await this.consultar(leased.job, leased.verification)
    } catch (error) {
      if (error instanceof LeasePerdido)
        return { outcome: 'lease_lost', verificationId: leased.job.verificationId }
      throw error
    }
  }

  private tomar(nowIso: string) {
    return this.transaction.ejecutar(async (repositories) => {
      const state = await repositories.estadoProveedor.leer(this.deps.config.providerId)
      if (state.status === 'paused') return { kind: 'paused' as const, state }
      const usage = await repositories.limite.uso(this.limitInput(nowIso))
      // Reading never spends Nosis capacity, so it keeps flowing while the external search is
      // blocked (session, circuit or 7/hour). Strict FIFO for searches: when the window is full
      // no search job is leased at all.
      const searchAllowed =
        state.status === 'running' && usage.used < this.deps.config.maxChecksPerHour
      const stages: EtapaTrabajoIdentidad[] = searchAllowed ? ['lectura', 'consulta'] : ['lectura']
      const job = await repositories.cola.tomarSiguiente({
        owner: this.owner,
        now: nowIso,
        leaseUntil: new Date(Date.parse(nowIso) + this.leaseMs).toISOString(),
        stages,
      })
      if (!job) return { kind: 'idle' as const, state, usage, searchAllowed }
      const verification = await repositories.verificaciones.buscar(job.verificationId)
      if (!verification || !ESTADOS_EN_CURSO.has(verification.status)) {
        await repositories.cola.actualizar(
          { ...job, status: 'cancelled', leaseOwner: null, leaseUntil: null, updatedAt: nowIso },
          this.owner
        )
        return { kind: 'cancelled' as const, job }
      }
      const processing: VerificacionIdentidad = {
        ...verification,
        status: 'processing',
        processingStartedAt: verification.processingStartedAt ?? nowIso,
        version: verification.version + 1,
        updatedAt: nowIso,
      }
      await repositories.verificaciones.actualizar(processing, verification.version)
      if (verification.status !== 'processing')
        await this.auditar(repositories, 'verification.processing', processing, {
          stage: job.stage,
        })
      return { kind: 'job' as const, job, verification: processing }
    })
  }

  // Runs cycles until the signal aborts. Sleeps `idleMs` when there is nothing to do.
  async ejecutar(options: {
    signal: AbortSignal
    idleMs?: number
    onCycle?: (result: ResultadoCicloIdentidad) => void
  }) {
    const idleMs = options.idleMs ?? 5_000
    while (!options.signal.aborted) {
      let result: ResultadoCicloIdentidad
      try {
        result = await this.procesarSiguiente()
      } catch (error) {
        this.log('worker.cycle_failed', { error: error instanceof Error ? error.name : 'unknown' })
        result = { outcome: 'idle', workerStatus: 'running', nextEligibleAt: null }
      }
      options.onCycle?.(result)
      if (result.outcome === 'idle' || result.outcome === 'paused')
        await esperar(idleMs, options.signal)
    }
    await this.deps.provider.cerrar?.()
  }

  // ---- stage 1: OCR + vision (no external query) --------------------------------------------

  private async leer(
    job: TrabajoIdentidad,
    verification: VerificacionIdentidad
  ): Promise<ResultadoCicloIdentidad> {
    const images = await this.transaction.ejecutar(async (repositories) => {
      const result: ImagenParaLectura[] = []
      for (const side of ['front', 'back'] as const) {
        const doc = await repositories.documentos.leer(verification.verificationId, side)
        if (!doc) continue
        result.push({
          side,
          mimeType: doc.mimeType,
          bytes: Buffer.from(
            this.deps.boveda.descifrar(
              doc.ciphertext,
              aadDocumento(verification.verificationId, side)
            ),
            'base64'
          ),
        })
      }
      return result
    })
    const [ocr, vision] = await Promise.all([
      this.deps.ocr.leer(images),
      this.deps.vision.leer(images),
    ])
    const nowIso = this.isoNow()

    // A reader that could not run (engine or provider outage) is transient: retry the stage.
    if (images.length === 2 && (ocr.transient || vision.transient)) {
      const retryAt = proximoReintento(job.attemptCount + 1, Date.parse(nowIso))
      if (retryAt !== null)
        return this.programarReintento(
          job,
          verification,
          retryAt,
          ocr.transient ? 'OCR_UNAVAILABLE' : 'VISION_UNAVAILABLE',
          { ocrReading: ocr, visionReading: vision }
        )
    }

    const reconciled =
      images.length < 2
        ? { status: 'review' as const, reason: 'DOCUMENT_UNREADABLE' as const }
        : reconciliarLecturas(ocr, vision)
    return this.transaction.ejecutar(async (repositories) => {
      await this.cerrarTrabajo(repositories, job, 'done', null)
      const base = { ...verification, ocrReading: ocr, visionReading: vision }
      if (reconciled.status === 'review') {
        const next = await this.guardar(repositories, verification, {
          ...base,
          status: 'review_required',
          reviewReason: reconciled.reason,
        })
        await this.auditar(repositories, 'verification.review_required', next, {
          reason: reconciled.reason,
          stage: 'lectura',
        })
        return {
          outcome: 'read' as const,
          verificationId: next.verificationId,
          status: next.status,
        }
      }
      const candidate = {
        ...base,
        documentNumber: reconciled.documentNumber,
        extractedFirstName: reconciled.firstName,
        extractedLastName: reconciled.lastName,
        extractedBirthDate: reconciled.birthDate,
        extractedSex: reconciled.sex,
      }
      // A DNI already verified for another provider never spends a Nosis query.
      if (
        await repositories.verificaciones.existeVerificadaDeOtro({
          tenantId: verification.tenantId,
          documentNumber: reconciled.documentNumber,
        })
      ) {
        const next = await this.guardar(repositories, verification, {
          ...candidate,
          status: 'review_required',
          reviewReason: 'IDENTITY_ALREADY_VERIFIED',
        })
        await this.auditar(repositories, 'verification.review_required', next, {
          reason: 'IDENTITY_ALREADY_VERIFIED',
          stage: 'lectura',
        })
        return {
          outcome: 'read' as const,
          verificationId: next.verificationId,
          status: next.status,
        }
      }
      const next = await this.guardar(repositories, verification, {
        ...candidate,
        status: 'queued',
      })
      // The search job keeps the original queue position (FIFO by the verification queuedAt).
      await repositories.cola.encolar({
        jobId: `trabajo-identidad-${randomUUID()}`,
        verificationId: next.verificationId,
        stage: 'consulta',
        status: 'queued',
        queuedAt: verification.queuedAt ?? job.queuedAt,
        availableAt: nowIso,
        attemptCount: 0,
        leaseOwner: null,
        leaseUntil: null,
        lastErrorCode: null,
        updatedAt: nowIso,
      })
      this.log('verification.read', {
        verificationId: next.verificationId,
        document: enmascararDni(next.documentNumber),
      })
      return { outcome: 'read' as const, verificationId: next.verificationId, status: next.status }
    })
  }

  // ---- stage 2: external source (rate limited) ----------------------------------------------

  private async consultar(
    job: TrabajoIdentidad,
    verification: VerificacionIdentidad
  ): Promise<ResultadoCicloIdentidad> {
    const documentNumber = verification.documentNumber
    if (!documentNumber) {
      return this.transaction.ejecutar(async (repositories) => {
        await this.cerrarTrabajo(repositories, job, 'done', null)
        const next = await this.guardar(repositories, verification, {
          ...verification,
          status: 'review_required',
          reviewReason: 'DOCUMENT_UNREADABLE',
        })
        await this.auditar(repositories, 'verification.review_required', next, {
          reason: 'DOCUMENT_UNREADABLE',
        })
        return {
          outcome: 'checked' as const,
          verificationId: next.verificationId,
          status: next.status,
        }
      })
    }
    let rateLimit: { granted: boolean; used: number; nextEligibleAt: string | null } | null = null
    // The slot is consumed atomically right before the search is submitted, even if parsing
    // the result fails afterwards.
    const consumirSlot = async () => {
      rateLimit = await this.transaction.ejecutar((repositories) =>
        repositories.limite.reservar({
          ...this.limitInput(this.isoNow()),
          verificationId: verification.verificationId,
        })
      )
      return rateLimit.granted
    }
    try {
      await this.deps.provider.prepararSesion()
      const result = await this.deps.provider.consultar({ documentNumber }, consumirSlot)
      return await this.resolver(job, verification, result.results, result.providerReference)
    } catch (error) {
      if (error instanceof LeasePerdido) throw error
      const providerError =
        error instanceof ErrorProveedorIdentidad
          ? error
          : new ErrorProveedorIdentidad(
              'NOSIS_UNAVAILABLE',
              'unexpected provider error',
              rateLimit !== null
            )
      if (providerError.code === 'NOSIS_RATE_LIMITED')
        return this.limitado(job, verification, rateLimit)
      if (ERRORES_SESION.has(providerError.code))
        return this.sesionRequerida(job, verification, providerError.code)
      return this.fallo(job, verification, providerError.code)
    }
  }

  private async resolver(
    job: TrabajoIdentidad,
    verification: VerificacionIdentidad,
    results: { documentNumber: string | null; fullName: string | null; cuil: string | null }[],
    providerReference: string | null
  ): Promise<ResultadoCicloIdentidad> {
    const comparison = compararConFuente({
      documentNumber: verification.documentNumber!,
      firstName: verification.extractedFirstName,
      lastName: verification.extractedLastName,
      results,
    })
    const snapshot = {
      resultCount: results.length,
      nameMatch:
        comparison.decision === 'verified'
          ? 'match'
          : comparison.decision === 'rejected'
            ? 'mismatch'
            : comparison.reason === 'NAME_PARTIAL_MATCH'
              ? 'partial'
              : null,
      cuilValid:
        comparison.decision === 'verified'
          ? true
          : comparison.decision === 'review_required' && comparison.reason.startsWith('CUIL_')
            ? false
            : null,
    }
    const base = {
      ...verification,
      providerReference,
      externalSnapshot: snapshot,
      verificationMethod: this.deps.provider.method,
    }
    const review = (reason: MotivoRevisionIdentidad) =>
      this.transaction.ejecutar(async (repositories) => {
        await this.cerrarTrabajo(repositories, job, 'done', null)
        const next = await this.guardar(repositories, verification, {
          ...base,
          verificationMethod: null,
          status: 'review_required',
          reviewReason: reason,
        })
        await this.auditar(repositories, 'verification.review_required', next, {
          reason,
          resultCount: results.length,
        })
        await this.proveedorOk(repositories)
        return {
          outcome: 'checked' as const,
          verificationId: next.verificationId,
          status: next.status,
        }
      })

    if (comparison.decision === 'review_required') return review(comparison.reason)
    if (comparison.decision === 'rejected') {
      return this.transaction.ejecutar(async (repositories) => {
        await this.cerrarTrabajo(repositories, job, 'done', null)
        const next = await this.guardar(repositories, verification, {
          ...base,
          verificationMethod: null,
          status: 'rejected',
          reviewReason: comparison.reason,
          rejectedAt: this.isoNow(),
        })
        await this.auditar(repositories, 'verification.rejected', next, {
          reason: comparison.reason,
        })
        await this.proveedorOk(repositories)
        return {
          outcome: 'checked' as const,
          verificationId: next.verificationId,
          status: next.status,
        }
      })
    }
    try {
      return await this.transaction.ejecutar(async (repositories) => {
        if (
          await repositories.verificaciones.existeVerificadaDeOtro({
            tenantId: verification.tenantId,
            documentNumber: verification.documentNumber!,
            cuil: comparison.cuil,
          })
        )
          throw Object.assign(new Error('duplicate verified identity'), { code: 'P2002' })
        await this.cerrarTrabajo(repositories, job, 'done', null)
        const next = await this.guardar(repositories, verification, {
          ...base,
          status: 'verified',
          verifiedCuil: comparison.cuil,
          reviewReason: null,
          verifiedAt: this.isoNow(),
        })
        await this.auditar(repositories, 'verification.verified', next, {
          method: next.verificationMethod,
        })
        await this.proveedorOk(repositories)
        return {
          outcome: 'checked' as const,
          verificationId: next.verificationId,
          status: next.status,
        }
      })
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return review('IDENTITY_ALREADY_VERIFIED')
      throw error
    }
  }

  private async limitado(
    job: TrabajoIdentidad,
    verification: VerificacionIdentidad,
    rateLimit: { nextEligibleAt: string | null } | null
  ): Promise<ResultadoCicloIdentidad> {
    const nextEligibleAt = rateLimit?.nextEligibleAt ?? null
    return this.transaction.ejecutar(async (repositories) => {
      // Backpressure: the job keeps its FIFO position and waits for capacity. Not an attempt.
      await this.liberar(repositories, job, {
        availableAt: nextEligibleAt ?? this.isoNow(),
        lastErrorCode: 'NOSIS_RATE_LIMITED',
      })
      const next = await this.guardar(repositories, verification, {
        ...verification,
        status: 'queued',
      })
      await this.auditar(repositories, 'nosis.rate_limited', next, {
        nextEligibleAt,
        max: this.deps.config.maxChecksPerHour,
      })
      return {
        outcome: 'rate_limited' as const,
        verificationId: next.verificationId,
        nextEligibleAt,
      }
    })
  }

  private async sesionRequerida(
    job: TrabajoIdentidad,
    verification: VerificacionIdentidad,
    code: string
  ): Promise<ResultadoCicloIdentidad> {
    return this.transaction.ejecutar(async (repositories) => {
      // Never a rejection: the queue is kept and the worker stops searching until a human
      // restores the Mi Nosis session (pnpm tus:identity:nosis-login).
      await this.liberar(repositories, job, { availableAt: job.availableAt, lastErrorCode: code })
      const next = await this.guardar(repositories, verification, {
        ...verification,
        status: 'session_required',
      })
      await this.cambiarProveedor(repositories, (state) => ({
        ...state,
        status: 'session_required',
        reason: code,
      }))
      await this.auditar(repositories, 'nosis.session_required', next, { code })
      return { outcome: 'session_required' as const, verificationId: next.verificationId }
    })
  }

  private async fallo(
    job: TrabajoIdentidad,
    verification: VerificacionIdentidad,
    code: string
  ): Promise<ResultadoCicloIdentidad> {
    const nowMs = Date.parse(this.isoNow())
    const retryAt = proximoReintento(job.attemptCount + 1, nowMs)
    await this.transaction.ejecutar(async (repositories) => {
      await this.cambiarProveedor(
        repositories,
        (state) => {
          const consecutiveErrors = state.consecutiveErrors + 1
          const open = consecutiveErrors >= this.circuitThreshold && state.status === 'running'
          return {
            ...state,
            consecutiveErrors,
            status: open ? 'circuit_open' : state.status,
            reason: open ? code : state.reason,
          }
        },
        async (next, previous) => {
          if (next.status === 'circuit_open' && previous.status !== 'circuit_open')
            await repositories.auditoria.registrar(
              this.eventoWorker('nosis.circuit_opened', {
                code,
                consecutiveErrors: next.consecutiveErrors,
              })
            )
        }
      )
    })
    if (retryAt !== null) return this.programarReintento(job, verification, retryAt, code)
    return this.transaction.ejecutar(async (repositories) => {
      await this.cerrarTrabajo(repositories, job, 'done', code)
      const next = await this.guardar(repositories, verification, {
        ...verification,
        status: 'review_required',
        reviewReason: 'RETRIES_EXHAUSTED',
        attempts: verification.attempts + 1,
      })
      await this.auditar(repositories, 'verification.review_required', next, {
        reason: 'RETRIES_EXHAUSTED',
        code,
      })
      return {
        outcome: 'checked' as const,
        verificationId: next.verificationId,
        status: next.status,
      }
    })
  }

  private async programarReintento(
    job: TrabajoIdentidad,
    verification: VerificacionIdentidad,
    retryAt: number,
    code: string,
    extra: Partial<VerificacionIdentidad> = {}
  ): Promise<ResultadoCicloIdentidad> {
    const availableAt = new Date(retryAt).toISOString()
    return this.transaction.ejecutar(async (repositories) => {
      await this.liberar(repositories, job, {
        availableAt,
        lastErrorCode: code,
        attemptCount: job.attemptCount + 1,
      })
      const next = await this.guardar(repositories, verification, {
        ...verification,
        ...extra,
        status: 'retry_pending',
        attempts: verification.attempts + 1,
      })
      await this.auditar(repositories, 'verification.retry_scheduled', next, {
        code,
        availableAt,
        attempt: job.attemptCount + 1,
      })
      return {
        outcome: 'retry_scheduled' as const,
        verificationId: next.verificationId,
        availableAt,
      }
    })
  }

  // ---- helpers ------------------------------------------------------------------------------

  private async liberar(
    repositories: RepositoriosIdentidad,
    job: TrabajoIdentidad,
    change: { availableAt: string; lastErrorCode: string | null; attemptCount?: number }
  ) {
    const ok = await repositories.cola.actualizar(
      {
        ...job,
        ...change,
        status: 'queued',
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: this.isoNow(),
      },
      this.owner
    )
    if (!ok) throw new LeasePerdido()
  }

  private async cerrarTrabajo(
    repositories: RepositoriosIdentidad,
    job: TrabajoIdentidad,
    status: 'done' | 'cancelled',
    lastErrorCode: string | null
  ) {
    const ok = await repositories.cola.actualizar(
      {
        ...job,
        status,
        lastErrorCode,
        leaseOwner: this.owner,
        leaseUntil: null,
        updatedAt: this.isoNow(),
      },
      this.owner
    )
    if (!ok) throw new LeasePerdido()
  }

  // Re-reads the verification: the admin may have decided it while the worker was busy.
  private async guardar(
    repositories: RepositoriosIdentidad,
    leased: VerificacionIdentidad,
    next: VerificacionIdentidad
  ): Promise<VerificacionIdentidad> {
    const current = await repositories.verificaciones.buscar(leased.verificationId)
    if (!current || current.version !== leased.version) throw new LeasePerdido()
    const value = { ...next, version: current.version + 1, updatedAt: this.isoNow() }
    if (!(await repositories.verificaciones.actualizar(value, current.version)))
      throw new LeasePerdido()
    return value
  }

  private async proveedorOk(repositories: RepositoriosIdentidad) {
    await this.cambiarProveedor(repositories, (state) =>
      state.consecutiveErrors === 0 ? null : { ...state, consecutiveErrors: 0 }
    )
  }

  private async cambiarProveedor(
    repositories: RepositoriosIdentidad,
    change: (state: EstadoProveedorIdentidad) => EstadoProveedorIdentidad | null,
    after?: (next: EstadoProveedorIdentidad, previous: EstadoProveedorIdentidad) => Promise<void>
  ) {
    const current = await repositories.estadoProveedor.leer(this.deps.config.providerId)
    const changed = change(current)
    if (!changed) return
    const next = { ...changed, version: current.version + 1, updatedAt: this.isoNow() }
    // A lost race means another worker/admin already moved the state; theirs wins.
    if (await repositories.estadoProveedor.guardar(next, current.version))
      await after?.(next, current)
  }

  private async auditar(
    repositories: RepositoriosIdentidad,
    action: string,
    verification: VerificacionIdentidad,
    metadata: Record<string, unknown> = {}
  ) {
    await repositories.auditoria.registrar({
      eventId: `auditoria-identidad-${randomUUID()}`,
      action,
      verificationId: verification.verificationId,
      tenantId: verification.tenantId,
      actorId: this.owner,
      correlationId: verification.verificationId,
      metadata: {
        status: verification.status,
        providerId: this.deps.config.providerId,
        ...(verification.documentNumber
          ? { documentNumber: enmascararDni(verification.documentNumber) }
          : {}),
        ...(verification.verifiedCuil ? { cuil: enmascararCuil(verification.verifiedCuil) } : {}),
        ...metadata,
      },
      createdAt: this.isoNow(),
    })
    this.log(action, {
      verificationId: verification.verificationId,
      status: verification.status,
      ...metadata,
    })
  }

  private eventoWorker(action: string, metadata: Record<string, unknown>) {
    this.log(action, metadata)
    return {
      eventId: `auditoria-identidad-${randomUUID()}`,
      action,
      verificationId: null,
      tenantId: null,
      actorId: this.owner,
      correlationId: this.owner,
      metadata: { providerId: this.deps.config.providerId, ...metadata },
      createdAt: this.isoNow(),
    }
  }

  private limitInput(now: string) {
    return {
      providerId: this.deps.config.providerId,
      max: this.deps.config.maxChecksPerHour,
      windowMs: VENTANA_LIMITE_MS,
      now,
    }
  }

  private log(event: string, fields: Record<string, unknown>) {
    this.deps.log?.(event, fields)
  }

  private isoNow(): string {
    return new Date((this.deps.now ?? Date.now)()).toISOString()
  }
}

// Records that the human restored the session: the worker resumes searching.
export async function marcarSesionRestaurada(
  transaction: PuertoTransaccionIdentidad,
  providerId: string,
  actorId: string,
  now: () => number = Date.now
): Promise<EstadoProveedorIdentidad> {
  return transaction.ejecutar(async (repositories) => {
    const current = await repositories.estadoProveedor.leer(providerId)
    const nowIso = new Date(now()).toISOString()
    const next: EstadoProveedorIdentidad = {
      ...current,
      status: current.status === 'paused' ? 'paused' : 'running',
      consecutiveErrors: 0,
      reason: 'session_restored',
      version: current.version + 1,
      updatedAt: nowIso,
    }
    if (!(await repositories.estadoProveedor.guardar(next, current.version))) return current
    await repositories.auditoria.registrar({
      eventId: `auditoria-identidad-${randomUUID()}`,
      action: 'nosis.session_restored',
      verificationId: null,
      tenantId: null,
      actorId,
      correlationId: actorId,
      metadata: { providerId, previousStatus: current.status },
      createdAt: nowIso,
    })
    return next
  })
}

function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
