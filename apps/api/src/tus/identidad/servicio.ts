import { randomUUID } from 'node:crypto'
import type { BovedaCredencialesAesGcm } from '../finance/servicios/cuentas-cobro.ts'
import { prepararImagenDocumento } from './documentos.ts'
import {
  ErrorIdentidad,
  PROPOSITO_CONSENTIMIENTO_IDENTIDAD,
  TEXTO_CONSENTIMIENTO_IDENTIDAD,
  VERSION_CONSENTIMIENTO_IDENTIDAD,
  enmascararCuil,
  enmascararDni,
  type EstadoVerificacionIdentidad,
} from './modelo.ts'
import type {
  EstadoProveedorIdentidad,
  EstadoWorkerIdentidad,
  PuertoTransaccionIdentidad,
  RepositoriosIdentidad,
  VerificacionIdentidad,
} from './puertos.ts'

export interface ContextoIdentidad {
  tenantId: string
  actorId: string
  correlationId: string
}

// What the provider (prestador) sees about their own verification: no raw readings, masked DNI.
export interface VistaVerificacionPrestador {
  verificationId: string | null
  status: EstadoVerificacionIdentidad | 'not_started'
  consentAccepted: boolean
  consentText: string
  consentVersion: string
  documents: { front: boolean; back: boolean }
  documentNumberMasked: string | null
  message: string
  updatedAt: string | null
}

export const MENSAJE_EN_VERIFICACION =
  'Tu documentación está siendo verificada. Te avisaremos cuando finalice el proceso.'

const MENSAJES_ESTADO: Record<EstadoVerificacionIdentidad | 'not_started', string> = {
  not_started: 'Aceptá el consentimiento y subí tu DNI para verificar tu identidad.',
  pending_upload: 'Subí el frente y el dorso de tu DNI.',
  queued: MENSAJE_EN_VERIFICACION,
  processing: MENSAJE_EN_VERIFICACION,
  retry_pending: MENSAJE_EN_VERIFICACION,
  session_required: MENSAJE_EN_VERIFICACION,
  review_required: 'Tu verificación está en revisión por el equipo de TUS.',
  verified: 'Tu identidad está verificada.',
  rejected: 'No pudimos verificar tu identidad. Contactá a soporte de TUS.',
  failed: 'No pudimos completar la verificación. El equipo de TUS la revisará.',
}

const ESTADOS_EDITABLES = new Set<string>(['pending_upload'])
const ESTADOS_REINTENTABLES = new Set<string>([
  'review_required',
  'failed',
  'session_required',
  'retry_pending',
])

export class ServicioVerificacionIdentidad {
  constructor(
    private readonly transaction: PuertoTransaccionIdentidad,
    // Encrypts DNI images at rest (TUS_IDENTITY_DOCUMENTS_KEY); null disables uploads.
    private readonly boveda: BovedaCredencialesAesGcm | null,
    private readonly config: {
      providerId: string
      maxChecksPerHour: number
    },
    private readonly now: () => number = () => Date.now()
  ) {}

  // Gate used by marketplace publication, work acceptance and Mercado Pago linking.
  async identidadVerificada(tenantId: string): Promise<boolean> {
    return this.transaction.ejecutar((repositories) =>
      repositories.verificaciones.tenantVerificado(tenantId)
    )
  }

  async estado(context: ContextoIdentidad): Promise<VistaVerificacionPrestador> {
    return this.transaction.ejecutar(async (repositories) => {
      const current = await repositories.verificaciones.ultimaDeTenant(context.tenantId)
      if (!current) return this.vista(null, { front: false, back: false })
      const front = await repositories.documentos.leer(current.verificationId, 'front')
      const back = await repositories.documentos.leer(current.verificationId, 'back')
      return this.vista(current, { front: Boolean(front), back: Boolean(back) })
    })
  }

