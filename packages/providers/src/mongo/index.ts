import {
  ConfiguredProviderAdapter,
  DeterministicProviderFake,
  PROVIDER_NAMES,
  createProviderConfig,
  type DeterministicProviderOptions,
  type ProviderAdapterOptions,
  type ProviderTransportInput,
} from '../core/index.ts'

export class MongoProviderAdapter extends ConfiguredProviderAdapter {
  constructor(transport: ProviderTransportInput, options: ProviderAdapterOptions = {}) {
    super(createProviderConfig(PROVIDER_NAMES.MONGO, options), transport)
  }
}

export class DeterministicMongoProvider extends DeterministicProviderFake {
  constructor(options: DeterministicProviderOptions = {}) {
    super(PROVIDER_NAMES.MONGO, options)
  }
}

export default { MongoProviderAdapter, DeterministicMongoProvider }
