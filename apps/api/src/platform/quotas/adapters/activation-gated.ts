import type { QuotaProviderPort, QuotaProviderUsage } from '../ports.js'

export const QUOTA_ADAPTER_ACTIVATION = {
  DISABLED: 'disabled',
  ACTIVE: 'active',
} as const

export type QuotaAdapterActivation =
  (typeof QUOTA_ADAPTER_ACTIVATION)[keyof typeof QUOTA_ADAPTER_ACTIVATION]

export interface QuotaAdapterConfig {
  activation: QuotaAdapterActivation
  configRef: string
}

export class QuotaProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE' as const

  constructor(message = 'quota provider is not activated') {
    super(message)
    this.name = 'QuotaProviderUnavailableError'
  }
}

export class ActivationGatedQuotaAdapter implements QuotaProviderPort {
  readonly configRef: string

  constructor(
    private readonly config: QuotaAdapterConfig,
    private readonly provider: QuotaProviderPort
  ) {
    this.configRef = config.configRef
  }

  async record(input: QuotaProviderUsage): Promise<void> {
    if (this.config.activation !== QUOTA_ADAPTER_ACTIVATION.ACTIVE)
      throw new QuotaProviderUnavailableError()
    await this.provider.record(input)
  }
}

export default { ActivationGatedQuotaAdapter, QuotaProviderUnavailableError }