  async aceptarConsentimiento(
    context: ContextoIdentidad,
    input: { accepted: unknown; consentVersion: unknown }
  ) {
    if (input.accepted !== true || input.consentVersion !== VERSION_CONSENTIMIENTO_IDENTIDAD)
      throw new ErrorIdentidad(
        400,
        'CONSENT_REQUIRED',
        'the current consent must be explicitly accepted'
      )
    return this.transaction.ejecutar(async (repositories) => {
      const current = await repositories.verificaciones.ultimaDeTenant(context.tenantId)
      if (current && current.status === 'verified')
        throw new ErrorIdentidad(409, 'ALREADY_VERIFIED', 'identity is already verified')
      if (current && !['pending_upload', 'rejected'].includes(current.status))
        throw new ErrorIdentidad(
          409,
          'VERIFICATION_IN_PROGRESS',
          'a verification is already in progress'
        )
      const nowIso = this.isoNow()
      if (current && current.status === 'pending_upload') {
        const next = {
          ...current,
          consentAcceptedAt: nowIso,
          consentVersion: VERSION_CONSENTIMIENTO_IDENTIDAD,
          consentPurpose: PROPOSITO_CONSENTIMIENTO_IDENTIDAD,
          version: current.version + 1,
          updatedAt: nowIso,
        }
        if (!(await repositories.verificaciones.actualizar(next, current.version)))
          throw new ErrorIdentidad(409, 'CONCURRENT_MODIFICATION', 'verification changed; retry')
        await this.auditar(repositories, 'verification.consent_accepted', next, context)
        return this.vista(next, await this.documentos(repositories, next.verificationId))
      }
      const created: VerificacionIdentidad = {
        verificationId: `verificacion-identidad-${randomUUID()}`,
        tenantId: context.tenantId,
        userId: context.actorId,
        providerId: this.config.providerId,
        documentType: 'dni',
        documentNumber: null,
        extractedFirstName: null,
        extractedLastName: null,
        extractedBirthDate: null,
        extractedSex: null,
        verifiedCuil: null,
        status: 'pending_upload',
        verificationMethod: null,
        providerReference: null,
        reviewReason: null,
        decisionNote: null,
        consentAcceptedAt: nowIso,
        consentVersion: VERSION_CONSENTIMIENTO_IDENTIDAD,
        consentPurpose: PROPOSITO_CONSENTIMIENTO_IDENTIDAD,
        ocrReading: null,
        visionReading: null,
        externalSnapshot: null,
        attempts: 0,
        version: 1,
        createdAt: nowIso,
        queuedAt: null,
        processingStartedAt: null,
        verifiedAt: null,
        rejectedAt: null,
        updatedAt: nowIso,
      }
      await repositories.verificaciones.crear(created)
      await this.auditar(repositories, 'verification.created', created, context)
      await this.auditar(repositories, 'verification.consent_accepted', created, context)
      return this.vista(created, { front: false, back: false })
    })
  }

  async subirDocumento(context: ContextoIdentidad, side: unknown, body: unknown) {
    if (side !== 'front' && side !== 'back')
      throw new ErrorIdentidad(400, 'INVALID_SIDE', 'side must be front or back')
    if (!this.boveda)
      throw new ErrorIdentidad(
        503,
        'DOCUMENT_STORAGE_NOT_CONFIGURED',
        'document storage is not configured'
      )
    if (!Buffer.isBuffer(body))
      throw new ErrorIdentidad(400, 'DOCUMENT_EMPTY', 'document image is required')
    const image = prepararImagenDocumento(body)
    const boveda = this.boveda
    return this.transaction.ejecutar(async (repositories) => {
      const current = await repositories.verificaciones.ultimaDeTenant(context.tenantId)
      if (!current || !current.consentAcceptedAt)
        throw new ErrorIdentidad(
          409,
          'CONSENT_REQUIRED',
          'accept the consent before uploading documents'
        )
      if (!ESTADOS_EDITABLES.has(current.status))
        throw new ErrorIdentidad(409, 'VERIFICATION_LOCKED', 'documents can no longer be changed')
      await repositories.documentos.guardar({
        verificationId: current.verificationId,
        tenantId: current.tenantId,
        side,
        mimeType: image.mimeType,
        size: image.bytes.length,
        sha256: image.sha256,
        ciphertext: boveda.cifrar(
          image.bytes.toString('base64'),
          aadDocumento(current.verificationId, side)
        ),
        keyVersion: boveda.keyVersion,
        createdAt: this.isoNow(),
      })
      await this.auditar(repositories, 'verification.document_uploaded', current, context, {
        side,
        mimeType: image.mimeType,
        size: image.bytes.length,
        removedMetadata: image.removedMetadata,
      })
      return this.vista(current, await this.documentos(repositories, current.verificationId))
    })
  }

