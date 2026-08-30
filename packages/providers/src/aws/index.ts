import {
  ConfiguredProviderAdapter,
  DeterministicProviderFake,
  PROVIDER_NAMES,
  createProviderConfig,
  type DeterministicProviderOptions,
  type ProviderAdapterOptions,
  type ProviderTransportInput,
} from '../core/index.ts'

export class AwsProviderAdapter extends ConfiguredProviderAdapter {
  constructor(transport: ProviderTransportInput, options: ProviderAdapterOptions = {}) {
    super(createProviderConfig(PROVIDER_NAMES.AWS, options), transport)
  }
}

export class DeterministicAwsProvider extends DeterministicProviderFake {
  constructor(options: DeterministicProviderOptions = {}) {
    super(PROVIDER_NAMES.AWS, options)
  }
}

export default { AwsProviderAdapter, DeterministicAwsProvider }
