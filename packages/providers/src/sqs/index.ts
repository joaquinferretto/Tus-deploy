import {
  ConfiguredProviderAdapter,
  DeterministicProviderFake,
  PROVIDER_NAMES,
  createProviderConfig,
  type DeterministicProviderOptions,
  type ProviderAdapterOptions,
  type ProviderTransportInput,
} from '../core/index.ts'

export class SqsProviderAdapter extends ConfiguredProviderAdapter {
  constructor(transport: ProviderTransportInput, options: ProviderAdapterOptions = {}) {
    super(createProviderConfig(PROVIDER_NAMES.SQS, options), transport)
  }
}

export class DeterministicSqsProvider extends DeterministicProviderFake {
  constructor(options: DeterministicProviderOptions = {}) {
    super(PROVIDER_NAMES.SQS, options)
  }
}

export default { SqsProviderAdapter, DeterministicSqsProvider }