  // Responds immediately: reading, matching and the external search happen in the worker.
  async enviar(context: ContextoIdentidad) {
    return this.transaction.ejecutar(async (repositories) => {
      const current = await repositories.verificaciones.ultimaDeTenant(context.tenantId)
      if (!current || !current.consentAcceptedAt)
        throw new ErrorIdentidad(409, 'CONSENT_REQUIRED', 'accept the consent first')
      if (current.status !== 'pending_upload')
        throw new ErrorIdentidad(409, 'VERIFICATION_LOCKED', `verification is ${current.status}`)
      const docs = await this.documentos(repositories, current.verificationId)
      if (!docs.front || !docs.back)
        throw new ErrorIdentidad(
          409,
          'DOCUMENTS_REQUIRED',
          'front and back of the DNI are required'
        )
      const nowIso = this.isoNow()
      const next: VerificacionIdentidad = {
        ...current,
        status: 'queued',
        queuedAt: nowIso,
        version: current.version + 1,
        updatedAt: nowIso,
      }
      if (!(await repositories.verificaciones.actualizar(next, current.version)))
        throw new ErrorIdentidad(409, 'CONCURRENT_MODIFICATION', 'verification changed; retry')
      await repositories.cola.encolar({
        jobId: `trabajo-identidad-${randomUUID()}`,
        verificationId: next.verificationId,
        stage: 'lectura',
        status: 'queued',
        queuedAt: nowIso,
        availableAt: nowIso,
        attemptCount: 0,
        leaseOwner: null,
        leaseUntil: null,
        lastErrorCode: null,
        updatedAt: nowIso,
      })
      await this.auditar(repositories, 'verification.queued', next, context)
      return {
        status: 'queued' as const,
        message: MENSAJE_EN_VERIFICACION,
        verificationId: next.verificationId,
      }
    })
  }

  // ---- platform administration (callers verified the platform-admin authority) -------------

  async listar(filter: { status?: string; limit?: number }) {
    return this.transaction.ejecutar(async (repositories) =>
      (
        await repositories.verificaciones.listar({
          status: filter.status as EstadoVerificacionIdentidad | undefined,
          limit: Math.min(Math.max(Number(filter.limit) || 50, 1), 200),
        })
      ).map((item) => ({
        verificationId: item.verificationId,
        tenantId: item.tenantId,
        userId: item.userId,
        status: item.status,
        reviewReason: item.reviewReason,
        verificationMethod: item.verificationMethod,
        attempts: item.attempts,
        queuedAt: item.queuedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        documentNumberMasked: item.documentNumber ? enmascararDni(item.documentNumber) : null,
      }))
    )
  }

  async detalle(verificationId: string) {
    return this.transaction.ejecutar(async (repositories) => {
      const item = await repositories.verificaciones.buscar(verificationId)
      if (!item) throw new ErrorIdentidad(404, 'NOT_FOUND', 'verification was not found')
      const job = await repositories.cola.buscarActivo(verificationId)
      return {
        ...item,
        documents: await this.documentos(repositories, verificationId),
        job: job
          ? {
              stage: job.stage,
              status: job.status,
              availableAt: job.availableAt,
              attemptCount: job.attemptCount,
              lastErrorCode: job.lastErrorCode,
            }
          : null,
      }
    })
  }

  // Decrypted image for the platform admin reviewer only; never cached, never public.
  async documentoParaRevision(verificationId: string, side: unknown) {
    if (side !== 'front' && side !== 'back')
      throw new ErrorIdentidad(400, 'INVALID_SIDE', 'side must be front or back')
    if (!this.boveda)
      throw new ErrorIdentidad(
        503,
        'DOCUMENT_STORAGE_NOT_CONFIGURED',
        'document storage is not configured'
      )
    const boveda = this.boveda
    return this.transaction.ejecutar(async (repositories) => {
      const doc = await repositories.documentos.leer(verificationId, side)
      if (!doc) throw new ErrorIdentidad(404, 'NOT_FOUND', 'document was not found')
      return {
        mimeType: doc.mimeType,
        bytes: Buffer.from(
          boveda.descifrar(doc.ciphertext, aadDocumento(verificationId, side)),
          'base64'
        ),
      }
    })
  }

