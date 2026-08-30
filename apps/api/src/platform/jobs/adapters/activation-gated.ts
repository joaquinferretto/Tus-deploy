import type { JobTransportInput, JobTransportPort } from '../ports.js'
import type { TusReadinessGuard, TusReadinessProfile } from '../../../tus/readiness/index.ts'

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
  private readonly readinessGuard?: TusReadinessGuard
  private readonly readinessProfile: TusReadinessProfile
  private readonly readinessScope: string

  constructor(
    delegate: JobTransportPort,
    options: {
      readinessGuard?: TusReadinessGuard
      readinessProfile?: TusReadinessProfile
      readinessScope?: string
    } = {},
  ) {
    this.delegate = delegate
    this.readinessGuard = options.readinessGuard
    this.readinessProfile = options.readinessProfile ?? 'native-local'
    this.readinessScope = options.readinessScope ?? 'argentina-stage-1'
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
    await this.readinessGuard?.require({
      tenantId: input.tenantId,
      actorId: `job:${input.jobId}`,
      correlationId: `job:${input.jobId}`,
      capability: 'release-jobs',
      profile: this.readinessProfile,
      scope: this.readinessScope,
      jobId: input.jobId,
    })
    return this.delegate.enqueue(input)
  }
}

export default { ActivationGatedJobTransport, JobProviderUnavailableError }
