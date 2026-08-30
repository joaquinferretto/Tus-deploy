import {
  ConfiguredProviderAdapter,
  DeterministicProviderFake,
  PROVIDER_NAMES,
  createProviderConfig,
  type DeterministicProviderOptions,
  type ProviderAdapterOptions,
  type ProviderTransportInput,
} from '../core/index.ts'

export class GroqProviderAdapter extends ConfiguredProviderAdapter {
  constructor(transport: ProviderTransportInput, options: ProviderAdapterOptions = {}) {
    super(createProviderConfig(PROVIDER_NAMES.GROQ, options), transport)
  }
}

export class DeterministicGroqProvider extends DeterministicProviderFake {
  constructor(options: DeterministicProviderOptions = {}) {
    super(PROVIDER_NAMES.GROQ, options)
  }
}

export default { GroqProviderAdapter, DeterministicGroqProvider }