  async decidir(
    context: ContextoIdentidad,
    verificationId: string,
    input: { decision: unknown; reason: unknown }
  ) {
    const decision = input.decision
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : ''
    if (!['approve', 'reject', 'review', 'retry'].includes(String(decision)))
      throw new ErrorIdentidad(400, 'INVALID', 'decision must be approve, reject, review or retry')
    if ((decision === 'approve' || decision === 'reject') && !reason)
      throw new ErrorIdentidad(400, 'REASON_REQUIRED', 'a reason is required')
    return this.transaction.ejecutar(async (repositories) => {
      const current = await repositories.verificaciones.buscar(verificationId)
      if (!current) throw new ErrorIdentidad(404, 'NOT_FOUND', 'verification was not found')
      const nowIso = this.isoNow()
      let next: VerificacionIdentidad
      if (decision === 'retry') {
        if (!ESTADOS_REINTENTABLES.has(current.status))
          throw new ErrorIdentidad(
            409,
            'INVALID_STATE',
            `cannot retry a ${current.status} verification`
          )
        if (await repositories.cola.buscarActivo(verificationId))
          throw new ErrorIdentidad(409, 'ALREADY_QUEUED', 'verification already has an active job')
        next = { ...current, status: 'queued', reviewReason: null, queuedAt: nowIso, attempts: 0 }
        await repositories.cola.encolar({
          jobId: `trabajo-identidad-${randomUUID()}`,
          verificationId,
          stage: 'lectura',
          status: 'queued',
          queuedAt: nowIso,
          availableAt: nowIso,
          attemptCount: 0,
          leaseOwner: null,
          leaseUntil: null,
          lastErrorCode: null,
          updatedAt: nowIso,
        })
      } else if (decision === 'approve') {
        if (!['review_required', 'failed', 'rejected'].includes(current.status))
          throw new ErrorIdentidad(
            409,
            'INVALID_STATE',
            `cannot approve a ${current.status} verification`
          )
        if (!current.documentNumber)
          throw new ErrorIdentidad(409, 'DOCUMENT_NUMBER_REQUIRED', 'no document number was read')
        if (
          await repositories.verificaciones.existeVerificadaDeOtro({
            tenantId: current.tenantId,
            documentNumber: current.documentNumber,
            ...(current.verifiedCuil ? { cuil: current.verifiedCuil } : {}),
          })
        )
          throw new ErrorIdentidad(
            409,
            'IDENTITY_ALREADY_VERIFIED',
            'this identity is already verified for another provider'
          )
        next = {
          ...current,
          status: 'verified',
          verificationMethod: 'manual',
          decisionNote: reason,
          verifiedAt: nowIso,
        }
      } else if (decision === 'reject') {
        next = { ...current, status: 'rejected', decisionNote: reason, rejectedAt: nowIso }
      } else {
        next = {
          ...current,
          status: 'review_required',
          reviewReason: 'MANUAL_REVIEW_REQUESTED',
          decisionNote: reason || null,
        }
      }
      next = { ...next, version: current.version + 1, updatedAt: nowIso }
      if (!(await repositories.verificaciones.actualizar(next, current.version)))
        throw new ErrorIdentidad(409, 'CONCURRENT_MODIFICATION', 'verification changed; reload it')
      const action =
        decision === 'approve'
          ? 'verification.verified'
          : decision === 'reject'
            ? 'verification.rejected'
            : decision === 'retry'
              ? 'verification.queued'
              : 'verification.review_required'
      await this.auditar(repositories, action, next, context, {
        manual: true,
        reason,
        previousStatus: current.status,
      })
      return next
    })
  }

