import type { JobTransportInput, JobTransportPort } from '../ports.js'
import type { EvaluadorHabilitacion, PerfilHabilitacion } from '../../../tus/readiness/index.ts'

export class JobProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'

  constructor() {
    super('Job transport is not activated')
    this.name = 'JobProviderUnavailableError'
  }
}

export class ActivationGatedJobTransport implements JobTransportPort {
  private enabled = false
  private readonly delegate: JobTransportPort
  private readonly evaluadorHabilitacion?: EvaluadorHabilitacion
  private readonly perfilHabilitacion: PerfilHabilitacion
  private readonly alcanceHabilitacion: string

  constructor(
    delegate: JobTransportPort,
    options: {
      evaluadorHabilitacion?: EvaluadorHabilitacion
      perfilHabilitacion?: PerfilHabilitacion
      alcanceHabilitacion?: string
    } = {},
  ) {
    this.delegate = delegate
    this.evaluadorHabilitacion = options.evaluadorHabilitacion
    this.perfilHabilitacion = options.perfilHabilitacion ?? 'native-local'
    this.alcanceHabilitacion = options.alcanceHabilitacion ?? 'argentina-stage-1'
  }

  activate(): void {
    this.enabled = true
  }

  deactivate(): void {
    this.enabled = false
  }

  async enqueue(
    input: JobTransportInput
  ): Promise<{ status: 'queued'; tenantId: string; jobId: string }> {
    if (!this.enabled) return Promise.reject(new JobProviderUnavailableError())
    await this.evaluadorHabilitacion?.require({
      tenantId: input.tenantId,
      actorId: `job:${input.jobId}`,
      correlationId: `job:${input.jobId}`,
      capability: 'release-jobs',
      profile: this.perfilHabilitacion,
      scope: this.alcanceHabilitacion,
      jobId: input.jobId,
    })
    return this.delegate.enqueue(input)
  }
}

export default { ActivationGatedJobTransport, JobProviderUnavailableError }
