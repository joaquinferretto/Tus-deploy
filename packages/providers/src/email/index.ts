import {
  ConfiguredProviderAdapter,
  DeterministicProviderFake,
  PROVIDER_NAMES,
  createProviderConfig,
  type DeterministicProviderOptions,
  type ProviderAdapterOptions,
  type ProviderTransportInput,
} from '../core/index.ts'

export class EmailProviderAdapter extends ConfiguredProviderAdapter {
  constructor(transport: ProviderTransportInput, options: ProviderAdapterOptions = {}) {
    super(createProviderConfig(PROVIDER_NAMES.EMAIL, options), transport)
  }
}

export class DeterministicEmailProvider extends DeterministicProviderFake {
  constructor(options: DeterministicProviderOptions = {}) {
    super(PROVIDER_NAMES.EMAIL, options)
  }
}

export default { EmailProviderAdapter, DeterministicEmailProvider }