  async estadoWorker(): Promise<{
    status: EstadoWorkerIdentidad | 'rate_limited'
    providerState: EstadoProveedorIdentidad
    used: number
    max: number
    nextEligibleAt: string | null
    pending: number
  }> {
    return this.transaction.ejecutar(async (repositories) => {
      const providerState = await repositories.estadoProveedor.leer(this.config.providerId)
      const usage = await repositories.limite.uso({
        providerId: this.config.providerId,
        max: this.config.maxChecksPerHour,
        windowMs: 3_600_000,
        now: this.isoNow(),
      })
      const status =
        providerState.status === 'running' && usage.used >= this.config.maxChecksPerHour
          ? 'rate_limited'
          : providerState.status
      return {
        status,
        providerState,
        used: usage.used,
        max: this.config.maxChecksPerHour,
        nextEligibleAt: usage.nextEligibleAt,
        pending: await repositories.cola.contarPendientes(),
      }
    })
  }

  async controlarWorker(context: ContextoIdentidad, action: unknown) {
    const target: Record<string, EstadoWorkerIdentidad> = {
      pause: 'paused',
      resume: 'running',
      reauthenticate: 'session_required',
    }
    const status = target[String(action)]
    if (!status)
      throw new ErrorIdentidad(400, 'INVALID', 'action must be pause, resume or reauthenticate')
    return this.transaction.ejecutar(async (repositories) => {
      const current = await repositories.estadoProveedor.leer(this.config.providerId)
      const next: EstadoProveedorIdentidad = {
        ...current,
        status,
        consecutiveErrors: status === 'running' ? 0 : current.consecutiveErrors,
        reason: `admin:${String(action)}`,
        version: current.version + 1,
        updatedAt: this.isoNow(),
      }
      if (!(await repositories.estadoProveedor.guardar(next, current.version)))
        throw new ErrorIdentidad(409, 'CONCURRENT_MODIFICATION', 'worker state changed; retry')
      await repositories.auditoria.registrar({
        eventId: `auditoria-identidad-${randomUUID()}`,
        action: `worker.${String(action)}`,
        verificationId: null,
        tenantId: null,
        actorId: context.actorId,
        correlationId: context.correlationId,
        metadata: { providerId: this.config.providerId, previousStatus: current.status, status },
        createdAt: this.isoNow(),
      })
      return next
    })
  }

  private async documentos(repositories: RepositoriosIdentidad, verificationId: string) {
    return {
      front: Boolean(await repositories.documentos.leer(verificationId, 'front')),
      back: Boolean(await repositories.documentos.leer(verificationId, 'back')),
    }
  }

  private vista(
    current: VerificacionIdentidad | null,
    documents: { front: boolean; back: boolean }
  ): VistaVerificacionPrestador {
    const status = current?.status ?? 'not_started'
    return {
      verificationId: current?.verificationId ?? null,
      status,
      consentAccepted: Boolean(current?.consentAcceptedAt),
      consentText: TEXTO_CONSENTIMIENTO_IDENTIDAD,
      consentVersion: VERSION_CONSENTIMIENTO_IDENTIDAD,
      documents,
      documentNumberMasked: current?.documentNumber ? enmascararDni(current.documentNumber) : null,
      message: MENSAJES_ESTADO[status],
      updatedAt: current?.updatedAt ?? null,
    }
  }

  private async auditar(
    repositories: RepositoriosIdentidad,
    action: string,
    verification: VerificacionIdentidad,
    context: ContextoIdentidad,
    metadata: Record<string, unknown> = {}
  ) {
    await repositories.auditoria.registrar({
      eventId: `auditoria-identidad-${randomUUID()}`,
      action,
      verificationId: verification.verificationId,
      tenantId: verification.tenantId,
      actorId: context.actorId,
      correlationId: context.correlationId,
      metadata: {
        status: verification.status,
        ...(verification.documentNumber
          ? { documentNumber: enmascararDni(verification.documentNumber) }
          : {}),
        ...(verification.verifiedCuil ? { cuil: enmascararCuil(verification.verifiedCuil) } : {}),
        ...metadata,
      },
      createdAt: this.isoNow(),
    })
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString()
  }
}

export function aadDocumento(verificationId: string, side: 'front' | 'back'): string {
  return `identity-document:${verificationId}:${side}`
}
