import express, { type Request, type Response, type Router } from 'express'
import type { JobTransportInput, JobTransportPort } from '../../platform/jobs/ports.ts'
import { ActivationGatedJobTransport } from '../../platform/jobs/adapters/activation-gated.ts'
import {
  evaluateReadinessGates,
  type ReadinessGates,
} from '../domain/readiness.ts'
import {
  MercadoPagoAdapter,
  type MercadoPagoWebhookRequest,
} from '../../providers/mercado-pago/index.ts'
import {
  WhatsAppAdapter,
  type WhatsAppWebhookRequest,
} from '../../providers/whatsapp/index.ts'
import { TusReadinessBlockedError, type TusReadinessGuard, type TusReadinessProfile } from '../readiness/index.ts'
import { asyncHandler, createErrorEnvelope } from '../../presentation/middleware/error.ts'
import { getCorrelationId } from '../../presentation/middleware/correlation.ts'

export type TusActivationStatus = ReturnType<typeof evaluateReadinessGates>

const DISABLED_GATES: ReadinessGates = {
  legal: false,
  kyc: false,
  kyb: false,
  tax: false,
  mercadoPago: false,
  posPilot: false,
  aws: false,
  groqMigration: false,
}

export type TusCompensatingEntry = {
  entryId: string
  reason: string
  createdAt: number
  evidencePreserved: true
  auditPreserved: true
  neutralContractsUntouched: true
}

export class TusActivationBlockedError extends Error {
  readonly code = 'TUS_ACTIVATION_BLOCKED'

  constructor() {
    super('TUS release jobs are disabled until activation gates pass')
    this.name = 'TusActivationBlockedError'
  }
}

export class TusActivationController {
  private readonly releaseJobs: ActivationGatedJobTransport
  private readonly now: () => number
  private current: TusActivationStatus
  private readonly compensating = new Map<number, TusCompensatingEntry>()

  constructor(delegate: JobTransportPort, now: () => number = () => Date.now(), options: { readinessGuard?: TusReadinessGuard; readinessProfile?: TusReadinessProfile; readinessScope?: string } = {}) {
    this.releaseJobs = new ActivationGatedJobTransport(delegate, options)
    this.now = now
    this.current = evaluateReadinessGates(DISABLED_GATES)
  }

  evaluate(gates: ReadinessGates): TusActivationStatus {
    this.current = evaluateReadinessGates(gates)
    if (this.current.enabled) this.releaseJobs.activate()
    else this.releaseJobs.deactivate()
    return this.status()
  }

  status(): TusActivationStatus {
    return { enabled: this.current.enabled, failedGates: [...this.current.failedGates] }
  }

  enqueueReleaseJob(input: JobTransportInput): Promise<{ status: 'queued'; tenantId: string; jobId: string }> {
    if (!this.current.enabled) return Promise.reject(new TusActivationBlockedError())
    return this.releaseJobs.enqueue(input)
  }

  rollback(reason: string): TusCompensatingEntry {
    if (!reason.trim()) throw new Error('rollback reason is required')
    this.releaseJobs.deactivate()
    this.current = evaluateReadinessGates(DISABLED_GATES)
    const createdAt = this.now()
    const sequence = this.compensating.size + 1
    const entry: TusCompensatingEntry = {
      entryId: `tus-compensation-${createdAt}-${sequence}`,
      reason,
      createdAt,
      evidencePreserved: true,
      auditPreserved: true,
      neutralContractsUntouched: true,
    }
    this.compensating.set(sequence, entry)
    return { ...entry }
  }

  listCompensatingEntries(): TusCompensatingEntry[] {
    return [...this.compensating.values()].map((entry) => ({ ...entry }))
  }
}

export type TusIntegrationRouterOptions = {
  mercadoPago?: MercadoPagoAdapter
  whatsapp?: WhatsAppAdapter
  readinessGuard?: TusReadinessGuard
  readinessProfile?: TusReadinessProfile
  readinessScope?: string
  providerActionsEnabled?: boolean
}

export function createTusIntegrationRouter(options: TusIntegrationRouterOptions): Router {
  const router = express.Router()

  router.post('/tus/providers/mercado-pago/webhook', asyncHandler(async (request: Request, response: Response) => {
    if (!options.providerActionsEnabled || !options.mercadoPago) {
      response.status(503).json(createErrorEnvelope(new Error('provider disabled'), getCorrelationId(request), 'PROVIDER_UNAVAILABLE'))
      return
    }
    await sendWebhookResult(response, getCorrelationId(request), () =>
      requireProviderReadiness(options, request, 'provider:mercado-pago').then(() => options.mercadoPago!.receiveWebhook(request.body as MercadoPagoWebhookRequest)),
    )
  }))

  router.post('/tus/providers/whatsapp/webhook', asyncHandler(async (request: Request, response: Response) => {
    if (!options.providerActionsEnabled || !options.whatsapp) {
      response.status(503).json(createErrorEnvelope(new Error('provider disabled'), getCorrelationId(request), 'PROVIDER_UNAVAILABLE'))
      return
    }
    await sendWebhookResult(response, getCorrelationId(request), () =>
      requireProviderReadiness(options, request, 'provider:whatsapp').then(() => options.whatsapp!.receiveWebhook(request.body as WhatsAppWebhookRequest)),
    )
  }))

  return router
}

async function sendWebhookResult<TValue extends { status: string }>(
  response: Response,
  correlationId: string,
  operation: () => Promise<TValue>,
): Promise<void> {
  try {
    const result = await operation()
    const status = result.status === 'processed' || result.status === 'replay' ? 200 : result.status === 'rejected' ? 422 : 503
    const body =
      result.status === 'rejected'
        ? { status: result.status, reason: readRejectionReason(result) }
        : result
    response.status(status).json(body)
  } catch (error) {
    if (error instanceof TusReadinessBlockedError) {
      response.status(error.status).json(createErrorEnvelope(error, correlationId, error.code))
      return
    }
    response.status(503).json(createErrorEnvelope(error, correlationId, 'PROVIDER_UNAVAILABLE'))
  }
}

async function requireProviderReadiness(options: TusIntegrationRouterOptions, request: Request, actorId: string): Promise<void> {
  const body = typeof request.body === 'object' && request.body !== null ? request.body as Record<string, unknown> : {}
  await options.readinessGuard?.require({
    tenantId: typeof body['tenantId'] === 'string' ? body['tenantId'] : '',
    actorId,
    correlationId: request.header('x-correlation-id') ?? (typeof body['correlationId'] === 'string' ? body['correlationId'] : ''),
    capability: 'provider-actions',
    profile: (request.header('x-tus-readiness-profile') ?? options.readinessProfile ?? 'native-local') as TusReadinessProfile,
    scope: request.header('x-tus-readiness-scope') ?? options.readinessScope ?? 'argentina-stage-1',
  })
}

function readRejectionReason(result: { status: string }): string {
  return 'reason' in result && typeof result.reason === 'string' ? result.reason : 'rejected'
}

export default { TusActivationController, createTusIntegrationRouter }
